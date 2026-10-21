import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultCombatTechnologies } from '../combat/technologies.ts';
import { SOLAR_CRYSTAL_IDS, SUN_RAID_CONFIG } from './config.ts';
import { migrateSunRaidState } from './repository.ts';
import {
  addCrystal,
  applyRaidVictoryToSun,
  checkGateStart,
  checkRaidLaunch,
  createDefaultSunRaidState,
  materializeSun,
  mergeSideShipLevels,
  mergeSideTechnologies,
  pickStolenCrystal,
  projectSun,
  readSun,
  rollCrystal,
  sunKey,
} from './rules.ts';
import type { SunRaidRecord } from './types.ts';

const HOUR = 60 * 60 * 1000;

test('a Sun at base 70 freezes after exactly nine won raids (70 → 25)', () => {
  let sun = readSun(createDefaultSunRaidState(), 1, 5);
  assert.equal(sun.baseEfficiency, 70);
  for (let win = 1; win <= 9; win += 1) {
    assert.equal(projectSun(sun, win * HOUR).frozen, false, `still attackable before win ${win}`);
    sun = applyRaidVictoryToSun(sun, win * HOUR, SUN_RAID_CONFIG.recoverStepMs);
    assert.equal(sun.brightness, 70 - win * 5);
  }
  const projection = projectSun(sun, 9 * HOUR);
  assert.equal(projection.brightness, 25);
  assert.equal(projection.frozen, true);
  assert.equal(sun.successfulRaids, 9);
});

test('a frozen Sun unfreezes after the first step and recovers to its own base efficiency', () => {
  const state = createDefaultSunRaidState();
  let sun = readSun(state, 1, 20);
  assert.equal(sun.baseEfficiency, 100);
  for (let win = 0; win < 15; win += 1) sun = applyRaidVictoryToSun(sun, 0, 2 * HOUR);
  assert.equal(sun.brightness, 25);
  assert.equal(projectSun(sun, 2 * HOUR - 1).frozen, true);
  assert.equal(projectSun(sun, 2 * HOUR - 1).unfreezesAt, 2 * HOUR);
  assert.equal(projectSun(sun, 2 * HOUR).brightness, 30);
  assert.equal(projectSun(sun, 2 * HOUR).frozen, false);
  // (100 - 25) / 5 = 15 steps.
  assert.equal(projectSun(sun, 15 * 2 * HOUR).brightness, 100);
  assert.equal(projectSun(sun, 15 * 2 * HOUR).recovering, false);
  assert.equal(projectSun(sun, 40 * 2 * HOUR).brightness, 100, 'never above base');
  const folded = materializeSun(sun, 15 * 2 * HOUR + 7);
  assert.equal(folded.brightness, 100);
  assert.equal(folded.recoveryStartedAt, undefined);
});

test('a raid during recovery keeps the partial step and keeps recovering', () => {
  let sun = readSun(createDefaultSunRaidState(), 1, 1);
  for (let win = 0; win < 9; win += 1) sun = applyRaidVictoryToSun(sun, 0, 2 * HOUR);
  sun = applyRaidVictoryToSun(sun, 5 * HOUR, 2 * HOUR); // 2 steps done (35) → 30, half a step kept
  assert.equal(sun.brightness, 30);
  assert.equal(sun.recoveryStartedAt, 4 * HOUR);
  assert.equal(projectSun(sun, 6 * HOUR).brightness, 35);
});

test('crystal chance is ~70% over 10 000 seeds and a crystal is never a repeat', () => {
  let hits = 0;
  for (let index = 0; index < 10_000; index += 1) {
    const roll = rollCrystal(`seed-${index}`, ['crystal-2']);
    if (roll.success) {
      hits += 1;
      assert.notEqual(roll.crystal, 'crystal-2');
    }
  }
  assert.ok(Math.abs(hits / 10_000 - 0.7) < 0.02, `rate ${hits / 10_000}`);
  assert.deepEqual(rollCrystal('same', []), rollCrystal('same', []), 'deterministic for a seed');
});

test('a holder with all four crystals gets no roll', () => {
  const roll = rollCrystal('x', SOLAR_CRYSTAL_IDS);
  assert.equal(roll.success, false);
  assert.equal(roll.skipped, 'all-owned');
});

test('a destroyed Gate hands over a crystal the destroyer lacks, or nothing', () => {
  assert.equal(pickStolenCrystal('g', ['crystal-1', 'crystal-2'], ['crystal-1']), 'crystal-2');
  assert.equal(pickStolenCrystal('g', ['crystal-1'], ['crystal-1']), null);
  const picked = pickStolenCrystal('g2', SOLAR_CRYSTAL_IDS, []);
  assert.ok(picked && SOLAR_CRYSTAL_IDS.includes(picked));
});

test('side technologies and ship levels are the maximum among participants', () => {
  const low = createDefaultCombatTechnologies();
  const high = { ...createDefaultCombatTechnologies(), laserScience: 9 };
  const merged = mergeSideTechnologies([low, high]);
  assert.equal(merged.laserScience, 9);
  assert.equal(merged.ionScience, 0);
  assert.deepEqual(mergeSideShipLevels([{ cruiser: 3, scout: 9 }, { cruiser: 7 }]), { cruiser: 7, scout: 9 });
});

test('raid launch rules: alliance leadership, population cap, frozen Sun, one raid per alliance', () => {
  const state = createDefaultSunRaidState();
  const base = { state, galaxy: 1, system: 3, population: 1_000, now: 0 };
  assert.equal(checkRaidLaunch({ ...base, allianceId: null, role: null }).ok, false);
  assert.equal(checkRaidLaunch({ ...base, allianceId: 'a', role: 'member' }).ok, false);
  assert.equal(checkRaidLaunch({ ...base, allianceId: 'a', role: 'leader' }).ok, true);
  assert.equal(checkRaidLaunch({ ...base, allianceId: 'a', role: 'deputy' }).ok, true);
  const over = checkRaidLaunch({ ...base, allianceId: 'a', role: 'leader', population: 225_001 });
  assert.equal(over.ok, false);
  assert.match(over.ok ? '' : over.message, /уберите 1\./);
  let frozenSun = readSun(state, 1, 3);
  for (let win = 0; win < 9; win += 1) frozenSun = applyRaidVictoryToSun(frozenSun, 0, HOUR);
  const frozenState = { ...state, suns: { [sunKey(1, 3)]: frozenSun } };
  assert.equal(checkRaidLaunch({ ...base, state: frozenState, allianceId: 'a', role: 'leader' }).ok, false);
  const raid: SunRaidRecord = {
    id: 'r1', galaxy: 2, system: 9, allianceId: 'a', allianceName: 'A', allianceTag: 'AA', initiatorOwnerId: 'p',
    initiatorName: 'P', launchedAt: 0, arrivesAt: 10, status: 'resolved',
    result: { winner: 'attacker', resolvedAt: 10, brightnessBefore: 70, brightnessAfter: 65, frozen: false, attackerPopulation: 1, defenderPopulation: 0, defenders: 0 },
  };
  const busy = { ...state, raids: [raid] };
  assert.equal(checkRaidLaunch({ ...base, state: busy, allianceId: 'a', role: 'leader' }).ok, false, 'fleet not back yet');
  assert.equal(checkRaidLaunch({ ...base, state: { ...busy, raids: [{ ...raid, closedAt: 20 }] }, allianceId: 'a', role: 'leader' }).ok, true);
  assert.equal(checkRaidLaunch({ ...base, state: busy, allianceId: 'b', role: 'leader' }).ok, true, 'other alliances are free');
});

test('Gate start needs four different crystals and respects the restart cooldown', () => {
  const holder = { kind: 'alliance' as const, id: 'a' };
  let state = createDefaultSunRaidState();
  assert.equal(checkGateStart({ state, holder, isLeaderOrSolo: true, now: 0 }).ok, false);
  for (const id of SOLAR_CRYSTAL_IDS) state = addCrystal(state, holder, id);
  assert.equal(checkGateStart({ state, holder, isLeaderOrSolo: false, now: 0 }).ok, false);
  assert.equal(checkGateStart({ state, holder, isLeaderOrSolo: true, now: 0 }).ok, true);
  state = { ...state, gateCooldowns: { 'alliance:a': 100 } };
  assert.equal(checkGateStart({ state, holder, isLeaderOrSolo: true, now: 50 }).ok, false);
  assert.equal(checkGateStart({ state, holder, isLeaderOrSolo: true, now: 100 }).ok, true);
});

test('Sun raid state survives a JSON round trip and rejects garbage', () => {
  let state = createDefaultSunRaidState();
  state = addCrystal(state, { kind: 'owner', id: 'p' }, 'crystal-3');
  state = { ...state, suns: { [sunKey(1, 2)]: applyRaidVictoryToSun(readSun(state, 1, 2), 5, HOUR) } };
  assert.deepEqual(migrateSunRaidState(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(migrateSunRaidState({ version: 7 }), createDefaultSunRaidState());
  const dirty = migrateSunRaidState({ ...state, crystals: { 'owner:p': ['crystal-3', 'crystal-3', 'bogus'], nonsense: ['crystal-1'] } });
  assert.deepEqual(dirty.crystals, { 'owner:p': ['crystal-3'] });
});
