import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState } from './persistence.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { SHIP_IDS, type ShipId } from '../domain/combat/ids.ts';
import type { SaveState } from './contracts.ts';
import { dispatchFlight } from './flights.ts';
import { buildQuickCommand, previewQuickCommand, type QuickTarget } from './quick-actions.ts';
import { getStorageCapacities } from '../domain/buildings/balance-v1.ts';
import { buildEmpireOverview, cargoHullsOnPlanet, fitCargo, holdOf, pickCargoShips, planGatherLoads, planTransportLoad, type CargoHull } from './empire.ts';

const NOW = 1_000_000;
const RUNTIME = { now: NOW, mode: 'production' as const };
const hangar = (ships: Partial<Record<ShipId, number>>) => Object.fromEntries(SHIP_IDS.map((id) => [id, ships[id] ?? 0])) as Record<ShipId, number>;
const HULLS: CargoHull[] = [
  { shipId: 'transporter', capacity: 5_000, free: 10 },
  { shipId: 'mega-transporter', capacity: 25_000, free: 4 },
];

function campaign(): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'EMPIRE-WORLD01', playerName: 'Owner' });
  return createInitialSaveState('production', NOW, config);
}

function withColony(state: SaveState, id: string, system: number, ships: Partial<Record<ShipId, number>>, resources = { metal: 0, minerals: 0, gas: 0 }): SaveState {
  const home = state.planets[state.currentPlanetId]!;
  return {
    ...state,
    planets: { ...state.planets, [id]: { ...home, name: `Колония ${system}`, universeSystem: system, universePosition: 4, fleet: { ...home.fleet, ships: hangar(ships) }, resources } },
    queues: { ...state.queues, [id]: [] },
  };
}

function ownTarget(state: SaveState, planetId: string): QuickTarget {
  const planet = state.planets[planetId]!;
  return {
    node: {
      id: planetId, kind: 'player', name: planet.name, art: '', ownerId: state.profile.playerId, statusLabel: '', description: '',
      coordinate: { galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1, position: planet.universePosition ?? 1 },
    },
    relation: 'self',
  };
}

test('pickCargoShips: fewest hulls, remainder in the smallest hull that fits', () => {
  assert.deepEqual(pickCargoShips(HULLS, 0), {});
  assert.deepEqual(pickCargoShips(HULLS, 4_000), { transporter: 1 });
  assert.deepEqual(pickCargoShips(HULLS, 25_000), { 'mega-transporter': 1 });
  assert.deepEqual(pickCargoShips(HULLS, 27_000), { 'mega-transporter': 1, transporter: 1 });
  assert.deepEqual(pickCargoShips(HULLS, 70_000), { 'mega-transporter': 2, transporter: 4 });
  // Megas run out: the rest goes on small hulls.
  assert.deepEqual(pickCargoShips(HULLS, 120_000), { 'mega-transporter': 4, transporter: 4 });
  // More than the hangar holds: everything flies.
  assert.deepEqual(pickCargoShips(HULLS, 1_000_000), { 'mega-transporter': 4, transporter: 10 });
});

test('fitCargo keeps each resource share and never exceeds the hold', () => {
  assert.deepEqual(fitCargo({ metal: 100, minerals: 50, gas: 0 }, 1_000), { metal: 100, minerals: 50, gas: 0, debris: 0 });
  const cargo = fitCargo({ metal: 60_000, minerals: 30_000, gas: 10_001 }, 10_000);
  assert.equal(cargo.metal + cargo.minerals + cargo.gas, 10_000);
  assert.ok(cargo.metal > cargo.minerals && cargo.minerals > cargo.gas && cargo.gas > 0);
  assert.deepEqual(fitCargo({ metal: 5, minerals: 5, gas: 5 }, 0), { metal: 0, minerals: 0, gas: 0, debris: 0 });
});

test('planTransportLoad: «оставить N» stays, fuel comes out of spare gas, cap limits the load', () => {
  const stock = { metal: 50_000, minerals: 20_000, gas: 8_000 };
  const load = planTransportLoad(stock, { metal: 10_000, minerals: 0, gas: 1_000 }, HULLS, 500);
  assert.deepEqual(load.cargo, { metal: 40_000, minerals: 20_000, gas: 6_500, debris: 0 });
  assert.equal(load.leftBehind, 0);
  assert.ok(holdOf(HULLS, load.ships) >= 66_500);
  assert.deepEqual(load.ships, { 'mega-transporter': 2, transporter: 4 });

  // Keep more than there is → nothing to carry, no ships.
  assert.deepEqual(planTransportLoad(stock, { metal: 90_000, minerals: 90_000, gas: 90_000 }, HULLS, 500), { ships: {}, cargo: { metal: 0, minerals: 0, gas: 0, debris: 0 }, leftBehind: 0 });

  // A target with little storage room left.
  const capped = planTransportLoad(stock, { metal: 0, minerals: 0, gas: 0 }, HULLS, 0, { metal: 3_000, minerals: 0 });
  assert.deepEqual(capped.cargo, { metal: 3_000, minerals: 0, gas: 8_000, debris: 0 });

  // Too few transports: the rest stays behind and is reported.
  const small = planTransportLoad({ metal: 1_000_000, minerals: 0, gas: 0 }, { metal: 0, minerals: 0, gas: 0 }, [{ shipId: 'transporter', capacity: 5_000, free: 2 }]);
  assert.deepEqual(small.cargo, { metal: 10_000, minerals: 0, gas: 0, debris: 0 });
  assert.equal(small.leftBehind, 990_000);
});

test('a planned load is a transport the flight runtime accepts and settles', () => {
  let state = campaign();
  state = withColony(state, 'colony-a', 3, { transporter: 20 }, { metal: 40_000, minerals: 25_000, gas: 9_000 });
  const target = ownTarget(state, state.currentPlanetId);
  const hulls = cargoHullsOnPlanet(state, 'colony-a');
  assert.equal(hulls.length, 1);
  const keep = { metal: 5_000, minerals: 0, gas: 2_000 };
  // First pass for the fuel fee, second pass with it, as the console does.
  const draft = planTransportLoad(state.planets['colony-a']!.resources!, keep, hulls);
  const probe = previewQuickCommand(state, buildQuickCommand(state, 'transport', target, 'colony-a', { ships: draft.ships }, RUNTIME, draft.cargo)!, RUNTIME);
  const fuel = probe.ok ? probe.flight.gasCost : 0;
  assert.ok(fuel > 0);
  const load = planTransportLoad(state.planets['colony-a']!.resources!, keep, hulls, fuel);
  const command = buildQuickCommand(state, 'transport', target, 'colony-a', { ships: load.ships }, RUNTIME, load.cargo)!;
  const preview = previewQuickCommand(state, command, RUNTIME);
  assert.equal(preview.ok, true, preview.ok ? '' : preview.error.message);
  const sent = dispatchFlight(state, command, RUNTIME);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const left = sent.state.planets['colony-a']!.resources!;
  assert.equal(left.metal, 5_000);
  assert.ok(left.gas >= 2_000);
});

test('buildEmpireOverview: per-planet storage, idle markers, flights and totals', () => {
  let state = campaign();
  state = withColony(state, 'colony-a', 3, { transporter: 6 }, { metal: 0, minerals: 0, gas: 50_000 });
  state = withColony(state, 'colony-b', 5, {}, { metal: 1_000_000_000_000, minerals: 1, gas: 0 });
  const runtime = { ...RUNTIME, testTimeScale: 1 as const };
  const overview = buildEmpireOverview(state, runtime);
  assert.equal(overview.rows[0]!.id, state.currentPlanetId);
  assert.equal(overview.rows.length, 3);
  const b = overview.rows.find((row) => row.id === 'colony-b')!;
  assert.equal(b.resources.metal.full, true);
  assert.equal(b.resources.metal.fill, 1);
  const a = overview.rows.find((row) => row.id === 'colony-a')!;
  assert.equal(a.resources.metal.amount, 0);
  assert.equal(a.resources.gas.amount, 50_000);
  assert.equal(a.idle, true);
  assert.equal(a.shipCount, 6);
  assert.equal(overview.totals.metal.amount, overview.rows.reduce((sum, row) => sum + row.resources.metal.amount, 0));

  const target = ownTarget(state, state.currentPlanetId);
  const command = buildQuickCommand(state, 'transport', target, 'colony-a', { ships: { transporter: 1 } }, RUNTIME, { metal: 0, minerals: 0, gas: 0, debris: 0 })!;
  const sent = dispatchFlight(state, command, RUNTIME);
  assert.equal(sent.ok, true, sent.ok ? '' : sent.error.message);
  if (!sent.ok) return;
  const after = buildEmpireOverview(sent.state, runtime);
  assert.equal(after.flightsInAir, 1);
  assert.equal(after.rows.find((row) => row.id === 'colony-a')!.flights[0]!.direction, 'out');
  assert.equal(after.rows.find((row) => row.id === state.currentPlanetId)!.flights[0]!.direction, 'in');
  assert.equal(after.rows.find((row) => row.id === 'colony-a')!.shipCount, 5);
});

test('planGatherLoads shares the target storage room between legs and keeps fuel', () => {
  let state = campaign();
  state = withColony(state, 'colony-a', 3, { transporter: 20 }, { metal: 50_000, minerals: 0, gas: 20_000 });
  state = withColony(state, 'colony-b', 6, { transporter: 20 }, { metal: 50_000, minerals: 0, gas: 20_000 });
  const capacity = getStorageCapacities(state.planets[state.currentPlanetId]!.buildings);
  state = { ...state, metal: capacity.metal - 30_000 };
  const target = ownTarget(state, state.currentPlanetId);
  const keep = { metal: 0, minerals: 0, gas: 1_000 };
  const loads = planGatherLoads(state, target, ['colony-a', 'colony-b'], keep, RUNTIME);
  assert.equal(loads['colony-a']!.cargo.metal + loads['colony-b']!.cargo.metal, 30_000);
  assert.equal(loads['colony-a']!.cargo.metal, 30_000);
  assert.equal(loads['colony-b']!.cargo.metal, 0);
  for (const id of ['colony-a', 'colony-b']) {
    const load = loads[id]!;
    const command = buildQuickCommand(state, 'transport', target, id, { ships: load.ships }, RUNTIME, load.cargo)!;
    const preview = previewQuickCommand(state, command, RUNTIME);
    assert.equal(preview.ok, true, preview.ok ? '' : preview.error.message);
    if (preview.ok) assert.ok(20_000 - load.cargo.gas - preview.flight.gasCost >= 1_000);
  }
});
