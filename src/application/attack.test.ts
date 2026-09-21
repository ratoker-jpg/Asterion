import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { dispatchFlight, recallFlight, reconcileFlights } from './flights.ts';
import { getPlanetResources, replacePlanetResources } from './contracts.ts';
import { selectCurrentAlliance } from '../domain/command/selectors.ts';
import { calculateAttackDebris, calculateAttackLoot } from './attack.ts';
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
