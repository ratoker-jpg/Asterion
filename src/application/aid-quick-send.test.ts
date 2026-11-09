import assert from 'node:assert/strict';
import test from 'node:test';

import { aidCapacity, aidQuickSources, aidShipCargo, aidShipsFor, buildAidQuickCommand, previewAidQuick, suggestAidLoad } from './aid-quick-send.ts';
import { createIraAidRequest, prepareIraAidFixture, syncAidState, type AidContext } from './alliance-aid.ts';
import { replacePlanetResources, replacePlanetState, type SaveState } from './contracts.ts';
import { dispatchFlight } from './flights.ts';
import { createInitialSaveState } from './persistence.ts';

const T0 = 1_000_000;
const ctx = (now: number): AidContext => ({ now, mode: 'test', testTimeScale: 15 });
const runtime = { now: T0, mode: 'test' as const, testTimeScale: 15 as const };

function world(ships: Record<string, number>, wallet = 2_000_000): SaveState {
  const base = createInitialSaveState('test', T0);
  const home = base.planets['helion-01'];
  const withFleet = replacePlanetState(base, 'helion-01', { ...home, fleet: { ...home.fleet, ships: { ...home.fleet.ships, transporter: 0, 'mega-transporter': 0, ...ships } } });
  const funded = replacePlanetResources(withFleet, 'helion-01', { metal: wallet, minerals: wallet, gas: 2_000_000 });
  const prepared = prepareIraAidFixture(funded, ctx(T0));
  assert.ok(prepared.ok);
  return syncAidState(prepared.state, ctx(T0));
}

function request(state: SaveState, amount: number, resource: 'metal' | 'gas' = 'metal') {
  const made = createIraAidRequest(state, { resource, amount }, ctx(T0));
  assert.ok(made.ok, made.ok ? '' : made.message);
  return { state: made.state, request: made.state.command.requests.find((item) => item.id === made.requestId)! };
}

test('aidShipsFor takes the fewest hulls that fit the amount, large ones first', () => {
  const state = world({});
  const mega = aidShipCargo(state, 'mega-transporter');
  const small = aidShipCargo(state, 'transporter');
  assert.ok(mega > small && small > 0);
  const free = { 'mega-transporter': 10, transporter: 10 } as const;
  // Two full megas and a remainder small enough for transporters.
  assert.deepEqual(aidShipsFor(state, free, mega * 2 + small), { 'mega-transporter': 2, transporter: 1 });
  // No transporters left for the remainder: one more mega instead.
  assert.deepEqual(aidShipsFor(state, { 'mega-transporter': 10, transporter: 0 }, mega * 2 + 1), { 'mega-transporter': 3 });
  // Not enough of anything: every free hull.
  assert.deepEqual(aidShipsFor(state, { 'mega-transporter': 1, transporter: 2 }, mega * 50), { 'mega-transporter': 1, transporter: 2 });
  assert.deepEqual(aidShipsFor(state, free, 0), {});
});

test('suggestAidLoad fills the remainder within stock and hold, and the command passes the runtime', () => {
  const base = world({ 'mega-transporter': 40, transporter: 10 });
  const { state, request: req } = request(base, 120_000);
  const [source] = aidQuickSources(state, req);
  assert.equal(source!.planetId, 'helion-01');
  const load = suggestAidLoad(state, req, source!, runtime);
  assert.equal(load.amount, 120_000);
  assert.ok(aidCapacity(state, load.ships) >= 120_000);
  const command = buildAidQuickCommand(req, source!.planetId, load.ships, load.amount, runtime);
  const preview = previewAidQuick(state, command, runtime);
  assert.ok(preview.ok, preview.ok ? '' : preview.error.message);
  const sent = dispatchFlight(state, command, runtime);
  assert.ok(sent.ok, sent.ok ? '' : sent.error.message);
  assert.equal(sent.flight.missionId, 'aid');
  assert.equal(sent.flight.cargo?.metal, 120_000);
});

test('suggestAidLoad stops at the hold of every free hull when the request is bigger', () => {
  const base = world({ transporter: 2 });
  const { state, request: req } = request(base, 120_000);
  const source = aidQuickSources(state, req).find((item) => item.planetId === 'helion-01')!;
  const hold = aidShipCargo(state, 'transporter') * 2;
  assert.ok(hold < 120_000);
  const load = suggestAidLoad(state, req, source, runtime);
  assert.equal(load.amount, hold);
  assert.deepEqual(load.ships, { transporter: 2 });
});

test('a planet without cargo hulls stays listed with zero hold', () => {
  const base = world({});
  const { state, request: req } = request(base, 120_000);
  const source = aidQuickSources(state, req).find((item) => item.planetId === 'helion-01')!;
  assert.equal(source.capacity, 0);
  assert.equal(suggestAidLoad(state, req, source, runtime).amount, 0);
});

test('gas aid leaves the fuel of the trip on the planet', () => {
  const base = world({ 'mega-transporter': 40 });
  const poor = replacePlanetResources(base, 'helion-01', { metal: 0, minerals: 0, gas: 50_000 });
  const { state, request: req } = request(poor, 120_000, 'gas');
  const source = aidQuickSources(state, req).find((item) => item.planetId === 'helion-01')!;
  const load = suggestAidLoad(state, req, source, runtime);
  assert.ok(load.amount > 0 && load.amount < 50_000);
  const preview = previewAidQuick(state, buildAidQuickCommand(req, source.planetId, load.ships, load.amount, runtime), runtime);
  assert.ok(preview.ok, preview.ok ? '' : preview.error.message);
});
