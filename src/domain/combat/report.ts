import type { CommanderId } from './commanders.ts';
import type { CombatEntityId } from './ids.ts';

export const ASTERION_LOCAL_PLAYER_ID = 'player-aster';

export type BattleSide = 'attacker' | 'defender';
export type BattleWinner = BattleSide | 'draw';
export type BattleMissionType = 'attack' | 'raid' | 'defense' | 'arena' | 'simulation';
export type CombatActionType = 'attack' | 'ability' | 'shield' | 'status' | 'destroyed';

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
  life?: number;
  armor?: number;
  shield?: number;
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
  targetSide: BattleSide;
  targetEntityId: CombatEntityId;
  actionType: CombatActionType;
  actorCount?: number;
  targetCount?: number;
  attackValue?: number;
  damage?: number;
  destroyedCount?: number;
  commanderAbilityId?: CommanderId;
  note?: string;
} & ShieldTransition & ArmorTransition & LifeTransition;

export type CombatRoundSnapshot = {
  stacks: BattleStackSnapshot[];
  defenses?: BattleStackSnapshot[];
};

export type CombatRound = {
  index: number;
  events: CombatEvent[];
  attackerSnapshot?: CombatRoundSnapshot;
  defenderSnapshot?: CombatRoundSnapshot;
};

export type BattleForceSnapshot = {
  populationBefore: number;
  populationAfter: number;
  stacks: BattleStackSnapshot[];
  defenses?: BattleStackSnapshot[];
  activeCommanderId?: CommanderId;
  modifiers?: Readonly<Record<string, number | string>>;
};

export type BattleResourceOutcome = {
  metal?: number;
  minerals?: number;
  gas?: number;
};

export type BattleRepairEligibility = {
  status?: 'unknown' | 'available' | 'unavailable';
  note?: string;
};

export type BattleReportMetadata = {
  source: 'demo-fixture' | 'combat-resolver' | 'imported';
  note?: string;
  maxRounds?: number;
};

export type BattleReport = {
  id: string;
  timestamp: string;
  missionType: BattleMissionType;
  attacker: BattleParticipant;
  defender: BattleParticipant;
  winner: BattleWinner;
  roundCount: number;
  attackerForce: BattleForceSnapshot;
  defenderForce: BattleForceSnapshot;
  rounds: CombatRound[];
  experience?: number;
  debris?: number;
  resources?: BattleResourceOutcome;
  metadata?: BattleReportMetadata;
  repairEligibility?: BattleRepairEligibility;
};

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
