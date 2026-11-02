import { getStorageCapacities } from '../domain/buildings/balance-v1.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import {
  applyNpcRelationEvent, readNpcRelationEdge, withNpcRelationEdge,
  type NpcRelationEdge, type NpcRelationEvent, type NpcRelationView,
} from '../domain/npc/relations.ts';
import { createNpcStrategyState } from '../domain/npc/strategy.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import type { SaveState } from './contracts.ts';

/**
 * Directed relations seen from the save (domain/npc/relations.ts): reading what
 * an owner thinks, and the events that change it. Every write comes from
 * something that really happened in the world; an edge starts from what the
 * owner remembers of earlier rounds of a series (`profile.inherited`).
 */

const NO_VIEWS: ReadonlyMap<string, NpcRelationView> = new Map();

/** What the owner thinks of another now; null when it has no opinion at all. */
export function npcRelationView(state: SaveState, profile: NpcProfile, to: string, at: number): NpcRelationView | null {
  const edge = state.npcStrategy?.relations?.[profile.ownerId]?.find((item) => item.to === to);
  return readNpcRelationEdge(edge, profile.inherited?.relations[to], at);
}

/** -1..1; 0 for a stranger, so an owner without history decides as it always did. */
export function npcRegard(state: SaveState, profile: NpcProfile, to: string, at: number): number {
  return npcRelationView(state, profile, to, at)?.regard ?? 0;
}

/** Everything the owner has an opinion on, for one look at the game. */
export function npcRelationViews(state: SaveState, profile: NpcProfile, at: number): ReadonlyMap<string, NpcRelationView> {
  const edges = state.npcStrategy?.relations?.[profile.ownerId];
  const inherited = profile.inherited?.relations;
  if (!edges?.length && !inherited) return NO_VIEWS;
  const views = new Map<string, NpcRelationView>();
  for (const [to, seed] of Object.entries(inherited ?? {})) {
    const view = readNpcRelationEdge(undefined, seed, at);
    if (view) views.set(to, view);
  }
  for (const edge of edges ?? []) {
    const view = readNpcRelationEdge(edge, inherited?.[edge.to], at);
    if (view) views.set(edge.to, view);
  }
  return views;
}

/** -1..1: how the owner regards a group by those of it it knows; 0 when it knows none. */
export function npcGroupRegard(state: SaveState, profile: NpcProfile, ownerIds: readonly string[], at: number): number {
  let sum = 0;
  let known = 0;
  for (const ownerId of ownerIds) {
    const view = npcRelationView(state, profile, ownerId, at);
    if (!view) continue;
    sum += view.regard;
    known += 1;
  }
  return known ? sum / known : 0;
}

/** One event: only an NPC keeps an opinion (the player's is the player's own). */
export function recordNpcRelation(state: SaveState, from: string, to: string, event: NpcRelationEvent, at: number): SaveState {
  const profile = state.npc?.profiles[from];
  if (!profile || from === to || !to) return state;
  const strategy = state.npcStrategy ?? createNpcStrategyState();
  const edges: readonly NpcRelationEdge[] = strategy.relations?.[from] ?? [];
  const edge = applyNpcRelationEvent(edges.find((item) => item.to === to), to, profile.inherited?.relations[to], event, at);
  return { ...state, npcStrategy: { ...strategy, relations: { ...(strategy.relations ?? {}), [from]: withNpcRelationEdge(edges, edge, at) } } };
}

/** 0..1: how much a battle's cost hurts, by its size. */
function hurtOf(loss: number): number {
  return Math.min(1, Math.max(0, Math.log10(1 + Math.max(0, loss) / 10_000) / 3));
}

/** A battle between two owners: the attacked remembers the attacker; an attacker beaten off learns the price. */
export function recordNpcBattleRelations(state: SaveState, report: BattleReport, at: number, defenderLoss: number): SaveState {
  const attacker = report.attacker.playerId;
  const defender = report.defender.playerId;
  if (!attacker || !defender) return state;
  let next = recordNpcRelation(state, defender, attacker, { kind: 'attacked-by', hurt: hurtOf(defenderLoss) }, at);
  if (report.winner !== 'attacker') next = recordNpcRelation(next, attacker, defender, { kind: 'repelled-by' }, at);
  return next;
}

/** 0..1: how much a delivery matters, by how much of a planet's stores it fills. */
export function npcHelpWeight(buildings: Parameters<typeof getStorageCapacities>[0], amount: number): number {
  const capacity = getStorageCapacities(buildings);
  return Math.min(1, 2 * Math.max(0, amount) / Math.max(1, capacity.metal + capacity.minerals + capacity.gas));
}

/** Resources that really reached a planet; a promise moves nothing. Works for the player's help too (owner decision 10). */
export function recordNpcHelp(state: SaveState, sender: string, recipient: string, amount: number, weight: number, at: number): SaveState {
  if (amount <= 0 || sender === recipient) return state;
  const received = recordNpcRelation(state, recipient, sender, { kind: 'help-received', amount, weight }, at);
  return recordNpcRelation(received, sender, recipient, { kind: 'help-given', amount }, at);
}

/** A raid flown together: everyone who flew remembers the others. */
export function recordNpcJointRaid(state: SaveState, ownerIds: readonly string[], won: boolean, at: number): SaveState {
  let next = state;
  for (const from of ownerIds) for (const to of ownerIds) if (from !== to) next = recordNpcRelation(next, from, to, { kind: 'joint-op', won }, at);
  return next;
}
