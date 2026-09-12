import { COMMANDER_COMBAT_CATALOG } from '../combat/catalog.ts';
import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import { COMMANDER_IDS, type CommanderId } from '../combat/commanders.ts';
import { SHIP_IDS, type ShipId } from '../combat/ids.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import { getHangarCapacity } from '../buildings/balance-v1.ts';

export type OwnedFleetState = {
  ships: Record<ShipId, number>;
  commanders: Record<CommanderId, number>;
};

export const FLEET_CAPACITY_CONFIG = Object.freeze({
  baseCapacity: 50,
  levelOneCapacity: 120,
  maxCapacity: 25_112,
  maxHangarLevel: 20,
  note: 'Balance v1: Hangar is the single fleet-capacity resolver; level 0 keeps the planetary base of 50.',
});

export const CANONICAL_STARTING_FLEET = Object.freeze({
  scout: 20,
  transporter: 10,
  recycler: 1,
  'spy-probe': 3,
});

function emptyRecord<T extends string>(ids: readonly T[]): Record<T, number> {
  return Object.fromEntries(ids.map((id) => [id, 0])) as Record<T, number>;
}

export function createEmptyFleetState(): OwnedFleetState {
  return {
    ships: emptyRecord(SHIP_IDS),
    commanders: emptyRecord(COMMANDER_IDS),
  };
}

export function createCanonicalStartingFleet(): OwnedFleetState {
  const fleet = createEmptyFleetState();
  for (const [id, quantity] of Object.entries(CANONICAL_STARTING_FLEET)) {
    fleet.ships[id as ShipId] = quantity;
  }
  return fleet;
}

function safeOwnedQuantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function migrateFleetState(value: unknown): OwnedFleetState {
  const migrated = createEmptyFleetState();
  if (!value || typeof value !== 'object') return migrated;
  const source = value as Record<string, unknown>;
  const ships = source.ships && typeof source.ships === 'object' ? source.ships as Record<string, unknown> : {};
  const commanders = source.commanders && typeof source.commanders === 'object'
    ? source.commanders as Record<string, unknown>
    : {};

  for (const id of SHIP_IDS) migrated.ships[id] = safeOwnedQuantity(ships[id]);
  for (const id of COMMANDER_IDS) migrated.commanders[id] = safeOwnedQuantity(commanders[id]);
  return migrated;
}

/**
 * Legacy saves did not have a fleet field. A missing field means the canonical
 * starting fleet; an explicitly saved value (including an empty object) is
 * preserved through normal migration.
 */
export function resolveSavedFleetState(value: unknown): OwnedFleetState {
  return value === undefined ? createCanonicalStartingFleet() : migrateFleetState(value);
}

function populationForEntity(kind: 'ship' | 'commander', id: string, factionId: CombatFactionId): number | null {
  const entity = kind === 'ship'
    ? getFactionShipCatalog(factionId).find((candidate) => candidate.id === id)
    : COMMANDER_COMBAT_CATALOG.find((candidate) => candidate.id === id);
  return entity ? Math.max(0, Math.floor(entity.population)) : null;
}

export type FleetPopulationTransition = {
  ok: boolean;
  fleet: OwnedFleetState;
  addedPopulation: number;
  population: number;
  capacity: number;
  reason: string | null;
};

/** Adds a future-production result only when its population fits the hangar. */
export function addFleetUnits(
  fleet: OwnedFleetState,
  kind: 'ship' | 'commander',
  id: string,
  quantity: number,
  hangarLevel: number,
  factionId: CombatFactionId = 'aegis',
): FleetPopulationTransition {
  const capacity = calculateFleetCapacity(hangarLevel);
  const population = calculateFleetPopulation(fleet, factionId);
  const safeQuantity = typeof quantity === 'number' && Number.isFinite(quantity) ? Math.floor(quantity) : 0;
  const unitPopulation = populationForEntity(kind, id, factionId);
  if (unitPopulation == null) {
    return { ok: false, fleet, addedPopulation: 0, population, capacity, reason: 'Неизвестная единица флота.' };
  }
  if (safeQuantity <= 0) {
    return { ok: false, fleet, addedPopulation: 0, population, capacity, reason: 'Количество должно быть положительным.' };
  }
  const addedPopulation = unitPopulation * safeQuantity;
  if (population + addedPopulation > capacity) {
    return { ok: false, fleet, addedPopulation: 0, population, capacity, reason: 'Недостаточно населения' };
  }

  const next = {
    ships: { ...fleet.ships },
    commanders: { ...fleet.commanders },
  };
  if (kind === 'ship' && (SHIP_IDS as readonly string[]).includes(id)) {
    next.ships[id as ShipId] += safeQuantity;
  } else if (kind === 'commander' && (COMMANDER_IDS as readonly string[]).includes(id)) {
    next.commanders[id as CommanderId] += safeQuantity;
  } else {
    return { ok: false, fleet, addedPopulation: 0, population, capacity, reason: 'Неизвестная единица флота.' };
  }
  return { ok: true, fleet: next, addedPopulation, population: population + addedPopulation, capacity, reason: null };
}

/** Deterministically trims damaged saved rosters to the current hangar limit. */
export function normalizeFleetStateForCapacity(
  fleet: OwnedFleetState,
  hangarLevel: number,
  factionId: CombatFactionId = 'aegis',
): OwnedFleetState {
  const capacity = calculateFleetCapacity(hangarLevel);
  let population = calculateFleetPopulation(fleet, factionId);
  if (population <= capacity) return fleet;

  const next: OwnedFleetState = {
    ships: { ...fleet.ships },
    commanders: { ...fleet.commanders },
  };
  const removable = [
    ...COMMANDER_COMBAT_CATALOG.map((entity) => ({ kind: 'commander' as const, id: entity.id, population: Math.max(0, Math.floor(entity.population)) })).reverse(),
    ...getFactionShipCatalog(factionId).map((entity) => ({ kind: 'ship' as const, id: entity.id, population: Math.max(0, Math.floor(entity.population)) })).reverse(),
  ];
  for (const entity of removable) {
    if (population <= capacity || entity.population <= 0) break;
    const current = entity.kind === 'ship' ? next.ships[entity.id as ShipId] : next.commanders[entity.id as CommanderId];
    const excess = population - capacity;
    const remove = Math.min(current, Math.ceil(excess / entity.population));
    if (remove <= 0) continue;
    if (entity.kind === 'ship') next.ships[entity.id as ShipId] -= remove;
    else next.commanders[entity.id as CommanderId] -= remove;
    population -= remove * entity.population;
  }
  return next;
}

export function calculateFleetPopulation(
  fleet: OwnedFleetState,
  factionId: CombatFactionId = 'aegis',
): number {
  const ships = getFactionShipCatalog(factionId);
  const shipPopulation = ships.reduce((total, entity) => total + (fleet.ships[entity.id as ShipId] ?? 0) * entity.population, 0);
  const commanderPopulation = COMMANDER_COMBAT_CATALOG.reduce(
    (total, entity) => total + (fleet.commanders[entity.id as CommanderId] ?? 0) * entity.population,
    0,
  );
  return shipPopulation + commanderPopulation;
}

export function calculateFleetCapacity(hangarLevel: number): number {
  return getHangarCapacity(hangarLevel);
}

export function getFleetSummary(fleet: OwnedFleetState, hangarLevel: number, factionId: CombatFactionId = 'aegis') {
  const capacity = calculateFleetCapacity(hangarLevel);
  const normalizedFleet = normalizeFleetStateForCapacity(fleet, hangarLevel, factionId);
  const population = calculateFleetPopulation(normalizedFleet, factionId);
  return { population, capacity, available: Math.max(0, capacity - population) };
}
