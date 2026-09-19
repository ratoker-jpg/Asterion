import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateRouteDistance, isFlightCoordinate, positionDistance, positionRing, positionSector } from './distance.ts';

test('validates coordinates and maps positions to four six-sector rings', () => {
  assert.equal(isFlightCoordinate({ galaxy: 1, system: 40, position: 24 }), true);
  assert.equal(isFlightCoordinate({ galaxy: 0, system: 1, position: 1 }), false);
  assert.equal(isFlightCoordinate({ galaxy: 1, system: 41, position: 1 }), false);
  assert.equal(isFlightCoordinate({ galaxy: 1, system: 1, position: 25 }), false);
  assert.equal(positionRing(1), 0);
  assert.equal(positionRing(24), 3);
  assert.equal(positionSector(1), 0);
  assert.equal(positionSector(6), 5);
});

test('calculates circular position and route distances', () => {
  assert.equal(positionDistance(1, 2), 1);
  assert.equal(positionDistance(1, 6), 1);
  assert.equal(positionDistance(1, 7), 6);
  assert.equal(calculateRouteDistance({ galaxy: 1, system: 1, position: 1 }, { galaxy: 1, system: 1, position: 1 }), 1_000);
  assert.equal(calculateRouteDistance({ galaxy: 1, system: 1, position: 1 }, { galaxy: 1, system: 40, position: 1 }), 16_015);
  assert.equal(calculateRouteDistance({ galaxy: 1, system: 1, position: 1 }, { galaxy: 3, system: 1, position: 1 }), 34_010);
  assert.equal(calculateRouteDistance({ galaxy: 1, system: 1, position: 1 }, { galaxy: 4, system: 1, position: 1 }), 50_515);
});
