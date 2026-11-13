/**
 * A copy of the original save before it is migrated to a newer format.
 *
 * If a migration (or the normalisation that follows it) spoils a field, the
 * game used to fill in defaults and the next autosave overwrote the original
 * for good. Now the first load of an older-format save keeps its text next to
 * it, under `<save key>.backup-<time>`, with a small index of the last
 * SAVE_BACKUP_KEEP copies (the oldest is deleted). The player can bring a copy
 * back from the load screen («Восстановить из копии»); the game then migrates
 * it again with the current build.
 *
 * Copies live in the same storage as the save (a large one goes to a file in
 * the desktop store like the save does). A failed backup (full storage) never
 * blocks loading.
 */

export type BackupStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type SaveBackup = {
  /** Storage key of the copy. */
  key: string;
  /** When the copy was made (ms). */
  at: number;
  /** Format version of the original. */
  fromSchema: number;
  chars: number;
};

/** How many pre-migration copies are kept per save. */
export const SAVE_BACKUP_KEEP = 3;

const indexKey = (saveKey: string) => `${saveKey}.backups`;

export function listSaveBackups(storage: BackupStorage, saveKey: string): SaveBackup[] {
  try {
    const parsed = JSON.parse(storage.getItem(indexKey(saveKey)) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SaveBackup => Boolean(entry) && typeof entry === 'object'
      && typeof (entry as SaveBackup).key === 'string' && (entry as SaveBackup).key.startsWith(`${saveKey}.backup-`)
      && Number.isFinite((entry as SaveBackup).at) && Number.isFinite((entry as SaveBackup).fromSchema))
      .sort((left, right) => right.at - left.at);
  } catch {
    return [];
  }
}

/**
 * Keeps `raw` (the stored text of a save of format `fromSchema`, about to be
 * migrated). Returns the new entry, or null when nothing was stored (the same
 * original is already the newest copy, or the storage refused).
 */
export function backupBeforeMigration(
  storage: BackupStorage,
  saveKey: string,
  raw: string,
  fromSchema: number,
  at: number,
): SaveBackup | null {
  try {
    const existing = listSaveBackups(storage, saveKey);
    // Loading the same unmigrated original again (a failed write, a reload, a restore) does not pile up copies.
    if (existing.some((item) => item.fromSchema === fromSchema && item.chars === raw.length)) return null;
    const entry: SaveBackup = { key: `${saveKey}.backup-${Math.floor(at).toString(36)}`, at, fromSchema, chars: raw.length };
    storage.setItem(entry.key, raw);
    const kept = [entry, ...existing.filter((item) => item.key !== entry.key)];
    for (const old of kept.slice(SAVE_BACKUP_KEEP)) {
      try { storage.removeItem(old.key); } catch { /* an orphan copy is pruned with the slot */ }
    }
    storage.setItem(indexKey(saveKey), JSON.stringify(kept.slice(0, SAVE_BACKUP_KEEP)));
    return entry;
  } catch {
    return null;
  }
}

function schemaOf(text: string): number {
  try {
    const value = (JSON.parse(text) as { schemaVersion?: unknown }).schemaVersion;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export type RestoreResult = { ok: true; entry: SaveBackup } | { ok: false; error: string };

/**
 * Puts a copy back as the save. The save it replaces is kept as a copy too,
 * so a restore can itself be undone.
 */
export function restoreSaveBackup(storage: BackupStorage, saveKey: string, backupKey: string, at: number): RestoreResult {
  const entry = listSaveBackups(storage, saveKey).find((item) => item.key === backupKey);
  if (!entry) return { ok: false, error: 'Такой копии нет.' };
  let text: string | null;
  try { text = storage.getItem(entry.key); } catch { text = null; }
  if (!text) return { ok: false, error: 'Файл копии пропал или повреждён.' };
  try { JSON.parse(text); } catch { return { ok: false, error: 'Копия повреждена.' }; }
  try {
    const current = storage.getItem(saveKey);
    if (current) backupBeforeMigration(storage, saveKey, current, schemaOf(current), at);
    storage.setItem(saveKey, text);
    return { ok: true, entry };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Deletes every copy of a save (its slot was deleted). */
export function clearSaveBackups(storage: BackupStorage, saveKey: string): void {
  for (const entry of listSaveBackups(storage, saveKey)) {
    try { storage.removeItem(entry.key); } catch { /* best effort */ }
  }
  try { storage.removeItem(indexKey(saveKey)); } catch { /* best effort */ }
}
