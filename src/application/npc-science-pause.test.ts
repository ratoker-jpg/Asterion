import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { calculatePlanetCapacity, calculatePlanetPopulation, OVERPOPULATION_WINDOW_MS } from '../domain/fleet/overpopulation.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import type { ScienceState } from '../domain/science/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { SaveState } from './contracts.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { getNpcScienceCandidates, pauseNpcScienceForSettlement, reconcileNpcScienceAt, startNpcScience } from './npc-science.ts';
import { settleNpcPlanet } from './npc-economy.ts';

const START = Date.UTC(2026, 9, 20, 12);
const MINUTE = 60_000;

function campaign(seed = 'npc-science-pause-test'): SaveState {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'NPC Science Pause QA' });
  const setup = { ...base, world: { ...base.world, galaxyCount: 1, npcCount: 1, maxNpcPerSystem: 2 as const,
    randomPlayerStart: false, campaignSpeed: 'standard' as const } };
  const state = createInitialSaveState('production', START, setup);
  return {
    ...state,
    npc: createNpcState(Object.keys(state.npc!.profiles), `npc-science-pause-v1:${seed}`, START),
    asteroidSimulation: undefined,
  };
}

function npcTarget(state: SaveState): SpyTargetState {
  const target = Object.values(state.espionage?.targets ?? {}).find((item) => item.kind === 'npc'
    && item.ownerId !== state.profile.playerId)!;
  assert.ok(target);
  return readyPlanet(target);
}

function readyPlanet(target: SpyTargetState): SpyTargetState {
  return {
    ...target,
    buildings: { ...target.buildings, research: Math.max(1, target.buildings.research ?? 0) },
    resources: { ...target.resources, metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000,
      developmentEnergy: 1_000_000 },
    resourceClock: { lastReconciledAt: START, remainder: { metal: 0, minerals: 0, gas: 0 } },
  };
}

function withTarget(state: SaveState, target: SpyTargetState): SaveState {
  assert.ok(state.espionage);
  return { ...state, espionage: { ...state.espionage, targets: { ...state.espionage.targets, [target.id]: target } } };
}

function withScience(state: SaveState, ownerId: string, science: ScienceState): SaveState {
  assert.ok(state.npcScience);
  return { ...state, npcScience: { ...state.npcScience, owners: { ...state.npcScience.owners, [ownerId]: science } } };
}

function overpopulatedAt(target: SpyTargetState, at: number): SpyTargetState {
  const fleet = createEmptyFleetState();
  const capacity = calculatePlanetCapacity(target.buildings.hangar ?? 0);
  while (calculatePlanetPopulation(fleet, 0, target.raceId) <= capacity) fleet.ships.scout += 1;
  return settleNpcPlanet({ ...target, fleet }, at, { timeScale: 1 }).target;
}

function overpopulatedByUnburnableCommandersAt(target: SpyTargetState, at: number): SpyTargetState {
  const fleet = createEmptyFleetState();
  const capacity = calculatePlanetCapacity(target.buildings.hangar ?? 0);
  while (calculatePlanetPopulation(fleet, 0, target.raceId) <= capacity) fleet.commanders.corsair += 1;
  const result = settleNpcPlanet({ ...target, fleet }, at, { timeScale: 1 }).target;
  assert.equal(result.overpopulation?.blocked, true);
  assert.equal(result.overpopulation?.lastResolutionReason, 'no-eligible-units');
  return result;
}

/** Applies the same economy-settle, science-pause, then science-reconcile order as runtime. */
function settleAndReconcileOwner(state: SaveState, ownerId: string, at: number) {
  assert.ok(state.espionage?.targets);
  const before = state.espionage.targets;
  const targets = { ...before };
  for (const [id, target] of Object.entries(before)) {
    if (target.ownerId !== ownerId) continue;
    targets[id] = settleNpcPlanet(target, at, { timeScale: 1 }).target;
  }
  const settledOwners = new Set([ownerId]);
  const ledger = pauseNpcScienceForSettlement(state.npcScience, before, settledOwners, at, targets);
  const settled = {
    ...state,
    ...(ledger ? { npcScience: ledger } : {}),
    espionage: { ...state.espionage, targets },
  };
  return reconcileNpcScienceAt(settled, at);
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

test('started NPC research pauses once across irregular settlements and reload, then resumes at its shifted finish', () => {
  let state = campaign();
  const target = npcTarget(state);
  const ownerId = target.ownerId;
  const science = state.npcScience!.owners[ownerId]!;
  const started = startNpcScience(target, science, 1, START, 0.01, 'pause-research-once');
  assert.equal(started.ok, true);
  const task = started.science.queue[0]!;
  assert.ok(task.finishAt > START + OVERPOPULATION_WINDOW_MS);
  const blocked = overpopulatedAt(started.target, START);
  assert.equal(blocked.overpopulation?.blocked, true);
  state = withTarget(withScience(state, ownerId, started.science), blocked);

  const first = settleAndReconcileOwner(state, ownerId, START + 2 * MINUTE);
  state = first.state;
  assert.equal(state.npcScience!.owners[ownerId]!.queue[0]!.finishAt, task.finishAt + 2 * MINUTE);
  assert.equal(first.completed.length, 0);

  const second = settleAndReconcileOwner(state, ownerId, START + 7 * MINUTE);
  state = second.state;
  assert.equal(state.npcScience!.owners[ownerId]!.queue[0]!.finishAt, task.finishAt + 7 * MINUTE);
  assert.equal(second.completed.length, 0);

  let persistedNow = START + 7 * MINUTE;
  const facade = createPersistenceFacade({ mode: 'production', storage: memoryStorage(),
    saveKey: 'npc-science-pause-reload', now: () => persistedNow });
  assert.equal(facade.write(state).ok, true);
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded');
  state = loaded.state;

  const unlock = settleAndReconcileOwner(state, ownerId, START + OVERPOPULATION_WINDOW_MS);
  state = unlock.state;
  const releasedTarget = state.espionage!.targets?.[blocked.id]!;
  assert.equal(releasedTarget.overpopulation?.blocked ?? false, false);
  assert.equal(state.npcScience!.owners[ownerId]!.queue[0]!.finishAt, task.finishAt + OVERPOPULATION_WINDOW_MS);
  assert.equal(unlock.completed.length, 0);

  persistedNow = task.finishAt + OVERPOPULATION_WINDOW_MS;
  const completed = settleAndReconcileOwner(state, ownerId, persistedNow);
  assert.equal(completed.state.npcScience!.owners[ownerId]!.queue.length, 0);
  assert.equal(completed.state.npcScience!.owners[ownerId]!.levels[1], 1);
  assert.deepEqual(completed.completed.map(({ at }) => at), [persistedNow]);
});

test('a task already due before the overpopulation lock still completes at its original finish', () => {
  const initial = campaign('npc-science-due-before-lock');
  const target = npcTarget(initial);
  const ownerId = target.ownerId;
  const started = startNpcScience(target, initial.npcScience!.owners[ownerId]!, 1, START, 1, 'due-before-lock');
  assert.equal(started.ok, true);
  const task = started.science.queue[0]!;
  const lockAt = task.finishAt + 1;
  const blocked = overpopulatedAt(started.target, lockAt);
  assert.equal(blocked.overpopulation?.episodeStartedAt, lockAt);
  const state = withTarget(withScience(initial, ownerId, started.science), blocked);

  const result = reconcileNpcScienceAt(state, lockAt);

  assert.deepEqual(result.completed.map(({ at }) => at), [task.finishAt]);
  assert.equal(result.state.npcScience!.owners[ownerId]!.levels[1], 1);
  assert.equal(result.state.npcScience!.owners[ownerId]!.queue.length, 0);
});

test('only FIFO work paid by the blocked planet shifts when another owner planet is not blocked', () => {
  const initial = campaign('npc-science-two-payers');
  const payer = npcTarget(initial);
  const ownerId = payer.ownerId;
  const secondPlanet: SpyTargetState = {
    ...payer,
    id: `${payer.id}-second-colony`,
    coordinate: { ...payer.coordinate, position: payer.coordinate.position + 1 },
  };
  const ownerScience = initial.npcScience!.owners[ownerId]!;
  const first = startNpcScience(payer, ownerScience, 1, START, 2, 'nonblocked-payer-task');
  assert.equal(first.ok, true);
  const second = startNpcScience(secondPlanet, first.science, 1, START, 2, 'blocked-payer-task');
  assert.equal(second.ok, true);
  const unblockedTarget = first.target;
  const blockedTarget = overpopulatedAt(second.target, START);
  assert.equal(blockedTarget.overpopulation?.blocked, true);
  const state = withTarget(withTarget(withScience(initial, ownerId, second.science), unblockedTarget), blockedTarget);
  const [firstTask, secondTask] = second.science.queue;
  assert.ok(firstTask && secondTask);

  const result = settleAndReconcileOwner(state, ownerId, START + 3 * MINUTE);
  const queue = result.state.npcScience!.owners[ownerId]!.queue;
  const blockedElapsed = START + 3 * MINUTE - secondTask.startedAt;

  assert.deepEqual(result.completed.map(({ at }) => at), [firstTask.finishAt],
    'nonblocked payer work completes at its original due time');
  assert.ok(blockedElapsed > 0, 'the blocked payer task has started before this settlement');
  assert.equal(queue[0]!.id, secondTask.id);
  assert.equal(queue[0]!.startedAt, secondTask.startedAt + blockedElapsed);
  assert.equal(queue[0]!.finishAt, secondTask.finishAt + blockedElapsed,
    'the blocked payer pauses only its FIFO suffix for the elapsed lock interval');
});

test('research remains paused past the nominal burn window until an unburnable lock actually clears', () => {
  const initial = campaign('npc-science-persistent-lock');
  const target = {
    ...npcTarget(initial),
    resourceClock: { lastReconciledAt: 0, remainder: { metal: 0, minerals: 0, gas: 0 } },
  };
  const ownerId = target.ownerId;
  const science = initial.npcScience!.owners[ownerId]!;
  const preview = getNpcScienceCandidates(target, science, 0, 1).find(({ scienceId }) => scienceId === 1)!;
  assert.ok(preview.canStart);
  const started = startNpcScience(target, science, 1, 0, preview.durationMs / 500_000, 'persistent-lock-task');
  assert.equal(started.ok, true);
  const task = started.science.queue[0]!;
  assert.equal(task.startedAt, 0);
  assert.equal(task.finishAt, 500_000);

  const blocked = overpopulatedByUnburnableCommandersAt(started.target, 100_000);
  const state = withTarget(withScience(initial, ownerId, started.science), blocked);
  const burnEnd = 100_000 + OVERPOPULATION_WINDOW_MS;

  const atBurnEnd = settleAndReconcileOwner(state, ownerId, burnEnd);
  assert.equal(atBurnEnd.state.espionage!.targets?.[blocked.id]?.overpopulation?.blocked, true);
  assert.equal(atBurnEnd.state.npcScience!.owners[ownerId]!.queue[0]!.finishAt, 1_100_000,
    'the first locked interval shifts the original 500,000 finish by 600,000');
  assert.equal(atBurnEnd.state.npcScience!.owners[ownerId]!.levels[1] ?? 0, 0);

  const stillLocked = settleAndReconcileOwner(atBurnEnd.state, ownerId, 1_200_000);
  assert.equal(stillLocked.state.espionage!.targets?.[blocked.id]?.overpopulation?.blocked, true);
  assert.equal(stillLocked.state.npcScience!.owners[ownerId]!.queue[0]!.finishAt, 1_600_000,
    'the persistent lock adds the further 500,000 elapsed after the nominal burn window');
  assert.equal(stillLocked.state.npcScience!.owners[ownerId]!.levels[1] ?? 0, 0,
    'an overdue task must not complete while its payer remains locked');
  assert.equal(stillLocked.completed.length, 0);

  const payerBeforeUnlock = stillLocked.state.espionage!.targets[blocked.id]!;
  const battleLosses = { ...payerBeforeUnlock, fleet: createEmptyFleetState() };
  const unlockInput = withTarget(stillLocked.state, battleLosses);
  const unlocked = settleAndReconcileOwner(unlockInput, ownerId, 1_300_000);
  assert.equal(unlocked.state.espionage!.targets?.[blocked.id]?.overpopulation?.blocked ?? false, false);
  assert.equal(unlocked.state.npcScience!.owners[ownerId]!.queue[0]!.finishAt, 1_700_000,
    'the last 100,000 milliseconds of a persistent lock count through its actual unlock');
  assert.equal(unlocked.completed.length, 0);

  const completion = settleAndReconcileOwner(unlocked.state, ownerId, 1_700_000);
  assert.deepEqual(completion.completed.map(({ at }) => at), [1_700_000]);
  assert.equal(completion.state.npcScience!.owners[ownerId]!.levels[1], 1);
  assert.equal(completion.state.npcScience!.owners[ownerId]!.queue.length, 0);
});
