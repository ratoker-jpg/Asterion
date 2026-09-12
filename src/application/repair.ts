import {
  annotateBattleReportRepair,
  claimDefensiveBattleRepair,
  getRepairEntity,
  repairForResources,
  repairForTokens,
  type RepairCategory,
  type RepairPaymentMethod,
  type RepairTransition,
  type RepairTransitionContext,
} from '../domain/repair/workshop.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import type { PlanetId, SaveState } from './contracts.ts';
import { getPlanetState, replacePlanetState } from './contracts.ts';
import { SAVE_SCHEMA_VERSION } from './persistence.ts';

export const REPAIR_REQUEST_EVENT = 'asterion:repair-request';
export const REPAIR_NOTICE_CHANGED_EVENT = 'asterion:repair-notice-changed';
export const COMBAT_RESULT_APPLY_REQUEST_EVENT = 'asterion:combat-result-apply-request';

export type RepairRequest = {
  planetId?: PlanetId;
  category?: RepairCategory;
  entityId?: string;
  quantity?: number;
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
  return {
    planetId,
    repair: planet.repair,
    fleet: planet.fleet,
    defense: planet.defense,
    fleetProduction: planet.fleetProduction,
    wallet: { metal: state.metal, minerals: state.minerals, gas: state.gas },
    factionId: state.profile.factionId,
    hangarLevel: planet.buildings.hangar,
  };
}

export type RepairActionResult = {
  state: SaveState;
  transition: RepairTransition;
};

function stateFromRepairTransition(
  state: SaveState,
  planetId: PlanetId,
  transition: RepairTransition,
): SaveState {
  if (!transition.ok) return state;
  const planet = getPlanetState(state, planetId);
  return replacePlanetState({
    ...state,
    schemaVersion: SAVE_SCHEMA_VERSION,
    metal: transition.wallet.metal,
    minerals: transition.wallet.minerals,
    gas: transition.wallet.gas,
  }, planetId, {
    ...planet,
    repair: transition.repair,
    fleet: transition.fleet,
    defense: transition.defense,
  });
}

export function repairUnits(
  state: SaveState,
  planetId: PlanetId,
  category: RepairCategory,
  entityId: string,
  quantity: number,
  method: RepairPaymentMethod,
): RepairActionResult {
  const context = getRepairWorkshopSnapshot(state, planetId);
  const transition = method === 'resources'
    ? repairForResources(context, category, entityId, quantity)
    : repairForTokens(context, category, entityId, quantity);
  return {
    state: stateFromRepairTransition(state, planetId, transition),
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
    if (
      !request?.planetId
      || (request.category !== 'ship' && request.category !== 'defense')
      || typeof request.entityId !== 'string'
      || (request.method !== 'resources' && request.method !== 'tokens')
      || typeof request.quantity !== 'number'
      || !Number.isFinite(request.quantity)
    ) return;

    const result = repairUnits(
      options.getState(),
      request.planetId,
      request.category,
      request.entityId,
      request.quantity,
      request.method,
    );
    const entity = getRepairEntity(
      options.getState().profile.factionId,
      request.category,
      request.entityId,
    );
    const notice = result.transition.ok
      ? `${result.transition.quantity} × ${entity?.name ?? request.entityId} восстановлено ${request.method === 'tokens' ? 'за жетоны' : 'за ресурсы'} и возвращено ${request.category === 'ship' ? 'в флот' : 'в оборону планеты'}.`
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

/**
 * Application boundary for a real combat result. The combat caller is
 * responsible for applying the battle's losses to the owned rosters; this
 * transition records the report and awards defensive repair exactly once.
 * Simulator and report UI code intentionally do not call this function.
 */
export function applyBattleResult(
  state: SaveState,
  planetId: PlanetId,
  report: BattleReport,
): CombatResultApplication {
  const planet = getPlanetState(state, planetId);
  const claim = claimDefensiveBattleRepair(planet.repair, report);
  const reportIndex = state.combat.reports.findIndex((candidate) => candidate.id === report.id);
  const storedReport = reportIndex >= 0 ? state.combat.reports[reportIndex] : report;
  const nextReport = annotateBattleReportRepair(storedReport, claim);
  const nextReports = reportIndex < 0
    ? [...state.combat.reports, nextReport]
    : state.combat.reports[reportIndex] === nextReport
      ? state.combat.reports
      : state.combat.reports.map((candidate, index) => index === reportIndex ? nextReport : candidate);
  const reportsChanged = nextReports !== state.combat.reports;
  if (!claim.changed && !reportsChanged) return { state, report: nextReport, changed: false };

  const nextState = replacePlanetState({
    ...state,
    schemaVersion: SAVE_SCHEMA_VERSION,
    combat: reportsChanged ? { ...state.combat, reports: nextReports } : state.combat,
  }, planetId, {
    ...planet,
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
