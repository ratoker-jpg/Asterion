import type { SaveState } from './contracts.ts';

/**
 * When an owner was last at the game, as other players can see it. The live
 * player is online while playing; an NPC is online during its simulated
 * session and was last seen when the last one ended. Owners never seen
 * online (no session yet) have no presence.
 */
export type OwnerPresence = Readonly<{ online: true } | { online: false; lastSeenAt: number }>;

export function selectOwnerPresence(state: SaveState): Readonly<Record<string, OwnerPresence>> {
  const presence: Record<string, OwnerPresence> = { [state.profile.playerId]: { online: true } };
  for (const profile of Object.values(state.npc?.profiles ?? {})) {
    if (profile.session.active) presence[profile.ownerId] = { online: true };
    else if (typeof profile.session.lastBoundaryAt === 'number' && profile.activity.completedSessions > 0) {
      presence[profile.ownerId] = { online: false, lastSeenAt: profile.session.lastBoundaryAt };
    }
  }
  return presence;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Others see "online" for this long after a visit ends, so a logout time cannot be read off. */
export const FOREIGN_PRESENCE_ONLINE_GRACE_MS = 15 * MINUTE;

export type OwnerPresenceLabel = Readonly<{ tone: 'online' | 'recent' | 'away'; text: string }>;

/**
 * Allies see exact presence; everyone else only a coarse window (concept §4:
 * activity is observable like a real player's, the private schedule is not).
 */
export function describeOwnerPresence(presence: OwnerPresence | undefined, now: number, exact: boolean): OwnerPresenceLabel {
  if (!presence) return { tone: 'away', text: 'Ещё не заходил' };
  if (presence.online) return { tone: 'online', text: 'В сети' };
  const ago = Math.max(0, now - presence.lastSeenAt);
  if (exact) {
    if (ago < MINUTE) return { tone: 'recent', text: 'Был только что' };
    if (ago < HOUR) return { tone: 'recent', text: `Был ${Math.floor(ago / MINUTE)} мин назад` };
    if (ago < DAY) return { tone: 'recent', text: `Был ${Math.floor(ago / HOUR)} ч назад` };
    return { tone: 'away', text: `Был ${Math.floor(ago / DAY)} дн назад` };
  }
  if (ago < FOREIGN_PRESENCE_ONLINE_GRACE_MS) return { tone: 'online', text: 'В сети' };
  if (ago < DAY) return { tone: 'recent', text: 'Был в течение суток' };
  if (ago < 3 * DAY) return { tone: 'away', text: 'Был на днях' };
  return { tone: 'away', text: 'Давно не заходил' };
}
