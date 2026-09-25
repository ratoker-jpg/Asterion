import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import {
  dispatchFlight,
  reconcileFlights,
  recallFlight,
  requestSpyReport,
  startBot01IncomingScenario,
} from './flights.ts';
import { activeSpyMissionForTarget, getEspionageTargets } from '../domain/espionage/runtime.ts';
import { migrateEspionageState } from '../domain/espionage/repository.ts';
import { EXCLUDED_SHIP_UPGRADE_IDS } from '../domain/buildings/spaceport-upgrades.ts';
import { createSimulatorScenarioFromSpyReport } from './simulator-handoff.ts';
import { resolveSpyTarget } from './espionage-targets.ts';
import { calculateOneWayDurationMs } from '../domain/flights/speed.ts';
import { scaleRuntimeDuration } from '../domain/runtime/mode.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import type { UniverseOwnerAlliance } from '../domain/universe/types.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function spyCommand(state: ReturnType<typeof createInitialSaveState>, requestId: string, targetId: string) {
  const target = getEspionageTargets(state.espionage)[targetId];
  return {
    requestId,
    missionId: 'espionage' as const,
    originPlanetId: state.currentPlanetId,
    destination: { kind: 'planet' as const, planetId: target.id, coordinate: target.coordinate },
    targetRelation: 'neutral' as const,
    targetKind: 'npc' as const,
    targetOwnerId: target.ownerId,
    targetOwnerName: target.ownerName,
    targetPlanetName: target.name,
    targetRaceId: target.raceId,
    targetAlliance: target.alliance,
    selectedShips: { 'spy-probe': 1 },
    departedAt: 1_000,
  };
}

function otherAlliance(): UniverseOwnerAlliance {
  return {
    id: 'alliance-other',
    name: 'Другой союз',
    tag: 'OTH',
    emblem: { glyph: 'orbit', accent: 'violet' },
    glyph: 'orbit',
  };
}

function withOtherAllianceStatus(
  state: ReturnType<typeof createInitialSaveState>,
  targetId: string,
  status: 'neutral' | 'ally' | 'war',
) {
  const targets = getEspionageTargets(state.espionage);
  const target = targets[targetId];
  if (!target) throw new Error(`Missing target ${targetId}`);
  const alliance = status === 'ally'
    ? {
      id: 'alliance-current',
      name: state.command.alliance.name,
      tag: state.command.alliance.tag,
      emblem: { ...state.command.alliance.emblem },
      glyph: state.command.alliance.emblem.glyph,
    }
    : otherAlliance();
  const diplomacy = state.command.diplomacy.map((relation, index) => index === 0
    ? { ...relation, id: 'relation-other', allianceName: alliance.name, tag: alliance.tag, status }
    : relation);
  return {
    ...state,
    command: { ...state.command, diplomacy },
    espionage: {
      ...state.espionage!,
      targets: { ...targets, [targetId]: { ...target, alliance } },
    },
  };
}

function withTargets(
  state: ReturnType<typeof createInitialSaveState>,
  targets: Record<string, SpyTargetState>,
) {
  return { ...state, espionage: { ...state.espionage!, targets } };
}

function emptyTarget(state: ReturnType<typeof createInitialSaveState>, targetId: string) {
  const target = getEspionageTargets(state.espionage)[targetId];
  const ships = Object.fromEntries(Object.keys(target.fleet.ships).map((id) => [id, 0])) as typeof target.fleet.ships;
  const commanders = Object.fromEntries(Object.keys(target.fleet.commanders).map((id) => [id, 0])) as typeof target.fleet.commanders;
  const defenses = Object.fromEntries(Object.keys(target.defense.defenses).map((id) => [id, 0])) as typeof target.defense.defenses;
  return withTargets(state, {
    ...getEspionageTargets(state.espionage),
    [targetId]: {
      ...target,
      fleet: { ...target.fleet, ships, commanders },
      defense: { ...target.defense, defenses },
      commanders: {},
      hunterLevel: 0,
      population: { total: 0, fleet: 0, defense: 0 },
    },
  });
}

function planetolomAttackCommand(state: ReturnType<typeof createInitialSaveState>, requestId: string, targetId: string) {
  const target = getEspionageTargets(state.espionage)[targetId];
  return {
    requestId,
    missionId: 'attack' as const,
    originPlanetId: state.currentPlanetId,
    destination: { kind: 'planet' as const, planetId: target.id, coordinate: target.coordinate },
    targetRelation: 'neutral' as const,
    targetOwnerId: target.ownerId,
    selectedShips: { 'death-star': 1 },
    selectedCommanders: {},
    maxRounds: 5 as const,
    departedAt: 1_000,
  };
}

test('destroyed spy target returns the probe once without a new report', () => {
  const initial = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(getEspionageTargets(initial.espionage))[1];
  const originId = initial.currentPlanetId;
  const origin = initial.planets[originId];
  const prepared = emptyTarget({
    ...initial,
    shipUpgradeLevels: { ...initial.shipUpgradeLevels, 'death-star': 10 },
    planets: {
      ...initial.planets,
      [originId]: {
        ...origin,
        buildings: { ...origin.buildings, hangar: 5_000 },
        fleet: { ...origin.fleet, ships: { ...origin.fleet.ships, 'death-star': 200, 'spy-probe': 1 } },
        spaceportUpgrades: {
          ...origin.spaceportUpgrades,
          shipLevels: { ...origin.spaceportUpgrades.shipLevels, 'death-star': 10 },
        },
      },
    },
  }, targetId);
  const spy = dispatchFlight(prepared, {
    ...spyCommand(prepared, 'spy-target-destroyed', targetId),
  }, { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(spy.ok, true);
  if (!spy.ok) return;

  const dispatchedSpyFlight = spy.state.flights.records.find((flight) => flight.missionId === 'espionage');
  assert.ok(dispatchedSpyFlight);
  const delayedArrivalAt = 1_000_000;
  const delayedSpyFlight = {
    ...dispatchedSpyFlight,
    oneWayDurationMs: delayedArrivalAt - dispatchedSpyFlight.departedAt,
    arrivalAt: delayedArrivalAt,
  };
  let state: ReturnType<typeof createInitialSaveState> = {
    ...spy.state,
    flights: {
      ...spy.state.flights,
      records: spy.state.flights.records.map((flight) => flight.id === delayedSpyFlight.id ? delayedSpyFlight : flight),
    },
    espionage: {
      ...spy.state.espionage!,
      missions: spy.state.espionage!.missions.map((mission) => mission.flightId === delayedSpyFlight.id
        ? { ...mission, arrivalAt: delayedArrivalAt }
        : mission),
    },
  };
  let destroyed = false;
  for (let index = 0; index < 200 && !destroyed; index += 1) {
    const attack = dispatchFlight(state, planetolomAttackCommand(state, `target-destroyed-attack-${index}`, targetId), {
      now: 1_000,
      mode: 'test',
      testTimeScale: 15,
    });
    assert.equal(attack.ok, true);
    if (!attack.ok) return;
    const arrival = reconcileFlights(attack.state, attack.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
    state = arrival.state;
    destroyed = state.flights.records.some((flight) => flight.attackResolution?.planetDestroyed === true);
  }
  assert.equal(destroyed, true);
  const spyFlight = state.flights.records.find((flight) => flight.missionId === 'espionage');
  const spyMission = state.espionage!.missions.find((mission) => mission.flightId === spyFlight?.id);
  assert.ok(spyFlight);
  assert.ok(spyMission);
  assert.equal(Number.isFinite(spyMission?.targetDestroyedAt), true);
  assert.equal(spyMission?.status, 'returning');
  assert.equal(spyFlight?.phase, 'returning');
  assert.equal(spyFlight?.completionReason, 'spy-destroyed');
  assert.equal(state.espionage!.reports.length, 0);

  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => 10_000 });
  assert.equal(persistence.write(state).ok, true);
  const reloaded = persistence.read();
  const returned = reconcileFlights(reloaded, spyFlight!.returnAt!, undefined, { mode: 'test', testTimeScale: 15 });
  const returnedFlight = returned.state.flights.records.find((flight) => flight.id === spyFlight!.id);
  const returnedMission = returned.state.espionage!.missions.find((mission) => mission.id === spyMission!.id);
  assert.equal(returnedFlight?.phase, 'completed');
  assert.equal(returnedFlight?.completionReason, 'spy-destroyed');
  assert.equal(returnedMission?.status, 'returned');
  assert.equal(returnedMission?.targetDestroyedAt, spyMission?.targetDestroyedAt);
  assert.equal(returned.state.planets[originId].fleet.ships['spy-probe'], 1);
  assert.equal(returned.state.espionage!.reports.length, 0);
  const replay = reconcileFlights(returned.state, spyFlight!.returnAt! + 1, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(replay.changed, false);
  assert.equal(replay.state.espionage!.reports.length, 0);
});

test('same target stays blocked through transit and returning, then unlocks after actual return', () => {
  let state = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(state.espionage!.bot01Planets!)[1];
  const first = dispatchFlight(state, spyCommand(state, 'spy-a', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  state = first.state;
  const blocked = dispatchFlight(state, spyCommand(state, 'spy-b', targetId), { now: 1_001, mode: 'test', testTimeScale: 15 });
  assert.equal(blocked.ok, false);
  assert.equal(activeSpyMissionForTarget(state.espionage!.missions, state.profile.playerId, targetId)?.status, 'transit');

  const arrived = reconcileFlights(state, first.flight.arrivalAt, () => 99);
  assert.equal(arrived.changed, true);
  state = arrived.state;
  const mission = state.espionage!.missions[0];
  assert.equal(mission.status, 'orbiting');
  const immediate = requestSpyReport(state, mission.id, { now: first.flight.arrivalAt + 4_999, rng: () => 99 });
  assert.equal(immediate.ok, false);
  const atBoundary = requestSpyReport(state, mission.id, { now: first.flight.arrivalAt + 5_000, rng: () => 99 });
  assert.equal(atBoundary.ok, true);
  if (!atBoundary.ok) return;
  state = atBoundary.state;
  const recall = recallFlight(state, first.flight.id, { now: first.flight.arrivalAt + 5_000 });
  assert.equal(recall.ok, true);
  if (!recall.ok) return;
  state = recall.state;
  const blockedReturning = dispatchFlight(state, spyCommand(state, 'spy-c', targetId), { now: recall.flight.returnAt! - 1, mode: 'test', testTimeScale: 15 });
  assert.equal(blockedReturning.ok, false);
  state = reconcileFlights(state, recall.flight.returnAt!, () => 99).state;
  assert.equal(state.espionage!.missions[0].status, 'returned');
  assert.equal(state.planets['helion-01'].fleet.ships['spy-probe'], 1);
  const second = dispatchFlight(state, spyCommand(state, 'spy-d', targetId), { now: recall.flight.returnAt! + 1, mode: 'test', testTimeScale: 15 });
  assert.equal(second.ok, true);
});

test('automatic arrival report can be intercepted by Hunter and destroys the probe', () => {
  const initial = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(initial.espionage!.bot01Planets!)[0];
  const dispatched = dispatchFlight(initial, spyCommand(initial, 'spy-hunter', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(dispatched.ok, true);
  if (!dispatched.ok) return;
  const reconciled = reconcileFlights(dispatched.state, dispatched.flight.arrivalAt, () => 0);
  assert.equal(reconciled.state.espionage!.missions[0].status, 'destroyed');
  assert.equal(reconciled.state.espionage!.hunterNotices.length, 1);
  assert.equal(reconciled.state.flights.records[0].completionReason, 'spy-destroyed');
  assert.equal(reconciled.state.planets['helion-01']?.fleet.ships['spy-probe'], 0);
});

test('full report is an immutable permitted snapshot and later reconcile keeps the probe orbiting', () => {
  let state = createInitialSaveState('test', 1_000);
  state = {
    ...state,
    science: { ...state.science, levels: { ...state.science.levels, 5: 10 } },
  };
  const targetId = Object.keys(state.espionage!.bot01Planets!)[1];
  const dispatched = dispatchFlight(state, spyCommand(state, 'spy-full', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(dispatched.ok, true);
  if (!dispatched.ok) return;
  const rolls = [99, 0];
  const arrived = reconcileFlights(dispatched.state, dispatched.flight.arrivalAt, () => rolls.shift() ?? 99);
  assert.equal(arrived.events[0]?.status, 'spy-report');
  const report = arrived.state.espionage!.reports[0];
  assert.equal(report.quality, 'full');
  assert.equal(report.sourcePlanetId, state.currentPlanetId);
  assert.equal(report.resources.developmentEnergy > 0, true);
  assert.equal('buildings' in report, false);
  assert.equal(Boolean(report.fleet), true);
  assert.equal(report.fleetLevels?.scout, state.espionage?.bot01Profile?.shipLevels.scout);
  assert.equal(report.fleetLevels?.destroyer, state.espionage?.bot01Profile?.shipLevels.destroyer);
  assert.equal(Boolean(report.defense), true);
  assert.equal(Boolean(report.population), true);
  assert.equal(report.population?.total, (report.population?.fleet ?? 0) + (report.population?.defense ?? 0));
  assert.equal(report.population?.total && report.population.total >= 5_000, true);
  assert.equal(arrived.state.espionage!.missions[0].status, 'orbiting');

  const later = reconcileFlights(arrived.state, dispatched.flight.arrivalAt + 1, () => 99);
  assert.equal(later.changed, false);
  assert.equal(later.state.flights.records[0].phase, 'arrived');
  assert.equal(later.state.espionage!.missions[0].status, 'orbiting');
});

test('Bot 01 spy reports track commander counts during dispatch and after return casualties', () => {
  let initial = createInitialSaveState('test', 1_000);
  const originalTargets = getEspionageTargets(initial.espionage);
  const commanderTemplate = Object.values(originalTargets).find((candidate) => candidate.commanders.hunter && candidate.commanders.judge);
  const botSource = Object.values(originalTargets)
    .filter((candidate) => (candidate.fleet.ships['death-star'] ?? 0) > 0)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  assert.ok(commanderTemplate);
  assert.ok(botSource);
  const targetId = botSource.id;
  const target = {
    ...botSource,
    hunterLevel: 0,
    fleet: {
      ...botSource.fleet,
      commanders: { ...botSource.fleet.commanders, hunter: 1, judge: 1 },
    },
    commanders: {
      hunter: { ...commanderTemplate.commanders.hunter!, count: 1 },
      judge: { ...commanderTemplate.commanders.judge!, count: 1 },
    },
  };
  const targets = {
    ...originalTargets,
    [targetId]: target,
  };
  initial = {
    ...initial,
    science: { ...initial.science, levels: { ...initial.science.levels, 5: 10 } },
    espionage: { ...initial.espionage!, targets, bot01Planets: targets },
  };

  const launched = startBot01IncomingScenario(initial, { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  const botTargetId = launched.flight.originPlanetId;
  const botTargetInFlight = getEspionageTargets(launched.state.espionage)[botTargetId];
  assert.ok(botTargetInFlight);
  assert.equal(Object.values(botTargetInFlight.fleet.commanders).reduce((sum, count) => sum + count, 0), 0);
  assert.deepEqual(botTargetInFlight.commanders, {});

  const spy = dispatchFlight(launched.state, spyCommand(launched.state, 'spy-bot01-commanders-in-flight', botTargetId), {
    now: 1_000,
    mode: 'test',
    testTimeScale: 15,
  });
  assert.equal(spy.ok, true);
  if (!spy.ok) return;
  const botAttackArrivalAt = spy.flight.arrivalAt + spy.flight.oneWayDurationMs * 3 + 10_000;
  const delayedBotFlight = {
    ...launched.flight,
    arrivalAt: botAttackArrivalAt,
    oneWayDurationMs: botAttackArrivalAt - launched.flight.departedAt,
  };
  const scheduled = {
    ...spy.state,
    flights: {
      ...spy.state.flights,
      records: spy.state.flights.records.map((flight) => flight.id === delayedBotFlight.id ? delayedBotFlight : flight),
    },
  };
  const firstSpyRolls = [99, 0];
  const spyReportInFlight = reconcileFlights(scheduled, spy.flight.arrivalAt, () => firstSpyRolls.shift() ?? 99);
  const reportDuringFlight = spyReportInFlight.state.espionage!.reports.at(-1);
  assert.equal(reportDuringFlight?.quality, 'full');
  assert.deepEqual(reportDuringFlight?.commanders, {});

  const recalledSpy = recallFlight(spyReportInFlight.state, spy.flight.id, { now: spy.flight.arrivalAt + 1, mode: 'test', testTimeScale: 15 });
  assert.equal(recalledSpy.ok, true);
  if (!recalledSpy.ok) return;
  const returnedSpy = reconcileFlights(recalledSpy.state, recalledSpy.flight.returnAt!);
  assert.equal(returnedSpy.state.espionage!.missions.find((mission) => mission.flightId === spy.flight.id)?.status, 'returned');

  const attackArrival = reconcileFlights(returnedSpy.state, botAttackArrivalAt, undefined, { mode: 'test', testTimeScale: 1 });
  const botAttack = attackArrival.state.flights.records.find((flight) => flight.id === delayedBotFlight.id);
  const botBattle = botAttack?.attackResolution?.reportId
    ? attackArrival.state.combat.reports.find((report) => report.id === botAttack.attackResolution!.reportId)
    : undefined;
  assert.ok(botAttack?.returnAt);
  assert.ok(botBattle);
  assert.ok(botBattle?.attackerForce.stacks.some((stack) => stack.entityId === 'hunter'));
  assert.ok(botBattle?.attackerForce.stacks.some((stack) => stack.entityId === 'judge'));

  const casualtyReport = {
    ...botBattle!,
    attackerForce: {
      ...botBattle!.attackerForce,
      stacks: botBattle!.attackerForce.stacks.map((stack) => stack.entityId === 'hunter'
        ? { ...stack, countAfter: 0, destroyed: stack.countBefore }
        : stack.entityId === 'judge'
          ? { ...stack, countAfter: 1, destroyed: Math.max(0, stack.countBefore - 1) }
          : stack),
    },
  };
  const stateWithCasualties = {
    ...attackArrival.state,
    combat: {
      ...attackArrival.state.combat,
      reports: attackArrival.state.combat.reports.map((report) => report.id === casualtyReport.id ? casualtyReport : report),
    },
  };
  const returnedBot = reconcileFlights(stateWithCasualties, botAttack!.returnAt!, undefined, { mode: 'test', testTimeScale: 1 });
  const botTargetAfterReturn = getEspionageTargets(returnedBot.state.espionage)[botTargetId];
  assert.equal(botTargetAfterReturn.fleet.commanders.hunter, 0);
  assert.equal(botTargetAfterReturn.commanders.hunter, undefined);
  assert.equal(botTargetAfterReturn.fleet.commanders.judge, 1);
  assert.equal(botTargetAfterReturn.commanders.judge?.count, 1);

  const secondSpy = dispatchFlight(returnedBot.state, spyCommand(returnedBot.state, 'spy-bot01-commanders-after-return', botTargetId), {
    now: botAttack!.returnAt! + 1,
    mode: 'test',
    testTimeScale: 15,
  });
  assert.equal(secondSpy.ok, true);
  if (!secondSpy.ok) return;
  const secondSpyRolls = [99, 0];
  const reportAfterReturn = reconcileFlights(secondSpy.state, secondSpy.flight.arrivalAt, () => secondSpyRolls.shift() ?? 99)
    .state.espionage!.reports.at(-1);
  assert.equal(reportAfterReturn?.quality, 'full');
  assert.equal(reportAfterReturn?.commanders?.hunter?.count ?? 0, 0);
  assert.equal(reportAfterReturn?.commanders?.judge?.count, 1);
});

test('spy reports use the current science level after the probe has arrived', () => {
  let state = createInitialSaveState('test', 1_000);
  state = {
    ...state,
    science: { ...state.science, levels: { ...state.science.levels, 5: 11 } },
  };
  const targetId = Object.keys(state.espionage!.bot01Planets!)[1];
  const dispatched = dispatchFlight(state, spyCommand(state, 'spy-current-level', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(dispatched.ok, true);
  if (!dispatched.ok) return;
  const arrived = reconcileFlights(dispatched.state, dispatched.flight.arrivalAt, () => 99);
  const firstReport = arrived.state.espionage!.reports[0];
  assert.equal(firstReport.spyLevel, 11);

  state = {
    ...arrived.state,
    science: { ...arrived.state.science, levels: { ...arrived.state.science.levels, 5: 12 } },
  };
  const mission = state.espionage!.missions[0];
  const next = requestSpyReport(state, mission.id, { now: dispatched.flight.arrivalAt + 5_000, rng: () => 99 });
  assert.equal(next.ok, true);
  if (!next.ok) return;
  const secondReport = next.state.espionage!.reports.at(-1);
  assert.equal(secondReport?.spyLevel, 12);
  assert.equal(secondReport?.delta, 2);
  assert.equal(next.state.espionage!.missions[0].spyLevel, 12);
});

test('one owner cannot send a second active probe from another origin to the same target', () => {
  let state = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(state.espionage!.bot01Planets!)[1];
  const secondOriginId = 'test-origin-02';
  const homeworld = state.planets[state.currentPlanetId];
  state = {
    ...state,
    planets: {
      ...state.planets,
      [secondOriginId]: {
        ...homeworld,
        name: 'Helion 02',
        fleet: { ...homeworld.fleet, ships: { ...homeworld.fleet.ships, 'spy-probe': (homeworld.fleet.ships['spy-probe'] ?? 0) + 1 } },
      },
    },
  };
  const first = dispatchFlight(state, spyCommand(state, 'spy-owner-a', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = dispatchFlight(first.state, { ...spyCommand(first.state, 'spy-owner-b', targetId), originPlanetId: secondOriginId }, { now: 1_001, mode: 'test', testTimeScale: 15 });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.error.code, 'spy-target-blocked');
});

test('production rolls are seeded: the same mission replays the same outcome without an injected rng', () => {
  const runMission = () => {
    const initial = createInitialSaveState('test', 1_000);
    const targetId = Object.keys(initial.espionage!.bot01Planets!)[2];
    const dispatched = dispatchFlight(initial, spyCommand(initial, 'spy-seeded', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
    assert.equal(dispatched.ok, true);
    if (!dispatched.ok) return null;
    // No rng argument: the runtime must derive its own deterministic seeded rolls.
    const arrived = reconcileFlights(dispatched.state, dispatched.flight.arrivalAt);
    return {
      status: arrived.state.espionage!.missions[0].status,
      roll: arrived.state.espionage!.reports[0]?.roll,
      quality: arrived.state.espionage!.reports[0]?.quality,
    };
  };
  const first = runMission();
  const second = runMission();
  assert.ok(first);
  assert.ok(second);
  if (!first || !second) return;
  assert.equal(first.status, 'orbiting');
  assert.equal(second.status, first.status);
  assert.equal(second.roll, first.roll);
  assert.equal(second.quality, first.quality);
  assert.equal(Number.isInteger(first.roll) && first.roll! >= 0 && first.roll! <= 99, true);
});

test('seeded report rolls differ between distinct missions to the same target', () => {
  const runMission = (requestId: string) => {
    const initial = createInitialSaveState('test', 1_000);
    const targetId = Object.keys(initial.espionage!.bot01Planets!)[3];
    const dispatched = dispatchFlight(initial, spyCommand(initial, requestId, targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
    assert.equal(dispatched.ok, true);
    if (!dispatched.ok) return null;
    const arrived = reconcileFlights(dispatched.state, dispatched.flight.arrivalAt);
    return arrived.state.espionage!.reports[0]?.roll;
  };
  const first = runMission('spy-seed-one');
  const second = runMission('spy-seed-two');
  assert.ok(first !== undefined);
  assert.ok(second !== undefined);
  assert.notEqual(second, first);
});

test('full report carries a 0..10 level for every combat hull even when the planet state predates shipLevels', () => {
  const initial = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(initial.espionage!.bot01Planets!)[1];
  // Science level 10 keeps delta at 0 so a roll of 0 resolves to a full dossier.
  const boosted = {
    ...initial,
    science: { ...initial.science, levels: { ...initial.science.levels, 5: 10 } },
  } as typeof initial;
  // Simulate an old save: the planet snapshot has no ship levels at all.
  const aged = {
    ...boosted,
    espionage: {
      ...boosted.espionage!,
      bot01Planets: {
        ...boosted.espionage!.bot01Planets!,
        [targetId]: { ...boosted.espionage!.bot01Planets![targetId], shipLevels: undefined },
      },
    },
  } as typeof initial;
  const dispatched = dispatchFlight(aged, spyCommand(aged, 'spy-levels', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(dispatched.ok, true);
  if (!dispatched.ok) return;
  // Roll sequence: hunter roll 99 (probe survives), report roll 0 (full dossier).
  const rolls = [99, 0];
  const arrived = reconcileFlights(dispatched.state, dispatched.flight.arrivalAt, () => rolls.shift() ?? 99);
  const report = arrived.state.espionage!.reports[0];
  assert.equal(report.quality, 'full');
  const fleet = report.fleet ?? {};
  const levels = report.fleetLevels ?? {};
  let combatHulls = 0;
  for (const [id, count] of Object.entries(fleet)) {
    if (!count || count <= 0) continue;
    if (EXCLUDED_SHIP_UPGRADE_IDS.has(id)) continue;
    combatHulls += 1;
    const level = levels[id as keyof typeof levels];
    assert.equal(typeof level, 'number');
    assert.ok((level as number) >= 0 && (level as number) <= 10, `level for ${id} must stay inside 0..10`);
  }
  assert.ok(combatHulls > 0, 'the fixture fleet must contain combat hulls');
  // The replay of the same mission must keep the derived levels stable.
  const replayRolls = [99, 0];
  const replayed = reconcileFlights(dispatched.state, dispatched.flight.arrivalAt, () => replayRolls.shift() ?? 99);
  assert.deepEqual(replayed.state.espionage!.reports[0]?.fleetLevels, levels);
  assert.equal(report.population?.total, (report.population?.fleet ?? 0) + (report.population?.defense ?? 0));
});

test('full spy report handoff preserves owner ship levels in the battle simulator', () => {
  const initial = createInitialSaveState('test', 1_000);
  const planetId = initial.currentPlanetId;
  const planet = initial.planets[planetId];
  const state = {
    ...initial,
    shipUpgradeLevels: { ...initial.shipUpgradeLevels, scout: 4, hunter: 20 },
    planets: {
      ...initial.planets,
      [planetId]: {
        ...planet,
        fleet: {
          ...planet.fleet,
          ships: { ...planet.fleet.ships, scout: 3 },
          commanders: { ...planet.fleet.commanders, hunter: 1 },
        },
        spaceportUpgrades: {
          ...planet.spaceportUpgrades,
          shipLevels: { ...planet.spaceportUpgrades.shipLevels, scout: 4, hunter: 20 },
        },
      },
    },
  };
  const report = {
    id: 'spy-report-simulator-levels',
    missionId: 'spy-simulator-levels',
    createdAt: 1_000,
    sourcePlanetId: planetId,
    targetPlanetId: 'bot-01-1',
    targetPlanetName: 'Кальдера',
    targetOwnerId: 'npc-bot-01',
    targetOwnerName: 'Бот 01',
    targetRaceId: 'veyra',
    targetRelation: 'neutral',
    targetCoordinate: { galaxy: 1, system: 11, position: 10 },
    spyLevel: 10,
    targetEspionageLevel: 10,
    delta: 0,
    roll: 0,
    quality: 'full',
    resources: { metal: 1, minerals: 1, gas: 1, debris: 0, developmentEnergy: 1 },
    fleet: { battleship: 23, cruiser: 4 },
    fleetLevels: { battleship: 2, cruiser: 4 },
    commanders: { hunter: { level: 20, count: 1 }, judge: { level: 1, count: 1 } },
    defense: { 'ballistic-turret': 1 },
    population: { total: 100, fleet: 50, defense: 50 },
    firstReport: true,
  } satisfies SpyReportSnapshot;
  const scenario = createSimulatorScenarioFromSpyReport(state, report);
  assert.equal(scenario.attacker.ships.find((stack) => stack.entityId === 'scout')?.level, 4);
  assert.equal(scenario.attacker.commanders.find((stack) => stack.entityId === 'hunter')?.level, 20);
  assert.equal(scenario.defender.ships.find((stack) => stack.entityId === 'battleship')?.level, 2);
  assert.equal(scenario.defender.ships.find((stack) => stack.entityId === 'cruiser')?.level, 4);
  assert.equal(scenario.defender.commanders.find((stack) => stack.entityId === 'hunter')?.count, 1);
  assert.equal(scenario.defender.activeCommanderId, 'hunter');
  assert.equal(scenario.defender.commanders.find((stack) => stack.entityId === 'judge')?.level, 1);
});

test('the authoritative spy resolver derives self, ally, neutral and war enemy relations', () => {
  const initial = createInitialSaveState('test', 1_000);
  const source = Object.values(getEspionageTargets(initial.espionage))[1];
  assert.ok(source);
  const currentAlliance: UniverseOwnerAlliance = {
    id: 'alliance-current',
    name: initial.command.alliance.name,
    tag: initial.command.alliance.tag,
    emblem: { ...initial.command.alliance.emblem },
    glyph: initial.command.alliance.emblem.glyph,
  };
  const targets = {
    self: { ...source, id: 'spy-self', ownerId: initial.profile.playerId, ownerName: initial.profile.displayName, alliance: null },
    ally: { ...source, id: 'spy-ally', ownerId: 'owner-ally', ownerName: 'Союзник', alliance: currentAlliance },
    neutral: { ...source, id: 'spy-neutral', ownerId: 'owner-neutral', ownerName: 'Нейтральный', alliance: null },
    other: { ...source, id: 'spy-other', ownerId: 'owner-other', ownerName: 'Другой союз', alliance: otherAlliance() },
  } satisfies Record<string, SpyTargetState>;
  const state = withTargets(initial, targets);

  assert.equal(resolveSpyTarget(state, 'self')?.relation, 'self');
  assert.equal(resolveSpyTarget(state, 'ally')?.relation, 'ally');
  assert.equal(resolveSpyTarget(state, 'neutral')?.relation, 'neutral');
  assert.equal(resolveSpyTarget(state, 'other')?.relation, 'neutral');
  const atWar = withOtherAllianceStatus(state, 'other', 'war');
  assert.equal(resolveSpyTarget(atWar, 'other')?.relation, 'enemy');
});

test('spy probe duration uses the common speed, distance and Test Mode scale calculation', () => {
  const initial = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(getEspionageTargets(initial.espionage))[1];
  const result = dispatchFlight(initial, spyCommand(initial, 'spy-flight-time', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const expectedUnscaled = calculateOneWayDurationMs(result.flight.originCoordinate, result.flight.destinationCoordinate, result.flight.effectiveSpeed);
  assert.equal(result.flight.oneWayDurationMs, scaleRuntimeDuration(expectedUnscaled, 'test', 15));
  assert.notEqual(result.flight.oneWayDurationMs, 3_000);
});

test('neutral to ally during outbound transit starts an irreversible automatic return', () => {
  const initial = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(getEspionageTargets(initial.espionage))[1];
  const sent = dispatchFlight(initial, spyCommand(initial, 'spy-diplomacy-transit', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const allyState = withOtherAllianceStatus(sent.state, targetId, 'ally');
  const returned = reconcileFlights(allyState, sent.flight.arrivalAt - 1, () => 99);
  assert.equal(returned.state.espionage!.missions[0].status, 'returning');
  assert.equal(returned.state.flights.records[0].phase, 'returning');
  assert.equal(returned.state.flights.records[0].completionReason, 'target-unavailable');
  assert.equal(returned.state.espionage!.reports.length, 0);

  const neutralAgain = withOtherAllianceStatus(returned.state, targetId, 'neutral');
  const stillReturning = reconcileFlights(neutralAgain, returned.state.flights.records[0].returnAt! - 1, () => 99);
  assert.equal(stillReturning.state.espionage!.missions[0].status, 'returning');
  const completed = reconcileFlights(stillReturning.state, returned.state.flights.records[0].returnAt!, () => 99);
  assert.equal(completed.state.espionage!.missions[0].status, 'returned');
  assert.equal(completed.state.flights.records[0].completionReason, 'target-unavailable');
  assert.match(completed.events.at(-1)?.notice ?? '', /цель стала союзной/i);
  const sentAgain = dispatchFlight(completed.state, spyCommand(completed.state, 'spy-diplomacy-transit-again', targetId), { now: returned.state.flights.records[0].returnAt! + 1, mode: 'test', testTimeScale: 15 });
  assert.equal(sentAgain.ok, true);
});

test('neutral to ally after arrival starts return and blocks reports and resends while preserving old reports', () => {
  const initial = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(getEspionageTargets(initial.espionage))[1];
  const sent = dispatchFlight(initial, spyCommand(initial, 'spy-diplomacy-orbit', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const arrived = reconcileFlights(sent.state, sent.flight.arrivalAt, () => 99);
  assert.equal(arrived.state.espionage!.missions[0].status, 'orbiting');
  assert.equal(arrived.state.espionage!.reports.length, 1);
  const allyState = withOtherAllianceStatus(arrived.state, targetId, 'ally');
  const report = requestSpyReport(allyState, arrived.state.espionage!.missions[0].id, { now: sent.flight.arrivalAt + 5_000, rng: () => 99 });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, 'spy-target-blocked');
  assert.equal(report.state.espionage!.missions[0].status, 'returning');
  assert.equal(report.state.flights.records[0].completionReason, 'target-unavailable');
  assert.equal(report.state.espionage!.reports.length, 1);
  const blockedSend = dispatchFlight(report.state, spyCommand(report.state, 'spy-diplomacy-orbit-again', targetId), { now: sent.flight.arrivalAt + 5_001, mode: 'test', testTimeScale: 15 });
  assert.equal(blockedSend.ok, false);
  assert.equal(blockedSend.error.code, 'spy-target-blocked');
  const returned = reconcileFlights(report.state, report.state.flights.records[0].returnAt!, () => 99);
  assert.equal(returned.state.espionage!.missions[0].status, 'returned');
  assert.equal(returned.state.flights.records[0].completionReason, 'target-unavailable');
  assert.match(returned.events.at(-1)?.notice ?? '', /цель стала союзной/i);
});

test('production accepts an injected future owner target without importing the Bot 01 fixture', () => {
  const production = createInitialSaveState('production', 1_000);
  assert.equal(Object.keys(getEspionageTargets(production.espionage)).length, 0);
  const fixture = Object.values(getEspionageTargets(createInitialSaveState('test', 1_000).espionage))[1];
  assert.ok(fixture);
  const target = { ...fixture, id: 'future-owner-planet', ownerId: 'future-owner', ownerName: 'Будущий владелец', alliance: null };
  const injected = withTargets(production, { [target.id]: target });
  const sent = dispatchFlight(injected, spyCommand(injected, 'spy-production-injected-target', target.id), { now: 1_000, mode: 'production' });
  assert.equal(sent.ok, true);
  assert.equal(Object.values(getEspionageTargets(sent.state.espionage)).some((item) => item.ownerId === 'npc-bot-01'), false);
});

test('the same target resolver and flight mechanic accept Aegis, Synod and Veyra owners', () => {
  for (const raceId of ['aegis', 'synod', 'veyra'] as const) {
    const production = createInitialSaveState('production', 1_000);
    const fixture = Object.values(getEspionageTargets(createInitialSaveState('test', 1_000).espionage))[1];
    const target = { ...fixture, id: `race-target-${raceId}`, ownerId: `owner-${raceId}`, ownerName: `${raceId} owner`, raceId, alliance: null };
    const state = withTargets(production, { [target.id]: target });
    const sent = dispatchFlight(state, spyCommand(state, `spy-race-${raceId}`, target.id), { now: 1_000, mode: 'production' });
    assert.equal(sent.ok, true, `dispatch should work for ${raceId}`);
    assert.equal(resolveSpyTarget(state, target.id)?.relation, 'neutral');
  }
});

test('old-contract bot planets are regenerated while historical reports stay immutable', () => {
  const legacy = {
    missions: [],
    reports: [{
      id: 'spy-report-legacy-1',
      missionId: 'mission-legacy-1',
      createdAt: 1_000,
      sourcePlanetId: 'helion-01',
      targetPlanetId: 'bot-01',
      targetPlanetName: 'Бот 01 I',
      targetOwnerId: 'npc-bot-01',
      targetOwnerName: 'Бот 01',
      targetRaceId: 'veyra',
      targetRelation: 'neutral',
      targetCoordinate: { galaxy: 1, system: 2, position: 3 },
      spyLevel: 10,
      targetEspionageLevel: 10,
      delta: 0,
      roll: 99,
      quality: 'full',
      resources: { metal: 1, minerals: 1, gas: 1, debris: 0, developmentEnergy: 5 },
      fleet: { scout: 10 },
      commanders: {},
      defense: { 'turret': 5 },
      // Old contract: population is detached from the fleet/defense split.
      population: { civilian: 1_600, total: 1_600, fleet: 160, defense: 300 },
      firstReport: true,
    }],
    hunterNotices: [],
    bot01Planets: {
      'bot-01': {
        id: 'bot-01',
        name: 'Бот 01 I',
        coordinate: { galaxy: 1, system: 2, position: 3 },
        ownerId: 'npc-bot-01',
        ownerName: 'Бот 01',
        raceId: 'veyra',
        alliance: null,
        espionageLevel: 10,
        resources: { metal: 0, minerals: 0, gas: 0, developmentEnergy: 0, debris: 0 },
        buildings: {},
        fleet: { ships: { scout: 100 }, commanders: { hunter: 0, judge: 0 } },
        defense: { defenses: {} },
        commanders: {},
        population: { civilian: 1_600, total: 1_600, fleet: 160, defense: 300 },
        hunterLevel: 0,
        debris: 0,
      },
    },
  };
  const migrated = migrateEspionageState(legacy);
  const planets = Object.values(migrated.bot01Planets ?? {});
  assert.equal(planets.length, 7);
  for (const planet of planets) {
    assert.equal(planet.shipLevels, undefined, 'levels must live in the owner profile');
    assert.equal(planet.population.total, planet.population.fleet + planet.population.defense);
    assert.ok(planet.population.total >= 5_000, 'regenerated population must follow the fixture range');
  }
  assert.equal(migrated.bot01Profile?.shipLevels.transporter, 5);
  // The legacy report keeps its historical snapshot untouched.
  const report = migrated.reports[0];
  assert.equal(report.quality, 'full');
  assert.equal(report.population?.fleet, 160);
  assert.equal(report.population?.defense, 300);
  assert.equal(report.population?.total, 1_600);
  assert.equal(report.population?.civilian, 1_600);
});
