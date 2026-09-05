export type RatingDataTruth = 'deterministic-local-fixture';
export type RatingSort = 'rank' | 'score';
export type RatingMode = 'players' | 'alliances';
export type RatingScoreKind = 'total' | 'resource' | 'combat' | 'achievement';

export type RatingScores = {
  resource: number;
  combat: number;
  achievement: number;
};

export type RatingAllianceIdentity = {
  name: string;
  tag: string;
};

export type PlayerRatingRow = {
  id: string;
  name: string;
  alliance: RatingAllianceIdentity;
  sector: string;
  rank: number;
  previousRank: number;
  scores: RatingScores;
  isLocal: boolean;
  dataTruth: RatingDataTruth;
};

export type AllianceRatingRow = {
  id: string;
  name: string;
  tag: string;
  members: number;
  rank: number;
  previousRank: number;
  scores: RatingScores;
  isLocal: boolean;
  dataTruth: RatingDataTruth;
};

export type RatingSeasonFoundation = {
  id: 'season-1';
  label: 'СЕЗОН 1';
  statusLabel: 'ЛОКАЛЬНЫЙ FOUNDATION';
  dataTruth: RatingDataTruth;
};

export type RatingFoundation = {
  provider: RatingDataTruth;
  season: RatingSeasonFoundation;
  players: PlayerRatingRow[];
  alliances: AllianceRatingRow[];
};
