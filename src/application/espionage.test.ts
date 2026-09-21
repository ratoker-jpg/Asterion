import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState } from './persistence.ts';
import {
  dispatchFlight,
  reconcileFlights,
  recallFlight,
  requestSpyReport,
} from './flights.ts';
import { activeSpyMissionForTarget } from '../domain/espionage/runtime.ts';
import { migrateEspionageState } from '../domain/espionage/repository.ts';
import { EXCLUDED_SHIP_UPGRADE_IDS } from '../domain/buildings/spaceport-upgrades.ts';
import { createSimulatorScenarioFromSpyReport } from './simulator-handoff.ts';
import type { SpyReportSnapshot } from '../domain/espionage/types.ts';

function spyCommand(state: ReturnType<typeof createInitialSaveState>, requestId: string, targetId: string) {
  const target = state.espionage!.bot01Planets![targetId];
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
    commanders: { judge: { level: 1, count: 1 } },
    defense: { 'ballistic-turret': 1 },
    population: { total: 100, fleet: 50, defense: 50 },
    firstReport: true,
  } satisfies SpyReportSnapshot;
  const scenario = createSimulatorScenarioFromSpyReport(state, report);
  assert.equal(scenario.attacker.ships.find((stack) => stack.entityId === 'scout')?.level, 4);
  assert.equal(scenario.attacker.commanders.find((stack) => stack.entityId === 'hunter')?.level, 20);
  assert.equal(scenario.defender.ships.find((stack) => stack.entityId === 'battleship')?.level, 2);
  assert.equal(scenario.defender.ships.find((stack) => stack.entityId === 'cruiser')?.level, 4);
  assert.equal(scenario.defender.commanders.find((stack) => stack.entityId === 'judge')?.level, 1);
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
