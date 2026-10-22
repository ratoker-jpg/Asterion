import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getNpcSessionEvents } from '../domain/npc/calendar.ts';
import { CAMPAIGN_SPEED_SCALE } from '../domain/runtime/mode.ts';
import { getNpcBuildingCandidates, settleNpcPlanet, startNpcBuilding } from './npc-economy.ts';
import { isNpcCatchupPending } from './npc-catchup.ts';
import { reconcileRuntime, type RuntimeReconcileEvent } from './reconcile.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import type { SaveState } from './contracts.ts';
import { generateNpcReplayEvents, type NpcReplayEmission } from './npc-replay.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';

const START = Date.UTC(2026, 9, 20, 12);
const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

function campaign(npcCount: number, seed = `NPC-RUNTIME-${npcCount}`, campaignSpeed: 'slow' | 'standard' | 'fast' = 'standard') {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'NPC QA' });
  const setup = { ...base, world: { ...base.world, galaxyCount: npcCount > 80 ? 2 : base.world.galaxyCount, npcCount, campaignSpeed } };
  const state = createInitialSaveState('production', START, setup);
  return {
    ...state,
    asteroidSimulation: undefined,
    // Keep old independent calendars inert for this isolated foundation replay.
    exploration: { ...state.exploration!, npcProcessedAt: START + 30 * DAY },
    pirate: { ...state.pirate!, raidProcessedAt: START + 30 * DAY },
  } satisfies SaveState;
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function npcTargets(state: SaveState): SpyTargetState[] {
  return Object.values(state.espionage?.targets ?? {})
    .filter((target) => target.kind === 'npc' && target.ownerId !== state.profile.playerId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

type NpcEmission =
  | { kind: 'npc-economy'; event: NpcReplayEmission }
  | Extract<RuntimeReconcileEvent, { kind: 'npc-building' }>;

function keepNpcEvents(events: readonly RuntimeReconcileEvent[]): NpcEmission[] {
  const output: NpcEmission[] = [];
  for (const event of events) {
    if (event.kind === 'npc-economy') {
      for (const emission of event.events) output.push({ kind: event.kind, event: emission });
    } else if (event.kind === 'npc-building') output.push(event);
  }
  return output;
}

function advanceTo(
  initial: SaveState,
  targetAt: number,
  steps: readonly number[],
  options: { reloadAfterEachStep?: boolean } = {},
): { state: SaveState; emissions: NpcEmission[] } {
  let state = initial;
  let emitted: NpcEmission[] = [];
  const storage = memoryStorage();
  const saveKey = 'asterion.npc-runtime.integration.v1';
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey, now: () => targetAt });

  for (const requestedAt of steps) {
    const requestedTarget = Math.min(targetAt, requestedAt);
    let guard = 0;
    while (true) {
      const before = state.npcReplay?.processedThroughAt ?? START;
      const result = reconcileRuntime(state, {
        planetId: state.currentPlanetId,
        now: requestedTarget,
        mode: 'production',
        testTimeScale: 1,
      });
      state = result.state;
      emitted = emitted.concat(keepNpcEvents(result.events));
      if (!isNpcCatchupPending(state) && (state.npcReplay?.processedThroughAt ?? START) >= requestedTarget) break;
      const after = state.npcReplay?.processedThroughAt ?? START;
      assert.ok(after > before, `NPC catch-up must make progress (${before} → ${after}, target ${requestedTarget})`);
      guard += 1;
      assert.ok(guard < 1_000, `NPC catch-up exceeded the bounded drain guard at ${requestedTarget}`);
    }

    if (options.reloadAfterEachStep) {
      assert.equal(facade.write(state).ok, true);
      const loaded = facade.load();
      assert.equal(loaded.status, 'loaded');
      state = loaded.state;
    }
  }

  assert.equal(state.npcReplay?.processedThroughAt, targetAt);
  assert.equal(state.npcReplay?.targetAt, targetAt);
  assert.equal(isNpcCatchupPending(state), false);
  return { state, emissions: emitted };
}

function irregularSteps(targetAt: number): number[] {
  const spans = [5 * HOUR, 13 * HOUR, 7 * HOUR, 19 * HOUR, 11 * HOUR];
  const steps: number[] = [];
  let at = START;
  let index = 0;
  while (at < targetAt) {
    at = Math.min(targetAt, at + spans[index++ % spans.length]!);
    steps.push(at);
  }
  return steps;
}

function economySnapshot(state: SaveState) {
  return {
    npc: clone(state.npc),
    npcReplay: clone(state.npcReplay),
    targets: Object.fromEntries(npcTargets(state).map((target) => [target.id, {
      ownerId: target.ownerId,
      resources: target.resources,
      buildings: target.buildings,
      buildingQueue: target.buildingQueue,
      energyLedger: target.energyLedger,
      overpopulation: target.overpopulation,
      resourceClock: target.resourceClock,
      economyAppliedActionIds: target.economyAppliedActionIds,
    }])),
  };
}

function sessionIntervals(profile: NonNullable<SaveState['npc']>['profiles'][string], fromAt: number, toAt: number) {
  const events = getNpcSessionEvents(profile, fromAt - 3 * HOUR, toAt + 3 * HOUR);
  const intervals = new Map<string, { start?: number; end?: number }>();
  for (const event of events) {
    const interval = intervals.get(event.sessionId) ?? {};
    if (event.boundary === 'session-start') interval.start = event.at;
    else interval.end = event.at;
    intervals.set(event.sessionId, interval);
  }
  return [...intervals.values()].filter((item): item is { start: number; end: number } =>
    item.start !== undefined && item.end !== undefined);
}

function ownerEconomy(target: SpyTargetState) {
  return {
    resources: target.resources,
    buildings: target.buildings,
    buildingQueue: target.buildingQueue,
    energyLedger: target.energyLedger,
    resourceClock: target.resourceClock,
    economyAppliedActionIds: target.economyAppliedActionIds,
  };
}

test('NPC runtime replay is equivalent at 1, 7, and 30 days across continuous and irregular chunks', () => {
  const initial = campaign(1, 'NPC-REPLAY-EQUIVALENCE');
  assert.equal(npcTargets(initial).length, 1);

  for (const days of [1, 7, 30]) {
    const targetAt = START + days * DAY;
    const continuous = advanceTo(clone(initial), targetAt, [targetAt]);
    const chunked = advanceTo(clone(initial), targetAt, irregularSteps(targetAt));

    assert.deepEqual(economySnapshot(chunked.state), economySnapshot(continuous.state), `${days}-day economy and replay metadata`);
    assert.deepEqual(chunked.emissions, continuous.emissions, `${days}-day NPC event emission sequence`);
    const ownerId = npcTargets(initial)[0]!.ownerId;
    const intervals = sessionIntervals(initial.npc!.profiles[ownerId]!, START, targetAt);
    for (const entry of continuous.emissions) {
      if (entry.kind !== 'npc-economy') continue;
      assert.ok(intervals.some(({ start, end }) => entry.event.at >= start && entry.event.at < end),
        `decision ${entry.event.eventId} must happen during its owner's generated online session`);
    }
  }
});

test('NPC decisions run inside generated sessions and debit only their own exact construction cost', () => {
  const initial = campaign(1, 'NPC-REPLAY-OWNER-COST');
  const target = npcTargets(initial)[0]!;
  const ownerId = target.ownerId;
  const horizon = START + 30 * DAY;
  const schedule = generateNpcReplayEvents(initial.npc!, START, horizon + 1, [ownerId]);
  const intervals = sessionIntervals(initial.npc!.profiles[ownerId]!, START, horizon);
  const timeScale = CAMPAIGN_SPEED_SCALE[initial.worldConfig!.world.campaignSpeed];
  let state: SaveState = clone(initial);
  let verified = false;

  for (const scheduled of schedule) {
    if (scheduled.priority !== 'npc-decision') continue;
    // A requested time can span several bounded catch-up slices. Establish the
    // committed prefix immediately before this decision, so the comparison
    // isolates its one debit rather than earlier actions in the same replay.
    state = advanceTo(state, scheduled.at - 1, [scheduled.at - 1]).state;
    const beforeTarget = npcTargets(state).find((item) => item.ownerId === ownerId)!;
    const result = reconcileRuntime(state, {
      planetId: state.currentPlanetId,
      now: scheduled.at,
      mode: 'production',
      testTimeScale: 1,
    });
    state = result.state;
    const decision = keepNpcEvents(result.events).find((entry) =>
      entry.kind === 'npc-economy' && entry.event.at === scheduled.at && entry.event.started);
    if (!decision || decision.kind !== 'npc-economy') continue;

    assert.ok(intervals.some(({ start, end }) => decision.event.at >= start && decision.event.at < end),
      'a persisted economic action must occur during the generated online session');
    assert.ok(decision.event.selectedRole);
    const settled = settleNpcPlanet(beforeTarget, decision.event.at, { timeScale }).target;
    const candidate = getNpcBuildingCandidates(settled).find((item) => item.role === decision.event.selectedRole);
    assert.ok(candidate?.availability.canBuild && candidate.availability.cost);
    const expected = startNpcBuilding(settled, decision.event.selectedRole, decision.event.at,
      { timeScale }, decision.event.idempotencyKey);
    assert.equal(expected.ok, true);
    assert.equal(expected.target.resources.metal, settled.resources.metal - candidate.availability.cost.metal);
    assert.equal(expected.target.resources.minerals, settled.resources.minerals - candidate.availability.cost.minerals);
    assert.equal(expected.target.resources.gas, settled.resources.gas - candidate.availability.cost.gas);

    const actualTarget = npcTargets(state).find((item) => item.ownerId === ownerId)!;
    assert.deepEqual(ownerEconomy(actualTarget), ownerEconomy(expected.target),
      'reconcileRuntime must use the NPC owner wallet and energy ledger for the real building start');
    assert.ok(actualTarget.economyAppliedActionIds?.includes(decision.event.idempotencyKey));
    verified = true;
    break;
  }

  assert.equal(verified, true, 'the seeded 30-day real calendar should reach a legal NPC economy decision');
});

test('a frozen 30-day replay target survives intermediate save/reload and does not duplicate actions', () => {
  const initial = campaign(1, 'NPC-REPLAY-RELOAD');
  const targetAt = START + 30 * DAY;
  const firstSlice = reconcileRuntime(clone(initial), {
    planetId: initial.currentPlanetId,
    now: targetAt,
    mode: 'production',
    testTimeScale: 1,
  });
  assert.equal(firstSlice.state.npcReplay?.targetAt, targetAt);
  assert.ok(isNpcCatchupPending(firstSlice.state));

  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: 'npc-replay-frozen-target', now: () => targetAt });
  assert.equal(facade.write(firstSlice.state).ok, true);
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded');
  assert.equal(loaded.state.npcReplay?.targetAt, targetAt);
  assert.equal(isNpcCatchupPending(loaded.state), true);

  const remaining = advanceTo(loaded.state, targetAt, [targetAt]);
  const complete = advanceTo(clone(initial), targetAt, [targetAt]);
  const allEmissions = keepNpcEvents(firstSlice.events).concat(remaining.emissions);
  assert.deepEqual(economySnapshot(remaining.state), economySnapshot(complete.state));
  assert.deepEqual(allEmissions, complete.emissions);
  const actionIds = npcTargets(remaining.state).flatMap((target) => target.economyAppliedActionIds ?? []);
  const startedIds = allEmissions.flatMap((entry) => entry.kind === 'npc-economy' && entry.event.started
    ? [entry.event.idempotencyKey] : []);
  assert.equal(new Set(startedIds).size, startedIds.length, 'reloading never emits a started action twice');
  assert.deepEqual(actionIds, startedIds.slice(-256),
    'the bounded persisted idempotency window retains the most recent started decisions after reload');
});

test('100 real NPC owners finish a 30-day production replay with their own bounded economy state', () => {
  const initial = campaign(100, 'NPC-REPLAY-100');
  assert.equal(npcTargets(initial).length, 100);
  assert.equal(Object.keys(initial.npc!.profiles).length, 100);
  const targetAt = START + 30 * DAY;
  const completed = advanceTo(clone(initial), targetAt, [targetAt]);

  assert.equal(completed.state.npcReplay?.processedThroughAt, targetAt);
  assert.equal(isNpcCatchupPending(completed.state), false);
  assert.equal(npcTargets(completed.state).length, 100);
  assert.equal(Object.keys(completed.state.npc!.profiles).length, 100);
  for (const target of npcTargets(completed.state)) {
    assert.ok(target.resources.metal >= 0 && target.resources.minerals >= 0 && target.resources.gas >= 0);
    assert.ok(target.buildingQueue!.length <= 3);
    assert.ok(target.resourceClock!.lastReconciledAt >= targetAt - DAY,
      `owner ${target.ownerId} is economically settled through the bounded replay prefix`);
  }
});

test('legacy NPC queue and energy ledger survive schema migration and complete through runtime', () => {
  const initial = campaign(1, 'NPC-REPLAY-LEGACY-QUEUE');
  const target = npcTargets(initial)[0]!;
  const candidate = getNpcBuildingCandidates(target).find((item) => item.role === 'basic-energy');
  assert.ok(candidate?.availability.canBuild);
  const started = startNpcBuilding(target, 'basic-energy', START, { timeScale: 1 }, 'legacy-existing-energy-build');
  assert.equal(started.ok, true);
  const expectedTarget = started.target;
  const legacyState: SaveState = {
    ...initial,
    schemaVersion: 24,
    espionage: { ...initial.espionage!, targets: { ...initial.espionage!.targets, [target.id]: expectedTarget } },
  };
  const stored = { ...legacyState } as unknown as Record<string, unknown>;
  delete stored.npc;
  const raw = JSON.stringify(stored);
  const storage = memoryStorage();
  const saveKey = 'npc-runtime-legacy-queue';
  storage.setItem(saveKey, raw);
  const loaded = createPersistenceFacade({ mode: 'production', storage, saveKey, now: () => START + 1_000 }).load();
  assert.equal(loaded.status, 'loaded');
  const migrated = loaded.state.espionage!.targets![target.id]!;
  assert.deepEqual(migrated.buildingQueue, expectedTarget.buildingQueue);
  assert.deepEqual(migrated.energyLedger, expectedTarget.energyLedger);
  assert.deepEqual(migrated.resources, expectedTarget.resources);

  const finishAt = migrated.buildingQueue![0]!.finishAt;
  const completed = advanceTo(loaded.state, finishAt, [finishAt]);
  const after = completed.state.espionage!.targets![target.id]!;
  assert.equal(after.buildings['basic-energy'], expectedTarget.buildings['basic-energy']! + 1);
  assert.equal(after.buildingQueue!.some((item) => item.id === expectedTarget.buildingQueue![0]!.id), false);
  assert.ok(after.energyLedger);
  assert.ok(after.energyLedger.availableEnergy >= migrated.energyLedger!.availableEnergy);
});

test('zero NPC and campaign speed scale stay isolated from player resources and saved clocks', () => {
  const empty = campaign(0, 'NPC-REPLAY-EMPTY');
  const emptyResult = reconcileRuntime(empty, {
    planetId: empty.currentPlanetId,
    now: START + DAY,
    mode: 'production',
    testTimeScale: 1,
  });
  assert.equal(npcTargets(emptyResult.state).length, 0);
  assert.equal(Object.keys(emptyResult.state.npc!.profiles).length, 0);
  assert.equal(keepNpcEvents(emptyResult.events).length, 0);

  const standard = campaign(1, 'NPC-SPEED-SCALE');
  const faster: SaveState = {
    ...clone(standard),
    worldConfig: { ...standard.worldConfig!, world: { ...standard.worldConfig!.world, campaignSpeed: 'fast' } },
  };
  const end = START + 7 * DAY;
  const standardResult = advanceTo(clone(standard), end, [end]);
  const fastResult = advanceTo(clone(faster), end, [end]);
  const standardEvents = standardResult.emissions.filter((entry) => entry.kind === 'npc-economy').map((entry) => entry.kind === 'npc-economy' ? entry.event.eventId : '');
  const fastEvents = fastResult.emissions.filter((entry) => entry.kind === 'npc-economy').map((entry) => entry.kind === 'npc-economy' ? entry.event.eventId : '');
  assert.deepEqual(fastEvents, standardEvents, 'campaign speed cannot rewrite an NPC’s saved attention calendar');
  assert.deepEqual(fastResult.state.planets['helion-01']?.resources, standardResult.state.planets['helion-01']?.resources,
    'NPC replay never draws resources from the current player');
});
