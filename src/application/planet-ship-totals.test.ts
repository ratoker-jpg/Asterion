import assert from 'node:assert/strict';
import test from 'node:test';

import type { ShipId } from '../domain/combat/ids.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';
import { getPlanetResources, replacePlanetResources } from './contracts.ts';
import { buildEmpireOverview } from './empire.ts';
import { getFleetBuildBudget } from './fleet.ts';
import { buildFleetPlanView } from './fleet-plan.ts';
import { getAvailableFleetForPlanet, getShipsAwayForPlanet, planetShipTotals } from './flights.ts';
import { createInitialSaveState } from './persistence.ts';

const NOW = 1_000_000;
const RUNTIME = { now: NOW, mode: 'production' as const, testTimeScale: 1 as const };
const PLANET = 'helion-01';
const COORD = { galaxy: 1, system: 1, position: 1 };

function flight(id: string, ships: Partial<Record<ShipId, number>>, extra: Partial<FlightRecord> = {}): FlightRecord {
  return {
    id,
    requestId: id,
    missionId: 'transport',
    originPlanetId: PLANET,
    originCoordinate: COORD,
    destination: { kind: 'coordinate', coordinate: COORD },
    destinationCoordinate: COORD,
    selectedShips: ships,
    phase: 'outbound',
    ...extra,
  } as FlightRecord;
}

/** Home planet owns `owned` of one ship type; `flights` carry some of them away. */
function world(shipId: ShipId, owned: number, flights: FlightRecord[], target?: number): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'SHIP-TOTALS-01', playerName: 'Owner' });
  const base = createInitialSaveState('production', NOW, config);
  const home = base.planets[PLANET]!;
  const ships = Object.fromEntries(Object.keys(home.fleet.ships).map((id) => [id, id === shipId ? owned : 0])) as typeof home.fleet.ships;
  const next: SaveState = {
    ...base,
    planets: { ...base.planets, [PLANET]: { ...home, buildings: { ...home.buildings, hangar: 30, shipyard: 10 }, fleet: { ...home.fleet, ships } } },
    flights: { ...base.flights, records: flights },
    ...(target ? { fleetUi: { favoriteTargets: [], plans: { [PLANET]: { targets: { [shipId]: target } } } } } : {}),
  };
  return replacePlanetResources(next, PLANET, { ...getPlanetResources(next, PLANET), metal: 0, minerals: 0, gas: 0 });
}

function someShip(): ShipId {
  const base = createInitialSaveState('production', NOW, createDefaultNewGameConfig({ seed: 'SHIP-TOTALS-01', playerName: 'Owner' }));
  return Object.keys(base.planets[PLANET]!.fleet.ships).find((id) => id !== 'solar-satellite') as ShipId;
}

test('planetShipTotals adds ships away to ships on the planet', () => {
  const a = 'scout' as ShipId;
  const b = 'recycler' as ShipId;
  assert.deepEqual(planetShipTotals({ [a]: 12 }, { [a]: 432, [b]: 350 }), {
    [a]: { onPlanet: 12, away: 432, total: 444 },
    [b]: { onPlanet: 0, away: 350, total: 350 },
  });
  assert.deepEqual(planetShipTotals({ [a]: 0 }, {}), {});
  assert.deepEqual(planetShipTotals({ [a]: Number.NaN }, { [a]: -3 }), {});
});

test('ships away count every mission that comes back, not one-way trips or foreign fleets', () => {
  const id = someShip();
  const away = getShipsAwayForPlanet(world(id, 1000, [
    flight('t', { [id]: 100 }),
    flight('a', { [id]: 10 }, { missionId: 'attack', phase: 'arrived' }),
    flight('r', { [id]: 1 }, { missionId: 'recycle', phase: 'returning' }),
    flight('d', { [id]: 500 }, { missionId: 'deployment' }),
    flight('back', { [id]: 7 }, { missionId: 'deployment', phase: 'returning' }),
    flight('npc', { [id]: 999 }, { ownerSide: 'npc' }),
    flight('other', { [id]: 999 }, { originPlanetId: 'elsewhere' }),
  ]), PLANET);
  assert.equal(away[id], 100 + 10 + 1 + 7);
});

test('owner example: 350 transports all away read as 350 owned, nothing missing', () => {
  const id = someShip();
  const state = world(id, 350, [flight('t', { [id]: 350 })], 350);
  assert.equal(getAvailableFleetForPlanet(state, PLANET).ships[id] ?? 0, 0);
  const line = buildFleetPlanView(state, PLANET, RUNTIME).lines.find((candidate) => candidate.id === id)!;
  assert.equal(line.onPlanet, 0);
  assert.equal(line.away, 350);
  assert.equal(line.current, 350);
  assert.equal(line.missing, 0);
  assert.equal(line.startable, 0);
});

test('shortfall and start count use the whole fleet: 12 here + 432 away of 450 → 6 missing', () => {
  const id = someShip();
  const state = world(id, 444, [flight('a', { [id]: 432 }, { missionId: 'attack' })], 450);
  const line = buildFleetPlanView(state, PLANET, RUNTIME).lines.find((candidate) => candidate.id === id)!;
  assert.equal(line.current, 444);
  assert.equal(line.missing, 6);
});

test('empire row, picker item and build budget carry the ships away', () => {
  const id = someShip();
  const state = world(id, 444, [flight('a', { [id]: 432 }, { missionId: 'attack' })]);
  const row = buildEmpireOverview(state, RUNTIME).rows.find((candidate) => candidate.id === PLANET)!;
  assert.equal(row.shipCount, 12);
  assert.equal(row.shipCountAway, 432);
  assert.equal(getFleetBuildBudget(state, PLANET).shipsAway?.[id], 432);
});
