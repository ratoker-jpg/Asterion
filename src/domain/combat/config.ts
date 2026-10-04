import { SPACEPORT_UPGRADE_MAX_LEVEL_BY_TRACK } from '../buildings/spaceport-upgrades.ts';

export const COMBAT_PROFILE_ID = 'asterion-simulator-v1' as const;
export const COMBAT_ENGINE_VERSION = 'asterion-combat-engine-v8' as const;

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
    source: 'Nemexia repeated reports and supplied 15,000-population Aegis-vs-Veyra report; no saved Nemexia seed or RNG implementation',
    confidence: 'low',
    note: 'All 19 valid identical-profile repeats have distinct first-round ordinary-ship sequences, with stable relative ordinary-stack order across rounds. The supplied control report interleaves Death Star among ordinary combat ships. Asterion therefore seed-shuffles all combat ship stacks once at battle start as an approximation; commanders, defenses, and non-combat support ships keep catalog order. Nemexia’s exact RNG/shuffle remains unknown.',
  },
  repairTiming: {
    status: 'confirmed',
    source: 'Nemexia saved reports: 648 structured repair events across 273 valid reports',
    confidence: 'high',
    note: 'Every displayed repair follows that round’s last combat action. Asterion resolves both commander Reanimator and Destroyer Revival only after the combat phases; the two effects remain separately labeled in report events. When both Asterion Reanimators proc, Asterion keeps attacker-then-defender RNG order.',
  },
  destroyerRevival: {
    status: 'inferred',
    source: 'Official Nemexia Ships skills / Revival help and 641 archive repair entries',
    confidence: 'medium',
    note: 'Aegis/Confederation only. Use min(0.14% × functioning after-round Destroyers, 70%) chance and min(0.08% × Destroyers, 40%) of same-round losses per non-Destroyer target stack; round half-up. 641/641 archived repair amounts match. 641/7,643 per-target opportunities closely fit the chance, while one roll per side-round predicts 152.08 versus 525 observed rounds with repairs. Exact Nemexia RNG granularity is not explicit; Goliath and Hornet are excluded.',
  },
  shmelFreezing: {
    status: 'inferred',
    source: 'Nemexia Auto v2 saved Shmel ability tooltip and supplied detailed battle report',
    confidence: 'medium',
    note: 'Veyra Destroyer (Shmel) has 0.04% freezing chance per ship, capped at 20%. A successful seeded roll freezes one random living enemy combat-ship stack until its next action; exact target selection and RNG timing are approximations because the source does not specify them.',
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
    source: 'Nemexia Auto v2 saved ship pages; 6,052 Nemexia target transitions',
    confidence: 'low',
    note: 'Первый выбор, смешанные цели и неподтверждённые классы сохраняют selector Asterion; первичный класс по страницам кораблей отдельно подтверждён в 75/75 первых выборах Aegis. Только после уничтожения обычного корабля-цели, если действующий корабль и все оставшиеся живые цели относятся к шести обычным боевым классам, применяется наблюдавшийся Nemexia порядок primary-класс → bomber → destroyer → battleship → defender → cruiser → scout. В stage-2 корпусе правило совпало с 5,700/5,700 подходящих обычных переходов и 52/52 controlled-переходов, но разделение не является полностью независимым holdout. Первичный selector, оборона, командиры, Death Star и tie-break остаются неустановленными; seed Nemexia отсутствует, поэтому полного target-selector parity не заявляем.',
  },
  destroyedTargetFollowUp: {
    status: 'inferred',
    source: '5,622 same-stack multi-action groups in Nemexia archive; detailed user-supplied zero-tech 15,000 profile',
    confidence: 'medium',
    note: 'Для корабельного стека после уничтожения каждой цели выполняется следующий залп с мощностью 100%, 80%, 60%, 40%, 20%; после попадания по живой цели серия прекращается. Линейное падение подтверждено подробным профилем, но точная универсальная причина/формула не восстановлена. Командиры и оборона не получают дополнительные залпы.',
  },
  deathStarMatchups: {
    status: 'inferred',
    source: 'Nemexia Auto v2 saved ship pages and user-supplied detailed battle report',
    confidence: 'medium',
    note: 'Планетолом/Звезда смерти включён в ту же матрицу +70% / −30%: против Death Star ×1.7, Cruiser ×1.7, Defender ×0.7; все остальные сочетания нейтральны, согласно сохранённым таблицам.',
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
