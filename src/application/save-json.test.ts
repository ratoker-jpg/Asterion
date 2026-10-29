import assert from 'node:assert/strict';
import test from 'node:test';
import { stringifySave, stringifySaveInSlices } from './save-json.ts';
import { createInitialSaveState, serializeSaveForStorage } from './persistence.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';

const awkward = {
  a: 1, skipped: undefined, fn: () => 1, nan: Number.NaN, text: 'quote " and  ',
  list: [undefined, () => 1, null, [1, [2, [3, { deep: [4, undefined] }]]], { at: new Date(Date.UTC(2026, 0, 1)) }],
  nested: { level: { entries: [{ id: 'x', value: -0 }, { id: 'y', inner: { v: [true, false] } }] } },
  '': 'empty key', 'ключ': 'значение',
};

test('a save stringifies exactly like JSON.stringify, also after unchanged parts are reused', () => {
  assert.equal(stringifySave(awkward), JSON.stringify(awkward));
  const state = createInitialSaveState('production', Date.UTC(2026, 0, 1));
  assert.equal(stringifySave(state), JSON.stringify(state));
  // An update copies the path it changes: the copy's new text, the rest reused.
  const next = { ...state, profile: { ...state.profile, name: 'Другое имя' } };
  assert.equal(stringifySave(next), JSON.stringify(next));
  assert.equal(stringifySave(state), JSON.stringify(state));
});

test('the sliced serialization gives the same text as the one-step one', async () => {
  const state = createInitialSaveState('production', Date.UTC(2026, 0, 1));
  let pauses = 0;
  const { text } = await stringifySaveInSlices(state, 0, async () => { pauses += 1; });
  assert.equal(text, JSON.stringify(state));
  assert.ok(pauses > 0, 'a zero budget pauses between steps');
  assert.equal(serializeSaveForStorage(state, 'production'), JSON.stringify({ ...state, espionage: { ...state.espionage,
    targets: Object.fromEntries(Object.entries(state.espionage?.targets ?? {}).filter(([, target]) => target.ownerId !== UNIVERSE_NPC_OWNER_ID)),
    bot01Planets: undefined, bot01Profile: undefined, bot01IncomingScenario: undefined }, saveWriter: 1 }));
});
