import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { CAMPAIGN_SPEED_SCALE } from '../domain/runtime/mode.ts';
import { getBuildingResourceIncomePerHour } from '../domain/buildings/resource-zone.ts';
import { calculateEnergySources } from '../domain/energy/runtime.ts';
import { reconcileNpcScienceAt, getNpcScienceCandidates, pauseNpcScienceForSettlement, projectNpcScienceLedger, startNpcScience } from './npc-science.ts';
import { reconcileRuntime, type RuntimeReconcileEvent } from './reconcile.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { getNpcBuildingCandidates, settleNpcPlanet, startNpcBuilding, targetEnergyLedger } from './npc-economy.ts';
import { isNpcCatchupPending } from './npc-catchup.ts';
import type { ScienceState } from '../domain/science/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { SaveState } from './contracts.ts';

const START = Date.UTC(2026, 9, 20, 12);
const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

function campaign(npcCount = 2, seed = 'NPC-SCIENCE-APPLICATION-TEST', campaignSpeed: 'slow' | 'standard' | 'fast' = 'standard'): SaveState {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'NPC Science QA' });
  const setup = { ...base, world: { ...base.world, galaxyCount: 1, npcCount, maxNpcPerSystem: 2 as const, randomPlayerStart: false, campaignSpeed } };
  const state = createInitialSaveState('production', START, setup);
  const ownerIds = Object.keys(state.npc!.profiles);
  return {
    ...state,
    npc: createNpcState(ownerIds, `npc-science-application-test-v1:${seed}`, START),
    asteroidSimulation: undefined,
    exploration: state.exploration ? { ...state.exploration, npcProcessedAt: START + 30 * DAY } : undefined,
    pirate: state.pirate ? { ...state.pirate, raidProcessedAt: START + 30 * DAY } : undefined,
  };
}

function npcTargets(state: SaveState): SpyTargetState[] {
  return Object.values(state.espionage?.targets ?? {})
    .filter((target) => target.kind === 'npc' && target.ownerId !== state.profile.playerId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function setTarget(state: SaveState, target: SpyTargetState): SaveState {
  assert.ok(state.espionage);
  return { ...state, espionage: { ...state.espionage, targets: { ...state.espionage.targets, [target.id]: target } } };
}

function readyPlanet(target: SpyTargetState): SpyTargetState {
  return {
    ...target,
    buildings: { ...target.buildings, research: Math.max(1, target.buildings.research ?? 0) },
    resources: { ...target.resources, metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000 },
  };
}

function withScience(state: SaveState, ownerId: string, science: ScienceState): SaveState {
  assert.ok(state.npcScience);
  return { ...state, npcScience: { ...state.npcScience, owners: { ...state.npcScience.owners, [ownerId]: science } } };
}

function twoPlanetsForOwner(state: SaveState, target: SpyTargetState): SpyTargetState {
  return { ...target, id: `${target.id}-second-colony`, coordinate: { ...target.coordinate, position: target.coordinate.position + 1 } };
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

function keepScienceEvents(events: readonly RuntimeReconcileEvent[]) {
  const output: unknown[] = [];
  for (const event of events) {
    if (event.kind === 'npc-economy') {
      for (const emission of event.events) output.push({ kind: event.kind, event: emission });
    } else if (event.kind === 'npc-building' || event.kind === 'npc-science') output.push(event);
  }
  return output;
}

function scienceSnapshot(state: SaveState) {
  return {
    npc: clone(state.npc),
    npcReplay: state.npcReplay ? { version: state.npcReplay.version, processedThroughAt: state.npcReplay.processedThroughAt } : undefined,
    npcScience: clone(state.npcScience),
    targets: Object.fromEntries(npcTargets(state).map((target) => [target.id, {
      ownerId: target.ownerId,
      buildings: target.buildings,
      buildingQueue: target.buildingQueue,
      resources: target.resources,
      energyLedger: target.energyLedger,
      ownerProfile: target.ownerProfile,
      economyAppliedActionIds: target.economyAppliedActionIds,
    }])),
  };
}

function advanceTo(initial: SaveState, targetAt: number): { state: SaveState; events: unknown[] } {
  let state = initial;
  const events: unknown[] = [];
  let guard = 0;
  while (guard++ < 1_000) {
    const before = state.npcReplay?.processedThroughAt ?? START;
    const result = reconcileRuntime(state, { planetId: state.currentPlanetId, now: targetAt, mode: 'production', testTimeScale: 1 });
    state = result.state;
    events.push(...keepScienceEvents(result.events));
    if (!isNpcCatchupPending(state) && (state.npcReplay?.processedThroughAt ?? START) >= targetAt) {
      return { state, events };
    }
    assert.ok((state.npcReplay?.processedThroughAt ?? START) > before,
      `NPC catch-up must progress beyond ${before} toward ${targetAt}`);
  }
  assert.fail(`NPC catch-up did not finish through ${targetAt}`);
}

function replayWithFrozenTarget(initial: SaveState, targetAt: number, reloadAfterFirstSlice: boolean) {
  let state = initial;
  const events: unknown[] = [];
  const checkpoints = [1, 3, 7, 30].map((days) => START + days * DAY).filter((at) => at <= targetAt);
  const snapshots: Record<number, { state: unknown; events: unknown[] }> = {};
  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: `npc-science-parity-${reloadAfterFirstSlice}`, now: () => targetAt });
  let checkpointIndex = 0;
  let slices = 0;

  while ((state.npcReplay?.processedThroughAt ?? START) < targetAt || isNpcCatchupPending(state)) {
    const before = state.npcReplay?.processedThroughAt ?? START;
    const result = reconcileRuntime(state, { planetId: state.currentPlanetId, now: targetAt, mode: 'production', testTimeScale: 1 });
    state = result.state;
    events.push(...keepScienceEvents(result.events));
    slices += 1;
    if (reloadAfterFirstSlice && slices === 1) {
      assert.ok(isNpcCatchupPending(state), 'first bounded slice should leave the 30-day replay pending');
      assert.equal(facade.write(state).ok, true);
      const loaded = facade.load();
      assert.equal(loaded.status, 'loaded');
      state = loaded.state;
    }
    while (checkpointIndex < checkpoints.length && (state.npcReplay?.processedThroughAt ?? START) >= checkpoints[checkpointIndex]!) {
      snapshots[(checkpointIndex === 0 ? 1 : checkpointIndex === 1 ? 3 : checkpointIndex === 2 ? 7 : 30)] = {
        state: scienceSnapshot(state), events: clone(events),
      };
      checkpointIndex += 1;
    }
    if (isNpcCatchupPending(state)) assert.ok((state.npcReplay?.processedThroughAt ?? START) > before);
  }
  return { state, snapshots, events, slices };
}

function replayIrregularly(initial: SaveState, targetAt: number) {
  let state = initial;
  let at = START;
  let spanIndex = 0;
  const spans = [5 * HOUR, 13 * HOUR, 7 * HOUR, 19 * HOUR, 11 * HOUR];
  const checkpoints = [1, 3, 7, 30].map((days) => START + days * DAY).filter((point) => point <= targetAt);
  const snapshots: Record<number, { state: unknown; events: unknown[] }> = {};
  const events: unknown[] = [];
  let checkpointIndex = 0;

  while (at < targetAt) {
    const boundary = checkpoints[checkpointIndex] ?? targetAt;
    const nextAt = Math.min(boundary, targetAt, at + spans[spanIndex++ % spans.length]!);
    const advanced = advanceTo(state, nextAt);
    state = advanced.state;
    events.push(...advanced.events);
    at = nextAt;
    if (at === boundary) {
      const checkpointDay = [1, 3, 7, 30][checkpointIndex]!;
      snapshots[checkpointDay] = { state: scienceSnapshot(state), events: clone(events) };
      checkpointIndex += 1;
    }
  }
  return { state, snapshots, events };
}

test('NPC science candidates and starts use production research costs and duration scales', () => {
  const initial = campaign(1);
  const generatedTarget = npcTargets(initial)[0]!;
  const target = readyPlanet(generatedTarget);
  const science = initial.npcScience!.owners[target.ownerId]!;

  const noLab = { ...generatedTarget, buildings: { ...generatedTarget.buildings, research: 0 } };
  assert.deepEqual(getNpcScienceCandidates(noLab, science, START, 1), []);
  const refused = startNpcScience(noLab, science, 1, START, 1, 'npc-science-no-lab');
  assert.equal(refused.ok, false);
  assert.equal(refused.target, noLab);
  assert.equal(refused.science, science);

  const standard = getNpcScienceCandidates(target, science, START, 1).find((item) => item.scienceId === 1)!;
  const fast = getNpcScienceCandidates(target, science, START, 2).find((item) => item.scienceId === 1)!;
  assert.equal(standard.canStart, true);
  assert.equal(fast.canStart, true);
  assert.deepEqual(fast.cost, standard.cost);
  assert.ok(fast.durationMs < standard.durationMs);

  const started = startNpcScience(target, science, 1, START, 2, 'npc-science-fast-start');
  assert.equal(started.ok, true);
  assert.deepEqual(started.science.queue[0]?.cost, fast.cost);
  assert.equal(started.science.queue[0]?.durationMs, fast.durationMs);
  assert.equal(started.target.resources.metal, target.resources.metal - fast.cost.metal);
  assert.equal(started.target.resources.minerals, target.resources.minerals - fast.cost.minerals);
  assert.equal(started.target.resources.gas, target.resources.gas - fast.cost.gas);
});

test('NPC science start is idempotent and runtime reconciliation finishes paid owner research', () => {
  const initial = campaign(1);
  const target = readyPlanet(npcTargets(initial)[0]!);
  const ownerId = target.ownerId;
  const science = initial.npcScience!.owners[ownerId]!;
  const preview = getNpcScienceCandidates(target, science, START, 1).find((item) => item.scienceId === 1)!;
  const started = startNpcScience(target, science, 1, START, 1, 'npc-science-runtime-start');
  assert.equal(started.ok, true);
  const repeated = startNpcScience(started.target, started.science, 1, START, 1, 'npc-science-runtime-start');
  assert.equal(repeated.ok, true);
  assert.strictEqual(repeated.target, started.target);
  assert.strictEqual(repeated.science, started.science);
  assert.equal(started.target.resources.metal, target.resources.metal - preview.cost.metal);
  assert.equal(started.target.resources.minerals, target.resources.minerals - preview.cost.minerals);

  const queuedState = setTarget(withScience(initial, ownerId, started.science), started.target);
  const task = started.science.queue[0]!;
  const result = reconcileRuntime(queuedState, {
    planetId: queuedState.currentPlanetId,
    now: task.finishAt,
    mode: 'production',
    testTimeScale: 1,
  });

  assert.equal(result.state.npcScience?.owners[ownerId]?.levels[1], 1);
  assert.equal(result.state.npcScience?.owners[ownerId]?.queue.length, 0);
  assert.ok(result.events.some((event) => event.kind === 'npc-science'
    && event.ownerId === ownerId && event.scienceId === 1 && event.at === task.finishAt));
  assert.equal(result.state.espionage?.targets?.[target.id]?.ownerProfile?.scienceLevels?.[1], 1);
});

test('owner science projects to both colonies without crossing owners', () => {
  const initial = campaign(2);
  const targets = npcTargets(initial);
  assert.ok(targets.length >= 2);
  const first = targets[0]!;
  const secondOwnerTarget = targets.find((target) => target.ownerId !== first.ownerId)!;
  const secondColony = twoPlanetsForOwner(initial, first);
  const firstScience = initial.npcScience!.owners[first.ownerId]!;
  const secondScience = initial.npcScience!.owners[secondOwnerTarget.ownerId]!;
  const state = setTarget(initial, secondColony);
  const prepared: SaveState = {
    ...state,
    npcScience: {
      ...state.npcScience!,
      owners: {
        ...state.npcScience!.owners,
        [first.ownerId]: { ...firstScience, levels: { ...firstScience.levels, 1: 2 } },
        [secondOwnerTarget.ownerId]: { ...secondScience, levels: { ...secondScience.levels, 3: 1 } },
      },
    },
  };

  const projected = projectNpcScienceLedger(prepared);
  assert.equal(projected.espionage?.targets?.[first.id]?.ownerProfile?.scienceLevels?.[1], 2);
  assert.equal(projected.espionage?.targets?.[secondColony.id]?.ownerProfile?.scienceLevels?.[1], 2);
  assert.equal(projected.espionage?.targets?.[secondOwnerTarget.id]?.ownerProfile?.scienceLevels?.[1] ?? 0, 0);
  assert.equal(projected.espionage?.targets?.[secondOwnerTarget.id]?.ownerProfile?.scienceLevels?.[3], 1);
});

test('destroying the research payer drops its queue without refunding a surviving colony', () => {
  const initial = campaign(2);
  const target = readyPlanet(npcTargets(initial)[0]!);
  const survivor = twoPlanetsForOwner(initial, target);
  const ownerId = target.ownerId;
  const science = initial.npcScience!.owners[ownerId]!;
  const started = startNpcScience(target, science, 1, START, 1, 'npc-science-destroyed-payer');
  assert.equal(started.ok, true);
  const withSurvivor = setTarget(setTarget(withScience(initial, ownerId, started.science), started.target), survivor);
  const { [target.id]: _destroyed, ...remainingTargets } = withSurvivor.espionage!.targets!;
  const destroyed: SaveState = { ...withSurvivor, espionage: { ...withSurvivor.espionage!, targets: remainingTargets } };
  const resourcesBefore = remainingTargets[survivor.id]!.resources;

  const result = reconcileNpcScienceAt(destroyed, START + 1);

  assert.equal(result.state.npcScience?.owners[ownerId]?.queue.length, 0);
  assert.deepEqual(result.state.espionage?.targets?.[survivor.id]?.resources, resourcesBefore);
  assert.deepEqual(result.completed, []);
});

test('building a production research lab pays its exact resource and energy cost before completion', () => {
  const initial = campaign(1);
  const generated = npcTargets(initial)[0]!;
  assert.equal(generated.buildings.research ?? 0, 0);
  const target: SpyTargetState = {
    ...generated,
    buildings: { ...generated.buildings, construction: Math.max(1, generated.buildings.construction ?? 0), research: 0 },
    buildingQueue: [],
    energyLedger: undefined,
    resources: { ...generated.resources, metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000, developmentEnergy: 1_000_000 },
  };
  const preview = getNpcBuildingCandidates(target).find((candidate) => candidate.role === 'research')!;
  assert.equal(preview.availability.canBuild, true);
  assert.ok(preview.availability.cost);
  const energyBefore = targetEnergyLedger(target).availableEnergy;
  const started = startNpcBuilding(target, 'research', START, { timeScale: 1 }, 'npc-science-lab-build');
  assert.equal(started.ok, true);
  assert.equal(started.target.resources.metal, target.resources.metal - preview.availability.cost.metal);
  assert.equal(started.target.resources.minerals, target.resources.minerals - preview.availability.cost.minerals);
  assert.equal(started.target.resources.gas, target.resources.gas - preview.availability.cost.gas);
  assert.equal(started.target.energyLedger?.availableEnergy, energyBefore - preview.availability.cost.energy);

  const finishAt = started.target.buildingQueue![0]!.finishAt;
  const settled = settleNpcPlanet(started.target, finishAt, { timeScale: 1 });
  assert.deepEqual(settled.completedRoles, ['research']);
  assert.equal(settled.target.buildings.research, 1);
  assert.equal(settled.target.buildingQueue?.some((item) => item.id === 'npc-science-lab-build'), false);
  assert.equal(settled.target.energyLedger?.availableEnergy, energyBefore - preview.availability.cost.energy);
});

test('a generated zero-lab NPC campaign earns its lab and completes paid research within 30 days', () => {
  const initial = campaign(1, 'NPC-SCIENCE-NATURAL-30D');
  const target = npcTargets(initial)[0]!;
  const ownerId = target.ownerId;
  assert.equal(target.buildings.research ?? 0, 0, 'the production fixture starts without a free research lab');
  const initialResources = clone(target.resources);
  const horizon = START + 30 * DAY;
  const replay = advanceTo(initial, horizon);
  const finalTarget = replay.state.espionage!.targets![target.id]!;
  const starts = replay.events.filter((event) => event && typeof event === 'object' && 'kind' in event
    && event.kind === 'npc-economy' && 'event' in event && event.event
    && typeof event.event === 'object' && 'selectedScienceId' in event.event
    && event.event.selectedScienceId !== null && 'started' in event.event && event.event.started === true);

  assert.notDeepEqual(initialResources, { metal: 0, minerals: 0, gas: 0, debris: 0, developmentEnergy: 0 },
    'the initial wallet is the untouched generated production wallet');
  assert.ok(replay.events.some((event) => event && typeof event === 'object' && 'kind' in event
    && event.kind === 'npc-building' && 'assetRole' in event && event.assetRole === 'research'),
  'the NPC must actually complete a research building during the natural run');
  assert.ok(starts.length > 0, 'the NPC must start research through its generated decision events');
  assert.ok(Object.values(replay.state.npcScience!.owners[ownerId]!.levels).some((level) => level > 0),
    'at least one paid owner science task must finish');
  assert.ok((finalTarget.buildings.research ?? 0) > 0);
});

test('Mathematics income and Physics energy are exact once across projection and save reload', () => {
  const initial = campaign(1);
  const generated = npcTargets(initial)[0]!;
  const ownerId = generated.ownerId;
  const target: SpyTargetState = {
    ...generated,
    buildings: { ...generated.buildings, 'metal-production-1': 1, 'basic-energy': 1, research: 0 },
    energyLedger: undefined,
    productionBots: undefined,
    ownerProfile: { scienceLevels: {}, shipLevels: {}, commanderLevels: {} },
    resourceClock: { lastReconciledAt: START, remainder: { metal: 0, minerals: 0, gas: 0 } },
    resources: { ...generated.resources, metal: 0, minerals: 0, gas: 0, developmentEnergy: 0 },
  };
  const ownerScience = initial.npcScience!.owners[ownerId]!;
  const science: ScienceState = { ...ownerScience, levels: { 1: 1, 3: 1 } };
  const prepared = setTarget(withScience(initial, ownerId, science), target);
  const projected = projectNpcScienceLedger(prepared);
  const projectedTarget = projected.espionage!.targets![target.id]!;
  const levels = projected.npcScience!.owners[ownerId]!.levels;
  const buildings = projectedTarget.buildings;
  const coordinates = projectedTarget.coordinate;
  const expectedIncome = getBuildingResourceIncomePerHour(buildings, levels);
  const withoutScienceIncome = getBuildingResourceIncomePerHour(buildings, {});
  assert.equal(expectedIncome.metal, Math.round(withoutScienceIncome.metal * 1.05), 'Mathematics is science 3 and raises resource income by 5%');

  const sourcesWithPhysics = calculateEnergySources({ buildings, scienceLevels: levels,
    galaxy: coordinates.galaxy, system: coordinates.system, position: coordinates.position });
  const sourcesWithoutPhysics = calculateEnergySources({ buildings, scienceLevels: { 3: 1 },
    galaxy: coordinates.galaxy, system: coordinates.system, position: coordinates.position });
  const expectedProduced = sourcesWithPhysics.reduce((sum, source) => sum + source.fullContribution, 0);
  const withoutPhysicsProduced = sourcesWithoutPhysics.reduce((sum, source) => sum + source.fullContribution, 0);
  assert.ok(expectedProduced > withoutPhysicsProduced, 'Physics crosses the generated solar source energy boundary');
  assert.equal(projectedTarget.energyLedger?.producedEnergy, expectedProduced);
  assert.equal(projectedTarget.resources.developmentEnergy, projectedTarget.energyLedger?.availableEnergy);

  const repeatedProjection = projectNpcScienceLedger(projected);
  assert.strictEqual(repeatedProjection, projected, 're-projecting a saved owner level must not add its energy twice');
  const settled = settleNpcPlanet(projectedTarget, START + HOUR, { timeScale: 1 }).target;
  assert.equal(settled.resources.metal, expectedIncome.metal, 'one hour credits the exact Mathematics-adjusted metal income');
  assert.equal(settled.resources.minerals, expectedIncome.minerals);
  assert.equal(settled.resources.gas, expectedIncome.gas);

  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: 'npc-science-math-physics-reload', now: () => START + HOUR });
  assert.equal(facade.write(projected).ok, true);
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded');
  const loadedTarget = loaded.state.espionage!.targets![target.id]!;
  assert.equal(loadedTarget.energyLedger?.producedEnergy, expectedProduced);
  assert.equal(loadedTarget.energyLedger?.availableEnergy, expectedProduced - (projectedTarget.energyLedger?.consumedEnergy ?? 0));
  assert.equal(loadedTarget.resources.developmentEnergy, loadedTarget.energyLedger?.availableEnergy);
});

test('Mathematics takes effect at its paid finish boundary without retroactive or duplicate income', () => {
  const initial = campaign(1);
  const target = readyPlanet(npcTargets(initial)[0]!);
  const ownerId = target.ownerId;
  const science = initial.npcScience!.owners[ownerId]!;
  const started = startNpcScience(target, science, 3, START, 1, 'npc-science-math-boundary');
  assert.equal(started.ok, true);
  const finishAt = started.science.queue[0]!.finishAt;
  const payer: SpyTargetState = { ...started.target,
    resources: { ...started.target.resources, metal: 0, minerals: 0, gas: 0 },
    resourceClock: { lastReconciledAt: finishAt, remainder: { metal: 0, minerals: 0, gas: 0 } },
  };
  const queued = setTarget(withScience(initial, ownerId, started.science), payer);
  const finish = reconcileNpcScienceAt(queued, finishAt);
  assert.equal(finish.state.npcScience!.owners[ownerId]!.levels[3], 1);
  assert.deepEqual(finish.completed, [{ ownerId, scienceId: 3, at: finishAt }]);
  const projected = projectNpcScienceLedger(finish.state);
  const completedTarget = projected.espionage!.targets![target.id]!;
  const afterRate = getBuildingResourceIncomePerHour(completedTarget.buildings, finish.state.npcScience!.owners[ownerId]!.levels);
  assert.equal(afterRate.metal, Math.round(getBuildingResourceIncomePerHour(completedTarget.buildings, {}).metal * 1.05));
  const oneHour = settleNpcPlanet(completedTarget, finishAt + HOUR, { timeScale: 1 }).target;
  assert.equal(oneHour.resources.metal, completedTarget.resources.metal + afterRate.metal);
});

test('canonical owner science and completion events match across replay partitions, reloads, speeds, and seeds', () => {
  for (const [seed, speed] of [['NPC-SCIENCE-PARITY-A', 'standard'], ['NPC-SCIENCE-PARITY-B', 'fast']] as const) {
    const initial = campaign(1, seed, speed);
    const reloadReplay = replayWithFrozenTarget(clone(initial), START + 30 * DAY, true);
    const irregular = replayIrregularly(clone(initial), START + 30 * DAY);
    for (const days of [1, 3, 7, 30]) {
      const horizon = START + days * DAY;
      const continuous = advanceTo(clone(initial), horizon);
      const expected = { state: scienceSnapshot(continuous.state), events: clone(continuous.events) };
      assert.deepEqual(irregular.snapshots[days], expected, `${seed} ${speed} ${days}-day irregular replay`);
      assert.deepEqual(reloadReplay.snapshots[days], expected, `${seed} ${speed} ${days}-day reload replay`);
    }
    assert.equal(reloadReplay.state.npcReplay?.processedThroughAt, START + 30 * DAY);
    assert.equal(isNpcCatchupPending(reloadReplay.state), false);
  }
});

test('blocked research pauses once through the locked overpopulation interval and resumes from the shifted FIFO', () => {
  const initial = campaign(1);
  const target = readyPlanet(npcTargets(initial)[0]!);
  const ownerId = target.ownerId;
  const science = initial.npcScience!.owners[ownerId]!;
  const started = startNpcScience(target, science, 1, START, 1, 'npc-science-paused');
  assert.equal(started.ok, true);
  const episodeStartedAt = START + 1_000;
  const blockedTarget: SpyTargetState = { ...started.target,
    resourceClock: { lastReconciledAt: episodeStartedAt, remainder: { metal: 0, minerals: 0, gas: 0 } },
    overpopulation: { episodeStartedAt, initialExcess: 1, initialPopulation: 2, initialCapacity: 1,
      scheduledBurnPool: 1, burnedPopulation: 0, lastReconciledAt: episodeStartedAt, blocked: true },
  };
  const ledger = { ...initial.npcScience!, owners: { ...initial.npcScience!.owners, [ownerId]: started.science } };
  const shifted = pauseNpcScienceForSettlement(ledger, { [target.id]: blockedTarget }, new Set([ownerId]), START + 6_000)!;
  const originalTask = started.science.queue[0]!;
  assert.equal(shifted.owners[ownerId]!.queue[0]!.startedAt, originalTask.startedAt + 5_000);
  assert.equal(shifted.owners[ownerId]!.queue[0]!.finishAt, originalTask.finishAt + 5_000);
  const settledClock: SpyTargetState = { ...blockedTarget,
    resourceClock: { ...blockedTarget.resourceClock!, lastReconciledAt: START + 6_000 } };
  const once = pauseNpcScienceForSettlement(shifted, { [target.id]: settledClock }, new Set([ownerId]), START + 6_000)!;
  assert.strictEqual(once, shifted, 'the same elapsed interval is not shifted twice');
  const resumed = { ...settledClock, overpopulation: { ...settledClock.overpopulation!, blocked: false } };
  const afterResume = pauseNpcScienceForSettlement(once, { [target.id]: resumed }, new Set([ownerId]), START + 20_000)!;
  assert.strictEqual(afterResume, once, 'unblocked settlement resumes the shifted finish date');
});
