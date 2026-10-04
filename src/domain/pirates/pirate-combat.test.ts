import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultCombatPriority } from '../combat/priority.ts';
import { getCombatMatchupMultiplier, resolveCombat } from '../combat/resolver.ts';
import type { CombatInput, CombatStackInput } from '../combat/simulator.ts';
import { PIRATE_BASE_SHIPS, PIRATE_CATALOG, PIRATE_CATALOG_BY_ID, pirateDoubleAttackChance } from './catalog.ts';
import { createPirateProfile } from './profile.ts';

const priority = createDefaultCombatPriority();
const profile = createPirateProfile({
  ownerId: 'pirate-combat-test',
  contactCycleKey: 'test-cycle',
  score: { totalPoints: 1_000, resourcePoints: 0, battlePoints: 1_000 },
});

function resolvePair(input: {
  attackerRace: 'aegis' | 'synod' | 'veyra' | 'pirates';
  attackerShips: CombatStackInput[];
  defenderRace: 'aegis' | 'synod' | 'veyra' | 'pirates';
  defenderShips: CombatStackInput[];
  attackerPirate?: boolean;
  defenderPirate?: boolean;
  seed?: string;
}) {
  const side = (race: typeof input.attackerRace, ships: CombatStackInput[], pirate: boolean | undefined, name: string, side: 'attacker' | 'defender') => ({
    participant: { playerId: `${name}-owner`, playerName: name, race, side },
    ...(pirate ? { combatProfile: { kind: 'pirate' as const, snapshot: profile } } : { factionId: race === 'pirates' ? undefined : race }),
    ships,
    commanders: [],
    activeCommanderId: null,
  });
  const combat: CombatInput = {
    scenarioId: 'pirate-matchup-test',
    timestamp: '2026-01-01T00:00:00.000Z',
    attacker: side(input.attackerRace, input.attackerShips, input.attackerPirate, 'Attacker', 'attacker'),
    defender: side(input.defenderRace, input.defenderShips, input.defenderPirate, 'Defender', 'defender'),
    maxRounds: 5,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
    seed: input.seed ?? 'pirate-matchup-test-seed',
  };
  return resolveCombat(combat, { reportId: `pirate-matchup-${input.seed ?? 'default'}` });
}

test('seven neutral pirate hulls map to the standard combat classes without entering the playable ship list', () => {
  assert.equal(PIRATE_CATALOG.length, 7);
  assert.equal(PIRATE_BASE_SHIPS.length, 6);
  assert.deepEqual(PIRATE_BASE_SHIPS.map((ship) => ship.ordinaryClass), [
    'scout', 'cruiser', 'defender', 'battleship', 'destroyer', 'bomber',
  ]);
  assert.equal(PIRATE_CATALOG_BY_ID['pirate-planet-breaker'].ordinaryClass, 'planet-breaker');
});

test('pirate matchups reuse the existing shared coefficients and preserve neutral Kaper damage against Raider', () => {
  assert.equal(getCombatMatchupMultiplier('defender', 'cruiser'), 1);
  assert.equal(getCombatMatchupMultiplier('cruiser', 'scout'), 1.7);
  assert.equal(getCombatMatchupMultiplier('battleship', 'cruiser'), 1.7);
  assert.equal(getCombatMatchupMultiplier('bomber', 'destroyer'), 1.7);

  const report = resolvePair({
    attackerRace: 'pirates',
    attackerPirate: true,
    attackerShips: [{ entityId: 'pirate-corsair', count: 1 }],
    defenderRace: 'pirates',
    defenderPirate: true,
    defenderShips: [{ entityId: 'pirate-raider', count: 1 }],
  });
  const attack = report.rounds.flatMap((round) => round.events).find((event) => event.actionType === 'attack' && event.actorSide === 'attacker');
  assert.equal(attack?.matchupMultiplier, 1);
});

test('each faction gets the standard class matchup against pirate ships', () => {
  for (const faction of ['aegis', 'synod', 'veyra'] as const) {
    const report = resolvePair({
      attackerRace: faction,
      attackerShips: [{ entityId: 'cruiser', count: 1 }],
      defenderRace: 'pirates',
      defenderPirate: true,
      defenderShips: [{ entityId: 'pirate-hound', count: 1 }],
      seed: `faction-${faction}`,
    });
    const attack = report.rounds.flatMap((round) => round.events).find((event) => event.actionType === 'attack' && event.actorSide === 'attacker');
    assert.equal(attack?.matchupMultiplier, 1.7, faction);
  }
});

test('Planet Breaker uses death-star target selection but receives no death-star damage multiplier', () => {
  const report = resolvePair({
    attackerRace: 'aegis',
    attackerShips: [{ entityId: 'death-star', count: 1 }],
    defenderRace: 'pirates',
    defenderPirate: true,
    defenderShips: [
      { entityId: 'pirate-hound', count: 1 },
      { entityId: 'pirate-planet-breaker', count: 1 },
    ],
    seed: 'planet-breaker-selection',
  });
  const firstAttack = report.rounds[0]?.events.find((event) => event.actionType === 'attack' && event.actorSide === 'attacker');
  assert.equal(firstAttack?.targetEntityId, 'pirate-planet-breaker');
  assert.equal(firstAttack?.matchupMultiplier, 1);
  assert.equal(firstAttack?.matchupStatus, 'not-calibrated');
});

test('Potroshitel grants a single fleet roll per round, scaled by living count and capped at 5%', () => {
  assert.equal(pirateDoubleAttackChance(0), 0);
  assert.equal(pirateDoubleAttackChance(1), 0.005);
  assert.equal(pirateDoubleAttackChance(10), 0.05);
  assert.equal(pirateDoubleAttackChance(100), 0.05);
});
