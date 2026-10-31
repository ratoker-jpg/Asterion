import type { SaveState } from './contracts.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { selectOwnerMembership } from '../domain/command/selectors.ts';
import { hoardPressure, isNpcFortress, type NpcStrategyDrives, type NpcUtilityContext } from './npc-utility.ts';

/**
 * Play styles (owner 31.10.2026): bots play differently — a fortress that
 * sits in defence, a raider farming the weak, an economist growing mines and
 * collecting debris, a fleet commander striking at its peak and saving its
 * fleet, an alliance player for the Sun and aid, a crystal hunter. The
 * character gives the usual style; the situation changes it: attacked → the
 * fortress, rich → the fortress, weak targets spied → raids, the alliance
 * gathers for the Sun → it goes, crystals in play → the hunt. The style is
 * read again at every look from the world (nothing new is saved) and only
 * weighs action families; the bot journal records each change and its reason.
 */
export type NpcPlayStyle = 'fortress' | 'raider' | 'economist' | 'fleet' | 'ally' | 'crystal-hunter';

export type NpcStyleReading = Readonly<{ style: NpcPlayStyle; reason: string }>;

const unit = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));

/** The style a character leans to when nothing presses it. */
export function npcCharacterStyle(profile: NpcProfile): NpcPlayStyle {
  const t = profile.traits;
  const leanings: [NpcPlayStyle, number][] = [
    ['fortress', 0.6 * unit(t.economyFocus) + 0.6 * (1 - unit(t.riskTolerance)) - 0.4 * unit(t.aggression)],
    ['raider', unit(t.aggression) + 0.4 * unit(t.riskTolerance) - 0.3 * unit(t.planningHorizon)],
    ['economist', unit(t.economyFocus) + 0.4 * unit(t.expansionFocus) - 0.3 * unit(t.militaryFocus)],
    ['fleet', unit(t.militaryFocus) + 0.4 * unit(t.planningHorizon) - 0.2 * unit(t.economyFocus)],
    ['ally', unit(t.cooperation) + 0.4 * unit(t.socialStyle) - 0.2 * unit(t.aggression)],
    ['crystal-hunter', 0.6 * unit(t.aggression) + 0.6 * unit(t.riskTolerance) + 0.3 * unit(t.operationsInterest) - 0.3 * unit(t.cooperation)],
  ];
  return leanings.reduce((best, item) => (item[1] > best[1] ? item : best))[0];
}

export function readNpcPlayStyle(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, drives: NpcStrategyDrives): NpcStyleReading {
  const ownerId = profile.ownerId;
  if (utility.threat >= 0.5) return { style: 'fortress', reason: 'attacked' };
  const membership = selectOwnerMembership(state.command, ownerId);
  if (membership && (state.sunRaid?.raids ?? []).some((raid) => raid.status === 'gathering' && raid.allianceId === membership.alliance.id)) {
    return { style: 'ally', reason: 'alliance-gathers-for-sun' };
  }
  const crystalsInPlay = Object.values(state.sunRaid?.crystals ?? {}).some((list) => list.length > 0);
  const character = npcCharacterStyle(profile);
  if (crystalsInPlay && (character === 'crystal-hunter' || (!membership && unit(profile.traits.aggression) > 0.6))) {
    return { style: 'crystal-hunter', reason: 'crystals-in-play' };
  }
  const main = utility.ownPlanets.find((planet) => isNpcFortress(utility, planet));
  if (main && hoardPressure(utility, main) > 0.5 && character !== 'raider') return { style: 'fortress', reason: 'rich' };
  if (drives.war >= 0.75 && character !== 'fortress') return { style: 'raider', reason: 'weak-targets-near' };
  return { style: character, reason: 'character' };
}

/** How a style weighs one action family (1 = as the strategy has it). */
export function npcStyleBias(style: NpcPlayStyle, kind: string): number {
  switch (style) {
    case 'fortress': return kind === 'production' ? 1.4 : kind === 'attack' ? 0.6 : kind === 'economy' ? 1.2 : 1;
    case 'raider': return kind === 'attack' ? 1.5 : kind === 'recon' ? 1.2 : kind === 'economy' ? 0.85 : 1;
    case 'economist': return kind === 'economy' ? 1.4 : kind === 'pve' ? 1.3 : kind === 'attack' ? 0.6 : 1;
    case 'fleet': return kind === 'production' ? 1.3 : kind === 'fleetsave' ? 1.3 : kind === 'attack' ? 1.15 : 1;
    case 'ally': return kind === 'endgame' ? 1.6 : kind === 'aid' || kind === 'diplomacy' ? 1.4 : 1;
    case 'crystal-hunter': return kind === 'endgame' ? 1.5 : kind === 'attack' ? 1.3 : kind === 'recon' ? 1.2 : 1;
  }
}
