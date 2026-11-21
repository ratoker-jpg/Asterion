import {
  createAchievementChronicle,
  parseAchievementChronicle,
  type AchievementChronicle,
} from '../domain/achievements/chronicle.ts';

/** Electron stores this profile-global chronicle beside the persona registry. */
export type AchievementChronicleBridge = {
  read: () => { text: string | null; backup: string | null };
  write: (text: string) => void;
};

export type AchievementChronicleRead =
  | { status: 'ok'; chronicle: AchievementChronicle; recovered: boolean }
  | { status: 'unavailable' }
  | { status: 'unreadable'; message: string };

export type AchievementChronicleWrite = { ok: true } | { ok: false; error: string };

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const LOCAL_KEY = 'asterion.achievement-chronicle.v1';
const LOCAL_BACKUP_KEY = 'asterion.achievement-chronicle.v1.backup';

function desktopBridge(): AchievementChronicleBridge | null {
  return (globalThis as { asterionDesktop?: { achievements?: AchievementChronicleBridge } }).asterionDesktop?.achievements ?? null;
}

function localStorageForWindow(): LocalStorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseFiles(text: string | null, backup: string | null): AchievementChronicleRead {
  if (text === null && backup === null) return { status: 'ok', chronicle: createAchievementChronicle(), recovered: false };
  const primary = text === null ? null : parseAchievementChronicle(text);
  if (primary?.ok) return { status: 'ok', chronicle: primary.chronicle, recovered: false };
  if (primary && !primary.ok && primary.reason === 'newer') {
    return { status: 'unreadable', message: 'Летопись достижений записана более новой версией игры.' };
  }
  const previous = backup === null ? null : parseAchievementChronicle(backup);
  if (previous?.ok) return { status: 'ok', chronicle: previous.chronicle, recovered: true };
  return { status: 'unreadable', message: 'Файл летописи достижений повреждён.' };
}

/** Reads the desktop file or, for browser development, the browser profile storage. */
export function readAchievementChronicle(
  bridge: AchievementChronicleBridge | null = desktopBridge(),
  storage: LocalStorageLike | null = localStorageForWindow(),
): AchievementChronicleRead {
  if (bridge) {
    try {
      const files = bridge.read();
      return parseFiles(files.text, files.backup);
    } catch (error) {
      return { status: 'unreadable', message: errorText(error) };
    }
  }
  if (!storage) return { status: 'unavailable' };
  try {
    return parseFiles(storage.getItem(LOCAL_KEY), storage.getItem(LOCAL_BACKUP_KEY));
  } catch (error) {
    return { status: 'unreadable', message: errorText(error) };
  }
}

function mergeEarned(
  currentText: string | null,
  incoming: AchievementChronicle,
): AchievementChronicle {
  if (currentText === null) return incoming;
  const current = parseAchievementChronicle(currentText);
  if (!current.ok) return incoming;
  const earnedById = new Map(current.chronicle.earned.map((record) => [record.id, record]));
  for (const record of incoming.earned) if (!earnedById.has(record.id)) earnedById.set(record.id, record);
  return { ...incoming, earned: [...earnedById.values()] };
}

/** Merges profile-global awards learned from another renderer without dropping local awards. */
export function mergeAchievementChronicles(
  current: AchievementChronicle,
  incoming: AchievementChronicle,
): AchievementChronicle {
  const earnedById = new Map(current.earned.map((record) => [record.id, record]));
  for (const record of incoming.earned) if (!earnedById.has(record.id)) earnedById.set(record.id, record);
  return { ...current, ...incoming, earned: [...earnedById.values()] };
}

/** Writes only a previously reconciled chronicle; callers decide when an award merits a write. */
export function writeAchievementChronicle(
  chronicle: AchievementChronicle,
  bridge: AchievementChronicleBridge | null = desktopBridge(),
  storage: LocalStorageLike | null = localStorageForWindow(),
): AchievementChronicleWrite {
  const text = JSON.stringify(chronicle);
  if (bridge) {
    try {
      bridge.write(text);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    }
  }
  if (!storage) return { ok: false, error: 'Хранилище летописи достижений недоступно.' };
  try {
    const previous = storage.getItem(LOCAL_KEY);
    const merged = JSON.stringify(mergeEarned(previous, chronicle));
    if (previous !== null && parseAchievementChronicle(previous).ok) storage.setItem(LOCAL_BACKUP_KEY, previous);
    storage.setItem(LOCAL_KEY, merged);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}
