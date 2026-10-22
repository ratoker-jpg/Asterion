import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSaveState } from './persistence.ts';
import { reconcileRuntime } from './reconcile.ts';
import {
  freezeNpcCatchupTarget,
  getReplayNpcOwnerIds,
  isNpcCatchupPending,
  needsNpcCatchupBefore,
  NPC_CATCHUP_COMMAND_GRACE_MS,
} from './npc-catchup.ts';
import { resolveDuePirateRoll, selectDuePirateRolls, type PirateRollWriteScope } from './pirate-raids.ts';
import { selectOwnerScore, selectOwnerScores } from '../domain/rating/scoring.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { createNpcState } from '../domain/npc/state.ts';
import type { SaveState } from './contracts.ts';

const START = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;

function world(npcCount = 6): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'NPCPERFTEST', campaignName: 'perf contracts' });
  config.world = { ...config.world, galaxyCount: 1, npcCount, randomPlayerStart: false };
  const base = createInitialSaveState('production', START, config);
  // Fixed persona salt; fresh campaigns draw it from crypto entropy.
  return { ...base, npc: createNpcState(getReplayNpcOwnerIds(base), 'npc-perf-test-salt', START) };
}

function catchUp(state: SaveState, now: number): SaveState {
  let current = state;
  do {
    current = reconcileRuntime(current, { planetId: current.currentPlanetId, now, mode: 'production', testTimeScale: 1 }).state;
  } while (isNpcCatchupPending(current));
  return current;
}

test('command gate reads replay metadata only and freezes the target reconcileRuntime would choose', () => {
  const state = world();
  assert.ok(getReplayNpcOwnerIds(state).length > 0);
  assert.equal(needsNpcCatchupBefore(state, START + NPC_CATCHUP_COMMAND_GRACE_MS), false, 'within the clock grace');
  const later = START + 6 * HOUR + 123;
  assert.equal(needsNpcCatchupBefore(state, later), true, 'a loaded save with an unreconciled gap refuses commands');

  const frozen = freezeNpcCatchupTarget(state, later);
  assert.equal(frozen.npcReplay?.targetAt, later);
  assert.equal(frozen.npcReplay?.processedThroughAt, START, 'freezing runs no replay');
  assert.equal(isNpcCatchupPending(frozen), true);
  assert.equal(freezeNpcCatchupTarget(frozen, later + HOUR), frozen, 'a pending target never moves');

  // Freezing at the click is the same catch-up the next clock tick would run.
  assert.deepEqual(catchUp(frozen, later + 5_000), catchUp(state, later));

  const withoutNpcs = { ...state, npc: createNpcState([], 'npc-perf-test-salt', START) };
  assert.equal(needsNpcCatchupBefore(withoutNpcs, later), false, 'no registered NPC replay, nothing to wait for');
});

test('one-owner score equals the all-owner selection for every owner', () => {
  const state = catchUp(world(), START + 12 * HOUR);
  const all = selectOwnerScores(state);
  assert.ok(Object.keys(all).length > 2);
  for (const [ownerId, score] of Object.entries(all)) assert.deepEqual(selectOwnerScore(state, ownerId), score, ownerId);
  assert.equal(selectOwnerScore(state, 'no-such-owner'), undefined);
});

test('rolls written through one pass scope equal per-roll copies and never touch the input ledger', () => {
  const state = catchUp(world(), START + 2 * HOUR);
  const rolls = selectDuePirateRolls(state, START + 2 * HOUR, START + 30 * HOUR, 'production');
  assert.ok(rolls.length > 3, 'fixture must have several pirate rolls');
  const inputLedger = state.pirate?.raidRolls;
  const inputSnapshot = JSON.stringify(inputLedger);
  let copied = state;
  let scoped = state;
  const scope: PirateRollWriteScope = {};
  for (const roll of rolls) {
    copied = resolveDuePirateRoll(copied, roll, 'production');
    scoped = resolveDuePirateRoll(scoped, roll, 'production', undefined, scope);
  }
  assert.equal(JSON.stringify(scoped), JSON.stringify(copied));
  assert.equal(JSON.stringify(inputLedger), inputSnapshot);
  assert.equal(state.pirate?.raidRolls, inputLedger);
});
