import {
  COMMANDER_COMBAT_CATALOG,
} from '../domain/combat/catalog.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { CommanderId } from '../domain/combat/commanders.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { DefenseId, ShipId } from '../domain/combat/ids.ts';
import { getStorageCapacities, migrateBuildingLevels } from '../domain/buildings/resource-zone.ts';
import { calculatePlanetCapacity, calculatePlanetPopulation } from '../domain/fleet/overpopulation.ts';
import { calculateEnergySources, rebuildEnergyLedger } from '../domain/energy/runtime.ts';
import {
  createDefaultFleetProductionState,
  calculateDefensePopulation,
  enqueueFleetProduction,
  getFleetProductionEntity,
  reconcileFleetProductionState,
  type FleetProductionCompletion,
  type FleetProductionQueueKind,
  type FleetProductionState,
  type FleetProductionTransition,
} from '../domain/fleet/production.ts';
import {
  calculateFleetPopulation,
  getSolarSatelliteFleetCount,
  removeSolarSatellitesFromFleet,
} from '../domain/fleet/runtime.ts';
import { isNpcPlanetBlocked, NPC_APPLIED_ID_LIMIT, targetEnergyLedger } from './npc-economy.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';

/** One catalog entry previewed at a single unit; the order itself may ask for a batch. */
export type NpcFleetProductionCandidate = {
  queueKind: FleetProductionQueueKind;
  itemId: string;
  available: boolean;
  reason: string | null;
  cost: { metal: number; minerals: number; gas: number };
  durationMs: number;
};

export type NpcFleetProductionResult = {
  target: SpyTargetState;
  ok: boolean;
  reason: string | null;
  orderId: string | null;
  completed: FleetProductionCompletion[];
};

export type NpcFleetProductionSettleResult = {
  target: SpyTargetState;
  changed: boolean;
  completed: FleetProductionCompletion[];
  nextDueAt: number | null;
};

type FleetProductionTarget = SpyTargetState & { fleetProduction?: FleetProductionState };

function validOwnerTarget(target: SpyTargetState, ownerId: string): target is FleetProductionTarget {
  return target.kind === 'npc' && !!ownerId && target.ownerId === ownerId && ownerId !== UNIVERSE_NPC_OWNER_ID;
}

function finiteLevel(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizedFleet(target: SpyTargetState) {
  return removeSolarSatellitesFromFleet(target.fleet);
}

function satelliteCount(target: SpyTargetState): number {
  return Math.max(finiteLevel(target.solarSatellites), getSolarSatelliteFleetCount(target.fleet));
}

function productionContext(target: FleetProductionTarget, at: number, timeScale: number, reservedFleetPopulation = 0) {
  const buildings = migrateBuildingLevels(target.buildings);
  const fleet = normalizedFleet(target).fleet;
  return {
    planetId: target.id,
    state: target.fleetProduction ?? createDefaultFleetProductionState(),
    fleet,
    defense: target.defense,
    solarSatellites: satelliteCount(target),
    reservedFleetPopulation,
    wallet: { metal: target.resources.metal, minerals: target.resources.minerals, gas: target.resources.gas },
    capacities: getStorageCapacities(buildings),
    factionId: target.raceId,
    hangarLevel: finiteLevel(buildings.hangar),
    shipyardLevel: finiteLevel(buildings.shipyard),
    advancedFactoryLevel: finiteLevel(buildings['advanced-factory']),
    scienceLevels: target.ownerProfile?.scienceLevels ?? {},
    mode: 'production' as const,
    durationScale: timeScale,
    now: at,
  };
}

function ownerCommanderLevel(target: SpyTargetState, itemId: string): number {
  return finiteLevel(target.ownerProfile?.commanderLevels?.[itemId as CommanderId]);
}

function recalculatePopulation(target: SpyTargetState, fleet: FleetProductionTarget['fleet'], defense: FleetProductionTarget['defense'], satellites: number): SpyTargetState['population'] {
  const fleetPopulation = calculateFleetPopulation(fleet, target.raceId) + satellites;
  const defensePopulation = calculateDefensePopulation(defense, target.raceId);
  return { total: fleetPopulation + defensePopulation, fleet: fleetPopulation, defense: defensePopulation };
}

function updateEnergyAfterProduction(
  before: FleetProductionTarget,
  next: FleetProductionTarget,
  completed: readonly FleetProductionCompletion[],
): FleetProductionTarget {
  const addedSatellites = completed
    .filter((entry) => entry.queueKind === 'ships' && entry.itemId === 'solar-satellite')
    .reduce((sum, entry) => sum + finiteLevel(entry.quantity), 0);
  const legacy = removeSolarSatellitesFromFleet(before.fleet);
  const previousSatellites = Math.max(finiteLevel(before.solarSatellites), legacy.count);
  const satellites = previousSatellites + addedSatellites;
  const buildings = migrateBuildingLevels(next.buildings);
  const previousLedger = targetEnergyLedger({ ...before, fleet: legacy.fleet, solarSatellites: previousSatellites });
  const nextSources = calculateEnergySources({
    buildings,
    scienceLevels: next.ownerProfile?.scienceLevels ?? {},
    solarSatellites: satellites,
    galaxy: next.coordinate.galaxy,
    system: next.coordinate.system,
    position: next.coordinate.position,
  });
  const energyLedger = addedSatellites > 0
    ? rebuildEnergyLedger(previousLedger, nextSources, { sourceChanges: { 'solar-satellite': 'satellite' } })
    : previousLedger;
  return {
    ...next,
    fleet: normalizedFleet(next).fleet,
    solarSatellites: satellites,
    energyLedger,
    resources: { ...next.resources, developmentEnergy: Math.max(0, energyLedger.availableEnergy) },
    population: recalculatePopulation(next, normalizedFleet(next).fleet, next.defense, satellites),
  };
}

function nextDueAt(target: FleetProductionTarget, after: number): number | null {
  const state = target.fleetProduction;
  if (!state || isNpcPlanetBlocked(target)) return null;
  let next: number | null = null;
  for (const queue of [state.shipQueue, state.defenseQueue, state.commanderQueue]) {
    const head = queue[0];
    if (!head) continue;
    const duration = Math.max(1, Math.round(head.effectiveDurationMs));
    const due = head.startedAt + duration * (finiteLevel(head.completedQuantity) + 1);
    if (due > after) next = Math.min(next ?? due, due);
  }
  return next;
}

function entityChoices(target: SpyTargetState): Array<{ queueKind: FleetProductionQueueKind; itemId: string }> {
  return [
    ...getFactionShipCatalog(target.raceId).map(({ id }) => ({ queueKind: 'ships' as const, itemId: id })),
    ...getFactionDefenseCatalog(target.raceId).map(({ id }) => ({ queueKind: 'defense' as const, itemId: id })),
    ...COMMANDER_COMBAT_CATALOG.map(({ id }) => ({ queueKind: 'commanders' as const, itemId: id })),
  ];
}

/** Previews every real faction/catalog entry through the canonical paid enqueue gate. */
export function getNpcFleetProductionCandidates(
  target: SpyTargetState,
  ownerId: string,
  at: number,
  timeScale: number,
  reservedFleetPopulation = 0,
): NpcFleetProductionCandidate[] {
  if (!validOwnerTarget(target, ownerId)) return [];
  const context = productionContext(target, at, timeScale, reservedFleetPopulation);
  return entityChoices(target).flatMap(({ queueKind, itemId }) => {
    const entity = getFleetProductionEntity(queueKind, itemId, target.raceId);
    if (!entity) return [];
    const transition = enqueueFleetProduction(
      { ...context, commanderLevel: ownerCommanderLevel(target, itemId) },
      queueKind,
      itemId,
      1,
      `npc-fleet-preview:${ownerId}:${target.id}:${queueKind}:${itemId}`,
    );
    const blockedReason = isNpcPlanetBlocked(target) ? 'Планета заблокирована из-за перенаселения.' : null;
    return [{
      queueKind,
      itemId,
      available: !blockedReason && transition.ok,
      reason: blockedReason ?? transition.reason,
      cost: { metal: entity.cost.metal, minerals: entity.cost.minerals, gas: entity.cost.gas },
      durationMs: transition.order?.effectiveDurationMs ?? 0,
    }];
  });
}

/**
 * Starts one paid order of `quantity` units (a player orders a batch at once)
 * and records a bounded replay key on the producing planet. Payment, limits
 * and population room are the canonical enqueue gate's.
 */
export function startNpcFleetProduction(
  target: SpyTargetState,
  ownerId: string,
  queueKind: FleetProductionQueueKind,
  itemId: string,
  at: number,
  timeScale: number,
  idempotencyKey: string,
  reservedFleetPopulation = 0,
  quantity = 1,
): NpcFleetProductionResult {
  if (!validOwnerTarget(target, ownerId)) {
    return { target, ok: false, reason: 'Планета не принадлежит этому NPC.', orderId: null, completed: [] };
  }
  if (!idempotencyKey.trim()) {
    return { target, ok: false, reason: 'Для производства требуется ключ повтора.', orderId: null, completed: [] };
  }
  const actionId = `npc-fleet:${ownerId}:${target.id}:${idempotencyKey}`;
  if (target.economyAppliedActionIds?.includes(actionId)) {
    return { target, ok: true, reason: null, orderId: actionId, completed: [] };
  }
  if (isNpcPlanetBlocked(target)) {
    return { target, ok: false, reason: 'Планета заблокирована из-за перенаселения.', orderId: null, completed: [] };
  }
  const context = productionContext(target, at, timeScale, reservedFleetPopulation);
  const transition = enqueueFleetProduction(
    { ...context, commanderLevel: ownerCommanderLevel(target, itemId) },
    queueKind,
    itemId,
    Math.max(1, Math.floor(quantity)),
    actionId,
  );
  const transitioned = applyTransition(target, transition);
  if (!transition.ok) {
    return { target: transitioned, ok: false, reason: transition.reason, orderId: null, completed: transition.completed };
  }
  const appliedIds = [...(transitioned.economyAppliedActionIds ?? []), actionId].slice(-NPC_APPLIED_ID_LIMIT);
  const next = { ...transitioned, economyAppliedActionIds: appliedIds };
  return { target: next, ok: true, reason: null, orderId: actionId, completed: transition.completed };
}

function applyTransition(target: FleetProductionTarget, transition: FleetProductionTransition): FleetProductionTarget {
  const legacy = removeSolarSatellitesFromFleet(transition.fleet);
  const currentSatellites = Math.max(finiteLevel(target.solarSatellites), getSolarSatelliteFleetCount(target.fleet));
  const next: FleetProductionTarget = {
    ...target,
    fleet: legacy.fleet,
    defense: transition.defense,
    fleetProduction: transition.state,
    resources: { ...target.resources, ...transition.wallet },
    solarSatellites: currentSatellites,
  };
  return updateEnergyAfterProduction(target, next, transition.completed);
}

/** Reconciles all three canonical queues; repeated settlements add each unit once. */
export function settleNpcFleetProduction(
  target: SpyTargetState,
  ownerId: string,
  at: number,
): NpcFleetProductionSettleResult {
  if (!validOwnerTarget(target, ownerId) || isNpcPlanetBlocked(target)) {
    return { target, changed: false, completed: [], nextDueAt: null };
  }
  const current = target as FleetProductionTarget;
  const context = productionContext(current, at, 1);
  const reconciled = reconcileFleetProductionState(
    context.state,
    context.fleet,
    context.defense,
    target.raceId as CombatFactionId,
    at,
  );
  if (!reconciled.changed && current.fleetProduction) {
    return { target, changed: false, completed: [], nextDueAt: nextDueAt(current, at) };
  }
  const transition: FleetProductionTransition = {
    ok: true,
    state: reconciled.state,
    fleet: reconciled.fleet,
    defense: reconciled.defense,
    wallet: context.wallet,
    order: null,
    completed: reconciled.completed,
    reason: null,
  };
  const next = applyTransition(current, transition);
  return { target: next, changed: next !== target, completed: reconciled.completed, nextDueAt: nextDueAt(next, at) };
}

/**
 * The next solar satellite completion: the one production unit with an
 * effect of its own (energy, which can start a waiting building), so replay
 * steps on it. Ships, defence and commanders complete by time and are
 * settled before anything reads them.
 */
export function getNextNpcSatelliteCheckpoint(
  target: SpyTargetState,
  ownerId: string,
  after: number,
  through: number,
): number | undefined {
  if (!validOwnerTarget(target, ownerId) || isNpcPlanetBlocked(target)) return undefined;
  // Every queued order has its own fixed schedule, so satellites behind other
  // ships are known before they reach the head of the queue.
  let next: number | undefined;
  for (const order of target.fleetProduction?.shipQueue ?? []) {
    if (order.itemId !== 'solar-satellite') continue;
    const duration = Math.max(1, Math.round(order.effectiveDurationMs));
    const unit = Math.max(finiteLevel(order.completedQuantity) + 1,
      after >= order.startedAt ? Math.floor((after - order.startedAt) / duration) + 1 : 1);
    if (unit > order.quantity) continue;
    const due = order.startedAt + duration * unit;
    if (due > after && due <= through) next = Math.min(next ?? due, due);
  }
  return next;
}

/**
 * The moment completing ships would first push the planet's fleet population
 * over its hangar capacity (a returned fleet can leave little room), or null.
 * Overpopulation starts there and pauses the queues, so replay steps on it;
 * without it, the start would depend on when the queue happened to be read.
 * Pure of the (immutable) target, so it is computed once per version.
 */
// Keyed by the queue object and checked against everything else it reads:
// income settlement makes a new target every time but keeps these objects.
const overflowByQueue = new WeakMap<object, { fleet: unknown; buildings: unknown; satellites: number; overpopulation: unknown; result: number | null }>();

function fleetOverflowAt(target: FleetProductionTarget): number | null {
  const key = target.fleetProduction;
  const cached = key ? overflowByQueue.get(key) : undefined;
  if (cached && cached.fleet === target.fleet && cached.buildings === target.buildings
    && cached.satellites === satelliteCount(target) && cached.overpopulation === target.overpopulation) return cached.result;
  let result: number | null = null;
  const state = target.fleetProduction;
  if (state && !target.overpopulation && (state.shipQueue.length || state.commanderQueue.length)) {
    const capacity = calculatePlanetCapacity(finiteLevel(migrateBuildingLevels(target.buildings).hangar));
    let population = calculatePlanetPopulation(normalizedFleet(target).fleet, satelliteCount(target), target.raceId);
    const units: Array<{ at: number; population: number }> = [];
    for (const [queueKind, queue] of [['ships', state.shipQueue], ['commanders', state.commanderQueue]] as const) {
      for (const order of queue) {
        const entity = getFleetProductionEntity(queueKind, order.itemId, target.raceId);
        const each = Math.max(0, Math.floor(entity?.population ?? 0));
        if (!each) continue;
        const duration = Math.max(1, Math.round(order.effectiveDurationMs));
        for (let unit = finiteLevel(order.completedQuantity) + 1; unit <= order.quantity; unit += 1) {
          units.push({ at: order.startedAt + duration * unit, population: each });
        }
      }
    }
    units.sort((left, right) => left.at - right.at);
    for (const unit of units) {
      population += unit.population;
      if (population > capacity) { result = unit.at; break; }
    }
  }
  if (key) overflowByQueue.set(key, { fleet: target.fleet, buildings: target.buildings, satellites: satelliteCount(target), overpopulation: target.overpopulation, result });
  return result;
}

export function getNextNpcFleetOverflowCheckpoint(
  target: SpyTargetState,
  ownerId: string,
  after: number,
  through: number,
): number | undefined {
  if (!validOwnerTarget(target, ownerId) || isNpcPlanetBlocked(target)) return undefined;
  const at = fleetOverflowAt(target);
  return at !== null && at > after && at <= through ? at : undefined;
}

/** Returns a bounded timer event only when production is due within the replay range. */
export function getNextNpcFleetProductionCheckpoint(
  target: SpyTargetState,
  ownerId: string,
  after: number,
  through: number,
): number | undefined {
  if (!validOwnerTarget(target, ownerId)) return undefined;
  const due = nextDueAt(target as FleetProductionTarget, after);
  return due != null && due <= through ? due : undefined;
}
