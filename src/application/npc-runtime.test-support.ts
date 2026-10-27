// Shared fixtures for the npc-runtime integration test files. The long replays
// live in separate files so node --test runs them in parallel processes.
import assert from 'node:assert/strict';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getNpcSessionEvents } from '../domain/npc/calendar.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { isNpcCatchupPending } from './npc-catchup.ts';
import { reconcileRuntime, type RuntimeReconcileEvent } from './reconcile.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { SaveState } from './contracts.ts';
import type { NpcReplayEmission } from './npc-replay.ts';

export const START = Date.UTC(2026, 9, 20, 12);
export const HOUR = 60 * 60 * 1_000;
export const DAY = 24 * HOUR;

export function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

export function campaign(npcCount: number, seed = `NPC-RUNTIME-${npcCount}`, campaignSpeed: 'slow' | 'standard' | 'fast' = 'standard') {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'NPC QA' });
  const setup = { ...base, world: { ...base.world, galaxyCount: npcCount > 80 ? 2 : base.world.galaxyCount, npcCount, campaignSpeed } };
  const state = createInitialSaveState('production', START, setup);
  const ownerIds = Object.keys(state.npc!.profiles);
  return {
    ...state,
    // Preserve the production-created world and targets, while pinning only the
    // private NPC inputs so replay workloads and decisions stay reproducible.
    npc: createNpcState(ownerIds, `npc-runtime-integration-v1:${seed}`, START),
    asteroidSimulation: undefined,
    // Keep old independent calendars inert for this isolated foundation replay.
    exploration: { ...state.exploration!, npcProcessedAt: START + 30 * DAY },
    pirate: { ...state.pirate!, raidProcessedAt: START + 30 * DAY },
  } satisfies SaveState;
}

export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function npcTargets(state: SaveState): SpyTargetState[] {
  return Object.values(state.espionage?.targets ?? {})
    .filter((target) => target.kind === 'npc' && target.ownerId !== state.profile.playerId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export type NpcEmission =
  | { kind: 'npc-economy'; event: NpcReplayEmission }
  | Extract<RuntimeReconcileEvent, { kind: 'npc-building' }>;

export function keepNpcEvents(events: readonly RuntimeReconcileEvent[]): NpcEmission[] {
  const output: NpcEmission[] = [];
  for (const event of events) {
    if (event.kind === 'npc-economy') {
      for (const emission of event.events) output.push({ kind: event.kind, event: emission });
    } else if (event.kind === 'npc-building') output.push(event);
  }
  return output;
}

export function advanceTo(
  initial: SaveState,
  targetAt: number,
  steps: readonly number[],
  options: { reloadAfterEachStep?: boolean; onEvents?: (events: readonly RuntimeReconcileEvent[]) => void } = {},
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
        // Offline catch-up batches a full window of replay groups per call;
        // the drain guard below still bounds calls with enforced progress.
        replayMaxGroups: 4096,
      });
      state = result.state;
      emitted = emitted.concat(keepNpcEvents(result.events));
      options.onEvents?.(result.events);
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

export function irregularSteps(targetAt: number): number[] {
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

export function economySnapshot(state: SaveState) {
  return {
    npc: clone(state.npc),
    // The world summary is news about one absence, not physical state: it
    // depends on where the player was away, which these chunkings vary on purpose.
    npcReplay: clone(state.npcReplay && { ...state.npcReplay, summary: undefined }),
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

export function sessionIntervals(profile: NonNullable<SaveState['npc']>['profiles'][string], fromAt: number, toAt: number) {
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

export function ownerEconomy(target: SpyTargetState) {
  return {
    resources: target.resources,
    buildings: target.buildings,
    buildingQueue: target.buildingQueue,
    energyLedger: target.energyLedger,
    resourceClock: target.resourceClock,
    economyAppliedActionIds: target.economyAppliedActionIds,
  };
}
