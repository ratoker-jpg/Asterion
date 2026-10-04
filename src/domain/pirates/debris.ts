import { PIRATE_CATALOG_BY_ID } from './catalog.ts';
import { isPirateShipId } from '../combat/side-entity.ts';
import type { BattleForceSnapshot } from '../combat/report.ts';

export const PIRATE_BASE_DEBRIS_SHARE = 0.6;
export const COMMANDER_CORSAIR_DEBRIS_PER_LEVEL = 0.005;
export const COMMANDER_CORSAIR_DEBRIS_LEVEL_CAP = 40;
export const PIRATE_MAX_DEBRIS_SHARE = 0.8;

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

export function calculatePirateForceDebris(
  force: BattleForceSnapshot,
  opposingForce: BattleForceSnapshot,
) {
  const share = pirateDebrisShare(corsairState(opposingForce));
  return force.stacks.reduce((total, stack) => {
    if (!isPirateShipId(stack.entityId)) return total;
    const destroyed = safeCount(stack.destroyed);
    if (destroyed <= 0) return total;
    const cost = PIRATE_CATALOG_BY_ID[stack.entityId].cost;
    // Match the existing per-stack, per-resource floor rounding.
    return total
      + Math.floor(cost.metal * destroyed * share)
      + Math.floor(cost.minerals * destroyed * share);
  }, 0);
}
