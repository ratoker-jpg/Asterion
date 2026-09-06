import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILDING_INTERIOR_ROLES,
  canEnterBuildingInterior,
  createBuildingInteriorContext,
  getBuildingInteriorTarget,
} from './building-interior-navigation.ts';
import { BUILDING_ROLES } from './domain/buildings/resource-zone.ts';

test('building interiors expose Enter for exactly the nine approved roles', () => {
  assert.equal(BUILDING_INTERIOR_ROLES.length, 9);
  assert.deepEqual(BUILDING_INTERIOR_ROLES, [
    'construction',
    'advanced-factory',
    'recycling',
    'trade-center',
    'shipyard',
    'research',
    'spaceport',
    'planetary-government',
    'bank',
  ]);

  const allowed = BUILDING_ROLES.filter((role) => canEnterBuildingInterior(role, 1));
  const denied = BUILDING_ROLES.filter((role) => !canEnterBuildingInterior(role, 1));
  assert.deepEqual(allowed, BUILDING_INTERIOR_ROLES);
  assert.equal(denied.length, BUILDING_ROLES.length - BUILDING_INTERIOR_ROLES.length);
});

test('Enter is hidden for an unbuilt approved building and independent from upgrade availability', () => {
  assert.equal(canEnterBuildingInterior('shipyard', 0), false);
  assert.equal(canEnterBuildingInterior('shipyard', 1), true);
  assert.equal(canEnterBuildingInterior('advanced-factory', 20), true);
});

test('approved deep links reuse fleets construction, science and command targets', () => {
  assert.deepEqual(getBuildingInteriorTarget('shipyard'), { kind: 'fleet-construction' });
  assert.deepEqual(getBuildingInteriorTarget('research'), { kind: 'science' });
  assert.deepEqual(getBuildingInteriorTarget('planetary-government'), { kind: 'command' });
});

test('return context preserves planet, zone and building role', () => {
  assert.deepEqual(createBuildingInteriorContext('helion-01', 'construction'), {
    planetId: 'helion-01',
    zone: 'industry',
    buildingRole: 'construction',
    returnTo: 'zone',
  });
  assert.deepEqual(createBuildingInteriorContext('helion-01', 'shipyard'), {
    planetId: 'helion-01',
    zone: 'military',
    buildingRole: 'shipyard',
    returnTo: 'zone',
  });
  assert.equal(createBuildingInteriorContext('helion-01', 'metal-storage'), null);
});
