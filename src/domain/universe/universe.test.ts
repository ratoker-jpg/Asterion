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
} from './runtime.ts';

test('slot geometry is stable and independent from wall clock time', () => {
  const first = getUniverseSlotPoint(1);
  const before = Date.now();
  const second = getUniverseSlotPoint(1);
  const after = before + 60_000;

  assert.deepEqual(first, second);
  assert.equal(after > before, true);
  assert.deepEqual(getUniverseSlotPoint(24), getUniverseSlotPoint(24));
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

  assert.deepEqual([...kinds].sort(), ['anomaly', 'asteroid', 'empty', 'npc', 'pirate', 'player']);
  const first = createUniverseSystem({ system: 1 });
  const second = createUniverseSystem({ system: 1 });
  assert.deepEqual(first, second);
  assert.equal(first.positions.find((node) => node.kind === 'pirate')?.name, 'Пиратский объект «Клык»');
  assert.equal(first.positions.find((node) => node.kind === 'anomaly')?.name, 'Аномалия «Люмен»');
});

test('owner planet ids are unique and capped at seven in the domain layer', () => {
  const ids = enforceUniversePlanetLimit(['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g', 'h']);
  const npc = createUniverseNpcOwnerProfile();

  assert.equal(MAX_PLANETS_PER_OWNER, 7);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.ok(npc.planetIds.length <= MAX_PLANETS_PER_OWNER);
});

test('spy and fleet actions are honest about unsupported runtime', () => {
  const system = createUniverseSystem({ system: 1, currentOwnerId: 'player-current' });
  const homeworld = system.positions.find((node) => node.isHomeworld)!;
  const foreign = system.positions.find((node) => node.kind === 'npc')!;
  const empty = system.positions.find((node) => node.kind === 'empty')!;

  assert.equal(getUniverseActionState('spy', homeworld, 'player-current').enabled, false);
  assert.equal(getUniverseActionState('fleet', homeworld, 'player-current').reason, 'Это ваша планета.');
  assert.equal(getUniverseActionState('spy', foreign, 'player-current').status, 'prototype');
  assert.equal(getUniverseActionState('fleet', foreign, 'player-current').enabled, true);
  assert.equal(getUniverseActionState('spy', empty, 'player-current').status, 'disabled');
});
