import { NPC_JOURNAL_VERSION, parseNpcJournalLines } from '../application/npc-journal.ts';

/**
 * The bot journal (application/npc-journal.ts) lives in a file next to the
 * save, in the desktop game's profile (electron/save-store.cjs): lines are
 * appended as the live world worker posts them, and the server's lines join
 * when a world comes back from it. In a browser there is no file: the journal
 * is not kept. Failures never touch the game.
 */

type BotJournalBridge = {
  append: (key: string, lines: string) => Promise<{ ok: boolean; error?: string }>;
  read: (key: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
  merge: (key: string, lines: string) => Promise<{ ok: boolean; added?: number; error?: string }>;
};

function bridge(): BotJournalBridge | null {
  return (globalThis as { asterionDesktop?: { botJournal?: BotJournalBridge } }).asterionDesktop?.botJournal ?? null;
}

export function botJournalAvailable(): boolean {
  return bridge() !== null;
}

export function appendBotJournal(saveKey: string, lines: string): void {
  if (!lines) return;
  void bridge()?.append(saveKey, lines).catch(() => undefined);
}

/** Joins the server's journal (a world back from the cloud): its lines after this file's last game time. */
export function mergeBotJournal(saveKey: string, lines: string): void {
  if (!lines) return;
  void bridge()?.merge(saveKey, lines).catch(() => undefined);
}

export async function readBotJournal(saveKey: string): Promise<string> {
  const result = await bridge()?.read(saveKey);
  if (!result?.ok) throw new Error(result?.error ?? 'Журнал ботов недоступен.');
  return result.text ?? '';
}

/** Downloads the journal as one JSON file; returns the number of entries. */
export async function downloadBotJournal(saveKey: string): Promise<number> {
  const entries = parseNpcJournalLines(await readBotJournal(saveKey));
  const body = JSON.stringify({ version: NPC_JOURNAL_VERSION, campaign: saveKey, exportedAt: new Date().toISOString(),
    legend: { t: 'время игры', o: 'владелец', k: 'вид действия', c: 'выбранный вариант', ok: 'начато', r: 'причина отказа',
      w: 'вес выбора', alt: 'следующие варианты с весами', s: 'стратегия / стиль', d: 'подробности' }, entries });
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `asterion-bots-journal-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return entries.length;
}
