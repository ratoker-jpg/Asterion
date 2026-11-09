import { createNpcStrategyState } from '../domain/npc/strategy.ts';
import { NPC_WARS_KEPT, type NpcWar, type NpcWarMember } from '../domain/npc/war.ts';
import type { SaveState } from './contracts.ts';

/** Revenge wars seen from the save (domain/npc/war.ts); the choosing lives in npc-war.ts. */

export const npcWarsOf = (state: SaveState): readonly NpcWar[] => state.npcStrategy?.wars ?? [];

export const activeNpcWars = (state: SaveState): readonly NpcWar[] => npcWarsOf(state).filter((war) => war.status === 'active');

export const npcWarMember = (war: NpcWar, ownerId: string): NpcWarMember | undefined => war.members.find((member) => member.ownerId === ownerId);

/** The active war this owner fights in (accepted), if any. */
export function activeNpcWarOf(state: SaveState, ownerId: string): NpcWar | undefined {
  return activeNpcWars(state).find((war) => npcWarMember(war, ownerId)?.answer === 'accepted');
}

/** The offender's planet the war is aimed at now: the first of its order the offender still holds. */
export function npcWarFocus(state: SaveState, war: NpcWar): string | undefined {
  return war.targets.find((id) => state.espionage?.targets?.[id]?.ownerId === war.offenderId);
}

/** Hold window around a round, in which the war's members keep their fleets for it (set by npc-war.ts). */
export const NPC_WAR_HOLD_LEAD_MS = 2 * 3_600_000;

/** Is this owner's fleet spoken for by a war round now? Its other attacks and strike plans wait. */
export function npcWarHolds(state: SaveState, ownerId: string, at: number): boolean {
  const war = activeNpcWarOf(state, ownerId);
  return Boolean(war && at >= war.roundAt - NPC_WAR_HOLD_LEAD_MS && at <= war.roundAt + war.windowMs && npcWarFocus(state, war));
}

/** Replaces or adds a war: active ones stay, the closed ones keep the newest few. */
export function withNpcWar(state: SaveState, war: NpcWar): SaveState {
  const strategy = state.npcStrategy ?? createNpcStrategyState();
  const list = strategy.wars ?? [];
  const next = list.some((item) => item.warId === war.warId) ? list.map((item) => (item.warId === war.warId ? war : item)) : [...list, war];
  const active = next.filter((item) => item.status === 'active');
  const closed = next.filter((item) => item.status !== 'active').sort((left, right) => (right.closedAt ?? 0) - (left.closedAt ?? 0)
    || (left.warId < right.warId ? -1 : 1)).slice(0, NPC_WARS_KEPT);
  return { ...state, npcStrategy: { ...strategy, wars: [...active, ...closed] } };
}

export function withNpcWarMember(war: NpcWar, member: NpcWarMember): NpcWar {
  return { ...war, members: war.members.some((item) => item.ownerId === member.ownerId)
    ? war.members.map((item) => (item.ownerId === member.ownerId ? member : item)) : [...war.members, member] };
}
