import type { RatingSeasonFoundation } from './types.ts';

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
  score: number;
};

export const RATING_PLAYER_FIXTURES: readonly PlayerFixture[] = Object.freeze([
  { id: 'rating-player-01', name: 'Элиас Рен', allianceKey: 'aurora', sector: 'Aurora · 2:4', rank: 1, previousRank: 2, score: 28560 },
  { id: 'rating-player-02', name: 'Мара Вейл', allianceKey: 'meridian', sector: 'Meridian · 3:1', rank: 2, previousRank: 2, score: 24310 },
  { id: 'rating-player-03', name: 'Кир Ос', allianceKey: 'orbits', sector: 'Orbis · 1:8', rank: 3, previousRank: 1, score: 22875 },
  { id: 'rating-player-04', name: 'Тарин Кел', allianceKey: 'veil', sector: 'Iron · 4:2', rank: 4, previousRank: 7, score: 21640 },
  { id: 'rating-player-05', name: 'Вера Нокс', allianceKey: 'void', sector: 'Void · 5:3', rank: 5, previousRank: 4, score: 19980 },
  { id: 'rating-player-06', name: 'Сай Нор', allianceKey: 'aurora', sector: 'Aster · 2:9', rank: 6, previousRank: 8, score: 18420 },
  { id: 'rating-player-07', name: 'Лио Мер', allianceKey: 'meridian', sector: 'Delta · 3:6', rank: 7, previousRank: 6, score: 16870 },
  { id: 'rating-player-08', name: 'Рея Ван', allianceKey: 'orbits', sector: 'Vega · 4:1', rank: 8, previousRank: 10, score: 15230 },
  { id: 'rating-player-09', name: 'Ник Сол', allianceKey: 'veil', sector: 'Tau · 3:2', rank: 9, previousRank: 9, score: 14190 },
  { id: 'rating-player-10', name: 'Эмбер Кай', allianceKey: 'void', sector: 'Kron · 4:5', rank: 10, previousRank: 8, score: 13640 },
]);

export type AllianceFixture = {
  relationKey: 'aurora' | 'meridian' | 'orbits' | 'veil' | 'void';
  members: number;
  rank: number;
  previousRank: number;
  score: number;
};

export const RATING_ALLIANCE_FIXTURES: readonly AllianceFixture[] = Object.freeze([
  { relationKey: 'aurora', members: 12, rank: 1, previousRank: 1, score: 125340 },
  { relationKey: 'meridian', members: 11, rank: 2, previousRank: 3, score: 112880 },
  { relationKey: 'orbits', members: 10, rank: 3, previousRank: 2, score: 98760 },
  { relationKey: 'veil', members: 9, rank: 4, previousRank: 6, score: 87420 },
  { relationKey: 'void', members: 8, rank: 5, previousRank: 5, score: 76910 },
]);

export const LOCAL_PLAYER_FIXTURE = Object.freeze({
  name: 'Командир Гелион',
  sector: 'Helion · 1:1',
  rank: 11,
  previousRank: 14,
  score: 12870,
});

export const LOCAL_ALLIANCE_RATING_FIXTURE = Object.freeze({
  rank: 6,
  previousRank: 7,
  score: 68400,
});
