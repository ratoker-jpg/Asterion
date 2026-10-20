import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultNewGameConfig,
  createLegacyWorldConfig,
  getWorldNpcCapacity,
  normalizeNewGameConfig,
  validateNewGameConfig,
  type NewGameConfig,
} from './config.ts';
import { generateWorld, isGeneratedNpcOwnerId, summarizeWorld } from './generator.ts';
import { CAMPAIGN_SPEED_SCALE, getCampaignTimeScale, scaleRuntimeDuration, setCampaignTimeScale } from '../runtime/mode.ts';

function config(patch: Partial<NewGameConfig['world']> = {}, seed = 'SEED1234'): NewGameConfig {
  const base = createDefaultNewGameConfig({ seed, factionId: 'synod', playerName: 'Тестер' });
  return { ...base, world: { ...base.world, ...patch } };
}

test('the same seed always generates the same world', () => {
  const first = generateWorld(config({ npcCount: 40, galaxyCount: 3 }), 1_000);
  const second = generateWorld(config({ npcCount: 40, galaxyCount: 3 }), 1_000);
  assert.deepEqual(second, first);
  const other = generateWorld(config({ npcCount: 40, galaxyCount: 3 }, 'OTHER777'), 1_000);
  assert.notDeepEqual(other.npcPlanets.map((planet) => planet.coordinate), first.npcPlanets.map((planet) => planet.coordinate));
});

test('NPC stubs respect the per-system limit, never sit on the player and never repeat a coordinate', () => {
  for (const maxNpcPerSystem of [1, 2, 3] as const) {
    for (const density of ['sparse', 'standard', 'dense'] as const) {
      const world = generateWorld(config({ npcCount: 100, galaxyCount: 2, maxNpcPerSystem, density }), 0);
      assert.equal(world.npcPlanets.length, 80 * maxNpcPerSystem >= 100 ? 100 : 80 * maxNpcPerSystem);
      const perSystem = new Map<string, number>();
      const seen = new Set<string>();
      const playerKey = `${world.playerStart.galaxy}:${world.playerStart.system}:${world.playerStart.position}`;
      for (const planet of world.npcPlanets) {
        const key = `${planet.coordinate.galaxy}:${planet.coordinate.system}:${planet.coordinate.position}`;
        assert.ok(!seen.has(key), 'unique coordinate');
        assert.notEqual(key, playerKey);
        seen.add(key);
        const systemKey = `${planet.coordinate.galaxy}:${planet.coordinate.system}`;
        perSystem.set(systemKey, (perSystem.get(systemKey) ?? 0) + 1);
        assert.ok(isGeneratedNpcOwnerId(planet.ownerId));
        assert.ok(planet.coordinate.galaxy >= 1 && planet.coordinate.galaxy <= 2);
        assert.ok(['aegis', 'synod', 'veyra'].includes(planet.raceId));
      }
      assert.ok(Math.max(...perSystem.values()) <= maxNpcPerSystem);
    }
  }
});

test('dense worlds cluster NPCs, sparse worlds spread them', () => {
  const sparse = generateWorld(config({ npcCount: 30, maxNpcPerSystem: 3, density: 'sparse' }), 0);
  const dense = generateWorld(config({ npcCount: 30, maxNpcPerSystem: 3, density: 'dense' }), 0);
  const systems = (planets: typeof sparse.npcPlanets) => new Set(planets.map((planet) => planet.coordinate.system)).size;
  assert.ok(systems(sparse.npcPlanets) > systems(dense.npcPlanets));
});

test('random start picks a coordinate inside the world; fixed start stays [1:1:1]', () => {
  const random = generateWorld(config({ galaxyCount: 4 }), 0).playerStart;
  assert.ok(random.galaxy >= 1 && random.galaxy <= 4 && random.system >= 1 && random.system <= 40 && random.position >= 1 && random.position <= 24);
  assert.deepEqual(generateWorld(config({ randomPlayerStart: false }), 0).playerStart, { galaxy: 1, system: 1, position: 1 });
});

test('wizard validation: names, seed and NPC capacity', () => {
  assert.deepEqual(validateNewGameConfig(config()), []);
  assert.equal(getWorldNpcCapacity({ galaxyCount: 1, maxNpcPerSystem: 1 }), 40);
  assert.ok(validateNewGameConfig(config({ npcCount: 100, maxNpcPerSystem: 1 })).some((issue) => issue.field === 'npcCount'));
  assert.ok(validateNewGameConfig({ ...config(), playerName: 'Ab' }).some((issue) => issue.field === 'playerName'));
  assert.ok(validateNewGameConfig({ ...config(), seed: 'бад' }).some((issue) => issue.field === 'seed'));
  const summary = summarizeWorld(config({ galaxyCount: 2, npcCount: 20 }));
  assert.equal(summary.systems, 80);
  assert.equal(summary.planetSlots, 80 * 24);
  assert.equal(summary.suns, 80);
});

test('persisted configs are normalized; garbage falls back to the legacy world', () => {
  const legacy = createLegacyWorldConfig('veyra', 'Рой-1');
  assert.deepEqual(normalizeNewGameConfig(undefined, legacy), legacy);
  const clamped = normalizeNewGameConfig({ ...config(), world: { ...config().world, galaxyCount: 99, npcCount: 500, maxNpcPerSystem: 1 } }, legacy);
  assert.equal(clamped.world.galaxyCount, 10);
  assert.equal(clamped.world.npcCount, 100);
  assert.deepEqual(normalizeNewGameConfig(JSON.parse(JSON.stringify(config())), legacy), config());
});

test('campaign speed scales production timers; standard is unchanged', () => {
  const previous = getCampaignTimeScale();
  try {
    setCampaignTimeScale(CAMPAIGN_SPEED_SCALE.standard);
    assert.equal(scaleRuntimeDuration(3_600_000, 'production'), 3_600_000);
    assert.equal(scaleRuntimeDuration(1.4, 'production'), 1);
    setCampaignTimeScale(CAMPAIGN_SPEED_SCALE.fast);
    assert.equal(scaleRuntimeDuration(3_600_000, 'production'), 1_800_000);
    setCampaignTimeScale(CAMPAIGN_SPEED_SCALE.slow);
    assert.equal(scaleRuntimeDuration(3_600_000, 'production'), 7_200_000);
    assert.equal(scaleRuntimeDuration(3_600_000, 'test', 10), 360_000, 'Test Mode keeps its own selector');
  } finally {
    setCampaignTimeScale(previous);
  }
});
