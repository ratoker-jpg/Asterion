import type { PlayerFactionId } from './domain/profile/types.ts';

export type FactionHeaderTheme = {
  id: PlayerFactionId;
  label: string;
  accent: string;
  accentStrong: string;
  border: string;
  surfaceTop: string;
  surfaceBottom: string;
  glow: string;
  icon: string;
};

export const FACTION_HEADER_THEMES: Record<PlayerFactionId, FactionHeaderTheme> = {
  aegis: {
    id: 'aegis',
    label: 'Астеры',
    accent: '#32d8f5',
    accentStrong: '#75edff',
    border: 'rgba(66, 207, 237, .42)',
    surfaceTop: 'rgba(5, 31, 45, .98)',
    surfaceBottom: 'rgba(2, 16, 26, .99)',
    glow: 'rgba(0, 190, 235, .22)',
    icon: '#74e8ff',
  },
  synod: {
    id: 'synod',
    label: 'Илары',
    accent: '#45e1a6',
    accentStrong: '#a7ffe0',
    border: 'rgba(74, 225, 168, .46)',
    surfaceTop: 'rgba(8, 39, 35, .98)',
    surfaceBottom: 'rgba(2, 21, 21, .99)',
    glow: 'rgba(27, 221, 145, .21)',
    icon: '#80efc2',
  },
  veyra: {
    id: 'veyra',
    label: 'Рой',
    accent: '#f04459',
    accentStrong: '#ff8c96',
    border: 'rgba(240, 68, 89, .52)',
    surfaceTop: 'rgba(45, 9, 17, .98)',
    surfaceBottom: 'rgba(17, 3, 8, .995)',
    glow: 'rgba(232, 33, 59, .24)',
    icon: '#ff6475',
  },
};

const FACTION_IDS = Object.keys(FACTION_HEADER_THEMES) as PlayerFactionId[];

export function isPlayerFactionId(value: string | null | undefined): value is PlayerFactionId {
  return value != null && FACTION_IDS.includes(value as PlayerFactionId);
}

/**
 * Keeps the live theme driven by the saved profile while allowing the visual QA
 * runner to preview all three approved themes without mutating game state.
 */
export function resolveFactionHeaderId(
  fallback: PlayerFactionId,
  search = typeof window === 'undefined' ? '' : window.location.search,
): PlayerFactionId {
  const requested = new URLSearchParams(search).get('faction');
  return isPlayerFactionId(requested) ? requested : fallback;
}

export type ResourceFillTone = 'none' | 'normal' | 'watch' | 'warning' | 'critical';

export function getResourceFillPercent(value: number, capacity?: number): number {
  if (!capacity || capacity <= 0) return 0;
  return Math.min(100, Math.max(0, (value / capacity) * 100));
}

export function getResourceFillTone(value: number, capacity?: number): ResourceFillTone {
  if (!capacity || capacity <= 0) return 'none';
  const fill = getResourceFillPercent(value, capacity);
  if (value >= capacity || fill >= 85) return 'critical';
  if (fill >= 75) return 'warning';
  if (fill >= 65) return 'watch';
  return 'normal';
}
