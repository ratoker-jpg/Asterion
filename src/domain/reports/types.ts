export type ReportCategory =
  | 'battle'
  | 'flights'
  | 'recon'
  | 'economy'
  | 'construction'
  | 'diplomacy'
  | 'system'
  | 'inbox';

export type ReportFilter = 'all' | 'unread' | 'favorite';
export type ReportStatusTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';
export type ReportSource = 'combat' | 'fixture';

export type ReportDetail = {
  label: string;
  value: string;
};

export type ReportItem = {
  id: string;
  source: ReportSource;
  category: ReportCategory;
  typeLabel: string;
  title: string;
  preview: string;
  body: string;
  timestamp: string;
  statusLabel: string;
  statusTone: ReportStatusTone;
  participantNames: string[];
  planetNames: string[];
  coordinates: string[];
  details: ReportDetail[];
  battleReportId?: string;
};

export type ReportsState = {
  readIds: string[];
  favoriteIds: string[];
  archivedIds: string[];
};

export type ReportsCategoryKey = 'all' | ReportCategory | 'archive';

export type ReportQuery = {
  category: ReportsCategoryKey;
  filter: ReportFilter;
  search: string;
};

export type ReportCategoryCounts = Record<ReportsCategoryKey, number>;
export type ReportUnreadCounts = Record<ReportsCategoryKey, number>;

export type BattlePerspectiveSide = 'attacker' | 'defender';

export type BattlePerspective = {
  localSide: BattlePerspectiveSide | null;
  leftSide: BattlePerspectiveSide;
  rightSide: BattlePerspectiveSide;
  leftLabel: string;
  rightLabel: string;
};

export type BattleRewardEntry = {
  key: 'metal' | 'minerals' | 'gas' | 'experience' | 'debris';
  label: string;
  value: number;
};