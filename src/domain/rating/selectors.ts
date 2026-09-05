import type {
  AllianceRatingEntry,
  AllianceScoreKey,
  PlayerRatingEntry,
  PlayerScoreKey,
  SortDirection,
} from './types.ts';

function normalizeQuery(query: string) {
  return query.trim().toLocaleLowerCase('ru-RU');
}

export function filterPlayers(entries: readonly PlayerRatingEntry[], query: string) {
  const normalized = normalizeQuery(query);
  if (!normalized) return [...entries];
  return entries.filter((entry) => `${entry.name} ${entry.allianceTag ?? ''}`.toLocaleLowerCase('ru-RU').includes(normalized));
}

export function sortPlayers(entries: readonly PlayerRatingEntry[], key: PlayerScoreKey, direction: SortDirection = 'desc') {
  const multiplier = direction === 'desc' ? -1 : 1;
  return [...entries].sort((a, b) => (a[key] - b[key]) * multiplier || a.rank - b.rank);
}

export function filterAlliances(entries: readonly AllianceRatingEntry[], query: string) {
  const normalized = normalizeQuery(query);
  if (!normalized) return [...entries];
  return entries.filter((entry) => `${entry.name} ${entry.tag}`.toLocaleLowerCase('ru-RU').includes(normalized));
}

export function sortAlliances(entries: readonly AllianceRatingEntry[], key: AllianceScoreKey, direction: SortDirection = 'desc') {
  const multiplier = direction === 'desc' ? -1 : 1;
  return [...entries].sort((a, b) => (a[key] - b[key]) * multiplier || a.rank - b.rank);
}

export function clampPage(page: number, totalItems: number, pageSize: number) {
  const safeSize = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(Math.max(0, totalItems) / safeSize));
  return Math.min(pageCount, Math.max(1, Math.floor(page) || 1));
}

export function paginate<T>(entries: readonly T[], page: number, pageSize: number) {
  const safeSize = Math.max(1, Math.floor(pageSize) || 1);
  const safePage = clampPage(page, entries.length, safeSize);
  const start = (safePage - 1) * safeSize;
  return {
    page: safePage,
    pageCount: Math.max(1, Math.ceil(entries.length / safeSize)),
    total: entries.length,
    items: entries.slice(start, start + safeSize),
  };
}

export function pageForEntry<T>(entries: readonly T[], pageSize: number, predicate: (entry: T) => boolean) {
  const index = entries.findIndex(predicate);
  if (index < 0) return 1;
  return Math.floor(index / Math.max(1, pageSize)) + 1;
}
