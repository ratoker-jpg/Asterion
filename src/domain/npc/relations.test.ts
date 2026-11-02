// Directed relations (ADR §6.2, stage E): numbers that move on events, fade, and stay bounded.
import assert from 'node:assert/strict';
import test from 'node:test';

import { npcGiftCycles, isNpcProposal } from './pacts.ts';
import {
  applyNpcRelationEvent, isNpcRelationEdge, NPC_RELATION_LIMIT, readNpcRelationEdge, withNpcRelationEdge, type NpcRelationEdge,
} from './relations.ts';

const HOUR = 3_600_000;
const START = Date.UTC(2026, 9, 27);

test('an edge is what this owner thinks: help raises trust, an attack raises resentment and fear', () => {
  const helped = applyNpcRelationEvent(undefined, 'b', undefined, { kind: 'help-received', amount: 1_000, weight: 0.5 }, START);
  assert.ok(helped.trust > 0 && helped.affinity > 0);
  assert.equal(helped.helpReceived, 1_000);
  assert.equal(helped.helpsReceived, 1);
  const attacked = applyNpcRelationEvent(helped, 'b', undefined, { kind: 'attacked-by', hurt: 1 }, START);
  assert.ok(attacked.trust < helped.trust && attacked.resentment > 0 && attacked.fear > 0);
  assert.ok(isNpcRelationEdge(attacked));
});

test('gains saturate: repetition alone never reaches the limit, and betrayal outweighs a long friendship', () => {
  let edge: NpcRelationEdge | undefined;
  for (let index = 0; index < 8; index += 1) edge = applyNpcRelationEvent(edge, 'b', undefined, { kind: 'joint-op', won: true }, START);
  assert.ok(edge!.trust < 1 && edge!.trust > 0.5);
  const view = readNpcRelationEdge(edge, undefined, START)!;
  const betrayed = applyNpcRelationEvent(edge, 'b', undefined, { kind: 'betrayed' }, START);
  const after = readNpcRelationEdge(betrayed, undefined, START)!;
  assert.ok(after.regard < view.regard - 0.5);
  assert.ok(after.reliability < 0.5);
  assert.equal(after.promisesBroken, 1);
});

test('feelings fade with time, counts do not; a stranger is no opinion', () => {
  const edge = applyNpcRelationEvent(undefined, 'b', undefined, { kind: 'help-received', amount: 500, weight: 1 }, START);
  const soon = readNpcRelationEdge(edge, undefined, START)!;
  const later = readNpcRelationEdge(edge, undefined, START + 96 * HOUR)!;
  assert.ok(Math.abs(later.trust - soon.trust / 2) < 0.01, 'half of the trust is gone after its half-life');
  assert.equal(later.helpReceived, 500);
  assert.equal(readNpcRelationEdge(undefined, undefined, START), null);
});

test('reliability starts from a prior of one half, uncertainty falls with evidence, reciprocity shows who gave', () => {
  const first = readNpcRelationEdge(undefined, { trust: 0.5, affinity: 0, resentment: 0 }, START)!;
  assert.equal(first.reliability, 0.5);
  assert.equal(first.uncertainty, 1);
  let edge = applyNpcRelationEvent(undefined, 'b', undefined, { kind: 'promise-kept' }, START);
  edge = applyNpcRelationEvent(edge, 'b', undefined, { kind: 'help-given', amount: 900 }, START);
  edge = applyNpcRelationEvent(edge, 'b', undefined, { kind: 'help-received', amount: 100, weight: 0 }, START);
  const view = readNpcRelationEdge(edge, undefined, START)!;
  assert.ok(Math.abs(view.reliability - 2 / 3) < 1e-9);
  assert.equal(view.uncertainty, 0.5);
  assert.ok(view.reciprocity < -0.7, 'this owner gave far more than it got');
});

test('an old relation seeds the edge: trust from an earlier round goes on from where it stood', () => {
  const edge = applyNpcRelationEvent(undefined, 'b', { trust: 0.4, affinity: 0.2, resentment: 0, fear: 0.3, reliability: 1 }, { kind: 'promise-kept' }, START);
  assert.ok(edge.trust > 0.4);
  assert.equal(edge.fear, 0.3);
  assert.equal(edge.promisesKept, 3);
});

test('the list keeps its limit: the weakest old stranger goes, the new event always stays', () => {
  let edges: readonly NpcRelationEdge[] = [];
  for (let index = 0; index < NPC_RELATION_LIMIT; index += 1) {
    const to = `o${String(index).padStart(2, '0')}`;
    edges = withNpcRelationEdge(edges, applyNpcRelationEvent(undefined, to, undefined, { kind: 'attacked-by', hurt: index === 3 ? 0 : 1 }, START), START);
  }
  assert.equal(edges.length, NPC_RELATION_LIMIT);
  edges = withNpcRelationEdge(edges, applyNpcRelationEvent(undefined, 'new', undefined, { kind: 'repelled-by' }, START), START);
  assert.equal(edges.length, NPC_RELATION_LIMIT);
  assert.ok(edges.some((edge) => edge.to === 'new'));
  assert.ok(!edges.some((edge) => edge.to === 'o03'), 'the least hurtful one was forgotten');
  assert.deepEqual(edges.map((edge) => edge.to), [...edges.map((edge) => edge.to)].sort(), 'stable order for the save');
});

test('a gift chain is seen when wealth comes back within the window, and not when it does not', () => {
  const gift = (from: string, to: string, hours: number) => ({ from, to, amount: 100, at: START + hours * HOUR });
  assert.equal(npcGiftCycles([gift('a', 'b', 0), gift('b', 'c', 1), gift('c', 'a', 2)], 48 * HOUR), 1);
  assert.equal(npcGiftCycles([gift('a', 'b', 0), gift('b', 'a', 1)], 48 * HOUR), 1);
  assert.equal(npcGiftCycles([gift('a', 'b', 0), gift('b', 'a', 72)], 48 * HOUR), 0);
  assert.equal(npcGiftCycles([gift('a', 'b', 0), gift('a', 'c', 1), gift('d', 'b', 2)], 48 * HOUR), 0);
});

test('a proposal must say what it is: terms of the wrong kind or a bad status do not pass', () => {
  const base = { proposalId: 'p', from: 'a', to: 'b', createdAt: 1, expiresAt: 2, status: 'proposed' };
  const terms = { targetPlanetId: 't', targetOwnerId: 'c', strikeAt: 5, toleranceMs: 1, fromRole: { wave: 1, hull: 'bomber' }, toRole: { wave: 2, hull: 'destroyer' } };
  assert.ok(isNpcProposal({ ...base, kind: 'joint-strike', terms }));
  assert.ok(!isNpcProposal({ ...base, kind: 'joint-strike', terms: { ...terms, fromRole: { wave: 3, hull: 'bomber' } } }));
  assert.ok(!isNpcProposal({ ...base, status: 'maybe', kind: 'joint-strike', terms }));
  assert.ok(!isNpcProposal({ ...base, to: 'a', kind: 'joint-strike', terms }));
  assert.ok(isNpcProposal({ ...base, kind: 'resource-gift', terms: { resource: 'gas', amount: 10, planetId: 'x' } }));
  assert.ok(!isNpcProposal({ ...base, kind: 'resource-gift', terms: { resource: 'gold', amount: 10, planetId: 'x' } }));
});
