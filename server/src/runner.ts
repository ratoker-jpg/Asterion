// One living world (a child process of server.ts, started from the release
// whose game version the world was left with). It holds the world in memory
// and keeps it at the clock with the game's own code (npc-live-world.ts),
// writes a checkpoint now and then, and on request writes the world out and
// exits. The supervisor never runs game code itself.
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { SaveState } from '../../src/application/contracts.ts';
import { loadSavedState, serializeSaveForStorage } from '../../src/application/persistence.ts';
import { applyCampaignRuntimeForCatchup } from '../../src/application/npc-catchup-runner.ts';
import { advanceLiveWorld, beginLiveWorld, finishLiveWorld } from '../../src/application/npc-live-world.ts';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export type RunnerStart = {
  type: 'start';
  /** gzip save: the left revision, or the live checkpoint when `resume`. */
  input: string;
  resume: boolean;
  /** npcReplay of the left save (needed to hand a resumed world back). */
  leftReplay?: SaveState['npcReplay'];
  clockOffsetMs: number;
  stepMs: number;
  /** Compute per tick before the runner looks at its messages again. */
  stepBudgetMs: number;
  checkpointFile: string;
  checkpointEveryMs: number;
};

export type RunnerRequest =
  | RunnerStart
  /** finish: hand the world back (close the absence); otherwise a checkpoint-style stop. */
  | { type: 'stop'; out: string; finish: boolean }
  | { type: 'checkpoint' };

export type RunnerWritten = { file: string; worldAt: number; digest: string; bytes: number; gzBytes: number; ms: number };

export type RunnerMessage =
  | { type: 'ready'; worldAt: number; leftReplay: SaveState['npcReplay']; loadMs: number; rss: number }
  | { type: 'status'; worldAt: number; lagMs: number; tickMs: number; cpuShare: number; rss: number; heapUsed: number }
  | { type: 'checkpoint'; written: RunnerWritten }
  | { type: 'stopped'; written: RunnerWritten }
  | { type: 'error'; message: string };

function send(message: RunnerMessage): void {
  if (process.connected) process.send?.(message);
}

const now = { offset: 0, read: () => Date.now() + now.offset };

let state: SaveState | null = null;
let leftReplay: SaveState['npcReplay'];
let start: RunnerStart | null = null;
let groups: number | undefined;
let timer: NodeJS.Timeout | null = null;
let busy = false;
let stopping = false;
let lastCheckpointAt = Date.now();
let computeWindow = { since: Date.now(), ms: 0 };

/** Writes the world as the client stores it: the save text, gzip, and its digest. */
export async function writeWorld(world: SaveState, file: string): Promise<RunnerWritten> {
  const startedAt = performance.now();
  const text = serializeSaveForStorage(world, 'production');
  const digest = createHash('sha256').update(text, 'utf8').digest('hex');
  const bytes = Buffer.byteLength(text, 'utf8');
  const packed = await gzip(text, { level: 6 });
  const temporary = `${file}.tmp-${process.pid}`;
  await fs.promises.writeFile(temporary, packed);
  await fs.promises.rename(temporary, file);
  return { file, worldAt: world.npcReplay?.processedThroughAt ?? 0, digest, bytes, gzBytes: packed.length, ms: Math.round(performance.now() - startedAt) };
}

export async function readWorld(file: string, at: number): Promise<SaveState> {
  const text = (await gunzip(await fs.promises.readFile(file))).toString('utf8');
  const storage = new Map([['save', text]]);
  const loaded = loadSavedState({
    mode: 'production', saveKey: 'save', now: () => at,
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: (key) => { storage.delete(key); } },
  });
  if (loaded.status !== 'loaded') throw new Error(`The save does not load: ${'problem' in loaded ? JSON.stringify(loaded.problem) : loaded.status}`);
  return loaded.state;
}

function schedule(delayMs: number): void {
  if (stopping) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), delayMs);
}

async function tick(): Promise<void> {
  timer = null;
  if (!state || !start || busy || stopping) return;
  busy = true;
  try {
    const step = advanceLiveWorld(state, now.read(), { budgetMs: start.stepBudgetMs, groups });
    state = step.state;
    groups = step.groups;
    computeWindow.ms += step.computeMs;
    const worldAt = state.npcReplay?.processedThroughAt ?? now.read();
    const elapsed = Date.now() - computeWindow.since;
    const usage = process.memoryUsage();
    send({ type: 'status', worldAt, lagMs: Math.max(0, now.read() - worldAt), tickMs: Math.round(step.computeMs),
      cpuShare: elapsed > 0 ? +(computeWindow.ms / elapsed).toFixed(4) : 0, rss: usage.rss, heapUsed: usage.heapUsed });
    if (elapsed > 10 * 60_000) computeWindow = { since: Date.now(), ms: 0 };
    if (Date.now() - lastCheckpointAt >= start.checkpointEveryMs) await checkpoint();
    // Behind the clock (a restart, a long first catch-up): continue at once.
    schedule(step.caughtUp ? start.stepMs : 0);
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) });
    process.exit(1);
  } finally {
    busy = false;
  }
}

async function checkpoint(): Promise<void> {
  if (!state || !start) return;
  lastCheckpointAt = Date.now();
  send({ type: 'checkpoint', written: await writeWorld(state, start.checkpointFile) });
}

async function onStart(message: RunnerStart): Promise<void> {
  start = message;
  now.offset = message.clockOffsetMs;
  const startedAt = performance.now();
  const loaded = await readWorld(message.input, now.read());
  leftReplay = message.resume ? message.leftReplay : loaded.npcReplay;
  applyCampaignRuntimeForCatchup(loaded, now.read());
  state = message.resume ? loaded : beginLiveWorld(loaded);
  send({ type: 'ready', worldAt: state.npcReplay?.processedThroughAt ?? 0, leftReplay, loadMs: Math.round(performance.now() - startedAt), rss: process.memoryUsage().rss });
  schedule(0);
}

async function onStop(message: { out: string; finish: boolean }): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  while (busy) await new Promise((resolve) => setTimeout(resolve, 20));
  if (!state) throw new Error('No world to stop.');
  const world = message.finish ? finishLiveWorld(state, { npcReplay: leftReplay }) : state;
  send({ type: 'stopped', written: await writeWorld(world, message.out) });
  process.exit(0);
}

function fail(error: unknown): void {
  send({ type: 'error', message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) });
  process.exit(1);
}

if (process.send) {
  try { os.setPriority(10); } catch { /* the service's Nice already applies */ }
  process.on('message', (message: RunnerRequest) => {
    if (message.type === 'start') onStart(message).catch(fail);
    else if (message.type === 'stop') onStop(message).catch(fail);
    else if (message.type === 'checkpoint' && !busy) checkpoint().catch(fail);
  });
  // The supervisor lost: keep what is computed and leave.
  process.on('disconnect', () => {
    if (!state || !start || stopping) process.exit(0);
    onStop({ out: start.checkpointFile, finish: false }).catch(() => process.exit(1));
  });
  process.on('SIGTERM', () => {
    if (!state || !start || stopping) process.exit(0);
    onStop({ out: start.checkpointFile, finish: false }).catch(() => process.exit(1));
  });
}
