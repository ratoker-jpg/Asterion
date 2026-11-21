import type { AllianceEmblem, AllianceIdentity } from '../command/types.ts';

export type RatingMode = 'players' | 'alliances';
export type PlayerScoreKey = 'achievementPoints' | 'totalPoints' | 'resourcePoints' | 'battlePoints';
export type AllianceScoreKey = 'totalPoints' | 'resourcePoints' | 'battlePoints';
export type SortDirection = 'desc' | 'asc';

/** Achievement totals keyed by the canonical owner id used by rating and map surfaces. */
export type AchievementPointsByOwner = Readonly<Record<string, number>>;

export type OwnerScore = {
  ownerId: string;
  resourcePoints: number;
  battlePoints: number;
  totalPoints: number;
  achievementPoints: 0;
};

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

export type { AllianceIdentity };

/** One real alliance. Point fields are member averages; the total is not the sum of the other two. */
export type AllianceRatingEntry = {
  id: string;
  rank: number;
  name: string;
  tag: string;
  emblem: AllianceEmblem;
  memberCount: number;
  totalPoints: number;
  resourcePoints: number;
  battlePoints: number;
  isCurrentAlliance: boolean;
};
