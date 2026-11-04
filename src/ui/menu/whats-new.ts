/**
 * «Что нового»: which release notes the player has not seen yet. The last seen
 * version lives in per-install storage, never in a campaign save.
 */

export type WhatsNewItem = { title: string; text: string; where: string; image?: string; imageAlt?: string };
/** `version` and `date` are null only in dev and PR builds (a note with no release yet). */
export type WhatsNewRelease = { version: string | null; date: string | null; headline: string; items: WhatsNewItem[] };

export const WHATS_NEW_SEEN_KEY = 'asterion.whats-new.seen.v1';

type SeenStorage = Pick<Storage, 'getItem' | 'setItem'>;

function parseVersion(text: string | null | undefined): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text ?? '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** False when either side is not a version. */
export function isNewerVersion(version: string | null, than: string | null): boolean {
  const left = parseVersion(version);
  const right = parseVersion(than);
  if (!left || !right) return false;
  for (let at = 0; at < 3; at += 1) if (left[at] !== right[at]) return left[at] > right[at];
  return false;
}

/** The newest release the build ships; an entry with no release yet does not count. */
export function latestVersion(releases: readonly WhatsNewRelease[]): string | null {
  return releases.find((release) => parseVersion(release.version))?.version ?? null;
}

export type WhatsNewStatus = {
  /** The version the player last saw; null: they played before this screen existed. */
  seen: string | null;
  /** The entry in the menu carries the «новое» mark. */
  hasNew: boolean;
  /** A fresh install starts at the current version, silently: this value is stored. */
  store: string | null;
};

/**
 * - A stored version: compare it with the newest notes.
 * - Nothing stored and no campaigns: a fresh install. There is no «update» to
 *   announce, so it starts at the newest version with no mark.
 * - Nothing stored but campaigns exist: the player updated from a version older
 *   than this screen, so the mark shows.
 */
export function whatsNewStatus({ stored, hasCampaigns, releases }: { stored: string | null; hasCampaigns: boolean; releases: readonly WhatsNewRelease[] }): WhatsNewStatus {
  const latest = latestVersion(releases);
  const seen = parseVersion(stored) ? stored : null;
  if (seen) return { seen, hasNew: isNewerVersion(latest, seen), store: null };
  if (!latest) return { seen: null, hasNew: false, store: null };
  return hasCampaigns ? { seen: null, hasNew: true, store: null } : { seen: latest, hasNew: false, store: latest };
}

/** Versions tagged «новое» in the list. With no record of what was seen, only the newest one. */
export function isUnseenRelease(release: WhatsNewRelease, seen: string | null, releases: readonly WhatsNewRelease[]): boolean {
  if (seen) return isNewerVersion(release.version, seen);
  return release.version !== null && release.version === latestVersion(releases);
}

export function readSeenVersion(storage: SeenStorage | null): string | null {
  try {
    return storage?.getItem(WHATS_NEW_SEEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeSeenVersion(storage: SeenStorage | null, version: string): void {
  try {
    storage?.setItem(WHATS_NEW_SEEN_KEY, version);
  } catch { /* the mark simply returns next time */ }
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** `2026-11-04` → `4 ноября 2026`; empty for an unreleased entry. */
export function formatReleaseDate(date: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : '';
}
