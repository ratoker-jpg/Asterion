import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPACT_SECTION_MARK, decodeCompactSave, decodeSection, encodeSection, hasCompactSections } from './save-codec.ts';

function roundTrip(value: unknown): unknown {
  return decodeSection(JSON.parse(encodeSection(value)));
}

test('a section comes back exactly as JSON would carry it: values, key order, JSON edge cases', () => {
  const value = {
    reports: [
      { id: 'a', ownerId: 'npc-1', createdAt: 1, fleet: { scout: 0, cruiser: 3 }, firstReport: true },
      { ownerId: 'npc-2', id: 'b', createdAt: 2.5, fleet: {}, note: null },
      { id: 'c', skipped: undefined, fn: () => 1, nested: [[1, 2], [], [{ x: -0 }]], big: 1e21, nan: Number.NaN, inf: -Infinity },
    ],
    '10': 'numeric keys first', b: [undefined, 'x', () => 0],
    map: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`target-${index}`, { level: index / 3 }])),
    text: 'quotes " and \\ and \u0001 and юникод',
    date: new Date(Date.UTC(2026, 0, 1)),
  };
  const decoded = roundTrip(value);
  assert.equal(JSON.stringify(decoded), JSON.stringify(value));
  assert.deepEqual(Object.keys(decoded as object), Object.keys(JSON.parse(JSON.stringify(value))));
});

test('"__proto__" stays an own field, as JSON.parse keeps it', () => {
  const value = JSON.parse('{"list":[{"__proto__":{"polluted":true},"a":1}]}');
  const decoded = roundTrip(value) as { list: Record<string, unknown>[] };
  assert.equal(Object.getPrototypeOf(decoded.list[0]), Object.prototype);
  assert.deepEqual(Object.keys(decoded.list[0]!), ['__proto__', 'a']);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('text is a pure function of the value: the same world encodes to the same bytes, cached or not', () => {
  const make = () => ({ records: Array.from({ length: 50 }, (_, index) => ({ id: `f-${index}`, phase: index % 2 ? 'outbound' : 'completed', at: index })) });
  const first = make();
  const once = encodeSection(first);
  assert.equal(encodeSection(first), once, 'cached text');
  assert.equal(encodeSection(make()), once, 'fresh objects, same text');
  // A change re-encodes only that record and stays equal to a fresh encoding.
  const changed = { records: first.records.map((record, index) => (index === 7 ? { ...record, phase: 'returning' } : record)) };
  const fresh = make();
  fresh.records[7] = { ...fresh.records[7]!, phase: 'returning' };
  assert.equal(encodeSection(changed), encodeSection(fresh));
});

test('field names are stored once per section, not once per record', () => {
  const records = Array.from({ length: 1_000 }, (_, index) => ({ identifier: index, ownerIdentifier: 'npc', destinationPlanetIdentifier: 'p' }));
  const plain = JSON.stringify({ records });
  const compact = encodeSection({ records });
  assert.ok(compact.length < plain.length * 0.4, `${compact.length} vs ${plain.length}`);
  assert.equal((compact.match(/destinationPlanetIdentifier/g) ?? []).length, 1);
});

test('a parsed save decodes its compact sections in place and leaves plain ones', () => {
  const save = JSON.parse(`{"schemaVersion":29,"combat":{"reports":[]},"flights":${encodeSection({ records: [{ id: 'x' }], requestIndex: {} })}}`);
  assert.equal(hasCompactSections(JSON.stringify(save)), true);
  assert.equal(decodeCompactSave(save), save);
  assert.deepEqual(save, { schemaVersion: 29, combat: { reports: [] }, flights: { records: [{ id: 'x' }], requestIndex: {} } });
  assert.equal((save.flights as Record<string, unknown>)[COMPACT_SECTION_MARK], undefined);
});

test('a broken table is an error, never a silently different world', () => {
  const broken = JSON.parse(encodeSection({ a: 1, b: 2 }));
  broken.s = [];
  assert.throws(() => decodeSection(broken), /unknown shape/);
  assert.throws(() => decodeSection({ $c: 1, s: [], v: { raw: 'object' } }), /outside the encoding/);
});
