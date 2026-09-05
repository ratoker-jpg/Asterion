import { ASTERION_LOCAL_PLAYER_ID } from '../combat/report.ts';
import type { CommandState, DiplomaticRelation } from '../command/types.ts';
import {
  LOCAL_ALLIANCE_RATING_FIXTURE,
  LOCAL_PLAYER_FIXTURE,
  RATING_ALLIANCE_FIXTURES,
  RATING_PLAYER_FIXTURES,
  RATING_SEASON_FOUNDATION,
} from './fixtures.ts';
import type { AllianceRatingRow, PlayerRatingRow, RatingFoundation, RatingSort } from './types.ts';

const RELATION_IDS = {
  aurora: 'relation-aurora',
  meridian: 'relation-meridian',
  orbits: 'relation-free-orbits',
  veil: 'relation-iron-veil',
  void: 'relation-void-hand',
} as const;

type RelationKey = keyof typeof RELATION_IDS;
type AllianceLookupKey = RelationKey | 'local';

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

export function buildRatingFoundation(command: CommandState): RatingFoundation {
  const fixturePlayers: PlayerRatingRow[] = RATING_PLAYER_FIXTURES.map((fixture) => ({
    id: fixture.id,
    name: fixture.name,
    alliance: resolveAllianceIdentity(command, fixture.allianceKey),
    sector: fixture.sector,
    rank: fixture.rank,
    previousRank: fixture.previousRank,
    score: fixture.score,
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
    score: LOCAL_PLAYER_FIXTURE.score,
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
      score: fixture.score,
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
    score: LOCAL_ALLIANCE_RATING_FIXTURE.score,
    isLocal: true,
    dataTruth: 'deterministic-local-fixture',
  };

  return {
    provider: 'deterministic-local-fixture',
    season: { ...RATING_SEASON_FOUNDATION },
    players: sortPlayerRows([...fixturePlayers, localPlayer], 'rank'),
    alliances: sortAllianceRows([...fixtureAlliances, localAlliance], 'rank'),
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

export function sortPlayerRows(rows: readonly PlayerRatingRow[], sort: RatingSort) {
  return [...rows].sort((a, b) => sort === 'score'
    ? b.score - a.score || a.rank - b.rank
    : a.rank - b.rank || b.score - a.score);
}

export function sortAllianceRows(rows: readonly AllianceRatingRow[], sort: RatingSort) {
  return [...rows].sort((a, b) => sort === 'score'
    ? b.score - a.score || a.rank - b.rank
    : a.rank - b.rank || b.score - a.score);
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
