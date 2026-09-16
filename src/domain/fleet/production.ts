import {
  COMMANDER_COMBAT_CATALOG,
  type CatalogEntity,
} from '../combat/catalog.ts';
import { COMMANDER_IDS, type CommanderId } from '../combat/commanders.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import { DEFENSE_IDS, SHIP_IDS, type DefenseId, type ShipId } from '../combat/ids.ts';
import type { ResourceCost } from '../combat/types.ts';
import {
  calculateUnitProductionDurationMs,
  parseClockDurationMs,
} from '../buildings/balance-v1.ts';
import { scaleRuntimeDuration, type RuntimeMode } from '../runtime/mode.ts';
import { creditResources, type ResourceCapacitiesInput } from '../resources/credit.ts';
import { calculateRefund, selectCancelRefundPercent } from '../resources/refund.ts';
import {
  calculateFleetCapacity,
  calculateFleetPopulation,
  type OwnedFleetState,
} from './runtime.ts';

export type FleetProductionQueueKind = 'ships' | 'defense' | 'commanders';

export type FleetProductionWallet = Pick<ResourceCost, 'metal' | 'minerals' | 'gas'>;

export type OwnedDefenseState = {
  defenses: Record<DefenseId, number>;
};

export type FleetProductionOrder = {
  id: string;
  queueKind: FleetProductionQueueKind;
  itemId: string;
  quantity: number;
  completedQuantity: number;
  enqueuedAt: number;
  startedAt: number;
  finishAt: number;
  /** Effective duration of one unit, snapshotted at enqueue time. */
  effectiveDurationMs: number;
  /** Commander level is relevant only for commander orders. */
  commanderLevelAtEnqueue?: number;
  /** Full batch cost is retained so cancellation is deterministic and auditable. */
  cost: ResourceCost;
  refundEligible: boolean;
};

export type FleetProductionState = {
  shipQueue: FleetProductionOrder[];
  defenseQueue: FleetProductionOrder[];
  commanderQueue: FleetProductionOrder[];
};

export type FleetProductionDurationContext = {
  factionId: CombatFactionId;
  shipyardLevel: number;
  advancedFactoryLevel: number;
  commanderLevel?: number;
  mode?: RuntimeMode;
  testTimeScale?: number;
};

export type FleetProductionContext = FleetProductionDurationContext & {
  state: FleetProductionState;
  fleet: OwnedFleetState;
  defense: OwnedDefenseState;
  wallet: FleetProductionWallet;
  capacities?: ResourceCapacitiesInput;
  hangarLevel: number;
  now: number;
};

export type FleetProductionPopulationSummary = {
  ownedPopulation: number;
  pendingPopulation: number;
  population: number;
  capacity: number;
  available: number;
};

export type FleetProductionCompletion = {
  orderId: string;
  queueKind: FleetProductionQueueKind;
  itemId: string;
  quantity: number;
};

export type FleetProductionReconciliation = {
  changed: boolean;
  state: FleetProductionState;
  fleet: OwnedFleetState;
  defense: OwnedDefenseState;
  completed: FleetProductionCompletion[];
};

export type FleetProductionTransition = {
  ok: boolean;
  state: FleetProductionState;
  fleet: OwnedFleetState;
  defense: OwnedDefenseState;
  wallet: FleetProductionWallet;
  order: FleetProductionOrder | null;
  reason: string | null;
};

export type FleetProductionCancellationTransition = {
  ok: boolean;
  state: FleetProductionState;
  fleet: OwnedFleetState;
  defense: OwnedDefenseState;
  wallet: FleetProductionWallet;
  canceled: FleetProductionOrder | null;
  refund: FleetProductionWallet | null;
  refundPercent: number | null;
  reason: string | null;
};

export const FLEET_PRODUCTION_QUEUE_KINDS: readonly FleetProductionQueueKind[] = [
  'ships',
  'defense',
  'commanders',
];

const SINGLE_COPY_DEFENSE_IDS = new Set<DefenseId>(['tower-shield', 'planetary-shield']);

function emptyRecord<T extends string>(ids: readonly T[]): Record<T, number> {
  return Object.fromEntries(ids.map((id) => [id, 0])) as Record<T, number>;
}

export function createEmptyDefenseState(): OwnedDefenseState {
  return { defenses: emptyRecord(DEFENSE_IDS) };
}

export const createDefaultDefenseState = createEmptyDefenseState;

export function createDefaultFleetProductionState(): FleetProductionState {
  return {
    shipQueue: [],
    defenseQueue: [],
    commanderQueue: [],
  };
}

function queueFor(state: FleetProductionState, queueKind: FleetProductionQueueKind): FleetProductionOrder[] {
  return queueKind === 'ships'
    ? state.shipQueue
    : queueKind === 'defense'
      ? state.defenseQueue
      : state.commanderQueue;
}

export function getFleetProductionQueue(
  state: FleetProductionState,
  queueKind: FleetProductionQueueKind,
): readonly FleetProductionOrder[] {
  return queueFor(state, queueKind);
}

function stateWithQueue(
  state: FleetProductionState,
  queueKind: FleetProductionQueueKind,
  queue: FleetProductionOrder[],
): FleetProductionState {
  return queueKind === 'ships'
    ? { ...state, shipQueue: queue }
    : queueKind === 'defense'
      ? { ...state, defenseQueue: queue }
      : { ...state, commanderQueue: queue };
}

function entityFor(
  queueKind: FleetProductionQueueKind,
  itemId: string,
  factionId: CombatFactionId,
): CatalogEntity | null {
  if (queueKind === 'ships') return getFactionShipCatalog(factionId).find((entity) => entity.id === itemId) ?? null;
  if (queueKind === 'defense') return getFactionDefenseCatalog(factionId).find((entity) => entity.id === itemId) ?? null;
  return COMMANDER_COMBAT_CATALOG.find((entity) => entity.id === itemId) ?? null;
}

export function getFleetProductionEntity(
  queueKind: FleetProductionQueueKind,
  itemId: string,
  factionId: CombatFactionId,
): CatalogEntity | null {
  return entityFor(queueKind, itemId, factionId);
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeTimestamp(value: unknown, fallback: number): number {
  return Math.max(0, safeNumber(value, fallback));
}

function safePositiveInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
}

function safeNonNegativeInteger(value: unknown): number {
  return Math.max(0, safePositiveInteger(value));
}

function safeCost(value: unknown): ResourceCost | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const cost = (['metal', 'minerals', 'gas'] as const).map((key) => source[key]);
  if (!cost.every((candidate) => typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0)) return null;
  return {
    metal: cost[0] as number,
    minerals: cost[1] as number,
    gas: cost[2] as number,
  };
}

function safeCommanderLevel(value: unknown): number {
  return Math.min(40, Math.max(0, Math.floor(safeNumber(value, 0))));
}

function pendingQuantity(order: FleetProductionOrder): number {
  return Math.max(0, order.quantity - order.completedQuantity);
}

function pendingOrderCost(order: FleetProductionOrder): ResourceCost {
  const pending = pendingQuantity(order);
  const quantity = Math.max(1, Math.floor(order.quantity));
  return {
    metal: Math.max(0, Math.floor(order.cost.metal * pending / quantity)),
    minerals: Math.max(0, Math.floor(order.cost.minerals * pending / quantity)),
    gas: Math.max(0, Math.floor(order.cost.gas * pending / quantity)),
  };
}

function entityPopulation(entity: CatalogEntity | null): number {
  return entity ? Math.max(0, Math.floor(entity.population)) : 0;
}

function queuePopulation(
  queue: readonly FleetProductionOrder[],
  queueKind: FleetProductionQueueKind,
  factionId: CombatFactionId,
): number {
  return queue.reduce((total, order) => total + pendingQuantity(order) * entityPopulation(entityFor(queueKind, order.itemId, factionId)), 0);
}

export function getPendingFleetPopulation(state: FleetProductionState, factionId: CombatFactionId): number {
  return queuePopulation(state.shipQueue, 'ships', factionId)
    + queuePopulation(state.commanderQueue, 'commanders', factionId);
}

export function getPendingDefensePopulation(state: FleetProductionState, factionId: CombatFactionId): number {
  return queuePopulation(state.defenseQueue, 'defense', factionId);
}

export function calculateDefensePopulation(defense: OwnedDefenseState, factionId: CombatFactionId): number {
  return getFactionDefenseCatalog(factionId).reduce(
    (total, entity) => total + Math.max(0, Math.floor(defense.defenses[entity.id as DefenseId] ?? 0)) * entityPopulation(entity),
    0,
  );
}

/** Defense uses the same hangar capacity source, but never shares the fleet pool. */
export function calculateDefenseCapacity(hangarLevel: number): number {
  return calculateFleetCapacity(hangarLevel);
}

export function getFleetProductionPopulationSummary(
  fleet: OwnedFleetState,
  state: FleetProductionState,
  hangarLevel: number,
  factionId: CombatFactionId,
): FleetProductionPopulationSummary {
  const ownedPopulation = calculateFleetPopulation(fleet, factionId);
  const pendingPopulation = getPendingFleetPopulation(state, factionId);
  const capacity = calculateFleetCapacity(hangarLevel);
  return {
    ownedPopulation,
    pendingPopulation,
    population: ownedPopulation + pendingPopulation,
    capacity,
    available: Math.max(0, capacity - ownedPopulation - pendingPopulation),
  };
}

export function getDefensePopulationSummary(
  defense: OwnedDefenseState,
  state: FleetProductionState,
  hangarLevel: number,
  factionId: CombatFactionId,
): FleetProductionPopulationSummary {
  const ownedPopulation = calculateDefensePopulation(defense, factionId);
  const pendingPopulation = getPendingDefensePopulation(state, factionId);
  const capacity = calculateDefenseCapacity(hangarLevel);
  return {
    ownedPopulation,
    pendingPopulation,
    population: ownedPopulation + pendingPopulation,
    capacity,
    available: Math.max(0, capacity - ownedPopulation - pendingPopulation),
  };
}

export function calculateFleetProductionDurationMs(
  queueKind: FleetProductionQueueKind,
  itemId: string,
  context: FleetProductionDurationContext,
): number {
  const entity = entityFor(queueKind, itemId, context.factionId);
  if (!entity) throw new Error(`Unknown ${queueKind} production target: ${itemId}`);
  const rawDurationMs = parseClockDurationMs(entity.construction.time) ?? 1;
  const canonicalEffectiveBaseDurationMs = calculateUnitProductionDurationMs(
    rawDurationMs,
    context.shipyardLevel,
    context.advancedFactoryLevel,
  );
  const commanderMultiplier = queueKind === 'commanders'
    ? Math.max(1, safeCommanderLevel(context.commanderLevel))
    : 1;
  return scaleRuntimeDuration(
    canonicalEffectiveBaseDurationMs * commanderMultiplier,
    context.mode ?? 'production',
    context.testTimeScale,
  );
}

function multiplyCost(cost: ResourceCost, quantity: number): ResourceCost {
  return {
    metal: cost.metal * quantity,
    minerals: cost.minerals * quantity,
    gas: cost.gas * quantity,
  };
}

function subtractCost(wallet: FleetProductionWallet, cost: ResourceCost): FleetProductionWallet {
  return {
    metal: wallet.metal - cost.metal,
    minerals: wallet.minerals - cost.minerals,
    gas: wallet.gas - cost.gas,
  };
}

function hasEnoughResources(wallet: FleetProductionWallet, cost: ResourceCost): boolean {
  return wallet.metal >= cost.metal && wallet.minerals >= cost.minerals && wallet.gas >= cost.gas;
}

function ownedQuantity(
  fleet: OwnedFleetState,
  defense: OwnedDefenseState,
  queueKind: FleetProductionQueueKind,
  itemId: string,
): number {
  if (queueKind === 'ships') return fleet.ships[itemId as ShipId] ?? 0;
  if (queueKind === 'defense') return defense.defenses[itemId as DefenseId] ?? 0;
  return fleet.commanders[itemId as CommanderId] ?? 0;
}

function pendingQuantityForItem(
  state: FleetProductionState,
  queueKind: FleetProductionQueueKind,
  itemId: string,
): number {
  return queueFor(state, queueKind)
    .filter((order) => order.itemId === itemId)
    .reduce((total, order) => total + pendingQuantity(order), 0);
}

function emptyWalletLike(wallet: FleetProductionWallet): FleetProductionWallet {
  return { metal: wallet.metal, minerals: wallet.minerals, gas: wallet.gas };
}

function noEnqueue(
  context: FleetProductionContext,
  settled: FleetProductionReconciliation,
  reason: string,
): FleetProductionTransition {
  return {
    ok: false,
    state: settled.state,
    fleet: settled.fleet,
    defense: settled.defense,
    wallet: emptyWalletLike(context.wallet),
    order: null,
    reason,
  };
}

export function enqueueFleetProduction(
  context: FleetProductionContext,
  queueKind: FleetProductionQueueKind,
  itemId: string,
  quantity: number,
  orderId: string,
): FleetProductionTransition {
  const settled = reconcileFleetProductionState(context.state, context.fleet, context.defense, context.factionId, context.now);
  const workingState = settled.state;
  const workingFleet = settled.fleet;
  const workingDefense = settled.defense;
  const entity = entityFor(queueKind, itemId, context.factionId);
  if (!entity) return noEnqueue(context, settled, 'Эта единица недоступна для производства.');

  const safeQuantity = safePositiveInteger(quantity);
  if (safeQuantity <= 0) return noEnqueue(context, settled, 'Количество должно быть положительным.');
  if (context.shipyardLevel < entity.construction.requiredShipyardLevel) {
    return noEnqueue(context, settled, `Требуется верфь уровня ${entity.construction.requiredShipyardLevel}.`);
  }

  const queue = queueFor(workingState, queueKind);
  const currentOwned = ownedQuantity(workingFleet, workingDefense, queueKind, itemId);
  const currentPending = pendingQuantityForItem(workingState, queueKind, itemId);
  const maxOwned = queueKind === 'commanders'
    ? 1
    : queueKind === 'defense' && SINGLE_COPY_DEFENSE_IDS.has(itemId as DefenseId)
      ? 1
      : entity.maxOwned ?? null;
  if (maxOwned != null && currentOwned + currentPending + safeQuantity > maxOwned) {
    return noEnqueue(context, settled, queueKind === 'commanders'
      ? 'Каждый тип командирского корабля можно иметь только один раз.'
      : 'Этот щит уже построен или находится в очереди.');
  }

  const population = entityPopulation(entity) * safeQuantity;
  if (queueKind === 'defense') {
    const summary = getDefensePopulationSummary(workingDefense, workingState, context.hangarLevel, context.factionId);
    if (summary.population + population > summary.capacity) return noEnqueue(context, settled, 'Недостаточно населения обороны.');
  } else {
    const summary = getFleetProductionPopulationSummary(workingFleet, workingState, context.hangarLevel, context.factionId);
    if (summary.population + population > summary.capacity) return noEnqueue(context, settled, 'Недостаточно населения флота.');
  }

  const batchCost = multiplyCost(entity.cost, safeQuantity);
  if (!hasEnoughResources(context.wallet, batchCost)) {
    const labels: Record<keyof FleetProductionWallet, string> = { metal: 'металла', minerals: 'минералов', gas: 'газа' };
    const missing = (Object.keys(labels) as (keyof FleetProductionWallet)[])
      .find((key) => context.wallet[key] < batchCost[key]);
    return noEnqueue(context, settled, `Недостаточно ${missing ? labels[missing] : 'ресурсов'}.`);
  }

  const commanderLevel = queueKind === 'commanders' ? safeCommanderLevel(context.commanderLevel) : undefined;
  const effectiveDurationMs = calculateFleetProductionDurationMs(queueKind, itemId, {
    ...context,
    commanderLevel,
  });
  const previous = queue.at(-1);
  const startedAt = Math.max(context.now, previous?.finishAt ?? context.now);
  const task: FleetProductionOrder = {
    id: typeof orderId === 'string' && orderId.trim() ? orderId : `fleet-production-${queueKind}-${itemId}-${context.now}`,
    queueKind,
    itemId,
    quantity: safeQuantity,
    completedQuantity: 0,
    enqueuedAt: Math.max(0, context.now),
    startedAt,
    finishAt: startedAt + effectiveDurationMs * safeQuantity,
    effectiveDurationMs,
    ...(commanderLevel == null ? {} : { commanderLevelAtEnqueue: commanderLevel }),
    cost: batchCost,
    refundEligible: true,
  };
  return {
    ok: true,
    state: stateWithQueue(workingState, queueKind, [...queue, task]),
    fleet: workingFleet,
    defense: workingDefense,
    wallet: subtractCost(context.wallet, batchCost),
    order: task,
    reason: null,
  };
}

function rescheduleAfterCancellation(
  queue: readonly FleetProductionOrder[],
  canceledIndex: number,
  now: number,
): FleetProductionOrder[] {
  if (queue.length === 0) return [];
  const remaining = queue.filter((_order, index) => index !== canceledIndex);
  if (remaining.length === 0) return [];

  const canceledWasActive = canceledIndex === 0;
  let cursor: number | null = canceledWasActive ? Math.max(0, now) : null;
  return remaining.map((order, index) => {
    if (!canceledWasActive && index === 0) {
      cursor = order.finishAt;
      return order;
    }
    const startedAt = Math.max(0, cursor ?? order.startedAt);
    const finishAt = startedAt + order.effectiveDurationMs * order.quantity;
    cursor = finishAt;
    return { ...order, startedAt, finishAt };
  });
}

export function cancelFleetProduction(
  context: FleetProductionContext,
  orderId: string,
  rng: () => number = Math.random,
): FleetProductionCancellationTransition {
  const settled = reconcileFleetProductionState(context.state, context.fleet, context.defense, context.factionId, context.now);
  let queueKind: FleetProductionQueueKind | null = null;
  let queueIndex = -1;
  for (const candidate of FLEET_PRODUCTION_QUEUE_KINDS) {
    const index = queueFor(settled.state, candidate).findIndex((order) => order.id === orderId);
    if (index >= 0) {
      queueKind = candidate;
      queueIndex = index;
      break;
    }
  }
  if (!queueKind || queueIndex < 0) {
    return {
      ok: false,
      state: settled.state,
      fleet: settled.fleet,
      defense: settled.defense,
      wallet: emptyWalletLike(context.wallet),
      canceled: null,
      refund: null,
      refundPercent: null,
      reason: 'Заказ уже завершён или недоступен для отмены.',
    };
  }

  const queue = queueFor(settled.state, queueKind);
  const canceled = queue[queueIndex];
  if (!canceled) {
    return {
      ok: false,
      state: settled.state,
      fleet: settled.fleet,
      defense: settled.defense,
      wallet: emptyWalletLike(context.wallet),
      canceled: null,
      refund: null,
      refundPercent: null,
      reason: 'Невозможно подтвердить сохранённую стоимость заказа.',
    };
  }

  const pendingCost = pendingOrderCost(canceled);
  const refundPercent = canceled.refundEligible ? selectCancelRefundPercent(rng) : null;
  const refund = refundPercent == null ? null : calculateRefund(pendingCost, refundPercent);
  let nextWallet = emptyWalletLike(context.wallet);
  if (refund) {
    const unlimitedCapacities = { metal: Number.MAX_SAFE_INTEGER, minerals: Number.MAX_SAFE_INTEGER, gas: Number.MAX_SAFE_INTEGER };
    const credited = creditResources(
      { ...context.wallet, energy: 0 },
      context.capacities ?? unlimitedCapacities,
      refund,
    );
    nextWallet = { metal: credited.wallet.metal, minerals: credited.wallet.minerals, gas: credited.wallet.gas };
  }
  const nextState = stateWithQueue(
    settled.state,
    queueKind,
    rescheduleAfterCancellation(queue, queueIndex, context.now),
  );
  return {
    ok: true,
    state: nextState,
    fleet: settled.fleet,
    defense: settled.defense,
    wallet: nextWallet,
    canceled,
    refund,
    refundPercent,
    reason: null,
  };
}

function addOwnedUnits(
  fleet: OwnedFleetState,
  defense: OwnedDefenseState,
  queueKind: FleetProductionQueueKind,
  itemId: string,
  quantity: number,
): { fleet: OwnedFleetState; defense: OwnedDefenseState } {
  if (queueKind === 'ships') {
    return {
      fleet: { ...fleet, ships: { ...fleet.ships, [itemId]: (fleet.ships[itemId as ShipId] ?? 0) + quantity } },
      defense,
    };
  }
  if (queueKind === 'commanders') {
    return {
      fleet: { ...fleet, commanders: { ...fleet.commanders, [itemId]: (fleet.commanders[itemId as CommanderId] ?? 0) + quantity } },
      defense,
    };
  }
  return {
    fleet,
    defense: { ...defense, defenses: { ...defense.defenses, [itemId]: (defense.defenses[itemId as DefenseId] ?? 0) + quantity } },
  };
}

function reconcileQueue(
  state: FleetProductionState,
  fleet: OwnedFleetState,
  defense: OwnedDefenseState,
  queueKind: FleetProductionQueueKind,
  factionId: CombatFactionId,
  now: number,
): FleetProductionReconciliation {
  let nextState = state;
  let nextFleet = fleet;
  let nextDefense = defense;
  let queue = [...queueFor(state, queueKind)];
  const completed: FleetProductionCompletion[] = [];
  let changed = false;

  while (queue[0]) {
    const order = queue[0];
    const entity = entityFor(queueKind, order.itemId, factionId);
    if (!entity) {
      queue = queue.slice(1);
      changed = true;
      continue;
    }
    const duration = Math.max(1, Math.round(order.effectiveDurationMs));
    const quantity = Math.max(0, Math.floor(order.quantity));
    const currentCompleted = Math.min(quantity, Math.max(0, Math.floor(order.completedQuantity)));
    const elapsedUnits = now >= order.startedAt ? Math.floor((now - order.startedAt) / duration) : 0;
    const targetCompleted = Math.min(quantity, Math.max(currentCompleted, elapsedUnits));
    const delta = targetCompleted - currentCompleted;
    if (delta > 0) {
      const added = addOwnedUnits(nextFleet, nextDefense, queueKind, order.itemId, delta);
      nextFleet = added.fleet;
      nextDefense = added.defense;
      queue[0] = { ...order, completedQuantity: targetCompleted };
      changed = true;
    }
    if (targetCompleted >= quantity) {
      queue.shift();
      completed.push({ orderId: order.id, queueKind, itemId: order.itemId, quantity });
      changed = true;
      continue;
    }
    break;
  }

  if (changed) nextState = stateWithQueue(state, queueKind, queue);
  return { changed, state: nextState, fleet: nextFleet, defense: nextDefense, completed };
}

export function reconcileFleetProductionState(
  state: FleetProductionState,
  fleet: OwnedFleetState,
  defense: OwnedDefenseState,
  factionId: CombatFactionId,
  now: number,
): FleetProductionReconciliation {
  const ships = reconcileQueue(state, fleet, defense, 'ships', factionId, now);
  const defenseQueue = reconcileQueue(ships.state, ships.fleet, ships.defense, 'defense', factionId, now);
  const commanders = reconcileQueue(defenseQueue.state, defenseQueue.fleet, defenseQueue.defense, 'commanders', factionId, now);
  return {
    changed: ships.changed || defenseQueue.changed || commanders.changed,
    state: commanders.state,
    fleet: commanders.fleet,
    defense: commanders.defense,
    completed: [...ships.completed, ...defenseQueue.completed, ...commanders.completed],
  };
}

function migrateDefenseRecord(value: unknown): OwnedDefenseState {
  const migrated = createEmptyDefenseState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return migrated;
  const source = value as Record<string, unknown>;
  const defenses = source.defenses && typeof source.defenses === 'object' && !Array.isArray(source.defenses)
    ? source.defenses as Record<string, unknown>
    : source;
  for (const id of DEFENSE_IDS) {
    const value = safeNonNegativeInteger(defenses[id]);
    migrated.defenses[id] = SINGLE_COPY_DEFENSE_IDS.has(id) ? Math.min(1, value) : value;
  }
  return migrated;
}

export function migrateDefenseState(value: unknown): OwnedDefenseState {
  return migrateDefenseRecord(value);
}

type FleetProductionMigrationOptions = {
  factionId?: CombatFactionId;
  fleet?: OwnedFleetState;
  defense?: OwnedDefenseState;
  hangarLevel?: number;
};

type FleetProductionMigrationCapacity = {
  fleetPendingPopulation: number;
  defensePendingPopulation: number;
};

function migrateQueue(
  value: unknown,
  queueKind: FleetProductionQueueKind,
  options: FleetProductionMigrationOptions,
  usedOrderIds: Set<string>,
  capacityState: FleetProductionMigrationCapacity,
): FleetProductionOrder[] {
  const source = Array.isArray(value) ? value : [];
  const factionId = options.factionId ?? 'aegis';
  const result: FleetProductionOrder[] = [];
  const ownedFleet = options.fleet ?? { ships: emptyRecord(SHIP_IDS), commanders: emptyRecord(COMMANDER_IDS) };
  const ownedDefense = options.defense ?? createEmptyDefenseState();
  const enforceCapacity = options.hangarLevel != null || options.fleet != null || options.defense != null || options.factionId != null;
  const seenLimitedIds = new Set<string>();

  for (const raw of source) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const itemId = typeof item.itemId === 'string' ? item.itemId : typeof item.shipId === 'string' ? item.shipId : '';
    const entity = entityFor(queueKind, itemId, factionId);
    if (!entity) continue;
    let quantity = safePositiveInteger(item.quantity);
    if (quantity <= 0) continue;
    const limited = queueKind === 'commanders' || (queueKind === 'defense' && SINGLE_COPY_DEFENSE_IDS.has(itemId as DefenseId));
    if (limited) {
      const occupied = Math.min(1, ownedQuantity(ownedFleet, ownedDefense, queueKind, itemId))
        + (seenLimitedIds.has(itemId) ? 1 : 0);
      const remainingCopies = Math.max(0, 1 - occupied);
      if (remainingCopies <= 0) continue;
      quantity = Math.min(quantity, remainingCopies);
    }
    const persistedCompleted = item.completedQuantity ?? (
      typeof item.pendingQuantity === 'number' ? quantity - item.pendingQuantity : 0
    );
    const completedQuantity = Math.min(quantity, safeNonNegativeInteger(persistedCompleted));

    const persistedDuration = item.effectiveDurationMs ?? item.durationMs;
    const effectiveDurationMs = Math.max(1, Math.round(safeNumber(persistedDuration, parseClockDurationMs(entity.construction.time) ?? 1)));
    const enqueuedAt = safeTimestamp(item.enqueuedAt, 0);
    const rawStartedAt = safeTimestamp(item.startedAt, enqueuedAt);
    const previous = result.at(-1);
    const startedAt = previous ? Math.max(rawStartedAt, previous.finishAt) : rawStartedAt;
    const finishAt = startedAt + effectiveDurationMs * quantity;
    const rawId = typeof item.id === 'string' && item.id.trim()
      ? item.id.trim()
      : `migrated-fleet-production-${queueKind}-${itemId}-${startedAt}`;
    let id = rawId;
    let suffix = 1;
    while (usedOrderIds.has(id)) id = `${rawId}-${suffix++}`;
    usedOrderIds.add(id);

    const cost = safeCost(item.cost);
    const order: FleetProductionOrder = {
      id,
      queueKind,
      itemId,
      quantity,
      completedQuantity,
      enqueuedAt,
      startedAt,
      finishAt,
      effectiveDurationMs,
      ...(queueKind === 'commanders' ? { commanderLevelAtEnqueue: safeCommanderLevel(item.commanderLevelAtEnqueue ?? item.commanderLevel) } : {}),
      cost: cost ?? { metal: 0, minerals: 0, gas: 0 },
      refundEligible: item.refundEligible !== false && cost != null,
    };

    if (enforceCapacity) {
      const population = entityPopulation(entity) * pendingQuantity(order);
      if (queueKind === 'defense') {
        const cap = calculateDefenseCapacity(options.hangarLevel ?? 1);
        if (calculateDefensePopulation(ownedDefense, factionId) + capacityState.defensePendingPopulation + population > cap) continue;
        capacityState.defensePendingPopulation += population;
      } else {
        const cap = calculateFleetCapacity(options.hangarLevel ?? 1);
        if (calculateFleetPopulation(ownedFleet, factionId) + capacityState.fleetPendingPopulation + population > cap) continue;
        capacityState.fleetPendingPopulation += population;
      }
    }
    result.push(order);
    if (limited) seenLimitedIds.add(itemId);
  }

  return result;
}

export function migrateFleetProductionState(
  value: unknown,
  options: FleetProductionMigrationOptions = {},
): FleetProductionState {
  const defaults = createDefaultFleetProductionState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const source = value as Record<string, unknown>;
  const usedOrderIds = new Set<string>();
  const capacityState: FleetProductionMigrationCapacity = {
    fleetPendingPopulation: 0,
    defensePendingPopulation: 0,
  };
  return {
    shipQueue: migrateQueue(source.shipQueue, 'ships', options, usedOrderIds, capacityState),
    defenseQueue: migrateQueue(source.defenseQueue, 'defense', options, usedOrderIds, capacityState),
    commanderQueue: migrateQueue(source.commanderQueue, 'commanders', options, usedOrderIds, capacityState),
  };
}
