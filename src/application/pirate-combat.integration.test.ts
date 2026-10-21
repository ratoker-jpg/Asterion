import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchFlight, getAvailableFleetForPlanet, reconcileFlights } from './flights.ts';
import { createInitialSaveState, createPersistenceFacade, type StorageLike } from './persistence.ts';
import { replacePlanetResources, replacePlanetState, type SaveState } from './contracts.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { calculateFleetPopulation } from '../domain/fleet/runtime.ts';
import type { CommanderId } from '../domain/combat/commanders.ts';
import { COMMANDER_COMBAT_CATALOG } from '../domain/combat/catalog.ts';
import { COMBAT_TECHNOLOGIES } from '../domain/combat/technologies.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { getCurrentPirateContact } from './pirates.ts';
import {
  createDefaultPirateContactState,
  getOrCreatePirateOwnerProfile,
} from '../domain/pirates/contact.ts';
import { calculateAttackDebris } from './attack.ts';
import { calculatePirateForceDebris } from '../domain/pirates/debris.ts';
import { battleDebrisRoll } from '../domain/combat/debris.ts';
import { pirateHangarFraction } from '../domain/pirates/threat.ts';
import { calculatePirateEliminationPopulationBudget } from '../domain/pirates/profile.ts';
import { isPirateMissionSnapshot, normalizePirateMissionSnapshot } from '../domain/pirates/mission.ts';
import { PIRATE_BASE_SHIPS, type PirateBaseShipId } from '../domain/pirates/catalog.ts';
import { getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';
import type { UniverseCoordinate } from '../domain/universe/types.ts';

const ORIGIN_ID = 'helion-01';
const TEST_TIME_SCALE = 500;

type FleetManifest = {
  ships: Partial<Record<ShipId, number>>;
  commanders?: Partial<Record<CommanderId, number>>;
};

function firstPirateSchedule() {
  const schedule = Array.from({ length: 100 }, (_, cycleIndex) =>
    getUniverseTimedObjectSchedule('pirate', 1, 2, cycleIndex)).find((candidate) => candidate.present);
  assert.ok(schedule, 'the deterministic fixture must include a pirate cycle');
  return schedule;
}

function withManifest(state: SaveState, manifest: FleetManifest, upgrades: Record<string, number> = {}): SaveState {
  const planet = state.planets[ORIGIN_ID]!;
  const empty = createEmptyFleetState();
  const next = replacePlanetState(state, ORIGIN_ID, {
    ...planet,
    fleet: {
      ...empty,
      ships: { ...empty.ships, ...manifest.ships },
      commanders: { ...empty.commanders, ...manifest.commanders },
    },
  });
  return {
    ...next,
    shipUpgradeLevels: { ...next.shipUpgradeLevels, ...upgrades },
  };
}

function withCombatScience(state: SaveState, level: number): SaveState {
  const levels = Object.fromEntries(COMBAT_TECHNOLOGIES.map((technology) => [technology.sourceScienceId, level]));
  return {
    ...state,
    science: { ...state.science, levels: { ...state.science.levels, ...levels } },
  };
}

function withPirateProfile(state: SaveState, contactCycleKey: string, resourcePoints = 0): SaveState {
  const current = state.pirate?.contact ?? createDefaultPirateContactState();
  const ownerId = state.profile.playerId;
  const materialized = getOrCreatePirateOwnerProfile(current, {
    ownerId,
    contactCycleKey,
    score: { resourcePoints, battlePoints: 0, totalPoints: resourcePoints },
  });
  return {
    ...state,
    pirate: {
      ...(state.pirate ?? { version: 1 as const, reconReports: [], reconLastDispatchAt: {} }),
      contact: materialized.state,
    },
  };
}

function fixture(manifest: FleetManifest, options: {
  resourcePoints?: number;
  scienceLevel?: number;
  shipUpgrades?: Record<string, number>;
  now?: number;
} = {}) {
  const schedule = firstPirateSchedule();
  const now = options.now ?? schedule.startAt + 1;
  let state = createInitialSaveState('test', now);
  const contact = getCurrentPirateContact(state, { galaxy: 1, system: 2, position: 1 }, now, 'test');
  assert.ok(contact, 'fixture time must resolve to the scheduled pirate contact');
  // Raid eligibility is based on ownership in the target system, not on its origin.
  state = {
    ...state,
    planets: {
      ...state.planets,
      'combat-raid-colony': {
        ...state.planets[ORIGIN_ID]!,
        name: 'Combat raid access colony',
        universeGalaxy: contact.coordinate.galaxy,
        universeSystem: contact.coordinate.system,
        universePosition: contact.coordinate.position === 1 ? 2 : 1,
        fleet: createEmptyFleetState(),
      },
    },
  };
  // A new colony can shift the free slot used by a procedural contact. Resolve
  // the active contact again after registering ownership; its cycle stays stable.
  const ownedContact = getCurrentPirateContact(state, contact.coordinate, now, 'test');
  assert.ok(ownedContact);
  assert.equal(ownedContact.contactCycleKey, contact.contactCycleKey);
  state = withManifest(state, manifest, options.shipUpgrades);
  state = withCombatScience(state, options.scienceLevel ?? 0);
  state = withPirateProfile(state, ownedContact.contactCycleKey, options.resourcePoints ?? 0);
  state = replacePlanetResources(state, ORIGIN_ID, {
    ...state.planets[ORIGIN_ID]!.resources!,
    gas: 1_000_000_000,
  });
  return { state, contact: ownedContact, now };
}

function eliminationCommand(
  contact: NonNullable<ReturnType<typeof getCurrentPirateContact>>,
  now: number,
  requestId: string,
  manifest: FleetManifest,
  maxRounds: 5 | 8 | 12 = 12,
) {
  return {
    requestId,
    missionId: 'pirate-elimination' as const,
    originPlanetId: ORIGIN_ID,
    destination: { kind: 'coordinate' as const, coordinate: { ...contact.coordinate } },
    contactCycleKey: contact.contactCycleKey,
    targetKind: 'pirate' as const,
    targetRelation: 'neutral' as const,
    selectedShips: manifest.ships,
    selectedCommanders: manifest.commanders ?? {},
    maxRounds,
    departedAt: now,
  };
}

function dispatchElimination(
  state: SaveState,
  contact: NonNullable<ReturnType<typeof getCurrentPirateContact>>,
  now: number,
  requestId: string,
  manifest: FleetManifest,
  maxRounds: 5 | 8 | 12 = 12,
) {
  return dispatchFlight(state, eliminationCommand(contact, now, requestId, manifest, maxRounds), {
    now,
    mode: 'test',
    testTimeScale: TEST_TIME_SCALE,
  });
}

function arrive(state: SaveState, at: number) {
  return reconcileFlights(state, at, undefined, { mode: 'test' });
}

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function pirateDefenderStacks(report: NonNullable<SaveState['combat']['reports'][number]>) {
  return report.defenderForce.stacks.filter((stack) => stack.entityId.startsWith('pirate-'));
}

function assertNoBattlePointAward(state: SaveState, reportId: string) {
  assert.equal(Object.hasOwn(state.rating.battleAwardsByReportId, reportId), false);
}

test('public elimination dispatch resolves a full wipe, applies the quiet window, and returns the reserved fleet once', () => {
  const manifest = { ships: { 'death-star': 48 }, commanders: { corsair: 1 } } satisfies FleetManifest;
  const { state, contact, now } = fixture(manifest, {
    shipUpgrades: { 'death-star': 10, corsair: 10 },
    scienceLevel: 15,
  });
  const launched = dispatchElimination(state, contact, now, 'pirate-win', manifest);
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  assert.ok(launched.flight.arrivalAt < contact.expiresAt);
  const adaptiveSnapshot=launched.flight.pirateSnapshot!;
  assert.equal(adaptiveSnapshot.adaptiveQ,0);
  assert.ok(adaptiveSnapshot.adaptiveWeight!==undefined);
  assert.ok(adaptiveSnapshot.eliminationBudget!.coefficient!>=0.90
    &&adaptiveSnapshot.eliminationBudget!.coefficient!<0.95);
  assert.equal(adaptiveSnapshot.defeatMultiplier,0.5);
  assert.equal(adaptiveSnapshot.drawMultiplier,0.75);
  const launchSnapshot = launched.flight.attackSnapshot!;
  const reportId = `battle-pirate-${launched.flight.id}`;
  const changedScience = Object.fromEntries(COMBAT_TECHNOLOGIES.map((technology) => [technology.sourceScienceId, 0]));
  const changedLiveState = {
    ...launched.state,
    science: { ...launched.state.science, levels: { ...launched.state.science.levels, ...changedScience } },
    shipUpgradeLevels: { ...launched.state.shipUpgradeLevels, 'death-star': 0 },
  };
  const arrived = arrive(changedLiveState, launched.flight.arrivalAt);
  const report = arrived.state.combat.reports.find((candidate) => candidate.id === reportId);
  assert.ok(report, 'arrival must create the canonical combat report');
  assert.equal(report.winner, 'attacker');
  assert.equal(report.defenderForce.populationAfter, 0);
  const adaptation=arrived.state.pirate?.ownerAdaptations?.[state.profile.playerId];
  assert.ok(adaptation);
  if(adaptiveSnapshot.adaptiveWeight!>=0.05){
    assert.equal(adaptation.wins,1);
    assert.ok(adaptation.q>0);
    assert.equal(adaptation.weightedBattles,adaptiveSnapshot.adaptiveWeight);
  }
  assert.equal(report.attacker.race, 'Астеры');
  assert.equal(report.defender.race, 'pirates');
  assert.deepEqual(report.attackerForce.technologyLevels, launchSnapshot.attackerTechnologies);
  assert.equal(report.initialSnapshot?.attacker.stacks.find((stack) => stack.entityId === 'death-star')?.level, 10);
  assert.notDeepEqual(report.attackerForce.technologyLevels, changedLiveState.science.levels);
  assert.equal(arrived.state.pirate?.contact.defeatedCycles[contact.contactCycleKey]?.defeatedAt, launched.flight.arrivalAt);
  assert.equal(
    arrived.state.pirate?.contact.defeatedCycles[contact.contactCycleKey]?.nextEligibleAt,
    launched.flight.arrivalAt + 15 * 60 * 1_000,
  );
  assertNoBattlePointAward(arrived.state, reportId);

  const corsair = report.attackerForce.stacks.find((stack) => stack.entityId === 'corsair');
  assert.equal(corsair?.countAfter, 1);
  const expectedPirateDebris = calculatePirateForceDebris(report.defenderForce, report.attackerForce, report.missionType, battleDebrisRoll(report.id));
  assert.ok(expectedPirateDebris > 0);
  const reportDebris = report.debris ?? 0;
  assert.ok(reportDebris >= expectedPirateDebris);
  assert.equal(reportDebris, calculateAttackDebris(report, launchSnapshot.attackerFactionId, launchSnapshot.attackerFactionId));
  assert.equal(getAvailableFleetForPlanet(arrived.state, ORIGIN_ID).ships['death-star'], 0);
  assert.equal(getAvailableFleetForPlanet(arrived.state, ORIGIN_ID).commanders.corsair, 0);

  const beforeQuietEnd = getCurrentPirateContact(arrived.state, contact.coordinate, launched.flight.arrivalAt + 15 * 60 * 1_000 - 1, 'test');
  assert.equal(beforeQuietEnd, null);
  const record = arrived.state.pirate!.contact.defeatedCycles[contact.contactCycleKey]!;
  const nextPresentSchedule = Array.from({ length: 100 }, (_, offset) =>
    getUniverseTimedObjectSchedule('pirate', record.galaxy, record.system, record.cycleIndex + 1 + offset,
      Object.values(arrived.state.pirate!.contact.defeatedCycles))).find((candidate) => candidate.present);
  assert.ok(nextPresentSchedule, 'a later deterministic pirate cycle must be available');
  assert.ok(nextPresentSchedule.startAt >= record.nextEligibleAt);
  const nextContact = getCurrentPirateContact(
    arrived.state,
    contact.coordinate,
    nextPresentSchedule.startAt + 1,
    'test',
  );
  assert.ok(nextContact);
  assert.notEqual(nextContact.contactCycleKey, contact.contactCycleKey);

  const completed = arrive(arrived.state, arrived.state.flights.records[0]!.returnAt!);
  assert.equal(completed.state.flights.records[0]?.phase, 'completed');
  assert.equal(completed.state.planets[ORIGIN_ID]?.fleet.ships['death-star'], 48);
  assert.equal(completed.state.planets[ORIGIN_ID]?.fleet.commanders.corsair, 1);
  assert.equal(getAvailableFleetForPlanet(completed.state, ORIGIN_ID).ships['death-star'], 48);
  assertNoBattlePointAward(completed.state, reportId);
});

test('a defeated commander is removed once, contributes ordinary debris, and does not defeat the fresh garrison', () => {
  const manifest = { ships: { scout: 2_000 }, commanders: { corsair: 1 } } satisfies FleetManifest;
  const { state, contact, now } = fixture(manifest, { resourcePoints: 1_000_000_000 });
  const firstManifest = { ships: { scout: 1_000 }, commanders: { corsair: 1 } } satisfies FleetManifest;
  const launched = dispatchElimination(state, contact, now, 'pirate-commander-loss', firstManifest, 5);
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  const reportId = `battle-pirate-${launched.flight.id}`;
  const arrived = arrive(launched.state, launched.flight.arrivalAt);
  const report = arrived.state.combat.reports.find((candidate) => candidate.id === reportId);
  assert.ok(report);
  const corsair = report.attackerForce.stacks.find((stack) => stack.entityId === 'corsair');
  assert.ok(corsair, 'the selected commander must be in the standard combat report');
  assert.ok(corsair.destroyed > 0, 'the overmatched commander fixture must produce a real commander loss');
  assert.ok(report.winner === 'defender' || report.winner === 'draw');
  assert.equal(arrived.state.planets[ORIGIN_ID]?.fleet.commanders.corsair, 0);
  assert.equal(arrived.state.pirate?.contact.defeatedCycles[contact.contactCycleKey], undefined);
  assertNoBattlePointAward(arrived.state, reportId);
  const corsairEntity = COMMANDER_COMBAT_CATALOG.find((entity) => entity.id === 'corsair')!;
  const corsairOrdinaryDebris = Math.floor(0.25 * corsairEntity.combat.life);
  const basePirateDebris = calculatePirateForceDebris(report.defenderForce, report.attackerForce, report.missionType, battleDebrisRoll(report.id));
  const expectedMultiplier=report.winner==='draw'?0.75:0.5;
  assert.equal(report.pirateReward?.multiplier,expectedMultiplier);
  const ownDebris=calculateAttackDebris(report,launched.flight.attackSnapshot!.attackerFactionId,
    launched.flight.attackSnapshot!.attackerFactionId)-basePirateDebris;
  assert.ok(ownDebris>=corsairOrdinaryDebris,'own hull debris stays on the common 25–35% base, even on pirate defeat');
  assert.equal(report.debris,ownDebris+Math.floor(basePirateDebris*expectedMultiplier),
    'only pirate wreckage receives x0.5 or x0.75; own wreckage is never penalized');

  const returning = arrived.state.flights.records.find((flight) => flight.id === launched.flight.id)!;
  const returned = arrive(arrived.state, returning.returnAt!);
  const secondDepartureAt = returning.returnAt! + 1;
  assert.ok(secondDepartureAt < contact.expiresAt);
  const secondContact = getCurrentPirateContact(returned.state, contact.coordinate, secondDepartureAt, 'test');
  assert.ok(secondContact);
  assert.equal(secondContact.contactCycleKey, contact.contactCycleKey);
  const secondManifest = { ships: { scout: 1_000 } } satisfies FleetManifest;
  const second = dispatchElimination(returned.state, secondContact, secondDepartureAt, 'pirate-fresh-garrison', secondManifest, 5);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const secondArrival = arrive(second.state, second.flight.arrivalAt);
  const secondReport = secondArrival.state.combat.reports.find((candidate) => candidate.id === `battle-pirate-${second.flight.id}`);
  assert.ok(secondReport);
  const emptyFleet = createEmptyFleetState();
  const secondSentPopulation = calculateFleetPopulation({
    ...emptyFleet,
    ships: { ...emptyFleet.ships, ...secondManifest.ships },
  }, returned.state.profile.factionId);
  const secondProfile = second.flight.pirateSnapshot!.profile;
  const expectedGarrison = second.flight.pirateSnapshot!.eliminationBudget
    ?? calculatePirateEliminationPopulationBudget(Math.round(secondSentPopulation), secondProfile.shares);
  assert.ok(expectedGarrison.targetPopulation >= Math.floor(secondSentPopulation * 0.85) - 1);
  assert.ok(expectedGarrison.targetPopulation <= Math.ceil(secondSentPopulation * 1.05) + 1);
  assert.equal(secondReport.defenderForce.populationBefore, expectedGarrison.actualPopulation);
  assert.deepEqual(
    pirateDefenderStacks(secondReport).map((stack) => [stack.entityId, stack.countBefore]),
    PIRATE_BASE_SHIPS.flatMap((ship) => (expectedGarrison.ships[ship.id as PirateBaseShipId] ?? 0) > 0
      ? [[ship.id, expectedGarrison.ships[ship.id as PirateBaseShipId] ?? 0]]
      : []),
  );
});

test('same-time elimination arrivals are ordered by flight id and only the first full win resolves combat', () => {
  const manifest = { ships: { 'death-star': 50 } } satisfies FleetManifest;
  const { state, contact, now } = fixture({ ships: { 'death-star': 100 } }, {
    shipUpgrades: { 'death-star': 10 },
    scienceLevel: 15,
  });
  const first = dispatchElimination(state, contact, now, 'a-pirate-first', manifest);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = dispatchElimination(first.state, contact, now, 'b-pirate-second', manifest);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.ok(first.flight.id < second.flight.id);
  assert.equal(first.flight.arrivalAt, second.flight.arrivalAt);

  const resolved = arrive(second.state, first.flight.arrivalAt);
  assert.deepEqual(resolved.events.map((event) => [event.flight.id, event.status]), [
    [first.flight.id, 'arrived'],
    [second.flight.id, 'target-unavailable'],
  ]);
  assert.equal(resolved.state.combat.reports.filter((report) => report.missionType === 'pirate-elimination').length, 1);
  assert.ok(resolved.state.flights.records.find((flight) => flight.id === first.flight.id)?.attackResolution);
  assert.equal(resolved.state.flights.records.find((flight) => flight.id === second.flight.id)?.attackResolution, undefined);
  const firstReport = resolved.state.combat.reports.find((report) => report.id === `battle-pirate-${first.flight.id}`)!;
  const lost = firstReport.attackerForce.stacks
    .filter((stack) => stack.entityId === 'death-star')
    .reduce((total, stack) => total + stack.destroyed, 0);
  assert.equal(resolved.state.planets[ORIGIN_ID]?.fleet.ships['death-star'], 100 - lost);
  assertNoBattlePointAward(resolved.state, firstReport.id);

  const latestReturn = Math.max(
    resolved.state.flights.records.find((flight) => flight.id === first.flight.id)!.returnAt!,
    resolved.state.flights.records.find((flight) => flight.id === second.flight.id)!.returnAt!,
  );
  const completed = arrive(resolved.state, latestReturn);
  assert.equal(completed.state.planets[ORIGIN_ID]?.fleet.ships['death-star'], 100 - lost);
  assert.equal(getAvailableFleetForPlanet(completed.state, ORIGIN_ID).ships['death-star'], 100 - lost);
});

test('small elimination awards no BP and defeats a cycle only on a full victory', () => {
  const manifest = { ships: { scout: 1 }, commanders: { corsair: 1 } } satisfies FleetManifest;
  const { state, contact, now } = fixture(manifest, { resourcePoints: 0, scienceLevel: 0 });
  const launched = dispatchElimination(state, contact, now, 'pirate-draw-0', manifest, 5);
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  const arrived = arrive(launched.state, launched.flight.arrivalAt);
  const report = arrived.state.combat.reports.find((candidate) => candidate.id === `battle-pirate-${launched.flight.id}`);
  assert.ok(report);
  if (report.winner === 'attacker' && report.defenderForce.populationAfter === 0) {
    assert.ok(arrived.state.pirate?.contact.defeatedCycles[contact.contactCycleKey]);
  } else {
    assert.equal(arrived.state.pirate?.contact.defeatedCycles[contact.contactCycleKey], undefined);
  }
  assertNoBattlePointAward(arrived.state, report.id);
});

test('offline multi-day catch-up after reload resolves one launch snapshot and cannot duplicate its report or casualties', () => {
  const manifest = { ships: { 'death-star': 48 }, commanders: { corsair: 1 } } satisfies FleetManifest;
  const { state, contact, now } = fixture(manifest, {
    shipUpgrades: { 'death-star': 10, corsair: 10 },
    scienceLevel: 15,
  });
  const launched = dispatchElimination(state, contact, now, 'pirate-offline-catch-up', manifest);
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  const reportId = `battle-pirate-${launched.flight.id}`;
  let clock = now;
  const persistence = createPersistenceFacade({ mode: 'test', storage: memoryStorage(), now: () => clock });
  assert.equal(persistence.write(launched.state).ok, true);
  clock = launched.flight.arrivalAt + 3 * 24 * 60 * 60 * 1_000;
  const hydrated = persistence.read();
  const completed = arrive(hydrated, clock);
  const report = completed.state.combat.reports.find((candidate) => candidate.id === reportId);
  assert.ok(report);
  assert.equal(report.winner, 'attacker');
  assert.equal(completed.state.flights.records.find((flight) => flight.id === launched.flight.id)?.phase, 'completed');
  assert.equal(completed.state.pirate?.contact.defeatedCycles[contact.contactCycleKey]?.defeatedAt, launched.flight.arrivalAt);
  assert.equal(completed.state.combat.reports.filter((candidate) => candidate.id === reportId).length, 1);
  assertNoBattlePointAward(completed.state, reportId);

  const replay = arrive(completed.state, clock);
  assert.equal(replay.state.combat.reports.filter((candidate) => candidate.id === reportId).length, 1);
  assert.deepEqual(replay.state.pirate?.contact.defeatedCycles, completed.state.pirate?.contact.defeatedCycles);
  assert.deepEqual(replay.state.pirate?.ownerAdaptations,completed.state.pirate?.ownerAdaptations,
    'offline replay must not credit the same victory twice');
  assert.deepEqual(replay.state.planets[ORIGIN_ID]?.fleet, completed.state.planets[ORIGIN_ID]?.fleet);
  assert.equal(replay.state.flights.records.find((flight) => flight.id === launched.flight.id)?.phase, 'completed');
});

test('new and pre-patch stored elimination snapshots survive reload and arrival without garrison recalculation or duplicate rewards',()=>{
  const manifest={ ships:{'death-star':48} } satisfies FleetManifest;
  const {state,contact,now}=fixture(manifest,{
    shipUpgrades:{'death-star':10},scienceLevel:15,
  });
  for(const cohort of ['new','legacy'] as const){
    const result=dispatchElimination(state,contact,now,`persist-garrison-${cohort}`,manifest);
    assert.equal(result.ok,true);
    if(!result.ok)return;
    const actualFlight=result.flight;
    const original=actualFlight.pirateSnapshot!;
    assert.ok(original.eliminationBudget);
    let storedBudget=original.eliminationBudget!;
    if(cohort==='legacy'){
      const target=Math.round(original.sentCombatPopulation!*0.78);
      const smaller=calculatePirateEliminationPopulationBudget(
        Math.max(0,Math.floor(target/0.9)-30),original.profile.shares);
      assert.ok(smaller.actualPopulation>0&&smaller.actualPopulation<=target);
      storedBudget=Object.freeze({
        ...smaller,coefficient:0.78,targetPopulation:target,
        absoluteError:target-smaller.actualPopulation,
      });
    }else{
      assert.ok(storedBudget.coefficient!>=0.85&&storedBudget.coefficient!<1.05);
    }
    const snapshot={...original,eliminationBudget:storedBudget};
    assert.equal(isPirateMissionSnapshot(snapshot,'pirate-elimination'),true);
    const flight={...actualFlight,pirateSnapshot:snapshot};
    const prepared={
      ...result.state,
      flights:{...result.state.flights,records:result.state.flights.records.map(f=>f.id===flight.id?flight:f)},
    };
    let clock=now;
    const facade=createPersistenceFacade({mode:'test',storage:memoryStorage(),now:()=>clock});
    assert.equal(facade.write(prepared).ok,true);
    clock=flight.arrivalAt;
    const loaded=facade.read();
    const persisted=loaded.flights.records.find(f=>f.id===flight.id);
    assert.ok(persisted,'flight must survive real save/load');
    assert.deepEqual(persisted.pirateSnapshot!.eliminationBudget,storedBudget,'do not replace frozen garrison');
    assert.deepEqual(persisted.attackSnapshot,flight.attackSnapshot,'attacker levels and technologies stay frozen');
    assert.deepEqual(persisted.pirateSnapshot!.profile,original.profile,'NPC profile stays frozen');
    assert.equal(persisted.pirateSnapshot!.rewardMultiplier,original.rewardMultiplier,'salvage multiplier stays frozen');
    const arrived=arrive(loaded,clock);
    const reportId=`battle-pirate-${flight.id}`;
    const report=arrived.state.combat.reports.find(r=>r.id===reportId);
    assert.ok(report,'real battle on arrival');
    assert.equal(report!.defenderForce.populationBefore,storedBudget.actualPopulation);
    assert.equal(report!.pirateReward?.multiplier,original.rewardMultiplier);
    assert.equal(arrived.state.combat.reports.filter(r=>r.id===reportId).length,1);
    assert.equal(facade.write(arrived.state).ok,true);
    const again=facade.read();
    const replay=arrive(again,clock);
    assert.equal(replay.state.combat.reports.filter(r=>r.id===reportId).length,1);
    assert.deepEqual(replay.state.rating,arrived.state.rating);
    assert.deepEqual(replay.state.espionage?.orbitalDebris,arrived.state.espionage?.orbitalDebris);
    const returning=replay.state.flights.records.find(f=>f.id===flight.id);
    assert.ok(returning?.returnAt);
    clock=returning!.returnAt!;
    const completed=arrive(replay.state,clock);
    const final=arrive(completed.state,clock);
    assert.equal(final.state.combat.reports.filter(r=>r.id===reportId).length,1);
    assert.deepEqual(final.state.espionage?.orbitalDebris,completed.state.espionage?.orbitalDebris);
    assert.deepEqual(final.state.rating,completed.state.rating);
  }
});

test('migration validator retains both historical 75–90% and approved 85–105% frozen coefficients',()=>{
  const manifest={ships:{'death-star':48}} satisfies FleetManifest;
  const {state,contact,now}=fixture(manifest,{shipUpgrades:{'death-star':10},scienceLevel:15});
  const launched=dispatchElimination(state,contact,now,'migration-boundaries',manifest);
  assert.equal(launched.ok,true);
  if(!launched.ok)return;
  const snapshot=launched.flight.pirateSnapshot!;
  assert.ok(snapshot.adaptiveQ===0);
  assert.ok(snapshot.adaptiveWeight!==undefined);
  assert.ok(snapshot.eliminationBudget?.coefficient!==undefined);
  assert.ok(snapshot.eliminationBudget!.coefficient!>=0.90&&snapshot.eliminationBudget!.coefficient!<0.95);
  assert.ok(snapshot.eliminationBudget);
  for(const coefficient of [0.75,0.80,0.85,0.9,1,1.05,1.10]){
    const checked: typeof snapshot={...snapshot,eliminationBudget:{...snapshot.eliminationBudget!,coefficient}};
    assert.equal(isPirateMissionSnapshot(checked,'pirate-elimination'),true,`accept frozen ${coefficient}`);
    assert.equal(normalizePirateMissionSnapshot(checked)?.eliminationBudget?.coefficient,coefficient);
  }
  for(const coefficient of [0.749999,1.100001,Number.NaN]){
    const bad: typeof snapshot={...snapshot,eliminationBudget:{...snapshot.eliminationBudget!,coefficient}};
    assert.equal(isPirateMissionSnapshot(bad,'pirate-elimination'),false,`reject ${coefficient}`);
  }
});

test('report threat reduction uses the same hangar fraction the threat reducer applies', () => {
  const manifest = { ships: { 'death-star': 48 } } satisfies FleetManifest;
  const { state, contact, now } = fixture(manifest, { shipUpgrades: { 'death-star': 10 }, scienceLevel: 15 });
  const launched = dispatchElimination(state, contact, now, 'pirate-threat-fraction', manifest);
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  const sent = launched.flight.pirateSnapshot!.sentCombatPopulation!;
  assert.ok(sent > 1);
  // Corrupt snapshot: sent population exceeds the stored hangar capacity.
  const tampered = { ...launched.flight, pirateSnapshot: { ...launched.flight.pirateSnapshot!, historicalHangarCapacity: sent - 1 } };
  const prepared = { ...launched.state, flights: { ...launched.state.flights,
    records: launched.state.flights.records.map((flight) => flight.id === tampered.id ? tampered : flight) } };
  const arrived = arrive(prepared, tampered.arrivalAt);
  const report = arrived.state.combat.reports.find((candidate) => candidate.id === `battle-pirate-${tampered.id}`);
  assert.ok(report);
  assert.equal(report.winner, 'attacker');
  assert.equal(report.pirateReward?.threatReductionFraction, pirateHangarFraction(sent, sent - 1));
  assert.equal(report.pirateReward?.threatReductionFraction, 0);
});
