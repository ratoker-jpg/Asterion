// The bot journal only watches (owner rule 31.10.2026): a world run with a
// journal attached is the world run without one, byte for byte, and the
// journal holds the top owners' choices with their alternatives.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { advanceLiveWorld, beginLiveWorld } from './npc-live-world.ts';
import { createInitialSaveState, serializeSaveForStorage } from './persistence.ts';
import { getNpcOwnerIds } from './npc-foundation.ts';
import { applyCampaignRuntimeForCatchup } from './npc-catchup-runner.ts';
import {
  formatNpcJournalLines, mergeNpcJournal, NPC_JOURNAL_DETAILED_TOP, NPC_JOURNAL_KEEP_MS, NpcJournalRecorder, parseNpcJournalLines,
  setNpcJournalSink, type NpcJournalEntry,
} from './npc-journal.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';

const MINUTE = 60_000;
const START_AT = Date.UTC(2026, 0, 1);

function world(): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'NPCJOURNAL2026', campaignName: 'Bot journal' });
  config.world = { ...config.world, galaxyCount: 1, npcCount: 24, campaignSpeed: 'fast', randomPlayerStart: false };
  const base = createInitialSaveState('production', START_AT, config);
  const ownerIds = getNpcOwnerIds(base.espionage?.targets, base.profile.playerId);
  return { ...base, npc: createNpcState(ownerIds, 'npc-journal-test-salt', START_AT) };
}

const digest = (state: SaveState) => createHash('sha256').update(serializeSaveForStorage(state, 'production')).digest('hex');

// Fresh campaigns draw ids from entropy: both runs start from one world.
const start = world();

function run(recorder: NpcJournalRecorder | null): SaveState {
  let state = structuredClone(start);
  applyCampaignRuntimeForCatchup(state, START_AT);
  state = beginLiveWorld(state);
  const previous = setNpcJournalSink(recorder);
  try {
    for (let at = START_AT + 10 * MINUTE; at <= START_AT + 90 * MINUTE; at += 10 * MINUTE) {
      recorder?.observe(state, state.npcReplay!.processedThroughAt);
      state = advanceLiveWorld(state, at).state;
    }
  } finally {
    setNpcJournalSink(previous);
  }
  return state;
}

test('a world with the bot journal attached equals the world without it', () => {
  const recorder = new NpcJournalRecorder();
  const watched = run(recorder);
  const plain = run(null);
  assert.equal(digest(watched), digest(plain));
  const entries = recorder.take();
  const tops = entries.filter((entry) => entry.k === 'top');
  assert.ok(tops.length, 'the top owners are recorded');
  for (const top of tops) assert.equal((top.d!.owners as unknown[]).length, NPC_JOURNAL_DETAILED_TOP);
  // The top is refreshed every game hour: an owner may enter or leave it.
  const owners = new Set(tops.flatMap((top) => (top.d!.owners as [string, number][]).map(([ownerId]) => ownerId)));
  const decisions = entries.filter((entry) => !['top', 'style', 'kpi', 'battle', 'plan'].includes(entry.k));
  assert.ok(decisions.length > 20, `decisions recorded (${decisions.length})`);
  // The outcome ledger covers every owner, not only the top: each hour, each NPC's kpi.
  const kpiOwners = new Set(entries.filter((entry) => entry.k === 'kpi').map((entry) => entry.o));
  assert.equal(kpiOwners.size, Object.keys(start.npc!.profiles).length, 'every NPC has an hourly kpi');
  assert.ok(entries.filter((entry) => entry.k === 'kpi').every((entry) => typeof entry.d?.pts === 'number' && typeof entry.d?.fleet === 'number'));
  assert.ok(decisions.every((entry) => owners.has(entry.o)), 'only the top owners are written in detail');
  assert.ok(decisions.some((entry) => (entry.alt?.length ?? 0) > 0), 'alternatives with their weights are kept');
  assert.deepEqual(parseNpcJournalLines(formatNpcJournalLines(entries)), entries);
});

test('a merged journal keeps the last three game days and skips what it already has', () => {
  const entry = (t: number): NpcJournalEntry => ({ t, o: 'npc-a', k: 'economy', c: `building:${t}` });
  const local = [entry(0), entry(1_000)];
  const server = [entry(1_000), entry(NPC_JOURNAL_KEEP_MS), entry(NPC_JOURNAL_KEEP_MS + 2_000)];
  // 0 and 1 000 fall out of the last three days; the duplicate 1 000 is not taken twice.
  assert.deepEqual(mergeNpcJournal(local, server).map((item) => item.t), [NPC_JOURNAL_KEEP_MS, NPC_JOURNAL_KEEP_MS + 2_000]);
  assert.deepEqual(mergeNpcJournal(local, [entry(1_000), entry(1_500)]).map((item) => item.t), [0, 1_000, 1_500]);
  assert.deepEqual(parseNpcJournalLines('{"t":1,"o":"a","k":"wait"}\n{"t":2,"o":'), [{ t: 1, o: 'a', k: 'wait' }]);
});
