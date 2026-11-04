import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState } from './persistence.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import { SHIP_IDS, type ShipId } from '../domain/combat/ids.ts';
import type { UniversePlanetNode } from '../domain/universe/types.ts';
import { getPlanetResources, type SaveState } from './contracts.ts';
import { dispatchFlight, recallFlight, reconcileFlights, type DispatchFlightCommand } from './flights.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { serializeSaveForStorage, loadSavedState } from './persistence.ts';
import { cargoHullsOnPlanet, pickCargoShips, type CargoHull } from './empire.ts';
import { emptyTransportCargo, getCargoFieldMaximum, getFleetCargoCapacity } from '../domain/flights/cargo.ts';
import { getSunDebris, sunDebrisLedgerKey } from './sun-raid.ts';
import {
  QUICK_ACTION_LABELS,
  buildQuickCommand,
  defaultQuickFleet,
  isMultiSourceAction,
  planQuickLegs,
  sendQuickLegs,
  evaluateQuickActions,
  listQuickActions,
  planQuickSend,
  previewQuickCommand,
  quickOriginCandidates,
  type QuickTarget,
} from './quick-actions.ts';

const NOW = 1_000_000;
const RUNTIME = { now: NOW, mode: 'production' as const };
const hangar = (ships: Partial<Record<ShipId, number>>) => Object.fromEntries(SHIP_IDS.map((id) => [id, ships[id] ?? 0])) as Record<ShipId, number>;

function campaign(ships: Partial<Record<ShipId, number>> = {}): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'AUDIT-WORLD001', playerName: 'Auditor' });
  const generated = createInitialSaveState('production', NOW, config);
  const home = generated.planets[generated.currentPlanetId]!;
  return { ...generated, planets: { ...generated.planets, [generated.currentPlanetId]: { ...home, fleet: { ...home.fleet, ships: hangar(ships) } } } };
}

/** Another own planet in another system with its own hangar. */
function withColony(state: SaveState, system: number, ships: Partial<Record<ShipId, number>>, id = 'colony-quick'): SaveState {
  const home = state.planets[state.currentPlanetId]!;
  return { ...state, planets: { ...state.planets, [id]: { ...home, name: `Колония ${system}`, universeSystem: system, universePosition: 3, fleet: { ...home.fleet, ships: hangar(ships) } } } };
}

function node(kind: UniversePlanetNode['kind'], extra: Partial<UniversePlanetNode> = {}): UniversePlanetNode {
  return { id: `${kind}-node`, kind, name: kind, art: '', statusLabel: '', description: '', coordinate: { galaxy: 1, system: 9, position: 7 }, ...extra };
}

const ids = (target: QuickTarget, owner = 'player-1') => listQuickActions(target, owner).map((action) => action.id);

test('asteroid: colonize only over a free position, the recycler always', () => {
  const asteroid = node('asteroid', { asteroid: { spawnIndex: 4 } as UniversePlanetNode['asteroid'] });
  assert.deepEqual(ids({ node: asteroid, underlyingKind: 'empty' }), ['colonize', 'gas']);
  assert.deepEqual(ids({ node: asteroid, underlyingKind: 'npc' }), ['gas']);
});

test('planets: foreign → spy, attack, transport; own → transport, rebase; ally → transport; debris adds the recycler', () => {
  const owner = { id: 'npc-1', displayName: 'Nyxax' };
  const foreign = node('npc', { ownerId: 'npc-1' });
  assert.deepEqual(ids({ node: foreign, relation: 'neutral', owner }), ['spy', 'attack', 'transport']);
  assert.deepEqual(ids({ node: foreign, relation: 'enemy', owner, orbitalDebris: 500 }), ['spy', 'attack', 'transport', 'recycle']);
  assert.deepEqual(ids({ node: node('player', { ownerId: 'player-1' }), relation: 'self' }), ['transport', 'deployment']);
  assert.deepEqual(ids({ node: node('player', { ownerId: 'friend' }), relation: 'ally', owner: { id: 'friend', displayName: 'Друг' } }), ['transport']);
});

test('empty slot and debris: colonize, plus the recycler when debris lies there', () => {
  assert.deepEqual(ids({ node: node('empty') }), ['colonize']);
  assert.deepEqual(ids({ node: node('empty'), orbitalDebris: 1 }), ['colonize', 'recycle']);
  assert.deepEqual(ids({ node: node('uninhabited') }), []);
  assert.deepEqual(ids({ node: node('uninhabited'), orbitalDebris: 10 }), ['recycle']);
});

test('unique object: probe and expedition when free, attack when occupied, reasons when out of range', () => {
  const unique = node('unique');
  assert.deepEqual(ids({ node: unique, explorationStatus: 'free' }), ['exploration-recon', 'expedition']);
  assert.deepEqual(ids({ node: unique, explorationStatus: 'occupied' }), ['exploration-recon', 'exploration-attack']);
  const out = listQuickActions({ node: unique }, 'player-1');
  assert.equal(out[0]!.enabled, false);
  assert.match(out[0]!.reason!, /пяти систем/);
  assert.equal(out[1]!.enabled, false);
  const own = listQuickActions({ node: unique, explorationStatus: 'self' }, 'player-1');
  assert.equal(own[1]!.reason, 'Ваш флот уже добывает здесь.');
});

test('pirate base: the contact\'s own disabled reasons are shown', () => {
  const pirate = {
    contactCycleKey: 'c-1', latestReportId: null,
    recon: { enabled: true, disabledReason: null },
    elimination: { enabled: false, disabledReason: 'Пиратский рейд доступен только в системах с вашей колонией.' },
  };
  const actions = listQuickActions({ node: node('pirate'), pirate }, 'player-1');
  assert.deepEqual(actions.map((action) => [action.id, action.enabled]), [['pirate-recon', true], ['pirate-elimination', false], ['pirate-report', false]]);
  assert.equal(actions[1]!.reason, pirate.elimination.disabledReason);
  assert.equal(actions[2]!.reason, 'Разведотчёт ещё не сформирован.');
});

test('default fleet: one probe for spying, recyclers sized to the debris, all recyclers for hidden gas', () => {
  const state = campaign({ 'spy-probe': 4, recycler: 9, cruiser: 3, transporter: 2 });
  const home = state.currentPlanetId;
  const cargo = getFactionShipCatalog(state.profile.factionId as CombatFactionId).find((ship) => ship.id === 'recycler')!.ship!.cargo;
  assert.deepEqual(defaultQuickFleet(state, 'spy', home, { node: node('npc') }).ships, { 'spy-probe': 1 });
  assert.deepEqual(defaultQuickFleet(state, 'recycle', home, { node: node('empty'), orbitalDebris: cargo * 2 + 1 }).ships, { recycler: 3 });
  assert.deepEqual(defaultQuickFleet(state, 'recycle', home, { node: node('empty'), orbitalDebris: cargo * 100 }).ships, { recycler: 9 });
  assert.deepEqual(defaultQuickFleet(state, 'gas', home, { node: node('asteroid') }).ships, { recycler: 9 });
  assert.deepEqual(defaultQuickFleet(state, 'colonize', home, { node: node('empty') }).ships, {});
});

test('default fleet: warships only for attack, cargo hulls for expedition and transport', () => {
  const state = campaign({ 'spy-probe': 4, recycler: 2, cruiser: 3, scout: 5, transporter: 2, colonizer: 1 });
  const home = state.currentPlanetId;
  assert.deepEqual(defaultQuickFleet(state, 'attack', home, { node: node('npc') }).ships, { cruiser: 3, scout: 5 });
  assert.deepEqual(defaultQuickFleet(state, 'expedition', home, { node: node('unique') }).ships, { transporter: 2, recycler: 2 });
  assert.deepEqual(defaultQuickFleet(state, 'transport', home, { node: node('player') }).ships, { transporter: 2 });
  assert.equal(defaultQuickFleet(state, 'deployment', home, { node: node('player') }).ships['solar-satellite'], undefined);
});

test('source planet: the nearest one with suitable ships, never the target itself', () => {
  const home = campaign({});
  const homeSystem = home.planets[home.currentPlanetId]!.universeSystem ?? 1;
  const target: QuickTarget = { node: node('empty', { coordinate: { galaxy: 1, system: homeSystem, position: 20 } }) };
  // A farther colony has the only colonizer: it is chosen although the homeworld is nearer.
  const state = withColony(home, homeSystem + 6, { colonizer: 1 });
  assert.equal(quickOriginCandidates(state, 'colonize', target)[0], home.currentPlanetId);
  const plan = planQuickSend(state, 'colonize', target, RUNTIME);
  assert.equal(plan.originPlanetId, 'colony-quick');
  assert.deepEqual(plan.fleet.ships, { colonizer: 1 });
  assert.equal(plan.command?.missionId, 'colonize');
  assert.ok(plan.command?.destination && plan.command.destination.kind === 'coordinate');
  const ownTarget: QuickTarget = { node: node('player', { id: 'colony-quick', ownerId: home.profile.playerId }), relation: 'self' };
  assert.ok(!quickOriginCandidates(state, 'transport', ownTarget).includes('colony-quick'));
});

test('no free ships anywhere: the menu disables the action with a plain reason', () => {
  const state = campaign({});
  const plan = planQuickSend(state, 'gas', { node: node('asteroid') }, RUNTIME);
  assert.equal(plan.originPlanetId, null);
  assert.equal(plan.error, 'Нет свободных переработчиков ни на одной вашей планете.');
});

test('menu verdict comes from the flight runtime: spy on a generated neutral planet', () => {
  const target = Object.values(campaign().espionage?.targets ?? {}).find((candidate) => candidate.ownerId.startsWith('npc-gen-'))!;
  const quick: QuickTarget = {
    node: node('npc', { id: target.id, name: target.name, ownerId: target.ownerId, coordinate: target.coordinate }),
    relation: 'neutral', owner: { id: target.ownerId, displayName: target.ownerName, raceId: target.raceId },
  };
  const ready = evaluateQuickActions(campaign({ 'spy-probe': 2 }), quick, RUNTIME).find((action) => action.id === 'spy')!;
  assert.equal(ready.enabled, true, ready.reason);
  assert.equal(ready.plan?.preview?.ok, true);
  assert.deepEqual(ready.plan?.command?.selectedShips, { 'spy-probe': 1 });
  assert.equal(ready.plan?.command?.missionId, 'espionage');
  assert.equal(ready.plan?.command?.targetOwnerId, target.ownerId);
  const empty = evaluateQuickActions(campaign({}), quick, RUNTIME).find((action) => action.id === 'spy')!;
  assert.equal(empty.enabled, false);
  assert.equal(empty.reason, 'Нет свободного шпионского зонда ни на одной вашей планете.');
});

function neutralTarget(state: SaveState): QuickTarget {
  const target = Object.values(state.espionage?.targets ?? {}).find((candidate) => candidate.ownerId.startsWith('npc-gen-'))!;
  return {
    node: node('npc', { id: target.id, name: target.name, ownerId: target.ownerId, coordinate: target.coordinate }),
    relation: 'neutral', owner: { id: target.ownerId, displayName: target.ownerName, raceId: target.raceId },
  };
}

test('multi-source: every planet with suitable ships is a leg with its own arrival', () => {
  const home = campaign({ transporter: 2 });
  const homeSystem = home.planets[home.currentPlanetId]!.universeSystem ?? 1;
  const state = withColony(withColony(home, homeSystem + 4, { transporter: 3 }, 'colony-a'), homeSystem + 8, { 'spy-probe': 1 }, 'colony-b');
  const legs = planQuickLegs(state, 'transport', neutralTarget(state), RUNTIME);
  // Any ship with a hold may carry cargo, so the probe planet is a leg too.
  assert.deepEqual(legs.map((leg) => leg.originPlanetId).sort(), [home.currentPlanetId, 'colony-a', 'colony-b'].sort());
  for (const leg of legs) assert.equal(leg.preview?.ok, true, leg.error);
  assert.equal(isMultiSourceAction('attack'), true);
  assert.equal(isMultiSourceAction('spy'), false);
  assert.equal(isMultiSourceAction('colonize'), false);
});

test('multi-source send: all legs go through dispatchFlight; a refused leg spends nothing', () => {
  const home = campaign({ transporter: 2 });
  const homeSystem = home.planets[home.currentPlanetId]!.universeSystem ?? 1;
  const state = withColony(home, homeSystem + 4, { transporter: 3 }, 'colony-a');
  const target = neutralTarget(state);
  const cargo = { metal: 10, minerals: 0, gas: 0, debris: 0 };
  const commands = [home.currentPlanetId, 'colony-a'].map((origin) =>
    buildQuickCommand(state, 'transport', target, origin, defaultQuickFleet(state, 'transport', origin, target), RUNTIME, cargo)!);
  const overbooked = { ...commands[1]!, requestId: 'overbooked', selectedShips: { transporter: 99 } };
  const { state: next, outcomes } = sendQuickLegs(state, [...commands, overbooked], RUNTIME, dispatchFlight);
  assert.deepEqual(outcomes.map((outcome) => outcome.result.ok), [true, true, false]);
  assert.equal(next.flights.records.filter((flight) => flight.missionId === 'transport').length, 2);
  assert.equal(next.currentPlanetId, state.currentPlanetId);
});

test('multi-source rebase: each leg leaves from its planet, the header planet stays selected', () => {
  const home = campaign({});
  const homeSystem = home.planets[home.currentPlanetId]!.universeSystem ?? 1;
  const state = withColony(withColony(home, homeSystem + 3, { cruiser: 2 }, 'colony-a'), homeSystem + 6, { scout: 4 }, 'colony-b');
  const target: QuickTarget = { node: node('player', { id: home.currentPlanetId, ownerId: home.profile.playerId, coordinate: { galaxy: 1, system: homeSystem, position: home.planets[home.currentPlanetId]!.universePosition ?? 1 } }), relation: 'self' };
  const legs = planQuickLegs(state, 'deployment', target, RUNTIME);
  assert.deepEqual(legs.map((leg) => leg.originPlanetId).sort(), ['colony-a', 'colony-b']);
  for (const leg of legs) assert.equal(leg.preview?.ok, true, leg.error);
  const { state: next, outcomes } = sendQuickLegs(state, legs.map((leg) => leg.command!), RUNTIME, dispatchFlight);
  assert.deepEqual(outcomes.map((outcome) => outcome.result.ok), [true, true], outcomes.map((o) => (o.result.ok ? '' : o.result.error.message)).join(' | '));
  assert.equal(next.currentPlanetId, home.currentPlanetId);
  assert.deepEqual(next.flights.records.filter((flight) => flight.missionId === 'deployment').map((flight) => flight.originPlanetId).sort(), ['colony-a', 'colony-b']);
});

test('a refusal a smaller fleet can fix keeps the action open for adjusting', () => {
  const base = campaign({ transporter: 100 });
  const home = base.planets[base.currentPlanetId]!;
  const state = { ...base, gas: 3, planets: { ...base.planets, [base.currentPlanetId]: { ...home, resources: { ...(home.resources ?? { metal: 0, minerals: 0 }), gas: 3 } as typeof home.resources } } } as SaveState;
  const transport = evaluateQuickActions(state, neutralTarget(state), RUNTIME).find((action) => action.id === 'transport')!;
  assert.equal(transport.plan?.preview?.ok, false);
  assert.equal(transport.plan?.preview && !transport.plan.preview.ok ? transport.plan.preview.error.code : '', 'insufficient-gas');
  assert.equal(transport.enabled, true, 'the panel opens so the fleet can be reduced');
  assert.match(transport.adjust ?? '', /газ/i);
  const smaller = buildQuickCommand(state, 'transport', neutralTarget(state), state.currentPlanetId, { ships: { transporter: 1 } }, RUNTIME);
  assert.equal(dispatchFlight(state, smaller!, { now: NOW, mode: 'production' }).ok, true);
});

test('a Sun\'s debris: recyclers sized to it, the flight goes to the Sun\'s operation and the runtime accepts it', () => {
  const state = campaign({ recycler: 50 });
  const home = state.currentPlanetId;
  // As «Найти обломки» builds it: the route is the system's first position.
  const coordinate = { galaxy: state.planets[home]!.universeGalaxy ?? 1, system: state.planets[home]!.universeSystem ?? 1, position: 1 };
  const target: QuickTarget = {
    node: { id: `debris:${coordinate.system}`, kind: 'empty', name: 'Обломки Солнца', art: '', statusLabel: '', description: '', coordinate },
    orbitalDebris: 1,
    sun: { galaxy: coordinate.galaxy, system: coordinate.system },
  };
  assert.deepEqual(defaultQuickFleet(state, 'recycle', home, target).ships, { recycler: 1 });
  const command = buildQuickCommand(state, 'recycle', target, home, { ships: { recycler: 1 } }, RUNTIME)!;
  assert.equal(command.operationId, `sun:${coordinate.galaxy}:${coordinate.system}`);
  assert.equal(command.destination?.kind, 'operation');
  assert.equal(command.targetKind, 'empty');
  const empty = previewQuickCommand(state, command, RUNTIME);
  assert.equal(empty.ok ? '' : empty.error.code, 'target-not-available');
  const ledgerKey = sunDebrisLedgerKey(coordinate.galaxy, coordinate.system);
  const withDebris = { ...state, espionage: { ...state.espionage, orbitalDebris: { ...state.espionage?.orbitalDebris, [ledgerKey]: { debris: 1 } } } } as SaveState;
  assert.equal(getSunDebris(withDebris, coordinate.galaxy, coordinate.system), 1);
  assert.equal(previewQuickCommand(withDebris, command, RUNTIME).ok, true);
  // The panel opens through these two; they must accept the Sun target as well.
  assert.ok(evaluateQuickActions(withDebris, target, RUNTIME).find((action) => action.id === 'recycle')?.enabled);
  assert.deepEqual(planQuickLegs(withDebris, 'recycle', target, RUNTIME).map((leg) => leg.originPlanetId), [home]);
});

// Cargo in the quick-send panel: the fleet screen's own limits (stock of the source, shared hold).
function withStock(state: SaveState, planetId: string, stock: { metal?: number; minerals?: number; gas?: number; debris?: number }): SaveState {
  const planet = state.planets[planetId]!;
  const resources = { metal: stock.metal ?? 0, minerals: stock.minerals ?? 0, gas: stock.gas ?? 100_000 };
  // The selected planet's wallet lives in the root fields.
  return { ...state, ...(planetId === state.currentPlanetId ? resources : {}), planets: { ...state.planets, [planetId]: { ...planet,
    resources, recycling: { ...planet.recycling, availableDebris: stock.debris ?? 0 } } } };
}

test('transport from the panel carries debris, within the hold and the planet\'s debris stock', () => {
  const base = withStock(campaign({ transporter: 2 }), campaign().currentPlanetId, { metal: 50_000, debris: 300 });
  const origin = base.currentPlanetId;
  const target = neutralTarget(base);
  const fleet = defaultQuickFleet(base, 'transport', origin, target);
  assert.equal(getCargoFieldMaximum('debris', emptyTransportCargo(), base.planets[origin]!.resources!, 300, 1_000_000), 300, 'debris is limited by the stock');
  const command = buildQuickCommand(base, 'transport', target, origin, fleet, RUNTIME, { metal: 0, minerals: 0, gas: 0, debris: 250 })!;
  const { state: next, outcomes } = sendQuickLegs(base, [command], RUNTIME, dispatchFlight);
  assert.equal(outcomes[0]!.result.ok, true);
  const flight = next.flights.records.find((record) => record.missionId === 'transport')!;
  assert.equal(flight.cargo?.debris, 250);
  assert.equal(next.planets[origin]!.recycling.availableDebris, 50, 'the debris left the planet with the fleet');
});

test('shared hold: cargo beyond the fleet\'s capacity or the debris stock never leaves', () => {
  const base = withStock(campaign({ transporter: 1 }), campaign().currentPlanetId, { metal: 500_000, debris: 100 });
  const origin = base.currentPlanetId;
  const target = neutralTarget(base);
  const fleet = defaultQuickFleet(base, 'transport', origin, target);
  const capacity = getFleetCargoCapacity(fleet.ships, Object.fromEntries(getFactionShipCatalog(base.profile.factionId as CombatFactionId).map((e) => [e.id, { cargo: e.ship?.cargo ?? 0 }])));
  assert.ok(capacity > 0);
  const huge = buildQuickCommand(base, 'transport', target, origin, fleet, RUNTIME, { metal: capacity * 10, minerals: 0, gas: 0, debris: 10_000 })!;
  const { state: next } = sendQuickLegs(base, [huge], RUNTIME, dispatchFlight);
  const flight = next.flights.records.find((record) => record.missionId === 'transport');
  const carried = flight ? Object.values(flight.cargo ?? {}).reduce((sum, value) => sum + value, 0) : 0;
  assert.ok(carried <= capacity, `carried ${carried} of hold ${capacity}`);
  assert.ok((flight?.cargo?.debris ?? 0) <= 100);
  // The panel's slider limit already accounts for what the other fields hold.
  assert.equal(getCargoFieldMaximum('debris', { metal: capacity, minerals: 0, gas: 0, debris: 0 }, base.planets[origin]!.resources!, 100, capacity), 0);
});

test('player-facing name of the rebase mission is «Дислокация»', () => {
  assert.equal(QUICK_ACTION_LABELS.deployment, 'Дислокация');
});

// «Дислокация» with cargo (owner rule 04.11.2026): resources ride along, up to the hold.
function planetCoord(state: SaveState, id: string) {
  const p = state.planets[id]!;
  return { galaxy: p.universeGalaxy ?? 1, system: p.universeSystem ?? 1, position: p.universePosition ?? 1 };
}

function deploymentSetup(stock = 50_000) {
  const base = withStock(campaign({ transporter: 5 }), campaign().currentPlanetId, { metal: stock, gas: 100_000, debris: 300 });
  const home = base.currentPlanetId;
  const homeSystem = base.planets[home]!.universeSystem ?? 1;
  const state = withColony(base, homeSystem + 3, {}, 'colony-a');
  const colony = state.planets['colony-a']!;
  const withRoom: SaveState = { ...state, planets: { ...state.planets, 'colony-a': { ...colony, buildings: { ...colony.buildings, hangar: 25 }, resources: { metal: 0, minerals: 0, gas: 0 } } } };
  const capacity = getFleetCargoCapacity({ transporter: 2 }, Object.fromEntries(getFactionShipCatalog(base.profile.factionId as CombatFactionId).map((e) => [e.id, { cargo: e.ship?.cargo ?? 0 }])));
  const command = (cargo: Partial<Record<'metal' | 'minerals' | 'gas' | 'debris', number>>, id = 'dep'): DispatchFlightCommand => ({
    missionId: 'deployment', requestId: id, originPlanetId: home, selectedShips: { transporter: 2 }, selectedCommanders: {},
    destination: { kind: 'planet', planetId: 'colony-a', coordinate: planetCoord(withRoom, 'colony-a') }, targetRelation: 'self',
    cargo: { metal: 0, minerals: 0, gas: 0, debris: 0, ...cargo }, departedAt: NOW,
  });
  return { state: withRoom, home, capacity, command };
}

test('deployment takes cargo at departure and lands it with the fleet', () => {
  const { state, home, command } = deploymentSetup();
  const sent = dispatchFlight(state, command({ metal: 4_000, debris: 100 }), { now: NOW, mode: 'production' });
  assert.equal(sent.ok, true, sent.ok ? '' : sent.error.message);
  if (!sent.ok) return;
  assert.equal(sent.flight.cargo?.metal, 4_000);
  assert.equal(getPlanetResources(sent.state, home).metal, getPlanetResources(state, home).metal - 4_000);
  const arrived = reconcileFlights(sent.state, sent.flight.arrivalAt);
  const flight = arrived.state.flights.records.find((record) => record.id === sent.flight.id)!;
  assert.equal(flight.phase, 'completed');
  assert.equal(flight.cargoState, 'delivered');
  assert.equal(arrived.state.planets['colony-a']!.resources!.metal, 4_000);
  assert.equal(arrived.state.planets['colony-a']!.recycling.availableDebris, state.planets['colony-a']!.recycling.availableDebris + 100);
  assert.equal(arrived.state.planets['colony-a']!.fleet.ships.transporter, 2, 'the fleet arrives together with the cargo');
});

test('deployment without cargo keeps the record as before (no cargo fields)', () => {
  const { state, command } = deploymentSetup();
  const sent = dispatchFlight(state, command({}), { now: NOW, mode: 'production' });
  assert.equal(sent.ok, true);
  if (sent.ok) { assert.equal(sent.flight.cargo, undefined); assert.equal(sent.flight.cargoState, undefined); }
});

test('deployment cargo beyond the hold or the stock is cut down, never more leaves', () => {
  const { state, capacity, command } = deploymentSetup(1_000_000);
  const sent = dispatchFlight(state, command({ metal: capacity * 10, minerals: 5 }), { now: NOW, mode: 'production' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(Object.values(sent.flight.cargo!).reduce((sum, value) => sum + value, 0), capacity);
});

test('gas cargo and fuel come from one stock for a deployment too', () => {
  const { state, home, command } = deploymentSetup();
  const poor = withStock(state, home, { metal: 1000, gas: 300 });
  const sent = dispatchFlight(poor, command({ gas: 300 }), { now: NOW, mode: 'production' });
  assert.equal(sent.ok, false);
  assert.match(sent.ok ? '' : sent.error.message, /газ/i);
});

test('recall brings the deployment cargo back to the origin with the fleet', () => {
  const { state, home, command } = deploymentSetup();
  const sent = dispatchFlight(state, command({ metal: 3_000 }), { now: NOW, mode: 'production' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const recalled = recallFlight(sent.state, sent.flight.id, { now: NOW + 5_000, mode: 'production' });
  assert.equal(recalled.ok, true);
  if (!recalled.ok) return;
  const back = reconcileFlights(recalled.state, recalled.flight.returnAt!);
  const flight = back.state.flights.records.find((record) => record.id === sent.flight.id)!;
  assert.equal(flight.phase, 'completed');
  assert.equal(flight.cargoState, 'returned');
  assert.equal(getPlanetResources(back.state, home).metal, getPlanetResources(state, home).metal);
  assert.equal(back.state.planets['colony-a']!.resources!.metal, 0);
  assert.equal(back.state.planets[home]!.fleet.ships.transporter, 5);
});

test('full storage on arrival: what the target cannot hold burns, as for a transport', () => {
  const { state, command } = deploymentSetup();
  const caps = getStorageCapacities(state.planets['colony-a']!.buildings);
  const nearlyFull = { ...state, planets: { ...state.planets, 'colony-a': { ...state.planets['colony-a']!, resources: { metal: caps.metal - 10, minerals: 0, gas: 0 } } } };
  const sent = dispatchFlight(nearlyFull, command({ metal: 1_000 }), { now: NOW, mode: 'production' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const arrived = reconcileFlights(sent.state, sent.flight.arrivalAt);
  const flight = arrived.state.flights.records.find((record) => record.id === sent.flight.id)!;
  assert.equal(arrived.state.planets['colony-a']!.resources!.metal, caps.metal);
  assert.equal(flight.cargoSettlement?.burned.metal, 990);
});

test('reload mid-flight: the saved deployment still lands its cargo', () => {
  const { state, command } = deploymentSetup();
  const sent = dispatchFlight(state, command({ metal: 2_000 }), { now: NOW, mode: 'production' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const raw = serializeSaveForStorage(sent.state, 'production');
  const loaded = loadSavedState({ mode: 'production', storage: { getItem: () => raw, setItem: () => undefined, removeItem: () => undefined } });
  assert.equal(loaded.status, 'loaded');
  const flight = loaded.state.flights.records.find((record) => record.id === sent.flight.id)!;
  assert.equal(flight.cargo?.metal, 2_000);
  const arrived = reconcileFlights(loaded.state, sent.flight.arrivalAt);
  assert.equal(arrived.state.planets['colony-a']!.resources!.metal, 2_000);
});

test('transport is offered with any ship that has a hold, transports first', () => {
  const noHulls = campaign({ recycler: 3 });
  const homeSystem = noHulls.planets[noHulls.currentPlanetId]!.universeSystem ?? 1;
  const state = withColony(noHulls, homeSystem + 3, { recycler: 4 }, 'colony-a');
  const target = neutralTarget(state);
  const fleet = defaultQuickFleet(state, 'transport', state.currentPlanetId, target);
  assert.deepEqual(Object.keys(fleet.ships), ['recycler']);
  const menu = evaluateQuickActions(state, target, RUNTIME).find((action) => action.id === 'transport')!;
  assert.equal(menu.enabled, true);
  assert.equal(menu.plan?.fleet.ships.recycler !== undefined, true);
  const mixed = withColony(campaign({ recycler: 3, transporter: 2 }), homeSystem + 3, { recycler: 4 }, 'colony-a');
  assert.deepEqual(defaultQuickFleet(mixed, 'transport', mixed.currentPlanetId, target).ships, { transporter: 2 });
  const none = evaluateQuickActions(campaign({ cruiser: 0 }), target, RUNTIME).find((action) => action.id === 'transport')!;
  assert.equal(none.enabled, false);
  assert.match(none.reason ?? '', /грузов/);
});

test('cargo hulls: transports are used first, other ships only for the rest', () => {
  const hulls: CargoHull[] = [
    { shipId: 'transporter', capacity: 100, free: 2, preferred: true },
    { shipId: 'recycler', capacity: 400, free: 5, preferred: false },
  ];
  assert.deepEqual(pickCargoShips(hulls, 150), { transporter: 2 });
  assert.deepEqual(pickCargoShips(hulls, 600), { transporter: 2, recycler: 1 });
  assert.deepEqual(pickCargoShips([hulls[1]!], 500), { recycler: 2 });
});

test('gather uses only transports where a planet has them, other holds where it has none', () => {
  const mixed = campaign({ transporter: 2, recycler: 5, cruiser: 3 });
  assert.deepEqual(cargoHullsOnPlanet(mixed, mixed.currentPlanetId).map((hull) => hull.shipId), ['transporter']);
  const bare = campaign({ recycler: 5 });
  assert.ok(cargoHullsOnPlanet(bare, bare.currentPlanetId).some((hull) => hull.shipId === 'recycler'));
});
