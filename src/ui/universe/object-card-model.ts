import type { UniverseCoordinate, UniversePlanetNode } from '../../domain/universe/types.ts';

/**
 * What the player's own probes learned about a unique object or anomaly
 * (owner rule 03.11: a probe reveals who holds the object and, with a good
 * enough report, the fleet there). Built in App.tsx from the exploration
 * recon records; keyed by the object's node id.
 */
export type ExplorationIntel = {
  at: number;
  success: boolean;
  occupantName?: string;
  allianceTag?: string;
  /** The report quality was high enough to list the occupant's ships. */
  fleetKnown: boolean;
};

export type DebrisEntry = { coordinate: UniverseCoordinate; debris: number };

/** Player words for the object kinds the card opens for (the map's own labels stay in the domain). */
export const OBJECT_KIND_LABEL: Record<UniversePlanetNode['kind'], string> = {
  empty: 'Свободная позиция',
  player: 'Планета игрока',
  npc: 'Планета игрока',
  uninhabited: 'Необитаемая планета',
  unique: 'Уникальный объект',
  pirate: 'Пиратская база',
  anomaly: 'Аномалия',
  asteroid: 'Астероид',
};

const numberFormat = new Intl.NumberFormat('ru-RU');

export function formatAmount(value: number): string {
  return numberFormat.format(Math.max(0, Math.floor(value)));
}

/** «42 мин 05 с», «1 ч 12 мин», «8 с». */
export function countdown(nowMs: number, targetMs?: number): string {
  if (!Number.isFinite(targetMs)) return '—';
  const seconds = Math.max(0, Math.ceil((Number(targetMs) - nowMs) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours} ч ${String(minutes).padStart(2, '0')} мин`;
  return minutes ? `${minutes} мин ${String(rest).padStart(2, '0')} с` : `${rest} с`;
}

/** «только что», «12 мин назад», «3 ч назад», «2 дн назад». */
export function agoLabel(nowMs: number, atMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - atMs) / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

/** A short word under an action whose launch the runtime refused; the full reason is written above the buttons. */
export function shortRefusal(reason: string): string {
  const text = reason.toLowerCase();
  if (text.includes('газ')) return 'мало газа';
  if (text.includes('нет свободн') || text.includes('нет корабл') || text.includes('нет зонд') || text.includes('нет переработ')
    || text.includes('нет транспорт') || text.includes('нет колониз') || text.includes('нет боев') || text.includes('корабл')) return 'нет кораблей';
  if (text.includes('слот') || text.includes('флот')) return 'нет флота';
  return 'сейчас нельзя';
}
