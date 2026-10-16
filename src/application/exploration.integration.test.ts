import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { dispatchFlight, reconcileFlights, recallFlight } from './flights.ts';
import { reconcileRuntime } from './reconcile.ts';
import { getPlanetResources, replacePlanetState } from './contracts.ts';
import { getExplorationTarget, explorationTargetStatus, selectExplorationTargets } from './exploration.ts';
import { explorationResourceScore } from './exploration-flight.ts';

const MINUTE = 60_000;
const baseTime = 1_790_000_000_000;

function prepare() {
  let state = createInitialSaveState('test', baseTime);
  const planet = state.planets['helion-01'];
  state = replacePlanetState(state, 'helion-01', {
    ...planet,
    fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, transporter: 10, recycler: 10 } },
  });
  for (let offset = 0; offset < 480; offset++) {
    const now = baseTime + offset * MINUTE;
    const targets = selectExplorationTargets(state, now, 'test');
    const target = targets.find(node => node.special && node.special.expiresAt - now > 6 * MINUTE);
    if (target) return { state, now, target };
  }
  throw new Error('No eligible timed exploration contact in the deterministic eight-hour fixture');
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
