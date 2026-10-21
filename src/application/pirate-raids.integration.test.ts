import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { dispatchFlight, reconcileFlights } from './flights.ts';
import { reconcileRuntime } from './reconcile.ts';
import { scaleRuntimeDuration } from '../domain/runtime/mode.ts';
import { resolveDuePirateRoll, selectDuePirateRolls } from './pirate-raids.ts';
import { getCurrentPirateContact } from './pirates.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { calculateFleetPopulation, createEmptyFleetState } from '../domain/fleet/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { calculateDefensePopulation } from '../domain/fleet/production.ts';
import { createPirateContactCycleKey } from '../domain/pirates/contact-schedule.ts';
import { getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';
import { pirateSeededDraw } from '../domain/pirates/threat.ts';
import { normalizePirateRaidSnapshot } from '../domain/pirates/mission.ts';

// Pinned wall clock so schedules and rolls do not depend on the run date (audit A4).
const PINNED_START_MS=Date.UTC(2026,9,21,12);

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
  assert.equal(flight.pirateRaidSnapshot?.maxRounds,12,'new automatic raids freeze the 12-round ceiling');
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
  assert.equal(normalizePirateRaidSnapshot({...snapshot,maxRounds:8}),null,
    'an invalid injected new maxRounds cannot downgrade the frozen ceiling');
  const legacy=normalizePirateRaidSnapshot((({maxRounds:_rounds,...rest})=>rest)(snapshot));
  assert.ok(legacy,'legacy in-flight raid without a stored round ceiling must hydrate');
  assert.equal(legacy!.maxRounds,undefined);
  assert.equal(normalizePirateRaidSnapshot(JSON.parse(JSON.stringify(legacy)))?.maxRounds,undefined);
  assert.equal(normalizePirateRaidSnapshot(JSON.parse(JSON.stringify(snapshot)))?.maxRounds,12);
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

test('Test x500 resolves a real one-shot cycle at 1.8s without speeding threat age',()=>{
  assert.equal(scaleRuntimeDuration(900_000,'test',500),1800);
  assert.equal(scaleRuntimeDuration(900_000,'production',500),900_000);
  const cycle=Array.from({length:50},(_,index)=>
    getUniverseTimedObjectSchedule('pirate',1,1,index)).find(x=>x.present);
  assert.ok(cycle);
  const t=cycle!.startAt;
  const state=createInitialSaveState('test',t);
  const due=selectDuePirateRolls(state,t,t+1800,'test',500);
  assert.equal(due.filter(x=>x.ownerId===state.profile.playerId&&x.system===1).length,1);
  const event=due.find(x=>x.ownerId===state.profile.playerId&&x.system===1)!;
  assert.equal(event.at,t+1800);
  const resolved=resolveDuePirateRoll(state,event,'test',500);
  const key=JSON.stringify([event.ownerId,event.contactCycleKey]);
  assert.ok(resolved.pirate?.raidRolls?.[key]);
  assert.equal(resolveDuePirateRoll(resolved,event,'test',500),resolved);
  assert.equal(state.pirate?.ownerThreats?.[state.profile.playerId]?.ageHours,0);
  const age=resolved.pirate?.ownerThreats?.[state.profile.playerId]?.ageHours??0;
  assert.ok(age<=1800/3600000,'Test x500 must not age threat by 15 virtual minutes');
});
test('offline 8h/24h/48h multi-system rolls cannot duplicate owner-cycle ledger or battle reports',()=>{
  const start=PINNED_START_MS;
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


test('colonizing an untracked system before its first pirate check yields the same rolls online and offline',()=>{
  const cycle = Array.from({length:100},(_,index)=>getUniverseTimedObjectSchedule('pirate',1,2,index))
    .find(schedule=>schedule.present);
  assert.ok(cycle);
  const start = cycle!.startAt;
  const initial = createInitialSaveState('production',start);
  let launched:ReturnType<typeof dispatchFlight>|undefined;
  for(let position=1;position<=24;position++){
    const attempt=dispatchFlight(initial,{
      requestId:'pr91-colony-raid-calendar',missionId:'colonize',originPlanetId:'helion-01',
      destination:{kind:'coordinate',coordinate:{galaxy:1,system:2,position}},
      targetKind:'empty',selectedShips:{colonizer:1},departedAt:start,
    },start);
    if(attempt.ok){launched=attempt;break;}
  }
  assert.ok(launched?.ok,'A free colonization slot must be available in system 2');
  if(!launched?.ok)return;
  const arrivalAt=start+5*60_000;
  const flight={...launched.flight,arrivalAt,oneWayDurationMs:arrivalAt-start};
  const seeded={...launched.state,flights:{...launched.state.flights,
    records:launched.state.flights.records.map(item=>item.id===flight.id?flight:item)}};
  const checkAt=start+15*60_000;
  const context=(now:number)=>({planetId:'helion-01' as const,now,mode:'production' as const,testTimeScale:1 as const});
  const stagedAtColony=reconcileRuntime(seeded,context(arrivalAt)).state;
  assert.equal(Object.keys(stagedAtColony.planets).length,2);
  const staged=reconcileRuntime(stagedAtColony,context(checkAt)).state;
  const offline=reconcileRuntime(seeded,context(checkAt)).state;
  const key=createPirateContactCycleKey({galaxy:1,system:2,cycleIndex:cycle!.cycleIndex,startAt:start});
  const rollKey=JSON.stringify([initial.profile.playerId,key]);
  assert.ok(staged.pirate?.raidRolls?.[rollKey],'Online colonization checks its new system');
  assert.deepEqual(offline.pirate?.raidRolls?.[rollKey],staged.pirate?.raidRolls?.[rollKey],
    'Offline colonization must not skip the new system');
  assert.deepEqual(Object.keys(offline.pirate?.raidRolls??{}).sort(),
    Object.keys(staged.pirate?.raidRolls??{}).sort());
  assert.deepEqual(reconcileRuntime(offline,context(checkAt)).state.pirate?.raidRolls,
    offline.pirate?.raidRolls,'Replaying the same checkpoint cannot generate another roll');
});

test('NPC pirate raid persists canonical population and commander counts after real fleet losses',()=>{
  const initial=createInitialSaveState('test',1_000);
  const npc=Object.values(getEspionageTargets(initial.espionage))
    .find(target=>target.ownerId!==initial.profile.playerId);
  assert.ok(npc,'Test Mode must have an NPC owner');
  if(!npc)return;
  let verified=false;
  for(let index=0;index<120 && !verified;index++){
    const schedule=getUniverseTimedObjectSchedule('pirate',npc.coordinate.galaxy,npc.coordinate.system,index);
    if(!schedule.present)continue;
    const key=createPirateContactCycleKey({galaxy:npc.coordinate.galaxy,
      system:npc.coordinate.system,cycleIndex:schedule.cycleIndex,startAt:schedule.startAt});
    if(pirateSeededDraw(`pirate-raid-v1:${npc.ownerId}:${key}`)>=0.30)continue;
    const baseline=createInitialSaveState('test',schedule.startAt);
    const target=getEspionageTargets(baseline.espionage)[npc.id];
    if(!target)continue;
    const weakenedFleet=createEmptyFleetState();
    weakenedFleet.ships.scout=1;
    const weakDefense={...target.defense,defenses:{...target.defense.defenses}};
    for(const id of Object.keys(weakDefense.defenses) as Array<keyof typeof weakDefense.defenses>){
      weakDefense.defenses[id]=0;
    }
    const weakened={...target,fleet:weakenedFleet,defense:weakDefense,commanders:{},
      population:{total:calculateFleetPopulation(weakenedFleet,target.raceId),
        fleet:calculateFleetPopulation(weakenedFleet,target.raceId),defense:0},
      resources:{...target.resources,metal:500_000,minerals:500_000,gas:500_000}};
    const targets={...getEspionageTargets(baseline.espionage),[npc.id]:weakened};
    const seeded={...baseline,espionage:{...baseline.espionage!,targets,bot01Planets:targets},
      pirate:{...baseline.pirate!,raidProcessedAt:schedule.startAt,
        ownerThreats:{...baseline.pirate!.ownerThreats,
          [npc.ownerId]:{version:1 as const,ageHours:10_000,integratedAt:schedule.startAt}},
        ownerMaxHangarLevel:{...baseline.pirate!.ownerMaxHangarLevel,[npc.ownerId]:10}}};
    const at=schedule.startAt+15*60_000;
    const due=selectDuePirateRolls(seeded,schedule.startAt,at,'test',1)
      .find(item=>item.ownerId===npc.ownerId&&item.contactCycleKey===key);
    if(!due)continue;
    const launched=resolveDuePirateRoll(seeded,due,'test',1);
    const flight=launched.flights.records.find(item=>item.ownerSide==='pirate'
      && item.destinationPlanetId===npc.id);
    if(!flight)continue;
    const completed=reconcileFlights(launched,flight.arrivalAt,undefined,{mode:'test',testTimeScale:1});
    const report=completed.state.combat.reports.find(item=>item.id===`battle-pirate-raid-${flight.id}`);
    if(!report || !report.defenderForce.stacks.some(stack=>stack.destroyed>0))continue;
    const updated:SpyTargetState=getEspionageTargets(completed.state.espionage)[npc.id]!;
    assert.equal(updated.population.fleet,calculateFleetPopulation(updated.fleet,updated.raceId));
    assert.equal(updated.population.defense,calculateDefensePopulation(updated.defense,updated.raceId));
    assert.equal(updated.population.total,updated.population.fleet+updated.population.defense);
    for(const [id,count] of Object.entries(updated.fleet.commanders)){
      assert.equal(updated.commanders[id as keyof SpyTargetState['commanders']]?.count??0,count);
    }
    const storage=new MemoryStorage();
    const facade=createPersistenceFacade({mode:'test',storage});
    assert.equal(facade.write(completed.state).ok,true);
    const reloaded:SpyTargetState=getEspionageTargets(facade.read().espionage)[npc.id]!;
    assert.deepEqual(reloaded.population,updated.population);
    assert.deepEqual(reloaded.commanders,updated.commanders);
    verified=true;
  }
  assert.equal(verified,true,'Expected a seeded incoming NPC fight with at least one real loss');
});

test('seven owned systems retain distinct once-only raid decisions across a short offline catch-up',()=>{
  const start=PINNED_START_MS;
  const state=createInitialSaveState('production',start);
  const home=state.planets['helion-01']!;
  const clock=state.resourceClock.byPlanet?.['helion-01']!;
  const planets={...state.planets};
  const clocks={...state.resourceClock.byPlanet};
  const queues={...state.queues};
  for(let system=2;system<=7;system++){
    const id=`pr91-load-world-${system}`;
    planets[id]={...home,name:`Load world ${system}`,universeGalaxy:1,universeSystem:system,
      universePosition:6};
    clocks[id]={...clock};queues[id]=[];
  }
  const seeded={...state,planets,queues,resourceClock:{...state.resourceClock,byPlanet:clocks}};
  const end=start+2*3600000;
  const context={planetId:'helion-01' as const,now:end,mode:'production' as const,testTimeScale:1 as const};
  const offline=reconcileRuntime(seeded,context).state;
  const keys=Object.keys(offline.pirate?.raidRolls??{});
  assert.equal(keys.length,new Set(keys).size);
  assert.ok(keys.length>0,'Expected at least one pirate check in seven systems');
  assert.deepEqual(reconcileRuntime(offline,context).state.pirate?.raidRolls,offline.pirate?.raidRolls);
});

test('a persisted raid against a full legal fleet and defense survives startup above the simulator cap', () => {
  let launched: ReturnType<typeof createInitialSaveState> | undefined;
  for (let index = 0; index < 100 && !launched; index++) {
    const cycle = getUniverseTimedObjectSchedule('pirate', 1, 1, index);
    if (!cycle.present) continue;
    const baseline = createInitialSaveState('production', cycle.startAt);
    const planet = baseline.planets['helion-01']!;
    const fleet = createEmptyFleetState();
    fleet.ships.scout = 12_500;
    const defense = { defenses: { ...planet.defense.defenses, 'ballistic-turret': 12_500 } };
    const prepared = {
      ...baseline,
      planets: { ...baseline.planets, 'helion-01': {
        ...planet, buildings: { ...planet.buildings, hangar: 20 }, fleet, defense,
      } },
      pirate: { ...baseline.pirate!, raidProcessedAt: cycle.startAt,
        ownerThreats: { ...baseline.pirate!.ownerThreats,
          [baseline.profile.playerId]: { version: 1 as const, ageHours: 10_000, integratedAt: cycle.startAt } },
        ownerMaxHangarLevel: { ...baseline.pirate!.ownerMaxHangarLevel, [baseline.profile.playerId]: 20 },
      },
    };
    assert.equal(calculateFleetPopulation(fleet), 25_000);
    assert.equal(calculateDefensePopulation(defense, 'aegis'), 25_000);
    const at = cycle.startAt + 900_000;
    const event = selectDuePirateRolls(prepared, cycle.startAt, at, 'production')
      .find((roll) => roll.ownerId === baseline.profile.playerId);
    if (!event) continue;
    const candidate = resolveDuePirateRoll(prepared, event, 'production');
    if (candidate.flights.records.some((flight) => flight.missionId === 'pirate-raid')) launched = candidate;
  }
  assert.ok(launched, 'A deterministic legal high-population raid must be generated');
  const flight = launched.flights.records.find((record) => record.missionId === 'pirate-raid')!;
  assert.ok(flight.populationReserved > 35_000, 'This must reproduce the reported attacker overflow');
  const storage = new MemoryStorage();
  const facade = createPersistenceFacade({ mode: 'production', storage, now: () => flight.arrivalAt });
  assert.equal(facade.write(launched).ok, true);
  const reloaded = facade.read();
  assert.deepEqual(reloaded.flights.records.find((record) => record.id === flight.id)?.pirateRaidSnapshot?.composition,
    flight.pirateRaidSnapshot!.composition, 'Reload preserves the original fleet without truncation');
  const context = { planetId: 'helion-01', now: flight.arrivalAt, mode: 'production' as const, testTimeScale: 15 as const };
  const reconciled = reconcileRuntime(reloaded, context);
  const reportId = `battle-pirate-raid-${flight.id}`;
  const report = reconciled.state.combat.reports.find((record) => record.id === reportId);
  assert.ok(report, 'The due saved raid resolves instead of throwing out of the startup effect');
  assert.equal(report.attackerForce.populationBefore, flight.populationReserved);
  const repeated = reconcileRuntime(reconciled.state, context);
  assert.equal(repeated.state.combat.reports.filter((record) => record.id === reportId).length, 1);
});

test('owned pirate raid losses update and persist the attacked planet while another colony is selected', () => {
  let verified = false;
  for (let index = 0; index < 120 && !verified; index++) {
    const cycle = getUniverseTimedObjectSchedule('pirate', 1, 1, index);
    if (!cycle.present) continue;
    const baseline = createInitialSaveState('test', cycle.startAt);
    const home = baseline.planets['helion-01']!;
    const homeFleet = createEmptyFleetState();
    homeFleet.ships.scout = 1;
    const emptyDefense = {
      defenses: Object.fromEntries(Object.keys(home.defense.defenses).map((id) => [id, 0])) as typeof home.defense.defenses,
    };
    const target = {
      ...home,
      buildings: { ...home.buildings, hangar: 10 },
      fleet: homeFleet,
      defense: emptyDefense,
      resources: { metal: 500_000, minerals: 500_000, gas: 500_000 },
    };
    const selectedColony = {
      ...home,
      id: 'qa-selected-colony',
      name: 'Selected Colony',
      universeSystem: 2,
      universePosition: 1,
      fleet: createEmptyFleetState(),
      defense: emptyDefense,
      resources: { metal: 50_000, minerals: 60_000, gas: 70_000 },
    };
    const clock = baseline.resourceClock.byPlanet?.['helion-01'];
    if (!clock) continue;
    const seeded = {
      ...baseline,
      currentPlanetId: 'qa-selected-colony',
      planets: { ...baseline.planets, 'helion-01': target, 'qa-selected-colony': selectedColony },
      queues: { ...baseline.queues, 'qa-selected-colony': [] },
      resourceClock: {
        ...baseline.resourceClock,
        byPlanet: { ...baseline.resourceClock.byPlanet, 'qa-selected-colony': clock },
      },
      metal: selectedColony.resources.metal,
      minerals: selectedColony.resources.minerals,
      gas: selectedColony.resources.gas,
      pirate: {
        ...baseline.pirate!,
        raidProcessedAt: cycle.startAt,
        ownerThreats: {
          ...baseline.pirate!.ownerThreats,
          [baseline.profile.playerId]: {
            version: 1 as const, ageHours: 10_000, integratedAt: cycle.startAt,
          },
        },
        ownerMaxHangarLevel: {
          ...baseline.pirate!.ownerMaxHangarLevel,
          [baseline.profile.playerId]: 10,
        },
      },
    };
    const at = cycle.startAt + 900_000;
    const contact = getCurrentPirateContact(seeded, { galaxy: 1, system: 1, position: 1 }, at, 'test');
    if (!contact || pirateSeededDraw(`pirate-raid-v1:${baseline.profile.playerId}:${contact.contactCycleKey}`) >= 0.30) continue;
    const event = selectDuePirateRolls(seeded, cycle.startAt, at, 'test', 1)
      .find((roll) => roll.ownerId === baseline.profile.playerId && roll.contactCycleKey === contact.contactCycleKey);
    if (!event) continue;
    const launched = resolveDuePirateRoll(seeded, event, 'test', 1);
    const flight = launched.flights.records.find((record) => record.ownerSide === 'pirate'
      && record.missionId === 'pirate-raid' && record.destinationPlanetId === 'helion-01');
    if (!flight) continue;

    const completed = reconcileFlights(launched, flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 1 });
    const report = completed.state.combat.reports.find((record) => record.id === `battle-pirate-raid-${flight.id}`);
    if (!report?.defenderForce.stacks.some((stack) => stack.destroyed > 0)) continue;
    const attackedPlanet = completed.state.planets['helion-01']!;
    assert.equal(attackedPlanet.fleet.ships.scout, 0, 'The pirate loss must be applied to the attack destination');
    assert.equal(completed.state.currentPlanetId, 'qa-selected-colony', 'Combat must preserve the selected colony');
    assert.equal(completed.state.planets['qa-selected-colony']?.fleet.ships.scout, 0,
      'The selected colony must not receive losses from a raid on Helion');

    const storage = new MemoryStorage();
    const facade = createPersistenceFacade({ mode: 'test', storage, now: () => flight.arrivalAt });
    assert.equal(facade.write(completed.state).ok, true);
    const reloaded = facade.read();
    assert.equal(reloaded.currentPlanetId, 'qa-selected-colony');
    assert.equal(reloaded.planets['helion-01']?.fleet.ships.scout, 0,
      'Reload must preserve the loss on the attacked planet');
    assert.equal(reloaded.planets['qa-selected-colony']?.fleet.ships.scout, 0,
      'Reload must preserve the other planet without cross-applying losses');
    verified = true;
  }
  assert.equal(verified, true, 'Expected a real owned-player pirate fight with fleet losses and a second selected planet');
});
