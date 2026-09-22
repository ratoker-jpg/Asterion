import { UNIVERSE_NPC_OWNER_ID } from '../universe/runtime.ts';
import type { Bot01Profile, SpyOwnerProfile, SpyTargetState } from './types.ts';

/**
 * Resolves the authoritative owner-wide combat profile for a live target.
 * Player profiles are attached to the target when supplied by persistence;
 * Bot 01 is the only Test Mode fallback and is never inferred in production.
 */
export function resolveSpyOwnerProfile(
  target: Pick<SpyTargetState, 'ownerId' | 'ownerProfile'>,
  bot01Profile?: Bot01Profile,
): SpyOwnerProfile | undefined {
  if (target.ownerProfile) return target.ownerProfile;
  return target.ownerId === UNIVERSE_NPC_OWNER_ID ? bot01Profile : undefined;
}
