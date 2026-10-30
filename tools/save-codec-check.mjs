// Compact save format on real worlds: exact round trip, size, time.
//   node --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs tools/save-codec-check.mjs FIXTURE...
// Each fixture is plain SaveState JSON (late-game-catchup generate). Prints
// JSON: plain vs compact characters, encode (cold/warm) and parse times.
import fs from 'node:fs';
import { stringifySave, stringifyCompactSave } from '../src/application/save-json.ts';
import { decodeCompactSave } from '../src/domain/session/save-codec.ts';
import { serializeSaveForStorage, loadSavedState } from '../src/application/persistence.ts';

const time = (fn) => { const t0 = performance.now(); const value = fn(); return [value, performance.now() - t0]; };
const results = [];
for (const file of process.argv.slice(2)) {
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const [plain, plainMs] = time(() => stringifySave(state));
  const [compact, coldMs] = time(() => stringifyCompactSave(state));
  // A tick changes one record: the warm encode reuses everything else.
  const touched = { ...state, flights: { ...state.flights, records: [...state.flights.records.slice(0, -1), { ...state.flights.records.at(-1) }] } };
  const [, warmMs] = time(() => stringifyCompactSave(touched));
  const [decoded, compactParseMs] = time(() => decodeCompactSave(JSON.parse(compact)));
  const [, plainParseMs] = time(() => JSON.parse(plain));
  const exact = JSON.stringify(decoded) === plain;
  if (!exact) throw new Error(`${file}: the compact round trip differs`);
  // The full load path (health check, migration, prune) on the production text.
  const text = serializeSaveForStorage(state, 'production');
  const storage = { getItem: () => text, setItem() {}, removeItem() {} };
  const [loaded, loadMs] = time(() => loadSavedState({ mode: 'production', storage, saveKey: 'k', now: () => state.npcReplay.processedThroughAt }));
  if (loaded.status !== 'loaded') throw new Error(`${file}: ${loaded.status} ${loaded.problem?.reason}`);
  results.push({ file, plainChars: plain.length, compactChars: compact.length, ratio: +(compact.length / plain.length).toFixed(3),
    plainStringifyMs: Math.round(plainMs), compactEncodeColdMs: Math.round(coldMs), compactEncodeWarmMs: Math.round(warmMs),
    plainParseMs: Math.round(plainParseMs), compactParseDecodeMs: Math.round(compactParseMs), productionLoadMs: Math.round(loadMs), exact });
  process.stderr.write(`${JSON.stringify(results.at(-1))}\n`);
}
console.log(JSON.stringify(results, null, 2));
