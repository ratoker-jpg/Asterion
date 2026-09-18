import {
  resolveCombat,
  type CombatResolverContext,
} from '../domain/combat/resolver.ts';
import { isAsterionLocalPlayerId, type BattleMissionType } from '../domain/combat/report.ts';
import type { CombatInput } from '../domain/combat/simulator.ts';
import { SOLAR_SATELLITE_ID } from '../domain/combat/ids.ts';
import { removeSolarSatellitesFromFleet } from '../domain/fleet/runtime.ts';
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

function withOwnedSolarSatellites(
  state: SaveState,
  planetId: PlanetId,
  input: CombatInput,
  missionType: ProductionCombatResolutionContext['missionType'],
): CombatInput {
  if (
    missionType !== 'defense'
    || (input.defender.participant.playerId !== state.profile.playerId && !isAsterionLocalPlayerId(input.defender.participant.playerId))
  ) return input;
  const planet = state.planets[planetId];
  if (!planet) return input;
  const migratedFleet = removeSolarSatellitesFromFleet(planet.fleet);
  const satelliteCount = Math.max(
    0,
    Math.floor(planet.solarSatellites ?? migratedFleet.count),
  );
  if (satelliteCount <= 0) return input;
  const hasSatellite = input.defender.ships.some((stack) => stack.entityId === SOLAR_SATELLITE_ID);
  return {
    ...input,
    defender: {
      ...input.defender,
      ships: hasSatellite
        ? input.defender.ships.map((stack) => stack.entityId === SOLAR_SATELLITE_ID
          ? { ...stack, count: satelliteCount }
          : stack)
        : [...input.defender.ships, { entityId: SOLAR_SATELLITE_ID, count: satelliteCount }],
    },
  };
}

/**
 * Production combat boundary. SimulatorView resolves temporary simulations
 * and persists only its editable scenarios; only a real combat caller should
 * use this function, which applies the canonical report and defensive repair
 * award in one application transition.
 */
export function resolveAndApplyCombat(
  state: SaveState,
  planetId: PlanetId,
  input: CombatInput,
  context: ProductionCombatResolutionContext,
): CombatResultApplication {
  const report = resolveCombat(
    withOwnedSolarSatellites(state, planetId, input, context.missionType),
    context,
  );
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
