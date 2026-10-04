import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultCombatPriority } from './priority.ts';
import { resolveCombat } from './resolver.ts';
import { resolvePlanetSiege } from './planet-siege.ts';
import { createPirateProfile } from '../pirates/profile.ts';
import type { CombatInput } from './simulator.ts';

const priorities = createDefaultCombatPriority();
const profile = createPirateProfile({ ownerId: 'target-owner', contactCycleKey: 'cycle-a', score: { resourcePoints: 3_000_000, battlePoints: 0, totalPoints: 3_000_000 } });
function raidInput(defenderCount = 1): CombatInput {
  return {
    scenarioId: 'pirate-siege', timestamp: '2026-10-04T00:00:00.000Z',
    attacker: { participant: { playerId: 'npc', playerName: 'Пираты', race: 'pirates', side: 'attacker' }, combatProfile: { kind: 'pirate', snapshot: profile }, ships: [{ entityId: 'pirate-planet-breaker', count: 1 }], commanders: [] },
    defender: { participant: { playerId: 'owner', playerName: 'Владелец', race: 'aegis', side: 'defender' }, factionId: 'aegis', ships: [{ entityId: 'scout', count: defenderCount }], commanders: [], defenses: [] },
    maxRounds: 5, attackerPriority: [...priorities.attack], defenderPriority: [...priorities.defense], seed: 'siege-seed',
  };
}
const target = { id: 'planet-1', name: 'Цель', coordinate: { galaxy: 1, system: 2, position: 3 }, buildings: { mine: 1 } };
function context(totalPoints: number) {
  return { seed: 'siege-seed', reportId: 'pirate-siege', attackerFleetId: 'npc-raid', attackerFactionId: 'aegis' as const, defenderFactionId: 'aegis' as const, targetOwnerPlanetCount: 2, targetOwnerTotalPoints: totalPoints };
}

test('pirate planet breaker has strict incoming-raid score and target-population gates', () => {
  const report = resolveCombat(raidInput(), { reportId: 'pirate-siege', missionType: 'pirate-raid' });
  const eligible = resolvePlanetSiege(report, target, context(3_000_001));
  assert.equal(eligible.report.attackerDestroyers[0]?.entityId, 'pirate-planet-breaker');
  assert.equal(eligible.report.attackerDestroyers[0]?.scaledDestructionChanceBps, 1_500);
  assert.equal(eligible.report.destruction.rawChanceBps, 1_500);
  assert.equal(resolvePlanetSiege(report, target, context(3_000_000)).report.attackerDestroyers.length, 0);

  const largeTarget = resolveCombat(raidInput(1_000), { reportId: 'pirate-siege-large', missionType: 'pirate-raid' });
  assert.ok(largeTarget.defenderForce.populationBefore >= 2_000);
  assert.equal(resolvePlanetSiege(largeTarget, target, context(3_000_001)).report.attackerDestroyers.length, 0);
});
