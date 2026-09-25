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
  createGasExtractionArrivalReportId,
  createOverpopulationEpisodeReportId,
} from '../domain/reports/adapters.ts';
import type { GasExtractionArrivalReport, OverpopulationEpisodeReport, OrdinaryShipId, RecyclerArrivalReport } from '../domain/reports/types.ts';
import { normalizeCombatFactionId } from '../domain/combat/factions.ts';
import { SHIP_IDS } from '../domain/combat/ids.ts';
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
  TEST_TIME_SCALE_OPTIONS,
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
import type { OverpopulationState } from '../domain/fleet/overpopulation.ts';
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
import { COMMANDER_IDS } from '../domain/combat/commanders.ts';
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
import type { UniverseAsteroidSimulationState, UniverseAsteroidRuntimeState, UniverseCoordinate } from '../domain/universe/types.ts';
import { createUniverseAsteroidSimulationState } from '../domain/universe/asteroid-simulation.ts';
import { initializeAsteroidGasState } from '../domain/universe/asteroid-gas.ts';
import { POSITION_COUNT, SYSTEM_COUNT, TEST_MODE_ALLY_PLANET_FIXTURE, UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import { migrateEspionageState } from '../domain/espionage/repository.ts';
import { createDefaultEspionageState } from '../domain/espionage/runtime.ts';
import { createDefaultTestEspionageState } from '../domain/espionage/fixtures.ts';

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
  overpopulation?: unknown;
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
  asteroidSimulation?: unknown;
  asteroidDebrisBySpawnIndex?: unknown;
  science?: unknown;
  resourceClock?: unknown;
  currentPlanetId?: unknown;
  shipUpgradeLevels?: unknown;
  flights?: unknown;
  espionage?: unknown;
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

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function migrateOverpopulationEpisodeReports(value: unknown): OverpopulationEpisodeReport[] {
  if (!Array.isArray(value)) return [];
  const ordinaryShipIds = new Set<string>(SHIP_IDS.filter((id) => id !== 'solar-satellite'));
  const reports: OverpopulationEpisodeReport[] = [];
  for (const candidate of value) {
    const source = objectRecord(candidate);
    if (!source || typeof source.planetId !== 'string' || !source.planetId.trim()
      || typeof source.planetName !== 'string' || !source.planetName.trim()) continue;
    const numbers = [source.populationBefore, source.populationAfter, source.capacity, source.episodeStartedAt, source.episodeEndedAt];
    if (!numbers.every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0)) continue;
    if ((source.episodeEndedAt as number) < (source.episodeStartedAt as number)) continue;
    const planetId = source.planetId.trim().slice(0, 160);
    const episodeStartedAt = Math.floor(source.episodeStartedAt as number);
    const removedShips = Array.isArray(source.removedShips)
      ? source.removedShips.flatMap((loss) => {
        const record = objectRecord(loss);
        if (!record || typeof record.shipId !== 'string' || !ordinaryShipIds.has(record.shipId)
          || typeof record.count !== 'number' || !Number.isFinite(record.count) || record.count <= 0) return [];
        return [{ shipId: record.shipId as OrdinaryShipId, count: Math.floor(record.count) }].filter((item) => item.count > 0);
      })
      : [];
    reports.push({
      id: createOverpopulationEpisodeReportId(planetId, episodeStartedAt),
      planetId,
      planetName: source.planetName.trim().slice(0, 160),
      factionId: normalizeCombatFactionId(source.factionId),
      populationBefore: Math.floor(source.populationBefore as number),
      populationAfter: Math.floor(source.populationAfter as number),
      capacity: Math.floor(source.capacity as number),
      episodeStartedAt,
      episodeEndedAt: Math.floor(source.episodeEndedAt as number),
      removedShips,
    });
  }
  const byId = new Map(reports.map((report) => [report.id, report]));
  return [...byId.values()].slice(-500);
}

function migrateGasExtractionArrivalReports(value: unknown): GasExtractionArrivalReport[] {
  if (!Array.isArray(value)) return [];
  const byFlightId = new Map<string, GasExtractionArrivalReport>();
  for (const candidate of value) {
    const source = objectRecord(candidate);
    const coordinate = persistedCoordinate(source?.coordinate);
    const flightId = typeof source?.flightId === 'string' ? source.flightId.trim() : '';
    if (!source || !flightId || flightId.length > 160 || !coordinate
      || typeof source.arrivalAt !== 'number' || !Number.isSafeInteger(source.arrivalAt) || source.arrivalAt < 0
      || (source.outcome !== 'found' && source.outcome !== 'missed')
      || typeof source.gasCollected !== 'number' || !Number.isSafeInteger(source.gasCollected) || source.gasCollected < 0
      || typeof source.scrapCollected !== 'number' || !Number.isSafeInteger(source.scrapCollected) || source.scrapCollected < 0
      || (source.outcome === 'missed' && (source.gasCollected !== 0 || source.scrapCollected !== 0))) continue;
    byFlightId.set(flightId, {
      id: createGasExtractionArrivalReportId(flightId),
      flightId,
      coordinate,
      arrivalAt: source.arrivalAt,
      outcome: source.outcome,
      gasCollected: source.gasCollected,
      scrapCollected: source.scrapCollected,
    });
  }
  return [...byFlightId.values()].slice(-500);
}

function persistedCoordinate(value: unknown): UniverseCoordinate | undefined {
  const source = objectRecord(value);
  if (!source) return undefined;
  const { galaxy, system, position } = source;
  if (![galaxy, system, position].every((item) => typeof item === 'number' && Number.isSafeInteger(item) && item >= 1)
    || (system as number) > SYSTEM_COUNT || (position as number) > POSITION_COUNT) return undefined;
  return { galaxy: galaxy as number, system: system as number, position: position as number };
}

function createAsteroidSimulationMigrationBaseline(now: number): UniverseAsteroidSimulationState {
  const timestamp = Number.isSafeInteger(now) && now >= 0 ? now : Date.now();
  const baseline = createUniverseAsteroidSimulationState(timestamp);
  return {
    ...baseline,
    asteroids: baseline.asteroids.map((asteroid) => initializeAsteroidGasState({
      ...asteroid,
      // Projected legacy asteroids have no pre-feature gas history. Start the
      // new accrual clock at migration time rather than at their spawn time.
      gasUpdatedAt: timestamp,
      gasRemainder: 0,
    }, timestamp)),
  };
}

function migrateAsteroidSimulation(value: unknown, now: number): UniverseAsteroidSimulationState {
  const source = objectRecord(value);
  if (!source || source.version !== 1
    || typeof source.processedThroughAt !== 'number' || !Number.isSafeInteger(source.processedThroughAt) || source.processedThroughAt < 0
    || typeof source.nextSpawnIndex !== 'number' || !Number.isSafeInteger(source.nextSpawnIndex) || source.nextSpawnIndex < 0
    || !Array.isArray(source.asteroids)) {
    return createAsteroidSimulationMigrationBaseline(now);
  }
  const seenSpawnIndices = new Set<number>();
  const asteroids: UniverseAsteroidRuntimeState[] = source.asteroids.flatMap((candidate) => {
    const asteroid = objectRecord(candidate);
    if (!asteroid || typeof asteroid.spawnIndex !== 'number' || !Number.isSafeInteger(asteroid.spawnIndex) || asteroid.spawnIndex < 0
      || asteroid.spawnIndex >= (source.nextSpawnIndex as number)
      || seenSpawnIndices.has(asteroid.spawnIndex)) return [];
    const coordinate = persistedCoordinate(asteroid.coordinate);
    const counters = [asteroid.spawnedAt, asteroid.movementIndex, asteroid.previousMoveAt, asteroid.nextMoveAt, asteroid.gasYield];
    if (!coordinate || !counters.every((item) => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0)
      || (asteroid.movementIndex as number) < 0
      || (asteroid.nextMoveAt as number) < (asteroid.previousMoveAt as number)) return [];
    const nextCoordinate = asteroid.nextCoordinate === undefined ? undefined : persistedCoordinate(asteroid.nextCoordinate);
    if (asteroid.nextCoordinate !== undefined && !nextCoordinate) return [];
    seenSpawnIndices.add(asteroid.spawnIndex);
    return [initializeAsteroidGasState({
      spawnIndex: asteroid.spawnIndex,
      spawnedAt: asteroid.spawnedAt as number,
      movementIndex: asteroid.movementIndex as number,
      previousMoveAt: asteroid.previousMoveAt as number,
      nextMoveAt: asteroid.nextMoveAt as number,
      ...(nextCoordinate ? { nextCoordinate } : {}),
      gasYield: asteroid.gasYield as number,
      coordinate,
      ...(typeof asteroid.gasRatePerHour === 'number' ? { gasRatePerHour: asteroid.gasRatePerHour } : {}),
      ...(typeof asteroid.gasUpdatedAt === 'number' ? { gasUpdatedAt: asteroid.gasUpdatedAt } : {}),
      ...(typeof asteroid.gasRemainder === 'number' ? { gasRemainder: asteroid.gasRemainder } : {}),
    }, now)];
  });
  return {
    version: 1,
    processedThroughAt: source.processedThroughAt,
    nextSpawnIndex: source.nextSpawnIndex,
    asteroids,
  };
}

function migrateAsteroidDebris(value: unknown, activeSpawnIndices: ReadonlySet<number>): Record<string, number> {
  const source = objectRecord(value);
  if (!source) return {};
  return Object.fromEntries(Object.entries(source).flatMap(([spawnIndex, amount]) => {
    if (!/^\d+$/.test(spawnIndex) || !Number.isSafeInteger(Number(spawnIndex))
      || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0
      || !activeSpawnIndices.has(Number(spawnIndex))) return [];
    return [[String(Number(spawnIndex)), amount]];
  }));
}

function migrateRecyclerArrivalReports(value: unknown): RecyclerArrivalReport[] {
  if (!Array.isArray(value)) return [];
  const byFlightId = new Map<string, RecyclerArrivalReport>();
  for (const candidate of value) {
    const source = objectRecord(candidate);
    const coordinate = persistedCoordinate(source?.coordinate);
    if (!source || typeof source.flightId !== 'string' || !source.flightId.trim()
      || source.flightId.length > 160 || !coordinate
      || typeof source.arrivedAtMs !== 'number' || !Number.isSafeInteger(source.arrivedAtMs) || source.arrivedAtMs < 0
      || typeof source.collectedDebris !== 'number' || !Number.isSafeInteger(source.collectedDebris) || source.collectedDebris < 0
      || typeof source.remainingOrbitalDebris !== 'number' || !Number.isSafeInteger(source.remainingOrbitalDebris) || source.remainingOrbitalDebris < 0) continue;
    const flightId = source.flightId.trim();
    byFlightId.set(flightId, {
      id: `recycler-arrival:${flightId}`,
      flightId,
      coordinate,
      arrivedAtMs: source.arrivedAtMs,
      collectedDebris: source.collectedDebris,
      remainingOrbitalDebris: source.remainingOrbitalDebris,
    });
  }
  return [...byFlightId.values()];
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

function migrateResourceClock(value: unknown, now: number, planetIds: readonly string[], aliasPlanetId = 'helion-01'): ResourceClock {
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
  const alias = byPlanet[aliasPlanetId] ?? legacy;
  return { ...alias, byPlanet };
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
  'deployed',
  'spy-destroyed',
  'origin-destroyed',
  'mission-failed',
]);
const PERSISTED_FLIGHT_DESTINATION_KINDS = new Set<FlightDestination['kind']>([
  'coordinate',
  'planet',
  'operation',
  'space',
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
const PERSISTED_TARGET_RELATIONS = new Set<TargetRelation>(['self', 'ally', 'enemy', 'neutral']);
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

type PersistedOverpopulationState = OverpopulationState & {
  initialPopulation?: number;
  initialCapacity?: number;
  removedShips?: Array<{ shipId: OrdinaryShipId; count: number }>;
};

function migrateOverpopulationState(value: unknown, now: number): PersistedOverpopulationState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (source.blocked !== true) return undefined;
  const numberField = (key: string, fallback = 0) => {
    const candidate = source[key];
    return isFinitePersistedNumber(candidate) ? Math.max(0, Math.floor(candidate)) : fallback;
  };
  const episodeStartedAt = numberField('episodeStartedAt', Math.max(0, Math.floor(now)));
  const initialPopulation = isFinitePersistedNumber(source.initialPopulation)
    ? Math.max(0, Math.floor(source.initialPopulation))
    : undefined;
  const initialCapacity = isFinitePersistedNumber(source.initialCapacity)
    ? Math.max(0, Math.floor(source.initialCapacity))
    : undefined;
  const ordinaryShipIds = new Set<string>(SHIP_IDS.filter((id) => id !== 'solar-satellite'));
  const removedShipCounts = new Map<OrdinaryShipId, number>();
  if (Array.isArray(source.removedShips)) {
    source.removedShips.forEach((candidate) => {
      const loss = objectRecord(candidate);
      if (!loss || typeof loss.shipId !== 'string' || !ordinaryShipIds.has(loss.shipId)
        || !isFinitePersistedNumber(loss.count) || loss.count <= 0) return;
      const count = Math.floor(loss.count);
      if (count > 0) {
        const shipId = loss.shipId as OrdinaryShipId;
        removedShipCounts.set(shipId, (removedShipCounts.get(shipId) ?? 0) + count);
      }
    });
  }
  const removedShips = removedShipCounts.size > 0
    ? [...removedShipCounts].map(([shipId, count]) => ({ shipId, count }))
    : undefined;
  const reason = source.lastResolutionReason === 'resolved' || source.lastResolutionReason === 'no-eligible-units'
    ? source.lastResolutionReason
    : undefined;
  return {
    episodeStartedAt,
    initialExcess: numberField('initialExcess'),
    scheduledBurnPool: numberField('scheduledBurnPool'),
    burnedPopulation: numberField('burnedPopulation'),
    lastReconciledAt: numberField('lastReconciledAt', episodeStartedAt),
    blocked: true,
    ...(initialPopulation !== undefined ? { initialPopulation } : {}),
    ...(initialCapacity !== undefined ? { initialCapacity } : {}),
    ...(removedShips ? { removedShips } : {}),
    ...(reason ? { lastResolutionReason: reason } : {}),
  };
}

function coordinatesMatch(left: unknown, right: unknown): boolean {
  if (!isFlightCoordinate(left) || !isFlightCoordinate(right)) return false;
  return left.galaxy === right.galaxy
    && left.system === right.system
    && left.position === right.position;
}

function isValidPersistedSpaceFlightDuration(durationMs: number, mode: RuntimeMode): boolean {
  const minimumMs = 5 * 60_000;
  const maximumMs = (11 * 60 + 59) * 60_000;
  if (mode === 'production') {
    return durationMs >= minimumMs
      && durationMs <= maximumMs
      && durationMs % 60_000 === 0;
  }

  return TEST_TIME_SCALE_OPTIONS.some((scale) => {
    const requestedMinutes = Math.round(durationMs * scale / 60_000);
    return requestedMinutes >= 5
      && requestedMinutes <= 11 * 60 + 59
      && Math.round(requestedMinutes * 60_000 / scale) === durationMs;
  });
}

/**
 * Flight records are consumed by reconciliation as executable state, not as
 * optional UI history. Reject incomplete nested records at the persistence
 * boundary so a damaged save cannot reserve ships forever or strand an
 * outbound flight whose timers/coordinates are missing.
 */
function isPersistedFlightRecord(value: unknown, mode: RuntimeMode): value is FlightRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const isSpaceFlight = item.missionId === 'space-flight';
  if (!isNonEmptyPersistedString(item.id)
    || !isNonEmptyPersistedString(item.requestId)
    || !isNonEmptyPersistedString(item.originPlanetId)
    || !PERSISTED_FLIGHT_MISSIONS.has(item.missionId as MissionId)
    || !PERSISTED_FLIGHT_PHASES.has(item.phase as FlightPhase)
    || !isFlightCoordinate(item.originCoordinate)
    || !isFlightCoordinate(item.destinationCoordinate)
    || !isNonNegativeInteger(item.populationReserved)
    || !isFinitePersistedNumber(item.routeDistance)
    || (isSpaceFlight ? item.routeDistance !== 0 : item.routeDistance <= 0)
    || !isFinitePersistedNumber(item.effectiveSpeed)
    || (isSpaceFlight ? item.effectiveSpeed !== 0 : item.effectiveSpeed <= 0)
    || !isFinitePersistedNumber(item.oneWayDurationMs)
    || item.oneWayDurationMs <= 0
    || !isFinitePersistedNumber(item.departedAt)
    || !isFinitePersistedNumber(item.arrivalAt)
    || item.arrivalAt <= item.departedAt
    || !isFinitePersistedNumber(item.gasCost)
    || item.gasCost < 0
    || (isSpaceFlight && item.gasCost !== 100)) return false;

  if ((item.ownerSide !== undefined && item.ownerSide !== 'player' && item.ownerSide !== 'bot01')
    || (item.ownerSide === 'bot01' && item.missionId !== 'attack')) return false;

  if (item.operationId !== undefined && !isNonEmptyPersistedString(item.operationId)) return false;
  if (item.spyMissionId !== undefined && !isNonEmptyPersistedString(item.spyMissionId)) return false;
  if (item.destinationPlanetId !== undefined && !isNonEmptyPersistedString(item.destinationPlanetId)) return false;
  if (item.destinationOwnerId !== undefined && !isNonEmptyPersistedString(item.destinationOwnerId)) return false;
  if (item.targetRelation !== undefined && !PERSISTED_TARGET_RELATIONS.has(item.targetRelation as TargetRelation)) return false;
  if (item.cargoState !== undefined && !PERSISTED_CARGO_STATES.has(item.cargoState as TransportCargoState)) return false;
  if (item.cargoResolvedAt !== undefined && !isFinitePersistedNumber(item.cargoResolvedAt)) return false;
  if (item.bot01ReturnCreditedAt !== undefined
    && (!isFinitePersistedNumber(item.bot01ReturnCreditedAt) || item.ownerSide !== 'bot01')) return false;
  const selectedShips = item.selectedShips;
  if (!selectedShips || typeof selectedShips !== 'object' || Array.isArray(selectedShips)) return false;
  const shipEntries = Object.entries(selectedShips);
  if (item.missionId === 'transport') {
    const cargo = normalizePersistedTransportCargo(item.cargo);
    if (!cargo) return false;
    if (item.targetRelation === undefined || item.destinationPlanetId === undefined) return false;
    if (item.cargoState === undefined) return false;
  }
  if (item.missionId === 'recycle') {
    const cargo = normalizePersistedTransportCargo(item.cargo);
    if (!cargo
      || !isNonNegativeInteger(item.recycleCapacity)
      || item.recycleCapacity <= 0
      || item.cargoState === undefined
      || item.targetKind === undefined
      || !['player', 'npc', 'uninhabited', 'unique', 'pirate', 'anomaly', 'empty'].includes(String(item.targetKind))
      || shipEntries.length === 0
      || shipEntries.some(([shipId]) => shipId !== 'recycler')
      || Object.values((item.selectedCommanders ?? {}) as Record<string, unknown>).some((quantity) => Number(quantity) > 0)) return false;
  }
  if (item.missionId === 'gas') {
    const cargo = normalizePersistedTransportCargo(item.cargo);
    if (!cargo
      || !isNonNegativeInteger(item.gasCapacity)
      || item.gasCapacity <= 0
      || item.cargoState === undefined
      || item.targetKind !== 'asteroid'
      || shipEntries.length === 0
      || shipEntries.some(([shipId]) => shipId !== 'recycler')
      || Object.keys((item.selectedCommanders ?? {}) as Record<string, unknown>).length > 0) return false;
  }
  if (isSpaceFlight) {
    const cargo = normalizePersistedTransportCargo(item.cargo);
    const selectedCommanders = item.selectedCommanders as Record<string, unknown> | undefined;
    const hasCommanders = Object.values(selectedCommanders ?? {}).some((quantity) => isNonNegativeInteger(quantity) && quantity > 0);
    const hasShips = shipEntries.some(([, quantity]) => isNonNegativeInteger(quantity) && quantity > 0);
    if (!cargo
      || item.ownerSide === 'bot01'
      || !isValidPersistedSpaceFlightDuration(item.oneWayDurationMs, mode)
      || !coordinatesMatch(item.originCoordinate, item.destinationCoordinate)
      || item.destinationPlanetId !== undefined
      || item.targetRelation !== undefined
      || item.cargoState === undefined
      || !['loaded', 'returned', 'voided'].includes(String(item.cargoState))
      || ((item.cargoState === 'returned' || item.cargoState === 'voided') && item.cargoResolvedAt === undefined)
      || (item.cargoState === 'loaded' && item.cargoResolvedAt !== undefined)
      || shipEntries.some(([shipId]) => shipId === 'solar-satellite')
      || (!hasShips && !hasCommanders)) return false;
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
  if (isSpaceFlight && destinationRecord.kind !== 'space') return false;
  if (item.missionId === 'gas' && destinationRecord.kind !== 'coordinate') return false;
  if (destinationRecord.kind === 'planet') {
    if (!isNonEmptyPersistedString(destinationRecord.planetId)
      || item.destinationPlanetId !== destinationRecord.planetId) return false;
  } else if (item.destinationPlanetId !== undefined && item.missionId !== 'transport') {
    return false;
  }
  if (destinationRecord.kind === 'space' && !isSpaceFlight) return false;
  if (destinationRecord.kind === 'operation') {
    if (!isNonEmptyPersistedString(destinationRecord.operationId)
      || item.operationId !== destinationRecord.operationId) return false;
  }

  for (const [shipId, quantity] of shipEntries) {
    if (!SHIP_IDS.includes(shipId as (typeof SHIP_IDS)[number])
      || !isNonNegativeInteger(quantity)
      || quantity <= 0) return false;
  }
  if (item.selectedCommanders !== undefined) {
    if (!item.selectedCommanders || typeof item.selectedCommanders !== 'object' || Array.isArray(item.selectedCommanders)) return false;
    for (const [commanderId, quantity] of Object.entries(item.selectedCommanders)) {
      if (!COMMANDER_IDS.includes(commanderId as (typeof COMMANDER_IDS)[number])
        || !isNonNegativeInteger(quantity)
        || quantity <= 0) return false;
    }
  }
  if (shipEntries.length === 0) {
    const selectedCommanders = item.selectedCommanders as Record<string, unknown> | undefined;
    const hasValidCommanderOnlyDeployment = item.missionId === 'deployment'
      && Object.values(selectedCommanders ?? {}).some((quantity) => isNonNegativeInteger(quantity) && quantity > 0);
    const hasValidCommanderOnlySpaceFlight = isSpaceFlight
      && Object.values(selectedCommanders ?? {}).some((quantity) => isNonNegativeInteger(quantity) && quantity > 0);
    if (!hasValidCommanderOnlyDeployment && !hasValidCommanderOnlySpaceFlight) return false;
  }
  if (item.selectedCommanderLevels !== undefined) {
    if (!item.selectedCommanderLevels || typeof item.selectedCommanderLevels !== 'object' || Array.isArray(item.selectedCommanderLevels)) return false;
    for (const [commanderId, level] of Object.entries(item.selectedCommanderLevels)) {
      if (!COMMANDER_IDS.includes(commanderId as (typeof COMMANDER_IDS)[number])
        || !isNonNegativeInteger(level)) return false;
    }
  }
  if (item.missionId === 'deployment') {
    if (destinationRecord.kind !== 'planet'
      || !isNonEmptyPersistedString(item.destinationPlanetId)
      || item.destinationPlanetId !== destinationRecord.planetId
      || item.targetRelation !== 'self'
      || shipEntries.some(([shipId]) => shipId === 'solar-satellite')) return false;
    const selectedCommanders = item.selectedCommanders as Record<string, unknown> | undefined;
    const commanderLevels = item.selectedCommanderLevels as Record<string, unknown> | undefined;
    if (Object.entries(selectedCommanders ?? {}).some(([commanderId, quantity]) =>
      Number(quantity) > 0 && !isNonNegativeInteger(commanderLevels?.[commanderId]))) return false;
  }
  if (item.missionId === 'espionage') {
    if (!isNonEmptyPersistedString(item.spyMissionId)
      || destinationRecord.kind !== 'planet'
      || item.destinationPlanetId !== destinationRecord.planetId
      || (item.targetRelation !== 'enemy' && item.targetRelation !== 'neutral')
      || shipEntries.length !== 1
      || shipEntries[0][0] !== 'spy-probe'
      || shipEntries[0][1] !== 1) return false;
  }
  if (item.missionId === 'attack') {
    const bot01Incoming = item.ownerSide === 'bot01';
    if (destinationRecord.kind !== 'planet'
      || !isNonEmptyPersistedString(item.destinationPlanetId)
      || item.destinationPlanetId !== destinationRecord.planetId
      || (item.targetRelation !== 'enemy' && item.targetRelation !== 'neutral'
        && !(bot01Incoming && item.targetRelation === 'self'))
      || (bot01Incoming && (item.targetKind !== 'player'
        || item.targetRelation !== 'self'
        || !isNonEmptyPersistedString(item.destinationOwnerId)
        || !isNonNegativeInteger((selectedShips as Record<string, unknown>)['death-star'])
        || Number((selectedShips as Record<string, unknown>)['death-star']) <= 0
        || Object.hasOwn(selectedShips, 'solar-satellite')))) return false;
    const snapshot = item.attackSnapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
    const attackSnapshot = snapshot as Record<string, unknown>;
    if (attackSnapshot.version !== 1
      || ![5, 8, 12].includes(attackSnapshot.maxRounds as number)
      || !['aegis', 'synod', 'veyra'].includes(String(attackSnapshot.attackerFactionId))
      || !Array.isArray(attackSnapshot.attackerPriority)) return false;
    if (item.attackResolution !== undefined) {
      const resolution = item.attackResolution;
      if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) return false;
      const attackResolution = resolution as Record<string, unknown>;
      const loot = attackResolution.loot;
      if (!isNonEmptyPersistedString(attackResolution.reportId)
        || !isFinitePersistedNumber(attackResolution.resolvedAt)
        || !isNonNegativeInteger(attackResolution.debris)
        || !loot || typeof loot !== 'object' || Array.isArray(loot)) return false;
      const lootRecord = loot as Record<string, unknown>;
      if (!['metal', 'minerals', 'gas', 'debris'].every((key) => isNonNegativeInteger(lootRecord[key]))) return false;
      if (attackResolution.lootCreditedAt !== undefined && !isFinitePersistedNumber(attackResolution.lootCreditedAt)) return false;
    }
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
  if (source.missionId !== 'transport' && source.missionId !== 'recycle' && source.missionId !== 'gas' && source.missionId !== 'space-flight') return value;
  const cargo = normalizePersistedTransportCargo(source.cargo);
  if (!cargo) return value;
  return { ...source, cargo };
}

function migrateFlightState(value: unknown, mode: RuntimeMode = 'test'): FlightState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createDefaultFlightState();
  const source = value as Record<string, unknown>;
  const records: FlightRecord[] = [];
  const seenIds = new Set<string>();
  const seenRequestIds = new Set<string>();
  if (Array.isArray(source.records)) {
    for (const rawCandidate of source.records) {
      const candidate = normalizePersistedFlightRecord(rawCandidate);
      if (!isPersistedFlightRecord(candidate, mode)) continue;
      if (mode === 'production' && candidate.ownerSide === 'bot01') continue;
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
  const initialSpaceportUpgrades = createDefaultSpaceportUpgradeState();
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
    spaceportUpgrades: { ...initialSpaceportUpgrades, shipLevels: {} },
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
    shipUpgradeLevels: { ...initialSpaceportUpgrades.shipLevels },
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
    asteroidSimulation: createUniverseAsteroidSimulationState(now),
    asteroidDebrisBySpawnIndex: {},
    espionage: mode === 'test' ? createDefaultTestEspionageState(now) : createDefaultEspionageState(),
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
    const persistedPlanetEntries = Object.entries(parsed.planets ?? {}).filter(([, candidate]) => (
      Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate)
    ));
    const savedCurrentPlanetId = typeof parsed.currentPlanetId === 'string' ? parsed.currentPlanetId.trim() : '';
    const primaryPlanetId = parsed.planets?.['helion-01']
      ? 'helion-01'
      : persistedPlanetEntries.some(([id]) => id === savedCurrentPlanetId)
        ? savedCurrentPlanetId
        : persistedPlanetEntries.map(([id]) => id).sort()[0] ?? 'helion-01';
    const savedHomeworld = parsed.planets?.[primaryPlanetId];
    const savedHomeworldOverpopulation = migrateOverpopulationState(savedHomeworld?.overpopulation, timestamp);
    const legacySolarStations = numberOr(savedHomeworld?.solarStations, numberOr(parsed.solarStations, 0));
    const buildings = migrateBuildingLevels(savedHomeworld?.buildings, legacySolarStations);
    const migratedSpaceportUpgrades = migrateSpaceportUpgradeState(savedHomeworld?.spaceportUpgrades);
    const spaceportUpgrades = savedHomeworldOverpopulation
      ? migratedSpaceportUpgrades
      : reconcileSpaceportUpgradeState(migratedSpaceportUpgrades, timestamp).state;
    const science = migrateScienceState(parsed.science, {
      laboratoryLevel: buildings.research,
      legacyPlanetId: savedCurrentPlanetId && parsed.planets?.[savedCurrentPlanetId]
        ? savedCurrentPlanetId
        : primaryPlanetId,
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
    const overpopulationReports = migrateOverpopulationEpisodeReports(
      objectRecord(parsed.reports)?.overpopulationReports,
    );
    const recyclerArrivalReports = migrateRecyclerArrivalReports(
      objectRecord(parsed.reports)?.recyclerArrivalReports,
    );
    const gasExtractionArrivalReports = migrateGasExtractionArrivalReports(
      objectRecord(parsed.reports)?.gasExtractionArrivalReports,
    );
    const reportIds = buildReportsFeed(
      combat.reports,
      operations,
      command,
      undefined,
      overpopulationReports,
      recyclerArrivalReports,
      gasExtractionArrivalReports,
    ).map((item) => item.id);
    const migratedSavedFleet = removeSolarSatellitesFromFleet(
      resolveSavedFleetState(savedHomeworld?.fleet, profile.factionId),
    );
    const persistedSatelliteCount = Math.max(
      0,
      Math.floor(numberOr(savedHomeworld?.solarSatellites, migratedSavedFleet.count)),
    );
    const savedFleet = savedHomeworldOverpopulation
      ? migratedSavedFleet.fleet
      : normalizeFleetStateForCapacity(
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
      enforceCapacity: !savedHomeworldOverpopulation,
    });
    const reconciledFleetProduction = savedHomeworldOverpopulation
      ? { changed: false, state: migratedFleetProduction, fleet: savedFleet, defense: savedDefense, completed: [] }
      : reconcileFleetProductionState(
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
    const legacyHomeworldResources: PlanetResources = primaryPlanetId === 'helion-01' ? {
      metal: normalizeStoredResource(parsed.metal, initialState.metal, homeworldStorageCapacities.metal),
      minerals: normalizeStoredResource(parsed.minerals, initialState.minerals, homeworldStorageCapacities.minerals),
      gas: normalizeStoredResource(parsed.gas, initialState.gas, homeworldStorageCapacities.gas),
    } : { metal: 500, minerals: 500, gas: 500 };
    const hasRootHomeworldWallet = parsed.metal !== undefined || parsed.minerals !== undefined || parsed.gas !== undefined;
    const legacyWalletIsAuthoritative = primaryPlanetId === 'helion-01'
      && (numberOr(parsed.schemaVersion, 0) < SAVE_SCHEMA_VERSION || savedHomeworld?.resources === undefined);
    const homeworldResources = normalizePlanetResources(
      legacyWalletIsAuthoritative && hasRootHomeworldWallet ? legacyHomeworldResources : savedHomeworld?.resources,
      legacyHomeworldResources,
      homeworldStorageCapacities,
    );
    const homeworldBase: PlanetRuntime = {
      name: typeof savedHomeworld?.name === 'string' && savedHomeworld.name.trim()
        ? savedHomeworld.name.trim().slice(0, 28)
        : primaryPlanetId === 'helion-01' ? DEFAULT_PLANET_NAME : `Колония ${primaryPlanetId}`,
      skin: typeof savedHomeworld?.skin === 'string' && KNOWN_PLANET_SKINS.has(savedHomeworld.skin)
        ? savedHomeworld.skin
        : typeof parsed.planetSkin === 'string' && KNOWN_PLANET_SKINS.has(parsed.planetSkin)
          ? parsed.planetSkin
          : initialState.planets['helion-01'].skin,
      fleet: savedHomeworldOverpopulation
        ? reconciledFleetProduction.fleet
        : normalizeFleetStateForCapacity(reconciledFleetProduction.fleet, buildings.hangar, profile.factionId),
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
      ...(savedHomeworldOverpopulation ? { overpopulation: savedHomeworldOverpopulation } : {}),
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
    const savedQueue = parsed.queues?.[primaryPlanetId] ?? (primaryPlanetId === 'helion-01' ? parsed.queue : null) ?? null;
    const queue = migrateBuildingQueue(savedQueue, primaryPlanetId, homeworld.buildings, science.levels);
    const storageCapacities = getStorageCapacities(homeworld.buildings);

    const planets: PlanetStateRecord = { [primaryPlanetId]: homeworld };
    for (const [planetId, rawValue] of Object.entries(parsed.planets ?? {})) {
      if (planetId === primaryPlanetId || !rawValue || typeof rawValue !== 'object') continue;
      const raw = rawValue as StoredPlanetRuntime;
      const planetBuildings = migrateBuildingLevels(raw.buildings);
      const migratedPlanetFleet = removeSolarSatellitesFromFleet(
        resolveSavedFleetState(raw.fleet, profile.factionId),
      );
      const planetOverpopulation = migrateOverpopulationState(raw.overpopulation, timestamp);
      const planetSatelliteCount = Math.max(
        0,
        Math.floor(numberOr(raw.solarSatellites, migratedPlanetFleet.count)),
      );
      const planetFleet = planetOverpopulation
        ? migratedPlanetFleet.fleet
        : normalizeFleetStateForCapacity(
          migratedPlanetFleet.fleet,
          planetBuildings.hangar,
          profile.factionId,
        );
      const planetDefense = migrateDefenseState(raw.defense);
      const migratedPlanetProduction = migrateFleetProductionState(raw.fleetProduction, {
        factionId: profile.factionId,
        fleet: planetFleet,
        defense: planetDefense,
        hangarLevel: planetBuildings.hangar,
        solarSatellites: planetSatelliteCount,
        enforceCapacity: !planetOverpopulation,
      });
      const planetProduction = planetOverpopulation
        ? migratedPlanetProduction
        : reconcileFleetProductionState(
          migratedPlanetProduction,
          planetFleet,
          planetDefense,
          profile.factionId,
          timestamp,
        ).state;
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
        ...(planetOverpopulation ? { overpopulation: planetOverpopulation } : {}),
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
        spaceportUpgrades: planetOverpopulation
          ? migrateSpaceportUpgradeState(raw.spaceportUpgrades)
          : reconcileSpaceportUpgradeState(migrateSpaceportUpgradeState(raw.spaceportUpgrades), timestamp).state,
        stability: numberOr(raw.stability, 100),
        resources: normalizePlanetResources(raw.resources, { metal: 500, minerals: 500, gas: 500 }, getStorageCapacities(planetBuildings)),
      };
      planets[planetId] = syncPlanetEnergySources(planetBase, science.levels);
    }

    const queues: PlanetQueueRecord = { [primaryPlanetId]: queue };
    for (const planetId of Object.keys(planets)) {
      if (planetId === primaryPlanetId) continue;
      const planet = planets[planetId];
      queues[planetId] = migrateBuildingQueue(parsed.queues?.[planetId], planetId, planet.buildings, science.levels);
    }

    const currentPlanetId = savedCurrentPlanetId && planets[savedCurrentPlanetId]
      ? savedCurrentPlanetId
      : primaryPlanetId;
    const alliedPlanets = migrateAlliedPlanets(parsed.alliedPlanets, mode, timestamp, science.levels);
    const rawEspionage = objectRecord(parsed.espionage);
    // A canonical `targets` object is authoritative even when it is empty.
    // Inspect the persisted envelope before migration because migration also
    // exposes legacy `bot01Planets` through the canonical `targets` field.
    const hasCanonicalTargetRegistry = Boolean(objectRecord(rawEspionage?.targets));
    const hasLegacyBotRegistry = Boolean(objectRecord(rawEspionage?.bot01Planets));
    const migratedEspionage = migrateEspionageState(parsed.espionage, timestamp);
    const defaultTestEspionage = createDefaultTestEspionageState(timestamp);
    const savedTargets = Object.values(migratedEspionage.targets ?? {});
    const savedBotPlanets = savedTargets.filter((planet) => planet.ownerId === UNIVERSE_NPC_OWNER_ID);
    const legacyBotFixtures = savedBotPlanets.some((planet) => {
      const population = planet.population as unknown as Record<string, unknown> | undefined;
      return !population || population.total === undefined || population.civilian !== undefined;
    });
    const hasCurrentBotProfile = Boolean(migratedEspionage.bot01Profile)
      && !legacyBotFixtures;
    const testTargets = defaultTestEspionage.targets ?? defaultTestEspionage.bot01Planets ?? {};
    const espionage = mode === 'test'
      ? (hasCanonicalTargetRegistry
        ? {
          ...migratedEspionage,
          targets: migratedEspionage.targets ?? {},
          // Keep the old alias synchronized without allowing it to resurrect
          // targets that were removed from the canonical registry.
          bot01Planets: (migratedEspionage.targets ?? {}) as NonNullable<typeof migratedEspionage.bot01Planets>,
        }
        : (hasCurrentBotProfile && hasLegacyBotRegistry)
        ? migratedEspionage
        : {
          ...migratedEspionage,
          bot01Profile: defaultTestEspionage.bot01Profile,
          targets: { ...(migratedEspionage.targets ?? {}), ...testTargets },
          bot01Planets: testTargets,
        })
      : {
        ...migratedEspionage,
        targets: Object.fromEntries(Object.entries(migratedEspionage.targets ?? {}).filter(([, target]) => target.ownerId !== UNIVERSE_NPC_OWNER_ID)),
        bot01Planets: undefined,
        bot01Profile: undefined,
        bot01IncomingScenario: undefined,
      };

    const asteroidSimulation = migrateAsteroidSimulation(parsed.asteroidSimulation, timestamp);
    const activeAsteroidSpawnIndices = new Set(asteroidSimulation.asteroids.map((asteroid) => asteroid.spawnIndex));
    const ownerUpgradeLevels = migrateSpaceportUpgradeState({ shipLevels: parsed.shipUpgradeLevels }).shipLevels;
    for (const planet of Object.values(planets)) {
      for (const [id, level] of Object.entries(planet.spaceportUpgrades.shipLevels)) {
        ownerUpgradeLevels[id] = Math.max(ownerUpgradeLevels[id] ?? 0, Math.max(0, Math.floor(level)));
      }
    }
    for (const [planetId, planet] of Object.entries(planets)) {
      planets[planetId] = {
        ...planet,
        spaceportUpgrades: { ...planet.spaceportUpgrades, shipLevels: {} },
      };
    }
    const currentWallet = planets[currentPlanetId]?.resources ?? homeworldResources;

    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      metal: currentWallet.metal,
      minerals: currentWallet.minerals,
      gas: currentWallet.gas,
      currentPlanetId,
      planets,
      queues,
      shipUpgradeLevels: ownerUpgradeLevels,
      rating: migrateRatingPrototypeState(parsed.rating),
      combatPriority: migrateCombatPriority(parsed.combatPriority),
      combat,
      combatSimulator: migrateSimulatorState(parsed.combatSimulator),
      operations,
      command,
      profile,
      reports: {
        ...migrateReportsState(parsed.reports, reportIds),
        ...(overpopulationReports.length > 0 ? { overpopulationReports } : {}),
        ...(recyclerArrivalReports.length > 0 ? { recyclerArrivalReports } : {}),
        ...(gasExtractionArrivalReports.length > 0 ? { gasExtractionArrivalReports } : {}),
      },
      science,
      resourceClock: migrateResourceClock(parsed.resourceClock, timestamp, Object.keys(planets), currentPlanetId),
      flights: migrateFlightState(parsed.flights, mode),
      asteroidSimulation,
      asteroidDebrisBySpawnIndex: migrateAsteroidDebris(parsed.asteroidDebrisBySpawnIndex, activeAsteroidSpawnIndices),
      espionage,
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
        const persistedState = mode === 'test' || !state.espionage
          ? state
          : {
            ...state,
            espionage: {
              ...state.espionage,
              targets: Object.fromEntries(Object.entries(state.espionage.targets ?? {}).filter(([, target]) => target.ownerId !== UNIVERSE_NPC_OWNER_ID)),
              bot01Planets: undefined,
              bot01Profile: undefined,
              bot01IncomingScenario: undefined,
            },
          };
        storage.setItem(saveKey, JSON.stringify(persistedState));
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
