import type { CommanderId } from './commanders.ts';
import type { CombatEntityId, DefenseId, ShipId } from './ids.ts';
import type { CombatTechnologyId, CombatTechnologyLevels } from './technologies.ts';
import type { CombatTargetPriority } from './config.ts';

export const ASTERION_LOCAL_PLAYER_ID = 'player-aster';
/** The profile fixture uses this id; keep the legacy combat id compatible. */
export const ASTERION_PROFILE_PLAYER_ID = 'player-current';

export function isAsterionLocalPlayerId(playerId: string | undefined): boolean {
  return playerId === ASTERION_LOCAL_PLAYER_ID || playerId === ASTERION_PROFILE_PLAYER_ID;
}

export type BattleSide = 'attacker' | 'defender';
export type BattleWinner = BattleSide | 'draw';
export type BattleMissionType = 'attack' | 'raid' | 'defense' | 'arena' | 'simulation';
export type CombatActionType = 'attack' | 'ability' | 'shield' | 'status' | 'destroyed' | 'special-bonus';
export const BATTLE_REPORT_SCHEMA_VERSION = 3;
export const COMBAT_ENGINE_VERSION = 'asterion-combat-engine-v3';

export type RngProvenance = {
  mode: 'seeded' | 'recorded-sequence' | 'non-replayable';
  algorithmVersion?: string;
  seed?: string;
  drawCount?: number;
  note?: string;
};

export type CombatProvenance = {
  status: 'confirmed' | 'structural' | 'inferred' | 'unknown' | 'not-calibrated';
  source?: string;
  confidence?: 'high' | 'medium' | 'low';
  note?: string;
};

export type BattleTechnologySnapshot = {
  id: CombatTechnologyId;
  level: number;
  maxLevel: number;
  status: CombatProvenance['status'];
  note?: string;
};

export type BattleRoundSummary = {
  attackerDamage?: number;
  defenderDamage?: number;
  damageByWeapon?: Readonly<Record<string, number>>;
  blockedDamage?: number;
  absorbedDamage?: number;
  destroyedPopulation?: number;
  destroyedUnits?: number;
  procs?: number;
  repairs?: number;
  criticalHits?: number;
  paralyzes?: number;
  cancelledAttacks?: number;
  survivingPopulation?: Readonly<{ attacker: number; defender: number }>;
  survivingDefensePopulation?: number;
};

export type BattleParticipant = {
  playerId?: string;
  playerName: string;
  planetName?: string;
  coordinates?: string;
  race?: string;
  side: BattleSide;
};

export type BattleStackSnapshot = {
  entityId: CombatEntityId;
  countBefore: number;
  countAfter: number;
  destroyed: number;
  /** Optional historical level captured by a future combat producer. */
  level?: number;
  /** Effective characteristic of one unit after level, science and side bonuses. */
  attackPerUnit?: number;
  /** Effective attack of the whole living stack. */
  totalAttack?: number;
  /** Effective life of one unit after level, science and side bonuses. */
  lifePerUnit?: number;
  /** Current pooled life of the whole stack. */
  hpPool?: number;
  life?: number;
  lifeBefore?: number;
  lifeAfter?: number;
  armor?: number;
  armorBefore?: number;
  armorAfter?: number;
  shield?: number;
  shieldBefore?: number;
  shieldAfter?: number;
};

type ShieldTransition =
  | { shieldBefore: number; shieldAfter: number }
  | { shieldBefore?: never; shieldAfter?: never };

type ArmorTransition =
  | { armorBefore: number; armorAfter: number }
  | { armorBefore?: never; armorAfter?: never };

type LifeTransition =
  | { lifeBefore: number; lifeAfter: number }
  | { lifeBefore?: never; lifeAfter?: never };

export type CombatEvent = {
  sequence: number;
  actorSide: BattleSide;
  actorEntityId: CombatEntityId;
  targetSide?: BattleSide;
  targetEntityId?: CombatEntityId;
  actionType: CombatActionType;
  actorCount?: number;
  targetCount?: number;
  attackValue?: number;
  baseAttack?: number;
  attackPerUnit?: number;
  totalAttack?: number;
  lifePerUnit?: number;
  hpPool?: number;
  rawDamage?: number;
  rawDamageBeforeArmor?: number;
  matchupMultiplier?: number;
  reportedBonus?: number;
  matchupStatus?: 'inferred' | 'not-calibrated';
  criticalChance?: number;
  criticalMultiplier?: number;
  abilityChance?: number;
  abilityDraw?: number;
  effectiveDamage?: number;
  mitigation?: number;
  weaponType?: string;
  armorType?: string;
  damage?: number;
  destroyedCount?: number;
  repairedCount?: number;
  repairLimit?: number;
  commanderAbilityId?: CommanderId;
  specialBonusKind?: 'attack' | 'life' | 'armor';
  specialBonusRate?: number;
  specialBonusCap?: number;
  specialBonusCapStatus?: 'known' | 'unknown';
  specialBonusLivingCount?: number;
  specialBonusAmount?: number;
  specialBonusScope?: 'fleet' | 'asterion';
  provenance?: CombatProvenance;
  note?: string;
} & ShieldTransition & ArmorTransition & LifeTransition;

export type CombatRoundSnapshot = {
  stacks: BattleStackSnapshot[];
  defenses?: BattleStackSnapshot[];
  fleetPopulationBefore?: number;
  fleetPopulationAfter?: number;
  defensePopulationBefore?: number;
  defensePopulationAfter?: number;
  modifiers?: Readonly<Record<string, number | string>>;
};

export type BattleInitialSnapshot = {
  attacker: CombatRoundSnapshot;
  defender: CombatRoundSnapshot;
};

export type CombatRound = {
  index: number;
  events: CombatEvent[];
  summary?: BattleRoundSummary;
  attackerSnapshot?: CombatRoundSnapshot;
  defenderSnapshot?: CombatRoundSnapshot;
};

export type BattleForceSnapshot = {
  populationBefore: number;
  populationAfter: number;
  stacks: BattleStackSnapshot[];
  defenses?: BattleStackSnapshot[];
  fleetPopulationBefore?: number;
  fleetPopulationAfter?: number;
  defensePopulationBefore?: number;
  defensePopulationAfter?: number;
  activeCommanderId?: CommanderId;
  activeCommanderLevel?: number;
  technologyLevels?: CombatTechnologyLevels;
  /** Historical combat technology levels captured with this report. */
  technologies?: CombatTechnologyLevels;
  technologySnapshots?: BattleTechnologySnapshot[];
  modifiers?: Readonly<Record<string, number | string>>;
};

export type BattleResourceOutcome = {
  metal?: number;
  minerals?: number;
  gas?: number;
};

export type BattleRepairEligibility = {
  status?: 'unknown' | 'available' | 'unavailable';
  claimState?: 'claimed' | 'not-eligible';
  shipUnits?: Partial<Record<ShipId, number>>;
  defenseUnits?: Partial<Record<DefenseId, number>>;
  note?: string;
};

export type BattleReportMetadata = {
  source: 'demo-fixture' | 'combat-resolver' | 'imported';
  note?: string;
  maxRounds?: number;
  profileId?: string;
  engineVersion?: string;
  executionMode?: 'production' | 'calibration';
  technologyMode?: 'independent' | 'shared';
  targetPriority?: Readonly<{ attacker: CombatTargetPriority; defender: CombatTargetPriority }>;
  rngProvenance?: RngProvenance;
  provenance?: Readonly<Record<string, CombatProvenance>>;
  unknowns?: string[];
};

export type BattleReport = {
  id: string;
  schemaVersion?: number;
  engineVersion?: string;
  timestamp: string;
  missionType: BattleMissionType;
  attacker: BattleParticipant;
  defender: BattleParticipant;
  winner: BattleWinner;
  roundCount: number;
  attackerForce: BattleForceSnapshot;
  defenderForce: BattleForceSnapshot;
  /** State before round 1; this is not a synthetic round zero. */
  initialSnapshot?: BattleInitialSnapshot;
  rounds: CombatRound[];
  experience?: number;
  debris?: number;
  resources?: BattleResourceOutcome;
  metadata?: BattleReportMetadata;
  repairEligibility?: BattleRepairEligibility;
};

export function normalizeBattleReport(value: unknown): BattleReport | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BattleReport>;
  if (typeof candidate.id !== 'string'
    || typeof candidate.timestamp !== 'string'
    || typeof candidate.roundCount !== 'number'
    || !Array.isArray(candidate.rounds)
    || !candidate.attacker
    || !candidate.defender
    || !candidate.attackerForce
    || !candidate.defenderForce) return null;

  let nextRoundIndex = 1;
  let nextSequence = 1;
  const rounds = candidate.rounds.map((round, roundIndex) => {
    const sourceEvents = Array.isArray(round?.events) ? round.events : [];
    const index = typeof round?.index === 'number' && round.index >= nextRoundIndex
      ? round.index
      : nextRoundIndex;
    nextRoundIndex = index + 1;
    return {
      ...round,
      index: index || roundIndex + 1,
      events: sourceEvents.map((event) => {
        const sequence = typeof event?.sequence === 'number' && event.sequence >= nextSequence
          ? event.sequence
          : nextSequence;
        nextSequence = sequence + 1;
        return { ...event, sequence };
      }),
    };
  });

  const metadata: BattleReportMetadata = {
    ...(candidate.metadata ?? {}),
    source: candidate.metadata?.source ?? 'imported',
    note: candidate.metadata?.note ?? 'Legacy BattleReport: расширенные поля не были доступны при создании.',
    rngProvenance: candidate.metadata?.rngProvenance ?? {
      mode: 'non-replayable',
      note: 'В старом отчёте отсутствует provenance seed/RNG.',
    },
    provenance: {
      legacy: {
        status: 'unknown',
        source: 'BattleReport migration',
        confidence: 'low',
        note: 'Новые поля старого отчёта не восстанавливаются выдуманными значениями.',
      },
      ...(candidate.metadata?.provenance ?? {}),
    },
    unknowns: candidate.metadata?.unknowns ?? ['Старый отчёт не содержит provenance полного боевого runtime.'],
  };

  return {
    ...candidate as BattleReport,
    schemaVersion: candidate.schemaVersion ?? 1,
    engineVersion: candidate.engineVersion ?? 'legacy-battle-report',
    rounds,
    metadata,
  };
}

export type BattleSummary = {
  id: string;
  timestamp: string;
  missionType: BattleMissionType;
  attacker: BattleParticipant;
  defender: BattleParticipant;
  winner: BattleWinner;
  rounds: number;
  attackerPopulationBefore: number;
  attackerPopulationAfter: number;
  defenderPopulationBefore: number;
  defenderPopulationAfter: number;
  target?: string;
  saved: boolean;
};

export type BattleListMode = 'recent' | 'saved';

export function calculateDestroyed(countBefore: number, countAfter: number) {
  return Math.max(0, countBefore - countAfter);
}

export function calculatePopulationLoss(populationBefore: number, populationAfter: number) {
  return Math.max(0, populationBefore - populationAfter);
}

export function createBattleSummary(report: BattleReport, savedReportIds: readonly string[]): BattleSummary {
  return {
    id: report.id,
    timestamp: report.timestamp,
    missionType: report.missionType,
    attacker: report.attacker,
    defender: report.defender,
    winner: report.winner,
    rounds: report.roundCount,
    attackerPopulationBefore: report.attackerForce.populationBefore,
    attackerPopulationAfter: report.attackerForce.populationAfter,
    defenderPopulationBefore: report.defenderForce.populationBefore,
    defenderPopulationAfter: report.defenderForce.populationAfter,
    target: report.defender.coordinates ?? report.defender.planetName,
    saved: savedReportIds.includes(report.id),
  };
}

export function filterBattleReports(
  reports: readonly BattleReport[],
  savedReportIds: readonly string[],
  mode: BattleListMode,
) {
  const saved = new Set(savedReportIds);
  const visible = mode === 'saved' ? reports.filter((report) => saved.has(report.id)) : [...reports];
  return visible.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export function getBattleResultForPlayer(report: BattleReport, playerId?: string) {
  if (report.winner === 'draw') return 'draw' as const;
  if (!playerId) return report.winner;
  const playerSide = report.attacker.playerId === playerId
    ? 'attacker'
    : report.defender.playerId === playerId
      ? 'defender'
      : undefined;
  if (!playerSide) return report.winner;
  return report.winner === playerSide ? 'victory' as const : 'defeat' as const;
}

export function assertBattleStackConsistency(stack: BattleStackSnapshot) {
  return stack.destroyed === calculateDestroyed(stack.countBefore, stack.countAfter);
}
