import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ALLIANCE_EMBLEM } from '../domain/command/catalog.ts';
import { acceptApplication, applyToAlliance, createAlliance } from '../domain/command/membership.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { NpcSunRaidPrepPlan } from '../domain/npc/sun-prep.ts';
import { sunRaidCapsOf } from '../domain/sun-raid/config.ts';
import type { SunBattleLogEntry } from '../domain/sun-raid/battle-log.ts';
import { validateSunRaidOrder } from '../domain/sun-raid/order.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';
import { npcSunPledgeFromPlanets } from './npc-endgame.ts';
import { composeNpcSunOrder, npcOrderForceForPlanet } from './npc-sun-order.ts';
import { createInitialSaveState } from './persistence.ts';
import { allianceSunRaces, currentSunRaidState, launchNpcSunRaid, selectRaidOrderFill } from './sun-raid.ts';

const NOW = Date.UTC(2026, 10, 9, 6);

function world() {
  const config = createDefaultNewGameConfig({ seed: 'NPC-SUN-ORDER', factionId: 'aegis', playerName: 'Order Test' });
  const state = createInitialSaveState('production', NOW, { ...config, world: { ...config.world, npcCount: 4, galaxyCount: 1 } });
  return { state, owners: Object.keys(state.npc!.profiles).sort() };
}

function home(state: SaveState, ownerId: string): SpyTargetState {
  return state.espionage!.targets![`${ownerId}-planet`]!;
}

function withFleet(state: SaveState, ownerId: string, ships: Partial<Record<ShipId, number>>, levels: Partial<Record<ShipId, number>>): SaveState {
  const planet = home(state, ownerId);
  const target: SpyTargetState = {
    ...planet,
    fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, ...ships } as typeof planet.fleet.ships },
    buildings: { ...planet.buildings, hangar: 40, 'gas-storage': 15 },
    resources: { ...planet.resources, gas: 30_000_000 },
    ownerProfile: { scienceLevels: planet.ownerProfile?.scienceLevels ?? {}, commanderLevels: {}, shipLevels: levels },
  };
  return { ...state, espionage: { ...state.espionage!, targets: { ...state.espionage!.targets, [target.id]: target } } };
}

function allied(state: SaveState, owners: readonly string[]): SaveState {
  const created = createAlliance(state.command, { ownerId: owners[0]!, displayName: home(state, owners[0]!).ownerName,
    settings: { name: 'Order Testers', tag: 'ORD', motto: '', description: '', emblem: DEFAULT_ALLIANCE_EMBLEM } }, { now: NOW, random: () => 0.4 });
  assert.ok(created.ok);
  let next: SaveState = { ...state, command: created.state };
  const allianceId = next.command.alliances.find((alliance) => alliance.leaderOwnerId === owners[0])!.id;
  for (const ownerId of owners.slice(1)) {
    const applied = applyToAlliance(next.command, { ownerId, displayName: home(next, ownerId).ownerName, allianceId }, { now: NOW, random: () => 0.4 });
    assert.ok(applied.ok);
    const accepted = acceptApplication(applied.state, owners[0]!, applied.applicationId, { now: NOW, random: () => 0.4 });
    assert.ok(accepted.ok);
    next = { ...next, command: accepted.state };
  }
  return next;
}

function plan(state: SaveState, owners: readonly string[]): NpcSunRaidPrepPlan {
  return {
    planId: 'plan:order-test', template: 'sun-raid-prep', ownerId: owners[0]!, status: 'active', phase: 'ready', createdAt: NOW, deadlineAt: NOW + 12 * 3_600_000,
    allianceId: state.command.alliances[0]!.id, galaxy: 1, system: 30, gatherAt: NOW, postponed: 0,
    rsvps: Object.fromEntries(owners.map((ownerId) => [ownerId, { answer: 'yes', population: 40_000, at: NOW }])),
    forecast: { win: 0.6, gain: 1, loss: 1, readyAt: NOW }, knowledgeAt: NOW,
  } as unknown as NpcSunRaidPrepPlan;
}

/** Three members: strong upgraded hulls plus a pile of level-0 small craft each. */
function armedTeam() {
  const { state: initial, owners } = world();
  const team = owners.slice(0, 3);
  let state = allied(initial, team);
  for (const ownerId of team) {
    state = withFleet(state, ownerId, { battleship: 1500, destroyer: 400, scout: 20_000, cruiser: 3000 }, { battleship: 9, destroyer: 8, scout: 0, cruiser: 0 });
  }
  return { state, team };
}

test('a bot launcher orders its members\' best upgraded hulls, leaves level-0 filler out and stays within the alliance races', () => {
  const { state, team } = armedTeam();
  const caps = sunRaidCapsOf(state);
  const chosen = composeNpcSunOrder(state, plan(state, team), caps)!;
  assert.ok(chosen, 'an order is composed');
  assert.equal(validateSunRaidOrder(chosen.order, { perSide: caps.perSide, races: allianceSunRaces(state, state.command.alliances[0]!.id) }), null);
  const ships = chosen.order.slots.filter((slot) => slot.kind === 'ship');
  assert.ok(ships.length > 0);
  assert.ok(ships.every((slot) => slot.kind === 'ship' && slot.entityId !== 'scout'), `no scouts ordered: ${JSON.stringify(ships)}`);
  assert.ok(ships.every((slot) => slot.kind === 'ship' && (slot.minLevel ?? 0) >= 8), 'only the upgraded hulls get exact slots');
  assert.deepEqual(composeNpcSunOrder(state, plan(state, team), caps), chosen, 'deterministic');

  // Experience: a logged win of destroyers against the expected defence makes them weigh more.
  const won: SunBattleLogEntry = { id: 'old', at: NOW - 1, g: 1, s: 30, allianceId: 'x', tag: 'X', ordered: true, winner: 'attacker', rounds: 5,
    attack: { rows: [{ f: 'aegis', e: 'destroyer', l: 8, n: 100, p: 3000 }], owners: 1, groups: 1, population: 3000, lost: 0, bonuses: [] },
    defence: { rows: [{ f: 'synod', e: 'battleship', l: 10, n: 100, p: 1300 }], owners: 1, groups: 1, population: 1300, lost: 1300, bonuses: [] } };
  const learned: SaveState = { ...state, sunRaid: { ...currentSunRaidState(state), battleLog: [won] } };
  const withExperience = composeNpcSunOrder(learned, plan(learned, team), caps)!;
  assert.equal(withExperience.experience.battles, 1);
  assert.equal(withExperience.experience.multipliers.destroyer, 1.25);
});

test('members fill only the open slots of an ordered raid: no ship outside the order leaves home', () => {
  const { state: armed, team } = armedTeam();
  const caps = sunRaidCapsOf(armed);
  const { order } = composeNpcSunOrder(armed, plan(armed, team), caps)!;
  const leader = team[0]!;
  const origin = home(armed, leader);
  const ships = npcOrderForceForPlanet(armed, leader, origin, caps.participant, order);
  assert.ok(Object.keys(ships).length > 0);
  const options = { now: NOW, mode: 'production' as const, timeScale: 1 };
  const state = launchNpcSunRaid(armed, leader, { galaxy: 1, system: 30, originPlanetId: origin.id, ships, requestId: 'npc-order-launch', order }, options);
  assert.ok(state.ok, state.ok ? '' : state.error);
  const raidId = state.raidId!;
  let next = state.state;
  for (const ownerId of team.slice(1)) next = npcSunPledgeFromPlanets(next, ownerId, raidId, 1, `join:${ownerId}`, options).state;
  const raid = currentSunRaidState(next).raids.find((item) => item.id === raidId)!;
  const flights = next.flights.records.filter((flight) => flight.sunRaid?.raidId === raidId);
  assert.ok(flights.length >= 3, 'every member pledged');
  for (const flight of flights) assert.equal(flight.selectedShips.scout ?? 0, 0, 'no level-0 scouts in the raid');
  const fill = selectRaidOrderFill(next, raid);
  for (const slot of raid.order!.slots) {
    const used = fill.get(slot.kind === 'any' ? 'any' : `${slot.factionId}:${slot.entityId}`) ?? 0;
    assert.ok(used <= (slot.kind === 'any' ? slot.population : slot.count), 'no slot over its size');
  }
  assert.ok(['gathering', 'incoming'].includes(raid.status));
});
