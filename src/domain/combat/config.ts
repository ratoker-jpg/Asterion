import { SPACEPORT_UPGRADE_MAX_LEVEL_BY_TRACK } from '../buildings/spaceport-upgrades.ts';

export const COMBAT_PROFILE_ID = 'asterion-simulator-v1' as const;
export const COMBAT_ENGINE_VERSION = 'asterion-combat-engine-v3' as const;

export const COMBAT_SHIP_LEVEL_COEFFICIENTS = Object.freeze({
  scout: 0.05,
  cruiser: 0.08,
  defender: 0.08,
  battleship: 0.08,
  destroyer: 0.11,
  bomber: 0.10,
  'death-star': 0.15,
} as const);

export const SIMULATOR_POPULATION_LIMITS = Object.freeze({
  attackerFleet: 35_000,
  defenderFleet: 35_000,
  defenderDefense: 35_000,
});

export const SIMULATOR_MAX_ROUNDS = [5, 8, 12] as const;
export type CombatMaxRounds = (typeof SIMULATOR_MAX_ROUNDS)[number];

export const PLANET_HANGAR_CAPACITY = 25_112;

export const COMBAT_ENTITY_LEVEL_LIMITS = Object.freeze({
  ship: SPACEPORT_UPGRADE_MAX_LEVEL_BY_TRACK.ships,
  commander: SPACEPORT_UPGRADE_MAX_LEVEL_BY_TRACK.commanders,
  // Asterion currently has no source-backed defence upgrade track. Keeping the
  // cap at zero makes a positive level explicit instead of inventing a rule.
  defense: 0,
});

export type CombatTechnologyMode = 'independent' | 'shared';
export type CombatExecutionMode = 'production' | 'calibration';
export type CombatTargetPriority = 'threat' | 'population' | 'catalog';
export const DEFAULT_COMBAT_TARGET_PRIORITY: CombatTargetPriority = 'threat';

export type RuleStatus = 'confirmed' | 'structural' | 'inferred' | 'unknown' | 'not-calibrated';

export type CombatRuleProvenance = {
  status: RuleStatus;
  source?: string;
  confidence?: 'high' | 'medium' | 'low';
  note?: string;
};

export const COMBAT_RULE_PROVENANCE = Object.freeze({
  profile: {
    status: 'confirmed',
    source: 'User decision: Asterion simulator population profile',
    confidence: 'high',
  },
  planetCapacity: {
    status: 'confirmed',
    source: 'Asterion fleet capacity configuration',
    confidence: 'high',
    note: 'Planet hangar capacity is not a combat population limit.',
  },
  resolutionOrder: {
    status: 'confirmed',
    source: 'Asterion implementation decision',
    confidence: 'high',
    note: 'Sequential attacker-then-defender resolution with retargeting.',
  },
  damageFormula: {
    status: 'inferred',
    source: 'Existing Asterion Combat Resolver v1',
    confidence: 'medium',
    note: 'Armor mitigation is a preserved baseline, not a Nemexia parity claim.',
  },
  unknownMechanics: {
    status: 'unknown',
    source: 'Evidence ledger',
    confidence: 'low',
    note: 'Неизвестные спецэффекты обычных корпусов, equipment и armor-ignore не меняют production-исход.',
  },
  targetSelection: {
    status: 'not-calibrated',
    source: 'Existing Asterion target-selection heuristic',
    confidence: 'low',
    note: 'Угроза → население → порядок каталога и явные fallback-профили доступны для диагностики, но не объявляются доказанным правилом Nemexia.',
  },
  entityLevelEffects: {
    status: 'inferred',
    source: 'ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md §4.4; Nemexia level probes',
    confidence: 'high',
    note: 'Asterion applies the extracted archetype coefficients to attack and life before count scaling.',
  },
  technologyEffects: {
    status: 'confirmed',
    source: 'ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md §4.3 and SCIENCE_CATALOG',
    confidence: 'high',
    note: 'Science contributions are additive from the original base characteristic in production and calibration.',
  },
  commanderEffects: {
    status: 'inferred',
    source: 'ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md §4.5; commander level-40 probes',
    confidence: 'high',
    note: 'Linear Asterion rate-per-level rules are active and telemetered in reports.',
  },
  matchupMatrix: {
    status: 'inferred',
    source: 'ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md §4.3.1; calibration180 damage/armor pairs',
    confidence: 'high',
    note: 'The 6×6 matrix is fixture-backed for source race 2 and reused across Asterion archetypes.',
  },
  specialBonuses: {
    status: 'inferred',
    source: 'ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md §4.3 special-unit probes',
    confidence: 'medium',
    note: 'Known catalog donors are frozen at round start and affect other allied stacks only.',
  },
} satisfies Readonly<Record<string, CombatRuleProvenance>>);

export function getCombatEntityLevelMax(kind: keyof typeof COMBAT_ENTITY_LEVEL_LIMITS) {
  return COMBAT_ENTITY_LEVEL_LIMITS[kind];
}
