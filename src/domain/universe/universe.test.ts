import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANOMALY_INITIAL_SPAWN_CHANCE,
  ANOMALY_MAX_LIFETIME_MS,
  ANOMALY_MIN_LIFETIME_MS,
  ANOMALY_QUIET_MS,
  ANOMALY_SPAWN_CHANCE_STEP,
  ASTEROID_MAX_DWELL_MS,
  ASTEROID_MIN_DWELL_MS,
  ASTEROID_SCHEDULE_EPOCH_MS,
  ASTEROID_GAS_MAX,
  ASTEROID_GAS_MIN,
  GALAXY,
  MAX_PLANETS_PER_OWNER,
  PIRATE_MAX_LIFETIME_MS,
  PIRATE_MIN_LIFETIME_MS,
  PIRATE_QUIET_MS,
  POSITION_COUNT,
  SYSTEM_COUNT,
  UNIQUE_INITIAL_SPAWN_CHANCE,
  UNIQUE_MAX_LIFETIME_MS,
  UNIQUE_MIN_LIFETIME_MS,
  UNIQUE_QUIET_MS,
  UNIQUE_SPAWN_CHANCE_STEP,
  advanceUniverseAsteroidCoordinate,
  createUniverseMap,
  createUniverseNpcOwnerProfile,
  createUniverseSystem,
  enforceUniversePlanetLimit,
  formatUniverseCoordinate,
  getUniverseActionState,
  getUniverseAsteroidDwellMs,
  getUniverseAsteroidState,
  getUniverseNodeCaption,
  getUniverseSlotPoint,
  getUniverseTimedObjectSchedule,
  UNIVERSE_NPC_OWNER_ID,
} from './runtime.ts';
import type { UniversePlanetNode } from './types.ts';

test('planet coordinates remain unchanged while asteroid clock advances', () => {
  const points = Array.from({ length: POSITION_COUNT }, (_, index) => getUniverseSlotPoint(index + 1));
  const asteroid = getUniverseAsteroidState(0, ASTEROID_SCHEDULE_EPOCH_MS + 1);
  assert.ok(asteroid);
  assert.deepEqual(Array.from({ length: POSITION_COUNT }, (_, index) => getUniverseSlotPoint(index + 1)), points);
});

test('galaxy contains 40 systems and each system has exactly 24 positions', () => {
  const map = createUniverseMap();

  assert.equal(map.galaxy, GALAXY);
  assert.equal(map.systems.length, SYSTEM_COUNT);
  assert.ok(map.systems.every((system) => system.positions.length === POSITION_COUNT));
  assert.ok(map.systems.every((system) => system.positions.every((node) => node.coordinate.galaxy === GALAXY)));
});

test('homeworld caption uses player nickname while its planet name stays in node data', () => {
  const system = createUniverseSystem({ system: 1, currentPlanetName: 'Helion 01', currentOwnerId: 'player-current' });
  const homeworld = system.positions.find((node) => node.isHomeworld);

  assert.ok(homeworld);
  assert.equal(homeworld.name, 'Helion 01');
  assert.equal(getUniverseNodeCaption(homeworld, 'Dendrilion'), '★ Dendrilion');
  assert.equal(formatUniverseCoordinate(homeworld.coordinate), '[1:1:1]');
});

test('dynamic objects are scheduled independently and never duplicate within a system', () => {
  const nowMs = Date.UTC(2026, 8, 8, 12);
  const map = createUniverseMap({ nowMs });
  const objects = map.systems.flatMap((system) => [...system.positions, ...system.asteroids]);
  const kinds = new Set(objects.map((node) => node.kind));

  assert.ok(kinds.has('empty'));
  assert.ok(kinds.has('npc'));
  assert.ok(kinds.has('player'));
  assert.ok(kinds.has('uninhabited'));
  assert.ok(kinds.has('asteroid'));
  for (const system of map.systems) {
    for (const kind of ['pirate', 'unique', 'anomaly'] as const) {
      assert.ok(system.positions.filter((node) => node.kind === kind).length <= 1);
    }
  }
  assert.deepEqual(createUniverseMap({ nowMs }), map);
  const first = createUniverseSystem({ system: 1, nowMs });
  assert.ok(first.positions.some((node) => node.kind === 'uninhabited'));
  assert.doesNotMatch(first.positions.find((node) => node.kind === 'uninhabited')?.description ?? '', /fixture|runtime|прототип|демонстрац/i);
});

test('owner planet ids are unique and capped at seven in the domain layer', () => {
  const ids = enforceUniversePlanetLimit(['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g', 'h']);
  const npc = createUniverseNpcOwnerProfile();

  assert.equal(MAX_PLANETS_PER_OWNER, 7);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(npc.planetIds.length, MAX_PLANETS_PER_OWNER);
});

test('one seeded owner has exactly seven planets across seven systems, without extra NPCs', () => {
  const nowMs = Date.UTC(2026, 8, 8, 12);
  const map = createUniverseMap({ nowMs });
  assert.deepEqual(createUniverseMap({ nowMs }), map);
  const nodes = map.systems.flatMap((system) => system.positions);
  const planets = nodes.filter((node) => node.kind === 'npc');
  const profile = createUniverseNpcOwnerProfile();
  assert.equal(planets.length, 7);
  assert.equal(new Set(planets.map((node) => node.coordinate.system)).size, 7);
  assert.deepEqual([...new Set(planets.map((node) => node.ownerId))], [UNIVERSE_NPC_OWNER_ID]);
  assert.deepEqual(planets.map((node) => node.id).sort(), [...profile.planetIds].sort());
  assert.equal(profile.displayName, 'Бот 01');
  assert.equal(profile.points, undefined);
  assert.equal(profile.raceId, undefined);
  assert.equal(profile.alliance, undefined);
  const prime = planets.find((node) => node.id === 'npc-bot-01-prime')!;
  assert.equal(prime.id, 'npc-bot-01-prime');
  assert.equal(prime.known, true);
  assert.equal(prime.kind, 'npc');
  assert.equal(new Set(planets.map((node) => node.name)).size, MAX_PLANETS_PER_OWNER);
  assert.ok(planets.every((node) => !node.name.includes('Бота 01')));
  for (const system of map.systems) {
    assert.deepEqual(createUniverseSystem({ system: system.system, nowMs }), system);
    for (const node of system.positions) {
      if (node.kind !== 'player' && node.kind !== 'npc') assert.equal(node.ownerId, undefined);
      assert.doesNotMatch(node.description, /fixture|runtime|прототип|демонстрац/i);
    }
  }
});

test('asset catalogs select the correct kinds and unique art has a default fallback', () => {
  const assets = {
    planetArts: ['planet'], asteroidArts: ['asteroid'], pirateArts: ['pirate'],
    anomalyArts: ['anomaly'], uniqueArts: ['unique'], starArts: ['star'],
  };
  const map = createUniverseMap({ assets, nowMs: ASTEROID_SCHEDULE_EPOCH_MS + 1 });
  const expected: Record<UniversePlanetNode['kind'], string> = {
    player: 'planet', npc: 'planet', uninhabited: 'planet', empty: '', unique: 'unique', pirate: 'pirate', anomaly: 'anomaly', asteroid: 'asteroid',
  };
  for (const system of map.systems) {
    assert.equal(system.starArt, 'star');
    for (const node of system.positions) assert.equal(node.art, expected[node.kind]);
    for (const node of system.asteroids) assert.equal(node.art, 'asteroid');
  }
  for (const kind of ['pirate', 'unique', 'anomaly'] as const) {
    const schedule = Array.from({ length: 100 }, (_, index) => getUniverseTimedObjectSchedule(kind, 1, 1, index)).find((item) => item.present)!;
    const system = createUniverseSystem({ system: 1, nowMs: schedule.startAt + 1, assets });
    assert.equal(system.positions.find((node) => node.kind === kind)?.art, expected[kind]);
  }
  const uniqueSchedule = Array.from({ length: 100 }, (_, index) => getUniverseTimedObjectSchedule('unique', 1, 1, index)).find((item) => item.present)!;
  assert.equal(createUniverseSystem({ system: 1, nowMs: uniqueSchedule.startAt + 1 }).positions.find((node) => node.kind === 'unique')?.art, 'unique-default');
  assert.equal(createUniverseSystem({ system: 1, nowMs: uniqueSchedule.startAt + 1, assets: { uniqueArts: [] } }).positions.find((node) => node.kind === 'unique')?.art, 'unique-default');
  assert.equal(createUniverseSystem({ system: 1, nowMs: uniqueSchedule.startAt + 1, assets: { planetArts: ['ordinary'] } }).positions.find((node) => node.kind === 'unique')?.art, 'unique-default');
  const specialArts = ['islands', 'vortex', 'crystals'];
  const uniques = Array.from({ length: SYSTEM_COUNT }, (_, index) => {
    const systemNumber = index + 1;
    const schedule = Array.from({ length: 100 }, (_, cycleIndex) => getUniverseTimedObjectSchedule('unique', 1, systemNumber, cycleIndex)).find((item) => item.present);
    return schedule ? createUniverseSystem({ system: systemNumber, nowMs: schedule.startAt + 1, assets: { uniqueArts: specialArts } }).positions.find((node) => node.kind === 'unique') : undefined;
  }).filter((node): node is UniversePlanetNode => Boolean(node));
  assert.deepEqual([...new Set(uniques.map((node) => node.art))].sort(), [...specialArts].sort());
  const botAssetCatalog = Array.from({ length: 25 }, (_, index) => `planet-${index}`);
  const botPlanets = createUniverseMap({ assets: { planetArts: botAssetCatalog } }).systems
    .flatMap((system) => system.positions).filter((node) => node.kind === 'npc');
  assert.equal(new Set(botPlanets.map((node) => node.art)).size, MAX_PLANETS_PER_OWNER);
});

test('asteroids advance through all 24 positions and cross the galaxy boundary only when data exists', () => {
  assert.deepEqual(advanceUniverseAsteroidCoordinate({ galaxy: 1, system: 1, position: 6 }), { galaxy: 1, system: 1, position: 7 });
  assert.deepEqual(advanceUniverseAsteroidCoordinate({ galaxy: 1, system: 1, position: 24 }), { galaxy: 1, system: 2, position: 1 });
  assert.equal(advanceUniverseAsteroidCoordinate({ galaxy: 1, system: SYSTEM_COUNT, position: POSITION_COUNT }, 1, 1), null);
  assert.deepEqual(advanceUniverseAsteroidCoordinate({ galaxy: 1, system: SYSTEM_COUNT, position: POSITION_COUNT }, 1, 2), { galaxy: 2, system: 1, position: 1 });
});

test('asteroid state stays on a coordinate for 15–30 minutes and keeps gas hidden from the map contract', () => {
  const spawnIndex = 0;
  const state = getUniverseAsteroidState(spawnIndex, ASTEROID_SCHEDULE_EPOCH_MS + 1);
  assert.ok(state);
  const dwell = state.nextMoveAt - state.previousMoveAt;
  assert.ok(dwell >= ASTEROID_MIN_DWELL_MS && dwell <= ASTEROID_MAX_DWELL_MS);
  assert.ok(state.gasYield >= ASTEROID_GAS_MIN && state.gasYield <= ASTEROID_GAS_MAX);
  assert.equal(state.coordinate.galaxy, 1);
  assert.equal(state.coordinate.system, 1);
  assert.ok(state.nextCoordinate);
  assert.equal(state.nextCoordinate.position, state.coordinate.position === POSITION_COUNT ? 1 : state.coordinate.position + 1);
});

test('timed object schedules use the confirmed lifetime, quiet period, and chance ramp', () => {
  const expectations = [
    { kind: 'pirate' as const, min: PIRATE_MIN_LIFETIME_MS, max: PIRATE_MAX_LIFETIME_MS, quiet: PIRATE_QUIET_MS, chance: 0.9, step: 0 },
    { kind: 'unique' as const, min: UNIQUE_MIN_LIFETIME_MS, max: UNIQUE_MAX_LIFETIME_MS, quiet: UNIQUE_QUIET_MS, chance: UNIQUE_INITIAL_SPAWN_CHANCE, step: UNIQUE_SPAWN_CHANCE_STEP },
    { kind: 'anomaly' as const, min: ANOMALY_MIN_LIFETIME_MS, max: ANOMALY_MAX_LIFETIME_MS, quiet: ANOMALY_QUIET_MS, chance: ANOMALY_INITIAL_SPAWN_CHANCE, step: ANOMALY_SPAWN_CHANCE_STEP },
  ];
  for (const expected of expectations) {
    const first = getUniverseTimedObjectSchedule(expected.kind, 1, 1, 0);
    assert.ok(first.lifetimeMs >= expected.min && first.lifetimeMs <= expected.max);
    assert.equal(first.respawnAt - first.expiresAt, expected.quiet);
    assert.equal(first.spawnChance, expected.chance);
    const second = getUniverseTimedObjectSchedule(expected.kind, 1, 1, 1);
    assert.equal(second.startAt - first.startAt, (first.present ? first.lifetimeMs : 0) + expected.quiet);
    if (!first.present) {
      assert.equal(second.spawnChance, Math.min(1, expected.chance + expected.step));
    }
  }
});

test('spy and fleet actions are honest about unsupported runtime', () => {
  const system = createUniverseSystem({ system: 1, currentOwnerId: 'player-current' });
  const homeworld = system.positions.find((node) => node.isHomeworld)!;
  const foreign = createUniverseMap().systems.flatMap((item) => item.positions).find((node) => node.kind === 'npc')!;
  const empty = system.positions.find((node) => node.kind === 'empty')!;

  assert.equal(getUniverseActionState('spy', homeworld, 'player-current').enabled, false);
  assert.equal(getUniverseActionState('fleet', homeworld, 'player-current').reason, 'Это ваша планета.');
  assert.equal(getUniverseActionState('spy', foreign, 'player-current').status, 'prototype');
  assert.equal(getUniverseActionState('fleet', foreign, 'player-current').enabled, true);
  assert.equal(getUniverseActionState('spy', empty, 'player-current').status, 'disabled');
});
