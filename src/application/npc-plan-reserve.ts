import type { NpcStrikePlan } from '../domain/npc/strategy.ts';
import type { SaveState } from './contracts.ts';

/** The owner's active plans (at most a couple). */
export function activeNpcPlans(state: SaveState, ownerId: string): readonly NpcStrikePlan[] {
  return (state.npcStrategy?.plans[ownerId] ?? []).filter((plan) => plan.status === 'active');
}

function addCounts(into: Record<string, number>, counts: Readonly<Record<string, number>> | undefined): void {
  for (const [id, count] of Object.entries(counts ?? {})) into[id] = (into[id] ?? 0) + count;
}

/**
 * Ships of one planet an active plan holds for itself: while ships are built
 * and gathered each planet keeps its share (the rally planet also those that
 * already arrived), then the rally planet keeps the whole force. A choice of
 * the owner, not a rule: other plans of its own leave them alone; defence and
 * dispatch still see the real fleet.
 */
export function npcPlanReservedShips(state: SaveState, ownerId: string, planetId: string): Readonly<Record<string, number>> {
  const reserved: Record<string, number> = {};
  for (const plan of activeNpcPlans(state, ownerId)) {
    if (plan.phase === 'flying') continue;
    const gathered = plan.phase === 'recheck' || plan.phase === 'launch';
    if (planetId === plan.rallyPlanetId) {
      for (const [source, counts] of Object.entries(plan.reserve)) {
        if (gathered || source === planetId || plan.sent.includes(source)) addCounts(reserved, counts);
      }
    } else if (!gathered && !plan.sent.includes(planetId)) {
      addCounts(reserved, plan.reserve[planetId]);
    }
  }
  return reserved;
}

/** `available` less what the owner's plans hold on this planet. */
export function withoutNpcPlanReserve<T extends Readonly<Partial<Record<string, number>>>>(state: SaveState, ownerId: string, planetId: string, available: T): T {
  if (!state.npcStrategy) return available;
  const reserved = npcPlanReservedShips(state, ownerId, planetId);
  if (!Object.keys(reserved).length) return available;
  const left: Record<string, number> = { ...available } as Record<string, number>;
  for (const [id, count] of Object.entries(reserved)) if (left[id] !== undefined) left[id] = Math.max(0, left[id]! - count);
  return left as T;
}
