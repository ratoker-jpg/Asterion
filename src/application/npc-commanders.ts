import type { CommanderId } from '../domain/combat/commanders.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { NpcTraits } from '../domain/npc/types.ts';

/**
 * The main commander (owner request 27.10.2026). Raising a commander to
 * level 40 in the Spaceport is dear: in one match a player takes one to 40 and
 * the rest a little. An NPC picks its main commander by its style and keeps
 * it for the whole match (a pure function of its fixed character, so nothing
 * to migrate and no switching), builds it first and puts its upgrade money
 * into it first; the others are raised only from what is left over.
 *
 * Balance parameters (the owner may change these):
 */
export const NPC_COMMANDER_BALANCE = {
  /** Utility bonus of building the main commander while the owner has none. */
  buildMain: 1.2,
  /** Utility bonus of each upgrade of the main commander. */
  upgradeMain: 1.4,
  /** Other commanders are raised only while stores are this full (spare money)... */
  sparePressure: 0.6,
  /** ...and only up to this share of the main commander's level. */
  othersShareOfMain: 0.25,
} as const;

export type NpcCommanderStyle = 'aggressor' | 'defender' | 'tactician' | 'raider' | 'trader';

/** Commanders each style prefers, the first being its main one. */
export const NPC_COMMANDER_STYLES: Readonly<Record<NpcCommanderStyle, readonly CommanderId[]>> = {
  // Executioner: +attack of every own stack.
  aggressor: ['executioner', 'viper', 'judge'],
  // Juggernaut: +life of every own stack; Polias protects the planet from destruction.
  defender: ['juggernaut', 'polias', 'phantom'],
  // Judge: −armour of every enemy unit; Scorpion paralyses.
  tactician: ['judge', 'scorpion', 'phantom'],
  // Typhoon: faster flights; Corsair: more pirate debris.
  raider: ['typhoon', 'corsair', 'executioner'],
  // Argo: more cargo; Typhoon: shorter trips.
  trader: ['argo', 'typhoon', 'juggernaut'],
};

function unit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function npcCommanderStyle(traits: NpcTraits): NpcCommanderStyle {
  const scores: [NpcCommanderStyle, number][] = [
    ['aggressor', 0.6 * unit(traits.aggression) + 0.4 * unit(traits.militaryFocus)],
    ['defender', 0.5 * (1 - unit(traits.riskTolerance)) + 0.3 * unit(traits.militaryFocus) + 0.2 * unit(traits.persistence)],
    ['tactician', 0.6 * unit(traits.mechanicsKnowledge) + 0.4 * unit(traits.scienceFocus)],
    ['raider', 0.6 * unit(traits.operationsInterest) + 0.4 * unit(traits.riskTolerance)],
    ['trader', 0.6 * unit(traits.economyFocus) + 0.4 * unit(traits.cooperation)],
  ];
  return scores.reduce((best, item) => item[1] > best[1] ? item : best)[0];
}

export function npcMainCommander(traits: NpcTraits): CommanderId {
  return NPC_COMMANDER_STYLES[npcCommanderStyle(traits)][0]!;
}

/**
 * Battle priority («Флот → Боевой приоритет»): which present commander leads.
 * The main commander first (it is the strongest); the others by what the
 * owner knows of the enemy: heavy armour makes the Judge worth leading, a
 * few big hulls the Phantom and Scorpion, a crowd the Executioner. Without
 * knowledge the style order stands.
 */
export function npcCombatPriority(traits: NpcTraits, levels: Readonly<Partial<Record<CommanderId, number>>>,
  enemy: Readonly<{ heavyArmourShare: number; bigHullShare: number }> | null, all: readonly CommanderId[]): CommanderId[] {
  const style = NPC_COMMANDER_STYLES[npcCommanderStyle(traits)];
  const main = style[0]!;
  const fit = (id: CommanderId): number => {
    if (!enemy) return 0;
    if (id === 'judge') return enemy.heavyArmourShare;
    if (id === 'phantom' || id === 'scorpion') return enemy.bigHullShare;
    if (id === 'executioner') return 1 - enemy.bigHullShare;
    return 0;
  };
  const score = (id: CommanderId) => (id === main ? 1_000 : 0) + (levels[id] ?? 0) * (1 + fit(id))
    + (style.includes(id) ? 5 - style.indexOf(id) : 0) + 10 * fit(id);
  return [...all].sort((left, right) => score(right) - score(left) || all.indexOf(left) - all.indexOf(right));
}

/** Hulls this big are «big hulls» for the commander choice. */
const BIG_HULL_POPULATION = 15;

/**
 * What a known enemy fleet looks like to a commander choice: the share of its
 * hull under heavy armour and the share of its population in big hulls. Only
 * ever called with ships the owner is allowed to know.
 */
export function npcEnemyShape(raceId: CombatFactionId, ships: Readonly<Partial<Record<string, number>>>):
  { heavyArmourShare: number; bigHullShare: number } | null {
  let life = 0;
  let heavy = 0;
  let population = 0;
  let big = 0;
  for (const entity of getFactionShipCatalog(raceId)) {
    const count = Math.max(0, ships[entity.id] ?? 0);
    if (!count || !entity.combat) continue;
    life += count * entity.combat.life;
    if (entity.combat.armorType === 'Тяжелая Броня') heavy += count * entity.combat.life;
    population += count * entity.population;
    if (entity.population >= BIG_HULL_POPULATION) big += count * entity.population;
  }
  return life > 0 ? { heavyArmourShare: heavy / life, bigHullShare: population > 0 ? big / population : 0 } : null;
}
