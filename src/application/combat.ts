import {
  resolveCombat,
  type CombatResolverContext,
} from '../domain/combat/resolver.ts';
import type { BattleMissionType } from '../domain/combat/report.ts';
import type { CombatInput } from '../domain/combat/simulator.ts';
import type { PlanetId, SaveState } from './contracts.ts';
import {
  applyBattleResult,
  type CombatResultApplication,
} from './repair.ts';

export type ProductionCombatResolutionContext = Pick<CombatResolverContext, 'reportId'> & {
  /** A production caller must classify the resolved mission explicitly. */
  missionType: Exclude<BattleMissionType, 'simulation'>;
};

export const COMBAT_RESOLVE_REQUEST_EVENT = 'asterion:combat-resolve-request';

export type CombatResolutionRequest = {
  planetId?: PlanetId;
  input?: CombatInput;
  context?: ProductionCombatResolutionContext;
};

/**
 * Production combat boundary. SimulatorView continues to resolve and save
 * simulations through its own repository; only a real combat caller should
 * use this function, which applies the canonical report and defensive repair
 * award in one application transition.
 */
export function resolveAndApplyCombat(
  state: SaveState,
  planetId: PlanetId,
  input: CombatInput,
  context: ProductionCombatResolutionContext,
): CombatResultApplication {
  const report = resolveCombat(input, context);
  return applyBattleResult(state, planetId, report);
}

export type CombatResolutionEventBridgeOptions = {
  target: EventTarget;
  getState: () => SaveState;
  commit: (state: SaveState) => void;
  onNotice: (notice: string) => void;
};

/**
 * Runtime integration seam for a future fleet/combat producer. The simulator
 * does not dispatch this event and remains an isolated report repository.
 */
export function bindCombatResolutionEventBridge(options: CombatResolutionEventBridgeOptions): () => void {
  const onCombatResolution = (event: Event) => {
    const request = (event as CustomEvent<CombatResolutionRequest>).detail;
    if (!request?.planetId || !request.input || !request.context?.reportId || !request.context.missionType) return;

    try {
      const result = resolveAndApplyCombat(
        options.getState(),
        request.planetId,
        request.input,
        request.context,
      );
      if (result.changed) options.commit(result.state);
      options.onNotice(result.report.repairEligibility?.status === 'available'
        ? 'Оборонительный бой разрешён. Доступные потери добавлены в ремонтный пул.'
        : result.changed
          ? 'Боевой результат разрешён и сохранён.'
          : 'Боевой результат уже применён; ремонтный пул не изменён повторно.');
    } catch (error) {
      options.onNotice(error instanceof Error ? error.message : 'Боевой результат не прошёл валидацию.');
    }
  };

  options.target.addEventListener(COMBAT_RESOLVE_REQUEST_EVENT, onCombatResolution);
  return () => options.target.removeEventListener(COMBAT_RESOLVE_REQUEST_EVENT, onCombatResolution);
}
