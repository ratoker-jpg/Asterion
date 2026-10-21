import assert from 'node:assert/strict';
import test from 'node:test';

import { concurrentFlightLimit, countsTowardFlightLimit, getFlightSlotUsage } from './limit.ts';
import type { FlightRecord } from './types.ts';

function flight(missionId: FlightRecord['missionId'], phase: FlightRecord['phase'], ownerSide?: FlightRecord['ownerSide']): FlightRecord {
  return { id: `${missionId}-${phase}-${ownerSide ?? 'self'}`, missionId, phase, ...(ownerSide ? { ownerSide } : {}) } as FlightRecord;
}

test('Computer Systems: limit = 3 + floor(1.5 x level)', () => {
  assert.equal(concurrentFlightLimit(0), 3);
  assert.equal(concurrentFlightLimit(1), 4);
  assert.equal(concurrentFlightLimit(2), 6);
  assert.equal(concurrentFlightLimit(15), 25);
  assert.equal(concurrentFlightLimit(undefined), 3);
  assert.equal(concurrentFlightLimit(-4), 3);
});

test('outbound, arrived and returning player flights hold a slot; spy probes and finished flights do not', () => {
  assert.equal(countsTowardFlightLimit(flight('transport', 'outbound')), true);
  assert.equal(countsTowardFlightLimit(flight('attack', 'returning')), true, 'returns count');
  assert.equal(countsTowardFlightLimit(flight('expedition', 'arrived')), true);
  assert.equal(countsTowardFlightLimit(flight('transport', 'completed')), false);
  assert.equal(countsTowardFlightLimit(flight('espionage', 'outbound')), false);
  assert.equal(countsTowardFlightLimit(flight('espionage', 'returning')), false);
  assert.equal(countsTowardFlightLimit(flight('pirate-recon', 'outbound')), false);
  assert.equal(countsTowardFlightLimit(flight('exploration-recon', 'returning')), false);
  assert.equal(countsTowardFlightLimit(flight('attack', 'outbound', 'bot01')), false, 'NPC flights are not the player\'s');
  assert.equal(countsTowardFlightLimit(flight('sun-support', 'outbound', 'player')), true);
});

test('slot usage reports used, limit and free slots', () => {
  const records = [
    flight('transport', 'outbound'), flight('attack', 'returning'), flight('espionage', 'outbound'),
  ];
  assert.deepEqual(getFlightSlotUsage(records, 0), { used: 2, limit: 3, free: 1 });
  assert.deepEqual(getFlightSlotUsage(records, 2), { used: 2, limit: 6, free: 4 });
});
