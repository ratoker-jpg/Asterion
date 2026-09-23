import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectOrbitalDebrisAtCoordinate,
  getOrbitalDebrisAtCoordinate,
  getOrbitalDebrisByCoordinate,
} from './orbital-debris.ts';
import type { EspionageState, OrbitalDebrisRecord, SpyTargetState } from './types.ts';
import type { UniverseCoordinate } from '../universe/types.ts';

const coordinate: UniverseCoordinate = { galaxy: 1, system: 2, position: 3 };

function target(id: string, at: UniverseCoordinate, debris: number, legacyDebris?: number): SpyTargetState {
  return {
    id,
    name: id,
    coordinate: at,
    ownerId: 'owner',
    ownerName: 'Owner',
    raceId: 'aegis',
    alliance: null,
    espionageLevel: 0,
    resources: { metal: 0, minerals: 0, gas: 0, debris, developmentEnergy: 0 },
    buildings: {},
    fleet: { ships: {} },
    defense: { defenses: {} },
    commanders: {},
    population: { total: 0, fleet: 0, defense: 0 },
    hunterLevel: 0,
    ...(legacyDebris === undefined ? {} : { debris: legacyDebris }),
  } as SpyTargetState;
}

function orbitalRecord(id: string, at: UniverseCoordinate, debris: number): OrbitalDebrisRecord {
  return {
    id: `orbital-${id}`,
    targetPlanetId: id,
    targetPlanetName: id,
    targetOwnerId: 'owner',
    targetCoordinate: at,
    debris,
    createdAt: 1,
  };
}

function state(overrides: Partial<EspionageState> = {}): EspionageState {
  return { missions: [], reports: [], hunterNotices: [], ...overrides };
}

test('aggregates live and destroyed-target debris at a coordinate', () => {
  const espionage = state({
    targets: {
      'live-a': target('live-a', coordinate, 10),
      'live-b': target('live-b', coordinate, 20),
    },
    orbitalDebris: { wreck: orbitalRecord('wreck', coordinate, 30) },
  });

  assert.equal(getOrbitalDebrisAtCoordinate(espionage, coordinate), 60);
});

test('matches every coordinate component and orders grouped coordinates', () => {
  const adjacent: UniverseCoordinate = { galaxy: 1, system: 2, position: 4 };
  const otherGalaxy: UniverseCoordinate = { galaxy: 2, system: 2, position: 3 };
  const espionage = state({
    orbitalDebris: {
      current: orbitalRecord('current', coordinate, 7),
      adjacent: orbitalRecord('adjacent', adjacent, 11),
      otherGalaxy: orbitalRecord('otherGalaxy', otherGalaxy, 13),
    },
  });

  assert.equal(getOrbitalDebrisAtCoordinate(espionage, coordinate), 7);
  assert.deepEqual(getOrbitalDebrisByCoordinate(espionage), [
    { coordinate, debris: 7 },
    { coordinate: adjacent, debris: 11 },
    { coordinate: otherGalaxy, debris: 13 },
  ]);
});

test('live target is authoritative when its ID also appears in orbital ledger', () => {
  const espionage = state({
    targets: { target: target('target', coordinate, 12) },
    orbitalDebris: { stale: orbitalRecord('target', coordinate, 999) },
  });

  assert.equal(getOrbitalDebrisAtCoordinate(espionage, coordinate), 12);
  const result = collectOrbitalDebrisAtCoordinate(espionage, coordinate, 5);
  assert.equal(result.collected, 5);
  assert.equal(result.espionage.targets?.target.resources.debris, 7);
  assert.equal(result.espionage.orbitalDebris?.stale.debris, 999);
});

test('consumes records by target ID, supports partial consumption, and removes fully consumed records', () => {
  const espionage = state({
    orbitalDebris: {
      z: orbitalRecord('z', coordinate, 8),
      a: orbitalRecord('a', coordinate, 7),
    },
  });

  const partial = collectOrbitalDebrisAtCoordinate(espionage, coordinate, 10);
  assert.equal(partial.collected, 10);
  assert.equal(partial.espionage.orbitalDebris?.a, undefined);
  assert.equal(partial.espionage.orbitalDebris?.z.debris, 5);

  const full = collectOrbitalDebrisAtCoordinate(partial.espionage, coordinate, 20);
  assert.equal(full.collected, 5);
  assert.deepEqual(full.espionage.orbitalDebris, {});
});

test('live zero debris stays zero and never falls back to the legacy mirror or ledger copy', () => {
  const espionage = state({
    targets: { target: target('target', coordinate, 0, 50) },
    orbitalDebris: { stale: orbitalRecord('target', coordinate, 25) },
  });

  assert.equal(getOrbitalDebrisAtCoordinate(espionage, coordinate), 0);
  const result = collectOrbitalDebrisAtCoordinate(espionage, coordinate, 100);
  assert.equal(result.collected, 0);
  assert.equal(result.espionage, espionage);
});

test('clamps debris and capacity to safe nonnegative integers', () => {
  const espionage = state({ orbitalDebris: { wreck: orbitalRecord('wreck', coordinate, Number.MAX_VALUE) } });

  assert.equal(getOrbitalDebrisAtCoordinate(espionage, coordinate), Number.MAX_SAFE_INTEGER);
  const result = collectOrbitalDebrisAtCoordinate(espionage, coordinate, -3);
  assert.equal(result.collected, 0);
  assert.equal(result.espionage, espionage);
});
