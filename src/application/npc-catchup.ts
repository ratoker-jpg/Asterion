import type { SaveState } from './contracts.ts';
export { isNpcReplayMetadata } from '../domain/npc/replay-state.ts';

export const NPC_REPLAY_MAX_GROUPS = 64;
export const NPC_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1_000;

export function isNpcCatchupPending(state: Pick<SaveState, 'npcReplay'>): boolean {
  return Boolean(state.npcReplay && state.npcReplay.targetAt > state.npcReplay.processedThroughAt);
}
