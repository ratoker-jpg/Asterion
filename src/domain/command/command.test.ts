import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultCommandState,
  joinJointOperation,
  markResourceRequestReviewing,
  migrateCommandState,
  persistCommandState,
  readCommandState,
  resetCommandState,
  updateAllianceSettings,
} from './repository.ts';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const SAVE_KEY = 'asterion.vertical-slice.v1';

test('default command state is deterministic', () => {
  assert.deepEqual(createDefaultCommandState(), createDefaultCommandState());
});

test('default factories do not share mutable arrays or emblem objects', () => {
  const first = createDefaultCommandState();
  const second = createDefaultCommandState();
  first.members[0].note = 'changed';
  first.diplomacy[0].history.push('changed');
  first.alliance.emblem.glyph = 'orbit';

  assert.notDeepEqual(first, second);
  assert.deepEqual(second, createDefaultCommandState());
});

test('missing command migrates to canonical default', () => {
  assert.deepEqual(migrateCommandState(undefined), createDefaultCommandState());
  assert.deepEqual(migrateCommandState({}), createDefaultCommandState());

  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, JSON.stringify({ metal: 777, operations: { items: [] } }));
  assert.deepEqual(readCommandState(storage), createDefaultCommandState());
});

test('malformed command data does not break migration', () => {
  const migrated = migrateCommandState({
    alliance: { name: '', tag: null, emblem: { glyph: 'broken', accent: 'broken' } },
    members: 'broken',
    resourceRequests: [{ id: 'request-nora-gas', amount: -400, state: 'done' }],
    diplomacy: [{ id: 'relation-aurora', status: 'war' }],
    jointOperations: [{ id: 'joint-sun-raid', participants: -8, joinedByPlayer: 'yes' }],
  });

  const defaults = createDefaultCommandState();
  assert.equal(migrated.alliance.name, defaults.alliance.name);
  assert.equal(migrated.alliance.tag, defaults.alliance.tag);
  assert.equal(migrated.resourceRequests[0].amount, defaults.resourceRequests[0].amount);
  assert.equal(migrated.diplomacy[0].status, defaults.diplomacy[0].status);
  assert.equal(migrated.jointOperations[0].participants, defaults.jointOperations[0].participants);
});

test('alliance settings update is trimmed, bounded and deterministic', () => {
  const initial = createDefaultCommandState();
  const input = {
    name: '  Орбитальный Контур  ',
    tag: '  ok-7  ',
    motto: '  Держим линию.  ',
    description: '  Совместная координация внутренних систем.  ',
    emblem: { glyph: 'vanguard' as const, accent: 'amber' as const },
  };
  const first = updateAllianceSettings(initial, input);
  const second = updateAllianceSettings(initial, input);

  assert.deepEqual(first, second);
  assert.equal(first.alliance.name, 'Орбитальный Контур');
  assert.equal(first.alliance.tag, 'OK-7');
  assert.equal(first.alliance.motto, 'Держим линию.');
  assert.deepEqual(first.alliance.emblem, { glyph: 'vanguard', accent: 'amber' });
});

test('updated alliance settings persist and reload from the existing envelope', () => {
  const storage = new MemoryStorage();
  const updated = updateAllianceSettings(createDefaultCommandState(), {
    name: 'Союз Север',
    tag: 'NORTH',
    motto: 'Один вектор.',
    description: 'Локальная настройка прототипа.',
    emblem: { glyph: 'orbit', accent: 'violet' },
  });

  assert.equal(persistCommandState(updated, storage).ok, true);
  assert.deepEqual(readCommandState(storage), updated);
});

test('joining a shared operation changes only that operation and is idempotent', () => {
  const initial = createDefaultCommandState();
  const beforeOther = initial.jointOperations.find((item) => item.id === 'joint-mirage-evac');
  const joined = joinJointOperation(initial, 'joint-sun-raid');
  const joinedAgain = joinJointOperation(joined, 'joint-sun-raid');
  const sun = joined.jointOperations.find((item) => item.id === 'joint-sun-raid');

  assert.equal(sun?.joinedByPlayer, true);
  assert.equal(sun?.participants, 19);
  assert.deepEqual(joinedAgain, joined);
  assert.deepEqual(joined.jointOperations.find((item) => item.id === 'joint-mirage-evac'), beforeOther);
  assert.equal(initial.jointOperations.find((item) => item.id === 'joint-sun-raid')?.joinedByPlayer, false);
});

test('resource request action moves only an open request to reviewing', () => {
  const initial = createDefaultCommandState();
  const next = markResourceRequestReviewing(initial, 'request-tess-metal');

  assert.equal(next.resourceRequests.find((item) => item.id === 'request-tess-metal')?.state, 'reviewing');
  assert.equal(next.resourceRequests.find((item) => item.id === 'request-nora-gas')?.state, 'open');
});

test('member and resource request fixtures are internally valid', () => {
  const state = createDefaultCommandState();
  const memberIds = new Set(state.members.map((member) => member.id));
  const operationIds = new Set(state.jointOperations.map((operation) => operation.id));

  assert.equal(memberIds.size, state.members.length);
  assert.ok(memberIds.has(state.alliance.leaderMemberId));
  for (const request of state.resourceRequests) {
    assert.ok(memberIds.has(request.memberId));
    assert.ok(request.amount > 0);
    assert.ok(request.fulfilledAmount >= 0 && request.fulfilledAmount <= request.amount);
  }
  for (const member of state.members) {
    if (member.currentOperationId) assert.ok(operationIds.has(member.currentOperationId));
  }
});

test('diplomacy fixtures are valid and unique', () => {
  const relations = createDefaultCommandState().diplomacy;
  assert.equal(new Set(relations.map((relation) => relation.id)).size, relations.length);
  assert.equal(new Set(relations.map((relation) => relation.tag)).size, relations.length);
  assert.ok(relations.every((relation) => relation.history.length > 0 && relation.meaning.length > 0));
});

test('persisting command preserves unrelated save fields', () => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, JSON.stringify({
    schemaVersion: 4,
    metal: 777,
    combat: { reports: ['keep-me'] },
    operations: { items: ['keep-me-too'] },
  }));

  persistCommandState(joinJointOperation(createDefaultCommandState(), 'joint-sun-raid'), storage);
  const saved = JSON.parse(storage.getItem(SAVE_KEY) ?? '{}') as Record<string, unknown>;

  assert.equal(saved.schemaVersion, 4);
  assert.equal(saved.metal, 777);
  assert.deepEqual(saved.combat, { reports: ['keep-me'] });
  assert.deepEqual(saved.operations, { items: ['keep-me-too'] });
  assert.ok(saved.command);
});

test('reset returns the canonical default command state after mutations', () => {
  const mutated = markResourceRequestReviewing(
    joinJointOperation(createDefaultCommandState(), 'joint-sun-raid'),
    'request-tess-metal',
  );
  assert.notDeepEqual(mutated, createDefaultCommandState());
  assert.deepEqual(resetCommandState(), createDefaultCommandState());
});
