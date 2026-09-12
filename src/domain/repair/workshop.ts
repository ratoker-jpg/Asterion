import {
  getFactionDefenseCatalog,
  getFactionShipCatalog,
} from '../combat/faction-catalog.ts';
import { COMBAT_ENTITY_BY_ID } from '../combat/catalog.ts';
import {
  ASTERION_LOCAL_PLAYER_ID,
  type BattleReport,
} from '../combat/report.ts';
import {
  DEFENSE_IDS,
  SHIP_IDS,
  type CombatEntityId,
  type DefenseId,
  type ShipId,
} from '../combat/ids.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import type { ResourceCost } from '../combat/types.ts';
import {
  getDefensePopulationSummary,
  getFleetProductionPopulationSummary,
  type FleetProductionPopulationSummary,
  type FleetProductionState,
  type FleetProductionWallet,
  type OwnedDefenseState,
} from '../fleet/production.ts';
import type { OwnedFleetState } from '../fleet/runtime.ts';

export type RepairCategory = 'ship' | 'defense';
export type RepairPaymentMethod = 'resources' | 'tokens';

export const INITIAL_REPAIR_TOKEN_BALANCE = 31;
export const REPAIR_TOKEN_COST_PER_UNIT = 1;

export type RepairWorkshopState = {
  ships: Record<ShipId, number>;
  defenses: Record<DefenseId, number>;
  tokens: number;
  /** Defensive report IDs already consumed by the repair award transition. */
  claimedBattleIds: string[];
};

export type RepairWallet = FleetProductionWallet;

export type RepairEntity =
  | ReturnType<typeof getFactionShipCatalog>[number]
  | ReturnType<typeof getFactionDefenseCatalog>[number];

export type RepairCapacitySummary = FleetProductionPopulationSummary & {
  addedPopulation: number;
  category: RepairCategory;
  fits: boolean;
  reason: string | null;
};

export type RepairFailureCode =
  | 'invalid-entity'
  | 'invalid-quantity'
  | 'repair-pool'
  | 'capacity'
  | 'resources'
  | 'tokens';

export type RepairAvailability = {
  entity: RepairEntity | null;
  quantity: number;
  available: number;
  cost: ResourceCost;
  tokenCost: number;
  capacity: RepairCapacitySummary;
  capacityReason: string | null;
  resourceReason: string | null;
  tokenReason: string | null;
  canPayResources: boolean;
  canPayTokens: boolean;
};

export type RepairTransition = {
  ok: boolean;
  repair: RepairWorkshopState;
  fleet: OwnedFleetState;
  defense: OwnedDefenseState;
  wallet: RepairWallet;
  category: RepairCategory;
  entityId: string;
  quantity: number;
  cost: ResourceCost;
  tokenCost: number;
  capacity: RepairCapacitySummary;
  code: RepairFailureCode | null;
  reason: string | null;
};

export type RepairTransitionContext = {
  repair: RepairWorkshopState;
  fleet: OwnedFleetState;
  defense: OwnedDefenseState;
  fleetProduction: FleetProductionState;
  wallet: RepairWallet;
  factionId: CombatFactionId;
  hangarLevel: number;
};

function emptyRecord<T extends string>(ids: readonly T[]): Record<T, number> {
  return Object.fromEntries(ids.map((id) => [id, 0])) as Record<T, number>;
}

function safeNonNegativeInteger(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function sourceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createDefaultRepairWorkshopState(): RepairWorkshopState {
  return {
    ships: emptyRecord(SHIP_IDS),
    defenses: emptyRecord(DEFENSE_IDS),
    tokens: INITIAL_REPAIR_TOKEN_BALANCE,
    claimedBattleIds: [],
  };
}

export function migrateRepairWorkshopState(value: unknown): RepairWorkshopState {
  const defaults = createDefaultRepairWorkshopState();
  const source = sourceRecord(value);
  const shipsSource = sourceRecord(source.ships);
  const defensesSource = sourceRecord(source.defenses);
  const ships = emptyRecord(SHIP_IDS);
  const defenses = emptyRecord(DEFENSE_IDS);

  SHIP_IDS.forEach((id) => { ships[id] = safeNonNegativeInteger(shipsSource[id]); });
  DEFENSE_IDS.forEach((id) => { defenses[id] = safeNonNegativeInteger(defensesSource[id]); });

  const rawTokens = source.tokens;
  const tokens = rawTokens === undefined
    ? defaults.tokens
    : safeNonNegativeInteger(rawTokens);
  const claimedBattleIds = Array.isArray(source.claimedBattleIds)
    ? [...new Set(source.claimedBattleIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
    : [];

  return { ships, defenses, tokens, claimedBattleIds };
}

export function recoverableFromDestroyed(destroyed: number): number {
  return Math.round(Math.max(0, destroyed) * 0.5);
}

export function getRepairEntity(
  factionId: CombatFactionId,
  category: RepairCategory,
  entityId: string,
): RepairEntity | null {
  return category === 'ship'
    ? getFactionShipCatalog(factionId).find((entity) => entity.id === entityId) ?? null
    : getFactionDefenseCatalog(factionId).find((entity) => entity.id === entityId) ?? null;
}

export function calculateRepairCost(entity: RepairEntity, quantity: number): ResourceCost {
  const safeQuantity = safeNonNegativeInteger(quantity);
  return {
    metal: entity.cost.metal * 2 * safeQuantity,
    minerals: entity.cost.minerals * 2 * safeQuantity,
    gas: entity.cost.gas * 2 * safeQuantity,
  };
}

export function calculateRepairTokenCost(quantity: number): number {
  return safeNonNegativeInteger(quantity) * REPAIR_TOKEN_COST_PER_UNIT;
}

function availableFor(repair: RepairWorkshopState, category: RepairCategory, entityId: string): number {
  return category === 'ship'
    ? repair.ships[entityId as ShipId] ?? 0
    : repair.defenses[entityId as DefenseId] ?? 0;
}

function populationSummary(
  context: RepairTransitionContext,
  category: RepairCategory,
): FleetProductionPopulationSummary {
  return category === 'ship'
    ? getFleetProductionPopulationSummary(
      context.fleet,
      context.fleetProduction,
      context.hangarLevel,
      context.factionId,
    )
    : getDefensePopulationSummary(
      context.defense,
      context.fleetProduction,
      context.hangarLevel,
      context.factionId,
    );
}

function resourceReason(wallet: RepairWallet, cost: ResourceCost): string | null {
  const labels: Record<keyof ResourceCost, string> = {
    metal: 'металла',
    minerals: 'минералов',
    gas: 'газа',
  };
  const missing = (Object.keys(labels) as (keyof ResourceCost)[])
    .find((key) => wallet[key] < cost[key]);
  return missing ? `Недостаточно ${labels[missing]}.` : null;
}

function capacityFor(
  context: RepairTransitionContext,
  category: RepairCategory,
  entity: RepairEntity | null,
  quantity: number,
): RepairCapacitySummary {
  const summary = populationSummary(context, category);
  const addedPopulation = entity ? Math.max(0, Math.floor(entity.population)) * quantity : 0;
  const fits = Boolean(entity) && quantity > 0 && summary.population + addedPopulation <= summary.capacity;
  return {
    ...summary,
    addedPopulation,
    category,
    fits,
    reason: fits ? null : category === 'ship' ? 'Недостаточно населения флота.' : 'Недостаточно населения обороны.',
  };
}

function invalidCapacity(category: RepairCategory): RepairCapacitySummary {
  return {
    ownedPopulation: 0,
    pendingPopulation: 0,
    population: 0,
    capacity: 0,
    available: 0,
    addedPopulation: 0,
    category,
    fits: false,
    reason: category === 'ship' ? 'Недостаточно населения флота.' : 'Недостаточно населения обороны.',
  };
}

export function evaluateRepairAvailability(
  context: RepairTransitionContext,
  category: RepairCategory,
  entityId: string,
  quantity: number,
): RepairAvailability {
  const entity = getRepairEntity(context.factionId, category, entityId);
  const safeQuantity = safeNonNegativeInteger(quantity);
  const available = availableFor(context.repair, category, entityId);
  const cost = entity ? calculateRepairCost(entity, safeQuantity) : { metal: 0, minerals: 0, gas: 0 };
  const tokenCost = calculateRepairTokenCost(safeQuantity);
  const capacity = entity ? capacityFor(context, category, entity, safeQuantity) : invalidCapacity(category);
  const quantityReason = safeQuantity <= 0 ? 'Количество должно быть положительным.' : null;
  const entityReason = entity ? null : 'Эта единица не поддерживается ремонтной мастерской.';
  const poolReason = available < safeQuantity ? 'Недостаточно единиц в ремонтном пуле.' : null;
  const capacityReason = entityReason || quantityReason || poolReason
    ? null
    : capacity.reason;
  const baseReason = entityReason ?? quantityReason ?? poolReason;
  const resolvedCapacityReason = capacityReason;
  const resourceFailure = baseReason ?? resolvedCapacityReason ?? resourceReason(context.wallet, cost);
  const tokenFailure = baseReason ?? resolvedCapacityReason
    ?? (context.repair.tokens < tokenCost ? 'Недостаточно жетонов.' : null);

  return {
    entity,
    quantity: safeQuantity,
    available,
    cost,
    tokenCost,
    capacity,
    capacityReason: resolvedCapacityReason,
    resourceReason: resourceFailure,
    tokenReason: tokenFailure,
    canPayResources: resourceFailure == null,
    canPayTokens: tokenFailure == null,
  };
}

function failureTransition(
  context: RepairTransitionContext,
  category: RepairCategory,
  entityId: string,
  availability: RepairAvailability,
  code: RepairFailureCode,
  reason: string,
): RepairTransition {
  return {
    ok: false,
    repair: context.repair,
    fleet: context.fleet,
    defense: context.defense,
    wallet: context.wallet,
    category,
    entityId,
    quantity: availability.quantity,
    cost: availability.cost,
    tokenCost: availability.tokenCost,
    capacity: availability.capacity,
    code,
    reason,
  };
}

function repairWithPayment(
  context: RepairTransitionContext,
  category: RepairCategory,
  entityId: string,
  quantity: number,
  method: RepairPaymentMethod,
): RepairTransition {
  const availability = evaluateRepairAvailability(context, category, entityId, quantity);
  const reason = method === 'resources' ? availability.resourceReason : availability.tokenReason;
  if (reason) {
    const code: RepairFailureCode = availability.entity == null
      ? 'invalid-entity'
      : availability.quantity <= 0
        ? 'invalid-quantity'
        : availability.available < availability.quantity
          ? 'repair-pool'
          : availability.capacityReason
            ? 'capacity'
            : method === 'resources' ? 'resources' : 'tokens';
    return failureTransition(context, category, entityId, availability, code, reason);
  }

  const nextRepair: RepairWorkshopState = {
    ...context.repair,
    ships: category === 'ship'
      ? { ...context.repair.ships, [entityId as ShipId]: availability.available - availability.quantity }
      : context.repair.ships,
    defenses: category === 'defense'
      ? { ...context.repair.defenses, [entityId as DefenseId]: availability.available - availability.quantity }
      : context.repair.defenses,
    tokens: method === 'tokens'
      ? context.repair.tokens - availability.tokenCost
      : context.repair.tokens,
  };
  const nextFleet = category === 'ship'
    ? {
      ...context.fleet,
      ships: {
        ...context.fleet.ships,
        [entityId as ShipId]: (context.fleet.ships[entityId as ShipId] ?? 0) + availability.quantity,
      },
    }
    : context.fleet;
  const nextDefense = category === 'defense'
    ? {
      ...context.defense,
      defenses: {
        ...context.defense.defenses,
        [entityId as DefenseId]: (context.defense.defenses[entityId as DefenseId] ?? 0) + availability.quantity,
      },
    }
    : context.defense;
  const nextWallet = method === 'resources'
    ? {
      metal: context.wallet.metal - availability.cost.metal,
      minerals: context.wallet.minerals - availability.cost.minerals,
      gas: context.wallet.gas - availability.cost.gas,
    }
    : context.wallet;

  return {
    ok: true,
    repair: nextRepair,
    fleet: nextFleet,
    defense: nextDefense,
    wallet: nextWallet,
    category,
    entityId,
    quantity: availability.quantity,
    cost: availability.cost,
    tokenCost: availability.tokenCost,
    capacity: availability.capacity,
    code: null,
    reason: null,
  };
}

export function repairForResources(
  context: RepairTransitionContext,
  category: RepairCategory,
  entityId: string,
  quantity: number,
): RepairTransition {
  return repairWithPayment(context, category, entityId, quantity, 'resources');
}

export function repairForTokens(
  context: RepairTransitionContext,
  category: RepairCategory,
  entityId: string,
  quantity: number,
): RepairTransition {
  return repairWithPayment(context, category, entityId, quantity, 'tokens');
}

export type RepairBattleLosses = {
  eligible: boolean;
  ships: Partial<Record<ShipId, number>>;
  defenses: Partial<Record<DefenseId, number>>;
  reason: string | null;
};

export type RepairBattleClaimTransition = {
  ok: boolean;
  changed: boolean;
  state: RepairWorkshopState;
  losses: RepairBattleLosses;
  reason: string | null;
};

function safeDestroyed(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function addLoss(
  target: Partial<Record<ShipId, number>> | Partial<Record<DefenseId, number>>,
  entityId: ShipId | DefenseId,
  quantity: number,
) {
  if (quantity <= 0) return;
  const record = target as Record<string, number | undefined>;
  record[entityId] = (record[entityId] ?? 0) + quantity;
}

export function calculateRepairLosses(report: BattleReport): RepairBattleLosses {
  const eligible = report.missionType === 'defense'
    && report.defender.playerId === ASTERION_LOCAL_PLAYER_ID
    && report.defender.side === 'defender';
  if (!eligible) {
    return {
      eligible: false,
      ships: {},
      defenses: {},
      reason: 'Ремонт начисляется только за оборонительный бой на планете игрока.',
    };
  }

  const ships: Partial<Record<ShipId, number>> = {};
  const defenses: Partial<Record<DefenseId, number>> = {};
  const addSnapshot = (entityId: CombatEntityId, destroyed: number) => {
    // Reports can outlive a catalog revision. Unknown snapshots are kept in
    // the report but do not make the application transition throw.
    const entity = COMBAT_ENTITY_BY_ID.get(entityId);
    if (!entity) return;
    const quantity = recoverableFromDestroyed(safeDestroyed(destroyed));
    if (entity.kind === 'ship') addLoss(ships, entityId as ShipId, quantity);
    if (entity.kind === 'defense') addLoss(defenses, entityId as DefenseId, quantity);
  };

  const stacks = Array.isArray(report.defenderForce?.stacks) ? report.defenderForce.stacks : [];
  const defenseSnapshots = Array.isArray(report.defenderForce?.defenses) ? report.defenderForce.defenses : [];
  stacks.forEach((stack) => addSnapshot(stack.entityId, stack.destroyed));
  defenseSnapshots.forEach((stack) => addSnapshot(stack.entityId, stack.destroyed));

  return {
    eligible: true,
    ships,
    defenses,
    reason: null,
  };
}

export function claimDefensiveBattleRepair(
  repair: RepairWorkshopState,
  report: BattleReport,
): RepairBattleClaimTransition {
  const losses = calculateRepairLosses(report);
  if (typeof report.id !== 'string' || !report.id.trim()) {
    return { ok: false, changed: false, state: repair, losses, reason: 'Боевой отчёт не содержит идентификатор.' };
  }
  if (!losses.eligible) {
    return { ok: true, changed: false, state: repair, losses, reason: losses.reason };
  }
  if (repair.claimedBattleIds.includes(report.id)) {
    return { ok: true, changed: false, state: repair, losses, reason: null };
  }

  const next: RepairWorkshopState = {
    ...repair,
    ships: { ...repair.ships },
    defenses: { ...repair.defenses },
    claimedBattleIds: [...repair.claimedBattleIds, report.id],
  };
  Object.entries(losses.ships).forEach(([entityId, quantity]) => {
    next.ships[entityId as ShipId] += quantity ?? 0;
  });
  Object.entries(losses.defenses).forEach(([entityId, quantity]) => {
    next.defenses[entityId as DefenseId] += quantity ?? 0;
  });
  return { ok: true, changed: true, state: next, losses, reason: null };
}

function sameNumberRecord(left: Record<string, number> | undefined, right: Record<string, number> | undefined) {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([key, value]) => right?.[key] === value);
}

export function annotateBattleReportRepair(
  report: BattleReport,
  claim: RepairBattleClaimTransition,
): BattleReport {
  const total = Object.values(claim.losses.ships).reduce((sum, value) => sum + (value ?? 0), 0)
    + Object.values(claim.losses.defenses).reduce((sum, value) => sum + (value ?? 0), 0);
  const nextEligibility = {
    status: claim.losses.eligible && total > 0 ? 'available' as const : 'unavailable' as const,
    claimState: claim.losses.eligible ? 'claimed' as const : 'not-eligible' as const,
    shipUnits: claim.losses.ships,
    defenseUnits: claim.losses.defenses,
    note: claim.losses.reason ?? (total > 0
      ? '50% уничтоженных единиц добавлено в ремонтный пул.'
      : 'В оборонительном бою не было подходящих уничтоженных кораблей или обороны.'),
  };
  const previous = report.repairEligibility;
  if (
    previous?.status === nextEligibility.status
    && previous.claimState === nextEligibility.claimState
    && previous.note === nextEligibility.note
    && sameNumberRecord(previous.shipUnits, nextEligibility.shipUnits)
    && sameNumberRecord(previous.defenseUnits, nextEligibility.defenseUnits)
  ) return report;
  return { ...report, repairEligibility: nextEligibility };
}
