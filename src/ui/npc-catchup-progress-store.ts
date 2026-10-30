import { useSyncExternalStore } from 'react';
import type { NpcCatchupProgress } from '../application/npc-catchup-runner.ts';
import { NPC_CATCHUP_PROGRESS_EVENT } from '../application/live-world-protocol.ts';

/**
 * Live progress of a catch-up running in the worker. The save stays frozen
 * until the worker hands the world back, so only the progress window (not
 * the whole App) re-renders as the cursor moves.
 */
let current: NpcCatchupProgress | null = null;
const listeners = new Set<() => void>();

export function setNpcCatchupProgress(progress: NpcCatchupProgress | null): void {
  current = progress;
  for (const listener of listeners) listener();
  if (progress && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NPC_CATCHUP_PROGRESS_EVENT, { detail: progress }));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNpcCatchupProgress(): NpcCatchupProgress | null {
  return useSyncExternalStore(subscribe, () => current);
}
