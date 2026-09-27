import { SPACEPORT_UPGRADE_MAX_LEVEL_BY_TRACK } from '../buildings/spaceport-upgrades.ts';

export const COMBAT_PROFILE_ID = 'asterion-simulator-v1' as const;
export const COMBAT_ENGINE_VERSION = 'asterion-combat-engine-v4' as const;

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
    source: 'Nemexia saved reports: attacker phase precedes defender phase',
    confidence: 'high',
    note: 'Reports establish the displayed attacker-before-defender phase order and that all 6,052 extracted within-round target switches occur after the prior target is destroyed. They do not establish Nemexia cross-round target-lock behavior or its within-side ordering/RNG rule.',
  },
  targetLock: {
    status: 'confirmed',
    source: 'User-directed Asterion policy',
    confidence: 'high',
    note: 'Asterion retains a selected live target across rounds until it is destroyed. The archive supports same-round target persistence until destruction but does not independently establish Nemexia cross-round behavior.',
  },
  withinSideOrder: {
    status: 'not-calibrated',
    source: 'Nemexia repeated reports; no saved Nemexia seed or RNG implementation',
    confidence: 'low',
    note: 'All 19 valid identical-profile repeats have distinct first-round actor sequences. Asterion keeps its current fixed ordering; the Nemexia ordering mechanism is unknown.',
  },
  repairTiming: {
    status: 'confirmed',
    source: 'Nemexia saved reports: 648 structured repair events across 273 valid reports',
    confidence: 'high',
    note: 'Every displayed repair follows that round’s last combat action. Asterion resolves its existing Reanimator effect after both action phases. The archive does not establish Reanimator as the only repair source, its formula, or which side repairs first; when both Asterion Reanimators proc, Asterion keeps attacker-then-defender RNG order.',
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
    source: '6,052 Nemexia target transitions; existing Asterion heuristic retained',
    confidence: 'low',
    note: 'В Nemexia цель с минимальной численностью выбрана в 3,214/6,052 переходах; в контролируемом target_priority planned first target выбран только в 6/52. Это не задаёт детерминированного универсального selector; seed Nemexia отсутствует. Угроза → население → каталог — действующая эвристика Asterion, не правило Nemexia.',
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
