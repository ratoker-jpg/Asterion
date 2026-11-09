import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createInitialSaveState, serializeSaveForStorage } from '../src/application/persistence.ts';
import { createColonyPlanetRuntime } from '../src/application/owned-planets.ts';
import { getEspionageTargets } from '../src/domain/espionage/runtime.ts';
import { COMPUTER_SYSTEMS_SCIENCE_ID } from '../src/domain/flights/limit.ts';

// Synthetic worst-case screen input (never a user save): four own planets with huge fleets for the
// quick-send waves screenshots. Usage: node --experimental-strip-types tools/generate-preview-waves-fixture.mjs out.json
const output = process.argv[2];
assert.ok(output, 'Output JSON path required');
let state = createInitialSaveState('test', Date.now());
const homeId = state.currentPlanetId;
const home = state.planets[homeId];
const homeSystem = home.universeSystem ?? 1;
const taken = new Set(Object.values(getEspionageTargets(state.espionage)).map((t) => `${t.coordinate.galaxy}:${t.coordinate.system}:${t.coordinate.position}`));
const free = (system) => {
  for (let position = 1; position <= 15; position += 1) {
    if (!taken.has(`${home.universeGalaxy ?? 1}:${system}:${position}`) && !(system === homeSystem && position === home.universePosition)) return position;
  }
  return null;
};
const huge = { metal: 987_654_321, minerals: 876_543_210, gas: 765_432_109 };
state.planets[homeId] = { ...home, name: 'Гелион Прайм — столица империи', resources: huge, buildings: { ...home.buildings, hangar: 30 },
  fleet: { ...home.fleet, ships: { ...home.fleet.ships, cruiser: 1_234_567, battleship: 456_789, transporter: 0 } } };
const colonies = [
  ['wave-colony-a', homeSystem + 3 <= 40 ? homeSystem + 3 : homeSystem - 3, 'Северный бастион Аурелия-Прайм', { 'mega-transporter': 2_345_678, transporter: 9_876_543 }],
  ['wave-colony-b', homeSystem + 9 <= 40 ? homeSystem + 9 : homeSystem - 9, 'Колония', { recycler: 3_456_789 }],
  ['wave-colony-c', homeSystem + 17 <= 40 ? homeSystem + 17 : homeSystem - 17, 'Дальний форпост на краю галактики', { cruiser: 765_432, 'mega-transporter': 123_456 }],
  // The «Дислокация» target the four waves fly to.
  ['wave-target', homeSystem + 6 <= 40 ? homeSystem + 6 : homeSystem - 6, 'Точка сбора', {}],
];
for (const [id, system, name, ships] of colonies) {
  const position = free(system);
  assert.ok(position, `no free slot in system ${system}`);
  const planet = createColonyPlanetRuntime(state, { galaxy: home.universeGalaxy ?? 1, system, position });
  state.planets[id] = { ...planet, name, resources: huge, buildings: { ...planet.buildings, hangar: 30 }, fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, ...ships } } };
}
state.science = { ...state.science, levels: { ...state.science.levels, [COMPUTER_SYSTEMS_SCIENCE_ID]: 15 } };
await writeFile(output, serializeSaveForStorage(state, 'test'));
const target = Object.values(getEspionageTargets(state.espionage)).find((t) => t.ownerId !== state.profile.playerId);
console.log(JSON.stringify({ home: homeId, homeSystem, colonies: colonies.map((c) => [c[0], c[1]]), sampleTarget: target?.coordinate }));
