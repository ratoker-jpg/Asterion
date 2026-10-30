// A small production campaign for electron/cloud-world-qa.cjs (CI): one
// galaxy, a few NPC, written as the game stores it.
//   node --experimental-strip-types tools/cloud-qa-world.mjs <out.json> [npcCount=6] [startAt=ms]
import fs from 'node:fs';
import { createInitialSaveState, serializeSaveForStorage } from '../src/application/persistence.ts';
import { createDefaultNewGameConfig } from '../src/domain/world/config.ts';

const [out, npcCount = '6', startAt = String(Date.now())] = process.argv.slice(2);
const base = createDefaultNewGameConfig({ seed: 'CLOUD-WORLD-QA', factionId: 'aegis', playerName: 'Облачный QA', campaignName: 'Облачный мир QA' });
const setup = { ...base, world: { ...base.world, galaxyCount: 1, npcCount: Number(npcCount) } };
fs.writeFileSync(out, serializeSaveForStorage(createInitialSaveState('production', Number(startAt), setup), 'production'));
