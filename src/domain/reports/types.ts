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
export type ReportSource = 'combat' | 'operations' | 'command';

export type ReportDetail = {
  label: string;
  value: string;
};

export type ReportAction = {
  kind: 'open_fleets';
  label: string;
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
  action?: ReportAction;
};

export type ReportsState = {
  readIds: string[];
};

export type ReportsCategoryKey = ReportCategory;

export type ReportQuery = {
  category: ReportsCategoryKey;
  filter: ReportFilter;
  search: string;
};

export type ReportCategoryCounts = Record<ReportsCategoryKey, number>;
export type ReportUnreadCounts = Record<ReportsCategoryKey, number>;
