import type { SaveState } from './contracts.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { estimationError } from '../domain/npc/utility.ts';
import { activateShield, checkShieldActivation } from './shield.ts';
import { assessNpcPlanetThreat } from './npc-threat.ts';
import type { NpcUtilityContext } from './npc-utility.ts';

const DAY = 24 * 3_600_000;
const unit = (value: number) => Math.min(1, Math.max(0, value));

export type NpcShieldReason = 'incoming-fleet' | 'losing-war' | 'rebuild';

/**
 * An NPC weighs the shield as a real decision: what it protects against
 * (a fleet it expects to lose to, a war it is losing, heavy losses to rebuild
 * from) against what it gives up (it cannot attack, raid or join Suns while
 * the shield burns, and a fighter's time is worth more to it). Character
 * moves both sides; a seeded misjudgement keeps owners apart. Under the
 * shield its production leans to defence and fleet (npc-utility `shielded`).
 * The cooldown makes it a breather, never permanent immunity.
 */
export function chooseNpcShield(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number): NpcShieldReason | null {
  const ownerId = profile.ownerId;
  if (!checkShieldActivation(state, ownerId, at).ok) return null;
  const traits = profile.traits;
  let worstMargin = 1;
  for (const planet of utility.ownPlanets) {
    const threat = assessNpcPlanetThreat(state, utility, planet, timeScale);
    if (threat) worstMargin = Math.min(worstMargin, threat.winProbability - threat.stayThreshold);
  }
  const incoming = unit(-worstMargin * 2.5);
  const recentLosses = [...(utility.attackLossAt?.values() ?? [])].filter((when) => at - when < DAY / Math.max(1, timeScale)).length;
  const losingWar = utility.threat >= 0.34 ? unit(0.45 * utility.threat + 0.3 * Math.min(1, recentLosses / 2) + 0.2 * (utility.strategy?.war ?? 0)) : 0;
  const rebuild = utility.threat >= 0.67 ? unit(0.8 * utility.threat) : 0;
  const needs: ReadonlyArray<readonly [NpcShieldReason, number]> = [['incoming-fleet', incoming], ['losing-war', losingWar], ['rebuild', rebuild]];
  const [reason, need] = needs.reduce((best, item) => (item[1] > best[1] ? item : best));
  if (need <= 0) return null;
  // What a fighter gives up: its own attacks, and the bolder it is the more they are worth.
  const cost = 0.15 + 0.3 * unit(traits.aggression) + 0.2 * (utility.strategy?.war ?? 0) + 0.1 * unit(traits.riskTolerance) - 0.15 * unit(traits.planningHorizon);
  const value = need * (1 - 0.35 * unit(traits.riskTolerance)) - cost + estimationError(profile, `shield:${Math.floor(at / 3_600_000)}`, reason) * 0.5;
  return value > 0.1 ? reason : null;
}

export function applyNpcShieldDecision(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number): SaveState {
  const reason = chooseNpcShield(state, profile, utility, at, timeScale);
  if (!reason) return state;
  const result = activateShield(state, profile.ownerId, at, reason);
  return result.ok ? result.state : state;
}
