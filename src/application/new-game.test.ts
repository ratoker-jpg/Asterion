import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateFleetPopulation } from '../domain/fleet/runtime.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { generateWorld, isGeneratedNpcOwnerId } from '../domain/world/generator.ts';
import { createInitialSaveState, createPersistenceFacade, SAVE_SCHEMA_VERSION } from './persistence.ts';

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

const NOW = Date.UTC(2026, 9, 20);

test('a new production campaign is built from the wizard config', () => {
  const config = { ...createDefaultNewGameConfig({ seed: 'NEWGAME1', factionId: 'synod', playerName: 'Илар Тест' }), world: { ...createDefaultNewGameConfig().world, galaxyCount: 3, npcCount: 25 } };
  const state = createInitialSaveState('production', NOW, config);
  const world = generateWorld(config, NOW);
  const home = state.planets['helion-01']!;
  assert.equal(state.profile.factionId, 'synod');
  assert.equal(state.profile.displayName, 'Илар Тест');
  assert.deepEqual({ galaxy: home.universeGalaxy, system: home.universeSystem, position: home.universePosition }, world.playerStart);
  assert.equal(Object.values(state.espionage!.targets!).filter((target) => isGeneratedNpcOwnerId(target.ownerId)).length, 25);
  assert.equal(state.worldConfig?.world.galaxyCount, 3);
  assert.equal(state.schemaVersion, SAVE_SCHEMA_VERSION);
  // Starting values are untouched by the wizard.
  assert.equal(state.metal, 15_880);
});

test('the saved race survives save → load (it was forced back to Астеры before)', () => {
  for (const factionId of ['aegis', 'synod', 'veyra'] as const) {
    const storage = memoryStorage();
    const facade = createPersistenceFacade({ mode: 'production', storage, now: () => NOW });
    const state = createInitialSaveState('production', NOW, createDefaultNewGameConfig({ seed: `RACE${factionId.toUpperCase()}`, factionId, playerName: 'Командир' }));
    assert.equal(facade.write(state).ok, true);
    const loaded = facade.read();
    assert.equal(loaded.profile.factionId, factionId);
    // Generated NPC stubs are not filtered out on write (only the Test Mode Bot 01 is).
    assert.equal(Object.keys(loaded.espionage?.targets ?? {}).length, Object.keys(state.espionage?.targets ?? {}).length);
    assert.equal(loaded.worldConfig?.seed, state.worldConfig?.seed);
  }
});

test('a pre-wizard save loads into the legacy world without losing data', () => {
  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'production', storage, now: () => NOW });
  const legacy = createInitialSaveState('production', NOW) as unknown as Record<string, unknown>;
  delete legacy.worldConfig;
  delete legacy.sunRaid;
  delete legacy.playTimeMs;
  const planets = legacy.planets as Record<string, Record<string, unknown>>;
  planets['helion-01'] = { ...planets['helion-01'], name: 'Старый Гелион', resources: { metal: 4_321, minerals: 1, gas: 2 } };
  storage.setItem(facade.saveKey, JSON.stringify({ ...legacy, planets, schemaVersion: 23 }));
  const loaded = facade.read();
  assert.equal(loaded.worldConfig?.legacy, true);
  assert.equal(loaded.worldConfig?.world.galaxyCount, 1);
  assert.equal(loaded.metal, 4_321);
  assert.equal(loaded.planets['helion-01']!.name, 'Старый Гелион');
  assert.deepEqual(loaded.sunRaid?.raids, []);
  assert.equal(loaded.schemaVersion, SAVE_SCHEMA_VERSION);
});

test('each race starts with its own canonical roster (Рой: 40 scouts)', () => {
  const populations = (['aegis', 'synod', 'veyra'] as const).map((factionId) => {
    const state = createInitialSaveState('production', NOW, createDefaultNewGameConfig({ seed: 'ROSTER01', factionId, playerName: 'Командир' }));
    const fleet = state.planets['helion-01']!.fleet;
    return { factionId, scouts: fleet.ships.scout, population: calculateFleetPopulation(fleet, factionId) };
  });
  assert.deepEqual(populations.map((item) => item.scouts), [20, 20, 40]);
  for (const item of populations) assert.ok(item.population > 0);
});

test('Test Mode ignores the wizard world and keeps its fixtures', () => {
  const state = createInitialSaveState('test', NOW, createDefaultNewGameConfig({ seed: 'TESTMODE', factionId: 'veyra', playerName: 'Тест' }));
  assert.equal(state.planets['helion-01']!.universeSystem, 1);
  assert.equal(state.worldConfig?.legacy, true);
  assert.ok(Object.values(state.espionage!.targets!).some((target) => target.ownerId === 'npc-bot-01'));
});
