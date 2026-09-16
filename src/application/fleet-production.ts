import {
  cancelFleetProduction as cancelFleetProductionDomain,
  enqueueFleetProduction,
  reconcileFleetProductionState,
  type FleetProductionCancellationTransition,
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

export const FLEET_PRODUCTION_START_REQUEST_EVENT = 'asterion:fleet-production-start-request';
export const FLEET_PRODUCTION_CANCEL_REQUEST_EVENT = 'asterion:fleet-production-cancel-request';

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

function productionContext(
  state: SaveState,
  context: BuildingApplicationContext,
  now: number,
) {
  const planet = getPlanetState(state, context.planetId);
  return {
    state: planet.fleetProduction,
    fleet: planet.fleet,
    defense: planet.defense,
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
  },
): SaveState {
  const planet = getPlanetState(state, context.planetId);
  return replacePlanetState({
    ...state,
    schemaVersion: SAVE_SCHEMA_VERSION,
    metal: transition.wallet.metal,
    minerals: transition.wallet.minerals,
    gas: transition.wallet.gas,
  }, context.planetId, {
    ...planet,
    fleet: transition.fleet,
    defense: transition.defense,
    fleetProduction: transition.state,
  });
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
  return {
    changed: true,
    state: replacePlanetState({ ...state, schemaVersion: SAVE_SCHEMA_VERSION }, context.planetId, {
      ...planet,
      fleet: transition.fleet,
      defense: transition.defense,
      fleetProduction: transition.state,
    }),
    completed: transition.completed,
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

  options.target.addEventListener(FLEET_PRODUCTION_START_REQUEST_EVENT, onStart);
  options.target.addEventListener(FLEET_PRODUCTION_CANCEL_REQUEST_EVENT, onCancel);
  return () => {
    options.target.removeEventListener(FLEET_PRODUCTION_START_REQUEST_EVENT, onStart);
    options.target.removeEventListener(FLEET_PRODUCTION_CANCEL_REQUEST_EVENT, onCancel);
  };
}
