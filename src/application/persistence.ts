import {
  createDefaultBattleHistory,
  migrateBattleHistory,
} from '../domain/combat/battle-repository.ts';
import {
  COMBAT_SAVE_SCHEMA_VERSION,
  createDefaultCombatPriority,
  migrateCombatPriority,
} from '../domain/combat/priority.ts';
import {
  createDefaultSimulatorState,
  migrateSimulatorState,
} from '../domain/combat/simulator-repository.ts';
import {
  createDefaultCommandState,
  migrateCommandState,
} from '../domain/command/repository.ts';
import {
  createDefaultOperationsState,
  migrateOperationsState,
} from '../domain/operations/repository.ts';
import {
  createDefaultRatingPrototypeState,
  migrateRatingPrototypeState,
} from '../domain/rating/fixtures.ts';
import {
  buildReportsFeed,
} from '../domain/reports/adapters.ts';
import {
  createDefaultReportsState,
  migrateReportsState,
} from '../domain/reports/repository.ts';
import {
  createDefaultPlayerProfileState,
  CURRENT_PLAYER_FACTION_ID,
  migratePlayerProfileState,
  syncPlayerProfileWithAlliance,
  syncPlayerProfileWithFaction,
} from '../domain/profile/repository.ts';
import {
  createDefaultScienceState,
  migrateScienceState,
  SCIENCE_SAVE_SCHEMA_VERSION,
} from '../domain/science/runtime.ts';
import {
  ACTIVE_RUNTIME_MODE,
  getRuntimeSaveKey,
  resolveTestTimeScale,
  RUNTIME_SAVE_SCHEMA_VERSION,
  TEST_TIME_SCALE_STORAGE_KEY,
  type RuntimeMode,
  type TestTimeScale,
} from '../domain/runtime/mode.ts';
import {
  createCanonicalStartingFleet,
  createEmptyFleetState,
  normalizeFleetStateForCapacity,
  removeSolarSatellitesFromFleet,
  resolveSavedFleetState,
} from '../domain/fleet/runtime.ts';
import {
  createDefaultFleetProductionState,
  createEmptyDefenseState,
  migrateDefenseState,
  migrateFleetProductionState,
  reconcileFleetProductionState,
} from '../domain/fleet/production.ts';
import {
  createCanonicalStartingBuildingLevels,
  createDefaultBuildingLevels,
  getStorageCapacities,
  migrateBuildingLevels,
  migrateBuildingQueue,
  type BuildingQueueItem,
} from '../domain/buildings/resource-zone.ts';
import {
  createEmptyBotAssignment,
  migrateProductionBotAssignment,
} from '../domain/buildings/production-bots.ts';
import {
  createDefaultRecyclingState,
  migrateRecyclingState,
  resolveRecyclingFixture,
} from '../domain/buildings/recycling.ts';
import {
  createDefaultSpaceportUpgradeState,
  migrateSpaceportUpgradeState,
  reconcileSpaceportUpgradeState,
} from '../domain/buildings/spaceport-upgrades.ts';
import {
  createDefaultTradeState,
  migrateTradeState,
} from '../domain/buildings/trade.ts';
import {
  createDefaultRepairWorkshopState,
  createTestRepairWorkshopState,
  migrateRepairWorkshopState,
} from '../domain/repair/workshop.ts';
import { initializePlanetEnergy, syncPlanetEnergySources } from './energy.ts';
import type { EnergyLedger } from '../domain/energy/runtime.ts';
import type { PlanetQueueRecord, PlanetResources, PlanetStateRecord, ResourceClock, ResourceClockEntry, SaveState, PlanetRuntime } from './contracts.ts';
import type { AlliedPlanetState } from './contracts.ts';
import { SHIP_IDS } from '../domain/combat/ids.ts';
import { isFlightCoordinate } from '../domain/flights/distance.ts';
import type {
  FlightCompletionReason,
  FlightDestination,
  FlightPhase,
  FlightRecord,
  FlightState,
  MissionId,
  TargetRelation,
  TransportCargoState,
} from '../domain/flights/types.ts';
import { normalizePersistedTransportCargo } from '../domain/flights/cargo.ts';
import type { UniverseObjectKind } from '../domain/universe/types.ts';
import { TEST_MODE_ALLY_PLANET_FIXTURE } from '../domain/universe/runtime.ts';

export const SAVE_SCHEMA_VERSION = Math.max(
  COMBAT_SAVE_SCHEMA_VERSION,
  SCIENCE_SAVE_SCHEMA_VERSION,
  RUNTIME_SAVE_SCHEMA_VERSION,
);

export const DEFAULT_PLANET_NAME = 'Helion 01';
export const TEST_MODE_RESOURCE_AMOUNT = 999_999_999;

const KNOWN_PLANET_SKINS = new Set([
  'colonized', 'terran', 'oceanic', 'desert', 'ice', 'volcanic', 'toxic', 'barren', 'gas',
  'skin-002', 'skin-003', 'skin-005', 'skin-011', 'skin-012', 'skin-015', 'skin-016',
  'skin-026', 'skin-027', 'skin-028', 'skin-030', 'skin-032',
]);

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type StoredPlanetRuntime = {
  name?: unknown;
  skin?: unknown;
  population?: unknown;
  populationMax?: unknown;
  fleet?: unknown;
  defense?: unknown;
  fleetProduction?: unknown;
  repair?: unknown;
  energy?: unknown;
  energyLedger?: unknown;
  producedEnergy?: unknown;
  consumedEnergy?: unknown;
  availableEnergy?: unknown;
  energySources?: unknown;
  energyExpenseAttribution?: unknown;
  solarSatellites?: unknown;
  universeSystem?: unknown;
  universeGalaxy?: unknown;
  universePosition?: unknown;
  buildings?: unknown;
  productionBots?: unknown;
  recycling?: unknown;
  trade?: unknown;
  spaceportUpgrades?: unknown;
  solarStations?: unknown;
  stability?: unknown;
  resources?: unknown;
};

type StoredSave = {
  schemaVersion?: unknown;
  metal?: unknown;
  minerals?: unknown;
  gas?: unknown;
  planetSkin?: unknown;
  population?: unknown;
  energy?: unknown;
  solarStations?: unknown;
  planets?: Record<string, StoredPlanetRuntime>;
  queues?: Record<string, unknown>;
  queue?: unknown;
  rating?: unknown;
  profile?: unknown;
  combatPriority?: unknown;
  combat?: unknown;
  combatSimulator?: unknown;
  operations?: unknown;
  command?: unknown;
  reports?: unknown;
  science?: unknown;
  resourceClock?: unknown;
  currentPlanetId?: unknown;
  flights?: unknown;
  alliedPlanets?: Record<string, unknown>;
};

export type PersistenceWriteResult =
  | { ok: true }
  | { ok: false; error: string };

export type PersistenceOptions = {
  mode?: RuntimeMode;
  storage?: StorageLike | null;
  now?: () => number;
  testTimeScale?: TestTimeScale;
};

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  return typeof window === 'undefined' ? null : window.localStorage;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonNegativeNumberOr(value: unknown, fallback: number): number {
  const resolved = numberOr(value, fallback);
  return Math.max(0, resolved);
}

function createResourceClockEntry(now: number): ResourceClockEntry {
  const safeNow = nonNegativeNumberOr(now, Date.now());
  return {
    lastReconciledAt: safeNow,
    remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 },
  };
}

function createResourceClock(now: number, planetIds: readonly string[] = ['helion-01']): ResourceClock {
  const entry = createResourceClockEntry(now);
  return {
    ...entry,
    byPlanet: Object.fromEntries(planetIds.map((planetId) => [planetId, { ...entry, remainder: { ...entry.remainder } }])) as Record<string, ResourceClockEntry>,
  };
}

function migrateResourceClockEntry(value: unknown, now: number, fallback?: ResourceClockEntry): ResourceClockEntry {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const safeNow = nonNegativeNumberOr(now, Date.now());
  const rawLast = numberOr(source.lastReconciledAt, fallback?.lastReconciledAt ?? safeNow);
  const lastReconciledAt = Math.min(safeNow, Math.max(0, rawLast));
  const rawRemainder = source.remainder && typeof source.remainder === 'object' && !Array.isArray(source.remainder)
    ? source.remainder as Record<string, unknown>
    : {};
  const remainder = (key: keyof ResourceClock['remainder']) => {
    const resolved = numberOr(rawRemainder[key], fallback?.remainder[key] ?? 0);
    return Math.min(0.999_999_999, Math.max(0, resolved));
  };
  return {
    lastReconciledAt,
    remainder: {
      metal: remainder('metal'),
      minerals: remainder('minerals'),
      gas: remainder('gas'),
      // Legacy clock field retained for save compatibility; energy has no
      // passive runtime income yet.
      energy: 0,
    },
  };
}

function migrateResourceClock(value: unknown, now: number, planetIds: readonly string[]): ResourceClock {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const legacy = migrateResourceClockEntry(source, now);
  const rawByPlanet = source.byPlanet && typeof source.byPlanet === 'object' && !Array.isArray(source.byPlanet)
    ? source.byPlanet as Record<string, unknown>
    : source.planets && typeof source.planets === 'object' && !Array.isArray(source.planets)
      ? source.planets as Record<string, unknown>
      : {};
  const byPlanet = Object.fromEntries(planetIds.map((planetId) => [
    planetId,
    migrateResourceClockEntry(rawByPlanet[planetId], now, legacy),
  ])) as Record<string, ResourceClockEntry>;
  const homeworld = byPlanet['helion-01'] ?? legacy;
  return { ...homeworld, byPlanet };
}

function normalizeStoredResource(value: unknown, fallback: number, capacity: number): number {
  const candidate = value === undefined ? fallback : nonNegativeNumberOr(value, 0);
  return Math.min(Math.max(0, capacity), candidate);
}

function normalizePlanetResources(
  value: unknown,
  fallback: PlanetResources,
  capacities?: ReturnType<typeof getStorageCapacities>,
): PlanetResources {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    metal: Math.min(capacities?.metal ?? Number.POSITIVE_INFINITY, nonNegativeNumberOr(source.metal, fallback.metal)),
    minerals: Math.min(capacities?.minerals ?? Number.POSITIVE_INFINITY, nonNegativeNumberOr(source.minerals, fallback.minerals)),
    gas: Math.min(capacities?.gas ?? Number.POSITIVE_INFINITY, nonNegativeNumberOr(source.gas, fallback.gas)),
  };
}

function createDefaultFlightState(): FlightState {
  return { records: [], requestIndex: {} };
}

const PERSISTED_FLIGHT_MISSIONS = new Set<MissionId>([
  'transport',
  'espionage',
  'attack',
  'deployment',
  'colonize',
  'recycle',
  'gas',
  'sun-support',
  'space-flight',
]);
const PERSISTED_FLIGHT_PHASES = new Set<FlightPhase>([
  'outbound',
  'returning',
  'arrived',
  'completed',
  'failed',
]);
const PERSISTED_FLIGHT_COMPLETION_REASONS = new Set<FlightCompletionReason>([
  'normal',
  'normal-return',
  'recalled',
  'colonized',
  'target-occupied',
  'target-unavailable',
  'arrived',
  'mission-failed',
]);
const PERSISTED_FLIGHT_DESTINATION_KINDS = new Set<FlightDestination['kind']>([
  'coordinate',
  'planet',
  'operation',
]);
const PERSISTED_UNIVERSE_OBJECT_KINDS = new Set<UniverseObjectKind>([
  'empty',
  'player',
  'npc',
  'uninhabited',
  'unique',
  'pirate',
  'anomaly',
  'asteroid',
]);
const PERSISTED_TARGET_RELATIONS = new Set<TargetRelation>(['self', 'ally']);
const PERSISTED_CARGO_STATES = new Set<TransportCargoState>(['loaded', 'delivered', 'voided', 'returned']);

function isFinitePersistedNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFinitePersistedNumber(value) && Number.isInteger(value) && value >= 0;
}

function isNonEmptyPersistedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function coordinatesMatch(left: unknown, right: unknown): boolean {
  if (!isFlightCoordinate(left) || !isFlightCoordinate(right)) return false;
  return left.galaxy === right.galaxy
    && left.system === right.system
    && left.position === right.position;
}

/**
 * Flight records are consumed by reconciliation as executable state, not as
 * optional UI history. Reject incomplete nested records at the persistence
 * boundary so a damaged save cannot reserve ships forever or strand an
 * outbound flight whose timers/coordinates are missing.
 */
function isPersistedFlightRecord(value: unknown): value is FlightRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (!isNonEmptyPersistedString(item.id)
    || !isNonEmptyPersistedString(item.requestId)
    || !isNonEmptyPersistedString(item.originPlanetId)
    || !PERSISTED_FLIGHT_MISSIONS.has(item.missionId as MissionId)
    || !PERSISTED_FLIGHT_PHASES.has(item.phase as FlightPhase)
    || !isFlightCoordinate(item.originCoordinate)
    || !isFlightCoordinate(item.destinationCoordinate)
    || !isNonNegativeInteger(item.populationReserved)
    || !isFinitePersistedNumber(item.routeDistance)
    || item.routeDistance <= 0
    || !isFinitePersistedNumber(item.effectiveSpeed)
    || item.effectiveSpeed <= 0
    || !isFinitePersistedNumber(item.oneWayDurationMs)
    || item.oneWayDurationMs <= 0
    || !isFinitePersistedNumber(item.departedAt)
    || !isFinitePersistedNumber(item.arrivalAt)
    || item.arrivalAt <= item.departedAt
    || !isFinitePersistedNumber(item.gasCost)
    || item.gasCost < 0) return false;

  if (item.operationId !== undefined && !isNonEmptyPersistedString(item.operationId)) return false;
  if (item.destinationPlanetId !== undefined && !isNonEmptyPersistedString(item.destinationPlanetId)) return false;
  if (item.destinationOwnerId !== undefined && !isNonEmptyPersistedString(item.destinationOwnerId)) return false;
  if (item.targetRelation !== undefined && !PERSISTED_TARGET_RELATIONS.has(item.targetRelation as TargetRelation)) return false;
  if (item.cargoState !== undefined && !PERSISTED_CARGO_STATES.has(item.cargoState as TransportCargoState)) return false;
  if (item.missionId === 'transport') {
    const cargo = normalizePersistedTransportCargo(item.cargo);
    if (!cargo) return false;
    if (item.targetRelation === undefined || item.destinationPlanetId === undefined) return false;
    if (item.cargoState === undefined) return false;
  }
  if (item.targetKind !== undefined && !PERSISTED_UNIVERSE_OBJECT_KINDS.has(item.targetKind as UniverseObjectKind)) return false;
  if (item.completionReason !== undefined
    && !PERSISTED_FLIGHT_COMPLETION_REASONS.has(item.completionReason as FlightCompletionReason)) return false;
  for (const timestamp of ['returnAt', 'recalledAt', 'arrivedAt', 'completedAt'] as const) {
    if (item[timestamp] !== undefined && !isFinitePersistedNumber(item[timestamp])) return false;
  }

  const destination = item.destination;
  if (!destination || typeof destination !== 'object' || Array.isArray(destination)) return false;
  const destinationRecord = destination as Record<string, unknown>;
  if (!PERSISTED_FLIGHT_DESTINATION_KINDS.has(destinationRecord.kind as FlightDestination['kind'])
    || !coordinatesMatch(destinationRecord.coordinate, item.destinationCoordinate)) return false;
  if (destinationRecord.kind === 'planet') {
    if (!isNonEmptyPersistedString(destinationRecord.planetId)
      || item.destinationPlanetId !== destinationRecord.planetId) return false;
  } else if (item.destinationPlanetId !== undefined && item.missionId !== 'transport') {
    return false;
  }
  if (destinationRecord.kind === 'operation') {
    if (!isNonEmptyPersistedString(destinationRecord.operationId)
      || item.operationId !== destinationRecord.operationId) return false;
  }

  const selectedShips = item.selectedShips;
  if (!selectedShips || typeof selectedShips !== 'object' || Array.isArray(selectedShips)) return false;
  const shipEntries = Object.entries(selectedShips);
  if (shipEntries.length === 0) return false;
  for (const [shipId, quantity] of shipEntries) {
    if (!SHIP_IDS.includes(shipId as (typeof SHIP_IDS)[number])
      || !isNonNegativeInteger(quantity)
      || quantity <= 0) return false;
  }

  const phase = item.phase as FlightPhase;
  if (phase === 'returning' && (!isFinitePersistedNumber(item.returnAt) || item.returnAt < item.departedAt)) return false;
  if (phase === 'arrived' && !isFinitePersistedNumber(item.arrivedAt)) return false;
  if ((phase === 'completed' || phase === 'failed') && !isFinitePersistedNumber(item.completedAt)) return false;
  return true;
}

function normalizePersistedFlightRecord(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  if (source.missionId !== 'transport') return value;
  const cargo = normalizePersistedTransportCargo(source.cargo);
  if (!cargo) return value;
  return { ...source, cargo };
}

function migrateFlightState(value: unknown): FlightState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createDefaultFlightState();
  const source = value as Record<string, unknown>;
  const records: FlightRecord[] = [];
  const seenIds = new Set<string>();
  const seenRequestIds = new Set<string>();
  if (Array.isArray(source.records)) {
    for (const rawCandidate of source.records) {
      const candidate = normalizePersistedFlightRecord(rawCandidate);
      if (!isPersistedFlightRecord(candidate)) continue;
      if (seenIds.has(candidate.id) || seenRequestIds.has(candidate.requestId)) continue;
      seenIds.add(candidate.id);
      seenRequestIds.add(candidate.requestId);
      records.push(candidate);
    }
  }
  // The index is derived from validated records. A stale or forged index must
  // never resurrect a dropped flight or point a request at another flight.
  const requestIndex = Object.fromEntries(records.map((record) => [record.requestId, record.id]));
  return { records, requestIndex };
}

function createDefaultAlliedPlanetState(
  mode: RuntimeMode,
  now: number,
  scienceLevels: ReturnType<typeof createDefaultScienceState>['levels'],
): AlliedPlanetState {
  const fixture = TEST_MODE_ALLY_PLANET_FIXTURE;
  const buildings = createCanonicalStartingBuildingLevels();
  if (mode === 'test') {
    buildings['metal-storage'] = 20;
    buildings['mineral-storage'] = 20;
    buildings['gas-storage'] = 20;
  }
  const planet: PlanetRuntime = {
    name: fixture.planet.name,
    skin: 'colonized',
    fleet: createEmptyFleetState(),
    defense: createEmptyDefenseState(),
    fleetProduction: createDefaultFleetProductionState(),
    repair: createDefaultRepairWorkshopState(),
    energy: 0,
    universeGalaxy: fixture.coordinate.galaxy,
    universeSystem: fixture.coordinate.system,
    universePosition: fixture.coordinate.position,
    buildings,
    productionBots: createEmptyBotAssignment(),
    recycling: createDefaultRecyclingState({ mode, fixture: resolveRecyclingFixture(mode) }),
    trade: createDefaultTradeState(),
    spaceportUpgrades: createDefaultSpaceportUpgradeState(),
    stability: 100,
    resources: { metal: 500, minerals: 500, gas: 500 },
  };
  const energized = initializePlanetEnergy(planet, scienceLevels);
  return {
    ...energized,
    id: fixture.planet.id,
    ownerId: fixture.owner.id,
    displayName: fixture.owner.displayName,
    raceId: fixture.owner.raceId ?? CURRENT_PLAYER_FACTION_ID,
    alliance: fixture.owner.alliance ?? null,
    fixtureId: fixture.marker.id,
  };
}

function migrateAlliedPlanets(
  value: Record<string, unknown> | undefined,
  mode: RuntimeMode,
  now: number,
  scienceLevels: ReturnType<typeof createDefaultScienceState>['levels'],
): Record<string, AlliedPlanetState> {
  if (mode !== 'test') return {};
  const fixture = TEST_MODE_ALLY_PLANET_FIXTURE;
  const fallback = createDefaultAlliedPlanetState(mode, now, scienceLevels);
  const raw = value?.[fixture.planet.id];
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as StoredPlanetRuntime
    : undefined;
  const buildings = migrateBuildingLevels(source?.buildings);
  const resources = normalizePlanetResources(
    source?.resources,
    fallback.resources ?? { metal: 500, minerals: 500, gas: 500 },
    getStorageCapacities(buildings),
  );
  const recycling = migrateRecyclingState(
    source?.recycling,
    buildings.recycling,
    now,
    { mode, fixture: resolveRecyclingFixture(mode) },
  );
  return {
    [fixture.planet.id]: {
      ...fallback,
      buildings,
      resources,
      recycling,
      energy: numberOr(source?.energy, fallback.energy),
      stability: numberOr(source?.stability, fallback.stability),
    },
  };
}

function createInitialState(mode: RuntimeMode = ACTIVE_RUNTIME_MODE, now = Date.now()): SaveState {
  const command = createDefaultCommandState(mode);
  const science = createDefaultScienceState();
  const buildings = createCanonicalStartingBuildingLevels();
  if (mode === 'test') {
    buildings['metal-storage'] = 20;
    buildings['mineral-storage'] = 20;
    buildings['gas-storage'] = 20;
  }
  const storageCapacities = getStorageCapacities(buildings);
  const initialResources: PlanetResources = {
    metal: mode === 'test' ? storageCapacities.metal : 15_880,
    minerals: mode === 'test' ? storageCapacities.minerals : 12_712,
    gas: mode === 'test' ? storageCapacities.gas : 6_421,
  };
  const initialPlanet: PlanetRuntime = {
    name: DEFAULT_PLANET_NAME,
    skin: 'colonized',
    fleet: createCanonicalStartingFleet(),
    defense: createEmptyDefenseState(),
    fleetProduction: createDefaultFleetProductionState(),
    energy: mode === 'test' ? TEST_MODE_RESOURCE_AMOUNT : 140,
    solarSatellites: 0,
    universeSystem: 1,
    universeGalaxy: 1,
    universePosition: 1,
    buildings,
    productionBots: createEmptyBotAssignment(),
    recycling: createDefaultRecyclingState({ mode, fixture: resolveRecyclingFixture(mode) }),
    trade: createDefaultTradeState(),
    spaceportUpgrades: createDefaultSpaceportUpgradeState(),
    repair: mode === 'test' ? createTestRepairWorkshopState() : createDefaultRepairWorkshopState(),
    stability: 100,
    resources: initialResources,
  };
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    metal: initialResources.metal,
    minerals: initialResources.minerals,
    gas: initialResources.gas,
    currentPlanetId: 'helion-01',
    planets: { 'helion-01': initializePlanetEnergy(initialPlanet, science.levels) },
    queues: { 'helion-01': [] },
    rating: createDefaultRatingPrototypeState(),
    profile: syncPlayerProfileWithAlliance(createDefaultPlayerProfileState(), command.alliance),
    combatPriority: createDefaultCombatPriority(),
    combat: createDefaultBattleHistory(mode),
    combatSimulator: createDefaultSimulatorState(),
    operations: createDefaultOperationsState(mode),
    command,
    reports: createDefaultReportsState(),
    science,
    resourceClock: createResourceClock(now, ['helion-01']),
    flights: createDefaultFlightState(),
    alliedPlanets: mode === 'test'
      ? { [TEST_MODE_ALLY_PLANET_FIXTURE.planet.id]: createDefaultAlliedPlanetState(mode, now, science.levels) }
      : {},
  };
}

export function createInitialSaveState(mode: RuntimeMode = ACTIVE_RUNTIME_MODE, now = Date.now()): SaveState {
  return createInitialState(mode, now);
}

function readSavedState(options: PersistenceOptions = {}): SaveState {
  const mode = options.mode ?? ACTIVE_RUNTIME_MODE;
  const now = options.now ?? Date.now;
  const testTimeScale = options.testTimeScale ?? resolveTestTimeScale();
  const timestamp = now();
  const initialState = createInitialState(mode, timestamp);
  const storage = resolveStorage(options.storage);
  if (!storage) return initialState;

  try {
    const raw = storage.getItem(getRuntimeSaveKey(mode));
    if (!raw) return initialState;

    const parsed = JSON.parse(raw) as StoredSave;
    const savedHomeworld = parsed.planets?.['helion-01'];
    const legacySolarStations = numberOr(savedHomeworld?.solarStations, numberOr(parsed.solarStations, 0));
    const buildings = migrateBuildingLevels(savedHomeworld?.buildings, legacySolarStations);
    const spaceportUpgrades = reconcileSpaceportUpgradeState(
      migrateSpaceportUpgradeState(savedHomeworld?.spaceportUpgrades),
      timestamp,
    ).state;
    const science = migrateScienceState(parsed.science, {
      laboratoryLevel: buildings.research,
      mode,
      testTimeScale,
      schemaVersion: numberOr(parsed.schemaVersion, 0),
    });
    const combat = migrateBattleHistory(parsed.combat, mode);
    const operations = migrateOperationsState(parsed.operations, mode);
    const command = migrateCommandState(parsed.command, mode);
    const profile = syncPlayerProfileWithAlliance(
      syncPlayerProfileWithFaction(migratePlayerProfileState(parsed.profile), CURRENT_PLAYER_FACTION_ID),
      command.alliance,
    );
    const reportIds = buildReportsFeed(combat.reports, operations, command).map((item) => item.id);
    const migratedSavedFleet = removeSolarSatellitesFromFleet(
      resolveSavedFleetState(savedHomeworld?.fleet, profile.factionId),
    );
    const persistedSatelliteCount = Math.max(
      0,
      Math.floor(numberOr(savedHomeworld?.solarSatellites, migratedSavedFleet.count)),
    );
    const savedFleet = normalizeFleetStateForCapacity(
      migratedSavedFleet.fleet,
      buildings.hangar,
      profile.factionId,
    );
    const savedDefense = migrateDefenseState(savedHomeworld?.defense);
    const migratedFleetProduction = migrateFleetProductionState(savedHomeworld?.fleetProduction, {
      factionId: profile.factionId,
      fleet: savedFleet,
      defense: savedDefense,
      hangarLevel: buildings.hangar,
      solarSatellites: persistedSatelliteCount,
    });
    const reconciledFleetProduction = reconcileFleetProductionState(
      migratedFleetProduction,
      savedFleet,
      savedDefense,
      profile.factionId,
      timestamp,
    );
    const completedSatellites = reconciledFleetProduction.completed
      .filter((item) => item.itemId === 'solar-satellite')
      .reduce((total, item) => total + Math.max(0, Math.floor(item.quantity)), 0);
    const savedSatelliteCount = Math.max(
      0,
      Math.floor(persistedSatelliteCount + completedSatellites),
    );
    const homeworldStorageCapacities = getStorageCapacities(buildings);
    const legacyHomeworldResources: PlanetResources = {
      metal: normalizeStoredResource(parsed.metal, initialState.metal, homeworldStorageCapacities.metal),
      minerals: normalizeStoredResource(parsed.minerals, initialState.minerals, homeworldStorageCapacities.minerals),
      gas: normalizeStoredResource(parsed.gas, initialState.gas, homeworldStorageCapacities.gas),
    };
    const hasRootHomeworldWallet = parsed.metal !== undefined || parsed.minerals !== undefined || parsed.gas !== undefined;
    const homeworldResources = normalizePlanetResources(
      hasRootHomeworldWallet ? legacyHomeworldResources : savedHomeworld?.resources,
      legacyHomeworldResources,
      homeworldStorageCapacities,
    );
    const homeworldBase: PlanetRuntime = {
      name: typeof savedHomeworld?.name === 'string' && savedHomeworld.name.trim()
        ? savedHomeworld.name.trim().slice(0, 28)
        : DEFAULT_PLANET_NAME,
      skin: typeof savedHomeworld?.skin === 'string' && KNOWN_PLANET_SKINS.has(savedHomeworld.skin)
        ? savedHomeworld.skin
        : typeof parsed.planetSkin === 'string' && KNOWN_PLANET_SKINS.has(parsed.planetSkin)
          ? parsed.planetSkin
          : initialState.planets['helion-01'].skin,
      fleet: normalizeFleetStateForCapacity(reconciledFleetProduction.fleet, buildings.hangar, profile.factionId),
      defense: reconciledFleetProduction.defense,
      fleetProduction: reconciledFleetProduction.state,
      repair: mode === 'test' && savedHomeworld?.repair === undefined
        ? createTestRepairWorkshopState()
        : migrateRepairWorkshopState(savedHomeworld?.repair),
      energy: numberOr(savedHomeworld?.energy, numberOr(parsed.energy, initialState.planets['helion-01'].energy)),
      energyLedger: savedHomeworld?.energyLedger && typeof savedHomeworld.energyLedger === 'object'
        ? savedHomeworld.energyLedger as EnergyLedger
        : undefined,
      producedEnergy: optionalNumber(savedHomeworld?.producedEnergy),
      consumedEnergy: optionalNumber(savedHomeworld?.consumedEnergy),
      availableEnergy: optionalNumber(savedHomeworld?.availableEnergy),
      energySources: Array.isArray(savedHomeworld?.energySources)
        ? savedHomeworld.energySources as EnergyLedger['sources']
        : undefined,
      energyExpenseAttribution: savedHomeworld?.energyExpenseAttribution && typeof savedHomeworld.energyExpenseAttribution === 'object'
        ? savedHomeworld.energyExpenseAttribution as Partial<Record<string, number>>
        : undefined,
      solarSatellites: savedSatelliteCount,
      universeGalaxy: numberOr(savedHomeworld?.universeGalaxy, 1),
      universeSystem: numberOr(savedHomeworld?.universeSystem, 1),
      universePosition: numberOr(savedHomeworld?.universePosition, 1),
      buildings,
      productionBots: migrateProductionBotAssignment(savedHomeworld?.productionBots, buildings),
      recycling: migrateRecyclingState(
        savedHomeworld?.recycling,
        buildings.recycling,
        timestamp,
        { mode, fixture: resolveRecyclingFixture(mode) },
      ),
      trade: migrateTradeState(savedHomeworld?.trade, buildings['trade-center'], timestamp),
      spaceportUpgrades,
      stability: numberOr(savedHomeworld?.stability, initialState.planets['helion-01'].stability),
      resources: homeworldResources,
    };
    const homeworld = syncPlanetEnergySources(homeworldBase, science.levels);
    const savedQueue = parsed.queues?.['helion-01'] ?? parsed.queue ?? null;
    const queue = migrateBuildingQueue(savedQueue, 'helion-01', homeworld.buildings, science.levels);
    const storageCapacities = getStorageCapacities(homeworld.buildings);

    const planets: PlanetStateRecord = { 'helion-01': homeworld };
    for (const [planetId, rawValue] of Object.entries(parsed.planets ?? {})) {
      if (planetId === 'helion-01' || !rawValue || typeof rawValue !== 'object') continue;
      const raw = rawValue as StoredPlanetRuntime;
      const planetBuildings = migrateBuildingLevels(raw.buildings);
      const migratedPlanetFleet = removeSolarSatellitesFromFleet(
        resolveSavedFleetState(raw.fleet, profile.factionId),
      );
      const planetSatelliteCount = Math.max(
        0,
        Math.floor(numberOr(raw.solarSatellites, migratedPlanetFleet.count)),
      );
      const planetFleet = normalizeFleetStateForCapacity(
        migratedPlanetFleet.fleet,
        planetBuildings.hangar,
        profile.factionId,
      );
      const planetDefense = migrateDefenseState(raw.defense);
      const planetProduction = migrateFleetProductionState(raw.fleetProduction, {
        factionId: profile.factionId,
        fleet: planetFleet,
        defense: planetDefense,
        hangarLevel: planetBuildings.hangar,
        solarSatellites: planetSatelliteCount,
      });
      const planetBase: PlanetRuntime = {
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 28) : `Колония ${planetId}`,
        skin: typeof raw.skin === 'string' && KNOWN_PLANET_SKINS.has(raw.skin) ? raw.skin : 'colonized',
        fleet: planetFleet,
        defense: planetDefense,
        fleetProduction: planetProduction,
        repair: mode === 'test' && raw.repair === undefined ? createTestRepairWorkshopState() : migrateRepairWorkshopState(raw.repair),
        energy: numberOr(raw.energy, 0),
        energyLedger: raw.energyLedger && typeof raw.energyLedger === 'object' ? raw.energyLedger as EnergyLedger : undefined,
        producedEnergy: optionalNumber(raw.producedEnergy),
        consumedEnergy: optionalNumber(raw.consumedEnergy),
        availableEnergy: optionalNumber(raw.availableEnergy),
        energySources: Array.isArray(raw.energySources) ? raw.energySources as EnergyLedger['sources'] : undefined,
        energyExpenseAttribution: raw.energyExpenseAttribution && typeof raw.energyExpenseAttribution === 'object'
          ? raw.energyExpenseAttribution as Partial<Record<string, number>>
          : undefined,
        solarSatellites: planetSatelliteCount,
        universeGalaxy: numberOr(raw.universeGalaxy, 1),
        universeSystem: numberOr(raw.universeSystem, 1),
        universePosition: numberOr(raw.universePosition, 1),
        buildings: planetBuildings,
        productionBots: migrateProductionBotAssignment(raw.productionBots, planetBuildings),
        recycling: migrateRecyclingState(
          raw.recycling,
          planetBuildings.recycling,
          timestamp,
          { mode, fixture: resolveRecyclingFixture(mode) },
        ),
        trade: migrateTradeState(raw.trade, planetBuildings['trade-center'], timestamp),
        spaceportUpgrades: reconcileSpaceportUpgradeState(migrateSpaceportUpgradeState(raw.spaceportUpgrades), timestamp).state,
        stability: numberOr(raw.stability, 100),
        resources: normalizePlanetResources(raw.resources, { metal: 500, minerals: 500, gas: 500 }, getStorageCapacities(planetBuildings)),
      };
      planets[planetId] = syncPlanetEnergySources(planetBase, science.levels);
    }

    const queues: PlanetQueueRecord = { 'helion-01': queue };
    for (const planetId of Object.keys(planets)) {
      if (planetId === 'helion-01') continue;
      const planet = planets[planetId];
      queues[planetId] = migrateBuildingQueue(parsed.queues?.[planetId], planetId, planet.buildings, science.levels);
    }

    const currentPlanetId = typeof parsed.currentPlanetId === 'string'
      && parsed.currentPlanetId.trim()
      && parsed.currentPlanetId.trim() !== 'helion-01'
      && parsed.planets?.[parsed.currentPlanetId.trim()]
      ? parsed.currentPlanetId.trim()
      : 'helion-01';
    const alliedPlanets = migrateAlliedPlanets(parsed.alliedPlanets, mode, timestamp, science.levels);

    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      metal: homeworldResources.metal,
      minerals: homeworldResources.minerals,
      gas: homeworldResources.gas,
      currentPlanetId,
      planets,
      queues,
      rating: migrateRatingPrototypeState(parsed.rating),
      combatPriority: migrateCombatPriority(parsed.combatPriority),
      combat,
      combatSimulator: migrateSimulatorState(parsed.combatSimulator),
      operations,
      command,
      profile,
      reports: migrateReportsState(parsed.reports, reportIds),
      science,
      resourceClock: migrateResourceClock(parsed.resourceClock, timestamp, Object.keys(planets)),
      flights: migrateFlightState(parsed.flights),
      alliedPlanets,
    };
  } catch {
    return initialState;
  }
}

export function createPersistenceFacade(options: PersistenceOptions = {}) {
  const mode = options.mode ?? ACTIVE_RUNTIME_MODE;
  const storage = resolveStorage(options.storage);
  const saveKey = getRuntimeSaveKey(mode);
  return {
    mode,
    saveKey,
    read: () => readSavedState(options),
    write: (state: SaveState): PersistenceWriteResult => {
      if (!storage) return { ok: false, error: 'Storage is unavailable.' };
      try {
        storage.setItem(saveKey, JSON.stringify(state));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    clear: (): PersistenceWriteResult => {
      if (!storage) return { ok: false, error: 'Storage is unavailable.' };
      try {
        storage.removeItem(saveKey);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    writeTestTimeScale: (value: TestTimeScale): PersistenceWriteResult => {
      if (mode !== 'test' || !storage) return { ok: true };
      try {
        storage.setItem(TEST_TIME_SCALE_STORAGE_KEY, String(value));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

export type PersistenceFacade = ReturnType<typeof createPersistenceFacade>;

export const createDefaultSaveState = createInitialSaveState;
