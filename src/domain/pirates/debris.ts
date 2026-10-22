import { PIRATE_CATALOG_BY_ID } from './catalog.ts';
import { isBattleDebrisRoll, BATTLE_DEBRIS_ROLL_MIN } from '../combat/debris.ts';
import { isPirateShipId } from '../combat/side-entity.ts';
import { isPiratePveMissionType, type BattleForceSnapshot, type BattleMissionType } from '../combat/report.ts';

/**
 * Pirate PvE wreckage shares, relative to PIRATE_ORDINARY_DEBRIS_SHARE (the
 * common battle base, 25-35% of destroyed life). Owner retune 2026-10-21
 * (audit v2, option A x2.5): base 0.6 -> 1.5 (x5 the common base, i.e. 125-175%
 * of destroyed pirate life); Corsair and the cap scaled proportionally, so a
 * surviving Corsair L40 still adds +33.3% pirate wreckage (x6.67 the base).
 */
export const PIRATE_BASE_DEBRIS_SHARE = 1.5;
export const COMMANDER_CORSAIR_DEBRIS_PER_LEVEL = 0.0125;
export const COMMANDER_CORSAIR_DEBRIS_LEVEL_CAP = 40;
export const PIRATE_MAX_DEBRIS_SHARE = 2.0;
export const PIRATE_ORDINARY_DEBRIS_SHARE = 0.3;

export type CommanderCorsairSalvageState = Readonly<{
  participated: boolean;
  survived: boolean;
  level: number;
}>;

export function pirateDebrisShare(corsair: CommanderCorsairSalvageState | null | undefined = undefined) {
  if (!corsair?.participated || !corsair.survived) return PIRATE_BASE_DEBRIS_SHARE;
  const level = Number.isFinite(corsair.level)
    ? Math.min(COMMANDER_CORSAIR_DEBRIS_LEVEL_CAP, Math.max(0, Math.floor(corsair.level)))
    : 0;
  return Math.min(PIRATE_MAX_DEBRIS_SHARE, PIRATE_BASE_DEBRIS_SHARE + COMMANDER_CORSAIR_DEBRIS_PER_LEVEL * level);
}

function safeCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function corsairState(force: BattleForceSnapshot): CommanderCorsairSalvageState | null {
  const corsair = force.stacks.find((stack) => stack.entityId === 'corsair');
  if (!corsair || safeCount(corsair.countBefore) <= 0) return null;
  return {
    participated: true,
    survived: safeCount(corsair.countAfter) > 0,
    level: safeCount(corsair.level),
  };
}

/**
 * Pirate wreckage on the common battle base: u x life of destroyed pirate
 * hulls, scaled by share / PIRATE_ORDINARY_DEBRIS_SHARE. In ordinary battles
 * the ratio is 1 (same as any other hull); PvE pirate battles keep their
 * relative bonus (x2 base, Corsair raises it as before). `debrisRoll` must be
 * the same per-battle roll used for the ordinary part (battleDebrisRoll).
 */
export function calculatePirateForceDebris(
  force: BattleForceSnapshot,
  opposingForce: BattleForceSnapshot,
  missionType: BattleMissionType,
  debrisRoll: number,
) {
  const share = isPiratePveMissionType(missionType)
    ? pirateDebrisShare(corsairState(opposingForce))
    : PIRATE_ORDINARY_DEBRIS_SHARE;
  const roll = isBattleDebrisRoll(debrisRoll) ? debrisRoll : BATTLE_DEBRIS_ROLL_MIN;
  const life = force.stacks.reduce((total, stack) => {
    if (!isPirateShipId(stack.entityId)) return total;
    const destroyed = safeCount(stack.destroyed);
    if (destroyed <= 0) return total;
    return total + PIRATE_CATALOG_BY_ID[stack.entityId].combat.life * destroyed;
  }, 0);
  return Math.floor(roll * life * (share / PIRATE_ORDINARY_DEBRIS_SHARE));
}

/** Frozen production multipliers for pirate-elimination wreckage on a draw / any non-victory. */
export const PIRATE_ELIMINATION_DRAW_MULTIPLIER = 0.75;
export const PIRATE_ELIMINATION_DEFEAT_MULTIPLIER = 0.5;

export type PirateEliminationFrozenMultipliers = {
  /** Full-victory reward (hangar fraction); 1 for legacy snapshots without a budget. */
  rewardMultiplier?: number;
  drawMultiplier?: number;
  defeatMultiplier?: number;
};

/**
 * The single outcome rule of a pirate elimination (production and balance tools
 * alike): a full victory takes the reward multiplier, a draw x0.75, any other
 * outcome x0.5. Missing frozen values (legacy flights) stay x1.
 */
export function selectPirateEliminationMultiplier(
  outcome: { victory: boolean; winner: string },
  frozen: PirateEliminationFrozenMultipliers,
): number {
  if (outcome.victory) return frozen.rewardMultiplier ?? 1;
  return outcome.winner === 'draw' ? frozen.drawMultiplier ?? 1 : frozen.defeatMultiplier ?? 1;
}

/**
 * Applies the multiplier to pirate wreckage only; the player's own hull salvage
 * is never penalized. Negative amounts are dropped like `addDebris` does.
 */
export function settlePirateEliminationDebris(baseDebris: number, basePirateDebris: number, multiplier: number) {
  const ownDebris = Math.max(0, baseDebris - basePirateDebris);
  const adjustedPirateDebris = Math.floor(basePirateDebris * multiplier);
  const debris = Math.min(Number.MAX_SAFE_INTEGER, ownDebris + Math.max(0, adjustedPirateDebris));
  return { ownDebris, adjustedPirateDebris, bonusPirateDebris: adjustedPirateDebris - basePirateDebris, debris };
}
