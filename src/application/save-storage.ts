/**
 * Where saves live. A late campaign outgrows localStorage: with 10 galaxies
 * and 100 NPC owners the save grows ~19 million characters a game day, and
 * Electron's localStorage holds about 52 million per origin (all slots
 * together), so by day 3 writes fail. In the desktop game a value over
 * EXTERNAL_SAVE_MIN_CHARS is written to a file in the profile through a
 * synchronous preload bridge; localStorage keeps a small pointer. Callers
 * keep the synchronous Storage interface they always used. Without the
 * bridge (the web preview) everything stays in localStorage as before.
 */

export type SaveStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Key enumeration (slot recovery), passed through to localStorage. */
  key?(index: number): string | null;
  readonly length?: number;
};

/** The preload bridge (electron/preload.cjs → electron/save-store.cjs). */
export type DesktopSaveStore = {
  read(key: string, writeId: string): string | null;
  write(key: string, writeId: string, text: string): void;
  /** The same write, finished by the main process while the renderer goes on. */
  writeAsync?(key: string, writeId: string, text: string): Promise<void>;
  remove(key: string): void;
};

/** A storage that may still be finishing writes: `flush` completes them synchronously. */
export type FlushableSaveStorage = SaveStorage & {
  flush(): void;
  /** Flushes and writes synchronously from now on (the window is closing). */
  beginUnload(): void;
};

/** Values this long go to the desktop store (the smallest late-game saves stay in localStorage). */
export const EXTERNAL_SAVE_MIN_CHARS = 8_000_000;
const POINTER_FIELD = 'asterionExternalSave';
/** What a pointer to a missing or damaged file reads as: text no save parser accepts. */
export const MISSING_EXTERNAL_SAVE = '\u0000asterion: external save file missing or damaged';

type Pointer = { version: 1; writeId: string; chars: number };

/** The pointer is JSON with the writer marker, so raw-text checks keep working. */
function pointerText(pointer: Pointer): string {
  return JSON.stringify({ [POINTER_FIELD]: pointer, saveWriter: 1 });
}

export function readSavePointer(raw: string | null): Pointer | null {
  if (!raw || raw.length > 512 || !raw.includes(POINTER_FIELD)) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pointer = parsed[POINTER_FIELD] as Partial<Pointer> | undefined;
    if (!pointer || pointer.version !== 1 || typeof pointer.writeId !== 'string' || !/^[a-z0-9-]{1,40}$/.test(pointer.writeId)
      || !Number.isSafeInteger(pointer.chars)) return null;
    return pointer as Pointer;
  } catch {
    return null;
  }
}

let writeSequence = 0;
function nextWriteId(): string {
  writeSequence = (writeSequence + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${writeSequence.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * A Storage over `local` that moves long values to `store`. The newest value
 * of each key is kept in memory (by its write id), so the many readers of the
 * save do not copy tens of megabytes over IPC each time.
 *
 * With `store.writeAsync` a long value is handed to the main process and the
 * call returns; the pointer moves when the file is on disk, and until then
 * getItem returns the new value from memory. One write per key is in flight,
 * later values wait (only the newest). `flush` (and every write once the page
 * starts unloading) writes synchronously, so closing the window loses nothing.
 */
export function createExternalizingStorage(local: SaveStorage, store: DesktopSaveStore, minChars = EXTERNAL_SAVE_MIN_CHARS): FlushableSaveStorage {
  const memory = new Map<string, { writeId: string; text: string }>();
  /** Values not yet behind a pointer: the one in flight, then the newest waiting. */
  const pending = new Map<string, { latest: string; inFlight: boolean; waiting: string | null }>();
  /** Bumped by every synchronous change of a key: an older async write then no longer moves its pointer. */
  const generation = new Map<string, number>();
  let synchronous = !store.writeAsync;
  const writeNow = (key: string, value: string) => {
    const writeId = nextWriteId();
    store.write(key, writeId, value);
    local.setItem(key, pointerText({ version: 1, writeId, chars: value.length }));
    memory.set(key, { writeId, text: value });
  };
  const touch = (key: string) => {
    generation.set(key, (generation.get(key) ?? 0) + 1);
    pending.delete(key);
  };
  const startAsync = (key: string, value: string) => {
    const entry = pending.get(key)!;
    entry.inFlight = true;
    const writeId = nextWriteId();
    const startedGeneration = generation.get(key) ?? 0;
    store.writeAsync!(key, writeId, value).then(() => {
      if ((generation.get(key) ?? 0) !== startedGeneration) return;
      local.setItem(key, pointerText({ version: 1, writeId, chars: value.length }));
      memory.set(key, { writeId, text: value });
    }, (error: unknown) => {
      // Later writes go synchronously, where a failure reaches the caller.
      console.error('Asterion: saving to the desktop store failed.', error);
      synchronous = true;
    }).finally(() => {
      if ((generation.get(key) ?? 0) !== startedGeneration || pending.get(key) !== entry) return;
      entry.inFlight = false;
      const next = entry.waiting;
      entry.waiting = null;
      if (next === null) pending.delete(key);
      else if (!synchronous) startAsync(key, next);
      else {
        touch(key);
        try { writeNow(key, next); } catch (error) { console.error('Asterion: saving to the desktop store failed.', error); }
      }
    });
  };
  const flushKey = (key: string) => {
    const entry = pending.get(key);
    if (!entry) return;
    touch(key);
    writeNow(key, entry.latest);
  };
  return {
    key: (index: number) => local.key?.(index) ?? null,
    get length() { return local.length ?? 0; },
    getItem(key) {
      const waiting = pending.get(key);
      if (waiting) return waiting.latest;
      const raw = local.getItem(key);
      const pointer = readSavePointer(raw);
      if (!pointer) return raw;
      const cached = memory.get(key);
      if (cached?.writeId === pointer.writeId) return cached.text;
      let text: string | null;
      try { text = store.read(key, pointer.writeId); } catch { text = null; }
      // Never "no save": the load guard then refuses to overwrite it, and the
      // player sees the save problem instead of a fresh campaign over it.
      if (text === null || text.length !== pointer.chars) return MISSING_EXTERNAL_SAVE;
      memory.set(key, { writeId: pointer.writeId, text });
      return text;
    },
    setItem(key, value) {
      if (value.length < minChars) {
        touch(key);
        const previous = readSavePointer(local.getItem(key));
        local.setItem(key, value);
        memory.delete(key);
        if (previous) store.remove(key);
        return;
      }
      if (synchronous) {
        // The file is written first: until the pointer moves, a crash leaves the previous save in place.
        touch(key);
        writeNow(key, value);
        return;
      }
      const entry = pending.get(key);
      if (entry?.inFlight) {
        entry.latest = value;
        entry.waiting = value;
        return;
      }
      pending.set(key, { latest: value, inFlight: false, waiting: null });
      startAsync(key, value);
    },
    removeItem(key) {
      touch(key);
      const previous = readSavePointer(local.getItem(key));
      local.removeItem(key);
      memory.delete(key);
      if (previous) store.remove(key);
    },
    flush() {
      for (const key of [...pending.keys()]) flushKey(key);
    },
    beginUnload() {
      synchronous = true;
      for (const key of [...pending.keys()]) flushKey(key);
    },
  };
}

/**
 * Window event: write every save to disk now, synchronously, as if the window
 * were closing (a game update restarts the app right after it).
 */
export const SAVE_FLUSH_EVENT = 'asterion:save-flush';

let browserStorage: SaveStorage | null | undefined;

/** The storage every save repository uses by default in the browser/desktop game. */
export function getBrowserSaveStorage(): SaveStorage | null {
  if (browserStorage !== undefined) return browserStorage;
  if (typeof window === 'undefined') return browserStorage = null;
  const local = window.localStorage;
  const store = (window as unknown as { asterionDesktop?: { saveStore?: DesktopSaveStore } }).asterionDesktop?.saveStore;
  if (!store) return browserStorage = local;
  const storage = createExternalizingStorage(local, store);
  // Registered before any page listener, so a save written while the window
  // closes (App flushes its deferred autosave on pagehide) goes to disk at once.
  const unload = () => storage.beginUnload();
  window.addEventListener('beforeunload', unload);
  window.addEventListener('pagehide', unload);
  window.addEventListener(SAVE_FLUSH_EVENT, unload);
  return browserStorage = storage;
}
