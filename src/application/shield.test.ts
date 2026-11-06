import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { protectedStoreAmount, SHIELD_TIMING } from '../domain/shield/shield.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import { createInitialSaveState } from './persistence.ts';
import { dispatchFlight, reconcileFlights } from './flights.ts';
import { dispatchNpcMission } from './npc-missions.ts';
import { calculateAttackLoot } from './attack.ts';
import { launchSunRaid } from './sun-raid.ts';
import type { SaveState } from './contracts.ts';
import { withAttackEligiblePoints } from './attack-eligibility.test-support.ts';
import { activateShield, checkShieldActivation, ownerShieldStatus } from './shield.ts';

const START = Date.UTC(2026, 9, 23, 12);
const PRODUCTION = { now: START, mode: 'production' as const, testTimeScale: 1 as const };

function campaign(speed: 'standard' | 'fast' = 'standard'): SaveState {
  const base = createDefaultNewGameConfig({ seed: 'planet-shield', factionId: 'aegis', playerName: 'Shield QA' });
  return createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 3, campaignSpeed: speed } });
}

function npcTargets(state: SaveState): SpyTargetState[] {
  return Object.values(getEspionageTargets(state.espionage)).filter((target) => target.kind === 'npc').sort((a, b) => a.id.localeCompare(b.id));
}

/** Both sides inside each other's attack band. */
function inRange(state: SaveState, ...owners: string[]): SaveState {
  const next = withAttackEligiblePoints(state, owners, 5_000);
  for (const owner of owners) assert.ok(selectOwnerScore(next, owner)!.totalPoints >= 300);
  return next;
}

function playerAttack(state: SaveState, target: SpyTargetState, requestId: string, at = START) {
  return dispatchFlight(state, {
    requestId, missionId: 'attack', originPlanetId: state.currentPlanetId,
    destination: { kind: 'planet', planetId: target.id, coordinate: target.coordinate },
    targetRelation: 'neutral', targetOwnerId: target.ownerId,
    selectedShips: { scout: 5 }, selectedCommanders: {}, maxRounds: 5, departedAt: at,
  }, { ...PRODUCTION, now: at });
}

function npcAttack(state: SaveState, origin: SpyTargetState, requestId: string, at = START) {
  const home = state.planets['helion-01']!;
  return dispatchNpcMission(state, {
    ownerId: origin.ownerId, originPlanetId: origin.id, requestId, missionId: 'attack', selectedShips: { scout: 5 },
    destination: { kind: 'planet', planetId: 'helion-01', coordinate: { galaxy: home.universeGalaxy!, system: home.universeSystem!, position: home.universePosition! } },
    targetPlanetId: 'helion-01',
  }, at, 1);
}

function raised(state: SaveState, ownerId: string, at = START): SaveState {
  const result = activateShield(state, ownerId, at);
  assert.ok(result.ok);
  return result.ok ? result.state : state;
}

test('activation: speed-based duration, cooldown from the end, one button for the whole owner', () => {
  for (const speed of ['standard', 'fast'] as const) {
    const base = campaign(speed);
    const player = base.profile.playerId;
    assert.equal(base.shields, undefined, 'a new game starts with no shield');
    const state = raised(base, player);
    const { durationMs, cooldownMs } = SHIELD_TIMING[speed];
    assert.equal(state.shields![player]!.activeUntil, START + durationMs);
    assert.equal(ownerShieldStatus(state, player, START + 1).phase, 'active');
    assert.equal(ownerShieldStatus(state, player, START + durationMs).phase, 'cooldown');
    const again = activateShield(state, player, START + durationMs + 1);
    assert.equal(again.ok, false);
    assert.equal(again.ok ? '' : again.code, 'cooldown');
    assert.equal(activateShield(state, player, START + durationMs + cooldownMs).ok, true);
  }
});

test('a shielded planet cannot be attacked by the player or an NPC; the shield ends', () => {
  const base = campaign();
  const player = base.profile.playerId;
  const [npc] = npcTargets(base);
  const ready = inRange(base, player, npc!.ownerId);
  assert.equal(npcAttack(ready, npc!, 'npc-open').ok, true, 'control: the attack is open without a shield');
  assert.equal(playerAttack(ready, npc!, 'player-open').ok, true);

  const shielded = raised(ready, player);
  const blocked = npcAttack(shielded, npc!, 'npc-blocked', START + 1000);
  assert.deepEqual([blocked.ok, blocked.reason], [false, 'attack-not-allowed']);

  const theirs = raised(ready, npc!.ownerId);
  const refused = playerAttack(theirs, npc!, 'player-vs-shield', START + 1000);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.error.message, /Планета под щитом, ещё/);

  const own = playerAttack(shielded, npc!, 'player-own-shield', START + 1000);
  assert.equal(own.ok, false);

  const after = START + SHIELD_TIMING.standard.durationMs + 1;
  assert.equal(npcAttack(shielded, npc!, 'npc-after', after).ok, true, 'after the shield the planet is open again');
});

test('the shield cannot be raised while own hostile flights are out', () => {
  const base = campaign();
  const player = base.profile.playerId;
  const [npc] = npcTargets(base);
  const sent = playerAttack(inRange(base, player, npc!.ownerId), npc!, 'out-1');
  assert.ok(sent.ok);
  if (!sent.ok) return;
  const check = checkShieldActivation(sent.state, player, START + 1);
  assert.equal(check.ok, false);
  assert.equal(check.ok ? '' : check.code, 'hostile-flights');
});

test('under the shield nobody can send a Sun raid', () => {
  const base = campaign();
  const shielded = raised(base, base.profile.playerId);
  const result = launchSunRaid(shielded, { originPlanetId: shielded.currentPlanetId, requestId: 'sun-1', ships: { scout: 1 }, commanders: {} } as never, { now: START + 1, mode: 'production' });
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /щит/i);
});

test('a hostile flight arriving at a shielded owner turns back without a battle', () => {
  const base = campaign();
  const player = base.profile.playerId;
  const [npc] = npcTargets(base);
  const sent = npcAttack(inRange(base, player, npc!.ownerId), npc!, 'bounce-1');
  assert.ok(sent.ok && sent.flight);
  if (!sent.ok || !sent.flight) return;
  const shielded = raised(sent.state, player, START + 1);
  const arrived = reconcileFlights(shielded, sent.flight.arrivalAt + 1, undefined, PRODUCTION);
  assert.equal(arrived.state.combat.reports.length, base.combat.reports.length, 'no battle');
  const flight = arrived.state.flights.records.find((item) => item.id === sent.flight!.id)!;
  assert.ok(flight.phase === 'returning' || flight.phase === 'completed');
  assert.equal(flight.attackResolution, undefined);
});

test('protected stores: loot never reaches into the protected share', () => {
  const report = { winner: 'attacker', attackerForce: { stacks: [{ entityId: 'mega-transporter', countAfter: 100_000 }] } } as unknown as BattleReport;
  const rich = { metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000 };
  assert.equal(calculateAttackLoot(report, rich, 'aegis').metal, 750_000, 'without buildings the old 75 % rule stands');
  const buildings = { 'metal-storage': 1, 'mineral-storage': 1, 'gas-storage': 1 };
  const kept = protectedStoreAmount(getStorageCapacities(buildings).metal);
  assert.ok(kept > 0);
  const loot = calculateAttackLoot(report, { metal: kept + 1_000, minerals: kept * 100, gas: Math.floor(kept / 2) }, 'aegis', buildings);
  assert.equal(loot.metal, 1_000, 'stock above the protected share: only the excess');
  assert.equal(loot.minerals, Math.floor(kept * 100 * 0.75), 'a big stock keeps the old 75 % cap');
  assert.equal(loot.gas, 0, 'a stock inside the protected share is never taken');
});
