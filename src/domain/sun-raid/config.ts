/**
 * Every Sun raid / crystal / Gate number lives here. Logic never carries
 * literals: balance changes are made in this table only.
 */
export const SUN_RAID_CONFIG = Object.freeze({
  /** Chance that a won raid yields a crystal (the holder must still miss at least one). */
  crystalChance: 0.7,
  /** Brightness (efficiency percentage points) lost by a Sun per won raid. */
  brightnessLossPerWin: 5,
  /** At or below this brightness the Sun is frozen: it cannot be attacked. */
  frozenThreshold: 25,
  /** Recovery after a freeze: +step every stepMs up to the Sun's base efficiency. */
  recoverStepPercent: 5,
  recoverStepMs: 2 * 60 * 60 * 1000,
  /**
   * Population cap of each side (attack and defence) of one Sun battle. For the
   * attackers it is also the minimum (owner rule 25.10.2026): a raid flies only
   * once its gathering holds the full 225 000.
   */
  populationCapPerSide: 225_000,
  /** One participant (player or NPC) adds at most this much, from any of its planets. */
  participantPopulationCap: 75_000,
  /** The gathering after a raid is declared; not full by then, the raid disbands. */
  raidGatherMs: 30 * 60 * 1000,
  /** Hull sizes rarely add up to the exact number: the raid flies once this close to the cap. */
  raidLaunchTolerance: 100,
  /** Fixed one-way travel to any Sun, independent of distance and ship speed. */
  flightOneWayMs: 3 * 60 * 60 * 1000,
  /** Gate construction (scaled by campaign / Test Mode speed like every timer). */
  gateBuildMs: 12 * 60 * 60 * 1000,
  /** Delay before a holder may restart a destroyed Gate. */
  gateRestartCooldownMs: 24 * 60 * 60 * 1000,
  /** 0 is the start itself: the whole world is told who lays a Gate and where (owner rule 25.10.2026). */
  gateMilestones: [0, 25, 50, 75, 90] as readonly number[],
  /** Owner rules 25.10.2026 for a broken Gate. A solo holder keeps every crystal with this chance. */
  soloGateKeepChance: 0.5,
  /** A solo attacker steals the lost crystal with this chance; otherwise it is destroyed. An alliance attacker always destroys it. */
  soloStealChance: 0.7,
  crystalCount: 4,
  /** No neutral guard: a Sun without defenders falls to the attackers. Kept for a future NPC stage. */
  neutralGuardEnabled: false,
  // Standard battle rules: the same 12-round profile as a regular attack.
  maxRounds: 12 as const,
  historyLimit: 64,
});

export type SolarCrystalId = 'crystal-1' | 'crystal-2' | 'crystal-3' | 'crystal-4';

export const SOLAR_CRYSTAL_IDS: readonly SolarCrystalId[] = ['crystal-1', 'crystal-2', 'crystal-3', 'crystal-4'];

/** Names and colours chosen for Asterion (doc 25 only fixes that there are four). */
export const SOLAR_CRYSTALS: Readonly<Record<SolarCrystalId, { name: string; short: string; color: string; glow: string; lore: string }>> = Object.freeze({
  'crystal-1': { name: 'Кристалл Короны', short: 'Корона', color: '#ffc94a', glow: '#ff9d1f', lore: 'Застывший свет солнечной короны.' },
  'crystal-2': { name: 'Кристалл Прилива', short: 'Прилив', color: '#5fe6ff', glow: '#1fa8ff', lore: 'Холодная плазма магнитного прилива.' },
  'crystal-3': { name: 'Кристалл Затмения', short: 'Затмение', color: '#b58cff', glow: '#7a3cff', lore: 'Тень, отбрасываемая звездой на саму себя.' },
  'crystal-4': { name: 'Кристалл Вспышки', short: 'Вспышка', color: '#ff6b5a', glow: '#ff2d3f', lore: 'Сердцевина протуберанца, сжатая в камень.' },
});
