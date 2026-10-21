import { createSeededRandom } from '../world/random.ts';
import type { CombatEntityId } from './ids.ts';

/**
 * Battle scrap rule (Nemexia help): scrap equals 25%–35% of the life lost by
 * all participants. One roll per battle, derived from the report id, so a
 * reload or a replay of the same battle always yields the same scrap.
 */
export const BATTLE_DEBRIS_ROLL_MIN = 0.25;
export const BATTLE_DEBRIS_ROLL_MAX = 0.35;

/**
 * Calibration point for the owner: "life lost" is the BASE catalog life of
 * each destroyed unit (no science bonuses, no damage dealt to survivors).
 */
export const BATTLE_DEBRIS_LIFE_BASIS = 'catalog-base-life-of-destroyed-units' as const;

/** Shields never leave scrap. */
export const BATTLE_DEBRIS_EXCLUDED_IDS: ReadonlySet<CombatEntityId> = new Set<CombatEntityId>([
  'tower-shield',
  'planetary-shield',
]);

/** Deterministic per-battle multiplier in [0.25, 0.35). */
export function battleDebrisRoll(seed: string): number {
  const draw = createSeededRandom(`battle-debris:${seed}`)();
  return BATTLE_DEBRIS_ROLL_MIN + draw * (BATTLE_DEBRIS_ROLL_MAX - BATTLE_DEBRIS_ROLL_MIN);
}

export function isBattleDebrisRoll(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= BATTLE_DEBRIS_ROLL_MIN && value <= BATTLE_DEBRIS_ROLL_MAX;
}
