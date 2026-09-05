import type { RatingScores, RatingSeasonFoundation } from './types.ts';

export const RATING_SEASON_FOUNDATION: RatingSeasonFoundation = Object.freeze({
  id: 'season-1',
  label: 'СЕЗОН 1',
  statusLabel: 'ЛОКАЛЬНЫЙ FOUNDATION',
  dataTruth: 'deterministic-local-fixture',
});

export type PlayerFixture = {
  id: string;
  name: string;
  allianceKey: 'local' | 'aurora' | 'meridian' | 'orbits' | 'veil' | 'void';
  sector: string;
  rank: number;
  previousRank: number;
  scores: RatingScores;
};

export const RATING_PLAYER_FIXTURES: readonly PlayerFixture[] = Object.freeze([
  { id: 'rating-player-01', name: 'Элиас Рен', allianceKey: 'aurora', sector: 'Aurora · 2:4', rank: 1, previousRank: 2, scores: { resource: 18420, combat: 10140, achievement: 1010 } },
  { id: 'rating-player-02', name: 'Мара Вейл', allianceKey: 'meridian', sector: 'Meridian · 3:1', rank: 2, previousRank: 2, scores: { resource: 15810, combat: 8500, achievement: 930 } },
  { id: 'rating-player-03', name: 'Кир Ос', allianceKey: 'orbits', sector: 'Orbis · 1:8', rank: 3, previousRank: 1, scores: { resource: 13875, combat: 9000, achievement: 860 } },
  { id: 'rating-player-04', name: 'Тарин Кел', allianceKey: 'veil', sector: 'Iron · 4:2', rank: 4, previousRank: 7, scores: { resource: 14640, combat: 7000, achievement: 790 } },
  { id: 'rating-player-05', name: 'Вера Нокс', allianceKey: 'void', sector: 'Void · 5:3', rank: 5, previousRank: 4, scores: { resource: 10980, combat: 9000, achievement: 740 } },
  { id: 'rating-player-06', name: 'Сай Нор', allianceKey: 'aurora', sector: 'Aster · 2:9', rank: 6, previousRank: 8, scores: { resource: 12420, combat: 6000, achievement: 690 } },
  { id: 'rating-player-07', name: 'Лио Мер', allianceKey: 'meridian', sector: 'Delta · 3:6', rank: 7, previousRank: 6, scores: { resource: 9870, combat: 7000, achievement: 650 } },
  { id: 'rating-player-08', name: 'Рея Ван', allianceKey: 'orbits', sector: 'Vega · 4:1', rank: 8, previousRank: 10, scores: { resource: 10230, combat: 5000, achievement: 610 } },
  { id: 'rating-player-09', name: 'Ник Сол', allianceKey: 'veil', sector: 'Tau · 3:2', rank: 9, previousRank: 9, scores: { resource: 8190, combat: 6000, achievement: 580 } },
  { id: 'rating-player-10', name: 'Эмбер Кай', allianceKey: 'void', sector: 'Kron · 4:5', rank: 10, previousRank: 8, scores: { resource: 9640, combat: 4000, achievement: 540 } },
]);

export type AllianceFixture = {
  relationKey: 'aurora' | 'meridian' | 'orbits' | 'veil' | 'void';
  members: number;
  rank: number;
  previousRank: number;
  scores: RatingScores;
};

export const RATING_ALLIANCE_FIXTURES: readonly AllianceFixture[] = Object.freeze([
  { relationKey: 'aurora', members: 12, rank: 1, previousRank: 1, scores: { resource: 80340, combat: 45000, achievement: 4600 } },
  { relationKey: 'meridian', members: 11, rank: 2, previousRank: 3, scores: { resource: 72880, combat: 40000, achievement: 4210 } },
  { relationKey: 'orbits', members: 10, rank: 3, previousRank: 2, scores: { resource: 61760, combat: 37000, achievement: 3890 } },
  { relationKey: 'veil', members: 9, rank: 4, previousRank: 6, scores: { resource: 55420, combat: 32000, achievement: 3440 } },
  { relationKey: 'void', members: 8, rank: 5, previousRank: 5, scores: { resource: 48910, combat: 28000, achievement: 3120 } },
]);

export const LOCAL_PLAYER_FIXTURE = Object.freeze({
  name: 'Командир Гелион',
  sector: 'Helion · 1:1',
  rank: 11,
  previousRank: 14,
  scores: { resource: 7870, combat: 5000, achievement: 500 } satisfies RatingScores,
});

export const LOCAL_ALLIANCE_RATING_FIXTURE = Object.freeze({
  rank: 6,
  previousRank: 7,
  scores: { resource: 43400, combat: 25000, achievement: 2800 } satisfies RatingScores,
});
