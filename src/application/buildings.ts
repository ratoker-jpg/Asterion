import {
  BUILDING_QUEUE_CAPACITY,
  cancelBuildingProject,
  completeBuildingProject,
  destroyBuildingLevel,
  evaluateBuildingBuild,
  getBuildingDefinition,
  getStorageCapacities,
  startBuildingProject,
  type BuildAvailability,
  type BuildingEconomyState,
  type BuildingRole,
  type ResourceWallet,
} from '../domain/buildings/resource-zone.ts';
import { creditResources, type ResourceCreditResult } from '../domain/resources/credit.ts';
import {
  createEmptyBotAssignment,
  migrateProductionBotAssignment,
  type BotAssignment,
} from '../domain/buildings/production-bots.ts';
import {
  calculateFleetCapacity,
  calculateFleetPopulation,
} from '../domain/fleet/runtime.ts';
import {
  advanceRecyclingState,
  collectRecyclingJob,
  startRecyclingJob,
  type RecyclingState,
  type ResourceAllocationPercent,
} from '../domain/buildings/recycling.ts';
import {
  cancelSpaceportUpgrade as cancelSpaceportUpgradeDomain,
  enqueueSpaceportUpgrade,
  getSpaceportUpgradeEntity,
  reconcileSpaceportUpgradeState,
  type SpaceportCancellationTransition,
  type SpaceportUpgradeTrack,
  type SpaceportUpgradeWallet,
} from '../domain/buildings/spaceport-upgrades.ts';
import {
  executeTrade,
  reconcileTradeState,
  type TradeExecution,
  type TradeRequest,
  type TradeWallet,
} from '../domain/buildings/trade.ts';
import { scaleRuntimeDuration, type RuntimeMode, type TestTimeScale } from '../domain/runtime/mode.ts';
import { SAVE_SCHEMA_VERSION } from './persistence.ts';
import {
  getPlanetState,
  replacePlanetState,
  type PlanetId,
  type SaveState,
} from './contracts.ts';

export type BuildingApplicationContext = {
  planetId: PlanetId;
  now: number;
  mode: RuntimeMode;
  testTimeScale: TestTimeScale;
  rng?: () => number;
};

export type BuildingActionResult = {
  ok: boolean;
  state: SaveState;
  reason: string | null;
};

export type BuildingCompletionResult = BuildingActionResult & {
  changed: boolean;
  completedRole: BuildingRole | null;
};

export type BuildingPreviewResult = {
  state: SaveState;
  availability: BuildAvailability;
};

function economyFor(state: SaveState, context: BuildingApplicationContext): BuildingEconomyState {
  const planet = getPlanetState(state, context.planetId);
  return {
    resources: {
      metal: state.metal,
      minerals: state.minerals,
      gas: state.gas,
      energy: planet.energy,
    },
    buildings: planet.buildings,
    queue: state.queues[context.planetId] ?? [],
    scienceLevels: state.science.levels,
    capacities: getStorageCapacities(planet.buildings),
  };
}

function stateFromEconomy(
  state: SaveState,
  context: BuildingApplicationContext,
  economy: BuildingEconomyState,
): SaveState {
  const planet = getPlanetState(state, context.planetId);
  return {
    ...replacePlanetState(state, context.planetId, {
      ...planet,
      energy: economy.resources.energy,
      buildings: economy.buildings,
    }),
    schemaVersion: SAVE_SCHEMA_VERSION,
    metal: economy.resources.metal,
    minerals: economy.resources.minerals,
    gas: economy.resources.gas,
    queues: {
      ...state.queues,
      [context.planetId]: economy.queue,
    },
  };
}

export function previewBuilding(
  state: SaveState,
  context: BuildingApplicationContext,
  assetRole: BuildingRole,
): BuildingPreviewResult {
  return {
    state,
    availability: evaluateBuildingBuild(economyFor(state, context), assetRole),
  };
}

export function startBuilding(
  state: SaveState,
  context: BuildingApplicationContext,
  assetRole: BuildingRole,
): BuildingActionResult {
  const economy = economyFor(state, context);
  const availability = evaluateBuildingBuild(economy, assetRole);
  if (!availability.canBuild || availability.timeMs == null) {
    return { ok: false, state, reason: availability.reason };
  }

  const transition = startBuildingProject(
    economy,
    assetRole,
    context.planetId,
    context.now,
    scaleRuntimeDuration(availability.timeMs, context.mode, context.testTimeScale),
  );
  if (!transition.ok) return { ok: false, state, reason: transition.reason };
  return { ok: true, state: stateFromEconomy(state, context, transition.state), reason: null };
}

export function cancelBuilding(
  state: SaveState,
  context: BuildingApplicationContext,
  queueId: string,
): BuildingActionResult & { canceledRole: BuildingRole | null; cascadedCount: number } {
  const transition = cancelBuildingProject(economyFor(state, context), queueId, context.now);
  if (!transition.ok) {
    return { ok: false, state, reason: transition.reason, canceledRole: null, cascadedCount: 0 };
  }
  return {
    ok: true,
    state: stateFromEconomy(state, context, transition.state),
    reason: null,
    canceledRole: transition.canceled?.assetRole ?? null,
    cascadedCount: Math.max(0, transition.canceledItems.length - 1),
  };
}

export function destroyBuilding(
  state: SaveState,
  context: BuildingApplicationContext,
  assetRole: BuildingRole,
  rng: () => number = Math.random,
): BuildingActionResult & { refundPercent: number | null } {
  const planet = getPlanetState(state, context.planetId);
  if (assetRole === 'hangar') {
    const currentLevel = Math.max(0, Math.floor(planet.buildings.hangar ?? 0));
    if (currentLevel > 0) {
      const nextCapacity = calculateFleetCapacity(currentLevel - 1);
      const currentPopulation = calculateFleetPopulation(planet.fleet, state.profile.factionId);
      if (currentPopulation > nextCapacity) {
        return {
          ok: false,
          state,
          reason: `Нельзя понизить ангар: флот занимает ${currentPopulation} мест, новая вместимость — ${nextCapacity}.`,
          refundPercent: null,
        };
      }
    }
  }

  const refundPercent = 50 + Math.floor(rng() * 31);
  const transition = destroyBuildingLevel(economyFor(state, context), assetRole, refundPercent);
  if (!transition.ok) return { ok: false, state, reason: transition.reason, refundPercent: null };

  const next = stateFromEconomy(state, context, transition.state);
  return {
    ok: true,
    state: replacePlanetState(next, context.planetId, {
      ...planet,
      energy: transition.state.resources.energy,
      buildings: transition.state.buildings,
      productionBots: migrateProductionBotAssignment(planet.productionBots, transition.state.buildings),
    }),
    reason: null,
    refundPercent: transition.refundPercent,
  };
}

export function completeBuilding(
  state: SaveState,
  context: BuildingApplicationContext,
): BuildingCompletionResult {
  const transition = completeBuildingProject(economyFor(state, context), context.now);
  if (!transition.completedRole) return { ok: true, state, reason: null, changed: false, completedRole: null };
  return {
    ok: true,
    state: stateFromEconomy(state, context, transition.state),
    reason: null,
    changed: true,
    completedRole: transition.completedRole,
  };
}

export function applyProductionBots(
  state: SaveState,
  context: BuildingApplicationContext,
  assignment: BotAssignment,
): SaveState {
  const planet = getPlanetState(state, context.planetId);
  return replacePlanetState(
    { ...state, schemaVersion: SAVE_SCHEMA_VERSION },
    context.planetId,
    { ...planet, productionBots: migrateProductionBotAssignment(assignment, planet.buildings) },
  );
}

export function startRecycling(
  state: SaveState,
  context: BuildingApplicationContext,
  debrisAmount: number,
  allocation: ResourceAllocationPercent,
  jobId: string,
): BuildingActionResult {
  const planet = getPlanetState(state, context.planetId);
  const transition = startRecyclingJob(
    planet.recycling,
    planet.buildings.recycling,
    debrisAmount,
    allocation,
    context.now,
    jobId,
  );
  if (!transition.canStart) return { ok: false, state, reason: transition.reason ?? 'Переработка сейчас недоступна.' };
  return {
    ok: true,
    state: replacePlanetState({ ...state, schemaVersion: SAVE_SCHEMA_VERSION }, context.planetId, {
      ...planet,
      recycling: transition.state,
    }),
    reason: null,
  };
}

export function collectRecycling(
  state: SaveState,
  context: BuildingApplicationContext,
  jobId: string,
): BuildingActionResult & { output: { metal: number; minerals: number; gas: number } | null; credit: ResourceCreditResult | null } {
  const planet = getPlanetState(state, context.planetId);
  const transition = collectRecyclingJob(planet.recycling, jobId, context.now);
  if (!transition.ok || !transition.output) {
    const nextState = transition.state !== planet.recycling
      ? replacePlanetState(state, context.planetId, { ...planet, recycling: transition.state })
      : state;
    return { ok: false, state: nextState, reason: transition.reason ?? 'Ресурс пока недоступен.', output: null, credit: null };
  }
  const credit = creditResources(
    { metal: state.metal, minerals: state.minerals, gas: state.gas, energy: planet.energy },
    getStorageCapacities(planet.buildings),
    transition.output,
  );
  return {
    ok: true,
    state: replacePlanetState({
      ...state,
      schemaVersion: SAVE_SCHEMA_VERSION,
      metal: credit.wallet.metal,
      minerals: credit.wallet.minerals,
      gas: credit.wallet.gas,
    }, context.planetId, { ...planet, recycling: transition.state }),
    reason: null,
    output: transition.output,
    credit,
  };
}

export function reconcileRecycling(
  state: SaveState,
  context: BuildingApplicationContext,
): BuildingActionResult & { autoCollectedJobIds: string[]; credit: ResourceCreditResult | null } {
  const planet = getPlanetState(state, context.planetId);
  const transition = advanceRecyclingState(planet.recycling, context.now);
  if (!transition.changed) return { ok: true, state, reason: null, autoCollectedJobIds: [], credit: null };
  const credit = creditResources(
    { metal: state.metal, minerals: state.minerals, gas: state.gas, energy: planet.energy },
    getStorageCapacities(planet.buildings),
    transition.autoCollectedOutput,
  );
  return {
    ok: true,
    state: replacePlanetState({
      ...state,
      schemaVersion: SAVE_SCHEMA_VERSION,
      metal: credit.wallet.metal,
      minerals: credit.wallet.minerals,
      gas: credit.wallet.gas,
    }, context.planetId, { ...planet, recycling: transition.state }),
    reason: null,
    autoCollectedJobIds: transition.autoCollectedJobIds,
    credit,
  };
}

export function executeTradeAction(
  state: SaveState,
  context: BuildingApplicationContext,
  ratingPoints: number,
  request: TradeRequest,
): { state: SaveState; execution: TradeExecution } {
  const planet = getPlanetState(state, context.planetId);
  const execution = executeTrade(
    {
      wallet: {
        metal: state.metal,
        minerals: state.minerals,
        gas: state.gas,
        debris: planet.recycling.availableDebris,
      },
      trade: planet.trade,
      capacities: getStorageCapacities(planet.buildings),
    },
    planet.buildings['trade-center'],
    ratingPoints,
    request,
    context.now,
  );
  if (!execution.ok) return { state, execution };
  return {
    execution,
    state: replacePlanetState({
      ...state,
      schemaVersion: SAVE_SCHEMA_VERSION,
      metal: execution.state.wallet.metal,
      minerals: execution.state.wallet.minerals,
      gas: execution.state.wallet.gas,
    }, context.planetId, {
      ...planet,
      trade: execution.state.trade,
      recycling: { ...planet.recycling, availableDebris: execution.state.wallet.debris },
    }),
  };
}

export function reconcileTrade(
  state: SaveState,
  context: BuildingApplicationContext,
): BuildingActionResult {
  const planet = getPlanetState(state, context.planetId);
  const transition = reconcileTradeState(planet.trade, planet.buildings['trade-center'], context.now);
  if (!transition.changed) return { ok: true, state, reason: null };
  return {
    ok: true,
    state: replacePlanetState({ ...state, schemaVersion: SAVE_SCHEMA_VERSION }, context.planetId, {
      ...planet,
      trade: transition.state,
    }),
    reason: null,
  };
}

export function startSpaceportUpgrade(
  state: SaveState,
  context: BuildingApplicationContext,
  track: SpaceportUpgradeTrack,
  shipId: string,
  taskId: string,
): BuildingActionResult & { entityName: string } {
  const planet = getPlanetState(state, context.planetId);
  const transition = enqueueSpaceportUpgrade({
    state: planet.spaceportUpgrades,
    wallet: { metal: state.metal, minerals: state.minerals, gas: state.gas },
    buildings: planet.buildings,
    scienceLevels: state.science.levels,
    spaceportLevel: planet.buildings.spaceport,
    factionId: state.profile.factionId,
    capacities: getStorageCapacities(planet.buildings),
    mode: context.mode,
    testTimeScale: context.testTimeScale,
  }, track, shipId, context.now, taskId);
  if (!transition.ok) return { ok: false, state, reason: transition.reason, entityName: shipId };
  const entityName = getSpaceportUpgradeEntity(track, shipId, state.profile.factionId)?.name ?? shipId;
  return {
    ok: true,
    state: replacePlanetState({
      ...state,
      schemaVersion: SAVE_SCHEMA_VERSION,
      metal: transition.wallet.metal,
      minerals: transition.wallet.minerals,
      gas: transition.wallet.gas,
    }, context.planetId, { ...planet, spaceportUpgrades: transition.state }),
    reason: null,
    entityName,
  };
}

export function cancelSpaceportUpgrade(
  state: SaveState,
  context: BuildingApplicationContext,
  taskId: string,
): BuildingActionResult & { transition: SpaceportCancellationTransition } {
  const planet = getPlanetState(state, context.planetId);
  const transition = cancelSpaceportUpgradeDomain({
    state: planet.spaceportUpgrades,
    wallet: { metal: state.metal, minerals: state.minerals, gas: state.gas },
    buildings: planet.buildings,
    scienceLevels: state.science.levels,
    spaceportLevel: planet.buildings.spaceport,
    factionId: state.profile.factionId,
    capacities: getStorageCapacities(planet.buildings),
    mode: context.mode,
    testTimeScale: context.testTimeScale,
  }, taskId, context.now, context.rng);
  const nextState = replacePlanetState({
    ...state,
    schemaVersion: SAVE_SCHEMA_VERSION,
    metal: transition.wallet.metal,
    minerals: transition.wallet.minerals,
    gas: transition.wallet.gas,
  }, context.planetId, { ...planet, spaceportUpgrades: transition.state });
  return {
    ok: transition.ok,
    state: transition.ok || nextState !== state ? nextState : state,
    reason: transition.reason,
    transition,
  };
}

export function reconcileSpaceport(
  state: SaveState,
  context: BuildingApplicationContext,
): BuildingActionResult & { completed: Array<{ track: SpaceportUpgradeTrack; shipId: string }> } {
  const planet = getPlanetState(state, context.planetId);
  const transition = reconcileSpaceportUpgradeState(planet.spaceportUpgrades, context.now);
  if (!transition.changed) return { ok: true, state, reason: null, completed: [] };
  return {
    ok: true,
    state: replacePlanetState({ ...state, schemaVersion: SAVE_SCHEMA_VERSION }, context.planetId, {
      ...planet,
      spaceportUpgrades: transition.state,
    }),
    reason: null,
    completed: transition.completed,
  };
}

export function createEmptyProductionBots(): BotAssignment {
  return createEmptyBotAssignment();
}

export { BUILDING_QUEUE_CAPACITY, getBuildingDefinition };
export type { ResourceWallet, RecyclingState, SpaceportUpgradeWallet, TradeWallet };
