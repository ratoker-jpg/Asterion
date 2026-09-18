import {
  cancelFleetProduction as cancelFleetProductionDomain,
  enqueueFleetProduction,
  reconcileFleetProductionState,
  type FleetProductionCancellationTransition,
  type FleetProductionCompletion,
  type FleetProductionQueueKind,
  type FleetProductionTransition,
} from '../domain/fleet/production.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { SAVE_SCHEMA_VERSION } from './persistence.ts';
import {
  getPlanetState,
  replacePlanetState,
  type PlanetId,
  type SaveState,
} from './contracts.ts';
import type { BuildingApplicationContext } from './buildings.ts';
import { removeSolarSatellitesFromFleet } from '../domain/fleet/runtime.ts';
import { transitionPlanetEnergySources } from './energy.ts';

export const FLEET_PRODUCTION_START_REQUEST_EVENT = 'asterion:fleet-production-start-request';
export const FLEET_PRODUCTION_CANCEL_REQUEST_EVENT = 'asterion:fleet-production-cancel-request';
export const FLEET_PRODUCTION_DISMANTLE_SATELLITES_REQUEST_EVENT = 'asterion:fleet-production-dismantle-satellites-request';

export type FleetProductionStartRequest = {
  queueKind?: FleetProductionQueueKind;
  itemId?: string;
  quantity?: number;
  orderId?: string;
  now?: number;
};

export type FleetProductionCancelRequest = {
  orderId?: string;
  now?: number;
};

export type SolarSatelliteDismantleRequest = {
  count?: number;
};

function productionContext(
  state: SaveState,
  context: BuildingApplicationContext,
  now: number,
) {
  const planet = getPlanetState(state, context.planetId);
  const migratedFleet = removeSolarSatellitesFromFleet(planet.fleet);
  return {
    state: planet.fleetProduction,
    fleet: planet.fleet,
    defense: planet.defense,
    solarSatellites: Math.max(0, Math.floor(planet.solarSatellites ?? migratedFleet.count)),
    wallet: { metal: state.metal, minerals: state.minerals, gas: state.gas },
    capacities: getStorageCapacities(planet.buildings),
    factionId: state.profile.factionId,
    hangarLevel: planet.buildings.hangar,
    shipyardLevel: planet.buildings.shipyard,
    advancedFactoryLevel: planet.buildings['advanced-factory'],
    mode: context.mode,
    testTimeScale: context.testTimeScale,
    now,
  };
}

function defaultOrderId(queueKind: FleetProductionQueueKind, itemId: string, now: number): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `fleet-production-${queueKind}-${itemId}-${now}-${Math.random().toString(36).slice(2, 9)}`;
}

function stateFromTransition(
  state: SaveState,
  context: BuildingApplicationContext,
  transition: {
    state: SaveState['planets'][PlanetId]['fleetProduction'];
    fleet: SaveState['planets'][PlanetId]['fleet'];
    defense: SaveState['planets'][PlanetId]['defense'];
    wallet: { metal: number; minerals: number; gas: number };
    completed: FleetProductionCompletion[];
  },
): SaveState {
  const planet = getPlanetState(state, context.planetId);
  const migratedPlanetFleet = removeSolarSatellitesFromFleet(transition.fleet);
  const previousPlanetFleet = removeSolarSatellitesFromFleet(planet.fleet);
  const satelliteCount = Math.max(
    0,
    Math.floor(planet.solarSatellites ?? previousPlanetFleet.count),
  );
  const completedSatellites = transition.completed
    .filter((item) => item.queueKind === 'ships' && item.itemId === 'solar-satellite')
    .reduce((total, item) => total + Math.max(0, Math.floor(item.quantity)), 0);
  const previousPlanet = { ...planet, fleet: previousPlanetFleet.fleet, solarSatellites: satelliteCount };
  const nextPlanet = transitionPlanetEnergySources(
    previousPlanet,
    {
      ...planet,
      fleet: migratedPlanetFleet.fleet,
      defense: transition.defense,
      fleetProduction: transition.state,
      solarSatellites: satelliteCount + completedSatellites,
    },
    state.science.levels,
    state.science.levels,
  );
  return replacePlanetState({
    ...state,
    schemaVersion: SAVE_SCHEMA_VERSION,
    metal: transition.wallet.metal,
    minerals: transition.wallet.minerals,
    gas: transition.wallet.gas,
  }, context.planetId, nextPlanet);
}

export type FleetProductionActionResult = {
  state: SaveState;
  transition: FleetProductionTransition | FleetProductionCancellationTransition;
};

export function startFleetProduction(
  state: SaveState,
  context: BuildingApplicationContext,
  queueKind: FleetProductionQueueKind,
  itemId: string,
  quantity: number,
  orderId = defaultOrderId(queueKind, itemId, context.now),
): FleetProductionActionResult {
  const planet = getPlanetState(state, context.planetId);
  const commanderLevel = planet.spaceportUpgrades.shipLevels[itemId] ?? 0;
  const transition = enqueueFleetProduction({
    ...productionContext(state, context, context.now),
    commanderLevel,
  }, queueKind, itemId, quantity, orderId);
  return {
    transition,
    state: transition.ok ? stateFromTransition(state, context, transition) : transition.state === planet.fleetProduction && transition.fleet === planet.fleet && transition.defense === planet.defense
      ? state
      : stateFromTransition(state, context, transition),
  };
}

export function cancelFleetProduction(
  state: SaveState,
  context: BuildingApplicationContext,
  orderId: string,
): FleetProductionActionResult {
  const transition = cancelFleetProductionDomain(
    productionContext(state, context, context.now),
    orderId,
    context.rng,
  );
  const planet = getPlanetState(state, context.planetId);
  return {
    transition,
    state: transition.ok || transition.state !== planet.fleetProduction || transition.fleet !== planet.fleet || transition.defense !== planet.defense
      ? stateFromTransition(state, context, transition)
      : state,
  };
}

export type FleetProductionReconcileResult = {
  changed: boolean;
  state: SaveState;
  completed: ReturnType<typeof reconcileFleetProductionState>['completed'];
};

export type SolarSatelliteDismantleResult = {
  ok: boolean;
  state: SaveState;
  removed: number;
  reason: string | null;
};

export function reconcileFleetProduction(
  state: SaveState,
  context: Pick<BuildingApplicationContext, 'planetId' | 'now'>,
): FleetProductionReconcileResult {
  const planet = getPlanetState(state, context.planetId);
  const transition = reconcileFleetProductionState(
    planet.fleetProduction,
    planet.fleet,
    planet.defense,
    state.profile.factionId,
    context.now,
  );
  if (!transition.changed) return { changed: false, state, completed: [] };
  const migratedFleet = removeSolarSatellitesFromFleet(transition.fleet);
  const currentSatelliteCount = Math.max(
    0,
    Math.floor(planet.solarSatellites ?? removeSolarSatellitesFromFleet(planet.fleet).count),
  );
  const completedSatellites = transition.completed
    .filter((item) => item.queueKind === 'ships' && item.itemId === 'solar-satellite')
    .reduce((total, item) => total + Math.max(0, Math.floor(item.quantity)), 0);
  const previousPlanet = {
    ...planet,
    fleet: removeSolarSatellitesFromFleet(planet.fleet).fleet,
    solarSatellites: currentSatelliteCount,
  };
  const nextPlanet = transitionPlanetEnergySources(
    previousPlanet,
    {
      ...planet,
      fleet: migratedFleet.fleet,
      defense: transition.defense,
      fleetProduction: transition.state,
      solarSatellites: currentSatelliteCount + completedSatellites,
    },
    state.science.levels,
    state.science.levels,
  );
  return {
    changed: true,
    state: replacePlanetState({ ...state, schemaVersion: SAVE_SCHEMA_VERSION }, context.planetId, nextPlanet),
    completed: transition.completed,
  };
}

export function dismantleSolarSatellites(
  state: SaveState,
  context: Pick<BuildingApplicationContext, 'planetId'>,
  count?: number,
): SolarSatelliteDismantleResult {
  const planet = getPlanetState(state, context.planetId);
  const migratedFleet = removeSolarSatellitesFromFleet(planet.fleet);
  const currentCount = Math.max(0, Math.floor(planet.solarSatellites ?? migratedFleet.count));
  if (currentCount <= 0) return { ok: false, state, removed: 0, reason: 'На планете нет солнечных спутников.' };
  const requested = count == null || !Number.isFinite(count) ? currentCount : Math.floor(count);
  const removed = Math.min(currentCount, Math.max(0, requested));
  if (removed <= 0) return { ok: false, state, removed: 0, reason: 'Количество спутников должно быть положительным.' };
  const previousPlanet = { ...planet, fleet: migratedFleet.fleet, solarSatellites: currentCount };
  const nextPlanet = transitionPlanetEnergySources(
    previousPlanet,
    { ...previousPlanet, solarSatellites: currentCount - removed },
    state.science.levels,
    state.science.levels,
    { sourceChanges: { 'solar-satellite': 'satellite' } },
  );
  return {
    ok: true,
    state: replacePlanetState({ ...state, schemaVersion: SAVE_SCHEMA_VERSION }, context.planetId, nextPlanet),
    removed,
    reason: null,
  };
}

export type FleetProductionEventBridgeOptions = {
  target: EventTarget;
  getState: () => SaveState;
  getContext: (now: number) => BuildingApplicationContext;
  commit: (state: SaveState) => void;
  onNotice: (notice: string) => void;
};

export function bindFleetProductionEventBridge(options: FleetProductionEventBridgeOptions): () => void {
  const onStart = (event: Event) => {
    const request = (event as CustomEvent<FleetProductionStartRequest>).detail;
    if (!request?.queueKind || !request.itemId || typeof request.quantity !== 'number' || !Number.isFinite(request.quantity)) return;
    const now = typeof request.now === 'number' && Number.isFinite(request.now) ? request.now : Date.now();
    const context = { ...options.getContext(now), now };
    const currentState = options.getState();
    const result = startFleetProduction(
      currentState,
      context,
      request.queueKind,
      request.itemId,
      request.quantity,
      request.orderId || undefined,
    );
    if (!result.transition.ok) {
      if (result.state !== currentState) options.commit(result.state);
      options.onNotice(result.transition.reason ?? 'Производство сейчас недоступно.');
      return;
    }
    options.commit(result.state);
    options.onNotice('Заказ добавлен в очередь производства.');
  };

  const onCancel = (event: Event) => {
    const request = (event as CustomEvent<FleetProductionCancelRequest>).detail;
    if (!request?.orderId) return;
    const now = typeof request.now === 'number' && Number.isFinite(request.now) ? request.now : Date.now();
    const result = cancelFleetProduction(options.getState(), { ...options.getContext(now), now }, request.orderId);
    const transition = result.transition as FleetProductionCancellationTransition;
    options.commit(result.state);
    options.onNotice(transition.ok
      ? transition.refundPercent == null
        ? 'Заказ отменён. Сохранённая стоимость отсутствует, возврат не начислен.'
        : `Заказ отменён. Возвращено ${transition.refundPercent}% стоимости незавершённых единиц.`
      : transition.reason ?? 'Заказ недоступен для отмены.');
  };

  const onDismantleSatellites = (event: Event) => {
    const request = (event as CustomEvent<SolarSatelliteDismantleRequest>).detail;
    const result = dismantleSolarSatellites(options.getState(), options.getContext(Date.now()), request?.count);
    if (!result.ok) {
      options.onNotice(result.reason ?? 'Спутники сейчас недоступны для демонтажа.');
      return;
    }
    options.commit(result.state);
    options.onNotice(`Уничтожено солнечных спутников: ${result.removed}. Ресурсы за них не возвращаются.`);
  };

  options.target.addEventListener(FLEET_PRODUCTION_START_REQUEST_EVENT, onStart);
  options.target.addEventListener(FLEET_PRODUCTION_CANCEL_REQUEST_EVENT, onCancel);
  options.target.addEventListener(FLEET_PRODUCTION_DISMANTLE_SATELLITES_REQUEST_EVENT, onDismantleSatellites);
  return () => {
    options.target.removeEventListener(FLEET_PRODUCTION_START_REQUEST_EVENT, onStart);
    options.target.removeEventListener(FLEET_PRODUCTION_CANCEL_REQUEST_EVENT, onCancel);
    options.target.removeEventListener(FLEET_PRODUCTION_DISMANTLE_SATELLITES_REQUEST_EVENT, onDismantleSatellites);
  };
}
