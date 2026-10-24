import { createSeededRandom } from '../world/random.ts';
import type { NpcProfile } from './types.ts';

/**
 * NPC decision utility (concept §5): U = expected benefit − cost − risk + goal
 * + estimation error, in "days of the owner's own income" so building, fleet
 * and war compare on one scale. These are internal AI estimates from what the
 * owner can know; they never change what is legal or how the game resolves it.
 */

export type ForceStack = Readonly<{ count: number; attack: number; life: number }>;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function unit(value: number): number {
  return Math.min(1, Math.max(0, finite(value)));
}

/** Lanchester-style strength: total firepower times total hull, square-rooted. */
export function estimateForcePower(stacks: Iterable<ForceStack>): number {
  let attack = 0;
  let life = 0;
  for (const stack of stacks) {
    const count = Math.max(0, finite(stack.count));
    attack += count * Math.max(0, finite(stack.attack));
    life += count * Math.max(0, finite(stack.life));
  }
  return Math.sqrt(attack * life);
}

/** The owner's belief that its force beats the estimated defender. */
export function estimateWinProbability(ownPower: number, enemyPower: number): number {
  const own = Math.max(0, finite(ownPower));
  const enemy = Math.max(0, finite(enemyPower));
  if (own <= 0) return 0;
  if (enemy <= 0) return 0.97;
  return 1 / (1 + (enemy / own) ** 2.5);
}

/** How far ahead this owner plans an investment to pay back, in game hours. */
export function planningHorizonHours(profile: NpcProfile): number {
  return 6 + 66 * unit(profile.traits.planningHorizon);
}

/**
 * Seeded misjudgement in days of income: wide for owners who know the
 * mechanics poorly, narrow for experienced ones. Same inputs, same error.
 */
export function estimationError(profile: NpcProfile, eventId: string, candidateId: string): number {
  const spread = 0.08 + 0.55 * (1 - unit(profile.traits.mechanicsKnowledge));
  const random = createSeededRandom(JSON.stringify(['npc-utility-error:v1', profile.privateSeed, profile.ownerId, eventId, candidateId]));
  return (random() * 2 - 1) * spread;
}

/** Turns utility into a draw weight: clearly bad options stay possible but rare. */
export function utilityToWeight(utility: number): number {
  return Math.exp(Math.min(2.5, Math.max(-5, finite(utility, -5))));
}
