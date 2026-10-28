/// <reference lib="webworker" />
// The NPC catch-up away from the UI thread: App posts the frozen world, the
// worker replays it with npc-catchup-runner and posts progress, occasional
// save text and the finished world. See useNpcCatchupWorker in App.
import type { SaveState } from './application/contracts.ts';
import { applyCampaignRuntimeForCatchup, runNpcCatchup } from './application/npc-catchup-runner.ts';
import { serializeSaveForStorage } from './application/persistence.ts';
import type { NpcCatchupWorkerRequest, NpcCatchupWorkerResponse } from './application/npc-catchup-worker-protocol.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let cancelledRun = -1;
const post = (message: NpcCatchupWorkerResponse) => scope.postMessage(message);

scope.onmessage = async (event: MessageEvent<NpcCatchupWorkerRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelledRun = message.runId;
    return;
  }
  const { runId, state: initial } = message;
  try {
    applyCampaignRuntimeForCatchup(initial, Date.now());
    const result = await runNpcCatchup(initial, {
      now: () => Date.now(),
      onProgress: (progress) => post({ type: 'progress', runId, ...progress }),
      onPersist: (state) => post({ type: 'persist', runId, text: serializeSaveForStorage(state, 'production') }),
      persistEveryMs: message.persistEveryMs,
      // Lets a cancel message in between chunks.
      yieldBetweenChunks: () => new Promise((resolve) => setTimeout(resolve, 0)),
      cancelled: () => cancelledRun === runId,
    });
    if (cancelledRun === runId) return;
    const before = initial as Record<string, unknown>;
    const after = result.state as Record<string, unknown>;
    const changedKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => before[key] !== after[key]);
    const changed = Object.fromEntries(changedKeys.map((key) => [key, after[key]])) as Partial<SaveState>;
    post({ type: 'done', runId, changed, removedKeys: changedKeys.filter((key) => !(key in after)), events: result.events,
      chunks: result.chunks, computeMs: result.computeMs });
  } catch (error) {
    post({ type: 'error', runId, message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) });
  }
};
