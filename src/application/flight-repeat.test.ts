import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState } from './persistence.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { SHIP_IDS, type ShipId } from '../domain/combat/ids.ts';
import type { SaveState } from './contracts.ts';
import { dispatchFlight, previewFlight } from './flights.ts';
import {
  buildFlightRepeatPlan,
  canRepeatFlight,
  carryComposition,
  clampComposition,
  listSourcePlanets,
  pickNextSourcePlanet,
} from './flight-repeat.ts';
import { migrateFleetUiState, rememberOwnTarget, toggleFavoriteTarget, FLEET_FAVORITE_LIMIT } from '../domain/flights/fleet-ui.ts';

const NOW = 1_000_000;
const RUNTIME = { now: NOW, mode: 'production' as const };
const hangar = (ships: Partial<Record<ShipId, number>>) => Object.fromEntries(SHIP_IDS.map((id) => [id, ships[id] ?? 0])) as Record<ShipId, number>;

function campaign(ships: Partial<Record<ShipId, number>>): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'REPEAT-WORLD01', playerName: 'Auditor' });
  const generated = createInitialSaveState('production', NOW, config);
  const home = generated.planets[generated.currentPlanetId]!;
  return { ...generated, planets: { ...generated.planets, [generated.currentPlanetId]: { ...home, fleet: { ...home.fleet, ships: hangar(ships) } } } };
}

function withColony(state: SaveState, id: string, system: number, ships: Partial<Record<ShipId, number>>): SaveState {
  const home = state.planets[state.currentPlanetId]!;
  return { ...state, planets: { ...state.planets, [id]: { ...home, name: `Колония ${system}`, universeSystem: system, universePosition: 3, fleet: { ...home.fleet, ships: hangar(ships) } } } };
}

test('«Повторить»: a sent deployment becomes the same command, and the repeat passes previewFlight', () => {
  const state = withColony(campaign({ transporter: 6 }), 'colony-a', 4, {});
  const origin = state.currentPlanetId;
  const sent = dispatchFlight(state, {
    requestId: 'deploy-1', missionId: 'deployment', originPlanetId: origin,
    destination: { kind: 'planet', planetId: 'colony-a', coordinate: { galaxy: 1, system: 4, position: 3 } },
    targetRelation: 'self', selectedShips: { transporter: 2 },
  }, RUNTIME);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(canRepeatFlight(sent.state, sent.flight), true);
  const plan = buildFlightRepeatPlan(sent.state, sent.flight)!;
  assert.equal(plan.originPlanetId, origin);
  assert.equal(plan.context.missionId, 'deployment');
  assert.deepEqual(plan.context.destination, { kind: 'planet', planetId: 'colony-a', coordinate: { galaxy: 1, system: 4, position: 3 } });
  assert.deepEqual(plan.ships, { transporter: 2 });
  const again = previewFlight(sent.state, {
    requestId: 'deploy-2', missionId: plan.context.missionId, originPlanetId: plan.originPlanetId,
    destination: plan.context.destination, targetRelation: plan.context.targetRelation, selectedShips: plan.ships,
  }, RUNTIME);
  assert.equal(again.ok, true);
});

test('«Повторить» is offered only for own routes from a planet the player still owns', () => {
  const state = campaign({ transporter: 4 });
  const sent = dispatchFlight(withColony(state, 'colony-a', 4, {}), {
    requestId: 'deploy-1', missionId: 'deployment', originPlanetId: state.currentPlanetId,
    destination: { kind: 'planet', planetId: 'colony-a', coordinate: { galaxy: 1, system: 4, position: 3 } },
    targetRelation: 'self', selectedShips: { transporter: 1 },
  }, RUNTIME);
  if (!sent.ok) throw new Error(sent.error.message);
  assert.equal(canRepeatFlight(sent.state, { ...sent.flight, ownerSide: 'npc' }), false);
  assert.equal(canRepeatFlight(sent.state, { ...sent.flight, missionId: 'colonize' }), false);
  assert.equal(canRepeatFlight(sent.state, { ...sent.flight, originPlanetId: 'lost-planet' }), false);
  assert.equal(canRepeatFlight(sent.state, { ...sent.flight, destination: { kind: 'operation', operationId: 'sun:1:4', coordinate: { galaxy: 1, system: 4, position: 0 } } }), false);
});

test('composition: «МАКС.» stays «all of it» on the new source, typed amounts are clamped', () => {
  const ids = ['cruiser', 'battleship', 'fighter'] as const;
  type Id = typeof ids[number];
  const carried = carryComposition<Id>({ cruiser: 60, battleship: 5 }, { cruiser: 60, battleship: 20 }, { cruiser: 30, battleship: 2, fighter: 9 }, ids);
  assert.deepEqual(carried, { cruiser: 30, battleship: 2 });
  const everything = carryComposition<Id>({ cruiser: 60, battleship: 20 }, { cruiser: 60, battleship: 20 }, { cruiser: 10, fighter: 9 }, ids);
  assert.deepEqual(everything, { cruiser: 10, fighter: 9 });
  assert.deepEqual(clampComposition<Id>({ cruiser: 60, battleship: 0 }, { cruiser: 12 }), { cruiser: 12 });
});

test('«Ещё с другой планеты»: nearest other planet with ships for the mission', () => {
  let state = campaign({ recycler: 1 });
  state = withColony(state, 'far', 30, { recycler: 3 });
  state = withColony(state, 'near', 6, { recycler: 2 });
  state = withColony(state, 'empty', 5, { transporter: 9 });
  const isRecycler = (id: ShipId) => id === 'recycler';
  const options = listSourcePlanets(state, isRecycler, { galaxy: 1, system: 5, position: 8 });
  assert.equal(options[0]!.id, 'empty');
  assert.equal(options[0]!.eligibleShips, 0);
  assert.equal(pickNextSourcePlanet(options, [state.currentPlanetId]), 'near');
  assert.equal(pickNextSourcePlanet(options, [state.currentPlanetId, 'near', 'far']), null);
});

test('favourites and the last own target are UI data with a forgiving save migration', () => {
  let ui = toggleFavoriteTarget(undefined, { coordinate: { galaxy: 1, system: 8, position: 14 }, name: 'Вейлора' });
  assert.deepEqual(ui.favoriteTargets, [{ coordinate: { galaxy: 1, system: 8, position: 14 }, name: 'Вейлора' }]);
  ui = toggleFavoriteTarget(ui, { coordinate: { galaxy: 1, system: 8, position: 14 } });
  assert.deepEqual(ui.favoriteTargets, []);
  for (let position = 1; position <= FLEET_FAVORITE_LIMIT + 3; position += 1) ui = toggleFavoriteTarget(ui, { coordinate: { galaxy: 1, system: 2, position } });
  assert.equal(ui.favoriteTargets.length, FLEET_FAVORITE_LIMIT);
  assert.equal(ui.favoriteTargets[0]!.coordinate.position, FLEET_FAVORITE_LIMIT + 3);
  ui = rememberOwnTarget(ui, 'deployment', 'helion-01');
  assert.deepEqual(migrateFleetUiState(JSON.parse(JSON.stringify(ui))), ui);
  assert.equal(migrateFleetUiState(undefined), undefined);
  assert.deepEqual(migrateFleetUiState({ favoriteTargets: [{ coordinate: { galaxy: 0, system: 1, position: 1 } }, 'junk', { coordinate: { galaxy: 1, system: 3, position: 4 }, name: 42 }], lastOwnTargets: { attack: 'x', transport: 7 } }),
    { favoriteTargets: [{ coordinate: { galaxy: 1, system: 3, position: 4 } }] });
});
