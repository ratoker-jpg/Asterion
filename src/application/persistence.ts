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
  resolveSavedFleetState,
} from '../domain/fleet/runtime.ts';
import {
  createCanonicalStartingBuildingLevels,
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
import type { SaveState, PlanetRuntime } from './contracts.ts';

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

function createInitialState(mode: RuntimeMode = ACTIVE_RUNTIME_MODE): SaveState {
  const command = createDefaultCommandState();
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    metal: mode === 'test' ? TEST_MODE_RESOURCE_AMOUNT : 15_880,
    minerals: mode === 'test' ? TEST_MODE_RESOURCE_AMOUNT : 12_712,
    gas: mode === 'test' ? TEST_MODE_RESOURCE_AMOUNT : 6_421,
    currentPlanetId: 'helion-01',
    planets: {
      'helion-01': {
        name: DEFAULT_PLANET_NAME,
        skin: 'colonized',
        energy: mode === 'test' ? TEST_MODE_RESOURCE_AMOUNT : 140,
        buildings: createCanonicalStartingBuildingLevels(),
        fleet: createCanonicalStartingFleet(),
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
  };
}

export function createInitialSaveState(mode: RuntimeMode = ACTIVE_RUNTIME_MODE): SaveState {
  return createInitialState(mode);
}

function readSavedState(options: PersistenceOptions = {}): SaveState {
  const mode = options.mode ?? ACTIVE_RUNTIME_MODE;
  const now = options.now ?? Date.now;
  const testTimeScale = options.testTimeScale ?? resolveTestTimeScale();
  const initialState = createInitialState(mode);
  const storage = resolveStorage(options.storage);
  if (!storage) return createInitialSaveState(mode);

  try {
    const raw = storage.getItem(getRuntimeSaveKey(mode));
    if (!raw) return createInitialSaveState(mode);

    const parsed = JSON.parse(raw) as StoredSave;
    const savedHomeworld = parsed.planets?.['helion-01'];
    const legacySolarStations = numberOr(savedHomeworld?.solarStations, numberOr(parsed.solarStations, 0));
    const buildings = migrateBuildingLevels(savedHomeworld?.buildings, legacySolarStations);
    const timestamp = now();
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
    const homeworld: PlanetRuntime = {
      name: typeof savedHomeworld?.name === 'string' && savedHomeworld.name.trim()
        ? savedHomeworld.name.trim().slice(0, 28)
        : DEFAULT_PLANET_NAME,
      skin: typeof savedHomeworld?.skin === 'string' && KNOWN_PLANET_SKINS.has(savedHomeworld.skin)
        ? savedHomeworld.skin
        : typeof parsed.planetSkin === 'string' && KNOWN_PLANET_SKINS.has(parsed.planetSkin)
          ? parsed.planetSkin
          : initialState.planets['helion-01'].skin,
      fleet: resolveSavedFleetState(savedHomeworld?.fleet),
      energy: numberOr(savedHomeworld?.energy, numberOr(parsed.energy, initialState.planets['helion-01'].energy)),
      buildings,
      productionBots: migrateProductionBotAssignment(savedHomeworld?.productionBots, buildings),
      recycling: migrateRecyclingState(savedHomeworld?.recycling, buildings.recycling, timestamp),
      trade: migrateTradeState(savedHomeworld?.trade, buildings['trade-center'], timestamp),
      spaceportUpgrades,
      stability: numberOr(savedHomeworld?.stability, initialState.planets['helion-01'].stability),
    };
    const savedQueue = parsed.queues?.['helion-01'] ?? parsed.queue ?? null;
    const queue = migrateBuildingQueue(savedQueue, 'helion-01', homeworld.buildings, science.levels);

    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      metal: numberOr(parsed.metal, initialState.metal),
      minerals: numberOr(parsed.minerals, initialState.minerals),
      gas: numberOr(parsed.gas, initialState.gas),
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
    };
  } catch {
    return createInitialSaveState(mode);
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
