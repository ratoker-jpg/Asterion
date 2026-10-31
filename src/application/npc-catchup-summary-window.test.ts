// Owner decision (31.10.2026): the world news of an absence get their window
// only after more than 3 game hours away; the news of one absence stay one
// summary when the cloud server lived its first part and this computer
// replays the rest.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { freezeNpcCatchupTarget } from './npc-catchup.ts';
import { createInitialSaveState } from './persistence.ts';
import { isWorldSummaryWorthShowing, startWorldCatchupSummary, WORLD_SUMMARY_MIN_ABSENCE_MS } from './world-catchup-summary.ts';

const HOUR = 3_600_000;
const MINUTE = 60_000;

test('the summary window needs an absence longer than 3 game hours', () => {
  assert.equal(WORLD_SUMMARY_MIN_ABSENCE_MS, 3 * HOUR);
  const from = 1_767_312_000_000;
  assert.equal(isWorldSummaryWorthShowing({ fromAt: from, finishedAt: from + 2 * HOUR + 59 * MINUTE }), false, '2 h 59 min: caught up quietly');
  assert.equal(isWorldSummaryWorthShowing({ fromAt: from, finishedAt: from + 3 * HOUR }), false, 'exactly 3 h: quiet');
  assert.equal(isWorldSummaryWorthShowing({ fromAt: from, finishedAt: from + 3 * HOUR + MINUTE }), true, '3 h 01 min: the window');
  assert.equal(isWorldSummaryWorthShowing({ fromAt: from, finishedAt: from + 10_000 }), false, 'seconds away (the «0 мин» window)');
  assert.equal(isWorldSummaryWorthShowing({ fromAt: from }), false, 'still open');
});

test('a catch-up right after the server handed the world back continues the same news', () => {
  const config = createDefaultNewGameConfig({ seed: 'SUMMARY-WINDOW', factionId: 'aegis', playerName: 'QA' });
  const leftAt = 1_767_312_000_000;
  const base = createInitialSaveState('production', leftAt, { ...config, world: { ...config.world, galaxyCount: 1, npcCount: 4 } });
  // The server lived 2 h and was claimed while still 4 h behind: its news end at the cursor.
  const cursor = leftAt + 2 * HOUR;
  const serverNews = { ...startWorldCatchupSummary(base, leftAt), finishedAt: cursor };
  const claimed = { ...base, npcReplay: { version: 1 as const, processedThroughAt: cursor, targetAt: cursor, summary: serverNews } };
  const frozen = freezeNpcCatchupTarget(claimed, cursor + 4 * HOUR);
  assert.equal(frozen.npcReplay!.summary!.fromAt, leftAt, 'one absence from where the player left');
  assert.equal(frozen.npcReplay!.summary!.finishedAt, undefined, 'open until the rest is replayed');
  // A gap after news that ended earlier (the player read them, then went away again) is a new absence.
  const later = { ...claimed, npcReplay: { ...claimed.npcReplay, processedThroughAt: cursor + 10 * MINUTE, targetAt: cursor + 10 * MINUTE } };
  assert.equal(freezeNpcCatchupTarget(later, cursor + 5 * HOUR).npcReplay!.summary!.fromAt, cursor + 10 * MINUTE);
});
