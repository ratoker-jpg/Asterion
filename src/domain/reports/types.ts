
import type { SpyHunterNotice, SpyReportSnapshot } from '../espionage/types.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import type { ShipId } from '../combat/ids.ts';

export type OrdinaryShipId = Exclude<ShipId, 'solar-satellite'>;

export type OverpopulationShipLoss = {
  shipId: OrdinaryShipId;
  count: number;
};

/** Final, persisted summary emitted once when a planet's overpopulation episode ends. */
export type OverpopulationEpisodeReport = {
  id: string;
  planetId: string;
  planetName: string;
  factionId: CombatFactionId;
  populationBefore: number;
  populationAfter: number;
  capacity: number;
  episodeStartedAt: number;
  episodeEndedAt: number;
  removedShips: OverpopulationShipLoss[];
};

export type ReportCategory =
  | 'system'
  | 'battle'
  | 'command'
  | 'arena'
  | 'flights'
  | 'alliances'
  | 'achievements';

export type ReportFilter = 'all' | 'unread' | 'saved';
export type ReportStatusTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';
export type ReportSource = 'combat' | 'operations' | 'command' | 'espionage' | 'overpopulation';

export type ReportDetail = {
  label: string;
  value: string;
};

export type ReportAction = {
  kind: 'open_fleets' | 'simulate_battle' | 'recall_spy';
  label: string;
  missionId?: string;
};

export type ReportItem = {
  id: string;
  source: ReportSource;
  category: ReportCategory;
  typeLabel: string;
  title: string;
  preview: string;
  body: string;
  timestamp?: string;
  statusLabel: string;
  statusTone: ReportStatusTone;
  participantNames: string[];
  planetNames: string[];
  coordinates: string[];
  details: ReportDetail[];
  battleReportId?: string;
  operationId?: string;
  commandOperationId?: string;
  spyReport?: SpyReportSnapshot;
  spyHunterNotice?: SpyHunterNotice;
  overpopulationReport?: OverpopulationEpisodeReport;
  action?: ReportAction;
  secondaryAction?: ReportAction;
};

export type ReportsState = {
  readIds: string[];
  hiddenIds: string[];
  /** Optional for backwards compatibility with existing save envelopes. */
  overpopulationReports?: OverpopulationEpisodeReport[];
};

export type ReportsCategoryKey = ReportCategory;

export type ReportQuery = {
  category: ReportsCategoryKey;
  filter: ReportFilter;
  search: string;
};

export type ReportCategoryCounts = Record<ReportsCategoryKey, number>;
export type ReportUnreadCounts = Record<ReportsCategoryKey, number>;
