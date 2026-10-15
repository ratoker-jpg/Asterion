import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { reconcileFlights } from './flights.ts';
import { resolveDuePirateRoll, selectDuePirateRolls } from './pirate-raids.ts';
import { getCurrentPirateContact } from './pirates.ts';
import { getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';
import { pirateSeededDraw } from '../domain/pirates/threat.ts';

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
