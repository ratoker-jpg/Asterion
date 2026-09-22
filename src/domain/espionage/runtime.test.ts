import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSeededEspionageRng,
  espionageRollSeed,
  hunterDetects,
  normalizeRngRoll,
  resolveSpyReportQuality,
} from './runtime.ts';
import { createBot01Planets, createDefaultBot01Profile } from './fixtures.ts';
import { calculateFleetPopulation } from '../fleet/runtime.ts';
import { calculateDefensePopulation } from '../fleet/production.ts';
import { migrateEspionageState } from './repository.ts';

test('spy report quality uses an integer 0..99 with lower-inclusive upper-exclusive intervals', () => {
  assert.equal(resolveSpyReportQuality(0, 0), 'full');
  assert.equal(resolveSpyReportQuality(0, 29), 'full');
  assert.equal(resolveSpyReportQuality(0, 30), 'detailed');
  assert.equal(resolveSpyReportQuality(0, 59), 'detailed');
  assert.equal(resolveSpyReportQuality(0, 60), 'basic');
  assert.equal(resolveSpyReportQuality(0, 99), 'basic');
});

test('spy quality applies every delta probability row with exact boundaries', () => {
  const rows: Array<[number, number, number, string, string]> = [
    [4, 90, 100, 'detailed', 'detailed'],
    [3, 75, 90, 'detailed', 'basic'],
    [2, 65, 85, 'detailed', 'basic'],
    [1, 40, 70, 'detailed', 'basic'],
    [0, 30, 60, 'detailed', 'basic'],
    [-1, 20, 45, 'detailed', 'basic'],
    [-2, 0, 20, 'detailed', 'basic'],
    [-3, 0, 10, 'detailed', 'basic'],
    [-4, 0, 0, 'basic', 'basic'],
  ];
  for (const [delta, fullBoundary, basicBoundary, detailedAt, basicAt] of rows) {
    if (fullBoundary > 0) assert.equal(resolveSpyReportQuality(delta, fullBoundary - 1), 'full');
    assert.equal(resolveSpyReportQuality(delta, fullBoundary), detailedAt);
    if (basicBoundary <= 99) assert.equal(resolveSpyReportQuality(delta, basicBoundary), basicAt);
    else assert.equal(resolveSpyReportQuality(delta, 99), basicAt);
  }
});

test('Hunter level 20 means a 35% detection interval', () => {
  assert.equal(hunterDetects(20, 34), true);
  assert.equal(hunterDetects(20, 35), false);
  assert.equal(hunterDetects(20, 99), false);
});

test('Bot 01 fixture keeps espionage level 10 and seeded converging population', () => {
  const planets = Object.values(createBot01Planets());
  const profile = createDefaultBot01Profile();
  assert.equal(planets.length, 7);
  const main = planets[0];
  assert.equal(main.espionageLevel, 10);
  assert.equal(main.hunterLevel, 20);
  assert.equal(main.commanders.hunter?.count, 1);
  assert.equal(main.commanders.judge?.count, 1);
  // Seeded total population: stable between resets, random-looking, 5k..25112.
  const totals = planets.map((planet) => planet.population.total);
  assert.equal(totals.every((total) => total >= 5_000 && total <= 25_112), true);
  assert.equal(new Set(totals).size > 1, true);
  // Population contract: planet population = fleet + defense, always converging.
  for (const planet of planets) {
    assert.equal(planet.population.total, planet.population.fleet + planet.population.defense);
    assert.equal(planet.population.fleet, calculateFleetPopulation(planet.fleet, planet.raceId));
    assert.equal(planet.population.defense, calculateDefensePopulation(planet.defense, planet.raceId));
    assert.equal(planet.fleet.ships['spy-probe'], 0);
    assert.ok((planet.defense.defenses['tower-shield'] ?? 0) <= 1);
    assert.ok((planet.defense.defenses['planetary-shield'] ?? 0) <= 1);
  }
  assert.equal(planets.slice(1).every((planet) => planet.hunterLevel === 0), true);
});

test('Bot 01 hull levels cover every upgradable ship with seeded 0..10 values', () => {
  const excluded = new Set(['solar-satellite', 'spy-probe', 'colonizer', 'recycler']);
  const planets = Object.values(createBot01Planets());
  const profile = createDefaultBot01Profile();
  for (const planet of planets) {
    for (const [id, count] of Object.entries(planet.fleet.ships)) {
      if (!count || count <= 0) continue;
      if (excluded.has(id)) {
        continue;
      }
      const level = profile.shipLevels[id as keyof typeof profile.shipLevels];
      assert.notEqual(level, undefined);
      assert.equal(Number.isInteger(level) && level! >= 0 && level! <= 10, true);
    }
  }
  // The same owner profile is shared by every Bot 01 planet.
  assert.equal(planets.every((planet) => planet.shipLevels === undefined), true);
  assert.equal(profile.shipLevels.transporter, 5);
  assert.equal(profile.shipLevels['mega-transporter'], 6);
  assert.equal(profile.shipLevels.cruiser, 4);
  assert.equal(profile.shipLevels.battleship, 2);
});

test('target debris migrates from the legacy mirror into resources.debris exactly once', () => {
  const migrated = migrateEspionageState({
    targets: {
      legacy: {
        id: 'legacy',
        coordinate: { galaxy: 1, system: 1, position: 2 },
        resources: { metal: 10, minerals: 20, gas: 30, developmentEnergy: 0 },
        debris: 77,
      },
    },
  }, 1_000);
  const target = migrated.targets?.legacy;
  assert.ok(target);
  assert.equal(target.resources.debris, 77);
  assert.equal(target.debris, undefined);
});

test('generic target migrations promote legacy ship levels into one owner profile', () => {
  const migrated = migrateEspionageState({
    targets: {
      player: {
        id: 'player-planet',
        coordinate: { galaxy: 1, system: 2, position: 3 },
        ownerId: 'player-owner',
        ownerName: 'Player',
        raceId: 'aegis',
        alliance: null,
        espionageLevel: 4,
        resources: { metal: 1, minerals: 1, gas: 1, debris: 0, developmentEnergy: 0 },
        buildings: {},
        fleet: { ships: { scout: 2 }, commanders: {} },
        defense: { defenses: {} },
        commanders: {},
        population: { total: 4, fleet: 4, defense: 0 },
        hunterLevel: 0,
        shipLevels: { scout: 4 },
      },
    },
  }, 1_000);
  const target = migrated.targets?.player;
  assert.ok(target);
  assert.equal(target.shipLevels, undefined);
  assert.equal(target.ownerProfile?.shipLevels.scout, 4);
  assert.equal(migrated.bot01Profile, undefined);
});

test('seeded espionage rng replays the same stream for the same seed and stays within [0, 1)', () => {
  const first = createSeededEspionageRng(espionageRollSeed('spy-seed-a', 'report', 1));
  const second = createSeededEspionageRng(espionageRollSeed('spy-seed-a', 'report', 1));
  const streamA = Array.from({ length: 32 }, () => first());
  const streamB = Array.from({ length: 32 }, () => second());
  assert.deepEqual(streamA, streamB);
  assert.equal(streamA.every((value) => Number.isFinite(value) && value >= 0 && value < 1), true);
});

test('seeded espionage rng separates streams by mission, roll kind, and attempt', () => {
  const base = createSeededEspionageRng(espionageRollSeed('spy-seed-a', 'hunter', 1));
  const streams = [
    createSeededEspionageRng(espionageRollSeed('spy-seed-a', 'report', 1)),
    createSeededEspionageRng(espionageRollSeed('spy-seed-b', 'hunter', 1)),
    createSeededEspionageRng(espionageRollSeed('spy-seed-a', 'hunter', 2)),
  ];
  const baseStream = Array.from({ length: 8 }, () => base());
  for (const stream of streams) {
    assert.notDeepEqual(Array.from({ length: 8 }, () => stream()), baseStream);
  }
});

test('roll seed contract is stable per mission, kind, and 1-based attempt', () => {
  assert.equal(espionageRollSeed('spy-seed-a', 'hunter', 1), 'espionage:spy-seed-a:hunter:1');
  assert.equal(espionageRollSeed('spy-seed-a', 'report', 2), 'espionage:spy-seed-a:report:2');
  assert.equal(espionageRollSeed('spy-seed-a', 'report', 0), espionageRollSeed('spy-seed-a', 'report', 1));
  assert.equal(espionageRollSeed('spy-seed-a', 'report', Number.NaN), espionageRollSeed('spy-seed-a', 'report', 1));
});

test('seeded stream materializes into the canonical reproducible 0..99 roll', () => {
  const materialize = () => {
    const rng = createSeededEspionageRng(espionageRollSeed('spy-seed-a', 'report', 1));
    const raw = rng();
    return raw >= 0 && raw < 1 ? Math.floor(raw * 100) : normalizeRngRoll(raw);
  };
  assert.equal(materialize(), materialize());
  assert.equal(Number.isInteger(materialize()), true);
  assert.equal(materialize() >= 0 && materialize() <= 99, true);
});
