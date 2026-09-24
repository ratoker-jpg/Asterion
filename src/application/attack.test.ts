import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { dispatchFlight, recallFlight, reconcileFlights, startBot01IncomingScenario } from './flights.ts';
import { getPlanetResources, replacePlanetResources, replacePlanetState } from './contracts.ts';
import { selectOwnedPlanet } from './owned-planets.ts';
import { getOrbitalDebrisAtCoordinate } from '../domain/espionage/orbital-debris.ts';
import { selectCurrentAlliance } from '../domain/command/selectors.ts';
import { calculateAttackDebris, calculateAttackLoot, resolveAttackAtTarget, technologiesFromScience } from './attack.ts';
import { getFactionCombatEntity } from '../domain/combat/faction-catalog.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import type { FlightDestination } from '../domain/flights/types.ts';
import type { ShipId } from '../domain/combat/ids.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

type AttackCommandOptions = {
  targetRelation?: 'enemy' | 'neutral';
  selectedShips?: Partial<Record<ShipId, number>>;
  departedAt?: number;
  maxRounds?: 5 | 8 | 12;
};

function attackCommand(
  state: ReturnType<typeof createInitialSaveState>,
  requestId: string,
  targetId: string,
  options: AttackCommandOptions = {},
) {
  const target = state.espionage!.targets![targetId];
  const destination: FlightDestination = { kind: 'planet', planetId: target.id, coordinate: target.coordinate };
  return {
    requestId,
    missionId: 'attack' as const,
    originPlanetId: state.currentPlanetId,
    destination,
    targetRelation: options.targetRelation ?? 'neutral',
    targetOwnerId: target.ownerId,
    selectedShips: options.selectedShips ?? { scout: 10 },
    selectedCommanders: {},
    maxRounds: options.maxRounds ?? 5,
    departedAt: options.departedAt ?? 1_000,
  };
}

function replaceTarget(state: ReturnType<typeof createInitialSaveState>, targetId: string, target: NonNullable<NonNullable<ReturnType<typeof createInitialSaveState>['espionage']>['targets']>[string]) {
  return {
    ...state,
    espionage: {
      ...state.espionage!,
      targets: { ...state.espionage!.targets, [targetId]: target },
      bot01Planets: { ...state.espionage!.bot01Planets, [targetId]: target },
    },
  };
}

function weakenTarget(state: ReturnType<typeof createInitialSaveState>, targetId: string) {
  const target = state.espionage!.targets![targetId];
  const ships = { ...target.fleet.ships };
  Object.keys(ships).forEach((id) => { ships[id as keyof typeof ships] = 0; });
  const commanders = { ...target.fleet.commanders };
  Object.keys(commanders).forEach((id) => { commanders[id as keyof typeof commanders] = 0; });
  const defenses = { ...target.defense.defenses };
  Object.keys(defenses).forEach((id) => { defenses[id as keyof typeof defenses] = 0; });
  const weakTarget = {
    ...target,
    fleet: { ...target.fleet, ships: { ...ships, scout: 1 }, commanders },
    defense: { ...target.defense, defenses },
    commanders: {},
    population: { total: 2, fleet: 2, defense: 0 },
  };
  return replaceTarget(state, targetId, weakTarget);
}

function emptyTarget(state: ReturnType<typeof createInitialSaveState>, targetId: string) {
  const target = state.espionage!.targets![targetId];
  const ships = Object.fromEntries(Object.keys(target.fleet.ships).map((id) => [id, 0])) as typeof target.fleet.ships;
  const commanders = Object.fromEntries(Object.keys(target.fleet.commanders).map((id) => [id, 0])) as typeof target.fleet.commanders;
  const defenses = Object.fromEntries(Object.keys(target.defense.defenses).map((id) => [id, 0])) as typeof target.defense.defenses;
  return replaceTarget(state, targetId, {
    ...target,
    fleet: { ...target.fleet, ships, commanders },
    defense: { ...target.defense, defenses },
    commanders: {},
    population: { total: 0, fleet: 0, defense: 0 },
  });
}

function enemyTargetState(state: ReturnType<typeof createInitialSaveState>, targetId: string) {
  const target = state.espionage!.targets![targetId];
  const enemyAlliance = {
    id: 'relation-void-hand',
    name: 'Рука Пустоты',
    tag: 'VHD',
    emblem: { glyph: 'orbit', accent: 'violet' },
    glyph: 'orbit',
  } as NonNullable<typeof target.alliance>;
  return replaceTarget(state, targetId, { ...target, alliance: enemyAlliance });
}

function sumDestroyed(report: BattleReport, side: 'attacker' | 'defender') {
  const force = side === 'attacker' ? report.attackerForce : report.defenderForce;
  return [...(force.stacks ?? []), ...(force.defenses ?? [])].reduce((total, stack) => total + (stack.destroyed ?? 0), 0);
}

test('attack resolves one live combat, records debris/repair, and credits loot only on return', () => {
  const state = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(state.espionage!.targets!)[0];
  const sent = dispatchFlight(state, attackCommand(state, 'attack-acceptance-1', targetId), {
    now: 1_000,
    mode: 'test',
    testTimeScale: 15,
  });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;

  const arrival = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, {
    mode: 'test',
    testTimeScale: 15,
  });
  assert.equal(arrival.events[0]?.status, 'arrived');
  assert.equal(arrival.state.combat.reports.length, state.combat.reports.length + 1);
  const report = arrival.state.combat.reports.at(-1)!;
  assert.equal(report.missionType, 'attack');
  assert.equal(report.id, `battle-attack-${sent.flight.id}`);
  assert.equal(report.defenderForce.populationBefore, sent.state.espionage!.targets![targetId].population.total);
  assert.ok((report.defenderForce.defenses ?? []).every((stack) => (
    (stack.entityId === 'tower-shield' || stack.entityId === 'planetary-shield') ? stack.countBefore <= 1 : true
  )));
  assert.equal(arrival.state.flights.records[0]?.phase, 'returning');
  assert.equal(arrival.state.flights.records[0]?.attackResolution?.reportId, report.id);
  assert.ok(arrival.state.espionage!.targets![targetId].repair?.claimedBattleIds.includes(report.id));
  assert.deepEqual(arrival.state.planets[sent.flight.originPlanetId]?.repair, sent.state.planets[sent.flight.originPlanetId]?.repair);
  const defenderDestroyed = sumDestroyed(report, 'defender');
  const repairedDefenderShips = Object.values(report.repairEligibility?.shipUnits ?? {}).reduce((sum, value) => sum + value, 0);
  const repairedDefenderDefense = Object.values(report.repairEligibility?.defenseUnits ?? {}).reduce((sum, value) => sum + value, 0);
  assert.equal(repairedDefenderShips + repairedDefenderDefense, Math.floor(defenderDestroyed / 2));

  const replay = reconcileFlights(arrival.state, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(replay.changed, false);
  assert.equal(replay.state.combat.reports.length, arrival.state.combat.reports.length);

  const returned = reconcileFlights(arrival.state, arrival.state.flights.records[0].returnAt!, undefined, {
    mode: 'test',
    testTimeScale: 15,
  });
  assert.equal(returned.state.flights.records[0]?.phase, 'completed');
  assert.equal(returned.state.flights.records[0]?.attackResolution?.lootCreditedAt, arrival.state.flights.records[0].returnAt);
  const returnedAgain = reconcileFlights(returned.state, arrival.state.flights.records[0].returnAt! + 1, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(returnedAgain.changed, false);
  assert.equal(returnedAgain.state.combat.reports.length, returned.state.combat.reports.length);
});

test('successful Planetolom siege removes the authoritative target and replays the historical report after target disappearance', () => {
  const base = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(base.espionage!.targets!)[0];
  const originId = base.currentPlanetId;
  const origin = base.planets[originId];
  const prepared = {
    ...base,
    shipUpgradeLevels: { ...(base.shipUpgradeLevels ?? {}), 'death-star': 10 },
    planets: {
      ...base.planets,
      [originId]: {
        ...origin,
        fleet: { ...origin.fleet, ships: { ...origin.fleet.ships, 'death-star': 1 } },
        spaceportUpgrades: { ...origin.spaceportUpgrades, shipLevels: {} },
      },
    },
  };
  const siegeReady = replaceTarget(emptyTarget(prepared, targetId), targetId, {
    ...emptyTarget(prepared, targetId).espionage!.targets![targetId],
    resources: {
      ...emptyTarget(prepared, targetId).espionage!.targets![targetId].resources,
      debris: 321,
    },
  });

  let resolved: ReturnType<typeof reconcileFlights> | null = null;
  for (let index = 0; index < 200; index += 1) {
    const requestId = `attack-planetolom-${index}`;
    const sent = dispatchFlight(siegeReady, attackCommand(siegeReady, requestId, targetId, {
      selectedShips: { 'death-star': 1 },
    }), { now: 1_000, mode: 'test', testTimeScale: 15 });
    assert.equal(sent.ok, true);
    if (!sent.ok) continue;
    const arrival = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
    if (arrival.state.flights.records[0]?.attackResolution?.planetDestroyed) {
      resolved = arrival;
      break;
    }
  }
  assert.ok(resolved, 'a deterministic request id should eventually hit the destruction roll');
  const arrival = resolved!;
  const report = arrival.state.combat.reports.at(-1)!;
  const flight = arrival.state.flights.records[0]!;
  assert.equal(report.siege?.planetDestroyed, true);
  assert.equal(arrival.state.espionage!.targets![targetId], undefined);
  assert.equal(arrival.state.espionage!.bot01Planets![targetId], undefined);
  assert.equal(arrival.state.espionage!.orbitalDebris?.[targetId]?.debris, 321);
  assert.equal(arrival.state.espionage!.orbitalDebris?.[targetId]?.targetPlanetId, targetId);
  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => 10_000 });
  assert.equal(persistence.write(arrival.state).ok, true);
  const reloaded = persistence.read();
  assert.equal(reloaded.espionage!.orbitalDebris?.[targetId]?.debris, 321);
  assert.equal(flight.phase, 'returning');

  const replay = resolveAttackAtTarget(arrival.state, flight, flight.arrivedAt ?? 1_000);
  assert.ok(replay);
  assert.equal(replay?.report.id, report.id);
  assert.deepEqual(replay?.resolution, flight.attackResolution);
});

test('attack arrival re-checks diplomacy and returns without combat after a target becomes allied', () => {
  const state = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(state.espionage!.targets!)[1];
  const sent = dispatchFlight(state, attackCommand(state, 'attack-diplomacy-1', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const alliance = selectCurrentAlliance(state.command);
  const target = sent.state.espionage!.targets![targetId];
  const alliedTarget = { ...target, alliance };
  const changedDiplomacy = {
    ...sent.state,
    espionage: {
      ...sent.state.espionage!,
      targets: { ...sent.state.espionage!.targets, [targetId]: alliedTarget },
      bot01Planets: { ...sent.state.espionage!.bot01Planets, [targetId]: alliedTarget },
    },
  };
  const arrival = reconcileFlights(changedDiplomacy, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(arrival.events[0]?.status, 'target-unavailable');
  assert.equal(arrival.state.combat.reports.length, state.combat.reports.length);
  assert.equal(arrival.state.flights.records[0]?.phase, 'returning');
  assert.equal(arrival.state.flights.records[0]?.attackResolution, undefined);
});

test('attack coordinates resolve only to an authoritative planet target', () => {
  const state = createInitialSaveState('test', 1_000);
  const target = Object.values(state.espionage!.targets!)[0];
  const command = {
    ...attackCommand(state, 'attack-coordinate-1', target.id),
    destination: { kind: 'coordinate' as const, coordinate: target.coordinate },
    targetOwnerId: 'stale-owner-metadata',
    targetRelation: undefined,
  };
  const sent = dispatchFlight(state, command, { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.deepEqual(sent.flight.destination, { kind: 'planet', planetId: target.id, coordinate: target.coordinate });
  assert.equal(sent.flight.destinationPlanetId, target.id);
});

test('attacker victory reserves ordered loot until the surviving fleet returns', () => {
  const base = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(base.espionage!.targets!)[0];
  const weakened = weakenTarget(base, targetId);
  const originId = weakened.currentPlanetId;
  const initial = replacePlanetResources(weakened, originId, { ...getPlanetResources(weakened, originId), metal: 1_000 });
  const sent = dispatchFlight(initial, attackCommand(initial, 'attack-loot-1', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;

  const arrival = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  const report = arrival.state.combat.reports.at(-1)!;
  const resolution = arrival.state.flights.records[0]?.attackResolution!;
  const lootTotal = resolution.loot.metal + resolution.loot.minerals + resolution.loot.gas;
  assert.equal(report.winner, 'attacker');
  assert.ok(lootTotal > 0);
  assert.ok(resolution.loot.metal <= Math.floor(10_000_000 * 0.75));
  assert.ok(arrival.state.espionage!.targets![targetId].resources.metal < 10_000_000);

  const originBeforeReturn = getPlanetResources(arrival.state, initial.currentPlanetId).metal;
  const returnAt = arrival.state.flights.records[0]?.returnAt;
  if (returnAt === undefined) return;
  const returned = reconcileFlights(arrival.state, returnAt, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(getPlanetResources(returned.state, initial.currentPlanetId).metal, originBeforeReturn + resolution.loot.metal);
});

test('attack arrival reads live target resources and resolves an empty neutral planet as a real victory', () => {
  const base = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(base.espionage!.targets!)[0];
  const sent = dispatchFlight(base, attackCommand(base, 'attack-live-empty-1', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const liveResources = replaceTarget(sent.state, targetId, {
    ...sent.state.espionage!.targets![targetId],
    resources: { ...sent.state.espionage!.targets![targetId].resources, metal: 1_000, minerals: 0, gas: 0 },
  });
  const live = emptyTarget(liveResources, targetId);
  const arrival = reconcileFlights(live, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  const report = arrival.state.combat.reports.at(-1);
  assert.equal(arrival.events[0]?.status, 'arrived');
  assert.ok(report);
  assert.equal(report.winner, 'attacker');
  assert.equal(report.defenderForce.populationBefore, 0);
  assert.equal(report.debris, 0);
  assert.ok((report.resources?.metal ?? 0) > 0);
  assert.ok((report.resources?.metal ?? 0) < 2_500);
  assert.ok((report.resources?.minerals ?? 0) >= 0);
  assert.ok((report.resources?.gas ?? 0) >= 0);
  assert.equal(arrival.state.espionage!.targets![targetId].resources.debris, live.espionage!.targets![targetId].resources.debris);
  assert.equal(arrival.state.espionage!.targets![targetId].debris, undefined);
});

test('an enemy target that becomes neutral before arrival still resolves with the live target state', () => {
  const initial = createInitialSaveState('test', 1_000);
  const base = enemyTargetState(initial, Object.keys(initial.espionage!.targets!)[0]);
  const targetId = Object.keys(base.espionage!.targets!)[0];
  const sent = dispatchFlight(base, attackCommand(base, 'attack-enemy-neutral-1', targetId, { targetRelation: 'enemy' }), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const neutral = replaceTarget(sent.state, targetId, { ...sent.state.espionage!.targets![targetId], alliance: null });
  const arrival = reconcileFlights(neutral, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(arrival.events[0]?.status, 'arrived');
  assert.equal(arrival.state.combat.reports.length, base.combat.reports.length + 1);
});

test('multiple overdue attacks reconcile by arrival time and deterministic id tie-break after reload', () => {
  const base = emptyTarget(createInitialSaveState('test', 1_000), Object.keys(createInitialSaveState('test', 1_000).espionage!.targets!)[0]);
  const targetId = Object.keys(base.espionage!.targets!)[0];
  const late = dispatchFlight(base, attackCommand(base, 'attack-late-1', targetId, { selectedShips: { scout: 1 }, departedAt: 3_000 }), { now: 3_000, mode: 'test', testTimeScale: 15 });
  assert.equal(late.ok, true);
  if (!late.ok) return;
  const early = dispatchFlight(late.state, attackCommand(late.state, 'attack-early-1', targetId, { selectedShips: { scout: 1 }, departedAt: 1_000 }), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(early.ok, true);
  if (!early.ok) return;
  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => 20_000, testTimeScale: 15 });
  assert.equal(persistence.write(early.state).ok, true);
  const reloaded = persistence.read();
  const settled = reconcileFlights(reloaded, 20_000, undefined, { mode: 'test', testTimeScale: 15 });
  assert.deepEqual(settled.events.filter((event) => event.flight.missionId === 'attack').map((event) => event.flight.id), [early.flight.id, late.flight.id]);

  const tieBase = emptyTarget(createInitialSaveState('test', 1_000), Object.keys(createInitialSaveState('test', 1_000).espionage!.targets!)[0]);
  const tieTargetId = Object.keys(tieBase.espionage!.targets!)[0];
  const tieFirst = dispatchFlight(tieBase, attackCommand(tieBase, 'attack-tie-b', tieTargetId, { selectedShips: { scout: 1 } }), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(tieFirst.ok, true);
  if (!tieFirst.ok) return;
  const tieSecond = dispatchFlight(tieFirst.state, attackCommand(tieFirst.state, 'attack-tie-a', tieTargetId, { selectedShips: { scout: 1 } }), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(tieSecond.ok, true);
  if (!tieSecond.ok) return;
  const tieSettled = reconcileFlights(tieSecond.state, tieSecond.flight.arrivalAt + 1, undefined, { mode: 'test', testTimeScale: 15 });
  assert.deepEqual(tieSettled.events.filter((event) => event.flight.missionId === 'attack').map((event) => event.flight.id), ['attack-tie-a', 'attack-tie-b'].map((requestId) => tieSecond.state.flights.records.find((flight) => flight.requestId === requestId)?.id));
});

test('defeat and draw outcomes never create attacker loot', () => {
  const base = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(base.espionage!.targets!)[0];
  const sent = dispatchFlight(base, attackCommand(base, 'attack-defeat-1', targetId, { selectedShips: { scout: 1 } }), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const arrival = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  const report = arrival.state.combat.reports.at(-1)!;
  assert.equal(report.winner, 'defender');
  assert.deepEqual(arrival.state.flights.records[0]?.attackResolution?.loot, { metal: 0, minerals: 0, gas: 0, debris: 0 });

  const drawReport = { ...report, id: 'draw-loot-check', winner: 'draw' as const };
  assert.deepEqual(calculateAttackLoot(drawReport, { metal: 100, minerals: 100, gas: 100 }, 'aegis'), { metal: 0, minerals: 0, gas: 0, debris: 0 });
});

test('debris formula covers destroyed ships, defenses, and commander ships at one canonical rate', () => {
  const ship = getFactionCombatEntity('aegis', 'scout');
  const defense = getFactionCombatEntity('aegis', 'laser-turret');
  const commander = getFactionCombatEntity('aegis', 'hunter');
  const report = {
    attackerForce: { stacks: [{ entityId: 'scout', countBefore: 2, countAfter: 0, destroyed: 2 }], defenses: [] },
    defenderForce: { stacks: [{ entityId: 'hunter', countBefore: 1, countAfter: 0, destroyed: 1 }], defenses: [{ entityId: 'laser-turret', countBefore: 3, countAfter: 0, destroyed: 3 }] },
  } as unknown as BattleReport;
  const expected = Math.floor(ship.cost.metal * 2 * .3) + Math.floor(ship.cost.minerals * 2 * .3)
    + Math.floor(commander.cost.metal * .3) + Math.floor(commander.cost.minerals * .3)
    + Math.floor(defense.cost.metal * 3 * .3) + Math.floor(defense.cost.minerals * 3 * .3);
  assert.equal(calculateAttackDebris(report, 'aegis', 'aegis'), expected);
});

test('recall before attack arrival returns without combat or report', () => {
  const state = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(state.espionage!.targets!)[0];
  const sent = dispatchFlight(state, attackCommand(state, 'attack-recall-1', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const recalled = recallFlight(sent.state, sent.flight.id, { now: sent.flight.departedAt + 100, mode: 'test', testTimeScale: 15 });
  assert.equal(recalled.ok, true);
  if (!recalled.ok) return;
  const afterArrivalTime = reconcileFlights(recalled.state, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(afterArrivalTime.state.combat.reports.length, state.combat.reports.length);
  assert.equal(afterArrivalTime.state.flights.records[0]?.phase, 'completed');
  assert.equal(afterArrivalTime.state.flights.records[0]?.completionReason, 'recalled');
});

test('attack sends civilian and service hulls, preserves them as survivors, and uses their cargo', () => {
  const base = emptyTarget(createInitialSaveState('test', 1_000), Object.keys(createInitialSaveState('test', 1_000).espionage!.targets!)[0]);
  const targetId = Object.keys(base.espionage!.targets!)[0];
  const originId = base.currentPlanetId;
  const origin = base.planets[originId];
  const selectedShips = {
    'spy-probe': 1,
    transporter: 1,
    'mega-transporter': 1,
    colonizer: 1,
    recycler: 1,
  } as Partial<Record<ShipId, number>>;
  const prepared = {
    ...base,
    planets: {
      ...base.planets,
      [originId]: {
        ...origin,
        fleet: {
          ...origin.fleet,
          ships: { ...origin.fleet.ships, ...selectedShips },
        },
      },
    },
  };
  const sent = dispatchFlight(prepared, attackCommand(prepared, 'attack-civil-service-1', targetId, { selectedShips }), {
    now: 1_000,
    mode: 'test',
    testTimeScale: 15,
  });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.deepEqual(sent.flight.selectedShips, selectedShips);

  const arrival = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  const report = arrival.state.combat.reports.at(-1)!;
  assert.equal(report.winner, 'attacker');
  for (const entityId of Object.keys(selectedShips)) {
    const stack = report.attackerForce.stacks.find((candidate) => candidate.entityId === entityId);
    assert.equal(stack?.countBefore, 1, entityId);
    assert.equal(stack?.countAfter, 1, entityId);
    assert.equal(stack?.destroyed, 0, entityId);
  }
  assert.ok((report.resources?.metal ?? 0) > 0, 'surviving transport capacity must carry ordered loot');
  assert.equal(report.defenderForce.populationBefore, 0);
});

test('attack reads live hidden owner technology without copying it into spy snapshots', () => {
  const base = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(base.espionage!.targets!)[0];
  const target = base.espionage!.targets![targetId];
  const ownerProfile = base.espionage!.bot01Profile!;
  const live = replaceTarget(emptyTarget(base, targetId), targetId, {
    ...target,
    ownerProfile: {
      ...ownerProfile,
      scienceLevels: { ...ownerProfile.scienceLevels, 7: 10 },
    },
  });
  const sent = dispatchFlight(live, attackCommand(live, 'attack-hidden-tech-1', targetId, { selectedShips: { scout: 1 } }), {
    now: 1_000,
    mode: 'test',
    testTimeScale: 15,
  });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const arrival = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  const report = arrival.state.combat.reports.at(-1)!;
  assert.deepEqual(report.defenderForce.technologyLevels, technologiesFromScience({ ...ownerProfile.scienceLevels, 7: 10 }));
  assert.equal('scienceLevels' in report.defender, false);
});

test('Test Mode Bot 01 starts at the requested resource scale and ticks normally', () => {
  const state = createInitialSaveState('test', 1_000);
  const target = Object.values(state.espionage!.targets!)[0];
  assert.ok(target.resources.metal >= 10_000_000);
  const later = reconcileFlights(state, 1_000 + 60 * 60 * 1000, undefined, {
    mode: 'test',
    testTimeScale: 1,
    reconcileTargetResources: true,
  });
  const updated = later.state.espionage!.targets![target.id];
  assert.ok(updated.resources.metal > target.resources.metal);
  assert.equal(updated.resourceClock?.lastReconciledAt, 1_000 + 60 * 60 * 1000);
});

test('Bot 01 Test Mode destroys a real owned world, burns an exact-tie Space Flight, and persists once', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => 1_000 });
  const initial = persistence.read();
  assert.deepEqual(Object.keys(initial.planets), ['helion-01']);
  assert.equal(initial.espionage?.bot01IncomingScenario, undefined);
  assert.equal(initial.flights.records.some((flight) => flight.ownerSide === 'bot01'), false);
  const productionAttempt = startBot01IncomingScenario(initial, { now: 1_000, mode: 'production' });
  assert.equal(productionAttempt.ok, false);

  const launched = startBot01IncomingScenario(initial, { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  assert.equal(launched.created, true);
  assert.equal(Object.keys(launched.state.planets).length, 2);
  const targetId = launched.flight.destinationPlanetId!;
  const testPlanet = launched.state.planets[targetId];
  assert.equal(testPlanet.fleet.ships.scout, 1);
  assert.equal(launched.flight.ownerSide, 'bot01');
  assert.equal(launched.flight.targetKind, 'player');
  assert.equal(launched.flight.targetRelation, 'self');
  assert.ok((launched.flight.selectedShips['death-star'] ?? 0) > 0);

  const repeatedLaunch = startBot01IncomingScenario(launched.state, { now: 1_001, mode: 'test', testTimeScale: 1 });
  assert.equal(repeatedLaunch.ok, true);
  if (!repeatedLaunch.ok) return;
  assert.equal(repeatedLaunch.created, false);
  assert.equal(repeatedLaunch.flight.id, launched.flight.id);
  assert.equal(repeatedLaunch.state.flights.records.filter((flight) => flight.ownerSide === 'bot01').length, 1);

  const worldWithTransporter = replacePlanetState(launched.state, targetId, {
    ...testPlanet,
    fleet: { ...testPlanet.fleet, ships: { ...testPlanet.fleet.ships, transporter: 1 } },
  });
  const selectedTarget = selectOwnedPlanet({
    ...worldWithTransporter,
    shipUpgradeLevels: { ...(worldWithTransporter.shipUpgradeLevels ?? {}), transporter: 4, corsair: 6 },
  }, targetId);
  const beforeLaunchGas = getPlanetResources(selectedTarget, targetId).gas;
  const spaceFlight = dispatchFlight(selectedTarget, {
    requestId: 'space-flight-bot-tie',
    missionId: 'space-flight',
    originPlanetId: targetId,
    selectedShips: { transporter: 1 },
    selectedCommanders: {},
    oneWayDurationMinutes: 5,
    cargo: { metal: 25, minerals: 10, gas: 5, debris: 0 },
    departedAt: 1_000,
  }, { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(spaceFlight.ok, true);
  if (!spaceFlight.ok) return;
  assert.equal(getPlanetResources(spaceFlight.state, targetId).gas, beforeLaunchGas - 105);

  const tieAt = spaceFlight.flight.arrivalAt + spaceFlight.flight.oneWayDurationMs;
  const botFlight = {
    ...launched.flight,
    arrivalAt: tieAt,
    oneWayDurationMs: tieAt - launched.flight.departedAt,
  };
  const scheduled = {
    ...spaceFlight.state,
    flights: {
      ...spaceFlight.state.flights,
      records: spaceFlight.state.flights.records.map((flight) => flight.id === botFlight.id ? botFlight : flight),
    },
  };
  assert.equal(persistence.write(scheduled).ok, true);

  const incoming = reconcileFlights(persistence.read(), tieAt, undefined, { mode: 'test', testTimeScale: 1 });
  const attackReport = incoming.state.combat.reports.find((report) => report.id === `battle-bot01-incoming-${botFlight.id}`);
  assert.ok(attackReport);
  assert.equal(attackReport?.winner, 'attacker');
  assert.equal(attackReport?.siege?.planetDestroyed, true);
  assert.equal(attackReport?.defenderForce.stacks.some((stack) => stack.entityId === 'transporter'), false);
  assert.ok((attackReport?.debris ?? 0) > 0);
  assert.equal(getOrbitalDebrisAtCoordinate(incoming.state.espionage!, botFlight.destinationCoordinate), attackReport?.debris);
  assert.equal(incoming.state.planets[targetId], undefined);
  assert.deepEqual(Object.keys(incoming.state.planets), ['helion-01']);
  assert.equal(incoming.state.currentPlanetId, 'helion-01');
  assert.equal(incoming.state.shipUpgradeLevels?.transporter, 4);
  assert.equal(incoming.state.shipUpgradeLevels?.corsair, 6);
  assert.equal(incoming.state.flights.records.find((flight) => flight.id === spaceFlight.flight.id)?.phase, 'failed');
  const burnedFlight = incoming.state.flights.records.find((flight) => flight.id === spaceFlight.flight.id);
  assert.equal(burnedFlight?.completionReason, 'origin-destroyed');
  assert.equal(burnedFlight?.cargoState, 'voided');
  assert.equal(burnedFlight?.cargoResolvedAt, tieAt);
  assert.deepEqual(incoming.events.map((event) => event.status), ['arrived', 'incoming-attack', 'destroyed']);
  assert.equal(incoming.state.espionage?.bot01IncomingScenario?.status, 'resolved');
  assert.equal(incoming.state.combat.reports.filter((report) => report.id === attackReport?.id).length, 1);

  assert.equal(persistence.write(incoming.state).ok, true);
  const afterReload = persistence.read();
  assert.deepEqual(Object.keys(afterReload.planets), ['helion-01']);
  assert.equal(afterReload.planets['helion-01'].name, initial.planets['helion-01'].name);
  assert.equal(afterReload.flights.records.find((flight) => flight.id === spaceFlight.flight.id)?.cargoState, 'voided');
  assert.equal(afterReload.combat.reports.filter((report) => report.id === attackReport?.id).length, 1);
  const retry = startBot01IncomingScenario(afterReload, { now: tieAt + 1, mode: 'test', testTimeScale: 1 });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.created, false);
  assert.equal(afterReload.flights.records.filter((flight) => flight.ownerSide === 'bot01').length, 1);

  const botReturnAt = afterReload.flights.records.find((flight) => flight.id === botFlight.id)!.returnAt!;
  const returnedBot = reconcileFlights(afterReload, botReturnAt, undefined, { mode: 'test', testTimeScale: 1 });
  const returnedRecord = returnedBot.state.flights.records.find((flight) => flight.id === botFlight.id);
  assert.equal(returnedRecord?.phase, 'completed');
  assert.equal(returnedRecord?.bot01ReturnCreditedAt, botReturnAt);
  assert.equal(persistence.write(returnedBot.state).ok, true);
  const replayedReturn = reconcileFlights(persistence.read(), botReturnAt + 1, undefined, { mode: 'test', testTimeScale: 1 });
  assert.equal(replayedReturn.changed, false);
});

test('late reconciliation returns a Space Flight before a Bot attack arriving one millisecond later', () => {
  const initial = createInitialSaveState('test', 1_000);
  const launched = startBot01IncomingScenario(initial, { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  const targetId = launched.flight.destinationPlanetId!;
  const target = launched.state.planets[targetId];
  const withTransporter = replacePlanetState(launched.state, targetId, {
    ...target,
    fleet: { ...target.fleet, ships: { ...target.fleet.ships, transporter: 1 } },
  });
  const stateAtTarget = selectOwnedPlanet(withTransporter, targetId);
  const spaceFlight = dispatchFlight(stateAtTarget, {
    requestId: 'space-flight-before-later-bot-attack',
    missionId: 'space-flight',
    originPlanetId: targetId,
    selectedShips: { transporter: 1 },
    selectedCommanders: {},
    oneWayDurationMinutes: 5,
    cargo: { metal: 10, minerals: 0, gas: 0, debris: 0 },
    departedAt: 1_000,
  }, { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(spaceFlight.ok, true);
  if (!spaceFlight.ok) return;

  const returnAt = spaceFlight.flight.arrivalAt + spaceFlight.flight.oneWayDurationMs;
  const laterAttackAt = returnAt + 1;
  const botFlight = {
    ...launched.flight,
    arrivalAt: laterAttackAt,
    oneWayDurationMs: laterAttackAt - launched.flight.departedAt,
  };
  const scheduled = {
    ...spaceFlight.state,
    flights: {
      ...spaceFlight.state.flights,
      records: spaceFlight.state.flights.records.map((flight) => flight.id === botFlight.id ? botFlight : flight),
    },
  };
  const reconciled = reconcileFlights(scheduled, laterAttackAt, undefined, { mode: 'test', testTimeScale: 1 });
  const returnedSpaceFlight = reconciled.state.flights.records.find((flight) => flight.id === spaceFlight.flight.id);
  assert.equal(returnedSpaceFlight?.phase, 'completed');
  assert.equal(returnedSpaceFlight?.cargoState, 'returned');
  assert.equal(returnedSpaceFlight?.completedAt, returnAt);
  assert.deepEqual(reconciled.events.slice(0, 2).map((event) => event.status), ['arrived', 'returned']);
  assert.ok(reconciled.events.some((event) => event.status === 'incoming-attack'));
});

test('an incoming Bot attack burns a Space Flight whose owned origin is still outbound', () => {
  const initial = createInitialSaveState('test', 1_000);
  const launched = startBot01IncomingScenario(initial, { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  const targetId = launched.flight.destinationPlanetId!;
  const target = launched.state.planets[targetId];
  const withTransporter = replacePlanetState(launched.state, targetId, {
    ...target,
    fleet: { ...target.fleet, ships: { ...target.fleet.ships, transporter: 1 } },
  });
  const stateAtTarget = selectOwnedPlanet(withTransporter, targetId);
  const spaceFlight = dispatchFlight(stateAtTarget, {
    requestId: 'space-flight-destroyed-while-outbound',
    missionId: 'space-flight',
    originPlanetId: targetId,
    selectedShips: { transporter: 1 },
    selectedCommanders: {},
    oneWayDurationMinutes: 5,
    cargo: { metal: 10, minerals: 5, gas: 0, debris: 0 },
    departedAt: 1_000,
  }, { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(spaceFlight.ok, true);
  if (!spaceFlight.ok) return;
  const botArrivalAt = spaceFlight.flight.departedAt + 4 * 60_000;
  assert.ok(botArrivalAt < spaceFlight.flight.arrivalAt);
  const botFlight = {
    ...launched.flight,
    arrivalAt: botArrivalAt,
    oneWayDurationMs: botArrivalAt - launched.flight.departedAt,
  };
  const scheduled = {
    ...spaceFlight.state,
    flights: {
      ...spaceFlight.state.flights,
      records: spaceFlight.state.flights.records.map((flight) => flight.id === botFlight.id ? botFlight : flight),
    },
  };
  const incoming = reconcileFlights(scheduled, botArrivalAt, undefined, { mode: 'test', testTimeScale: 1 });
  const report = incoming.state.combat.reports.find((candidate) => candidate.id === `battle-bot01-incoming-${botFlight.id}`);
  assert.equal(report?.siege?.planetDestroyed, true);
  assert.equal(incoming.state.planets[targetId], undefined);
  const burned = incoming.state.flights.records.find((flight) => flight.id === spaceFlight.flight.id);
  assert.equal(burned?.phase, 'failed');
  assert.equal(burned?.completionReason, 'origin-destroyed');
  assert.equal(burned?.cargoState, 'voided');
  assert.equal(burned?.cargoResolvedAt, botArrivalAt);
  assert.ok(incoming.events.some((event) => event.flight.id === burned?.id && event.status === 'destroyed'));
});
