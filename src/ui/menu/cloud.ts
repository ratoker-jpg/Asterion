import { useEffect, useRef } from 'react';
import {
  decideCloudEntry, describeConflict, describeLocalReason, pageClockOffsetMs, saveSchemaVersion, saveWorldAt, sha256Text,
  type CloudCampaignView, type CloudConflictReason, type CloudSyncRecord,
} from '../../application/cloud/cloud-sync.ts';
import { getBrowserSaveStorage, MISSING_EXTERNAL_SAVE } from '../../application/save-storage.ts';
import { duplicateSaveSlot, importRawSaveSlot } from '../../application/slots.ts';
import { SAVE_SCHEMA_VERSION } from '../../application/persistence.ts';
import type { SaveSlotMeta } from '../../domain/session/slots.ts';
import type { ActiveSession } from './session.ts';

/**
 * The cloud relay in the game (rules: src/application/cloud/cloud-sync.ts,
 * transport: electron/cloud.cjs). On entry the game takes the server's world
 * when it continues this computer's save; while playing it uploads a copy
 * every UPLOAD_EVERY_MS; when the player leaves (menu, closing the window) it
 * hands the save over so the server keeps the world alive.
 */

/** A cloud copy while playing (a backup; the server does not move the world meanwhile). */
export const CLOUD_UPLOAD_EVERY_MS = 12 * 60_000;

export type CloudSettings = {
  url: string;
  enabled: boolean;
  hasKey: boolean;
  deviceId: string;
  appVersion: string;
  lastUpload: CloudUploadResult | null;
  lastError: { at: number; text: string } | null;
};

export type CloudUploadResult = {
  campaignId: string;
  at: number;
  left: boolean;
  ok: boolean;
  revision?: number;
  error?: string;
  code?: string;
  ms?: number;
  gzBytes?: number;
  unchanged?: boolean;
  live?: CloudCampaignView['live'];
};

export type CloudWorld = {
  text: string;
  digest: string;
  revision: number;
  snapshotId: number;
  origin: 'client' | 'server';
  worldAt: number;
  gameVersion: string;
  gzBytes: number;
};

type Failure = { ok: false; code: string; error: string };
type UploadMeta = { left?: boolean; schemaVersion: number; worldAt: number; clockOffsetMs: number };

export type CloudServerStatus = {
  version: string;
  versions: string[];
  now: number;
  disk: { freeBytes: number; totalBytes: number } | null;
  storedBytes: number;
  campaigns: number;
  live: { campaignId: string; worldAt: number | null; lagMs: number | null; tickMs: number | null; cpuShare: number | null; rss: number | null } | null;
};

export type CloudBridge = {
  get(): Promise<CloudSettings>;
  set(next: { url?: string; enabled?: boolean; key?: string }): Promise<CloudSettings>;
  server(): Promise<({ ok: true; status: CloudServerStatus; campaigns: CloudCampaignView[] }) | Failure>;
  campaign(id: string): Promise<({ ok: true; campaign: CloudCampaignView | null }) | Failure>;
  record(id: string): Promise<CloudSyncRecord | null>;
  upload(id: string, name: string, text: string, meta: UploadMeta): Promise<CloudUploadResult>;
  uploadOnExit(id: string, name: string, text: string, meta: UploadMeta): { queued: boolean } | undefined;
  wait(id: string): Promise<CloudUploadResult | null>;
  claim(id: string, baseRevision: number): Promise<({ ok: true; none?: true; world?: CloudWorld }) | Failure>;
  download(id: string, snapshotId: number): Promise<({ ok: true; world: CloudWorld }) | Failure>;
  release(id: string): Promise<({ ok: true }) | Failure>;
  markSynced(id: string, revision: number, digest: string): Promise<boolean>;
  preferLocal(id: string): Promise<boolean>;
};

export function cloudBridge(): CloudBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { asterionDesktop?: { cloud?: Partial<CloudBridge> } }).asterionDesktop?.cloud;
  return bridge && typeof bridge.get === 'function' ? bridge as CloudBridge : null;
}

/** The settings when the relay is on and configured; null otherwise (browser build, QA scripts without the main process). */
export async function activeCloudSettings(): Promise<CloudSettings | null> {
  const bridge = cloudBridge();
  if (!bridge) return null;
  try {
    const settings = await bridge.get();
    return settings.enabled && settings.url && settings.hasKey ? settings : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- entry */

export type CloudConflict = {
  reason: CloudConflictReason;
  text: string;
  localSavedAt: number | null;
  server: { savedAt: number; worldAt: number; revision: number; liveSince: number | null; deviceIsThis: boolean };
};

export type CloudEntryOutcome =
  | { kind: 'local'; message: string | null; tone: 'info' | 'error' }
  | { kind: 'applied'; message: string; worldAt: number; ms: number }
  | { kind: 'ask'; conflict: CloudConflict };

function readLocal(slot: Pick<SaveSlotMeta, 'storageKey'>): string | null {
  const storage = getBrowserSaveStorage();
  let raw: string | null = null;
  try { raw = storage?.getItem(slot.storageKey) ?? null; } catch { raw = null; }
  return raw === MISSING_EXTERNAL_SAVE ? null : raw;
}

/** Writes the server's world as this slot's save, byte for byte, and remembers the revision it is. */
function applyWorld(bridge: CloudBridge, slot: Pick<SaveSlotMeta, 'id' | 'storageKey'>, world: CloudWorld): Promise<boolean> {
  const storage = getBrowserSaveStorage();
  if (!storage) return Promise.resolve(false);
  storage.setItem(slot.storageKey, world.text);
  if (storage.getItem(slot.storageKey) !== world.text) return Promise.resolve(false);
  return bridge.markSynced(slot.id, world.revision, world.digest);
}

const dateTime = (ms: number) => new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function appliedMessage(world: CloudWorld, startedAt: number): CloudEntryOutcome {
  const ms = Math.round(performance.now() - startedAt);
  return {
    kind: 'applied', worldAt: world.worldAt, ms,
    message: world.origin === 'server'
      ? `Мир получен с сервера: он жил без вас до ${dateTime(world.worldAt)}.`
      : `Загружена копия с сервера от ${dateTime(world.worldAt)}.`,
  };
}

/**
 * Runs before a production slot opens. Takes the server's world when the
 * rules allow it, plays the local save otherwise, and returns a conflict for
 * the player to resolve. Never throws: any failure is the old local path.
 */
export async function prepareCloudEntry(slot: SaveSlotMeta, options: { onStage?: (text: string) => void; ignoreLocal?: boolean } = {}): Promise<CloudEntryOutcome> {
  const settings = await activeCloudSettings();
  const bridge = cloudBridge();
  if (!settings || !bridge) return { kind: 'local', message: null, tone: 'info' };
  const startedAt = performance.now();
  try {
    options.onStage?.('Получаем мир с сервера…');
    // The upload of a campaign just left to the menu finishes first.
    await bridge.wait(slot.id);
    const raw = options.ignoreLocal ? null : readLocal(slot);
    const [localDigest, found, record] = await Promise.all([
      raw === null ? Promise.resolve(null) : sha256Text(raw),
      bridge.campaign(slot.id),
      bridge.record(slot.id),
    ]);
    if (!found.ok) return { kind: 'local', message: `${found.error}: играем локальное сохранение.`, tone: 'error' };
    const campaign = found.campaign;
    const decision = decideCloudEntry({
      localDigest, localSavedAt: slot.updatedAt, record, campaign, appVersion: settings.appVersion, deviceId: settings.deviceId, schemaVersion: SAVE_SCHEMA_VERSION,
    });
    if (decision.action === 'ask') {
      const head = campaign!.head!;
      return {
        kind: 'ask',
        conflict: {
          reason: decision.reason, text: describeConflict(decision.reason), localSavedAt: raw === null ? null : slot.updatedAt,
          server: { savedAt: head.savedAt, worldAt: Math.max(head.worldAt, campaign!.live?.worldAt ?? 0), revision: head.revision,
            liveSince: campaign!.live ? campaign!.live.startedAt : null, deviceIsThis: head.deviceId === settings.deviceId },
        },
      };
    }
    if (decision.action === 'local') {
      if (decision.release) await bridge.release(slot.id).catch(() => undefined);
      const text = describeLocalReason(decision.reason, campaign);
      return { kind: 'local', message: decision.reason === 'same' || decision.reason === 'not-on-server' ? null : text, tone: 'info' };
    }
    if (decision.action === 'claim') {
      options.onStage?.('Получаем мир с сервера… сервер передаёт прожитый мир');
      const claimed = await bridge.claim(slot.id, decision.baseRevision);
      if (!claimed.ok) return { kind: 'local', message: `Мир с сервера не получен (${claimed.error}): досчитываем локально.`, tone: 'error' };
      if (!claimed.world) return { kind: 'local', message: null, tone: 'info' };
      options.onStage?.('Получаем мир с сервера… сохраняем');
      if (!await applyWorld(bridge, slot, claimed.world)) return { kind: 'local', message: 'Мир с сервера не записан: играем локальное сохранение.', tone: 'error' };
      return appliedMessage(claimed.world, startedAt);
    }
    if (decision.release) await bridge.release(slot.id).catch(() => undefined);
    options.onStage?.('Получаем мир с сервера… скачиваем копию');
    const downloaded = await bridge.download(slot.id, decision.snapshotId);
    if (!downloaded.ok) return { kind: 'local', message: `Копия с сервера не получена (${downloaded.error}): играем локальное сохранение.`, tone: 'error' };
    if (!await applyWorld(bridge, slot, downloaded.world)) return { kind: 'local', message: 'Копия с сервера не записана: играем локальное сохранение.', tone: 'error' };
    return appliedMessage(downloaded.world, startedAt);
  } catch (error) {
    console.warn('Asterion cloud entry failed; the local save is used.', error);
    return { kind: 'local', message: 'Облачный мир недоступен: играем локальное сохранение.', tone: 'error' };
  }
}

/**
 * The player's choice in a conflict. `server`: this computer's copy is kept
 * as a separate slot, then the server's world replaces it. `local`: this copy
 * goes on and replaces the server head with the next upload (the head stays a
 * server backup).
 */
export async function resolveCloudConflict(slot: SaveSlotMeta, choice: 'server' | 'local', onStage?: (text: string) => void): Promise<CloudEntryOutcome> {
  const bridge = cloudBridge();
  if (!bridge) return { kind: 'local', message: null, tone: 'info' };
  if (choice === 'local') {
    await bridge.preferLocal(slot.id);
    await bridge.release(slot.id).catch(() => undefined);
    return { kind: 'local', message: 'Продолжаем копию этого компьютера; сервер сохранит свою как резервную.', tone: 'info' };
  }
  if (readLocal(slot) !== null) {
    const copy = duplicateSaveSlot(slot.id);
    if (!copy.ok) return { kind: 'local', message: `Не удалось сохранить локальную копию (${copy.error}): ничего не заменено.`, tone: 'error' };
  }
  const outcome = await prepareCloudEntry(slot, { onStage, ignoreLocal: true });
  if (outcome.kind === 'applied') return { ...outcome, message: `${outcome.message} Прежняя копия этого компьютера — в слоте «${slot.name} (копия)».` };
  return outcome;
}

/** A campaign only on the server (another computer, a reinstall): a new local slot with its id. */
export async function openServerCampaign(campaign: CloudCampaignView, onStage?: (text: string) => void): Promise<{ ok: true; slot: SaveSlotMeta; outcome: CloudEntryOutcome } | { ok: false; error: string }> {
  const settings = await activeCloudSettings();
  const bridge = cloudBridge();
  if (!settings || !bridge) return { ok: false, error: 'Облачный мир выключен или не настроен.' };
  const placeholder = { id: campaign.id, storageKey: `asterion.slot.${campaign.id}.v1` } as SaveSlotMeta;
  const outcome = await prepareCloudEntry({ ...placeholder, updatedAt: 0, name: campaign.name } as SaveSlotMeta, { onStage, ignoreLocal: true });
  if (outcome.kind !== 'applied') return { ok: false, error: outcome.kind === 'local' ? outcome.message ?? 'Кампания не получена.' : 'Кампания не получена.' };
  const storage = getBrowserSaveStorage();
  const text = storage?.getItem(placeholder.storageKey) ?? null;
  if (!text) return { ok: false, error: 'Кампания не записана.' };
  const imported = importRawSaveSlot(campaign.id, campaign.name, text);
  if (!imported.ok || !imported.slot) return { ok: false, error: imported.ok ? 'Кампания не записана.' : imported.error };
  return { ok: true, slot: imported.slot, outcome };
}

/* ------------------------------------------------------------------ uploads */

function uploadMeta(text: string, left: boolean): UploadMeta {
  return { left, schemaVersion: saveSchemaVersion(text), worldAt: saveWorldAt(text), clockOffsetMs: pageClockOffsetMs() };
}

/**
 * The running campaign's uploads: a copy every CLOUD_UPLOAD_EVERY_MS, and the
 * hand-over on pagehide (going to the menu or closing the window), after
 * App's own last writes, of exactly the text this computer keeps.
 */
export function useCampaignCloudUploads(session: ActiveSession | null, saveKey: string): void {
  const enabled = useRef(false);
  useEffect(() => {
    if (!session) return undefined;
    const bridge = cloudBridge();
    if (!bridge) return undefined;
    let alive = true;
    let inFlight = false;
    const stored = () => {
      try {
        const text = getBrowserSaveStorage()?.getItem(saveKey) ?? null;
        return text && text !== MISSING_EXTERNAL_SAVE ? text : null;
      } catch { return null; }
    };
    void activeCloudSettings().then((settings) => { if (alive) enabled.current = Boolean(settings); });
    const timer = window.setInterval(() => {
      if (!enabled.current || inFlight) return;
      const text = stored();
      if (!text) return;
      inFlight = true;
      bridge.upload(session.slotId, session.slotName, text, uploadMeta(text, false))
        .catch(() => undefined)
        .finally(() => { inFlight = false; });
    }, CLOUD_UPLOAD_EVERY_MS);
    const handOver = () => {
      if (!enabled.current) return;
      enabled.current = false;
      const text = stored();
      if (!text) return;
      try { bridge.uploadOnExit(session.slotId, session.slotName, text, uploadMeta(text, true)); } catch (error) { console.warn('Asterion cloud hand-over failed.', error); }
    };
    window.addEventListener('pagehide', handOver);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', handOver);
    };
  }, [session, saveKey]);
}
