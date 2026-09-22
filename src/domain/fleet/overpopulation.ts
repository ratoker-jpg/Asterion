import { type CommanderId } from '../combat/commanders.ts';
import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import { SHIP_IDS, SOLAR_SATELLITE_ID, type ShipId } from '../combat/ids.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import {
  calculateFleetCapacity,
  calculateFleetPopulation,
  type OwnedFleetState,
} from './runtime.ts';

export const OVERPOPULATION_WINDOW_MS = 10 * 60 * 1000;

export type OverpopulationResolutionReason = 'resolved' | 'no-eligible-units';

export type OverpopulationShipLoss = {
  shipId: Exclude<ShipId, 'solar-satellite'>;
  count: number;
};

export type OverpopulationState = {
  episodeStartedAt: number;
  initialExcess: number;
  /** Exact population snapshot at episode start; absent only in older saves. */
  initialPopulation?: number;
  /** Capacity snapshot at episode start; absent only in older saves. */
  initialCapacity?: number;
  /** Cumulative attrition losses only; combat losses are never included. */
  removedShips?: OverpopulationShipLoss[];
  scheduledBurnPool: number;
  burnedPopulation: number;
  lastReconciledAt: number;
  blocked: boolean;
  lastResolutionReason?: OverpopulationResolutionReason;
};

export type OverpopulationUnit = {
  kind: 'ship' | 'commander';
  id: ShipId | CommanderId;
  population: number;
  slot: number;
};

export type OverpopulationReconciliation = {
  fleet: OwnedFleetState;
  state?: OverpopulationState;
  actualPopulation: number;
  capacity: number;
  excess: number;
  targetPopulation: number;
  removed: OverpopulationUnit[];
  /** Exact losses from this reconciliation, without the diagnostic-list cap. */
  removedShipCounts: OverpopulationShipLoss[];
  changed: boolean;
  blocked: boolean;
};

function safeInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
}

function safeNonNegativeInteger(value: unknown, fallback = 0): number {
  return Math.max(0, safeInteger(value, fallback));
}

function hasEligibleBurnUnits(fleet: OwnedFleetState, factionId: CombatFactionId): boolean {
  return getFactionShipCatalog(factionId).some((entity) => entity.id !== SOLAR_SATELLITE_ID
    && safeNonNegativeInteger(fleet.ships[entity.id as ShipId]) > 0
    && safeNonNegativeInteger(entity.population) > 0);
}

function cloneFleet(fleet: OwnedFleetState): OwnedFleetState {
  return {
    ships: { ...fleet.ships },
    commanders: { ...fleet.commanders },
  };
}

function clampElapsed(now: number, startedAt: number): number {
  return Math.min(OVERPOPULATION_WINDOW_MS, Math.max(0, now - startedAt));
}

/** Population used by the planetary capacity and overpopulation rules. */
export function calculatePlanetPopulation(
  fleet: OwnedFleetState,
  solarSatellites: number,
  factionId: CombatFactionId = 'aegis',
): number {
  return calculateFleetPopulation(fleet, factionId) + safeNonNegativeInteger(solarSatellites);
}

export function calculatePlanetCapacity(hangarLevel: number): number {
  return calculateFleetCapacity(hangarLevel);
}

export function isPlanetOverpopulated(actualPopulation: number, capacity: number): boolean {
  return actualPopulation > capacity;
}

/**
 * Returns the only units that the attrition resolver may destroy. The order is
 * part of the domain contract: population first, then stable id, then slot.
 */
export function getOverpopulationEligibleUnits(
  fleet: OwnedFleetState,
  factionId: CombatFactionId = 'aegis',
): OverpopulationUnit[] {
  const units: OverpopulationUnit[] = [];
  for (const entity of getFactionShipCatalog(factionId)) {
    if (entity.id === SOLAR_SATELLITE_ID) continue;
    const quantity = safeNonNegativeInteger(fleet.ships[entity.id as ShipId]);
    for (let slot = 0; slot < quantity; slot += 1) {
      units.push({ kind: 'ship', id: entity.id as ShipId, population: Math.max(0, Math.floor(entity.population)), slot });
    }
  }
  units.sort((left, right) => left.population - right.population || String(left.id).localeCompare(String(right.id)) || left.slot - right.slot);
  return units;
}

function removeUnitsToTarget(
  fleet: OwnedFleetState,
  targetPopulation: number,
  actualPopulation: number,
  factionId: CombatFactionId,
): { fleet: OwnedFleetState; removed: OverpopulationUnit[]; actualPopulation: number } {
  const next = cloneFleet(fleet);
  const removed: OverpopulationUnit[] = [];
  let population = actualPopulation;
  if (population <= targetPopulation) return { fleet: next, removed, actualPopulation: population };

  // Work by catalog groups rather than expanding every hull into an array;
  // damaged saves may contain millions of units. The detail list remains
  // useful for diagnostics while the state transition stays bounded.
  const groups = getFactionShipCatalog(factionId)
    .filter((entity) => entity.id !== SOLAR_SATELLITE_ID)
    .map((entity) => ({
      id: entity.id as ShipId,
      population: Math.max(0, Math.floor(entity.population)),
      quantity: safeNonNegativeInteger(next.ships[entity.id as ShipId]),
    }))
    .filter((group) => group.quantity > 0 && group.population > 0)
    .sort((left, right) => left.population - right.population || String(left.id).localeCompare(String(right.id)));
  for (const group of groups) {
    if (population <= targetPopulation) break;
    const remove = Math.min(group.quantity, Math.ceil((population - targetPopulation) / group.population));
    if (remove <= 0) continue;
    next.ships[group.id] = Math.max(0, (next.ships[group.id] ?? 0) - remove);
    population -= remove * group.population;
    for (let slot = 0; slot < Math.min(remove, 1_024 - removed.length); slot += 1) {
      removed.push({ kind: 'ship', id: group.id, population: group.population, slot });
    }
  }
  return { fleet: next, removed, actualPopulation: population };
}

function normalizeEpisode(value: OverpopulationState | undefined): OverpopulationState | undefined {
  if (!value || !value.blocked) return undefined;
  const episodeStartedAt = safeNonNegativeInteger(value.episodeStartedAt);
  const validShipIds = new Set<string>(SHIP_IDS.filter((id) => id !== SOLAR_SATELLITE_ID));
  const removedShipCounts = new Map<Exclude<ShipId, 'solar-satellite'>, number>();
  for (const loss of value.removedShips ?? []) {
    if (!validShipIds.has(loss.shipId) || !Number.isFinite(loss.count) || loss.count <= 0) continue;
    const shipId = loss.shipId as Exclude<ShipId, 'solar-satellite'>;
    const count = Math.floor(loss.count);
    if (count > 0) removedShipCounts.set(shipId, (removedShipCounts.get(shipId) ?? 0) + count);
  }
  return {
    episodeStartedAt,
    initialExcess: safeNonNegativeInteger(value.initialExcess),
    ...(Number.isFinite(value.initialPopulation) && (value.initialPopulation ?? -1) >= 0
      ? { initialPopulation: safeNonNegativeInteger(value.initialPopulation) }
      : {}),
    ...(Number.isFinite(value.initialCapacity) && (value.initialCapacity ?? -1) >= 0
      ? { initialCapacity: safeNonNegativeInteger(value.initialCapacity) }
      : {}),
    ...(Array.isArray(value.removedShips)
      ? { removedShips: [...removedShipCounts.entries()].map(([shipId, count]) => ({ shipId, count })) }
      : {}),
    scheduledBurnPool: safeNonNegativeInteger(value.scheduledBurnPool),
    burnedPopulation: safeNonNegativeInteger(value.burnedPopulation),
    lastReconciledAt: safeNonNegativeInteger(value.lastReconciledAt, episodeStartedAt),
    blocked: true,
    ...(value.lastResolutionReason ? { lastResolutionReason: value.lastResolutionReason } : {}),
  };
}

function countRemovedShips(
  previous: OwnedFleetState,
  next: OwnedFleetState,
  factionId: CombatFactionId,
): OverpopulationShipLoss[] {
  return getFactionShipCatalog(factionId)
    .filter((entity) => entity.id !== SOLAR_SATELLITE_ID)
    .flatMap((entity) => {
      const shipId = entity.id as Exclude<ShipId, 'solar-satellite'>;
      const count = Math.max(0,
        safeNonNegativeInteger(previous.ships[shipId]) - safeNonNegativeInteger(next.ships[shipId]));
      return count > 0 ? [{ shipId, count }] : [];
    });
}

function accumulateRemovedShips(
  previous: readonly OverpopulationShipLoss[],
  added: readonly OverpopulationShipLoss[],
): OverpopulationShipLoss[] {
  const counts = new Map<Exclude<ShipId, 'solar-satellite'>, number>();
  for (const loss of [...previous, ...added]) {
    counts.set(loss.shipId, (counts.get(loss.shipId) ?? 0) + loss.count);
  }
  return [...counts.entries()].map(([shipId, count]) => ({ shipId, count }));
}

/**
 * Applies the persisted linear burn schedule without mutating commanders or
 * orbital satellites. A newly arrived excess amount extends the current burn
 * pool but never resets the original episode deadline.
 */
export function reconcileOverpopulation(
  fleet: OwnedFleetState,
  solarSatellites: number,
  hangarLevel: number,
  factionId: CombatFactionId,
  now: number,
  current?: OverpopulationState,
): OverpopulationReconciliation {
  const safeNow = Number.isFinite(now) ? Math.max(0, Math.floor(now)) : 0;
  const capacity = calculatePlanetCapacity(hangarLevel);
  const initialPopulation = calculatePlanetPopulation(fleet, solarSatellites, factionId);
  const initialExcess = Math.max(0, initialPopulation - capacity);
  const episode = normalizeEpisode(current);
  if (initialExcess <= 0) {
    return {
      fleet,
      state: undefined,
      actualPopulation: initialPopulation,
      capacity,
      excess: 0,
      targetPopulation: capacity,
      removed: [],
      removedShipCounts: [],
      changed: Boolean(episode),
      blocked: false,
    };
  }

  const startedAt = episode?.episodeStartedAt ?? safeNow;
  const elapsed = clampElapsed(safeNow, startedAt);
  const elapsedFraction = elapsed / OVERPOPULATION_WINDOW_MS;
  const previousPool = episode?.scheduledBurnPool ?? initialExcess;
  const previousBurned = Math.min(previousPool, episode?.burnedPopulation ?? 0);
  const previousRemaining = Math.max(0, previousPool - previousBurned);
  const additionalExcess = Math.max(0, initialExcess - previousRemaining);
  const scheduledBurnPool = previousPool + additionalExcess;
  const targetBurn = Math.floor(scheduledBurnPool * elapsedFraction);
  const remainingScheduledExcess = elapsed >= OVERPOPULATION_WINDOW_MS
    ? 0
    : Math.max(0, scheduledBurnPool - targetBurn);
  const targetPopulation = capacity + remainingScheduledExcess;
  const removedResult = removeUnitsToTarget(fleet, targetPopulation, initialPopulation, factionId);
  const removedShipCounts = countRemovedShips(fleet, removedResult.fleet, factionId);
  const actualPopulation = removedResult.actualPopulation;
  const blocked = actualPopulation > capacity;
  const burnedPopulation = (episode?.burnedPopulation ?? 0)
    + Math.max(0, initialPopulation - actualPopulation);

  if (!blocked) {
    return {
      fleet: removedResult.fleet,
      state: undefined,
      actualPopulation,
      capacity,
      excess: 0,
      targetPopulation,
      removed: removedResult.removed,
      removedShipCounts,
      changed: removedResult.removed.length > 0 || Boolean(episode),
      blocked: false,
    };
  }

  const nextState: OverpopulationState = {
    episodeStartedAt: startedAt,
    initialExcess: episode?.initialExcess ?? initialExcess,
    initialPopulation: episode?.initialPopulation ?? initialPopulation,
    initialCapacity: episode?.initialCapacity ?? capacity,
    removedShips: accumulateRemovedShips(episode?.removedShips ?? [], removedShipCounts),
    scheduledBurnPool,
    burnedPopulation,
    lastReconciledAt: safeNow,
    blocked: true,
    ...(removedResult.removed.length === 0 && initialExcess > 0 && !hasEligibleBurnUnits(fleet, factionId)
      ? { lastResolutionReason: 'no-eligible-units' as const }
      : {}),
  };
  return {
    fleet: removedResult.fleet,
    state: nextState,
    actualPopulation,
    capacity,
    excess: Math.max(0, actualPopulation - capacity),
    targetPopulation,
    removed: removedResult.removed,
    removedShipCounts,
    changed: removedResult.removed.length > 0 || JSON.stringify(episode) !== JSON.stringify(nextState),
    blocked: true,
  };
}

/** A pure guard for application layers and UI selectors. */
export function isFleetStateOverpopulated(
  fleet: OwnedFleetState,
  solarSatellites: number,
  hangarLevel: number,
  factionId: CombatFactionId,
): boolean {
  return isPlanetOverpopulated(
    calculatePlanetPopulation(fleet, solarSatellites, factionId),
    calculatePlanetCapacity(hangarLevel),
  );
}
