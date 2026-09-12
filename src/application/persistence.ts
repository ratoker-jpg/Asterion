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
  normalizeFleetStateForCapacity,
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
  getStorageCapacities,
  migrateBuildingLevels,
  migrateBuildingQueue,
} from '../domain/buildings/resource-zone.ts';
import {
  createEmptyBotAssignment,
  migrateProductionBotAssignment,
} from '../domain/buildings/production-bots.ts';
import {
  createDefaultRecyclingState,
  migrateRecyclingState,
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
  migrateRepairWorkshopState,
} from '../domain/repair/workshop.ts';
import type { ResourceClock, SaveState, PlanetRuntime } from './contracts.ts';

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
  buildings?: unknown;
  productionBots?: unknown;
  recycling?: unknown;
  trade?: unknown;
  spaceportUpgrades?: unknown;
  solarStations?: unknown;
  stability?: unknown;
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

function nonNegativeNumberOr(value: unknown, fallback: number): number {
  const resolved = numberOr(value, fallback);
  return Math.max(0, resolved);
}

function createResourceClock(now: number): ResourceClock {
  const safeNow = nonNegativeNumberOr(now, Date.now());
  return {
    lastReconciledAt: safeNow,
    remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 },
  };
}

function migrateResourceClock(value: unknown, now: number): ResourceClock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createResourceClock(now);
  const source = value as Record<string, unknown>;
  const safeNow = nonNegativeNumberOr(now, Date.now());
  const rawLast = numberOr(source.lastReconciledAt, safeNow);
  const lastReconciledAt = Math.min(safeNow, Math.max(0, rawLast));
  const rawRemainder = source.remainder && typeof source.remainder === 'object' && !Array.isArray(source.remainder)
    ? source.remainder as Record<string, unknown>
    : {};
  const remainder = (key: keyof ResourceClock['remainder']) => {
    const resolved = numberOr(rawRemainder[key], 0);
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

function normalizeStoredResource(value: unknown, fallback: number, capacity: number): number {
  const candidate = value === undefined ? fallback : nonNegativeNumberOr(value, 0);
  return Math.min(Math.max(0, capacity), candidate);
}

function createInitialState(mode: RuntimeMode = ACTIVE_RUNTIME_MODE, now = Date.now()): SaveState {
  const command = createDefaultCommandState();
  const buildings = createCanonicalStartingBuildingLevels();
  if (mode === 'test') {
    buildings['metal-storage'] = 20;
    buildings['mineral-storage'] = 20;
    buildings['gas-storage'] = 20;
  }
  const storageCapacities = getStorageCapacities(buildings);
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    metal: mode === 'test' ? storageCapacities.metal : 15_880,
    minerals: mode === 'test' ? storageCapacities.minerals : 12_712,
    gas: mode === 'test' ? storageCapacities.gas : 6_421,
    currentPlanetId: 'helion-01',
    planets: {
      'helion-01': {
        name: DEFAULT_PLANET_NAME,
        skin: 'colonized',
        energy: mode === 'test' ? TEST_MODE_RESOURCE_AMOUNT : 140,
        buildings,
        fleet: createCanonicalStartingFleet(),
        defense: createEmptyDefenseState(),
        fleetProduction: createDefaultFleetProductionState(),
        repair: createDefaultRepairWorkshopState(),
        productionBots: createEmptyBotAssignment(),
        recycling: createDefaultRecyclingState(),
        trade: createDefaultTradeState(),
        spaceportUpgrades: createDefaultSpaceportUpgradeState(),
        stability: 100,
      },
    },
    queues: { 'helion-01': [] },
    rating: createDefaultRatingPrototypeState(),
    profile: syncPlayerProfileWithAlliance(createDefaultPlayerProfileState(), command.alliance),
    combatPriority: createDefaultCombatPriority(),
    combat: createDefaultBattleHistory(),
    combatSimulator: createDefaultSimulatorState(),
    operations: createDefaultOperationsState(),
    command,
    reports: createDefaultReportsState(),
    science: createDefaultScienceState(),
    resourceClock: createResourceClock(now),
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
    const combat = migrateBattleHistory(parsed.combat);
    const operations = migrateOperationsState(parsed.operations);
    const command = migrateCommandState(parsed.command);
    const profile = syncPlayerProfileWithAlliance(
      syncPlayerProfileWithFaction(migratePlayerProfileState(parsed.profile), CURRENT_PLAYER_FACTION_ID),
      command.alliance,
    );
    const reportIds = buildReportsFeed(combat.reports, operations, command).map((item) => item.id);
    const savedFleet = normalizeFleetStateForCapacity(
      resolveSavedFleetState(savedHomeworld?.fleet, profile.factionId),
      buildings.hangar,
      profile.factionId,
    );
    const savedDefense = migrateDefenseState(savedHomeworld?.defense);
    const migratedFleetProduction = migrateFleetProductionState(savedHomeworld?.fleetProduction, {
      factionId: profile.factionId,
      fleet: savedFleet,
      defense: savedDefense,
      hangarLevel: buildings.hangar,
    });
    const reconciledFleetProduction = reconcileFleetProductionState(
      migratedFleetProduction,
      savedFleet,
      savedDefense,
      profile.factionId,
      timestamp,
    );
    const homeworld: PlanetRuntime = {
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
      repair: migrateRepairWorkshopState(savedHomeworld?.repair),
      energy: nonNegativeNumberOr(savedHomeworld?.energy, numberOr(parsed.energy, initialState.planets['helion-01'].energy)),
      buildings,
      productionBots: migrateProductionBotAssignment(savedHomeworld?.productionBots, buildings),
      recycling: migrateRecyclingState(savedHomeworld?.recycling, buildings.recycling, timestamp),
      trade: migrateTradeState(savedHomeworld?.trade, buildings['trade-center'], timestamp),
      spaceportUpgrades,
      stability: numberOr(savedHomeworld?.stability, initialState.planets['helion-01'].stability),
    };
    const savedQueue = parsed.queues?.['helion-01'] ?? parsed.queue ?? null;
    const queue = migrateBuildingQueue(savedQueue, 'helion-01', homeworld.buildings, science.levels);
    const storageCapacities = getStorageCapacities(homeworld.buildings);

    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      metal: normalizeStoredResource(parsed.metal, initialState.metal, storageCapacities.metal),
      minerals: normalizeStoredResource(parsed.minerals, initialState.minerals, storageCapacities.minerals),
      gas: normalizeStoredResource(parsed.gas, initialState.gas, storageCapacities.gas),
      currentPlanetId: 'helion-01',
      planets: { 'helion-01': homeworld },
      queues: { 'helion-01': queue },
      rating: migrateRatingPrototypeState(parsed.rating),
      combatPriority: migrateCombatPriority(parsed.combatPriority),
      combat,
      combatSimulator: migrateSimulatorState(parsed.combatSimulator),
      operations,
      command,
      profile,
      reports: migrateReportsState(parsed.reports, reportIds),
      science,
      resourceClock: migrateResourceClock(parsed.resourceClock, timestamp),
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
