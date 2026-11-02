import type { NpcInheritedRelation } from './types.ts';

/**
 * What one owner thinks of another inside a campaign (NPC intelligence ADR
 * §6.2, stage E). Directed: A may trust B while B does not trust A. It moves
 * only on what really happened to the owner: a battle, help that arrived, a
 * raid flown together, a promise kept or broken. An attitude gives no right
 * and no knowledge: it weighs choices the owner already has.
 *
 * Numbers are the bots' judgement (owner may change them), not game rules.
 */

export const NPC_RELATION_LIMIT = 16;

const HOUR = 3_600_000;

/** Half-lives of a feeling, in real hours (people forget at the same pace on any campaign speed). */
export const NPC_RELATION_FADE_HOURS = Object.freeze({ trust: 96, affinity: 72, fear: 36, resentment: 96 });

export type NpcRelationEdge = Readonly<{
  to: string;
  /** -1..1: keeps its word, has given reason to rely on it. */
  trust: number;
  /** -1..1: personal warmth from shared success. */
  affinity: number;
  /** 0..1: how dangerous it has shown itself. */
  fear: number;
  /** 0..1: harm and deceit not yet forgotten. */
  resentment: number;
  /** Resources it delivered to this owner, and this owner to it (delivered, never promised). */
  helpReceived: number;
  helpGiven: number;
  /** Deliveries behind those sums. */
  helpsReceived: number;
  helpsGiven: number;
  jointOps: number;
  jointWins: number;
  promisesKept: number;
  promisesBroken: number;
  /** Events behind this edge: the fewer, the less sure the owner is. */
  evidence: number;
  updatedAt: number;
}>;

export type NpcRelationEvent =
  /** It attacked this owner; `hurt` 0..1: how much of the owner's economy the battle cost. */
  | Readonly<{ kind: 'attacked-by'; hurt: number }>
  /** This owner attacked it and came off badly: it now knows the price. */
  | Readonly<{ kind: 'repelled-by' }>
  /** Help arrived; `amount` in resources, `weight` 0..1 how much it mattered to this owner. */
  | Readonly<{ kind: 'help-received'; amount: number; weight: number }>
  | Readonly<{ kind: 'help-given'; amount: number }>
  | Readonly<{ kind: 'joint-op'; won: boolean }>
  | Readonly<{ kind: 'promise-kept' }>
  /** It agreed and pulled out in time, for a reason of its own. */
  | Readonly<{ kind: 'withdrew' }>
  | Readonly<{ kind: 'promise-broken' }>
  /** It attacked this owner while their agreement stood. */
  | Readonly<{ kind: 'betrayed' }>;

/** All an owner's decisions read of an edge, faded to the moment. */
export type NpcRelationView = Readonly<{
  trust: number;
  affinity: number;
  fear: number;
  resentment: number;
  /** 0..1: share of promises kept, prior 0.5 worth two promises. */
  reliability: number;
  /** -1..1: above zero it has given this owner more than it took. */
  reciprocity: number;
  /** 0..1: how little the owner has to go on. */
  uncertainty: number;
  /** -1..1: the one number most choices weigh. */
  regard: number;
  helpReceived: number;
  helpGiven: number;
  jointOps: number;
  jointWins: number;
  promisesBroken: number;
}>;

const clamp = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min);
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const fade = (value: number, elapsed: number, halfLifeHours: number) => (elapsed > 0 ? value * 0.5 ** (elapsed / (halfLifeHours * HOUR)) : value);

export function npcRegardOf(trust: number, affinity: number, resentment: number): number {
  return clamp(trust + 0.25 * affinity - resentment, -1, 1);
}

function emptyEdge(to: string, at: number, seed?: NpcInheritedRelation): NpcRelationEdge {
  return {
    to, trust: seed?.trust ?? 0, affinity: seed?.affinity ?? 0, fear: seed?.fear ?? 0, resentment: seed?.resentment ?? 0,
    helpReceived: 0, helpGiven: 0, helpsReceived: 0, helpsGiven: 0, jointOps: 0, jointWins: 0,
    // Old reliability speaks through the prior: as if the persona had seen a couple of promises.
    promisesKept: seed?.reliability !== undefined ? Math.round(seed.reliability * 2) : 0,
    promisesBroken: seed?.reliability !== undefined ? 2 - Math.round(seed.reliability * 2) : 0,
    evidence: 0, updatedAt: at,
  };
}

/** The edge as it stands at `at`: feelings have faded, counts have not. */
function fadedEdge(edge: NpcRelationEdge, at: number): NpcRelationEdge {
  const elapsed = at - edge.updatedAt;
  if (elapsed <= 0) return edge;
  return { ...edge,
    trust: fade(edge.trust, elapsed, NPC_RELATION_FADE_HOURS.trust),
    affinity: fade(edge.affinity, elapsed, NPC_RELATION_FADE_HOURS.affinity),
    fear: fade(edge.fear, elapsed, NPC_RELATION_FADE_HOURS.fear),
    resentment: fade(edge.resentment, elapsed, NPC_RELATION_FADE_HOURS.resentment),
    updatedAt: at };
}

function toView(edge: NpcRelationEdge): NpcRelationView {
  const helps = edge.helpReceived + edge.helpGiven;
  return {
    trust: edge.trust, affinity: edge.affinity, fear: edge.fear, resentment: edge.resentment,
    reliability: (edge.promisesKept + 1) / (edge.promisesKept + edge.promisesBroken + 2),
    reciprocity: helps > 0 ? (edge.helpReceived - edge.helpGiven) / helps : 0,
    uncertainty: 1 / (1 + edge.evidence / 3),
    regard: npcRegardOf(edge.trust, edge.affinity, edge.resentment),
    helpReceived: edge.helpReceived, helpGiven: edge.helpGiven,
    jointOps: edge.jointOps, jointWins: edge.jointWins, promisesBroken: edge.promisesBroken,
  };
}

export function readNpcRelationEdge(edge: NpcRelationEdge | undefined, seed: NpcInheritedRelation | undefined, at: number): NpcRelationView | null {
  if (edge) return toView(fadedEdge(edge, at));
  // Remembered from an earlier round, not yet touched here: as remembered, and unsure.
  return seed ? toView(emptyEdge('', at, seed)) : null;
}

/** One event on an edge. Gains saturate: no number runs to its limit on repetition alone. */
export function applyNpcRelationEvent(previous: NpcRelationEdge | undefined, to: string, seed: NpcInheritedRelation | undefined,
  event: NpcRelationEvent, at: number): NpcRelationEdge {
  const edge = previous ? fadedEdge(previous, at) : emptyEdge(to, at, seed);
  let { trust, affinity, fear, resentment } = edge;
  const towards = (value: number, limit: number, share: number) => value + (limit - value) * share;
  const next: { -readonly [K in keyof NpcRelationEdge]: NpcRelationEdge[K] } = { ...edge };
  switch (event.kind) {
    case 'attacked-by': {
      const hurt = clamp(event.hurt, 0, 1);
      trust = towards(trust, -1, 0.1 + 0.15 * hurt);
      affinity = towards(affinity, -1, 0.1);
      fear = towards(fear, 1, 0.1 + 0.3 * hurt);
      resentment = towards(resentment, 1, 0.15 + 0.3 * hurt);
      break;
    }
    case 'repelled-by':
      fear = towards(fear, 1, 0.15);
      break;
    case 'help-received': {
      const weight = clamp(event.weight, 0, 1);
      trust = towards(trust, 1, 0.05 + 0.2 * weight);
      affinity = towards(affinity, 1, 0.05 + 0.15 * weight);
      resentment = towards(resentment, 0, 0.1 * weight);
      next.helpReceived = edge.helpReceived + Math.max(0, Math.floor(event.amount));
      next.helpsReceived = edge.helpsReceived + 1;
      break;
    }
    case 'help-given':
      // Helping someone leaves a little warmth, though it says nothing about trusting them.
      affinity = towards(affinity, 1, 0.03);
      next.helpGiven = edge.helpGiven + Math.max(0, Math.floor(event.amount));
      next.helpsGiven = edge.helpsGiven + 1;
      break;
    case 'joint-op':
      trust = towards(trust, 1, event.won ? 0.12 : 0.05);
      affinity = towards(affinity, 1, event.won ? 0.12 : 0.04);
      next.jointOps = edge.jointOps + 1;
      next.jointWins = edge.jointWins + (event.won ? 1 : 0);
      break;
    case 'promise-kept':
      trust = towards(trust, 1, 0.1);
      next.promisesKept = edge.promisesKept + 1;
      break;
    case 'withdrew':
      trust = towards(trust, -1, 0.03);
      break;
    case 'promise-broken':
      trust = towards(trust, -1, 0.25);
      affinity = towards(affinity, -1, 0.1);
      resentment = towards(resentment, 1, 0.2);
      next.promisesBroken = edge.promisesBroken + 1;
      break;
    case 'betrayed':
      trust = towards(trust, -1, 0.6);
      affinity = towards(affinity, -1, 0.4);
      fear = towards(fear, 1, 0.2);
      resentment = towards(resentment, 1, 0.5);
      next.promisesBroken = edge.promisesBroken + 1;
      break;
  }
  return { ...next, trust: round3(trust), affinity: round3(affinity), fear: round3(fear), resentment: round3(resentment),
    evidence: edge.evidence + 1, updatedAt: at };
}

/** How much an edge is worth keeping at `at`: faded weak strangers go first. */
function significance(edge: NpcRelationEdge, at: number): number {
  const faded = fadedEdge(edge, at);
  return Math.max(Math.abs(faded.trust), Math.abs(faded.affinity), faded.fear, faded.resentment)
    + 0.05 * Math.min(4, faded.jointOps + faded.helpsReceived + faded.promisesBroken);
}

/** The list with `edge` in its place, within the limit; always keeps `edge`, order is stable by id. */
export function withNpcRelationEdge(edges: readonly NpcRelationEdge[], edge: NpcRelationEdge, at: number): readonly NpcRelationEdge[] {
  const others = edges.filter((item) => item.to !== edge.to);
  const kept = others.length < NPC_RELATION_LIMIT ? others : [...others]
    .sort((left, right) => significance(right, at) - significance(left, at) || (left.to < right.to ? -1 : 1))
    .slice(0, NPC_RELATION_LIMIT - 1);
  return [...kept, edge].sort((left, right) => (left.to < right.to ? -1 : left.to > right.to ? 1 : 0));
}

const isSignedUnit = (value: unknown) => typeof value === 'number' && value >= -1 && value <= 1;
const isUnit = (value: unknown) => typeof value === 'number' && value >= 0 && value <= 1;
const isCount = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;

export function isNpcRelationEdge(value: unknown): value is NpcRelationEdge {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const edge = value as Record<string, unknown>;
  return typeof edge.to === 'string' && edge.to.length > 0 && isSignedUnit(edge.trust) && isSignedUnit(edge.affinity)
    && isUnit(edge.fear) && isUnit(edge.resentment)
    && ['helpReceived', 'helpGiven', 'helpsReceived', 'helpsGiven', 'jointOps', 'jointWins', 'promisesKept', 'promisesBroken', 'evidence', 'updatedAt']
      .every((key) => isCount(edge[key]));
}
