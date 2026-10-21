import { PIRATE_CATALOG_BY_ID } from './catalog.ts';
import { isBattleDebrisRoll, BATTLE_DEBRIS_ROLL_MIN } from '../combat/debris.ts';
import { isPirateShipId } from '../combat/side-entity.ts';
import { isPiratePveMissionType, type BattleForceSnapshot, type BattleMissionType } from '../combat/report.ts';

export const PIRATE_BASE_DEBRIS_SHARE = 0.6;
export const COMMANDER_CORSAIR_DEBRIS_PER_LEVEL = 0.005;
export const COMMANDER_CORSAIR_DEBRIS_LEVEL_CAP = 40;
export const PIRATE_MAX_DEBRIS_SHARE = 0.8;
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
