import assert from 'node:assert/strict';
import test from 'node:test';

import { combatInputPopulation } from '../combat/resolver.ts';
import type { CombatInput } from '../combat/simulator.ts';
import { PIRATE_CATALOG_BY_ID } from './catalog.ts';
import { createPirateProfile } from './profile.ts';

const profile = createPirateProfile({
  ownerId: 'population-test-owner',
  contactCycleKey: 'population-test-cycle',
  score: { resourcePoints: 1_000, battlePoints: 0, totalPoints: 1_000 },
});

function makeInput(attacker: CombatInput['attacker']): CombatInput {
  return {
    scenarioId: 'pirate-population-test',
    timestamp: '2026-01-01T00:00:00.000Z',
    attacker,
    defender: {
      participant: { playerName: 'Defender', race: 'Aegis', side: 'defender' },
      ships: [],
    },
    maxRounds: 12,
    attackerPriority: [],
    defenderPriority: [],
  };
}

test('combatInputPopulation uses the explicit pirate profile for pirate stack population', () => {
  const pirateShipId = 'pirate-hound';
  const count = 7;
  const population = combatInputPopulation(makeInput({
    participant: { playerName: 'Pirates', race: 'pirate', side: 'attacker' },
    combatProfile: { kind: 'pirate', snapshot: profile },
    ships: [{ entityId: pirateShipId, count }],
  }));

  assert.equal(population.attacker, count * PIRATE_CATALOG_BY_ID[pirateShipId].population);
});

test('combatInputPopulation rejects an unresolved non-pirate race instead of using Aegis', () => {
  assert.throws(
    () => combatInputPopulation(makeInput({
      participant: { playerName: 'Unknown faction', race: 'unresolved-race', side: 'attacker' },
      ships: [{ entityId: 'scout', count: 1 }],
    })),
    /unknown|unresolved|faction|race/i,
  );
});
