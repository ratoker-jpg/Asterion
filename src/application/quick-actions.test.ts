import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState } from './persistence.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import { SHIP_IDS, type ShipId } from '../domain/combat/ids.ts';
import type { UniversePlanetNode } from '../domain/universe/types.ts';
import type { SaveState } from './contracts.ts';
import { dispatchFlight } from './flights.ts';
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
  assert.deepEqual(legs.map((leg) => leg.originPlanetId).sort(), [home.currentPlanetId, 'colony-a'].sort());
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
  return { ...state, planets: { ...state.planets, [planetId]: { ...planet,
    resources: { metal: stock.metal ?? 0, minerals: stock.minerals ?? 0, gas: stock.gas ?? 100_000 },
    recycling: { ...planet.recycling, availableDebris: stock.debris ?? 0 } } } };
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

test('rebase takes no resources: «Дислокация» moves ships and commanders only', () => {
  const home = campaign({});
  const homeSystem = home.planets[home.currentPlanetId]!.universeSystem ?? 1;
  const state = withColony(home, homeSystem + 3, { transporter: 2 }, 'colony-a');
  const target: QuickTarget = { node: node('player', { id: home.currentPlanetId, ownerId: home.profile.playerId, coordinate: { galaxy: 1, system: homeSystem, position: home.planets[home.currentPlanetId]!.universePosition ?? 1 } }), relation: 'self' };
  const leg = planQuickLegs(state, 'deployment', target, RUNTIME)[0]!;
  const command = { ...leg.command!, cargo: { metal: 1_000, minerals: 0, gas: 0, debris: 0 } };
  const { state: next, outcomes } = sendQuickLegs(state, [command], RUNTIME, dispatchFlight);
  assert.equal(outcomes[0]!.result.ok, true);
  const flight = next.flights.records.find((record) => record.missionId === 'deployment')!;
  assert.equal(Object.values(flight.cargo ?? {}).reduce((sum, value) => sum + value, 0), 0);
  assert.equal(next.planets["colony-a"]!.resources!.metal, state.planets["colony-a"]!.resources!.metal);
});

test('player-facing name of the rebase mission is «Дислокация»', () => {
  assert.equal(QUICK_ACTION_LABELS.deployment, 'Дислокация');
});
