import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { reconcileFlights } from './flights.ts';
import { reconcileRuntime } from './reconcile.ts';
import { scaleRuntimeDuration } from '../domain/runtime/mode.ts';
import { resolveDuePirateRoll, selectDuePirateRolls } from './pirate-raids.ts';
import { getCurrentPirateContact } from './pirates.ts';
import { getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';
import { pirateSeededDraw } from '../domain/pirates/threat.ts';
import { normalizePirateRaidSnapshot } from '../domain/pirates/mission.ts';

class MemoryStorage {
  private data=new Map<string,string>();
  getItem(k:string){return this.data.get(k)??null;}
  setItem(k:string,v:string){this.data.set(k,v);}
  removeItem(k:string){this.data.delete(k);}
}

test('owner-cycle roll dispatches one persisted real pirate flight, resolves no-siege combat once',()=>{
  let fixture: ReturnType<typeof getUniverseTimedObjectSchedule> | undefined;
  let cycleKey='';
  let state:ReturnType<typeof createInitialSaveState>|undefined;
  for(let index=0;index<100&&!fixture;index++){
    const schedule=getUniverseTimedObjectSchedule('pirate',1,1,index);
    if(!schedule.present)continue;
    const candidate=createInitialSaveState('production',schedule.startAt);
    const contact=getCurrentPirateContact(candidate,{galaxy:1,system:1,position:1},schedule.startAt+900_000,'production');
    if(!contact)continue;
    if(pirateSeededDraw(`pirate-raid-v1:${candidate.profile.playerId}:${contact.contactCycleKey}`)>=0.30)continue;
    fixture=schedule;cycleKey=contact.contactCycleKey;state=candidate;
  }
  assert.ok(fixture&&state,'Seeded present pirate raid cycle must exist');
  const now=fixture!.startAt+900_000;
  const baseline=state!;
  const seeded={
    ...baseline,
    pirate:{
      ...baseline.pirate!,
      raidProcessedAt:fixture!.startAt,
      ownerThreats:{...baseline.pirate!.ownerThreats,
        [baseline.profile.playerId]:{version:1 as const,ageHours:10_000,integratedAt:fixture!.startAt}},
    },
  };
  const due=selectDuePirateRolls(seeded,fixture!.startAt,now,'production');
  const event=due.find(x=>x.contactCycleKey===cycleKey&&x.ownerId===baseline.profile.playerId);
  assert.ok(event);
  const launched=resolveDuePirateRoll(seeded,event!,'production');
  assert.equal(launched.flights.records.length,1);
  const flight=launched.flights.records[0]!;
  assert.equal(flight.missionId,'pirate-raid');
  assert.equal(flight.ownerSide,'pirate');
  assert.equal(flight.pirateRaidSnapshot?.composition['pirate-planet-breaker' as never],undefined);
  const storage=new MemoryStorage();
  const facade=createPersistenceFacade({mode:'production',storage});
  assert.equal(facade.write(launched).ok,true);
  const hydrated=facade.read();
  assert.ok(hydrated);
  assert.equal(hydrated.flights.records[0]?.id,flight.id);
  const same=resolveDuePirateRoll(hydrated,event!,'production');
  assert.equal(same,same.pirate?.raidRolls?.[JSON.stringify([event!.ownerId,event!.contactCycleKey])]
    ? hydrated:same);
  // An absent target must not produce an impossible victory, loot or siege.
  const missingPlanet={...hydrated,planets:Object.fromEntries(
    Object.entries(hydrated.planets).filter(([id])=>id!==flight.destinationPlanetId))};
  const unavailable=reconcileFlights(missingPlanet,flight.arrivalAt,undefined,{mode:'production'});
  assert.equal(unavailable.state.combat.reports.some(x=>x.id===`battle-pirate-raid-${flight.id}`),false);
  assert.equal(unavailable.state.flights.records.find(x=>x.id===flight.id)?.completionReason,'target-unavailable');
  assert.equal(unavailable.state.flights.records.find(x=>x.id===flight.id)?.phase,'returning');
  // Malformed hull manifest or spoofed contact must be rejected on reload.
  const snapshot=flight.pirateRaidSnapshot!;
  assert.equal(normalizePirateRaidSnapshot({...snapshot,
    composition:{'pirate-planet-breaker':1}}),null);
  assert.equal(normalizePirateRaidSnapshot({...snapshot,contactCycleKey:'fake-cycle'}),null);
  const before=JSON.stringify(hydrated.planets['helion-01']!.buildings);
  const queueBefore=JSON.stringify(hydrated.queues['helion-01']);
  const completed=reconcileFlights(hydrated,flight.arrivalAt,undefined,{mode:'production'});
  const report=completed.state.combat.reports.find(x=>x.id===`battle-pirate-raid-${flight.id}`);
  assert.ok(report,'Arrival must create a shared-engine battle');
  assert.equal(report!.missionType,'pirate-raid');
  assert.deepEqual(completed.state.planets['helion-01']?.buildings,hydrated.planets['helion-01']?.buildings);
  assert.equal(JSON.stringify(completed.state.planets['helion-01']!.buildings),before);
  assert.equal(JSON.stringify(completed.state.queues['helion-01']),queueBefore);
  assert.equal(report!.siege,undefined);
  const replay=reconcileFlights(completed.state,flight.arrivalAt,undefined,{mode:'production'});
  assert.equal(replay.state.combat.reports.length,completed.state.combat.reports.length);
});

test('Test x500 accelerates only raid delay; threat age remains wall-clock',()=>{
  assert.equal(scaleRuntimeDuration(900_000,'test',500),1800);
  assert.equal(scaleRuntimeDuration(900_000,'production',500),900_000);
  const t=Date.now();
  const state=createInitialSaveState('test',t);
  const due=selectDuePirateRolls(state,t,t+1800,'test',500);
  assert.ok(Array.isArray(due));
  assert.equal(state.pirate?.ownerThreats?.[state.profile.playerId]?.ageHours,0);
});
test('offline 8h/24h/48h multi-system rolls cannot duplicate owner-cycle ledger or battle reports',()=>{
  const start=Date.now();
  const baseline=createInitialSaveState('production',start);
  const home=baseline.planets['helion-01']!;
  const clock=baseline.resourceClock.byPlanet?.['helion-01']!;
  const planets={...baseline.planets,
    'pr91-planet-1b':{...home,name:'Secondary',universeGalaxy:1,universeSystem:1,universePosition:6,
      fleet:{ships:{...home.fleet.ships},commanders:{...home.fleet.commanders}}},
    'pr91-planet-2':{...home,name:'Second system',universeGalaxy:1,universeSystem:2,universePosition:6,
      fleet:{ships:{...home.fleet.ships},commanders:{...home.fleet.commanders}}},
    'pr91-planet-3':{...home,name:'Third system',universeGalaxy:1,universeSystem:3,universePosition:6,
      fleet:{ships:{...home.fleet.ships},commanders:{...home.fleet.commanders}}},
  };
  const initial={
    ...baseline,planets,
    queues:{...baseline.queues,'pr91-planet-1b':[],'pr91-planet-2':[],'pr91-planet-3':[]},
    resourceClock:{...baseline.resourceClock,byPlanet:{...baseline.resourceClock.byPlanet,
      'pr91-planet-1b':{...clock},'pr91-planet-2':{...clock},'pr91-planet-3':{...clock}}},
    pirate:{...baseline.pirate!,raidProcessedAt:start,ownerThreats:{
      ...baseline.pirate!.ownerThreats,
      [baseline.profile.playerId]:{version:1 as const,ageHours:10000,integratedAt:start}}},
  };
  const context=(now:number)=>({planetId:'helion-01' as const,now,mode:'production' as const,testTimeScale:15 as const});
  const at8=start+8*3600000,at24=start+24*3600000,at48=start+48*3600000;
  const after8=reconcileRuntime(initial,context(at8)).state;
  const after24=reconcileRuntime(after8,context(at24)).state;
  const staged=reconcileRuntime(after24,context(at48)).state;
  const offline=reconcileRuntime(initial,context(at48)).state;
  const stable=(state:typeof staged)=>({
    rollKeys:Object.keys(state.pirate?.raidRolls??{}).sort(),
    flights:state.flights.records.map(f=>f.id+':'+f.phase).sort(),
    reports:state.combat.reports.map(r=>r.id+':'+r.winner).sort(),
    resources:Object.fromEntries(Object.entries(state.planets).map(([id,p])=>[id,p.resources])),
  });
  assert.deepEqual(stable(staged),stable(offline),'catch-up and incremental simulation must agree');
  const keys=Object.keys(staged.pirate?.raidRolls??{});
  assert.equal(keys.length,new Set(keys).size);
  assert.ok(keys.some(k=>k.includes('pirate-cycle')), 'Expected real chronological pirate checks');
  const uniqueFlights=new Set(staged.flights.records.map(f=>f.id));
  assert.equal(uniqueFlights.size,staged.flights.records.length);
  const uniqueReports=new Set(staged.combat.reports.map(r=>r.id));
  assert.equal(uniqueReports.size,staged.combat.reports.length);
  assert.deepEqual(stable(reconcileRuntime(staged,context(at48)).state),stable(staged),
    'same timestamp reconciliation must be idempotent');
});
