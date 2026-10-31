import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultNewGameConfig,
  createLegacyWorldConfig,
  getWorldNpcCapacity,
  maxNpcForSpeed,
  WORLD_LIMITS,
  normalizeNewGameConfig,
  validateNewGameConfig,
  type NewGameConfig,
} from './config.ts';
import { generateWorld, isGeneratedNpcOwnerId, summarizeWorld } from './generator.ts';
import { CANONICAL_STARTING_WALLET } from './start.ts';
import { createCanonicalStartingBuildingLevels } from '../buildings/resource-zone.ts';
import { calculateFleetCapacity, calculateFleetPopulation, createCanonicalStartingFleet } from '../fleet/runtime.ts';
import { calculateDefensePopulation, createEmptyDefenseState } from '../fleet/production.ts';
import { createDefaultScienceState } from '../science/runtime.ts';
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

test('100 NPC starts match canonical player wallet, buildings, and race fleet within Hangar 1', () => {
  const world = generateWorld({
    ...config({ npcCount: 100, galaxyCount: 4 }),
    npcFactions: { aegis: 34, synod: 33, veyra: 33 },
  }, 0);
  const startingBuildings = createCanonicalStartingBuildingLevels();
  const emptyDefense = createEmptyDefenseState();

  assert.equal(world.npcPlanets.length, 100);
  assert.deepEqual(new Set(world.npcPlanets.map((planet) => planet.raceId)), new Set(['aegis', 'synod', 'veyra']));
  assert.equal(createDefaultScienceState().levels[5], 0, 'the player starts with zero espionage science');
  for (const planet of world.npcPlanets) {
    assert.equal(planet.espionageLevel, 0, 'new NPC targets have no hidden starting espionage defense');
    assert.deepEqual(planet.resources, {
      metal: CANONICAL_STARTING_WALLET.metal,
      minerals: CANONICAL_STARTING_WALLET.minerals,
      gas: CANONICAL_STARTING_WALLET.gas,
      developmentEnergy: CANONICAL_STARTING_WALLET.energy,
      debris: 0,
    });
    assert.deepEqual(planet.buildings, startingBuildings);
    assert.deepEqual(planet.fleet, createCanonicalStartingFleet(planet.raceId));
    assert.deepEqual(planet.defense, emptyDefense);
    assert.equal(planet.population.fleet, calculateFleetPopulation(planet.fleet, planet.raceId));
    assert.equal(planet.population.defense, 0);
    assert.equal(calculateDefensePopulation(planet.defense, planet.raceId), 0);
    assert.ok(planet.population.fleet <= calculateFleetCapacity(planet.buildings.hangar));
    assert.equal(planet.buildings.hangar, 1, 'starting capacity comes from the canonical Hangar 1');
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

test('a fixed NPC race mix gives exact shares; random stays seeded', async () => {
  const { normalizeNpcFactionMix, setNpcFactionShare } = await import('./config.ts');
  const mixed = { ...config({ npcCount: 50 }), npcFactions: { aegis: 20, synod: 0, veyra: 80 } };
  const world = generateWorld(mixed, 0);
  const count = (race: string) => world.npcPlanets.filter((planet) => planet.raceId === race).length;
  assert.equal(count('aegis'), 10);
  assert.equal(count('synod'), 0);
  assert.equal(count('veyra'), 40);
  assert.deepEqual(generateWorld(mixed, 0), world, 'deterministic');
  assert.deepEqual(normalizeNpcFactionMix({ aegis: 1, synod: 1, veyra: 1 }), { aegis: 34, synod: 33, veyra: 33 });
  assert.equal(normalizeNpcFactionMix({ aegis: 0, synod: 0, veyra: 0 }), null);
  const moved = setNpcFactionShare({ aegis: 34, synod: 33, veyra: 33 }, 'veyra', 60);
  assert.equal(moved.veyra, 60);
  assert.equal(moved.aegis + moved.synod + moved.veyra, 100);
});

test('«Супербыстрая» ×5 holds at most 50 NPC (owner decision 31.10.2026)', () => {
  assert.equal(CAMPAIGN_SPEED_SCALE.superfast, 5);
  assert.equal(maxNpcForSpeed('superfast'), 50);
  assert.equal(maxNpcForSpeed('fast'), WORLD_LIMITS.npcMax);
  const base = createDefaultNewGameConfig({ seed: 'SUPERFAST1' });
  const fast = normalizeNewGameConfig({ ...base, world: { ...base.world, galaxyCount: 2, npcCount: 100, campaignSpeed: 'fast' } }, base);
  assert.equal(fast.world.npcCount, 100, 'a ×2 world of 100 NPC is unchanged');
  const superfast = normalizeNewGameConfig({ ...base, world: { ...base.world, galaxyCount: 2, npcCount: 100, campaignSpeed: 'superfast' } }, base);
  assert.equal(superfast.world.campaignSpeed, 'superfast');
  assert.equal(superfast.world.npcCount, 50);
  assert.ok(validateNewGameConfig({ ...base, world: { ...base.world, galaxyCount: 2, npcCount: 60, campaignSpeed: 'superfast' } })
    .some((issue) => issue.field === 'npcCount' && /50/.test(issue.message)));
});
