import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPirateContactDefeatsToSchedules,
  createDefaultPirateContactState,
  createPirateContactCycleKey,
  getOrCreatePirateOwnerProfile,
  getPirateOwnerProfile,
  migratePirateContactState,
  PIRATE_CONTACT_QUIET_MS,
  recordPirateContactDefeat,
  validatePirateContactState,
} from './contact.ts';

import { getPirateRaidCheckProgress, PIRATE_RAID_CHECK_INTERVAL_MS } from './contact-schedule.ts';

const coordinate = { galaxy: 1, system: 2, position: 7 } as const;

test('pirate cycle key includes the authoritative schedule identity', () => {
  const first = createPirateContactCycleKey({ galaxy: 1, system: 2, cycleIndex: 3, startAt: 100_000 });
  assert.equal(first, 'pirate-cycle-v1:1:2:3:100000');
  assert.notEqual(first, createPirateContactCycleKey({ galaxy: 1, system: 2, cycleIndex: 4, startAt: 100_000 }));
  assert.notEqual(first, createPirateContactCycleKey({ galaxy: 1, system: 2, cycleIndex: 3, startAt: 100_001 }));
});

test('owner profiles freeze on first contact and remain independent across owners', () => {
  const key = createPirateContactCycleKey({ galaxy: 1, system: 2, cycleIndex: 3, startAt: 100_000 });
  const score = { resourcePoints: 10_000, battlePoints: 5_000, totalPoints: 15_000 };
  const first = getOrCreatePirateOwnerProfile(createDefaultPirateContactState(), { ownerId: 'owner-a', contactCycleKey: key, score });
  const secondScore = { resourcePoints: 1_000_000, battlePoints: 0, totalPoints: 1_000_000 };
  const repeated = getOrCreatePirateOwnerProfile(first.state, { ownerId: 'owner-a', contactCycleKey: key, score: secondScore });
  const otherOwner = getOrCreatePirateOwnerProfile(repeated.state, { ownerId: 'owner-b', contactCycleKey: key, score: secondScore });

  assert.equal(repeated.profile, first.profile);
  assert.equal(repeated.profile.score.resourcePoints, 10_000);
  assert.equal(getPirateOwnerProfile(otherOwner.state, 'owner-b', key)?.score.resourcePoints, 1_000_000);
  assert.notEqual(getPirateOwnerProfile(otherOwner.state, 'owner-a', key), getPirateOwnerProfile(otherOwner.state, 'owner-b', key));
  assert.equal(validatePirateContactState(otherOwner.state).valid, true);
});

test('global defeat shortens the quiet interval from victory and advances the cycle schedule', () => {
  const schedules = [
    { cycleIndex: 0, startAt: 0, expiresAt: 60_000, respawnAt: 960_000, lifetimeMs: 60_000, spawnChance: 0.9, present: true },
    { cycleIndex: 1, startAt: 960_000, expiresAt: 1_020_000, respawnAt: 1_920_000, lifetimeMs: 60_000, spawnChance: 0.9, present: true },
    { cycleIndex: 2, startAt: 1_920_000, expiresAt: 1_980_000, respawnAt: 2_880_000, lifetimeMs: 60_000, spawnChance: 0.9, present: true },
  ] as const;
  const firstKey = createPirateContactCycleKey({ galaxy: 1, system: 2, cycleIndex: 0, startAt: 0 });
  const state = recordPirateContactDefeat(createDefaultPirateContactState(), {
    contactCycleKey: firstKey,
    galaxy: 1,
    system: 2,
    cycleIndex: 0,
    startAt: 0,
    coordinate,
    defeatedAt: 40_000,
  });
  const winner = Object.values(state.defeatedCycles)[0]!;
  const conflictingButWellFormed = {
    ...winner,
    contactCycleKey: createPirateContactCycleKey({ galaxy: 1, system: 2, cycleIndex: 0, startAt: 1 }),
    startAt: 1,
    defeatedAt: 30_000,
    nextEligibleAt: 30_000 + PIRATE_CONTACT_QUIET_MS,
  };
  const defeats = [winner, conflictingButWellFormed];
  const projected = applyPirateContactDefeatsToSchedules(schedules, 1, 2, defeats);
  const reverseProjected = applyPirateContactDefeatsToSchedules(schedules, 1, 2, [...defeats].reverse());

  assert.equal(state.defeatedCycles[firstKey]?.nextEligibleAt, 40_000 + PIRATE_CONTACT_QUIET_MS);
  assert.equal(projected[0]?.expiresAt, 40_000);
  assert.deepEqual(reverseProjected, projected);
  assert.equal(projected[1]?.startAt, 40_000 + PIRATE_CONTACT_QUIET_MS);
  assert.equal(projected[1]?.lifetimeMs, schedules[1].lifetimeMs);
  assert.equal(projected[1]?.spawnChance, schedules[1].spawnChance);
  assert.equal(projected[2]?.startAt, projected[1]!.respawnAt);
});

test('defeat recording is idempotent and malformed persisted pirate entries migrate away safely', () => {
  const first = recordPirateContactDefeat(createDefaultPirateContactState(), {
    contactCycleKey: 'pirate-cycle-v1:1:2:3:100000',
    galaxy: 1,
    system: 2,
    cycleIndex: 3,
    startAt: 100_000,
    coordinate,
    defeatedAt: 120_000,
  });
  assert.equal(recordPirateContactDefeat(first, {
    contactCycleKey: 'pirate-cycle-v1:1:2:3:100000',
    galaxy: 1,
    system: 2,
    cycleIndex: 3,
    startAt: 100_000,
    coordinate,
    defeatedAt: 120_000,
  }), first);

  const broken = {
    version: 1,
    defeatedCycles: { 'pirate-cycle-v1:1:2:3:100000': { ...first.defeatedCycles['pirate-cycle-v1:1:2:3:100000'], coordinate: { galaxy: 1, system: -2, position: 7 } } },
    ownerProfiles: { '': { broken: { ownerId: '', contactCycleKey: 'broken' } } },
  };
  assert.equal(validatePirateContactState(broken).valid, false);
  assert.deepEqual(migratePirateContactState(broken), createDefaultPirateContactState());
  assert.deepEqual(migratePirateContactState(undefined), createDefaultPirateContactState());
});

test('raid-check UI period is exactly 15 minutes and independent of base lifetime', () => {
  const start = 100_000;
  const first = getPirateRaidCheckProgress(start, start);
  assert.equal(PIRATE_RAID_CHECK_INTERVAL_MS, 900_000);
  assert.equal(first.remainingMs, 900_000);
  assert.equal(first.percent, 0);
  const halfway = getPirateRaidCheckProgress(start, start + 450_000);
  assert.equal(halfway.remainingMs, 450_000);
  assert.equal(halfway.percent, 50);
  const second = getPirateRaidCheckProgress(start, start + 900_000);
  assert.equal(second.remainingMs, 0);
  assert.equal(second.nextAt, start + 900_000);
  assert.equal(second.percent, 100);
  const later = getPirateRaidCheckProgress(start, start + 4_500_000);
  assert.equal(later.remainingMs, 0);
  assert.equal(later.percent, 100);
  const accelerated = getPirateRaidCheckProgress(start, start + 1_800, 1_800);
  assert.equal(accelerated.remainingMs, 0);
  assert.equal(accelerated.percent, 100);
});
