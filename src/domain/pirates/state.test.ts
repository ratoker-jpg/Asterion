import assert from 'node:assert/strict';
import test from 'node:test';
import { pirateContactCycleKey } from './contact-rules.ts';
import { createPirateProfile } from './profile.ts';
import { createDefaultPirateOperationsState, migratePirateOperationsState } from './state.ts';

function cycle(cycleIndex: number) {
  const coordinate = { galaxy: 1, system: 7, position: 12 };
  const cycleKey = pirateContactCycleKey(coordinate.galaxy, coordinate.system, cycleIndex);
  const profile = createPirateProfile({
    ownerId: 'player-aster',
    contactCycleKey: cycleKey,
    score: { resourcePoints: 25_000, battlePoints: 2_000, totalPoints: 27_000 },
  });
  return {
    cycleKey,
    cycleIndex,
    coordinate,
    startedAt: 1_000 * cycleIndex,
    expiresAt: 1_000 * cycleIndex + 60_000,
    respawnAt: 1_000 * cycleIndex + 75_000,
    defeatedAt: 1_000 * cycleIndex + 30_000,
    ownersById: {
      'player-aster': {
        profile,
        raidRoll: {
          checkedAt: 1_000 * cycleIndex + 15_000,
          seed: `owner-roll|${cycleKey}`,
          success: true,
          targetPlanetId: 'helion-01',
          flightRequestId: `pirate-raid:${cycleKey}:player-aster`,
          flightId: `flight:${cycleKey}`,
        },
        recon: {
          cooldownUntil: 1_000 * cycleIndex + 121_000,
          inFlight: {
            requestId: `pirate-recon:${cycleKey}:player-aster`,
            flightId: `spy:${cycleKey}`,
            dispatchedAt: 1_000 * cycleIndex,
          },
          reports: [
            {
              id: `recon-full:${cycleKey}`,
              ownerId: 'player-aster',
              contactCycleKey: cycleKey,
              createdAt: 1_000 * cycleIndex + 500,
              roll: 23,
              fullReport: true,
              profile,
            },
            {
              id: `recon-partial:${cycleKey}`,
              ownerId: 'player-aster',
              contactCycleKey: cycleKey,
              createdAt: 1_000 * cycleIndex + 750,
              roll: 80,
              fullReport: false,
            },
          ],
        },
      },
    },
  };
}

test('old, malformed, and unknown-version pirate state migrates to an empty v1 ledger', () => {
  assert.deepEqual(migratePirateOperationsState(undefined), createDefaultPirateOperationsState());
  assert.deepEqual(migratePirateOperationsState({ version: 0, cyclesByKey: {}, scheduleOverridesBySystem: {} }), createDefaultPirateOperationsState());
  assert.deepEqual(migratePirateOperationsState({ version: 1, cyclesByKey: [] }), createDefaultPirateOperationsState());
});

test('v1 migration keeps current cycles and validates owner snapshots and schedule overrides', () => {
  const older = cycle(2);
  const current = cycle(3);
  const currentKey = current.cycleKey;
  const migrated = migratePirateOperationsState({
    version: 1,
    cyclesByKey: {
      [older.cycleKey]: older,
      [currentKey]: current,
      'pirate-contact:v1:1:7:4': { ...cycle(4), coordinate: { galaxy: -1, system: 7, position: 12 } },
    },
    scheduleOverridesBySystem: {
      '1:7': {
        galaxy: 1,
        system: 7,
        defeatedCycleIndex: 3,
        defeatedAt: 3_030,
        nextCycleIndex: 4,
        nextStartAt: 3_930,
        nextSpawnChance: 0.9,
      },
      '1:8': {
        galaxy: 1,
        system: 7,
        defeatedCycleIndex: 3,
        defeatedAt: 3_030,
        nextCycleIndex: 4,
        nextStartAt: 3_930,
        nextSpawnChance: 0.9,
      },
    },
  });

  assert.deepEqual(Object.keys(migrated.cyclesByKey), [currentKey]);
  const savedOwner = migrated.cyclesByKey[currentKey]!.ownersById['player-aster']!;
  assert.equal(savedOwner.profile?.contactCycleKey, currentKey);
  assert.equal(savedOwner.raidRoll?.flightRequestId, `pirate-raid:${currentKey}:player-aster`);
  assert.equal(savedOwner.recon?.inFlight?.flightId, `spy:${currentKey}`);
  assert.equal(savedOwner.recon?.reports.length, 2);
  assert.deepEqual(Object.keys(migrated.scheduleOverridesBySystem), ['1:7']);
});

test('malformed profile data is not trusted or retained as an owner profile', () => {
  const saved = cycle(5);
  const owner = saved.ownersById['player-aster']!;
  const invalidProfile = { ...owner.profile!, shipLevel: 99 };
  const migrated = migratePirateOperationsState({
    version: 1,
    cyclesByKey: {
      [saved.cycleKey]: {
        ...saved,
        ownersById: { 'player-aster': { profile: invalidProfile } },
      },
    },
    scheduleOverridesBySystem: {},
  });
  assert.deepEqual(migrated.cyclesByKey[saved.cycleKey]?.ownersById, {});
});
