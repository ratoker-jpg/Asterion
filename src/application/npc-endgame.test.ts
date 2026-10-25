import assert from 'node:assert/strict';
import test from 'node:test';

import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { DEFAULT_ALLIANCE_EMBLEM } from '../domain/command/catalog.ts';
import { selectOpenRequestsOf } from '../domain/command/aid.ts';
import { acceptApplication, applyToAlliance, createAlliance } from '../domain/command/membership.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { npcFlagshipOwners } from '../domain/npc/doctrine.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { utilityToWeight } from '../domain/npc/utility.ts';
import { SOLAR_CRYSTAL_IDS } from '../domain/sun-raid/config.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';
import { createNpcAidRequest, getNpcAidRequestCandidates } from './npc-aid.ts';
import { getNpcEndgameChoices } from './npc-endgame.ts';
import { dispatchNpcTransport, resolveNpcTransportArrival } from './npc-missions.ts';
import { getNpcSpaceportCandidates, settleNpcSpaceport, startNpcSpaceportUpgrade, syncNpcOwnerShipLevels } from './npc-spaceport.ts';
import { createNpcUtilityContext, npcFlagshipPlan } from './npc-utility.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { currentSunRaidState, reconcileSunRaids } from './sun-raid.ts';

const NOW = Date.UTC(2026, 9, 26);
const HOUR = 3_600_000;

function world(npcCount = 3) {
  const config = createDefaultNewGameConfig({ seed: 'NPC-ENDGAME', factionId: 'aegis', playerName: 'Endgame Test' });
  const state = createInitialSaveState('production', NOW, { ...config, world: { ...config.world, npcCount } });
  const owners = Object.keys(state.npc!.profiles).sort();
  return { state, owners };
}

function home(state: SaveState, ownerId: string): SpyTargetState {
  return state.espionage!.targets![`${ownerId}-planet`]!;
}

function withTarget(state: SaveState, target: SpyTargetState): SaveState {
  return { ...state, espionage: { ...state.espionage!, targets: { ...state.espionage!.targets, [target.id]: target } } };
}

function leaderOf(state: SaveState, ownerId: string): SaveState {
  const created = createAlliance(state.command, {
    ownerId,
    displayName: home(state, ownerId).ownerName,
    settings: { name: 'Sun Seekers', tag: 'SUN', motto: '', description: '', emblem: DEFAULT_ALLIANCE_EMBLEM },
  }, { now: NOW, random: () => 0.4 });
  assert.ok(created.ok);
  return { ...state, command: created.state };
}

function armed(state: SaveState, ownerId: string, cruisers = 300): SaveState {
  const planet = home(state, ownerId);
  return withTarget(state, {
    ...planet,
    fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, cruiser: cruisers } },
    resources: { ...planet.resources, gas: 500_000_000 },
  });
}

/** One alliance of the given owners, the first one its leader. */
function allianceOf(state: SaveState, owners: readonly string[]): SaveState {
  let next = leaderOf(state, owners[0]!);
  const allianceId = next.command.alliances.find((alliance) => alliance.leaderOwnerId === owners[0])!.id;
  for (const ownerId of owners.slice(1)) {
    const applied = applyToAlliance(next.command, { ownerId, displayName: home(next, ownerId).ownerName, allianceId }, { now: NOW, random: () => 0.4 });
    assert.ok(applied.ok);
    const accepted = acceptApplication(applied.state, owners[0]!, applied.applicationId, { now: NOW, random: () => 0.4 });
    assert.ok(accepted.ok);
    next = { ...next, command: accepted.state };
  }
  return next;
}

const scored = (_id: string, estimate: number) => utilityToWeight(estimate);

test('NPC raid gathering: the leader declares, two allies join, 225 000 takes off together and comes home (25.10.2026)', () => {
  const { state: initial, owners } = world();
  // 20 000 cruisers × 7 population: any risk share still brings the full 75 000.
  let state = allianceOf(initial, owners);
  for (const ownerId of owners) state = armed(state, ownerId, 20_000);
  const leader = owners[0]!;
  const before = Object.fromEntries(owners.map((ownerId) => [ownerId, home(state, ownerId)]));
  const leaderProfile = state.npc!.profiles[leader]!;
  const declare = getNpcEndgameChoices(state, leaderProfile, createNpcUtilityContext(state, leaderProfile, NOW, 1), NOW, 1, scored)
    .find((choice) => choice.candidate.id.startsWith('sun-raid:'));
  assert.ok(declare, 'an alliance able to fill 225 000 declares a gathering');
  const declared = declare.run(state, `npc-autonomy:${JSON.stringify([leader, 'sun-1'])}`);
  assert.equal(declared.started, true, declared.reason ?? undefined);
  state = declared.state;
  let raid = currentSunRaidState(state).raids[0]!;
  assert.equal(raid.status, 'gathering');
  assert.equal(raid.gatherEndsAt, NOW + 30 * 60_000);
  const leaderPledge = state.flights.records.filter((item) => item.sunRaid?.raidId === raid.id && item.ownerId === leader)
    .reduce((total, item) => total + (item.sunRaid?.population ?? 0), 0);
  assert.ok(leaderPledge > 0 && leaderPledge <= 75_000, `the leader brings at most 75 000: ${leaderPledge}`);
  const leaderFlight = state.flights.records.find((item) => item.sunRaid?.raidId === raid.id && item.ownerId === leader)!;
  assert.ok(leaderFlight.gasCost > 0, 'an NPC pays the same gas as the player');

  for (const [index, ownerId] of owners.slice(1).entries()) {
    const at = NOW + (index + 1) * 60_000;
    const profile = state.npc!.profiles[ownerId]!;
    const join = getNpcEndgameChoices(state, profile, createNpcUtilityContext(state, profile, at, 1), at, 1, scored)
      .find((choice) => choice.candidate.id.startsWith('sun-raid-join:'));
    assert.ok(join, `${ownerId} answers the gathering`);
    const joined = join.run(state, `npc-autonomy:${JSON.stringify([ownerId, 'join'])}`);
    assert.equal(joined.started, true, joined.reason ?? undefined);
    state = joined.state;
  }
  raid = currentSunRaidState(state).raids[0]!;
  const attackers = state.flights.records.filter((item) => item.sunRaid?.raidId === raid.id && item.sunRaid.side === 'attacker');
  const total = attackers.reduce((sum, item) => sum + (item.sunRaid?.population ?? 0), 0);
  assert.equal(raid.status, 'incoming', `the full side takes off: ${total}`);
  assert.ok(total >= 225_000 - 100 && total <= 225_000);
  for (const ownerId of owners) {
    const own = attackers.filter((item) => item.ownerId === ownerId).reduce((sum, item) => sum + (item.sunRaid?.population ?? 0), 0);
    assert.ok(own <= 75_000, `${ownerId} stays within 75 000: ${own}`);
  }
  assert.ok(attackers.every((item) => item.arrivalAt === raid.arrivesAt), 'everyone leaves together');

  state = reconcileSunRaids(state, { now: raid.arrivesAt, mode: 'production', timeScale: 1 }).state;
  assert.equal(currentSunRaidState(state).raids[0]!.result?.winner, 'attacker', 'an undefended Sun falls');
  const back = Math.max(...state.flights.records.filter((item) => item.sunRaid?.raidId === raid.id).map((item) => item.returnAt ?? 0));
  state = reconcileSunRaids(state, { now: back, mode: 'production', timeScale: 1 }).state;
  for (const ownerId of owners) assert.equal(home(state, ownerId).fleet.ships.cruiser, before[ownerId]!.fleet.ships.cruiser, 'the whole fleet is back');
});

test('a gathering that does not reach 225 000 in 30 minutes disbands: ships and gas return, a new one may start at once', () => {
  const { state: initial, owners } = world();
  let state = allianceOf(initial, owners);
  for (const ownerId of owners) state = armed(state, ownerId, 20_000);
  const leader = owners[0]!;
  const before = home(state, leader);
  const leaderProfile = state.npc!.profiles[leader]!;
  const declare = getNpcEndgameChoices(state, leaderProfile, createNpcUtilityContext(state, leaderProfile, NOW, 1), NOW, 1, scored)
    .find((choice) => choice.candidate.id.startsWith('sun-raid:'))!;
  state = declare.run(state, 'npc-autonomy:lonely').state;
  const raid = currentSunRaidState(state).raids[0]!;
  assert.ok(home(state, leader).fleet.ships.cruiser < before.fleet.ships.cruiser);
  state = reconcileSunRaids(state, { now: raid.gatherEndsAt!, mode: 'production', timeScale: 1 }).state;
  const after = currentSunRaidState(state).raids[0]!;
  assert.equal(after.status, 'disbanded');
  assert.equal(after.closedAt, raid.gatherEndsAt);
  assert.equal(home(state, leader).fleet.ships.cruiser, before.fleet.ships.cruiser, 'every ship is home');
  assert.equal(home(state, leader).resources.gas, before.resources.gas, 'gas is returned');
  const again = getNpcEndgameChoices(state, state.npc!.profiles[leader]!, createNpcUtilityContext(state, state.npc!.profiles[leader]!, raid.gatherEndsAt!, 1), raid.gatherEndsAt!, 1, scored)
    .some((choice) => choice.candidate.id.startsWith('sun-raid:'));
  assert.equal(again, true, 'a new gathering may be declared at once');
});

test('an NPC holding four crystals lays the Gate on its main planet; a solo attacker breaks it by the 25.10.2026 rules', () => {
  const { state: initial, owners } = world();
  const ownerId = owners[1]!;
  let state = leaderOf(initial, ownerId);
  const allianceId = state.command.alliances.find((alliance) => alliance.leaderOwnerId === ownerId)!.id;
  const sunRaid = currentSunRaidState(state);
  state = { ...state, sunRaid: { ...sunRaid, crystals: { ...sunRaid.crystals, [`alliance:${allianceId}`]: [...SOLAR_CRYSTAL_IDS] } } };
  const profile = state.npc!.profiles[ownerId]!;
  const gateChoice = getNpcEndgameChoices(state, profile, createNpcUtilityContext(state, profile, NOW, 1), NOW, 1, scored)
    .find((choice) => choice.candidate.id.startsWith('gate-start:'));
  assert.ok(gateChoice);
  const started = gateChoice.run(state, 'npc-autonomy:gate');
  assert.equal(started.started, true, started.reason ?? undefined);
  state = started.state;
  const gate = currentSunRaidState(state).gates[0]!;
  assert.equal(gate.hostPlanetId, `${ownerId}-planet`);
  assert.equal(gate.status, 'building');
  // Everyone else now sees a rival Gate to break.
  const rival = owners[2]!;
  assert.ok(createNpcUtilityContext(state, state.npc!.profiles[rival]!, NOW, 1).rivalGateHosts?.has(gate.hostPlanetId));

  // The solo player wins an assault on the host planet.
  const reportId = 'report-gate-assault';
  const assault = {
    ...state.flights.records[0], id: 'flight-gate-assault', requestId: 'flight-gate-assault', missionId: 'attack' as const,
    ownerSide: undefined, ownerId: undefined, originPlanetId: state.currentPlanetId, destinationPlanetId: gate.hostPlanetId,
    phase: 'returning' as const, departedAt: NOW, arrivalAt: NOW + HOUR, returnAt: NOW + 2 * HOUR, oneWayDurationMs: HOUR,
    attackResolution: { reportId, resolvedAt: NOW + HOUR, debris: 0, loot: { metal: 0, minerals: 0, gas: 0, debris: 0 }, planetDestroyed: false },
  };
  state = {
    ...state,
    flights: { ...state.flights, records: [...state.flights.records, assault as never] },
    combat: { ...state.combat, reports: [...state.combat.reports, { id: reportId, winner: 'attacker' } as never] },
  };
  state = reconcileSunRaids(state, { now: NOW + HOUR, mode: 'production', timeScale: 1 }).state;
  const broken = currentSunRaidState(state).gates[0]!;
  assert.equal(broken.status, 'destroyed');
  const holderLeft = currentSunRaidState(state).crystals[`alliance:${allianceId}`] ?? [];
  const playerGot = currentSunRaidState(state).crystals[`owner:${state.profile.playerId}`] ?? [];
  assert.equal(holderLeft.length, 3, 'an alliance Gate always loses one crystal');
  assert.equal(playerGot.length, broken.destroyedBy?.outcome === 'stolen' ? 1 : 0);
  assert.ok(broken.destroyedBy?.outcome === 'stolen' || broken.destroyedBy?.outcome === 'destroyed');
});

test('Spaceport upgrades: an NPC pays for one, and on finishing the level reaches all of its planets', () => {
  const { state: initial, owners } = world();
  const ownerId = owners[0]!;
  const main = home(initial, ownerId);
  const rich = {
    ...main,
    buildings: { ...main.buildings, spaceport: 10, shipyard: 14 },
    resources: { ...main.resources, metal: 50_000_000, minerals: 50_000_000, gas: 50_000_000 },
    fleet: { ...main.fleet, ships: { ...main.fleet.ships, cruiser: 50 } },
  };
  const colony = { ...rich, id: 'planet-1-9-9', coordinate: { galaxy: 1, system: 9, position: 9 }, spaceportUpgrades: undefined };
  const levels = Object.fromEntries(Array.from({ length: 23 }, (_, index) => [index + 1, 20]));
  const candidates = getNpcSpaceportCandidates(rich, levels, 1, { cruiser: 50 });
  const cruiser = candidates.find((preview) => preview.shipId === 'cruiser');
  assert.ok(cruiser, `cruiser upgrade available: ${candidates.map((item) => item.shipId).join(', ')}`);
  const started = startNpcSpaceportUpgrade(rich, 'cruiser', levels, NOW, 1, 'npc-autonomy:upgrade');
  assert.equal(started.ok, true, started.reason ?? undefined);
  assert.equal(started.target.resources.metal, rich.resources.metal - cruiser.cost.metal);
  const finishAt = started.target.spaceportUpgrades!.shipQueue[0]!.finishAt;
  assert.equal(settleNpcSpaceport(started.target, finishAt - 1), started.target);
  const done = settleNpcSpaceport(started.target, finishAt);
  assert.equal(done.ownerProfile?.shipLevels.cruiser, (rich.ownerProfile?.shipLevels.cruiser ?? 0) + 1);
  const targets: Record<string, SpyTargetState> = { [done.id]: done, [colony.id]: colony };
  assert.equal(syncNpcOwnerShipLevels(targets, new Set([ownerId])), true);
  assert.equal(targets[colony.id]!.ownerProfile?.shipLevels.cruiser, done.ownerProfile?.shipLevels.cruiser);
});

test('transport between own planets lands the cargo in the main planet stores; what does not fit flies back', () => {
  const { state: initial, owners } = world();
  const ownerId = owners[0]!;
  const main = home(initial, ownerId);
  const capacity = getStorageCapacities(main.buildings).metal;
  const colony: SpyTargetState = {
    ...main,
    id: 'planet-1-7-7',
    coordinate: { galaxy: 1, system: 7, position: 7 },
    fleet: { ...main.fleet, ships: { ...main.fleet.ships, transporter: 40 } },
    resources: { ...main.resources, metal: capacity, gas: 200_000 },
  };
  let state = withTarget(withTarget(initial, { ...main, resources: { ...main.resources, metal: capacity - 1_000 } }), colony);
  const sent = dispatchNpcTransport(state, {
    requestId: 'npc-autonomy:transport', ownerId, originPlanetId: colony.id, destinationPlanetId: main.id,
    selectedShips: { transporter: 40 }, cargo: { metal: 5_000, minerals: 0, gas: 0, debris: 0 },
  }, NOW, 1);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  state = sent.state;
  assert.equal(state.espionage!.targets![colony.id]!.resources.metal, capacity - 5_000);
  const arrived = resolveNpcTransportArrival(state, sent.flight!, sent.flight!.arrivalAt);
  assert.equal(arrived.ok, true);
  assert.equal(arrived.state.espionage!.targets![main.id]!.resources.metal, capacity, 'the store fills to its cap');
  assert.equal(arrived.flight?.cargo?.metal, 4_000, 'the rest rides home');
  assert.equal(arrived.flight?.phase, 'returning');
});

test('an NPC short of a resource asks its alliance by the request rules; the first attempt starts its charge clock', () => {
  const { state: initial, owners } = world();
  const ownerId = owners[0]!;
  let state = leaderOf(initial, ownerId);
  const main = home(state, ownerId);
  state = withTarget(state, { ...main, buildings: { ...main.buildings, 'planetary-government': 1 }, resources: { ...main.resources, metal: 0 } });
  const profile = state.npc!.profiles[ownerId]!;
  const first = getNpcAidRequestCandidates(state, profile, NOW)[0];
  assert.ok(first);
  assert.equal(first.payload.resource, 'metal');
  const attempt = createNpcAidRequest(state, ownerId, first, NOW, 1);
  assert.equal(attempt.ok, false, 'no charge yet');
  state = attempt.state;
  // The one-time start charge takes 15 minutes once the Hall regime applies.
  const later = NOW + HOUR;
  const second = getNpcAidRequestCandidates(state, profile, later)[0];
  assert.ok(second);
  const created = createNpcAidRequest(state, ownerId, second, later, 1);
  assert.equal(created.ok, true, created.reason ?? undefined);
  assert.equal(selectOpenRequestsOf(created.state.command, ownerId).length, 1);
});

test('the planet-destroyer rush is about one NPC in twenty and its path reaches the flagship requirements', () => {
  const ids = Array.from({ length: 100 }, (_, index) => `npc-gen-${String(index).padStart(3, '0')}`);
  const npc = createNpcState(ids, 'doctrine-salt', 0);
  assert.equal(npcFlagshipOwners(npc).size, 5);
  assert.equal(npcFlagshipOwners(createNpcState(ids.slice(0, 7), 'doctrine-salt', 0)).size, 0);
  const plan = npcFlagshipPlan('aegis', {}, 1)!;
  assert.equal(plan.shipyardLevel, 14);
  assert.equal(plan.unlocked, false);
  assert.ok(plan.sciences.has(15), 'Parallel universes is on the path');
  assert.ok(plan.sciences.has(14) && plan.sciences.has(9), 'with every prerequisite of Hyperspace');
  assert.ok(plan.laboratoryLevel >= 15);
});

test('a returning NPC fleet whose manifest lists a hull type lost to zero survives a save and load', () => {
  const { state: initial, owners } = world();
  const ownerId = owners[0]!;
  const main = home(initial, ownerId);
  const colony: SpyTargetState = { ...main, id: 'planet-1-7-7', coordinate: { galaxy: 1, system: 7, position: 7 },
    fleet: { ...main.fleet, ships: { ...main.fleet.ships, transporter: 10 } }, resources: { ...main.resources, metal: 20_000, gas: 50_000 } };
  let state = withTarget(initial, colony);
  const sent = dispatchNpcTransport(state, {
    requestId: `npc-autonomy:${JSON.stringify([ownerId, 'zero-manifest'])}`, ownerId, originPlanetId: colony.id, destinationPlanetId: main.id,
    selectedShips: { transporter: 10 }, cargo: { metal: 1_000, minerals: 0, gas: 0, debris: 0 },
  }, NOW, 1);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  const arrived = resolveNpcTransportArrival(sent.state, sent.flight!, sent.flight!.arrivalAt);
  // A battle that wiped out one hull type leaves it in the manifest as zero.
  const manifest = { ...arrived.flight!, selectedShips: { transporter: 10, 'mega-transporter': 0 } };
  state = { ...arrived.state, flights: { ...arrived.state.flights, records: arrived.state.flights.records.map((item) => item.id === manifest.id ? manifest : item) } };
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: 'zero-manifest', now: () => NOW });
  assert.equal(facade.write(state).ok, true);
  const loaded = facade.read();
  const kept = loaded.flights.records.find((item) => item.id === manifest.id);
  assert.ok(kept, 'the returning fleet is not dropped');
  assert.equal(kept.phase, 'returning');
  assert.equal(kept.selectedShips.transporter, 10);
});
