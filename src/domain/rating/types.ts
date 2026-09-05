export type RatingMode = 'players' | 'alliances';
export type PlayerScoreKey = 'achievementPoints' | 'totalPoints' | 'resourcePoints' | 'battlePoints';
export type AllianceScoreKey = 'alliancePoints' | 'totalPoints';
export type SortDirection = 'desc' | 'asc';

export type PlayerRatingEntry = {
  id: string;
  rank: number;
  name: string;
  race: 'aster' | 'cyber' | 'xeno';
  allianceTag: string | null;
  achievementPoints: number;
  totalPoints: number;
  resourcePoints: number;
  battlePoints: number;
  isCurrentPlayer: boolean;
};

export type AllianceIdentity = { name: string; tag: string };

export type AllianceRatingEntry = {
  id: string;
  rank: number;
  name: string;
  tag: string;
  level: number;
  alliancePoints: number;
  totalPoints: number;
  isCurrentAlliance: boolean;
};
