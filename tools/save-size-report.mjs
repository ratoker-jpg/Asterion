// Size of a world as this build stores it: loads each fixture through the
// production loader (old saves shed expired reports there) and prints the
// plain and compact sizes of the biggest sections.
//   node --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs tools/save-size-report.mjs FIXTURE...
import fs from 'node:fs';
import { loadSavedState, serializeSaveForStorage } from '../src/application/persistence.ts';
import { encodeSection } from '../src/domain/session/save-codec.ts';

const out = [];
for (const file of process.argv.slice(2)) {
  const raw = fs.readFileSync(file, 'utf8');
  const storage = { getItem: () => raw, setItem() {}, removeItem() {} };
  const parsedAt = JSON.parse(raw).npcReplay?.processedThroughAt ?? Date.now();
  const t0 = performance.now();
  const loaded = loadSavedState({ mode: 'production', storage, saveKey: 'k', now: () => parsedAt });
  const loadMs = performance.now() - t0;
  if (loaded.status !== 'loaded') throw new Error(`${file}: ${loaded.status}`);
  const state = loaded.state;
  const t1 = performance.now();
  const text = serializeSaveForStorage(state, 'production');
  const saveMs = performance.now() - t1;
  const sections = {};
  for (const [key, value] of Object.entries(state)) {
    const plain = JSON.stringify(value)?.length ?? 0;
    if (plain < 200_000) continue;
    sections[key] = { plain, compact: value && typeof value === 'object' ? encodeSection(value).length : plain };
  }
  out.push({ file, inputChars: raw.length, plainChars: JSON.stringify(state).length, savedChars: text.length,
    loadMs: Math.round(loadMs), serializeMs: Math.round(saveMs),
    spyReports: state.espionage?.reports.length, battleReports: state.combat.reports.length, flights: state.flights.records.length, sections });
  process.stderr.write(`${JSON.stringify(out.at(-1))}\n`);
}
console.log(JSON.stringify(out, null, 2));
