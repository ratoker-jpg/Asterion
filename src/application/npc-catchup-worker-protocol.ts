import type { SaveState } from './contracts.ts';
import type { RuntimeReconcileEvent } from './reconcile.ts';

/** Messages between App and the NPC catch-up worker (src/npc-catchup.worker.ts). */
export type NpcCatchupWorkerRequest =
  | { type: 'start'; runId: number; state: SaveState; persistEveryMs: number }
  | { type: 'cancel'; runId: number };

export type NpcCatchupWorkerResponse =
  | { type: 'progress'; runId: number; processedThroughAt: number; targetAt: number }
  /** The consistent prefix reached so far, as the save stores it. */
  | { type: 'persist'; runId: number; text: string }
  /**
   * Only the top-level save fields the catch-up replaced: fields App changed
   * meanwhile (planet selection, settings, the simulator) stay App's.
   */
  | { type: 'done'; runId: number; changed: Partial<SaveState>; removedKeys: string[]; events: RuntimeReconcileEvent[];
    chunks: number; computeMs: number }
  | { type: 'error'; runId: number; message: string };

/** Fired on window while a worker catch-up advances (the save itself stays frozen until it ends). */
export const NPC_CATCHUP_PROGRESS_EVENT = 'asterion:npc-catchup-progress';
