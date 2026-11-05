import type { BattleReportViewModel } from './battle-report-view-model.ts';
import { filterBattleReports, isAsterionLocalPlayerId, type BattleReport, type BattleSide } from './report.ts';

/** Unsaved reports leave «Последние» after this window; starred ones stay in «Сохранённые». */
export const BATTLE_RECENT_RETENTION_MS = 8 * 60 * 60 * 1_000;

/** Test-mode demo fixtures (QA samples) are not real battles and never expire. */
export function isDemoBattleReport(reportId: string): boolean {
  return reportId.startsWith('battle-demo-');
}

/** Whether a report's side is the player, counting the local-player aliases older reports carry. */
export function isPlayerBattleSide(sideId: string | null | undefined, playerId: string): boolean {
  return isAsterionLocalPlayerId(playerId) ? isAsterionLocalPlayerId(sideId) : sideId === playerId;
}

/**
 * A battle the player took part in. Every battle producer writes the player
 * into the side his forces fought on: his attacks and planet defences, pirate
 * raids on him, and Sun raids, where the player represents a merged side even
 * when another owner's name leads its label.
 */
export function isOwnBattleReport(report: Pick<BattleReport, 'attacker' | 'defender'>, playerId: string): boolean {
  return isPlayerBattleSide(report.attacker.playerId, playerId) || isPlayerBattleSide(report.defender.playerId, playerId);
}

export type BattleListHistory = { reports: readonly BattleReport[]; savedReportIds: readonly string[] };

/**
 * What Fleets → Битвы shows. The save keeps other owners' battles for NPC
 * decisions; they never reach this list, except one the player starred himself.
 */
export function selectBattleList(history: BattleListHistory, playerId: string, nowMs: number): { recent: BattleReport[]; saved: BattleReport[] } {
  const recent = history.reports.filter((report) => isOwnBattleReport(report, playerId)
    && (isDemoBattleReport(report.id) || nowMs - Date.parse(report.timestamp) < BATTLE_RECENT_RETENTION_MS));
  return {
    recent: filterBattleReports(recent, history.savedReportIds, 'recent'),
    saved: filterBattleReports(history.reports, history.savedReportIds, 'saved'),
  };
}

export type BattleRowSummary = {
  /** The side the player fought on; null on a starred battle of other owners. */
  ownSide: BattleSide | null;
  /** Population the player's side lost; null when unknown or not his battle. */
  lost: number | null;
  /** Resources the player's side gained (+) or had taken (−); null when the battle moved none. */
  resources: number | null;
};

/** The collapsed row's numbers, always from the player's side of the battle. */
export function battleRowSummary(viewModel: Pick<BattleReportViewModel, 'attacker' | 'defender' | 'resources'>, playerId: string): BattleRowSummary {
  const ownSide: BattleSide | null = isPlayerBattleSide(viewModel.attacker.participant.playerId, playerId)
    ? 'attacker'
    : isPlayerBattleSide(viewModel.defender.participant.playerId, playerId) ? 'defender' : null;
  if (!ownSide) return { ownSide, lost: null, resources: null };
  // The report's resources are what the attacker carried away.
  const moved = viewModel.resources.reduce((sum, resource) => sum + resource.value, 0);
  return {
    ownSide,
    lost: viewModel[ownSide].losses.population,
    resources: moved > 0 ? (ownSide === 'attacker' ? moved : -moved) : null,
  };
}
