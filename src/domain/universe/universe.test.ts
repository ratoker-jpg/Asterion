import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GALAXY,
  MAX_PLANETS_PER_OWNER,
  POSITION_COUNT,
  SYSTEM_COUNT,
  createUniverseMap,
  createUniverseNpcOwnerProfile,
  createUniverseSystem,
  enforceUniversePlanetLimit,
  formatUniverseCoordinate,
  getUniverseActionState,
  getUniverseNodeCaption,
  getUniverseSlotPoint,
  getUniverseAsteroidPoint,
  UNIVERSE_NPC_OWNER_ID,
} from './runtime.ts';

test('planet coordinates remain unchanged while asteroid clock advances', () => {
  const points = Array.from({ length: POSITION_COUNT }, (_, index) => getUniverseSlotPoint(index + 1));
  for (const elapsed of [0, 60_000, 360_000]) {
    getUniverseAsteroidPoint(1, elapsed);
    assert.deepEqual(Array.from({ length: POSITION_COUNT }, (_, index) => getUniverseSlotPoint(index + 1)), points);
  }
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

test('deterministic fixtures expose every required object classification', () => {
  const objects = createUniverseMap().systems.flatMap((system) => [...system.positions, ...system.asteroids]);
  const kinds = new Set(objects.map((node) => node.kind));

  assert.deepEqual([...kinds].sort(), ['anomaly', 'asteroid', 'empty', 'npc', 'pirate', 'player', 'uninhabited', 'unique']);
  const first = createUniverseSystem({ system: 1 });
  const second = createUniverseSystem({ system: 1 });
  assert.deepEqual(first, second);
  assert.equal(first.positions.find((node) => node.kind === 'pirate')?.name, 'Пиратский объект «Клык»');
  assert.equal(first.positions.find((node) => node.kind === 'anomaly')?.name, 'Аномалия «Люмен»');
  assert.equal(first.positions[16].kind, 'unique');
  assert.equal(first.positions[20].kind, 'uninhabited');
});

test('owner planet ids are unique and capped at seven in the domain layer', () => {
  const ids = enforceUniversePlanetLimit(['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g', 'h']);
  const npc = createUniverseNpcOwnerProfile();

  assert.equal(MAX_PLANETS_PER_OWNER, 7);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(npc.planetIds.length, MAX_PLANETS_PER_OWNER);
});

test('one seeded owner has exactly seven planets across seven systems, without extra NPCs', () => {
  const map = createUniverseMap();
  assert.deepEqual(createUniverseMap(), map);
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
  for (const system of map.systems) {
    assert.deepEqual(createUniverseSystem({ system: system.system }), system);
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
  const map = createUniverseMap({ assets });
  const expected = { player: 'planet', npc: 'planet', uninhabited: 'planet', unique: 'unique',
    anomaly: 'anomaly', pirate: 'pirate', asteroid: 'asteroid', empty: '' };
  for (const system of map.systems) {
    assert.equal(system.starArt, 'star');
    for (const node of [...system.positions, ...system.asteroids]) assert.equal(node.art, expected[node.kind]);
  }
  assert.equal(createUniverseSystem({ system: 1 }).positions[16].art, 'unique-default');
  assert.equal(createUniverseSystem({ system: 1, assets: { uniqueArts: [] } }).positions[16].art, 'unique-default');
  assert.equal(createUniverseSystem({ system: 1, assets: { planetArts: ['ordinary'] } }).positions[16].art, 'unique-default');
  const specialArts = ['islands', 'vortex', 'crystals'];
  const uniques = createUniverseMap({ assets: { uniqueArts: specialArts } }).systems
    .flatMap((system) => system.positions).filter((node) => node.kind === 'unique');
  assert.deepEqual([...new Set(uniques.map((node) => node.art))].sort(), [...specialArts].sort());
});

test('asteroids move forward through numbered slots and wrap on their own ellipse', () => {
  for (let slot = 1; slot <= POSITION_COUNT; slot += 1) {
    const start = getUniverseSlotPoint(slot);
    assert.deepEqual(getUniverseAsteroidPoint(slot, 0), start);
    assert.deepEqual(getUniverseAsteroidPoint(slot, 360_000), start);
    const ring = Math.floor((slot - 1) / 6);
    for (let step = -7; step <= 12; step += 1) {
      const next = ring * 6 + (((slot - 1 + step) % 6 + 6) % 6) + 1;
      const actual = getUniverseAsteroidPoint(slot, step * 60_000);
      const expected = getUniverseSlotPoint(next);
      assert.ok(Math.abs(actual.x - expected.x) < 1e-10);
      assert.ok(Math.abs(actual.y - expected.y) < 1e-10);
    }
    for (const elapsed of [1, 30_000, 59_999, 60_001, 359_999]) {
      const point = getUniverseAsteroidPoint(slot, elapsed);
      const radiusX = [19, 28, 36, 44][ring];
      const radiusY = [22, 27, 32, 37][ring];
      assert.ok(Math.abs(((point.x - 50) / radiusX) ** 2 + ((point.y - 52) / radiusY) ** 2 - 1) < 1e-10);
      const after = getUniverseAsteroidPoint(slot, elapsed + 1);
      assert.ok(Math.hypot(point.x - after.x, point.y - after.y) < 0.001);
    }
    assert.notDeepEqual(getUniverseAsteroidPoint(slot, 30_000), start);
    assert.deepEqual(getUniverseSlotPoint(slot), start);
  }
});

test('asteroid geometry normalizes invalid inputs without nonfinite coordinates', () => {
  for (const slot of [NaN, Infinity, -Infinity, -1, 0]) {
    assert.deepEqual(getUniverseAsteroidPoint(slot, 0), getUniverseSlotPoint(1));
  }
  assert.deepEqual(getUniverseAsteroidPoint(25, 0), getUniverseSlotPoint(24));
  assert.deepEqual(getUniverseAsteroidPoint(4.8, 0), getUniverseSlotPoint(4));
  for (const time of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(getUniverseAsteroidPoint(4, time), getUniverseSlotPoint(4));
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
