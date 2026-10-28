import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState } from './persistence.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import {
  createUniverseMap,
  getUniverseActionState,
  getUniverseNodeCaption,
  getUniverseOwnerRelation,
  getUniverseTransportLaunchTarget,
} from '../domain/universe/runtime.ts';
import { dispatchFlight } from './flights.ts';
import type { SaveState } from './contracts.ts';

const NOW = 1_000_000;

/** Fresh Production campaign (audit seed) with one scout to reach dispatch validation. */
function campaign(): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'AUDIT-WORLD001', playerName: 'Auditor' });
  const generated = createInitialSaveState('production', NOW, config);
  const home = generated.planets[generated.currentPlanetId]!;
  return { ...generated, planets: { ...generated.planets, [generated.currentPlanetId]: { ...home, fleet: { ...home.fleet, ships: { ...home.fleet.ships, scout: 1 } } } } };
}

/** The map node and relation exactly as UniverseView computes them. */
function mapTarget(state: SaveState) {
  const target = Object.values(state.espionage?.targets ?? {}).find((candidate) => candidate.ownerId.startsWith('npc-gen-'))!;
  const playerPlanets = Object.entries(state.planets).map(([id, planet]) => ({
    id, coordinate: { galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1, position: planet.universePosition ?? 1 },
    name: planet.name, art: 'planet-default', isHomeworld: id === 'helion-01', ownerId: state.profile.playerId,
  }));
  const registeredPlanets = Object.values(state.espionage?.targets ?? {}).map((item) => ({
    id: item.id, coordinate: item.coordinate, name: item.name, kind: item.kind ?? 'npc', ownerId: item.ownerId,
  }));
  const map = createUniverseMap({
    mode: 'production', galaxy: target.coordinate.galaxy, galaxyCount: state.worldConfig?.world.galaxyCount ?? 1,
    currentOwnerId: state.profile.playerId, currentPlanetName: state.planets[state.currentPlanetId]!.name,
    playerPlanets, registeredPlanets, nowMs: NOW,
  } as Parameters<typeof createUniverseMap>[0]);
  const node = map.systems[target.coordinate.system - 1]!.positions.find((item) => item.id === target.id)!;
  const owner = { id: target.ownerId, displayName: target.ownerName, raceId: target.raceId, alliance: null, planetIds: [target.id] };
  const relation = getUniverseOwnerRelation(node, state.profile.playerId, undefined, owner as never, []);
  return { target, node, relation };
}

function transport(state: SaveState, launch: ReturnType<typeof getUniverseTransportLaunchTarget>, requestId: string) {
  return dispatchFlight(state, {
    requestId, missionId: 'transport', originPlanetId: state.currentPlanetId,
    destination: { kind: 'planet', planetId: launch.planetId, coordinate: launch.coordinate },
    targetRelation: launch.relation, selectedShips: { scout: 1 }, cargo: { metal: 1, minerals: 0, gas: 0, debris: 0 }, departedAt: NOW,
  }, { now: NOW, mode: 'production' });
}

test('F-03: map → transport to a neutral generated planet keeps «neutral» and is accepted', () => {
  const state = campaign();
  const { node, relation } = mapTarget(state);
  assert.equal(relation, 'neutral');
  assert.equal(getUniverseActionState('fleet', node, state.profile.playerId, relation).enabled, true);
  const launch = getUniverseTransportLaunchTarget(node, relation);
  assert.equal(launch.relation, 'neutral');
  const sent = transport(state, launch, 'map-neutral');
  assert.equal(sent.ok, true, sent.ok ? '' : sent.error.message);
});

test('F-03: own planet goes as «self»; a stale or wrong relation is refused with nothing spent', () => {
  const state = campaign();
  const homeId = state.currentPlanetId;
  const home = state.planets[homeId]!;
  const ownNode = { id: homeId, coordinate: { galaxy: home.universeGalaxy ?? 1, system: home.universeSystem ?? 1, position: home.universePosition ?? 1 } };
  const { node, relation } = mapTarget(state);
  const own = getUniverseTransportLaunchTarget(ownNode, 'self');
  assert.equal(own.relation, 'self');

  // The pre-fix map sent «ally» for this neutral world: refused before any debit.
  const stale = transport(state, getUniverseTransportLaunchTarget(node, 'ally'), 'map-stale-ally');
  assert.equal(stale.ok, false);
  assert.equal(stale.state, state, 'no resources or ships are taken on refusal');
  assert.equal(relation, 'neutral');
});

test('F-03 / NPC readiness: a foreign homeworld is captioned with its owner and is not «self» for map actions', () => {
  const foreignHome = { id: 'npc-capital', coordinate: { galaxy: 1, system: 3, position: 1 }, kind: 'npc' as const,
    name: 'Столица', art: '', ownerId: 'npc-gen-01', isHomeworld: true, statusLabel: '', description: '' };
  const relation = getUniverseOwnerRelation(foreignHome, 'player-current');
  assert.equal(relation, 'neutral');
  assert.equal(getUniverseActionState('attack', foreignHome, 'player-current', relation).enabled, true);
  assert.equal(getUniverseActionState('fleet', foreignHome, 'player-current', relation).reason === 'Своя планета принимает транспортировку.', false);
  assert.equal(getUniverseNodeCaption(foreignHome, 'Игрок', 'Владыка NPC', 'player-current'), '★ Владыка NPC');
  assert.equal(getUniverseNodeCaption({ ...foreignHome, ownerId: 'player-current' }, 'Игрок', 'x', 'player-current'), '★ Игрок');
});

test('Map captions name the owner where the player expects one; own colonies keep their planet names', () => {
  const colony = { id: 'colony', coordinate: { galaxy: 1, system: 4, position: 6 }, kind: 'npc' as const,
    name: 'Зефирия', art: '', ownerId: 'npc-gen-02', isHomeworld: false, statusLabel: '', description: '' };
  assert.equal(getUniverseNodeCaption(colony, 'Игрок', 'Vexix', 'player-current'), 'Vexix');
  const foreignPlayerColony = { ...colony, kind: 'player' as const, ownerId: 'player-other' };
  assert.equal(getUniverseNodeCaption(foreignPlayerColony, 'Игрок', 'Соперник', 'player-current'), 'Соперник');
  const ownColony = { ...colony, kind: 'player' as const, ownerId: 'player-current' };
  assert.equal(getUniverseNodeCaption(ownColony, 'Игрок', 'Игрок', 'player-current'), 'Зефирия');
});
