import assert from 'node:assert/strict';
import test from 'node:test';

import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { createEmptyDefenseState, type FleetProductionOrder, type FleetProductionState } from '../domain/fleet/production.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { CAMPAIGN_SPEED_SCALE } from '../domain/runtime/mode.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { SaveState } from './contracts.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { isNpcCatchupPending } from './npc-catchup.ts';
import { reconcileRuntime, type RuntimeReconcileEvent } from './reconcile.ts';
import { generateNpcReplayEvents, type NpcReplayEmission } from './npc-replay.ts';
import { getNpcFleetProductionCandidates, settleNpcFleetProduction, startNpcFleetProduction } from './npc-fleet-production.ts';
import { getNpcBuildingCandidates, settleNpcPlanet } from './npc-economy.ts';

const START = Date.UTC(2026, 9, 20, 12);
const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

function campaign(npcCount: number, seed: string, addSecondPlanet = false): SaveState {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Autonomy QA' });
  const setup = { ...base, world: { ...base.world, npcCount, campaignSpeed: 'fast' as const } };
  const initial = createInitialSaveState('production', START, setup);
  const ownerIds = Object.keys(initial.npc!.profiles);
  const generated = createNpcState(ownerIds, `npc-autonomy-integration:${seed}`, START);
  const profiles = Object.fromEntries(Object.entries(generated.profiles).map(([ownerId, profile]) => [ownerId, {
    ...profile,
    activity: { ...profile.activity, propensity: 1 },
    traits: {
      ...profile.traits,
      economyFocus: 0.35,
      scienceFocus: 0.75,
      militaryFocus: 1,
      expansionFocus: 0.15,
      operationsInterest: 0.1,
      cooperation: 0.1,
      aggression: 0.2,
      riskTolerance: 0.5,
      planningHorizon: 0.8,
      mechanicsKnowledge: 1,
      adaptability: 0.1,
      persistence: 0.9,
      socialStyle: 0.2,
      attention: 1,
    },
  }]));
  const state: SaveState = {
    ...initial,
    npc: { ...generated, profiles },
    // Keep independent legacy NPC activity clocks inert for this replay fixture.
    exploration: { ...initial.exploration!, npcProcessedAt: START + 30 * DAY },
    pirate: { ...initial.pirate!, raidProcessedAt: START + 30 * DAY },
  };
  if (!addSecondPlanet) return state;

  const primary = npcTargets(state)[0]!;
  const secondaryId = `${primary.ownerId}-empty-colony-fixture`;
  const secondary: SpyTargetState = {
    ...primary,
    id: secondaryId,
    name: `${primary.ownerName} empty fixture`,
    coordinate: { ...primary.coordinate, system: primary.coordinate.system === 40 ? 39 : primary.coordinate.system + 1 },
    resources: { metal: 0, minerals: 0, gas: 0, debris: 0, developmentEnergy: 0 },
    buildings: {},
    fleet: createEmptyFleetState(),
    defense: createEmptyDefenseState(),
    population: { total: 0, fleet: 0, defense: 0 },
    solarSatellites: 0,
    fleetProduction: { shipQueue: [], defenseQueue: [], commanderQueue: [] },
    buildingQueue: [],
    energyLedger: undefined,
    resourceClock: { lastReconciledAt: START, remainder: { metal: 0, minerals: 0, gas: 0 } },
    economyAppliedActionIds: [],
  };
  return {
    ...state,
    espionage: { ...state.espionage!, targets: { ...state.espionage!.targets, [secondary.id]: secondary } },
  };
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function npcTargets(state: SaveState): SpyTargetState[] {
  return Object.values(state.espionage?.targets ?? {})
    .filter((target) => target.kind === 'npc' && target.ownerId !== state.profile.playerId)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

type NpcEmission = Extract<RuntimeReconcileEvent, { kind: 'npc-economy' }>['events'][number];

function replayEmissions(events: readonly RuntimeReconcileEvent[]): NpcEmission[] {
  return events.flatMap((event) => event.kind === 'npc-economy' ? [...event.events] : []);
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

function advanceTo(
  initial: SaveState,
  targetAt: number,
  steps: readonly number[],
  reloadAfterEachStep = false,
): { state: SaveState; emissions: NpcEmission[] } {
  let state = initial;
  let emissions: NpcEmission[] = [];
  const completionsByKind: Record<string, number> = {};
  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: 'npc-autonomy-replay-integration', now: () => targetAt });
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
      emissions = emissions.concat(replayEmissions(result.events));
      for (const completion of result.events.flatMap((event) => event.kind === 'fleet-production' ? event.completed : [])) {
        completionsByKind[completion.queueKind] = (completionsByKind[completion.queueKind] ?? 0) + completion.quantity;
      }
      if (!isNpcCatchupPending(state) && (state.npcReplay?.processedThroughAt ?? START) >= requestedTarget) break;
      const after = state.npcReplay?.processedThroughAt ?? START;
      assert.ok(after > before, `NPC catch-up must progress (${before} -> ${after}, target ${requestedTarget})`);
      guard += 1;
      const emittedByKind = emissions.reduce<Record<string, number>>((counts, event) => {
        const kind = event.selectedActionKind ?? 'unknown';
        counts[kind] = (counts[kind] ?? 0) + 1;
        return counts;
      }, {});
      assert.ok(guard < 1_000, `NPC catch-up exceeded the bounded drain guard at ${requestedTarget}; processedThroughAt=${after}; targetAt=${state.npcReplay?.targetAt}; drains=${guard}; decisions=${JSON.stringify(emittedByKind)}; fleetCompletions=${JSON.stringify(completionsByKind)}`);
    }
    if (reloadAfterEachStep) {
      assert.equal(facade.write(state).ok, true);
      const loaded = facade.load();
      assert.equal(loaded.status, 'loaded');
      state = loaded.state;
    }
  }
  assert.equal(state.npcReplay?.processedThroughAt, targetAt);
  assert.equal(state.npcReplay?.targetAt, targetAt);
  assert.equal(isNpcCatchupPending(state), false);
  return { state, emissions };
}

function productionSnapshot(state: SaveState) {
  return {
    npc: clone(state.npc),
    npcReplay: clone(state.npcReplay),
    npcScience: clone(state.npcScience),
    targets: Object.fromEntries(npcTargets(state).map((target) => [target.id, {
      ownerId: target.ownerId,
      resources: target.resources,
      buildings: target.buildings,
      buildingQueue: target.buildingQueue,
      fleet: target.fleet,
      defense: target.defense,
      population: target.population,
      solarSatellites: target.solarSatellites,
      energyLedger: target.energyLedger,
      fleetProduction: target.fleetProduction,
      ownerProfile: target.ownerProfile,
      resourceClock: target.resourceClock,
      economyAppliedActionIds: target.economyAppliedActionIds,
    }])),
  };
}

function allFleetOrders(target: SpyTargetState): FleetProductionOrder[] {
  const production = target.fleetProduction as FleetProductionState | undefined;
  return production ? [...production.shipQueue, ...production.defenseQueue, ...production.commanderQueue] : [];
}

function findStartedShip(state: SaveState, ownerId: string, eventIdempotencyKey: string) {
  const matches = npcTargets(state).filter((target) => target.ownerId === ownerId).flatMap((target) =>
    allFleetOrders(target).filter((order) => order.queueKind === 'ships'
      && order.id.includes(eventIdempotencyKey)
      && order.itemId !== 'solar-satellite').map((order) => ({ target, order })));
  return matches[0];
}

test('full-world NPC replay matches at 1/3/7/30 days across continuous, irregular, and reloaded slices', () => {
  const initial = campaign(1, 'NPC-AUTONOMY-REPLAY-EQUIVALENCE');
  for (const days of [1, 3, 7, 30]) {
    const targetAt = START + days * DAY;
    const continuous = advanceTo(clone(initial), targetAt, [targetAt]);
    const chunked = advanceTo(clone(initial), targetAt, irregularSteps(targetAt), true);
    assert.deepEqual(productionSnapshot(chunked.state), productionSnapshot(continuous.state), `${days}-day full NPC physical state`);
    assert.deepEqual(chunked.emissions, continuous.emissions, `${days}-day decision and production chronology`);
  }
});

test('full-world decisions start one legal paid ship across an owner’s planets and replay its physical completion once', () => {
  const initial = campaign(1, 'NPC-AUTONOMY-PAID-SHIP', true);
  const ownerId = npcTargets(initial)[0]!.ownerId;
  const ownerPlanets = npcTargets(initial).filter((target) => target.ownerId === ownerId);
  assert.equal(ownerPlanets.length, 2, 'one real generated world plus one empty same-owner colony fixture');
  const campaignEnd = START + 90 * DAY;
  const schedule = generateNpcReplayEvents(initial.npc!, START, campaignEnd, [ownerId]);
  const scale = CAMPAIGN_SPEED_SCALE[initial.worldConfig!.world.campaignSpeed];
  let state = clone(initial);
  let started: { state: SaveState; beforeTarget: SpyTargetState; target: SpyTargetState; order: FleetProductionOrder; event: NpcEmission } | undefined;

  for (const scheduled of schedule) {
    if (scheduled.priority !== 'npc-decision') continue;
    state = advanceTo(state, scheduled.at - 1, [scheduled.at - 1]).state;
    const before = state;
    const result = reconcileRuntime(state, {
      planetId: state.currentPlanetId,
      now: scheduled.at,
      mode: 'production',
      testTimeScale: 1,
    });
    state = result.state;
    const emittedAtDecision = replayEmissions(result.events).filter((event) => event.eventId === scheduled.eventId);
    assert.equal(emittedAtDecision.length, 1, 'one owner-wide autonomous decision is emitted for the event');
    const event = emittedAtDecision[0]!;
    if (!event.started || event.selectedActionKind !== 'production' || event.selectedRole || event.selectedScienceId) continue;
    const found = findStartedShip(state, ownerId, event.idempotencyKey);
    if (found) {
      const beforeTarget = npcTargets(before).find((target) => target.id === found.target.id)!;
      started = { state, beforeTarget, target: found.target, order: found.order, event };
      break;
    }
  }

  assert.ok(started, 'seeded legal decisions should eventually enqueue a real faction ship');
  const { state: startedState, beforeTarget, target: actualTarget, order, event } = started;
  const factionShip = getFactionShipCatalog(actualTarget.raceId).find(({ id }) => id === order.itemId);
  assert.ok(factionShip, `queued item ${order.itemId} belongs to the owner faction catalog`);
  assert.equal(order.quantity, 1, 'one owner decision produces one unit');
  assert.ok(actualTarget.buildings.shipyard >= factionShip.construction.requiredShipyardLevel,
    'the required shipyard was built through paid NPC decisions');

  const affected = npcTargets(startedState).filter((target) =>
    (target.economyAppliedActionIds ?? []).some((id) => id.includes(event.idempotencyKey)));
  assert.equal(affected.length, 1, 'the same owner action is charged on exactly one planet');
  const settledBefore = settleNpcPlanet(beforeTarget, event.at, { timeScale: scale }).target;
  const legal = getNpcFleetProductionCandidates(settledBefore, ownerId, event.at, scale)
    .find((candidate) => candidate.queueKind === 'ships' && candidate.itemId === order.itemId);
  assert.ok(legal?.available, 'the ship was legal from this NPC owner’s saved science and faction state');
  const expected = startNpcFleetProduction(settledBefore, ownerId, 'ships', order.itemId, event.at, scale, event.idempotencyKey);
  assert.equal(expected.ok, true);
  assert.equal(order.cost.metal, factionShip.cost.metal);
  assert.equal(order.cost.minerals, factionShip.cost.minerals);
  assert.equal(order.cost.gas, factionShip.cost.gas);
  assert.deepEqual(actualTarget.resources, expected.target.resources, 'only the canonical ship cost is debited from its owner wallet');
  assert.deepEqual(actualTarget.fleetProduction, expected.target.fleetProduction);
  assert.deepEqual(actualTarget.fleet, expected.target.fleet, 'no ship appears at enqueue time');
  assert.deepEqual(actualTarget.buildings, settledBefore.buildings, 'production cannot grant prerequisite buildings');
  assert.deepEqual(actualTarget.ownerProfile?.scienceLevels, settledBefore.ownerProfile?.scienceLevels,
    'production cannot grant technology');

  const storage = memoryStorage();
  const saveKey = 'npc-autonomy-fleet-order-reload';
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey, now: () => order.finishAt });
  assert.equal(facade.write(startedState).ok, true);
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded', 'problem' in loaded ? JSON.stringify(loaded.problem) : loaded.status);
  const reloadedTarget = loaded.state.espionage!.targets![actualTarget.id]!;
  assert.deepEqual(reloadedTarget.fleetProduction, actualTarget.fleetProduction);

  const beforeFinish = advanceTo(clone(loaded.state), order.finishAt - 1, [order.finishAt - 1]).state;
  const beforeFinishTarget = beforeFinish.espionage!.targets![actualTarget.id]!;
  assert.equal(beforeFinishTarget.fleet.ships[order.itemId as keyof typeof beforeFinishTarget.fleet.ships],
    settledBefore.fleet.ships[order.itemId as keyof typeof settledBefore.fleet.ships]);
  const exact = advanceTo(clone(loaded.state), order.finishAt, [order.finishAt]);
  const sliced = advanceTo(clone(loaded.state), order.finishAt, [order.finishAt - 1, order.finishAt], true);
  assert.deepEqual(productionSnapshot(sliced.state), productionSnapshot(exact.state), 'reload and irregular chunks preserve exact fleet completion');
  const completedTarget = exact.state.espionage!.targets![actualTarget.id]!;
  assert.equal(completedTarget.fleet.ships[order.itemId as keyof typeof completedTarget.fleet.ships],
    (settledBefore.fleet.ships[order.itemId as keyof typeof settledBefore.fleet.ships] ?? 0) + 1);
  assert.equal(completedTarget.fleetProduction?.shipQueue.some((queued) => queued.id === order.id), false);

  const repeated = reconcileRuntime(exact.state, {
    planetId: exact.state.currentPlanetId,
    now: order.finishAt,
    mode: 'production',
    testTimeScale: 1,
  }).state;
  assert.deepEqual(productionSnapshot(repeated), productionSnapshot(exact.state), 'repeated settlement at the same timestamp cannot duplicate the ship');
});
