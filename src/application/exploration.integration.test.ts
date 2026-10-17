import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { dispatchFlight, reconcileFlights, recallFlight } from './flights.ts';
import { reconcileRuntime } from './reconcile.ts';
import { getPlanetResources, replacePlanetState, replacePlanetResources } from './contracts.ts';
import type { SaveState } from './contracts.ts';
import { getExplorationTarget, explorationTargetStatus, selectExplorationTargets, selectExplorationOperations } from './exploration.ts';
import { acceptLiveExploration, cancelLiveExploration } from './exploration-operations.ts';
import { explorationResourceScore } from './exploration-flight.ts';
import { explorationMailboxReports } from '../domain/exploration/report-items.ts';
import { createExplorationState, reconcileExplorationContact } from '../domain/exploration/ledger.ts';
import { dispatchBot01Exploration } from './exploration-bot01.ts';
import { resolveExplorationAttackAtTarget } from './exploration-combat.ts';
import { advanceExplorationNpcProgress, getExplorationNpcCatchupWindow, selectDueExplorationNpcRolls, type ExplorationNpcSourceProvider } from './exploration-npc.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { getOrbitalDebrisAtCoordinate, collectOrbitalDebrisAtCoordinate } from '../domain/espionage/orbital-debris.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import { getCombatFactionName } from '../domain/combat/factions.ts';
import { resolveCombat } from '../domain/combat/resolver.ts';
import type { CombatInput, CombatStackInput } from '../domain/combat/simulator.ts';

const MINUTE = 60_000;
const baseTime = 1_790_000_000_000;

function prepare(minimumRemainingMs = 6 * MINUTE) {
  let state = createInitialSaveState('test', baseTime);
  const planet = state.planets['helion-01'];
  state = replacePlanetState(state, 'helion-01', {
    ...planet,
    fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, transporter: 10, recycler: 10, 'spy-probe': 2 } },
  });
  for (let offset = 0; offset < 480; offset++) {
    const now = baseTime + offset * MINUTE;
    const targets = selectExplorationTargets(state, now, 'test');
    const target = targets.find(node => node.special && node.special.expiresAt - now > minimumRemainingMs);
    if (target) return { state, now, target };
  }
  throw new Error('No eligible timed exploration contact in the deterministic eight-hour fixture');
}

const testOnlyNpcSourceProvider: ExplorationNpcSourceProvider = () => {
  const testFixture = createInitialSaveState('test', baseTime);
  return Object.values(getEspionageTargets(testFixture.espionage)).map(source => ({
    ownerId: 'test-only-catchup-source', coordinate: source.coordinate,
  }));
};

function withPendingPlayerFlights(state: SaveState, after: number, until: number): SaveState {
  const fixture = prepare();
  const command = {
    missionId: 'expedition' as const,
    contactCycleKey: fixture.target.id,
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate' as const, coordinate: fixture.target.coordinate },
    targetKind: fixture.target.kind,
    selectedShips: { transporter: 1 },
    departedAt: fixture.now,
  };
  const outbound = dispatchFlight(fixture.state, { ...command, requestId: 'pr92-offline-outbound' },
    { now: fixture.now, mode: 'test', testTimeScale: 15 });
  const returning = dispatchFlight(fixture.state, { ...command, requestId: 'pr92-offline-returning' },
    { now: fixture.now, mode: 'test', testTimeScale: 15 });
  if (!outbound.ok || !returning.ok) throw new Error('Could not construct active flight fixtures');
  const outboundRecord: FlightRecord = {
    ...outbound.flight,
    departedAt: after + 1_000,
    oneWayDurationMs: until - after + 10 * MINUTE,
    arrivalAt: until + 10 * MINUTE,
    phase: 'outbound',
  };
  const returningRecord: FlightRecord = {
    ...returning.flight,
    departedAt: after + 2_000,
    oneWayDurationMs: 5 * MINUTE,
    arrivalAt: after + 7 * MINUTE,
    arrivedAt: after + 7 * MINUTE,
    returnAt: until + 20 * MINUTE,
    phase: 'returning',
  };
  return { ...state, flights: { ...state.flights, records: [outboundRecord, returningRecord] } };
}

test('expedition selector is canonically visible, bounded and does not invent occupied targets', () => {
  const { state, now, target } = prepare();
  assert.ok(selectExplorationTargets(state, now, 'test').length <= 5);
  assert.equal(getExplorationTarget(state, target.id, now, 'test')?.id, target.id);
  assert.equal(explorationTargetStatus(state, target), 'free');
  assert.ok(Math.abs(target.coordinate.system - 1) <= 5);
  assert.ok(explorationResourceScore(state) >= 0);
  assert.equal(getExplorationTarget(state, target.id, target.special!.expiresAt, 'test'), undefined);
});

test('production NPC catch-up matches stepped ticks and includes a contact cycle that ended before login', () => {
  const state = createInitialSaveState('production', baseTime);
  const after = baseTime + 5 * 60 * MINUTE;
  const until = after + 6 * 60 * MINUTE;
  const caughtUp = selectDueExplorationNpcRolls(state, after, until, 'production', testOnlyNpcSourceProvider);
  const stepped: ReturnType<typeof selectDueExplorationNpcRolls> = [];
  const step = 5 * MINUTE;
  for (let cursor = after; cursor < until; cursor += step) {
    stepped.push(...selectDueExplorationNpcRolls(state, cursor, Math.min(until, cursor + step), 'production', testOnlyNpcSourceProvider));
  }
  stepped.sort((left, right) => left.at - right.at || left.contactId.localeCompare(right.contactId) || left.slot - right.slot);
  assert.deepEqual(caughtUp, stepped, 'catch-up must replay exactly the opportunities produced by stepped reconciliation');
  assert.ok(caughtUp.length > 0, 'the seeded existing NPC fixture should have scheduled opportunities');
  const disappeared = caughtUp.find(roll => !getExplorationTarget(state, roll.contactId, until, 'production'));
  assert.ok(disappeared, 'catch-up must retain risk rolls for a cycle no longer active at login');
  const historical = getExplorationTarget(state, disappeared!.contactId, disappeared!.at, 'production');
  assert.ok(historical?.special);
  assert.ok(historical!.special!.expiresAt <= until);
  assert.equal(getExplorationTarget(state, disappeared!.contactId, until, 'production'), undefined);
});

test('NPC replay window is stable and capped at 24 hours for 1h, 24h, 7d and 30d gaps', () => {
  const state = createInitialSaveState('production', baseTime);
  const now = baseTime + 40 * 24 * 60 * MINUTE;
  const day = 24 * 60 * MINUTE;
  const intervals = [
    { name: '1h', gap: 60 * MINUTE },
    { name: '24h', gap: day },
    { name: '7d', gap: 7 * day },
    { name: '30d', gap: 30 * day },
  ];
  let hourRolls: ReturnType<typeof selectDueExplorationNpcRolls> = [];
  let dayRolls: ReturnType<typeof selectDueExplorationNpcRolls> = [];
  let weekRolls: ReturnType<typeof selectDueExplorationNpcRolls> = [];
  let monthRolls: ReturnType<typeof selectDueExplorationNpcRolls> = [];
  for (const interval of intervals) {
    const after = now - interval.gap;
    const window = getExplorationNpcCatchupWindow(after, now);
    const expectedReplayAfter = Math.max(after, now - day);
    assert.equal(window.replayAfter, expectedReplayAfter, `${interval.name} replay lower bound`);
    if (interval.gap <= day) assert.equal(window.skippedInterval, undefined, `${interval.name} has no skipped time`);
    else assert.deepEqual(window.skippedInterval, { afterExclusive: after, throughInclusive: expectedReplayAfter });

    const rolls = selectDueExplorationNpcRolls(state, after, now, 'production', testOnlyNpcSourceProvider);
    if (interval.gap >= day) assert.ok(rolls.length > 0, `${interval.name} has deterministic scheduled opportunities in the test-only source fixture`);
    assert.ok(rolls.every(roll => roll.at > expectedReplayAfter && roll.at <= now), `${interval.name} contains only bounded historical rolls`);
    assert.deepEqual(rolls, [...rolls].sort((left, right) => left.at - right.at
      || left.contactId.localeCompare(right.contactId) || left.slot - right.slot), `${interval.name} cursor order is stable`);
    if (interval.name === '1h') hourRolls = rolls;
    if (interval.name === '24h') dayRolls = rolls;
    if (interval.name === '7d') weekRolls = rolls;
    if (interval.name === '30d') monthRolls = rolls;
  }
  assert.ok(hourRolls.every(roll => dayRolls.some(dayRoll => dayRoll.at === roll.at
    && dayRoll.contactId === roll.contactId && dayRoll.slot === roll.slot)), '1h rolls are a subset of the full day');
  assert.deepEqual(weekRolls, dayRolls, '7d replay performs exactly the same bounded work as 24h');
  assert.deepEqual(monthRolls, dayRolls, '30d replay performs exactly the same bounded work as 24h');
  assert.deepEqual(selectDueExplorationNpcRolls(state, now - day, now, 'production'), [],
    'production currently has no automatic NPC source provider');
});

test('production offline reconciliation stays NPC-free, records skipped time once and preserves active flights', () => {
  const day = 24 * 60 * MINUTE;
  const now = baseTime + 40 * day;
  for (const gap of [60 * MINUTE, day, 7 * day, 30 * day]) {
    const after = now - gap;
    const initial = createInitialSaveState('production', after);
    const exploration = { ...createExplorationState(), npcProcessedAt: after };
    const queued: SaveState = withPendingPlayerFlights({
      ...initial,
      exploration,
      pirate: { ...initial.pirate!, raidProcessedAt: now },
    }, after, now);
    const store = new Map<string, string>();
    const persistence = createPersistenceFacade({ mode: 'production', now: () => now, storage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => { store.set(key, value); },
      removeItem: key => { store.delete(key); },
    } });
    assert.equal(persistence.write(queued).ok, true, 'save accepts existing in-flight records across the offline window');
    const reloaded = persistence.read();
    const originalFlightRecords = reloaded.flights.records;
    const originalPlanets = reloaded.planets;
    assert.deepEqual(selectDueExplorationNpcRolls(reloaded, after, now, 'production'), [],
      `${gap / MINUTE} minute gap has no automatic production NPC sources`);
    const firstExploration = advanceExplorationNpcProgress(reloaded.exploration!, after, now);
    const first: SaveState = { ...reloaded, exploration: firstExploration };
    assert.equal(first.exploration?.npcProcessedAt, now);
    const expectedSkipped = gap > day
      ? { afterExclusive: after, throughInclusive: now - day }
      : undefined;
    assert.deepEqual(first.exploration?.npcLastSkippedInterval, expectedSkipped);
    assert.equal(first.flights.records.some(flight => flight.ownerSide === 'npc'), false,
      'production must not create automatic NPC fleets before a real source is connected');
    assert.deepEqual(first.flights.records, originalFlightRecords,
      'catch-up progress preserves pre-existing outbound and returning player flights');
    assert.deepEqual(first.planets, originalPlanets, 'NPC catch-up progress does not award resources');
    assert.equal(persistence.write(first).ok, true, 'processed cursor survives persistence');
    const reloadedProgress = persistence.read();
    const secondExploration = advanceExplorationNpcProgress(reloadedProgress.exploration!, after, now);
    assert.strictEqual(secondExploration, reloadedProgress.exploration,
      'replaying the same wall clock records no duplicate progress or awards');
    assert.deepEqual(reloadedProgress.flights.records, originalFlightRecords);
    assert.deepEqual(reloadedProgress.planets, originalPlanets);
  }
});

test('one real flight arrives, reserves the contact, recalls from orbit and credits cargo only once', () => {
  const {state, now, target} = prepare();
  const command = {
    requestId: 'expedition-integration-001',
    missionId: 'expedition' as const,
    contactCycleKey: target.id,
    operationId: target.id,
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate' as const, coordinate: target.coordinate },
    targetKind: target.kind,
    selectedShips: {transporter: 10, recycler: 10},
    departedAt: now,
  };
  const sent = dispatchFlight(state, command, {now, mode:'test', testTimeScale:15});
  assert.equal(sent.ok, true, sent.ok ? '' : sent.error.message);
  if (!sent.ok) return;
  assert.equal(sent.flight.operationId, target.id);
  assert.ok(sent.state.exploration?.contacts[target.id]);
  const duplicate = dispatchFlight(sent.state, command, {now, mode:'test', testTimeScale:15});
  assert.equal(duplicate.ok, true);
  if (duplicate.ok) assert.equal(duplicate.created, false);
  assert.equal(sent.state.flights.records.filter(f=>f.missionId==='expedition').length,1);
  const once = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, {mode:'test',testTimeScale:15});
  const arrived = once.state.flights.records.find(f=>f.id===sent.flight.id)!;
  assert.equal(arrived.phase, 'arrived');
  assert.equal(explorationTargetStatus(once.state,target), 'self');
  const second = dispatchFlight(once.state, {...command, requestId:'blocked-expedition-002'}, {now: sent.flight.arrivalAt + 1,mode:'test', testTimeScale:15});
  assert.equal(second.ok, false, 'same object cannot be captured by another free expedition');

  const recallAt = sent.flight.arrivalAt + MINUTE;
  const recalled = recallFlight(once.state, sent.flight.id, recallAt);
  assert.equal(recalled.ok, true, recalled.ok ? '' : recalled.error.message);
  if (!recalled.ok) return;
  const repeatRecall = recallFlight(recalled.state,sent.flight.id,recallAt);
  assert.equal(repeatRecall.ok, false);
  const middle = reconcileFlights(recalled.state, recallAt+29_999,undefined,{mode:'test',testTimeScale:15});
  assert.equal(middle.state.flights.records.find(f=>f.id===sent.flight.id)!.phase,'arrived');
  const ready = reconcileFlights(middle.state, recallAt+30_000,undefined,{mode:'test',testTimeScale:15});
  const returning = ready.state.flights.records.find(f=>f.id===sent.flight.id)!;
  assert.equal(returning.phase,'returning');
  assert.ok(returning.returnAt);
  const cargo = ready.state.exploration!.contacts[target.id]!.events.find(e=>e.id===sent.flight.id+':release')!.cargo!;
  const before = getPlanetResources(ready.state,'helion-01');
  const finished = reconcileFlights(ready.state, returning.returnAt!,undefined,{mode:'test',testTimeScale:15});
  const completed = finished.state.flights.records.find(f=>f.id===sent.flight.id)!;
  assert.equal(completed.phase,'completed');
  assert.equal(finished.state.exploration!.contacts[target.id]!.events.filter(e=>e.id===sent.flight.id+':completed').length,1);
  const receipt = finished.state.exploration!.contacts[target.id]!.events.find(e => e.id === sent.flight.id + ':completed')!;
  assert.ok(receipt.creditedCargo,'successful landing must save exact wallet credit');
  assert.equal(receipt.creditedCargo!.debris,cargo.debris,'debris is deposited in the recycling pool');
  const returnLetter = explorationMailboxReports(finished.state.exploration,finished.state.flights.records)
    .find(item => item.id === 'exploration-return:' + sent.flight.id);
  assert.ok(returnLetter);
  assert.equal(returnLetter!.category,'flights');
  assert.ok(returnLetter!.details.some(detail => detail.label.includes('Обломки')));
  assert.equal(selectExplorationOperations(finished.state,returning.returnAt!,'test').find(row=>row.node.id===target.id)?.stage,'completed');
  const after = getPlanetResources(finished.state,'helion-01');
  assert.ok(after.metal >= before.metal);
  assert.ok(after.minerals >= before.minerals);
  assert.ok(after.gas >= before.gas);
  assert.ok(Object.values(cargo).some(n=>n>0));
  const replay = reconcileFlights(finished.state,returning.returnAt!+MINUTE,undefined,{mode:'test',testTimeScale:15});
  assert.equal(replay.changed,false);
  assert.deepEqual(getPlanetResources(replay.state,'helion-01'),after);
});

test('stale contact ids and mismatched coordinates cannot dispatch flights or spend gas', () => {
  const {state, now, target} = prepare();
  const gas = getPlanetResources(state,'helion-01').gas;
  const command = {
    requestId:'stale-id',missionId:'expedition' as const,contactCycleKey:target.id+'-old',
    selectedShips:{transporter:1},
    originPlanetId:'helion-01',
    destination:{kind:'coordinate' as const,coordinate:target.coordinate},
    targetKind:target.kind,
    departedAt:now,
  };
  const invalid = dispatchFlight(state,command,{now,mode:'test',testTimeScale:15});
  assert.equal(invalid.ok,false);
  assert.equal(getPlanetResources(invalid.state,'helion-01').gas,gas);
  const wrong = dispatchFlight(state,{...command,requestId:'wrong-position',contactCycleKey:target.id,
    destination:{kind:'coordinate' as const,coordinate:{...target.coordinate,position:(target.coordinate.position%24)+1}}},
    {now,mode:'test',testTimeScale:15});
  assert.equal(wrong.ok,false);
  assert.equal(getPlanetResources(wrong.state,'helion-01').gas,gas);
});

test('exploration flight and finite contact survive save migration and reloading', () => {
  const {state, now, target} = prepare();
  const launch = dispatchFlight(state, {
    requestId:'expedition-save-roundtrip',
    missionId:'expedition',
    contactCycleKey: target.id,
    originPlanetId:'helion-01',
    destination:{kind:'coordinate',coordinate:target.coordinate},
    targetKind:target.kind,
    selectedShips:{transporter:10},
    departedAt:now,
  }, {now,mode:'test',testTimeScale:15});
  assert.equal(launch.ok,true,launch.ok?'':launch.error.message);
  if(!launch.ok)return;
  const store = new Map<string,string>();
  const facade = createPersistenceFacade({mode:'test',now:()=>now,storage:{
    getItem:(key:string)=>store.get(key)??null,
    setItem:(key:string,value:string)=>{store.set(key,value);},
    removeItem:(key:string)=>{store.delete(key);},
  }});
  assert.equal(facade.write(launch.state).ok,true);
  const restored = facade.read();
  const savedFlight = restored.flights.records.find(f=>f.id===launch.flight.id);
  assert.ok(savedFlight,'expedition cannot be lost during load');
  assert.equal(savedFlight!.explorationLaunchResourcePoints,launch.flight.explorationLaunchResourcePoints);
  assert.equal(restored.exploration?.contacts[target.id]?.id,target.id);
  const arrived = reconcileFlights(restored,launch.flight.arrivalAt,undefined,{mode:'test',testTimeScale:15});
  assert.equal(arrived.state.flights.records.find(f=>f.id===launch.flight.id)!.phase,'arrived');
  assert.equal(arrived.state.exploration?.contacts[target.id]?.claim?.flightId,launch.flight.id);
});

test('global offline runtime schedules expedition expiry before final wall-clock catch-up', () => {
  const {state,now,target} = prepare();
  const sent = dispatchFlight(state,{
    requestId:'expedition-offline',
    missionId:'expedition',
    contactCycleKey:target.id,
    originPlanetId:'helion-01',
    selectedShips:{transporter:10},
    destination:{kind:'coordinate',coordinate:target.coordinate},
    targetKind:target.kind,
    departedAt:now,
  },{now,mode:'test',testTimeScale:15});
  assert.equal(sent.ok,true,sent.ok?'':sent.error.message);
  if(!sent.ok)return;
  const one = reconcileRuntime(sent.state,{
    mode:'test',testTimeScale:15,
    planetId:'helion-01',
    now:Math.max(target.special!.expiresAt+sent.flight.oneWayDurationMs+MINUTE,sent.flight.arrivalAt+MINUTE),
  });
  const completed = one.state.flights.records.find(f=>f.id===sent.flight.id)!;
  assert.equal(completed.phase,'completed');
  const record = one.state.exploration?.contacts[target.id];
  assert.ok(record);
  assert.equal(record!.claim,undefined);
  assert.equal(record!.events.filter(e=>e.id===sent.flight.id+':completed').length,1);
});

test('accepted operation and real spy-probe research survive save/replay and reveal profile only on success', () => {
  const {state,now,target} = prepare();
  const accepted = acceptLiveExploration(state,target.id,now,'test');
  assert.ok(accepted);
  if(!accepted)return;
  const before = selectExplorationOperations(accepted,now,'test').find(row=>row.node.id===target.id)!;
  assert.equal(before.stage,'active');
  assert.equal(before.recon,undefined);
  const sent = dispatchFlight(accepted,{
    requestId:'exploration-recon-integration',
    missionId:'exploration-recon',
    contactCycleKey:target.id,
    selectedShips:{'spy-probe':1},
    originPlanetId:'helion-01',
    destination:{kind:'coordinate',coordinate:target.coordinate},
    targetKind:target.kind,
    departedAt:now,
  },{now,mode:'test',testTimeScale:15});
  assert.equal(sent.ok,true,sent.ok?'':sent.error.message);
  if(!sent.ok)return;
  assert.equal(sent.flight.selectedShips['spy-probe'],1);
  assert.equal(sent.state.exploration?.reconReports?.length,0,'no UI-only instant fake result');
  const blocked = dispatchFlight(sent.state,{
    requestId:'exploration-recon-second',
    missionId:'exploration-recon',
    contactCycleKey:target.id,
    selectedShips:{'spy-probe':1},
    originPlanetId:'helion-01',
    destination:{kind:'coordinate',coordinate:target.coordinate},
    targetKind:target.kind,
    departedAt:now,
  },{now,mode:'test',testTimeScale:15});
  assert.equal(blocked.ok,false,'concurrent probe to same cycle must be blocked');
  const arrived = reconcileFlights(sent.state,sent.flight.arrivalAt,undefined,{mode:'test',testTimeScale:15});
  const report = arrived.state.exploration?.reconReports?.find(r=>r.flightId===sent.flight.id);
  assert.ok(report,'recon should produce one outcome at physical arrival');
  assert.equal(typeof report?.success,'boolean');
  const reconLetter = explorationMailboxReports(arrived.state.exploration,arrived.state.flights.records)
    .find(item => item.id === 'exploration-recon:' + sent.flight.id);
  assert.equal(reconLetter?.category,'system');
  assert.equal(reconLetter?.statusLabel,report?.success ? 'УСПЕШНО' : 'НЕУДАЧА');
  assert.equal(arrived.state.flights.records.find(f=>f.id===sent.flight.id)?.phase,'returning');
  assert.equal(selectExplorationOperations(arrived.state,sent.flight.arrivalAt,'test').find(r=>r.node.id===target.id)?.recon?.success,report?.success);
  const repeat = reconcileFlights(arrived.state,sent.flight.arrivalAt,undefined,{mode:'test',testTimeScale:15});
  assert.equal(repeat.state.exploration?.reconReports?.length,1);
  const cooldown = dispatchFlight(arrived.state,{
    requestId:'exploration-recon-cooldown',
    missionId:'exploration-recon',
    contactCycleKey:target.id,
    selectedShips:{'spy-probe':1},
    originPlanetId:'helion-01',
    destination:{kind:'coordinate',coordinate:target.coordinate},
    targetKind:target.kind,
    departedAt:sent.flight.arrivalAt+1,
  },{now:sent.flight.arrivalAt+1,mode:'test',testTimeScale:15});
  assert.equal(cooldown.ok,false);
  const canceled = cancelLiveExploration(arrived.state,target.id);
  assert.equal(selectExplorationOperations(canceled,sent.flight.arrivalAt,'test').find(r=>r.node.id===target.id)?.stage,'available');
  const historical = selectExplorationOperations(arrived.state,target.special!.expiresAt+1,'test').find(r=>r.node.id===target.id);
  assert.equal(historical,undefined,'accepted-but-never-expeditioned cycle must not become a completed operation');
});


test('canonical Attack on occupied field calls real combat, preserves fleet casualties and settles cargo exactly once', () => {
  const fixture = prepare();
  const base = fixture.state;
  const origin = base.planets['helion-01'];
  let state = replacePlanetState(base,'helion-01',{
    ...origin,fleet:{...origin.fleet,ships:{...origin.fleet.ships,destroyer:160,'mega-transporter':25}},
  });
  state=replacePlanetResources(state,'helion-01',{...getPlanetResources(state,'helion-01'),gas:1_000_000});
  const dispatch = dispatchFlight(state,{
    requestId:'pr92-contest-defender',
    missionId:'expedition',contactCycleKey:fixture.target.id,
    originPlanetId:'helion-01',
    destination:{kind:'coordinate',coordinate:fixture.target.coordinate},
    targetKind:fixture.target.kind,
    selectedShips:{transporter:5,recycler:5},departedAt:fixture.now,
  },{now:fixture.now,mode:'test',testTimeScale:15});
  assert.equal(dispatch.ok,true,dispatch.ok?'':dispatch.error.message);
  if(!dispatch.ok)return;
  const reached = reconcileFlights(dispatch.state,dispatch.flight.arrivalAt,undefined,{mode:'test',testTimeScale:15});
  let occupied = reached.state;
  const current = occupied.exploration!.contacts[fixture.target.id]!;
  assert.ok(current.claim,'defending expedition must genuinely occupy contact');
  // Model a foreign holder with a *real flight record*, never by forcing a battle outcome.
  occupied = {...occupied,exploration:{...occupied.exploration!,contacts:{
    ...occupied.exploration!.contacts,[fixture.target.id]:{
      ...current,claim:{...current.claim!,ownerId:'qa-foreign-owner'},
    },
  }}};
  const departedAt=dispatch.flight.arrivalAt+60_000;
  const attack=dispatchFlight(occupied,{
    requestId:'pr92-real-contested-attack',missionId:'attack',
    contactCycleKey:fixture.target.id,operationId:fixture.target.id,
    originPlanetId:'helion-01',destination:{kind:'coordinate',coordinate:fixture.target.coordinate},
    targetKind:fixture.target.kind,targetRelation:'neutral',
    selectedShips:{destroyer:160,'mega-transporter':25},
    selectedCommanders:{},departedAt,
  },{now:departedAt,mode:'test',testTimeScale:15});
  assert.equal(attack.ok,true,attack.ok?'':attack.error.message);
  if(!attack.ok)return;
  assert.equal(attack.flight.explorationAttack,true);
  const before=attack.state.exploration!.contacts[fixture.target.id]!;
  const arrived=reconcileFlights(attack.state,attack.flight.arrivalAt,undefined,{mode:'test',testTimeScale:15});
  const report=arrived.state.combat.reports.find(report=>report.id==='battle-exploration-'+attack.flight.id);
  assert.ok(report,'real combat resolver must create canonical BattleReport');
  const newContact=arrived.state.exploration!.contacts[fixture.target.id]!;
  const captured=newContact.events.find(event=>event.id===attack.flight.id+':capture');
  if(report?.winner==='attacker'){
    assert.ok(captured,'successful attack must persist capture receipt');
    const cargo=reconcileExplorationContact(before,attack.flight.arrivalAt).claim!.cargo;
    const total=Object.values(cargo).reduce((a,b)=>a+b,0);
    const gained=Object.values(captured!.cargo!).reduce((a,b)=>a+b,0);
    assert.ok(gained<=Math.floor(total*.30),'captured cargo never exceeds 30% of accrued defender cargo');
    assert.equal(newContact.claim!.ownerId,arrived.state.profile.playerId);
  } else {
    assert.equal(newContact.claim!.ownerId,'qa-foreign-owner','draw or defender win retains ownership');
  }
  const replay=reconcileFlights(arrived.state,attack.flight.arrivalAt,undefined,{mode:'test',testTimeScale:15});
  assert.equal(replay.state.combat.reports.filter(report=>report.id==='battle-exploration-'+attack.flight.id).length,1);
});

test('defending expedition keeps launch technologies and ship upgrades through save reload and matches resolveCombat', () => {
  const fixture = prepare();
  const launchScience = { ...fixture.state.science.levels, 7: 4, 10: 5 };
  let state = {
    ...fixture.state,
    science: { ...fixture.state.science, levels: launchScience },
    shipUpgradeLevels: { transporter: 5, recycler: 3, destroyer: 4 },
  };
  const ships = { transporter: 5, recycler: 5 };
  const dispatched = dispatchFlight(state, {
    requestId: 'pr92-defender-snapshot',
    missionId: 'expedition', contactCycleKey: fixture.target.id,
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate', coordinate: fixture.target.coordinate },
    targetKind: fixture.target.kind, selectedShips: ships, departedAt: fixture.now,
  }, { now: fixture.now, mode: 'test', testTimeScale: 15 });
  assert.equal(dispatched.ok, true, dispatched.ok ? '' : dispatched.error.message);
  if (!dispatched.ok) return;
  const launchSnapshot = dispatched.flight.attackSnapshot;
  assert.ok(launchSnapshot, 'new expeditions need a persisted defender combat snapshot');
  assert.equal(launchSnapshot.attackerFactionId, state.profile.factionId);
  assert.equal(launchSnapshot.attackerShipLevels.transporter, 5);
  assert.equal(launchSnapshot.attackerShipLevels.recycler, 3);
  assert.equal(launchSnapshot.attackerTechnologies.shipArmor, 4);
  assert.equal(launchSnapshot.attackerTechnologies.laserScience, 5);
  assert.deepEqual(launchSnapshot.defenderPriority, state.combatPriority.defense);

  const reached = reconcileFlights(dispatched.state, dispatched.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  const occupiedContact = reached.state.exploration!.contacts[fixture.target.id]!;
  assert.ok(occupiedContact.claim);
  state = {
    ...reached.state,
    science: { ...reached.state.science, levels: { ...reached.state.science.levels, 7: 0, 10: 0 } },
    shipUpgradeLevels: { transporter: 0, recycler: 0, destroyer: 0 },
    exploration: { ...reached.state.exploration!, contacts: {
      ...reached.state.exploration!.contacts,
      [fixture.target.id]: { ...occupiedContact, claim: { ...occupiedContact.claim!, ownerId: 'qa-foreign-owner' } },
    } },
  };

  const store = new Map<string, string>();
  const persistence = createPersistenceFacade({ mode: 'test', now: () => fixture.now, storage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  } });
  assert.equal(persistence.write(state).ok, true);
  const reloaded = persistence.read();
  const savedDefender = reloaded.flights.records.find(flight => flight.id === dispatched.flight.id)!;
  assert.deepEqual(savedDefender.attackSnapshot, launchSnapshot, 'science changes and reload must not rewrite the dispatched combat snapshot');
  assert.equal(reloaded.science.levels[10], 0);

  const attackAt = dispatched.flight.arrivalAt + MINUTE;
  const attack = dispatchFlight(reloaded, {
    requestId: 'pr92-attacker-upgraded-after-defender-launch', missionId: 'attack',
    contactCycleKey: fixture.target.id, operationId: fixture.target.id,
    originPlanetId: 'helion-01', destination: { kind: 'coordinate', coordinate: fixture.target.coordinate },
    targetKind: fixture.target.kind, targetRelation: 'neutral', selectedShips: ships,
    selectedCommanders: {}, departedAt: attackAt,
  }, { now: attackAt, mode: 'test', testTimeScale: 15 });
  assert.equal(attack.ok, true, attack.ok ? '' : attack.error.message);
  if (!attack.ok) return;
  const resolved = reconcileFlights(attack.state, attack.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  const report = resolved.state.combat.reports.find(item => item.id === 'battle-exploration-' + attack.flight.id);
  assert.ok(report, 'a real contested flight must reach the canonical combat resolver');
  assert.equal(report!.defenderForce.technologies?.shipArmor, 4);
  assert.equal(report!.defenderForce.technologies?.laserScience, 5);
  assert.equal(report!.defenderForce.stacks.find(stack => stack.entityId === 'transporter')?.level, 5);
  assert.equal(report!.defenderForce.stacks.find(stack => stack.entityId === 'recycler')?.level, 3);
  assert.equal(report!.attackerForce.stacks.find(stack => stack.entityId === 'transporter')?.level, 0);
  assert.equal(report!.attackerForce.technologies?.shipArmor, 0);

  const stacksFor = (flight: typeof attack.flight, faction: typeof state.profile.factionId,
    levels: Partial<Record<string, number>>): CombatStackInput[] => {
    const catalog = new Set(getFactionShipCatalog(faction as 'aegis' | 'synod' | 'veyra').map(ship => ship.id));
    return Object.entries(flight.selectedShips).flatMap(([id, count]) =>
      catalog.has(id as never) && id !== 'solar-satellite' && typeof count === 'number' && count > 0
        ? [{ entityId: id as never, count, level: levels[id] ?? 0 }]
        : []);
  };
  const attackerSnapshot = attack.flight.attackSnapshot!;
  const defenderSnapshot = savedDefender.attackSnapshot!;
  const coordinateText = (coordinate: { galaxy: number; system: number; position: number }) =>
    `[${coordinate.galaxy}:${coordinate.system}:${coordinate.position}]`;
  const expectedInput: CombatInput = {
    scenarioId: 'exploration:' + attack.flight.id,
    timestamp: new Date(attack.flight.arrivalAt).toISOString(),
    seed: 'exploration-contest:' + attack.flight.id + ':' + occupiedContact.claim!.claimId,
    profileId: 'asterion-attack-v1', maxRounds: attackerSnapshot.maxRounds,
    attackerPriority: [...attackerSnapshot.attackerPriority],
    defenderPriority: [...(defenderSnapshot.defenderPriority ?? reloaded.combatPriority.defense)],
    attackerTechnologies: attackerSnapshot.attackerTechnologies,
    defenderTechnologies: defenderSnapshot.attackerTechnologies,
    technologyMode: 'independent', executionMode: 'production',
    attacker: {
      participant: { side: 'attacker', playerId: reloaded.profile.playerId, playerName: reloaded.profile.displayName,
        coordinates: coordinateText(attack.flight.originCoordinate), race: getCombatFactionName(attackerSnapshot.attackerFactionId) },
      factionId: attackerSnapshot.attackerFactionId,
      ships: stacksFor(attack.flight, attackerSnapshot.attackerFactionId, attackerSnapshot.attackerShipLevels),
    },
    defender: {
      participant: { side: 'defender', playerId: 'qa-foreign-owner', playerName: 'qa-foreign-owner',
        planetName: fixture.target.name, coordinates: coordinateText(fixture.target.coordinate),
        race: getCombatFactionName(defenderSnapshot.attackerFactionId) },
      factionId: defenderSnapshot.attackerFactionId,
      ships: stacksFor(savedDefender, defenderSnapshot.attackerFactionId, defenderSnapshot.attackerShipLevels),
    },
  };
  const expected = resolveCombat(expectedInput, { reportId: report!.id, missionType: 'attack' });
  assert.equal(report!.winner, expected.winner);
  assert.deepEqual(report!.attackerForce, expected.attackerForce);
  assert.deepEqual(report!.defenderForce, expected.defenderForce);
});

test('real NPC field combat covers attacker, defender and draw outcomes with replay-safe losses and returns', () => {
  const fixture = prepare(12 * MINUTE);
  const npcLaunch = dispatchBot01Exploration(fixture.state, fixture.target, fixture.now, 15);
  assert.equal(npcLaunch.ok, true, npcLaunch.notice);
  if (!npcLaunch.ok) return;
  const occupied = reconcileFlights(npcLaunch.state, npcLaunch.flight.arrivalAt, undefined,
    { mode: 'test', testTimeScale: 15 });
  const npcSource = getEspionageTargets(occupied.state.espionage)[npcLaunch.flight.originPlanetId]!;
  const npcProfile = npcSource.ownerProfile ?? occupied.state.espionage?.bot01Profile;
  assert.ok(npcProfile, 'the real NPC settlement supplies its owner technology and upgrade profile');
  let base: SaveState = {
    ...occupied.state,
    profile: { ...occupied.state.profile, factionId: npcSource.raceId },
    science: { ...occupied.state.science, levels: npcProfile!.scienceLevels },
    shipUpgradeLevels: { ...npcProfile!.shipLevels },
  };
  const home = base.planets['helion-01']!;
  base = replacePlanetState(base, 'helion-01', {
    ...home,
    buildings: { ...home.buildings, hangar: 20 },
    fleet: { ...home.fleet, ships: { ...home.fleet.ships, destroyer: 300, scout: 50 } },
  });
  base = replacePlanetResources(base, 'helion-01', { ...getPlanetResources(base, 'helion-01'), gas: 100_000_000 });
  const initialPlayerShips = { ...base.planets['helion-01']!.fleet.ships };
  const initialNpcShips = { ...getEspionageTargets(fixture.state.espionage)[npcLaunch.flight.originPlanetId]!.fleet.ships };
  const attackAt = npcLaunch.flight.arrivalAt + 1_000;
  const plans: { winner: 'attacker' | 'defender' | 'draw'; compositions: FlightRecord['selectedShips'][]; seeds: number }[] = [
    { winner: 'attacker', compositions: [{ destroyer: 300 }], seeds: 1 },
    { winner: 'defender', compositions: [{ scout: 1 }], seeds: 1 },
    { winner: 'draw', compositions: [{ destroyer: 6 }, { destroyer: 5 }, { destroyer: 7 }, { scout: 6 }], seeds: 32 },
  ];
  const seen = new Set<string>();
  for (const plan of plans) {
    let chosen: { state: typeof base; flight: FlightRecord; report: NonNullable<ReturnType<typeof resolveExplorationAttackAtTarget>>['report'] } | undefined;
    for (const composition of plan.compositions) {
      for (let seed = 0; seed < plan.seeds && !chosen; seed += 1) {
        const requestId = `pr92-real-outcome-${plan.winner}-${Object.values(composition).join('-')}-${seed}`;
        const attack = dispatchFlight(base, {
          requestId, missionId: 'attack', contactCycleKey: fixture.target.id, operationId: fixture.target.id,
          originPlanetId: 'helion-01', destination: { kind: 'coordinate', coordinate: fixture.target.coordinate },
          targetKind: fixture.target.kind, targetRelation: 'neutral', selectedShips: composition,
          selectedCommanders: {}, departedAt: attackAt,
        }, { now: attackAt, mode: 'test', testTimeScale: 15 });
        if (!attack.ok) continue;
        const direct = resolveExplorationAttackAtTarget(attack.state, attack.flight, attack.flight.arrivalAt);
        if (!direct) continue;
        seen.add(direct.report.winner);
        if (direct.report.winner === plan.winner) chosen = { state: attack.state, flight: attack.flight, report: direct.report };
      }
    }
    assert.ok(chosen, `real resolver must produce ${plan.winner}; observed ${[...seen].join(', ')}`);
    if (!chosen) continue;
    const arrival = reconcileFlights(chosen.state, chosen.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
    const report = arrival.state.combat.reports.find(item => item.id === chosen!.report.id);
    assert.ok(report, 'real dispatched attack must produce a persisted combat report');
    assert.equal(report!.winner, plan.winner);
    assert.deepEqual(report!.attackerForce, chosen.report.attackerForce);
    assert.deepEqual(report!.defenderForce, chosen.report.defenderForce);
    const debris = getOrbitalDebrisAtCoordinate(arrival.state.espionage!, fixture.target.coordinate);
    assert.equal(debris, report!.debris ?? 0, 'combat report debris is backed by the canonical orbital ledger');

    const store = new Map<string, string>();
    const persistence = createPersistenceFacade({ mode: 'test', now: () => attackAt, storage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => { store.set(key, value); },
      removeItem: key => { store.delete(key); },
    } });
    assert.equal(persistence.write(arrival.state).ok, true);
    const reloaded = persistence.read();
    assert.ok(reloaded.flights.records.some(flight => flight.id === chosen!.flight.id), 'save reload keeps the resolved attack flight');
    assert.ok(reloaded.flights.records.some(flight => flight.id === npcLaunch.flight.id), JSON.stringify({
      expectedNpc: npcLaunch.flight.id, records: reloaded.flights.records.map(flight => ({ id: flight.id, missionId: flight.missionId, ownerSide: flight.ownerSide, phase: flight.phase })),
    }));
    const replay = reconcileFlights(reloaded, chosen.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
    assert.equal(replay.state.combat.reports.filter(item => item.id === report!.id).length, 1);
    assert.equal(getOrbitalDebrisAtCoordinate(replay.state.espionage!, fixture.target.coordinate), debris,
      'replaying the saved battle does not mint debris a second time');

    const finalAt = fixture.target.special!.expiresAt
      + Math.max(npcLaunch.flight.oneWayDurationMs, chosen.flight.oneWayDurationMs) + MINUTE;
    const returned = reconcileFlights(replay.state, finalAt, undefined, { mode: 'test', testTimeScale: 15 });
    assert.equal(returned.state.flights.records.find(flight => flight.id === chosen!.flight.id)?.phase, 'completed');
    assert.equal(returned.state.flights.records.find(flight => flight.id === npcLaunch.flight.id)?.phase, 'completed');
    for (const stack of report!.attackerForce.stacks) {
      const remaining = returned.state.planets['helion-01']!.fleet.ships[stack.entityId as keyof typeof initialPlayerShips] ?? 0;
      assert.equal(remaining, Math.max(0, (initialPlayerShips[stack.entityId as keyof typeof initialPlayerShips] ?? 0) - stack.destroyed),
        'player hangar ends with its real launch inventory minus battle losses');
    }
    const returnedNpc: ReturnType<typeof getEspionageTargets>[string] =
      getEspionageTargets(returned.state.espionage)[npcLaunch.flight.originPlanetId]!;
    for (const stack of report!.defenderForce.stacks) {
      assert.equal(returnedNpc.fleet.ships[stack.entityId as keyof typeof initialNpcShips],
        Math.max(0, (initialNpcShips[stack.entityId as keyof typeof initialNpcShips] ?? 0) - stack.destroyed),
        'NPC hangar returns real survivors once and retains actual losses');
    }
    const finalReplay = reconcileFlights(returned.state, finalAt, undefined, { mode: 'test', testTimeScale: 15 });
    assert.deepEqual(finalReplay.state.planets['helion-01']!.fleet.ships, returned.state.planets['helion-01']!.fleet.ships);
    assert.deepEqual(getEspionageTargets(finalReplay.state.espionage)[npcLaunch.flight.originPlanetId]!.fleet.ships, returnedNpc.fleet.ships);
    assert.equal(finalReplay.state.combat.reports.filter(item => item.id === report!.id).length, 1);
  }
  assert.deepEqual([...seen].sort(), ['attacker', 'defender', 'draw'], 'all three outcomes must be observed through resolveCombat');
});


test('Test Mode Bot 01 occupies through a real finite flight and player Attack writes one combat report', () => {
  const fixture=prepare();
  const sourceBefore=getEspionageTargets(fixture.state.espionage);
  const started=dispatchBot01Exploration(fixture.state,fixture.target,fixture.now,15);
  assert.equal(started.ok,true,started.notice);
  if(!started.ok)return;
  assert.equal(started.flight.ownerSide,'bot01');
  assert.equal(started.flight.phase,'outbound');
  assert.ok(started.flight.arrivalAt>fixture.now);
  const original=sourceBefore[started.flight.originPlanetId]!;
  const reserved=getEspionageTargets(started.state.espionage)[started.flight.originPlanetId]!;
  for(const [id,count] of Object.entries(started.flight.selectedShips)){
    assert.equal(reserved.fleet.ships[id as keyof typeof reserved.fleet.ships],
      (original.fleet.ships[id as keyof typeof original.fleet.ships]??0)-(count??0),
      'NPC ships must be reserved from the real existing planet');
  }
  const arrived=reconcileFlights(started.state,started.flight.arrivalAt,undefined,{mode:'test',testTimeScale:15});
  const claimed=arrived.state.exploration!.contacts[fixture.target.id]!.claim;
  assert.equal(claimed?.flightId,started.flight.id);
  assert.notEqual(claimed?.ownerId,arrived.state.profile.playerId);
  const before=arrived.state.planets['helion-01'];
  let armed=replacePlanetState(arrived.state,'helion-01',{
    ...before,fleet:{...before.fleet,ships:{...before.fleet.ships,destroyer:160}},
  });
  armed=replacePlanetResources(armed,'helion-01',{...getPlanetResources(armed,'helion-01'),gas:1_000_000});
  const at=started.flight.arrivalAt+1_000;
  const attack=dispatchFlight(armed,{
    requestId:'pr92-test-bot01-contest',missionId:'attack',
    contactCycleKey:fixture.target.id,operationId:fixture.target.id,
    originPlanetId:'helion-01',destination:{kind:'coordinate',coordinate:fixture.target.coordinate},
    targetKind:fixture.target.kind,targetRelation:'neutral',
    selectedShips:{destroyer:160},selectedCommanders:{},departedAt:at,
  },{now:at,mode:'test',testTimeScale:15});
  assert.equal(attack.ok,true,attack.ok?'':attack.error.message);
  if(!attack.ok)return;
  assert.equal(attack.flight.explorationAttack,true);
  const resolved=reconcileFlights(attack.state,attack.flight.arrivalAt,undefined,{mode:'test',testTimeScale:15});
  const report=resolved.state.combat.reports.find(r=>r.id==='battle-exploration-'+attack.flight.id);
  assert.ok(report,'combat report must be delivered via canonical combat.reports');
  assert.ok(['attacker','defender','draw'].includes(report!.winner));
  assert.equal(report!.defender.playerId,claimed!.ownerId);
  const orbitalBefore=getOrbitalDebrisAtCoordinate(resolved.state.espionage!,fixture.target.coordinate);
  assert.equal(orbitalBefore,report!.debris??0,'battle wreckage must exist at the actual field orbit');
  const collection=collectOrbitalDebrisAtCoordinate(resolved.state.espionage!,fixture.target.coordinate,orbitalBefore);
  assert.equal(collection.collected,orbitalBefore,'existing recycler consumes stock, not report-only virtual debris');
  assert.equal(getOrbitalDebrisAtCoordinate(collection.espionage,fixture.target.coordinate),0);
  const replay=reconcileFlights(resolved.state,attack.flight.arrivalAt,undefined,{mode:'test',testTimeScale:15});
  assert.equal(replay.state.combat.reports.filter(r=>r.id===report!.id).length,1);
  assert.equal(getOrbitalDebrisAtCoordinate(replay.state.espionage!,fixture.target.coordinate),orbitalBefore,
    'replaying resolution cannot mint duplicate wreckage');
  if(orbitalBefore>0){
    const recycled=dispatchFlight(replay.state,{
      requestId:'pr92-recycler-at-battle-field',missionId:'recycle',
      originPlanetId:'helion-01',selectedShips:{recycler:10},
      destination:{kind:'coordinate',coordinate:fixture.target.coordinate},
      targetKind:fixture.target.kind,departedAt:attack.flight.arrivalAt+1,
    },{now:attack.flight.arrivalAt+1,mode:'test',testTimeScale:15});
    assert.equal(recycled.ok,true,recycled.ok?'':recycled.error.message);
    if(recycled.ok){
      const atTarget=reconcileFlights(recycled.state,recycled.flight.arrivalAt,undefined,{mode:'test',testTimeScale:15});
      const event=atTarget.state.reports.recyclerArrivalReports?.find(item=>item.flightId===recycled.flight.id);
      assert.ok(event,'real recycler flight must generate canonical arrival report');
      assert.ok(event!.collectedDebris>0,'the recycler must physically collect fresh combat wreckage');
      assert.equal(event!.collectedDebris+
        getOrbitalDebrisAtCoordinate(atTarget.state.espionage!,fixture.target.coordinate),orbitalBefore,
        'flight collection cannot create or lose orbital scrap');
      const twice=reconcileFlights(atTarget.state,recycled.flight.arrivalAt,undefined,{mode:'test',testTimeScale:15});
      assert.equal(twice.state.reports.recyclerArrivalReports?.filter(item=>item.flightId===recycled.flight.id).length,1);
      assert.equal(getOrbitalDebrisAtCoordinate(twice.state.espionage!,fixture.target.coordinate),
        getOrbitalDebrisAtCoordinate(atTarget.state.espionage!,fixture.target.coordinate));
    }
  }
});

test('surviving commander keeps a contested object through save reload and battle replay', () => {
  const fixture = prepare(12 * MINUTE);
  const npc = dispatchBot01Exploration(fixture.state, fixture.target, fixture.now, 15);
  assert.equal(npc.ok, true, npc.notice);
  if (!npc.ok) return;
  const occupied = reconcileFlights(npc.state, npc.flight.arrivalAt, undefined,
    { mode: 'test', testTimeScale: 15 });
  const defender = occupied.state.flights.records.find(flight => flight.id === npc.flight.id)!;
  const home = occupied.state.planets['helion-01']!;
  const armed = replacePlanetState(occupied.state, 'helion-01', {
    ...home,
    fleet: { ...home.fleet, commanders: { ...home.fleet.commanders, corsair: 1 } },
  });
  const attackAt = npc.flight.arrivalAt + 1_000;
  const attack = dispatchFlight(armed, {
    requestId: 'pr92-commander-only-draw', missionId: 'attack',
    contactCycleKey: fixture.target.id, operationId: fixture.target.id,
    originPlanetId: 'helion-01', destination: { kind: 'coordinate', coordinate: fixture.target.coordinate },
    targetKind: fixture.target.kind, targetRelation: 'neutral', selectedShips: { transporter: 1 },
    selectedCommanders: { corsair: 1 }, maxRounds: 5, departedAt: attackAt,
  }, { now: attackAt, mode: 'test', testTimeScale: 15 });
  assert.equal(attack.ok, true, attack.ok ? '' : attack.error.message);
  if (!attack.ok) return;
  const commanderOnlyAttack: FlightRecord = {
    ...attack.flight, selectedShips: {}, selectedCommanders: { corsair: 1 },
  };
  assert.deepEqual(commanderOnlyAttack.selectedShips, {}, 'the surviving attack force contains only its commander');

  // Use the attacker's launch-time combat profile for both identical Corsairs;
  // the five-round golden vector is a deterministic draw with both commanders alive.
  const defenderWithCommander: FlightRecord = {
    ...defender,
    selectedShips: {},
    selectedCommanders: { corsair: 1 },
    attackSnapshot: attack.flight.attackSnapshot,
  };
  const battleState: SaveState = {
    ...attack.state,
    flights: {
      ...attack.state.flights,
      records: attack.state.flights.records.map(flight => flight.id === defender.id
        ? defenderWithCommander : flight.id === attack.flight.id ? commanderOnlyAttack : flight),
    },
  };
  const once = reconcileFlights(battleState, attack.flight.arrivalAt, undefined,
    { mode: 'test', testTimeScale: 15 });
  const report = once.state.combat.reports.find(item => item.id === 'battle-exploration-' + attack.flight.id);
  assert.ok(report, 'commander-only attack resolves through the real combat resolver');
  assert.equal(report!.winner, 'draw');
  assert.ok(report!.attackerForce.stacks.some(stack => stack.entityId === 'corsair' && stack.countAfter > 0));
  assert.ok(report!.defenderForce.stacks.some(stack => stack.entityId === 'corsair' && stack.countAfter > 0));
  const contact = once.state.exploration!.contacts[fixture.target.id]!;
  assert.equal(contact.claim?.flightId, defender.id, 'a living defending commander keeps the contact');
  assert.deepEqual(contact.claim?.capacity, { all: 0, transporters: 0, recyclers: 0 });
  assert.deepEqual(contact.claim?.cargo, { metal: 0, minerals: 0, gas: 0, debris: 0 });

  const store = new Map<string, string>();
  const persistence = createPersistenceFacade({ mode: 'test', now: () => attack.flight.arrivalAt, storage: {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: key => { store.delete(key); },
  } });
  assert.equal(persistence.write(once.state).ok, true, 'commander-only arrived and returning flights remain save-compatible');
  const reloaded = persistence.read();
  assert.deepEqual(reloaded.exploration!.contacts[fixture.target.id]!.claim, contact.claim);
  assert.ok(reloaded.flights.records.some(flight => flight.id === defender.id
    && Object.keys(flight.selectedShips).length === 0 && flight.selectedCommanders?.corsair === 1));
  const replay = reconcileFlights(reloaded, attack.flight.arrivalAt, undefined,
    { mode: 'test', testTimeScale: 15 });
  assert.equal(replay.state.combat.reports.filter(item => item.id === report!.id).length, 1);
  assert.deepEqual(replay.state.exploration!.contacts[fixture.target.id]!.claim, contact.claim);
  assert.deepEqual(replay.state.rating, once.state.rating, 'replaying the saved report cannot award battle score twice');
});

test('mutual destruction frees the contact and a later real flight can occupy it after save reload', () => {
  const fixture = prepare(12 * MINUTE);
  const npc = dispatchBot01Exploration(fixture.state, fixture.target, fixture.now, 15);
  assert.equal(npc.ok, true, npc.notice);
  if (!npc.ok) return;
  const occupied = reconcileFlights(npc.state, npc.flight.arrivalAt, undefined,
    { mode: 'test', testTimeScale: 15 });
  const defender = occupied.state.flights.records.find(flight => flight.id === npc.flight.id)!;
  const home = occupied.state.planets['helion-01']!;
  const armed = replacePlanetState(occupied.state, 'helion-01', {
    ...home,
    fleet: { ...home.fleet, ships: { ...home.fleet.ships, scout: 1 } },
  });
  const attackAt = npc.flight.arrivalAt + 1_000;
  let chosen: { state: SaveState; flight: FlightRecord; report: NonNullable<ReturnType<typeof resolveExplorationAttackAtTarget>>['report'] } | undefined;
  for (let seed = 0; seed < 64 && !chosen; seed += 1) {
    const attack = dispatchFlight(armed, {
      requestId: `pr92-mutual-destruction-${seed}`, missionId: 'attack',
      contactCycleKey: fixture.target.id, operationId: fixture.target.id,
      originPlanetId: 'helion-01', destination: { kind: 'coordinate', coordinate: fixture.target.coordinate },
      targetKind: fixture.target.kind, targetRelation: 'neutral', selectedShips: { scout: 1 },
      selectedCommanders: {}, maxRounds: 5, departedAt: attackAt,
    }, { now: attackAt, mode: 'test', testTimeScale: 15 });
    if (!attack.ok) continue;
    const defenderForTrial: FlightRecord = {
      ...defender,
      selectedShips: { scout: 1 },
      selectedCommanders: {},
      attackSnapshot: attack.flight.attackSnapshot,
    };
    const battleState: SaveState = {
      ...attack.state,
      flights: {
        ...attack.state.flights,
        records: attack.state.flights.records.map(flight => flight.id === defender.id
          ? defenderForTrial : flight),
      },
    };
    const resolved = resolveExplorationAttackAtTarget(battleState, attack.flight, attack.flight.arrivalAt);
    const forcesDestroyed = (force: NonNullable<typeof resolved>['report']['attackerForce']) =>
      force.stacks.every(stack => stack.countAfter === 0);
    if (resolved?.report.winner === 'draw'
      && forcesDestroyed(resolved.report.attackerForce)
      && forcesDestroyed(resolved.report.defenderForce)) {
      chosen = { state: battleState, flight: attack.flight, report: resolved.report };
    }
  }
  assert.ok(chosen, 'a seeded equal-scout field battle must reach mutual annihilation');
  if (!chosen) return;

  const once = reconcileFlights(chosen.state, chosen.flight.arrivalAt, undefined,
    { mode: 'test', testTimeScale: 15 });
  const report = once.state.combat.reports.find(item => item.id === chosen!.report.id);
  assert.ok(report);
  assert.equal(report!.winner, 'draw');
  assert.ok(report!.attackerForce.stacks.every(stack => stack.countAfter === 0));
  assert.ok(report!.defenderForce.stacks.every(stack => stack.countAfter === 0));
  const contact = once.state.exploration!.contacts[fixture.target.id]!;
  assert.equal(contact.claim, undefined, 'no surviving ship or commander can retain physical occupancy');
  assert.equal(contact.events.some(event => event.id === chosen!.flight.id + ':capture'), false,
    'a draw never awards capture cargo');
  assert.ok(contact.events.some(event => event.id === chosen!.flight.id + ':contest'
    && event.kind === 'draw' && event.lostCargo), 'undelivered defender cargo is recorded as destroyed');
  for (const id of [chosen.flight.id, npc.flight.id]) {
    const destroyed = once.state.flights.records.find(flight => flight.id === id)!;
    assert.equal(destroyed.phase, 'completed');
    assert.equal(destroyed.completionReason, 'mission-failed');
    assert.equal(Object.values(destroyed.selectedShips).some(count => count > 0), false);
  }
  const debris = getOrbitalDebrisAtCoordinate(once.state.espionage!, fixture.target.coordinate);
  const scoutCount = once.state.planets['helion-01']!.fleet.ships.scout;

  const store = new Map<string, string>();
  const persistence = createPersistenceFacade({ mode: 'test', now: () => chosen!.flight.arrivalAt, storage: {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: key => { store.delete(key); },
  } });
  assert.equal(persistence.write(once.state).ok, true, 'terminal wreck records remain compatible with existing saves');
  const reloaded = persistence.read();
  const replay = reconcileFlights(reloaded, chosen.flight.arrivalAt, undefined,
    { mode: 'test', testTimeScale: 15 });
  assert.equal(replay.state.combat.reports.filter(item => item.id === report!.id).length, 1);
  assert.equal(getOrbitalDebrisAtCoordinate(replay.state.espionage!, fixture.target.coordinate), debris,
    'battle replay after reload does not duplicate wreckage');
  assert.equal(replay.state.planets['helion-01']!.fleet.ships.scout, scoutCount,
    'destroyed attacker hulls are not restored on replay');
  assert.deepEqual(replay.state.rating, once.state.rating, 'battle score is credited exactly once');

  const contenderAt = chosen.flight.arrivalAt + 1;
  const contender = dispatchFlight(reloaded, {
    requestId: 'pr92-next-contender-after-mutual-destruction', missionId: 'expedition',
    contactCycleKey: fixture.target.id, operationId: fixture.target.id,
    originPlanetId: 'helion-01', destination: { kind: 'coordinate', coordinate: fixture.target.coordinate },
    targetKind: fixture.target.kind, selectedShips: { transporter: 1 }, departedAt: contenderAt,
  }, { now: contenderAt, mode: 'test', testTimeScale: 15 });
  assert.equal(contender.ok, true, contender.ok ? '' : contender.error.message);
  if (!contender.ok) return;
  const thirdArrival = reconcileFlights(contender.state, contender.flight.arrivalAt, undefined,
    { mode: 'test', testTimeScale: 15 });
  assert.equal(thirdArrival.state.exploration!.contacts[fixture.target.id]!.claim?.flightId,
    contender.flight.id, 'the next real fleet can occupy the newly freed contact before expiry');
});

test('Bot 01 ships and finite mined material return to existing source exactly once', () => {
  const fixture=prepare();
  const sent=dispatchBot01Exploration(fixture.state,fixture.target,fixture.now,15);
  assert.equal(sent.ok,true,sent.notice);
  if(!sent.ok)return;
  const before=getEspionageTargets(fixture.state.espionage)[sent.flight.originPlanetId]!;
  const finished=reconcileFlights(sent.state,fixture.target.special!.expiresAt+
    sent.flight.oneWayDurationMs+MINUTE,undefined,{mode:'test',testTimeScale:15});
  const after=getEspionageTargets(finished.state.espionage)[sent.flight.originPlanetId]!;
  const flight=finished.state.flights.records.find(f=>f.id===sent.flight.id)!;
  assert.equal(flight.phase,'completed');
  const receipt=finished.state.exploration!.contacts[fixture.target.id]!.events
    .find(e=>e.id===sent.flight.id+':completed');
  assert.ok(receipt,'NPC returns a real escrow receipt, not merely a report');
  for(const [id,count] of Object.entries(sent.flight.selectedShips))
    assert.equal(after.fleet.ships[id as keyof typeof after.fleet.ships],
      before.fleet.ships[id as keyof typeof before.fleet.ships]??0,
      'surviving source fleet must be returned exactly once after mine');
  for(const key of ['metal','minerals','gas'] as const)
    assert.equal(after.resources[key],before.resources[key]+(receipt?.creditedCargo?.[key]??0));
  const repeated=reconcileFlights(finished.state,flight.completedAt!+MINUTE,undefined,{mode:'test',testTimeScale:15});
  assert.deepEqual(getEspionageTargets(repeated.state.espionage)[sent.flight.originPlanetId]!.resources,after.resources);
  assert.deepEqual(getEspionageTargets(repeated.state.espionage)[sent.flight.originPlanetId]!.fleet.ships,after.fleet.ships);
  assert.equal(repeated.state.exploration!.contacts[fixture.target.id]!.events
    .filter(e=>e.id===sent.flight.id+':completed').length,1);
});


test('real-source production NPC expedition survives strict save migration without turning into a player flight', () => {
  const fixture=prepare();
  const launched=dispatchBot01Exploration(fixture.state,fixture.target,fixture.now,15);
  assert.equal(launched.ok,true,launched.notice);
  if(!launched.ok)return;
  const source=getEspionageTargets(launched.state.espionage)[launched.flight.originPlanetId]!;
  const requestId='npc-exploration:'+fixture.target.id+':'+fixture.now;
  const npcFlight={...launched.flight,id:'flight-'+requestId,requestId,ownerSide:'npc' as const};
  const ownerId='real-npc-fixture-owner';
  const state={...launched.state,
    espionage:{...launched.state.espionage!,
      bot01Planets:undefined,bot01Profile:undefined,
      targets:{[source.id]:{...source,ownerId,ownerName:'NPC Fixture',ownerProfile:fixture.state.espionage?.bot01Profile}},
    },
    flights:{...launched.state.flights,records:[npcFlight]},
  };
  const store=new Map<string,string>();
  const facade=createPersistenceFacade({mode:'production',now:()=>fixture.now,storage:{
    getItem:(k:string)=>store.get(k)??null,
    setItem:(k:string,v:string)=>{store.set(k,v);},
    removeItem:(k:string)=>{store.delete(k);},
  }});
  assert.equal(facade.write(state).ok,true);
  const loaded=facade.read();
  const stored=loaded.flights.records.find(f=>f.id===npcFlight.id);
  assert.ok(stored,'a legitimate production NPC flight must not be discarded by save validation');
  assert.equal(stored!.ownerSide,'npc');
  assert.equal(stored!.explorationFactionId,source.raceId);
  assert.deepEqual(stored!.selectedShips,npcFlight.selectedShips);
  assert.equal(getEspionageTargets(loaded.espionage)[source.id]?.ownerId,ownerId);
});
