import { PLAYER_JOURNAL_VERSION, type PlayerJournalEntry } from '../application/player-journal.ts';

/**
 * The player journal lives in IndexedDB, apart from the save: it may grow over
 * a whole campaign and must not eat the save's localStorage quota. One record
 * per entry, keyed by the campaign's save key; failures never touch the game.
 */

const DB_NAME = 'asterion-player-journal';
const STORE = 'entries';
let activeCampaignKey: string | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

export function setActiveJournalCampaign(campaignKey: string): void {
  activeCampaignKey = campaignKey;
}

export function getActiveJournalCampaign(): string | null {
  return activeCampaignKey;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable'));
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { autoIncrement: true });
      store.createIndex('campaign', 'campaign');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function appendJournalEntries(campaignKey: string, entries: readonly PlayerJournalEntry[]): Promise<void> {
  if (!entries.length) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const entry of entries) store.add({ campaign: campaignKey, ...entry });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // The journal is a study aid; the game never depends on it.
  }
}

export async function readJournal(campaignKey: string): Promise<PlayerJournalEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).index('campaign').getAll(campaignKey);
    request.onsuccess = () => resolve((request.result as Array<PlayerJournalEntry & { campaign?: string }>)
      .map(({ campaign: _campaign, ...entry }) => entry));
    request.onerror = () => reject(request.error);
  });
}

export async function clearJournal(campaignKey: string): Promise<void> {
  const db = await openDb();
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).index('campaign').getAllKeys(campaignKey);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const key of keys) tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Downloads the campaign's journal as one JSON file. */
export async function downloadJournal(campaignKey: string, meta: Readonly<Record<string, unknown>>): Promise<number> {
  const entries = await readJournal(campaignKey);
  const body = JSON.stringify({ version: PLAYER_JOURNAL_VERSION, campaign: campaignKey, exportedAt: new Date().toISOString(), ...meta, entries });
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `asterion-journal-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return entries.length;
}
