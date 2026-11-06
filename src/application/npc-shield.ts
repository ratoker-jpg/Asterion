import type { SaveState } from './contracts.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { activateShield } from './shield.ts';
import { assessNpcPlanetThreat } from './npc-threat.ts';
import type { NpcUtilityContext } from './npc-utility.ts';

/**
 * An NPC raises its planet shield when a hostile fleet it expects to lose to
 * is on its way (the owner's own reading of the fight, the same win belief it
 * uses to decide whether to stay). The shield has a duration and a cooldown,
 * so it is a way to wait out a wave, never permanent immunity. Cannot be
 * raised while the owner's own attacks are still out (same rule as the player's).
 */
export function applyNpcShieldDecision(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number): SaveState {
  const ownerId = profile.ownerId;
  const record = state.shields?.[ownerId];
  if (record && at < record.readyAt) return state;
  let worst = 1;
  for (const planet of Object.values(state.espionage?.targets ?? {})) {
    if (planet.kind !== 'npc' || planet.ownerId !== ownerId) continue;
    const threat = assessNpcPlanetThreat(state, utility, planet, timeScale);
    if (!threat) continue;
    const margin = threat.winProbability - threat.stayThreshold;
    if (margin < worst) worst = margin;
  }
  // Only a clearly lost fight is worth the cooldown.
  if (worst >= -0.1) return state;
  const result = activateShield(state, ownerId, at);
  return result.ok ? result.state : state;
}
