import assert from 'node:assert/strict';
import test from 'node:test';

import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import {
  projectAidLedger,
  selectActiveAidLedger,
  selectRequestById,
} from '../domain/command/aid.ts';
import { TEST_ALLY_OWNER_ID } from '../domain/command/catalog.ts';
import { kickMember, leaveAlliance } from '../domain/command/membership.ts';
import { aidInFlightUnits } from '../domain/flights/aid-mission.ts';
import {
  cancelAidRequest,
  createAidRequest,
  createIraAidRequest,
  prepareIraAidFixture,
  previewRequestOverflow,
  reconcileAidMembership,
  selectRequestProgress,
  syncAidState,
  type AidContext,
} from './alliance-aid.ts';
import {
  getPlanetResources,
  replaceAlliedPlanetState,
  replacePlanetResources,
  replacePlanetState,
  type SaveState,
} from './contracts.ts';
import { createPlanetIdForCoordinate, dispatchFlight, dispatchNpcAidFlight, reconcileFlights, recallFlight } from './flights.ts';
import { createColonyPlanetRuntime } from './owned-planets.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { reconcileRuntime } from './reconcile.ts';

const MIN = 60_000;
const T0 = 1_000_000;
const IRA_PLANET = 'test-mode-ally-ira-vel-v1';
const ctx = (now: number): AidContext => ({ now, mode: 'test', testTimeScale: 15 });
const options = (now: number) => ({ now, mode: 'test' as const, testTimeScale: 15 as const });

function cargoPerMega(state: SaveState): number {
  const entity = getFactionShipCatalog(state.profile.factionId as CombatFactionId).find((ship) => ship.id === 'mega-transporter');
  return entity?.ship?.cargo ?? 0;
}

/** Test Mode world: player (Hall 1, huge wallet, 40 mega-transporters) allied with Ira Vel at her prepared planet. */
function world(): SaveState {
  const base = createInitialSaveState('test', T0);
  const home = base.planets['helion-01'];
  const withFleet = replacePlanetState(base, 'helion-01', {
    ...home,
    fleet: { ...home.fleet, ships: { ...home.fleet.ships, 'mega-transporter': 40, transporter: 10, scout: 5 } },
  });
  // Test Mode wallets start full; leave room so deliveries to the player are not burned by the storage cap.
  const lowWallet = replacePlanetResources(withFleet, 'helion-01', { metal: 2_000_000, minerals: 2_000_000, gas: 2_000_000 });
  const prepared = prepareIraAidFixture(lowWallet, ctx(T0));
  assert.ok(prepared.ok);
  // regime = Hall 1 / scale 15 from T0 on
  return syncAidState(prepared.state, ctx(T0));
}

function iraRequest(state: SaveState, amount = 120_000, resource: 'metal' | 'minerals' | 'gas' | 'debris' = 'metal') {
  const made = createIraAidRequest(state, { resource, amount }, ctx(T0));
  assert.ok(made.ok, made.ok ? '' : made.message);
  return { state: made.state, requestId: made.requestId! };
}

function helpCommand(requestId: string, aidRequestId: string, ships: Record<string, number>, cargo: Partial<Record<'metal' | 'minerals' | 'gas' | 'debris', number>>, extra: Record<string, unknown> = {}) {
  return {
    requestId,
    missionId: 'aid' as const,
    aidRequestId,
    originPlanetId: 'helion-01',
    selectedShips: ships,
    cargo: { metal: 0, minerals: 0, gas: 0, debris: 0, ...cargo },
    departedAt: T0,
    ...extra,
  };
}

function launch(state: SaveState, id: string, aidRequestId: string, megas: number, cargo: Partial<Record<'metal' | 'minerals' | 'gas' | 'debris', number>>, at = T0) {
  const result = dispatchFlight(state, helpCommand(id, aidRequestId, { 'mega-transporter': megas }, cargo, { departedAt: at }), options(at));
  assert.ok(result.ok, result.ok ? '' : result.error.message);
  return result;
}

const iraMetal = (state: SaveState) => state.alliedPlanets![IRA_PLANET].resources!.metal;

test('the aid mission launches only against an open request of another member, with the requested resource', () => {
  const { state, requestId } = iraRequest(world());
  const capacity = cargoPerMega(state) * 3;
  assert.ok(capacity >= 60_000);

  const fail = (command: Parameters<typeof dispatchFlight>[1], code: string) => {
    const result = dispatchFlight(state, command, options(T0));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, code, result.error.message);
  };
  fail(helpCommand('f1', requestId, { 'mega-transporter': 3 }, { minerals: 60_000 }), 'invalid-cargo');
  fail(helpCommand('f2', requestId, { 'mega-transporter': 3 }, { metal: 30_000, gas: 1 }), 'invalid-cargo');
  fail(helpCommand('f3', requestId, { 'mega-transporter': 3 }, {}), 'invalid-cargo');
  fail(helpCommand('f4', requestId, { scout: 5 }, { metal: 100 }), 'wrong-ship-composition');
  fail(helpCommand('f5', requestId, { 'mega-transporter': 3, scout: 1 }, { metal: 100 }), 'wrong-ship-composition');
  fail(helpCommand('f6', 'request-404', { 'mega-transporter': 3 }, { metal: 100 }), 'target-not-available');
  fail(helpCommand('f7', requestId, { 'mega-transporter': 1 }, { metal: cargoPerMega(state) + 1 }), 'insufficient-cargo-capacity');
  fail({ ...helpCommand('f8', requestId, { 'mega-transporter': 3 }, { metal: 100 }), destination: { kind: 'planet' as const, planetId: 'helion-01', coordinate: { galaxy: 1, system: 1, position: 1 } } }, 'target-not-available');
  fail({ ...helpCommand('f9', requestId, { 'mega-transporter': 3 }, { metal: 100 }), aidRequestId: undefined as unknown as string }, 'target-not-available');

  // not a member of the request's alliance any more
  const left = leaveAlliance(state.command, state.profile.playerId, T0, { successorOwnerId: TEST_ALLY_OWNER_ID });
  assert.ok(left.ok);
  const outsider = dispatchFlight({ ...state, command: left.state }, helpCommand('f10', requestId, { 'mega-transporter': 3 }, { metal: 100 }), options(T0));
  assert.equal(outsider.ok, false);

  // the happy path
  const ok = dispatchFlight(state, helpCommand('ok', requestId, { 'mega-transporter': 3 }, { metal: 60_000 }), options(T0));
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.flight.missionId, 'aid');
  assert.equal(ok.flight.aid?.requestId, requestId);
  assert.equal(ok.flight.aid?.recipientOwnerId, TEST_ALLY_OWNER_ID);
  assert.equal(ok.flight.destinationPlanetId, IRA_PLANET);
  assert.equal(ok.flight.cargoState, 'loaded');
});

test('an own-planet request can never be served by its author, and an ordinary transport is not aid', () => {
  const ready = syncAidState(world(), ctx(T0));
  const later = ctx(T0 + 2 * MIN);
  const created = createAidRequest(syncAidState(ready, later), { planetId: 'helion-01', resource: 'gas', amount: 50_000 }, later);
  assert.ok(created.ok, created.ok ? '' : created.message);
  const self = dispatchFlight(created.state, helpCommand('self', created.requestId!, { 'mega-transporter': 3 }, { gas: 100 }), options(later.now));
  assert.equal(self.ok, false);

  // ordinary transport to the ally does nothing for the ally's request
  const { state, requestId } = iraRequest(world());
  const transported = dispatchFlight(state, {
    requestId: 'plain-transport', missionId: 'transport', originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: IRA_PLANET, coordinate: { galaxy: 1, system: 1, position: 2 } },
    targetRelation: 'ally', selectedShips: { 'mega-transporter': 3 },
    cargo: { metal: 60_000, minerals: 0, gas: 0, debris: 0 }, departedAt: T0,
  }, options(T0));
  assert.ok(transported.ok);
  if (!transported.ok) return;
  const arrived = reconcileFlights(transported.state, transported.flight.arrivalAt, undefined, { mode: 'test' });
  const request = selectRequestById(arrived.state.command, requestId)!;
  assert.equal(request.delivered, 0);
  assert.equal(request.helpStarted, false);
  assert.equal(aidInFlightUnits(transported.state.flights.records, requestId), 0);
});

test('launch reserves the shipped amount; two partial helps never exceed the open remainder', () => {
  const { state, requestId } = iraRequest(world(), 120_000);
  const before = getPlanetResources(state, 'helion-01').metal;
  const first = launch(state, 'a1', requestId, 3, { metal: 60_000 });
  assert.equal(getPlanetResources(first.state, 'helion-01').metal, before - 60_000 - first.flight.gasCost * 0, 'cargo is debited at launch');
  assert.equal(aidInFlightUnits(first.state.flights.records, requestId), 60_000);
  assert.equal(selectRequestById(first.state.command, requestId)?.helpStarted, true);
  assert.deepEqual(selectRequestProgress(first.state, selectRequestById(first.state.command, requestId)!),
    { requested: 120_000, delivered: 0, inFlight: 60_000, remainder: 60_000 });

  const second = launch(first.state, 'a2', requestId, 2, { metal: 40_000 });
  assert.equal(aidInFlightUnits(second.state.flights.records, requestId), 100_000);

  const tooMuch = dispatchFlight(second.state, helpCommand('a3', requestId, { 'mega-transporter': 2 }, { metal: 40_000 }), options(T0));
  assert.equal(tooMuch.ok, false, 'only 20 000 are still free');
  const exact = dispatchFlight(second.state, helpCommand('a4', requestId, { 'mega-transporter': 1 }, { metal: 20_000 }), options(T0));
  assert.ok(exact.ok);
  if (!exact.ok) return;
  assert.equal(selectRequestProgress(exact.state, selectRequestById(exact.state.command, requestId)!).remainder, 0);
  const full = dispatchFlight(exact.state, helpCommand('a5', requestId, { 'mega-transporter': 1 }, { metal: 1 }), options(T0));
  assert.equal(full.ok, false);

  // repeating the same command id neither reserves nor spends twice
  const replay = dispatchFlight(exact.state, helpCommand('a4', requestId, { 'mega-transporter': 1 }, { metal: 20_000 }), options(T0));
  assert.ok(replay.ok && !replay.created);
  assert.equal(replay.state, exact.state);
});

test('arrival credits only what the planet accepts, once, and the sender contribution matches', () => {
  const { state, requestId } = iraRequest(world(), 120_000);
  const sent = launch(state, 'arr', requestId, 3, { metal: 60_000 });
  const iraBefore = iraMetal(state);
  const early = reconcileFlights(sent.state, sent.flight.arrivalAt - 1, undefined, { mode: 'test' });
  assert.equal(early.changed, false);

  const arrived = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, { mode: 'test' });
  assert.equal(arrived.changed, true);
  assert.equal(iraMetal(arrived.state), iraBefore + 60_000);
  const request = selectRequestById(arrived.state.command, requestId)!;
  assert.equal(request.delivered, 60_000);
  assert.equal(request.status, 'open');
  const record = arrived.state.flights.records[0];
  assert.equal(record.cargoState, 'delivered');
  assert.equal(record.aid?.creditedUnits, 60_000);
  assert.equal(record.phase, 'returning');
  assert.equal(aidInFlightUnits(arrived.state.flights.records, requestId), 0, 'delivered cargo no longer counts as in flight');
  const member = arrived.state.command.alliances[0].members.find((item) => item.ownerId === arrived.state.profile.playerId)!;
  assert.equal(member.deliveredUnits, 60_000);

  // replaying the same moment, a later moment and a full reload change nothing
  const replay = reconcileFlights(arrived.state, sent.flight.arrivalAt, undefined, { mode: 'test' });
  assert.equal(replay.changed, false);
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const facade = createPersistenceFacade({ mode: 'test', storage, now: () => sent.flight.arrivalAt });
  assert.ok(facade.write(arrived.state).ok);
  const reloaded = facade.read();
  assert.equal(selectRequestById(reloaded.command, requestId)?.delivered, 60_000);
  assert.equal(iraMetal(reloaded), iraBefore + 60_000);
  const again = reconcileFlights(reloaded, sent.flight.arrivalAt + 1, undefined, { mode: 'test' });
  assert.equal(again.changed, false);
  assert.equal(iraMetal(again.state), iraBefore + 60_000);

  // the return leg hands nothing back: the cargo was delivered
  const home = getPlanetResources(arrived.state, 'helion-01').metal;
  const returned = reconcileFlights(arrived.state, record.returnAt!, undefined, { mode: 'test' });
  assert.equal(getPlanetResources(returned.state, 'helion-01').metal, home);
  assert.equal(returned.state.flights.records[0].phase, 'completed');
  assert.equal(returned.state.flights.records[0].cargoState, 'delivered');
  const once = reconcileFlights(returned.state, record.returnAt! + 10 * MIN, undefined, { mode: 'test' });
  assert.equal(once.changed, false);
});

test('the request completes only on real delivery and closes exactly at the requested amount', () => {
  const { state, requestId } = iraRequest(world(), 50_000);
  const a = launch(state, 'c1', requestId, 2, { metal: 30_000 });
  const b = launch(a.state, 'c2', requestId, 1, { metal: 20_000 });
  assert.equal(selectRequestById(b.state.command, requestId)?.status, 'open', 'in flight is not delivered');
  const first = reconcileFlights(b.state, Math.max(a.flight.arrivalAt, b.flight.arrivalAt), undefined, { mode: 'test' });
  const done = selectRequestById(first.state.command, requestId)!;
  assert.equal(done.delivered, 50_000);
  assert.equal(done.status, 'completed');
  assert.equal(first.state.command.alliances[0].members.find((m) => m.ownerId === first.state.profile.playerId)!.deliveredUnits, 50_000);
});

test('overflow: only the accepted share counts, the rest stays open on the request', () => {
  const { state: base, requestId } = iraRequest(world(), 120_000);
  const ira = base.alliedPlanets![IRA_PLANET];
  const capped = replaceAlliedPlanetState(base, IRA_PLANET, {
    ...ira,
    buildings: { ...ira.buildings, 'metal-storage': 1 },
    resources: { ...ira.resources!, metal: 140_000 },
  });
  const cap = getStorageCapacities(capped.alliedPlanets![IRA_PLANET].buildings).metal;
  assert.equal(cap, 150_000);
  const preview = previewRequestOverflow(capped, IRA_PLANET, 'metal', 120_000);
  assert.deepEqual(preview, { lost: 110_000, free: 10_000 });

  const sent = launch(capped, 'ov', requestId, 3, { metal: 60_000 });
  assert.equal(sent.flight.overflowWarning, true);
  const arrived = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, { mode: 'test' });
  assert.equal(iraMetal(arrived.state), 150_000);
  const request = selectRequestById(arrived.state.command, requestId)!;
  assert.equal(request.delivered, 10_000, 'burned metal is not delivered');
  assert.equal(request.status, 'open');
  assert.equal(selectRequestProgress(arrived.state, request).remainder, 110_000);
  assert.equal(arrived.state.command.alliances[0].members.find((m) => m.ownerId === arrived.state.profile.playerId)!.deliveredUnits, 10_000);
});

test('debris is not limited by storage and is credited in full', () => {
  const base = world();
  const home = base.planets['helion-01'];
  const rich = replacePlanetState(base, 'helion-01', { ...home, recycling: { ...home.recycling, availableDebris: 500_000 } });
  const { state, requestId } = iraRequest(rich, 80_000, 'debris');
  const before = state.alliedPlanets![IRA_PLANET].recycling.availableDebris;
  const sent = launch(state, 'deb', requestId, 4, { debris: 80_000 });
  assert.equal(sent.state.planets['helion-01'].recycling.availableDebris, 420_000);
  assert.equal(sent.flight.overflowWarning, false);
  const arrived = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, { mode: 'test' });
  assert.equal(arrived.state.alliedPlanets![IRA_PLANET].recycling.availableDebris, before + 80_000);
  assert.equal(selectRequestById(arrived.state.command, requestId)?.status, 'completed');
  assert.equal(previewRequestOverflow(state, IRA_PLANET, 'debris', 80_000).lost, 0);
});

test('different resources never mix: a mixed or foreign cargo is refused, minerals stay minerals', () => {
  const { state, requestId } = iraRequest(world(), 90_000, 'minerals');
  const bad = dispatchFlight(state, helpCommand('mx', requestId, { 'mega-transporter': 3 }, { metal: 10_000 }), options(T0));
  assert.equal(bad.ok, false);
  const good = launch(state, 'mx2', requestId, 3, { minerals: 60_000 });
  const arrived = reconcileFlights(good.state, good.flight.arrivalAt, undefined, { mode: 'test' });
  const ira = arrived.state.alliedPlanets![IRA_PLANET].resources!;
  const iraBefore = state.alliedPlanets![IRA_PLANET].resources!;
  assert.equal(ira.minerals, iraBefore.minerals + 60_000);
  assert.equal(ira.metal, iraBefore.metal);
  assert.equal(ira.gas, iraBefore.gas);
});

test('kicking the recipient turns the aid fleet back at once; the cargo returns home exactly once', () => {
  const { state, requestId } = iraRequest(world(), 120_000);
  const sent = launch(state, 'kick', requestId, 3, { metal: 60_000 });
  const homeBefore = getPlanetResources(sent.state, 'helion-01').metal;
  const kicked = kickMember(sent.state.command, sent.state.profile.playerId, TEST_ALLY_OWNER_ID, T0 + 5_000);
  assert.ok(kicked.ok);
  const cut = reconcileAidMembership({ ...sent.state, command: kicked.state }, T0 + 5_000);
  const flight = cut.flights.records[0];
  assert.equal(flight.phase, 'returning');
  assert.equal(flight.cargoState, 'loaded', 'cargo stays aboard');
  assert.equal(flight.completionReason, 'recalled');
  assert.equal(selectRequestById(cut.command, requestId)?.status, 'closed');
  assert.equal(aidInFlightUnits(cut.flights.records, requestId), 0);
  assert.equal(reconcileAidMembership(cut, T0 + 6_000), cut, 'idempotent');

  const back = reconcileFlights(cut, flight.returnAt!, undefined, { mode: 'test' });
  assert.equal(getPlanetResources(back.state, 'helion-01').metal, homeBefore + 60_000);
  assert.equal(back.state.flights.records[0].cargoState, 'returned');
  assert.equal(back.state.flights.records[0].phase, 'completed');
  assert.equal(iraMetal(back.state), iraMetal(state), 'nothing reached the removed member');
  assert.equal(back.state.command.alliances[0].members.find((m) => m.ownerId === back.state.profile.playerId)!.deliveredUnits, 0);
  assert.equal(reconcileFlights(back.state, flight.returnAt! + MIN, undefined, { mode: 'test' }).changed, false);
});

test('an aid fleet that reaches a target after membership changed returns with its cargo instead of delivering', () => {
  const { state, requestId } = iraRequest(world(), 120_000);
  const sent = launch(state, 'late', requestId, 3, { metal: 60_000 });
  const kicked = kickMember(sent.state.command, sent.state.profile.playerId, TEST_ALLY_OWNER_ID, sent.flight.arrivalAt - 10);
  assert.ok(kicked.ok);
  // no membership sweep ran: the arrival handler itself must refuse to credit
  const arrived = reconcileFlights({ ...sent.state, command: kicked.state }, sent.flight.arrivalAt, undefined, { mode: 'test' });
  const flight = arrived.state.flights.records[0];
  assert.equal(flight.phase, 'returning');
  assert.equal(flight.cargoState, 'loaded');
  assert.equal(iraMetal(arrived.state), iraMetal(state));
  const back = reconcileFlights(arrived.state, flight.returnAt!, undefined, { mode: 'test' });
  assert.equal(back.state.flights.records[0].cargoState, 'returned');
});

test('the sender leaving the alliance also turns the fleet back with its cargo', () => {
  const { state, requestId } = iraRequest(world(), 120_000);
  const sent = launch(state, 'sender-left', requestId, 3, { metal: 60_000 });
  const left = leaveAlliance(sent.state.command, sent.state.profile.playerId, T0 + 1_000, { successorOwnerId: TEST_ALLY_OWNER_ID });
  assert.ok(left.ok);
  const cut = reconcileAidMembership({ ...sent.state, command: left.state }, T0 + 1_000);
  assert.equal(cut.flights.records[0].phase, 'returning');
  assert.equal(cut.flights.records[0].cargoState, 'loaded');
});

test('a destination lost for an independent reason keeps the standing rule: ships return, cargo is lost', () => {
  const { state, requestId } = iraRequest(world(), 120_000);
  const sent = launch(state, 'void', requestId, 3, { metal: 60_000 });
  const withoutPlanet: SaveState = { ...sent.state, alliedPlanets: {} };
  const homeBefore = getPlanetResources(sent.state, 'helion-01').metal;
  const arrived = reconcileFlights(withoutPlanet, sent.flight.arrivalAt, undefined, { mode: 'test' });
  const flight = arrived.state.flights.records[0];
  assert.equal(flight.phase, 'returning');
  assert.equal(flight.cargoState, 'voided');
  assert.equal(aidInFlightUnits(arrived.state.flights.records, requestId), 0, 'the reservation is released');
  assert.equal(selectRequestById(arrived.state.command, requestId)?.delivered, 0);
  const back = reconcileFlights(arrived.state, flight.returnAt!, undefined, { mode: 'test' });
  assert.equal(getPlanetResources(back.state, 'helion-01').metal, homeBefore, 'lost cargo is not refunded');
  assert.equal(back.state.flights.records[0].phase, 'completed');
});

test('manual recall frees the reservation, returns the cargo, and the request stays uncancellable', () => {
  const { state, requestId } = iraRequest(world(), 120_000);
  const sent = launch(state, 'recall', requestId, 3, { metal: 60_000 });
  const homeAfterLaunch = getPlanetResources(sent.state, 'helion-01').metal;
  const recalled = recallFlight(sent.state, sent.flight.id, { now: T0 + 2_000 });
  assert.ok(recalled.ok);
  if (!recalled.ok) return;
  assert.equal(aidInFlightUnits(recalled.state.flights.records, requestId), 0);
  const request = selectRequestById(recalled.state.command, requestId)!;
  assert.equal(request.helpStarted, true, 'a turned-back flight still locks cancelling');
  const back = reconcileFlights(recalled.state, recalled.flight.returnAt!, undefined, { mode: 'test' });
  assert.equal(getPlanetResources(back.state, 'helion-01').metal, homeAfterLaunch + 60_000);
  // the freed amount can be shipped again
  const again = dispatchFlight(back.state, helpCommand('recall-2', requestId, { 'mega-transporter': 3 }, { metal: 60_000 }), options(T0 + 3_000));
  assert.ok(again.ok);
});

test('a request on planet B receives the cargo on B and never on the selected planet A', () => {
  const colonyCoordinate = { galaxy: 1, system: 2, position: 1 };
  const base = iraRequest(world()).state; // Ira's own request is unrelated; build the player's below
  const colonyId = createPlanetIdForCoordinate(colonyCoordinate);
  const withColony: SaveState = {
    ...base,
    planets: { ...base.planets, [colonyId]: { ...createColonyPlanetRuntime(base, colonyCoordinate), resources: { metal: 0, minerals: 0, gas: 0 } } },
  };
  const now = T0 + 2 * MIN;
  const created = createAidRequest(syncAidState(withColony, ctx(now)), { planetId: colonyId, resource: 'gas', amount: 50_000 }, ctx(now));
  assert.ok(created.ok, created.ok ? '' : created.message);
  assert.equal(selectRequestById(created.state.command, created.requestId!)?.planetId, colonyId);
  assert.deepEqual(selectRequestById(created.state.command, created.requestId!)?.coordinate, colonyCoordinate);
  // the current planet is A (helion-01); Ira serves the request
  assert.equal(created.state.currentPlanetId, 'helion-01');
  const ira = dispatchNpcAidFlight(created.state, {
    requestId: 'aid-npc:b-1', aidRequestId: created.requestId!, senderOwnerId: TEST_ALLY_OWNER_ID, units: 50_000, departedAt: now,
  }, options(now));
  assert.ok(ira.ok, ira.ok ? '' : ira.error.message);
  if (!ira.ok) return;
  assert.equal(ira.flight.destinationPlanetId, colonyId);
  const homeGasBefore = getPlanetResources(created.state, 'helion-01').gas;
  const arrived = reconcileFlights(ira.state, ira.flight.arrivalAt, undefined, { mode: 'test' });
  assert.equal(arrived.state.planets[colonyId].resources!.gas, 50_000, 'lands on B');
  assert.equal(getPlanetResources(arrived.state, 'helion-01').gas, homeGasBefore, 'A is untouched');
  assert.equal(selectRequestById(arrived.state.command, created.requestId!)?.status, 'completed');
});

test('Ira Vel helps the player through the same runtime: real ships, stock debited, delivery and return', () => {
  const now = T0 + 2 * MIN;
  const synced = syncAidState(world(), ctx(now));
  const created = createAidRequest(synced, { planetId: 'helion-01', resource: 'minerals', amount: 50_000 }, ctx(now));
  assert.ok(created.ok, created.ok ? '' : created.message);
  const before = created.state;
  const iraBefore = before.alliedPlanets![IRA_PLANET];
  const sent = dispatchNpcAidFlight(before, {
    requestId: 'aid-npc:qa-1', aidRequestId: created.requestId!, senderOwnerId: TEST_ALLY_OWNER_ID, departedAt: now,
  }, options(now));
  assert.ok(sent.ok, sent.ok ? '' : sent.error.message);
  if (!sent.ok) return;
  const flight = sent.flight;
  assert.equal(flight.ownerSide, 'npc');
  assert.equal(flight.missionId, 'aid');
  assert.equal(flight.originPlanetId, IRA_PLANET);
  assert.equal(flight.destinationPlanetId, 'helion-01');
  assert.ok(flight.gasCost >= 0);
  const ira = sent.state.alliedPlanets![IRA_PLANET];
  assert.equal(ira.resources!.minerals, iraBefore.resources!.minerals - 50_000, 'cargo debited from her stock');
  assert.equal(ira.resources!.gas, iraBefore.resources!.gas - flight.gasCost, 'fuel paid like anyone else');
  assert.equal(ira.fleet.ships['mega-transporter'], 12, 'ships stay in the fleet, reserved by the flight');
  assert.equal(aidInFlightUnits(sent.state.flights.records, created.requestId!), 50_000);

  // a second dispatch cannot reuse the same hulls or the same request remainder
  const repeat = dispatchNpcAidFlight(sent.state, {
    requestId: 'aid-npc:qa-2', aidRequestId: created.requestId!, senderOwnerId: TEST_ALLY_OWNER_ID, departedAt: now,
  }, options(now));
  assert.equal(repeat.ok, false);

  const wallet = getPlanetResources(sent.state, 'helion-01').minerals;
  const arrived = reconcileFlights(sent.state, flight.arrivalAt, undefined, { mode: 'test' });
  assert.equal(getPlanetResources(arrived.state, 'helion-01').minerals, wallet + 50_000);
  const request = selectRequestById(arrived.state.command, created.requestId!)!;
  assert.equal(request.status, 'completed');
  const iraMember = arrived.state.command.alliances[0].members.find((m) => m.ownerId === TEST_ALLY_OWNER_ID)!;
  assert.equal(iraMember.deliveredUnits, 50_000);
  assert.equal(reconcileFlights(arrived.state, flight.arrivalAt, undefined, { mode: 'test' }).changed, false);

  const back = reconcileFlights(arrived.state, arrived.state.flights.records[0].returnAt!, undefined, { mode: 'test' });
  assert.equal(back.state.flights.records[0].phase, 'completed');
  assert.equal(back.state.alliedPlanets![IRA_PLANET].resources!.minerals, iraBefore.resources!.minerals - 50_000, 'no refund after delivery');
  assert.equal(getPlanetResources(back.state, 'helion-01').minerals, wallet + 50_000);
});

test('a recalled Ira Vel flight returns her cargo to her own planet once', () => {
  const now = T0 + 2 * MIN;
  const created = createAidRequest(syncAidState(world(), ctx(now)), { planetId: 'helion-01', resource: 'metal', amount: 50_000 }, ctx(now));
  assert.ok(created.ok);
  const sent = dispatchNpcAidFlight(created.state, {
    requestId: 'aid-npc:qa-3', aidRequestId: created.requestId!, senderOwnerId: TEST_ALLY_OWNER_ID, departedAt: now,
  }, options(now));
  assert.ok(sent.ok);
  if (!sent.ok) return;
  const iraAfterLaunch = iraMetal(sent.state);
  // the player leaves the alliance: the NPC flight turns around with the cargo
  const left = leaveAlliance(sent.state.command, sent.state.profile.playerId, now + 100, { successorOwnerId: TEST_ALLY_OWNER_ID });
  assert.ok(left.ok);
  const cut = reconcileAidMembership({ ...sent.state, command: left.state }, now + 100);
  const flight = cut.flights.records[0];
  assert.equal(flight.phase, 'returning');
  const back = reconcileFlights(cut, flight.returnAt!, undefined, { mode: 'test' });
  assert.equal(iraMetal(back.state), iraAfterLaunch + 50_000);
  assert.equal(reconcileFlights(back.state, flight.returnAt! + MIN, undefined, { mode: 'test' }).changed, false);
});

test('NPC aid is a Test Mode scenario only: refused and never persisted in production', () => {
  const prod = createInitialSaveState('production', T0);
  assert.equal(prod.alliedPlanets && Object.keys(prod.alliedPlanets).length, 0);
  assert.equal(prepareIraAidFixture(prod, { now: T0, mode: 'production' }).ok, false);
  assert.equal(createIraAidRequest(prod, { resource: 'metal', amount: 50_000 }, { now: T0, mode: 'production' }).ok, false);
  const refused = dispatchNpcAidFlight(prod, { requestId: 'aid-npc:x', aidRequestId: 'request-1', senderOwnerId: TEST_ALLY_OWNER_ID }, { now: T0, mode: 'production' });
  assert.equal(refused.ok, false);
  // production never grants ships or goods to anyone by itself
  assert.equal(prod.command.requests.length, 0);
  assert.equal(prod.command.aidLedgers.length, 0);

  // a forged NPC aid flight inside a production save is dropped on load
  const { state, requestId } = iraRequest(world());
  const sent = dispatchNpcAidFlight(
    (() => { const n = T0 + 2 * MIN; const c = createAidRequest(syncAidState(world(), ctx(n)), { planetId: 'helion-01', resource: 'metal', amount: 50_000 }, ctx(n)); return c.ok ? c.state : state; })(),
    { requestId: 'aid-npc:forged', aidRequestId: 'request-1', senderOwnerId: TEST_ALLY_OWNER_ID, departedAt: T0 + 2 * MIN },
    options(T0 + 2 * MIN),
  );
  void requestId;
  if (sent.ok) {
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
    values.set('asterion.vertical-slice.v1', JSON.stringify(sent.state));
    const loaded = createPersistenceFacade({ mode: 'production', storage, now: () => T0 }).read();
    assert.equal(loaded.flights.records.some((record) => record.missionId === 'aid'), false);
  }
});

test('the Hall governs the charge clock end to end: lost Hall pauses, regained Hall resumes', () => {
  let state = world();
  const hallPlanet = state.planets['helion-01'];
  const noHall = replacePlanetState(state, 'helion-01', { ...hallPlanet, buildings: { ...hallPlanet.buildings, 'planetary-government': 0 } });
  // 20 s of scaled intro (15 min / 15 = 60 s) pass with the Hall, then it is destroyed
  state = syncAidState(noHall, ctx(T0 + 30_000));
  const paused = selectActiveAidLedger(state.command, state.profile.playerId)!;
  assert.equal(paused.hallLevel, 0);
  const view = projectAidLedger(paused, T0 + 10 * 60 * MIN);
  assert.equal(view.charges, 0);
  assert.equal(view.paused, true);
  // the closed Command refuses to create requests
  const refused = createAidRequest(state, { planetId: 'helion-01', resource: 'metal', amount: 50_000 }, ctx(T0 + 10 * 60 * MIN));
  assert.equal(refused.ok, false);
  // Hall back at level 3: the unfinished half of the start charge resumes (no reset, no jump)
  const restored = replacePlanetState(state, 'helion-01', { ...hallPlanet, buildings: { ...hallPlanet.buildings, 'planetary-government': 3 } });
  const resumed = syncAidState(restored, ctx(T0 + 20 * 60 * MIN));
  const after = selectActiveAidLedger(resumed.command, resumed.profile.playerId)!;
  assert.equal(after.hallLevel, 3);
  assert.equal(after.progress, 0.5);
  assert.equal(projectAidLedger(after, T0 + 20 * 60 * MIN + 29_999).charges, 0);
  assert.equal(projectAidLedger(after, T0 + 20 * 60 * MIN + 30_000).charges, 1);
});

test('cancel through the application: refund before help, locked after the first launch', () => {
  const now = T0 + 2 * MIN;
  const synced = syncAidState(world(), ctx(now));
  const first = createAidRequest(synced, { planetId: 'helion-01', resource: 'metal', amount: 50_000 }, ctx(now));
  assert.ok(first.ok);
  const spent = projectAidLedger(selectActiveAidLedger(first.state.command, first.state.profile.playerId)!, now).charges;
  const cancelled = cancelAidRequest(first.state, first.requestId!, ctx(now));
  assert.ok(cancelled.ok);
  const refunded = projectAidLedger(selectActiveAidLedger(cancelled.state.command, cancelled.state.profile.playerId)!, now).charges;
  assert.equal(refunded, spent + 1);

  const second = createAidRequest(synced, { planetId: 'helion-01', resource: 'metal', amount: 50_000 }, ctx(now));
  assert.ok(second.ok);
  const sent = dispatchNpcAidFlight(second.state, { requestId: 'aid-npc:cancel-1', aidRequestId: second.requestId!, senderOwnerId: TEST_ALLY_OWNER_ID, departedAt: now }, options(now));
  assert.ok(sent.ok);
  if (!sent.ok) return;
  assert.equal(cancelAidRequest(sent.state, second.requestId!, ctx(now)).ok, false);
});

test('the full runtime loop (reconcileRuntime) settles aid arrivals and the return, with no duplicate credit', () => {
  const now = T0 + 2 * MIN;
  const created = createAidRequest(syncAidState(world(), ctx(now)), { planetId: 'helion-01', resource: 'gas', amount: 50_000 }, ctx(now));
  assert.ok(created.ok);
  const sent = dispatchNpcAidFlight(created.state, { requestId: 'aid-npc:loop', aidRequestId: created.requestId!, senderOwnerId: TEST_ALLY_OWNER_ID, departedAt: now }, options(now));
  assert.ok(sent.ok);
  if (!sent.ok) return;
  const wallet = getPlanetResources(sent.state, 'helion-01').gas;
  const runtime = (state: SaveState, at: number) => reconcileRuntime(state, { planetId: 'helion-01', now: at, mode: 'test', testTimeScale: 15 });
  const afterArrival = runtime(sent.state, sent.flight.arrivalAt + 5);
  assert.equal(selectRequestById(afterArrival.state.command, created.requestId!)?.delivered, 50_000);
  assert.ok(getPlanetResources(afterArrival.state, 'helion-01').gas >= wallet + 50_000 - 1);
  const twice = runtime(afterArrival.state, sent.flight.arrivalAt + 5);
  assert.equal(selectRequestById(twice.state.command, created.requestId!)?.delivered, 50_000);
  const finished = runtime(twice.state, sent.flight.arrivalAt + 100 * MIN);
  assert.equal(finished.state.flights.records[0].phase, 'completed');
  assert.equal(finished.state.command.aidEvents.filter((event) => event.kind === 'aid_delivered').length, 1);
  assert.equal(replacePlanetResources(finished.state, 'helion-01', getPlanetResources(finished.state, 'helion-01')).command.requests.length, 1);
});

test('gas aid pays fuel on top of the cargo and never mints gas out of a shared stock', () => {
  const { state: base, requestId } = iraRequest(world(), 50_000, 'gas');
  const probe = launch(base, 'gas-probe', requestId, 3, { gas: 50_000 });
  const fuel = probe.flight.gasCost;
  assert.ok(fuel > 0);
  const gasBefore = getPlanetResources(base, 'helion-01').gas;
  assert.equal(getPlanetResources(probe.state, 'helion-01').gas, gasBefore - 50_000 - fuel, 'cargo and fuel are both paid');

  // exactly cargo + fuel - 1 is not enough
  const short = replacePlanetResources(base, 'helion-01', { ...getPlanetResources(base, 'helion-01'), gas: 50_000 + fuel - 1 });
  const refused = dispatchFlight(short, helpCommand('gas-short', requestId, { 'mega-transporter': 3 }, { gas: 50_000 }), options(T0));
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.code, 'insufficient-gas');
  const exact = replacePlanetResources(base, 'helion-01', { ...getPlanetResources(base, 'helion-01'), gas: 50_000 + fuel });
  const sent = dispatchFlight(exact, helpCommand('gas-exact', requestId, { 'mega-transporter': 3 }, { gas: 50_000 }), options(T0));
  assert.ok(sent.ok);
  if (sent.ok) assert.equal(getPlanetResources(sent.state, 'helion-01').gas, 0);
});

test('a destroyed destination planet closes the request, frees the slot and returns ships empty (two flights, reload)', () => {
  const colonyCoordinate = { galaxy: 1, system: 2, position: 1 };
  const colonyId = createPlanetIdForCoordinate(colonyCoordinate);
  const base = world();
  const withColony: SaveState = {
    ...base,
    planets: { ...base.planets, [colonyId]: { ...createColonyPlanetRuntime(base, colonyCoordinate), resources: { metal: 0, minerals: 0, gas: 0 } } },
  };
  const now = T0 + 2 * MIN;
  const created = createAidRequest(syncAidState(withColony, ctx(now)), { planetId: colonyId, resource: 'gas', amount: 50_000 }, ctx(now));
  assert.ok(created.ok);
  const requestId = created.requestId!;
  const chargesBefore = projectAidLedger(selectActiveAidLedger(created.state.command, created.state.profile.playerId)!, now).charges;
  const one = dispatchNpcAidFlight(created.state, { requestId: 'aid-npc:d-1', aidRequestId: requestId, senderOwnerId: TEST_ALLY_OWNER_ID, units: 20_000, departedAt: now }, options(now));
  assert.ok(one.ok);
  if (!one.ok) return;
  const two = dispatchNpcAidFlight(one.state, { requestId: 'aid-npc:d-2', aidRequestId: requestId, senderOwnerId: TEST_ALLY_OWNER_ID, units: 30_000, departedAt: now }, options(now));
  assert.ok(two.ok);
  if (!two.ok) return;
  const iraAfterLaunch = two.state.alliedPlanets![IRA_PLANET].resources!;
  assert.equal(aidInFlightUnits(two.state.flights.records, requestId), 50_000);

  // the colony is destroyed while both fleets are in the air
  const { [colonyId]: _lost, ...rest } = two.state.planets;
  const destroyed: SaveState = { ...two.state, planets: rest };
  const swept = reconcileAidMembership(destroyed, now + 1_000);
  const request = selectRequestById(swept.command, requestId)!;
  assert.equal(request.status, 'closed');
  assert.equal(request.closeReason, 'planet_destroyed');
  assert.equal(request.delivered, 0);
  assert.equal(projectAidLedger(selectActiveAidLedger(swept.command, swept.profile.playerId)!, now + 1_000).charges, chargesBefore, 'no charge is returned');
  assert.equal(swept.command.requests.filter((r) => r.status === 'open').length, 0, 'the slot is free again');
  const flights = swept.flights.records.filter((f) => f.missionId === 'aid');
  assert.ok(flights.every((f) => f.phase === 'returning' && f.cargoState === 'voided'));
  assert.equal(aidInFlightUnits(swept.flights.records, requestId), 0);
  assert.equal(reconcileAidMembership(swept, now + 2_000), swept, 'idempotent');

  // survive a reload, then the ships come home: no cargo returns, nothing is minted or duplicated
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const facade = createPersistenceFacade({ mode: 'test', storage, now: () => now });
  assert.ok(facade.write(swept).ok);
  const reloaded = facade.read();
  assert.equal(selectRequestById(reloaded.command, requestId)?.closeReason, 'planet_destroyed');
  const lastReturn = Math.max(...reloaded.flights.records.map((f) => f.returnAt!));
  const home = reconcileFlights(reloaded, lastReturn, undefined, { mode: 'test' });
  assert.ok(home.state.flights.records.every((f) => f.phase === 'completed' && f.cargoState === 'voided'));
  const iraEnd = home.state.alliedPlanets![IRA_PLANET].resources!;
  assert.equal(iraEnd.gas, iraAfterLaunch.gas, 'voided cargo is not refunded');
  assert.equal(selectRequestById(home.state.command, requestId)?.delivered, 0);
  assert.equal(reconcileFlights(home.state, lastReturn + MIN, undefined, { mode: 'test' }).changed, false);
});

test('arriving after the planet is gone voids the cargo even without a prior sweep; leaving the alliance still returns the cargo', () => {
  const { state, requestId } = iraRequest(world(), 120_000);
  const sent = launch(state, 'dest-gone', requestId, 3, { metal: 60_000 });
  const gone = reconcileFlights({ ...sent.state, alliedPlanets: {} }, sent.flight.arrivalAt, undefined, { mode: 'test' });
  assert.equal(gone.state.flights.records[0].cargoState, 'voided');
  const swept = reconcileAidMembership({ ...sent.state, alliedPlanets: {} }, T0 + 1_000);
  assert.equal(swept.flights.records[0].cargoState, 'voided');
  assert.equal(selectRequestById(swept.command, requestId)?.closeReason, 'planet_destroyed');
  // contrast: the member merely left, the planet still exists -> cargo returns home
  const left = kickMember(sent.state.command, sent.state.profile.playerId, TEST_ALLY_OWNER_ID, T0 + 1_000);
  assert.ok(left.ok);
  const cut = reconcileAidMembership({ ...sent.state, command: left.state }, T0 + 1_000);
  assert.equal(cut.flights.records[0].cargoState, 'loaded');
});
