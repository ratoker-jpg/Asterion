import { ASTERION_LOCAL_PLAYER_ID } from '../combat/report.ts';
import type { CommandState, DiplomaticRelation } from '../command/types.ts';
import {
  LOCAL_ALLIANCE_RATING_FIXTURE,
  LOCAL_PLAYER_FIXTURE,
  RATING_ALLIANCE_FIXTURES,
  RATING_PLAYER_FIXTURES,
  RATING_SEASON_FOUNDATION,
} from './fixtures.ts';
import type {
  AllianceRatingRow,
  PlayerRatingRow,
  RatingFoundation,
  RatingScoreKind,
  RatingScores,
  RatingSort,
} from './types.ts';

const RELATION_IDS = {
  aurora: 'relation-aurora',
  meridian: 'relation-meridian',
  orbits: 'relation-free-orbits',
  veil: 'relation-iron-veil',
  void: 'relation-void-hand',
} as const;

type RelationKey = keyof typeof RELATION_IDS;
type AllianceLookupKey = RelationKey | 'local';
type RatingRow = PlayerRatingRow | AllianceRatingRow;

function findRelation(command: CommandState, key: RelationKey): DiplomaticRelation {
  const id = RELATION_IDS[key];
  const relation = command.diplomacy.find((item) => item.id === id);
  if (!relation) throw new Error(`Rating foundation requires Command relation ${id}.`);
  return relation;
}

function resolveAllianceIdentity(command: CommandState, key: AllianceLookupKey) {
  if (key === 'local') return { name: command.alliance.name, tag: command.alliance.tag };
  const relation = findRelation(command, key);
  return { name: relation.allianceName, tag: relation.tag };
}

function cloneScores(scores: RatingScores): RatingScores {
  return { resource: scores.resource, combat: scores.combat, achievement: scores.achievement };
}

export function getRatingScore(row: RatingRow, kind: RatingScoreKind): number {
  if (kind === 'total') return row.scores.resource + row.scores.combat;
  return row.scores[kind];
}

export function buildRatingFoundation(command: CommandState): RatingFoundation {
  const fixturePlayers: PlayerRatingRow[] = RATING_PLAYER_FIXTURES.map((fixture) => ({
    id: fixture.id,
    name: fixture.name,
    alliance: resolveAllianceIdentity(command, fixture.allianceKey),
    sector: fixture.sector,
    rank: fixture.rank,
    previousRank: fixture.previousRank,
    scores: cloneScores(fixture.scores),
    isLocal: false,
    dataTruth: 'deterministic-local-fixture',
  }));

  const localPlayer: PlayerRatingRow = {
    id: ASTERION_LOCAL_PLAYER_ID,
    name: LOCAL_PLAYER_FIXTURE.name,
    alliance: resolveAllianceIdentity(command, 'local'),
    sector: LOCAL_PLAYER_FIXTURE.sector,
    rank: LOCAL_PLAYER_FIXTURE.rank,
    previousRank: LOCAL_PLAYER_FIXTURE.previousRank,
    scores: cloneScores(LOCAL_PLAYER_FIXTURE.scores),
    isLocal: true,
    dataTruth: 'deterministic-local-fixture',
  };

  const fixtureAlliances: AllianceRatingRow[] = RATING_ALLIANCE_FIXTURES.map((fixture) => {
    const identity = resolveAllianceIdentity(command, fixture.relationKey);
    return {
      id: `rating-alliance-${fixture.relationKey}`,
      ...identity,
      members: fixture.members,
      rank: fixture.rank,
      previousRank: fixture.previousRank,
      scores: cloneScores(fixture.scores),
      isLocal: false,
      dataTruth: 'deterministic-local-fixture',
    };
  });

  const localAlliance: AllianceRatingRow = {
    id: 'rating-alliance-local',
    name: command.alliance.name,
    tag: command.alliance.tag,
    members: command.members.length,
    rank: LOCAL_ALLIANCE_RATING_FIXTURE.rank,
    previousRank: LOCAL_ALLIANCE_RATING_FIXTURE.previousRank,
    scores: cloneScores(LOCAL_ALLIANCE_RATING_FIXTURE.scores),
    isLocal: true,
    dataTruth: 'deterministic-local-fixture',
  };

  return {
    provider: 'deterministic-local-fixture',
    season: { ...RATING_SEASON_FOUNDATION },
    players: sortPlayerRows([...fixturePlayers, localPlayer], 'rank', 'total'),
    alliances: sortAllianceRows([...fixtureAlliances, localAlliance], 'rank', 'total'),
  };
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU');
}

export function searchPlayerRows(rows: readonly PlayerRatingRow[], query: string) {
  const needle = normalizeSearch(query);
  if (!needle) return [...rows];
  return rows.filter((row) => [row.name, row.alliance.name, row.alliance.tag, row.sector]
    .some((value) => value.toLocaleLowerCase('ru-RU').includes(needle)));
}

export function searchAllianceRows(rows: readonly AllianceRatingRow[], query: string) {
  const needle = normalizeSearch(query);
  if (!needle) return [...rows];
  return rows.filter((row) => [row.name, row.tag]
    .some((value) => value.toLocaleLowerCase('ru-RU').includes(needle)));
}

export function sortPlayerRows(rows: readonly PlayerRatingRow[], sort: RatingSort, kind: RatingScoreKind = 'total') {
  return [...rows].sort((a, b) => {
    if (sort === 'rank' && kind === 'total') return a.rank - b.rank || getRatingScore(b, kind) - getRatingScore(a, kind);
    return getRatingScore(b, kind) - getRatingScore(a, kind) || a.rank - b.rank;
  });
}

export function sortAllianceRows(rows: readonly AllianceRatingRow[], sort: RatingSort, kind: RatingScoreKind = 'total') {
  return [...rows].sort((a, b) => {
    if (sort === 'rank' && kind === 'total') return a.rank - b.rank || getRatingScore(b, kind) - getRatingScore(a, kind);
    return getRatingScore(b, kind) - getRatingScore(a, kind) || a.rank - b.rank;
  });
}

export function getDisplayedRank<T extends RatingRow>(rows: readonly T[], rowId: string, kind: RatingScoreKind): number | null {
  const sorted = [...rows].sort((a, b) => getRatingScore(b, kind) - getRatingScore(a, kind) || a.rank - b.rank);
  const index = sorted.findIndex((row) => row.id === rowId);
  return index < 0 ? null : index + 1;
}

export function getRankDelta(currentRank: number, previousRank: number) {
  return previousRank - currentRank;
}

export function getLocalPlayer(rows: readonly PlayerRatingRow[]) {
  return rows.find((row) => row.id === ASTERION_LOCAL_PLAYER_ID && row.isLocal) ?? null;
}

export function getLocalAlliance(rows: readonly AllianceRatingRow[]) {
  return rows.find((row) => row.isLocal) ?? null;
}
