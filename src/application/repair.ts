import {
  annotateBattleReportRepair,
  claimDefensiveBattleRepair,
  evaluateRepairAvailability,
  getRepairEntity,
  removeFromRepairPool,
  repairForResources,
  repairForTokens,
  type RepairCategory,
  type RepairPaymentMethod,
  type RepairTransition,
  type RepairTransitionContext,
} from '../domain/repair/workshop.ts';
import { COMBAT_ENTITY_BY_ID } from '../domain/combat/catalog.ts';
import { isAsterionLocalPlayerId, type BattleReport } from '../domain/combat/report.ts';
import { SOLAR_SATELLITE_ID, type CombatEntityId } from '../domain/combat/ids.ts';
import {
  removeSolarSatellitesFromFleet,
  type OwnedFleetState,
} from '../domain/fleet/runtime.ts';
import type { PlanetId, SaveState } from './contracts.ts';
import { getPlanetResources, getPlanetState, replacePlanetResources, replacePlanetState } from './contracts.ts';
import { transitionPlanetEnergySources } from './energy.ts';
import { SAVE_SCHEMA_VERSION } from './persistence.ts';
import { isPlanetBlocked } from './overpopulation.ts';

export const REPAIR_REQUEST_EVENT = 'asterion:repair-request';
export const REPAIR_NOTICE_CHANGED_EVENT = 'asterion:repair-notice-changed';
export const COMBAT_RESULT_APPLY_REQUEST_EVENT = 'asterion:combat-result-apply-request';

export type RepairOperation = 'repair' | 'remove';

export type RepairRequest = {
  planetId?: PlanetId;
  category?: RepairCategory;
  entityId?: string;
  quantity?: number;
  operation?: RepairOperation;
  method?: RepairPaymentMethod;
};

export type RepairWorkshopSnapshot = RepairTransitionContext & {
  planetId: PlanetId;
};

export function getRepairWorkshopSnapshot(
  state: SaveState,
  planetId: PlanetId = state.currentPlanetId,
): RepairWorkshopSnapshot {
  const planet = getPlanetState(state, planetId);
  const migratedFleet = removeSolarSatellitesFromFleet(planet.fleet);
  const solarSatellites = Math.max(
    0,
    Math.floor(planet.solarSatellites ?? migratedFleet.count),
  );
  return {
    planetId,
    repair: planet.repair,
    fleet: migratedFleet.fleet,
    defense: planet.defense,
    fleetProduction: planet.fleetProduction,
    wallet: getPlanetResources(state, planetId),
    factionId: state.profile.factionId,
    hangarLevel: planet.buildings.hangar,
    solarSatellites,
  };
}

export type RepairActionResult = {
  state: SaveState;
  transition: RepairTransition;
};

function blockedRepairAction(
  state: SaveState,
  planetId: PlanetId,
  category: RepairCategory,
  entityId: string,
  quantity: number,
): RepairActionResult {
  const context = getRepairWorkshopSnapshot(state, planetId);
  const availability = evaluateRepairAvailability(context, category, entityId, quantity);
  return {
    state,
    transition: {
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
      code: null,
      reason: 'Планета заблокирована из-за перенаселения.',
    },
  };
}

function stateFromRepairTransition(
  state: SaveState,
  planetId: PlanetId,
  transition: RepairTransition,
  restoreUnit: boolean,
): SaveState {
  if (!transition.ok) return state;
  const planet = getPlanetState(state, planetId);
  const migratedFleet = removeSolarSatellitesFromFleet(transition.fleet);
  const currentSatelliteCount = Math.max(
    0,
    Math.floor(planet.solarSatellites ?? removeSolarSatellitesFromFleet(planet.fleet).count),
  );
  const restoresSatellite = restoreUnit
    && transition.category === 'ship'
    && transition.entityId === SOLAR_SATELLITE_ID;
  const previousPlanet = {
    ...planet,
    fleet: removeSolarSatellitesFromFleet(planet.fleet).fleet,
    solarSatellites: currentSatelliteCount,
  };
  const nextBasePlanet = {
    ...planet,
    fleet: migratedFleet.fleet,
    defense: transition.defense,
    solarSatellites: currentSatelliteCount + (restoresSatellite ? transition.quantity : 0),
  };
  const nextPlanet = transitionPlanetEnergySources(
    previousPlanet,
    nextBasePlanet,
    state.science.levels,
    state.science.levels,
  );
  const withPlanet = replacePlanetState({
    ...state,
    schemaVersion: SAVE_SCHEMA_VERSION,
  }, planetId, {
    ...nextPlanet,
    repair: transition.repair,
  });
  return replacePlanetResources(withPlanet, planetId, transition.wallet);
}

export function repairUnits(
  state: SaveState,
  planetId: PlanetId,
  category: RepairCategory,
  entityId: string,
  quantity: number,
  method: RepairPaymentMethod,
): RepairActionResult {
  if (isPlanetBlocked(state, planetId)) return blockedRepairAction(state, planetId, category, entityId, quantity);
  const context = getRepairWorkshopSnapshot(state, planetId);
  const transition = method === 'resources'
    ? repairForResources(context, category, entityId, quantity)
    : repairForTokens(context, category, entityId, quantity);
  return {
    state: stateFromRepairTransition(state, planetId, transition, true),
    transition,
  };
}

export function removeRepairUnits(
  state: SaveState,
  planetId: PlanetId,
  category: RepairCategory,
  entityId: string,
  quantity: number,
): RepairActionResult {
  if (isPlanetBlocked(state, planetId)) return blockedRepairAction(state, planetId, category, entityId, quantity);
  const context = getRepairWorkshopSnapshot(state, planetId);
  const transition = removeFromRepairPool(context, category, entityId, quantity);
  return {
    state: stateFromRepairTransition(state, planetId, transition, false),
    transition,
  };
}

export type RepairEventBridgeOptions = {
  target: EventTarget;
  getState: () => SaveState;
  commit: (state: SaveState) => void;
  onNotice: (notice: string) => void;
};

function publishRepairNotice(target: EventTarget, notice: string): void {
  target.dispatchEvent(new CustomEvent<string>(REPAIR_NOTICE_CHANGED_EVENT, { detail: notice }));
}

export function bindRepairEventBridge(options: RepairEventBridgeOptions): () => void {
  const onRepair = (event: Event) => {
    const request = (event as CustomEvent<RepairRequest>).detail;
    const operation = request?.operation ?? 'repair';
    if (
      !request?.planetId
      || (request.category !== 'ship' && request.category !== 'defense')
      || typeof request.entityId !== 'string'
      || (operation !== 'repair' && operation !== 'remove')
      || typeof request.quantity !== 'number'
      || !Number.isFinite(request.quantity)
      || (operation === 'repair' && request.method !== 'resources' && request.method !== 'tokens')
    ) return;

    const currentState = options.getState();
    const result = operation === 'remove'
      ? removeRepairUnits(
        currentState,
        request.planetId,
        request.category,
        request.entityId,
        request.quantity,
      )
      : repairUnits(
        currentState,
        request.planetId,
        request.category,
        request.entityId,
        request.quantity,
        request.method as RepairPaymentMethod,
      );
    const entity = getRepairEntity(
      currentState.profile.factionId,
      request.category,
      request.entityId,
    );
    const notice = result.transition.ok
      ? operation === 'remove'
        ? `${result.transition.quantity} × ${entity?.name ?? request.entityId} удалено из ремонтной мастерской без возврата ресурсов.`
        : `${result.transition.quantity} × ${entity?.name ?? request.entityId} восстановлено ${request.method === 'tokens' ? 'за жетоны' : 'за ресурсы'} и возвращено ${request.entityId === SOLAR_SATELLITE_ID ? 'на орбиту' : request.category === 'ship' ? 'в флот' : 'в оборону планеты'}.`
      : result.transition.reason ?? 'Восстановление сейчас недоступно.';
    if (result.transition.ok) options.commit(result.state);
    options.onNotice(notice);
    publishRepairNotice(options.target, notice);
  };

  options.target.addEventListener(REPAIR_REQUEST_EVENT, onRepair);
  return () => options.target.removeEventListener(REPAIR_REQUEST_EVENT, onRepair);
}

export type CombatResultApplyRequest = {
  planetId?: PlanetId;
  report?: BattleReport;
};

export type CombatResultApplication = {
  state: SaveState;
  report: BattleReport;
  changed: boolean;
};

function safeDestroyed(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function applyOwnedDefenderLosses(
  state: SaveState,
  planetId: PlanetId,
  report: BattleReport,
): { planet: SaveState['planets'][PlanetId]; changed: boolean } {
  const planet = getPlanetState(state, planetId);
  if (
    report.defender.side !== 'defender'
    || (report.defender.playerId !== state.profile.playerId && !isAsterionLocalPlayerId(report.defender.playerId))
  ) {
    return { planet, changed: false };
  }

  const migratedFleet = removeSolarSatellitesFromFleet(planet.fleet);
  const satelliteCount = Math.max(
    0,
    Math.floor(planet.solarSatellites ?? migratedFleet.count),
  );
  const nextFleet: OwnedFleetState = {
    ...migratedFleet.fleet,
    ships: { ...migratedFleet.fleet.ships },
    commanders: { ...migratedFleet.fleet.commanders },
  };
  const nextDefense = {
    ...planet.defense,
    defenses: { ...planet.defense.defenses },
  };
  let nextSatelliteCount = satelliteCount;
  let changed = migratedFleet.count > 0;

  const applyDestroyed = (entityId: string, destroyed: unknown) => {
    const quantity = safeDestroyed(destroyed);
    if (quantity <= 0) return;
    const entity = COMBAT_ENTITY_BY_ID.get(entityId as CombatEntityId);
    if (!entity) return;
    if (entity.kind === 'ship') {
      if (entity.id === SOLAR_SATELLITE_ID) {
        const removed = Math.min(nextSatelliteCount, quantity);
        if (removed > 0) {
          nextSatelliteCount -= removed;
          changed = true;
        }
        return;
      }
      const shipId = entity.id as keyof typeof nextFleet.ships;
      const current = Math.max(0, Math.floor(nextFleet.ships[shipId] ?? 0));
      const removed = Math.min(current, quantity);
      if (removed > 0) {
        nextFleet.ships[shipId] = current - removed;
        changed = true;
      }
      return;
    }
    if (entity.kind === 'defense') {
      const defenseId = entity.id as keyof typeof nextDefense.defenses;
      const current = Math.max(0, Math.floor(nextDefense.defenses[defenseId] ?? 0));
      const removed = Math.min(current, quantity);
      if (removed > 0) {
        nextDefense.defenses[defenseId] = current - removed;
        changed = true;
      }
    }
  };

  (report.defenderForce?.stacks ?? []).forEach((stack) => applyDestroyed(stack.entityId, stack.destroyed));
  (report.defenderForce?.defenses ?? []).forEach((stack) => applyDestroyed(stack.entityId, stack.destroyed));
  if (!changed) return { planet, changed: false };

  const previousPlanet = {
    ...planet,
    fleet: migratedFleet.fleet,
    solarSatellites: satelliteCount,
  };
  const nextBasePlanet = {
    ...planet,
    fleet: nextFleet,
    defense: nextDefense,
    solarSatellites: nextSatelliteCount,
  };
  const sourceChanges = nextSatelliteCount < satelliteCount
    ? { 'solar-satellite': 'satellite' as const }
    : undefined;
  return {
    planet: transitionPlanetEnergySources(
      previousPlanet,
      nextBasePlanet,
      state.science.levels,
      state.science.levels,
      sourceChanges ? { sourceChanges } : {},
    ),
    changed: true,
  };
}

/**
 * Application boundary for a real combat result. It applies owned defender
 * losses, records the report, and awards defensive repair exactly once.
 * Simulator and report UI code intentionally do not call this function.
 */
export function applyBattleResult(
  state: SaveState,
  planetId: PlanetId,
  report: BattleReport,
): CombatResultApplication {
  const planet = getPlanetState(state, planetId);
  const reportIndex = state.combat.reports.findIndex((candidate) => candidate.id === report.id);
  const defenderLosses = reportIndex < 0
    ? applyOwnedDefenderLosses(state, planetId, report)
    : { planet, changed: false };
  const claim = claimDefensiveBattleRepair(planet.repair, report);
  const storedReport = reportIndex >= 0 ? state.combat.reports[reportIndex] : report;
  const nextReport = annotateBattleReportRepair(storedReport, claim);
  const nextReports = reportIndex < 0
    ? [...state.combat.reports, nextReport]
    : state.combat.reports[reportIndex] === nextReport
      ? state.combat.reports
      : state.combat.reports.map((candidate, index) => index === reportIndex ? nextReport : candidate);
  const reportsChanged = nextReports !== state.combat.reports;
  if (!claim.changed && !reportsChanged && !defenderLosses.changed) return { state, report: nextReport, changed: false };

  const nextState = replacePlanetState({
    ...state,
    schemaVersion: SAVE_SCHEMA_VERSION,
    combat: reportsChanged ? { ...state.combat, reports: nextReports } : state.combat,
  }, planetId, {
    ...defenderLosses.planet,
    repair: claim.state,
  });
  return { state: nextState, report: nextReport, changed: true };
}

export type CombatResultEventBridgeOptions = {
  target: EventTarget;
  getState: () => SaveState;
  commit: (state: SaveState) => void;
  onNotice: (notice: string) => void;
};

export function bindCombatResultEventBridge(options: CombatResultEventBridgeOptions): () => void {
  const onCombatResult = (event: Event) => {
    const request = (event as CustomEvent<CombatResultApplyRequest>).detail;
    if (!request?.planetId || !request.report) return;
    const result = applyBattleResult(options.getState(), request.planetId, request.report);
    if (!result.changed) {
      options.onNotice('Боевой отчёт уже применён; ремонтный пул не изменён повторно.');
      return;
    }
    options.commit(result.state);
    const eligibility = result.report.repairEligibility;
    options.onNotice(eligibility?.status === 'available'
      ? 'Оборонительный бой применён. Доступные потери добавлены в ремонтный пул.'
      : 'Боевой отчёт применён. Подходящих потерь для ремонта нет.');
  };

  options.target.addEventListener(COMBAT_RESULT_APPLY_REQUEST_EVENT, onCombatResult);
  return () => options.target.removeEventListener(COMBAT_RESULT_APPLY_REQUEST_EVENT, onCombatResult);
}
