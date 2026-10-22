import type { NpcDecisionContext, NpcDecisionResult } from './types.ts';

/**
 * PR1's deliberately inert selector. It consumes only an explicit observation
 * and legal-action list; no save, world, or hidden profile is reachable here.
 */
export function selectNpcNoOpDecision(context: NpcDecisionContext): NpcDecisionResult {
  const { ownerId, at, eventId } = context.observation;
  if (context.ownerId !== ownerId || context.at !== at) {
    throw new TypeError('NPC decision context must match its observation owner and timestamp');
  }
  if (!Number.isFinite(at) || !eventId) throw new TypeError('NPC observation needs a finite time and eventId');
  if (context.observation.facts.some((fact) => !Number.isFinite(fact.observedAt) || fact.observedAt > at)) {
    throw new TypeError('NPC observations cannot contain facts from the future');
  }
  return Object.freeze({
    ownerId,
    at,
    eventId,
    selectedAction: null,
    wait: true,
    idempotencyKey: 'npc-decision:v1:' + JSON.stringify([ownerId, eventId]),
  });
}
