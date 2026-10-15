import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {getFactionShipCatalog,getFactionDefenseCatalog} from '../src/domain/combat/faction-catalog.ts';
import {COMBAT_FACTION_IDS} from '../src/domain/combat/factions.ts';
import {DEFAULT_COMBAT_PRIORITY} from '../src/domain/combat/priority.ts';
import {resolveCombat} from '../src/domain/combat/resolver.ts';
import {COMBAT_TECHNOLOGIES,createDefaultCombatTechnologies} from '../src/domain/combat/technologies.ts';
import {PIRATE_CATALOG,PIRATE_CATALOG_BY_ID} from '../src/domain/pirates/catalog.ts';
import {createPirateProfile,calculatePirateEliminationPopulationBudget} from '../src/domain/pirates/profile.ts';
import {planPirateRaidFleet} from '../src/domain/pirates/raid.ts';
import {pirateDebrisRewardMultiplier} from '../src/domain/pirates/threat.ts';
import {calculateAttackDebris,calculateAttackLoot} from '../src/application/attack.ts';
import {calculatePirateForceDebris} from '../src/domain/pirates/debris.ts';
import {calculateFlightFuel} from '../src/domain/flights/fuel.ts';
import {startRecyclingJob,collectRecyclingJob} from '../src/domain/buildings/recycling.ts';
import {collectOrbitalDebrisAtCoordinate,getOrbitalDebrisAtCoordinate} from '../src/domain/espionage/orbital-debris.ts';

const PREFIX='pr91-seeded-v1';
const H=25112;
const CASES_PER_COMBINATION=6;
const SCORE_BANDS=[
  {id:'low',resourcePoints:1000,battlePoints:0,population:1000},
  {id:'middle',resourcePoints:100000,battlePoints:0,population:10000},
  {id:'high',resourcePoints:3000000,battlePoints:2000000,population:H},
];
const ROOT=resolve('artifacts/pr91-balance');
const nf=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
const sumCost=c=>(c?.metal??0)+(c?.minerals??0)+(c?.gas??0);
const costOf=(catalog,force)=>{
  const map=new Map(catalog.map(x=>[x.id,x]));
  return [...(force?.stacks??[]),...(force?.defenses??[])].reduce((sum,stack)=>
    sum+Math.max(0,stack.destroyed??0)*sumCost(map.get(stack.entityId)?.cost),0);
};
const playerTech=level=>{
  const technology=createDefaultCombatTechnologies();
  for(const t of COMBAT_TECHNOLOGIES){
    if(t.id==='maneuverDefense'||t.id==='criticalHit')continue;
    technology[t.id]=Math.min(level,t.maxLevel);
  }
  return technology;
};
function playerFleet(faction,population,seed){
  const map=new Map(getFactionShipCatalog(faction).map(x=>[x.id,x]));
  // Mixed expensive hulls + scouts are used to fill the remaining capacity.
  const pattern=(seed%3===0?[
    ['battleship',0.28],['destroyer',0.43],['bomber',0.18]
  ]:seed%3===1?[
    ['battleship',0.40],['destroyer',0.25],['bomber',0.25]
  ]:[['battleship',0.20],['destroyer',0.30],['bomber',0.42]]);
  const count={};
  let used=0;
  for(const [id,weight] of pattern){
    const unit=map.get(id);
    if(!unit)throw new Error('Missing player ship '+id);
    const qty=Math.floor(population*weight/unit.population);
    if(qty>0){count[id]=qty;used+=qty*unit.population;}
  }
  const scout=map.get('scout');
  if(!scout)throw new Error('Missing scout');
  const filler=Math.floor((population-used)/scout.population);
  if(filler>0){count.scout=filler;used+=filler*scout.population;}
  if(used>population)throw new Error('Population overflow');
  return {population:used,counts:count,stacks:Object.entries(count).map(([entityId,count])=>({entityId,count}))};
}
function techFactorProfile(band,index){
  return createPirateProfile({
    ownerId:'balance-owner-'+band.id,
    contactCycleKey:PREFIX+':profile:'+band.id+':'+index,
    score:{resourcePoints:band.resourcePoints,battlePoints:band.battlePoints,
      totalPoints:band.resourcePoints+band.battlePoints},
  });
}
function inputFor(mode,faction,profile,ownFleet,defense,pirates,level,seed){
  const participant=(side,id,race)=>({playerId:id,playerName:id,race,side});
  const own={participant:participant(mode==='base'?'attacker':'defender','player',faction),
    factionId:faction,ships:ownFleet.stacks,commanders:[],activeCommanderId:null,
    ...(defense.length?{defenses:defense}: {})};
  const npc={participant:participant(mode==='base'?'defender':'attacker','pirates','pirates'),
    combatProfile:{kind:'pirate',snapshot:profile},ships:pirates,commanders:[],activeCommanderId:null};
  return{
    scenarioId:seed,timestamp:'2026-10-15T00:00:00.000Z',
    attacker:mode==='base'?own:npc,defender:mode==='base'?npc:own,
    maxRounds:12,attackerPriority:[...DEFAULT_COMBAT_PRIORITY.attack],
    defenderPriority:[...DEFAULT_COMBAT_PRIORITY.defense],
    attackerTechnologies:mode==='base'?playerTech(level):profile.technologies,
    defenderTechnologies:mode==='base'?profile.technologies:playerTech(level),
    technologyMode:'independent',executionMode:'production',seed,profileId:'pr91-seeded-balance-v1',
  };
}
function collectModel(faction,debris,tech){
  const recycler=getFactionShipCatalog(faction).find(x=>x.id==='recycler');
  const perShip=recycler?.ship?.cargo??0;
  if(perShip<=0)throw new Error('Missing recycler cargo');
  const count=10,perFlight=count*perShip;
  // Exercise the actual canonical orbital collection ledger, one cargo-limited
  // trip at a time. Flight travel and trip availability remain separately
  // MODELLED using the canonical game fuel function, not executed flights.
  const coordinate={galaxy:1,system:1,position:14};
  let espionage={targets:{},orbitalDebris:debris>0?{
    source:{id:'source',targetPlanetId:'pr91-balance-target',targetPlanetName:'Balance',
      targetOwnerId:'simulation',targetCoordinate:coordinate,debris,createdAt:1}
  }:{}};
  let collected=0,trips=0;
  while(getOrbitalDebrisAtCoordinate(espionage,coordinate)>0){
    const pickup=collectOrbitalDebrisAtCoordinate(espionage,coordinate,perFlight);
    if(pickup.collected<=0)throw new Error('Orbital debris collection made no progress');
    collected+=pickup.collected;trips++;
    espionage=pickup.espionage;
  }
  if(collected!==debris)throw new Error('Orbital accounting lost debris');
  const selected={recycler:count};
  const collectionGas=trips*calculateFlightFuel(faction,selected,12000,{2:tech});
  function recycle(level,parallel){
    let state={availableDebris:collected,jobs:[]};
    const start=1_000_000;
    let maxFinish=start;
    const slice=Math.floor(collected/parallel),remainder=collected%parallel;
    const ids=[];
    for(let i=0;i<parallel;i++){
      const amount=slice+(i<remainder?1:0);
      if(amount<=0)continue;
      const id='recycle-'+level+'-'+i;
      const queued=startRecyclingJob(state,level,amount,{metal:50,minerals:50,gas:0},start,id);
      if(!queued.canStart)throw new Error('Cannot create real recycling job: '+queued.reason);
      state=queued.state;
      maxFinish=Math.max(maxFinish,queued.job.finishAt);
      ids.push({id,finish:queued.job.finishAt});
    }
    if(state.availableDebris!==0)throw new Error('Unreserved debris remained in recycling ledger');
    const out={metal:0,minerals:0,gas:0};
    for(const job of ids){
      const done=collectRecyclingJob(state,job.id,job.finish);
      if(!done.ok)throw new Error('Real recycling completion failed: '+done.reason);
      state=done.state;
      for(const resource of ['metal','minerals','gas'])out[resource]+=done.output[resource];
    }
    if(state.jobs.length)throw new Error('Uncollected recycling jobs');
    return{out,seconds:(maxFinish-start)/1000};
  }
  const low=recycle(1,1);
  const high=recycle(10,10);
  return{debrisCollected:collected,collectionGas,trips,perFlight,
    output75:low.out,output120:high.out,recyclingMsTenJobs:high.seconds*1000,
    recyclingMsOneJob:low.seconds*1000};
}
const rows=[];
for(const faction of COMBAT_FACTION_IDS){
  const ownCatalog=[...getFactionShipCatalog(faction),...getFactionDefenseCatalog(faction)];
  for(const band of SCORE_BANDS)for(const level of [0,5,10])for(let index=0;index<CASES_PER_COMBINATION;index++){
    const profile=techFactorProfile(band,index);
    const ownFleet=playerFleet(faction,band.population,index);
    const seedBase=PREFIX+':base:'+faction+':'+band.id+':'+level+':'+index;
    const budget=calculatePirateEliminationPopulationBudget(
      ownFleet.population,profile.shares,seedBase,
      {ownerId:profile.ownerId,cycleKey:seedBase,totalPoints:profile.score.totalPoints});
    const pirates=Object.entries(budget.ships).filter(([,count])=>count>0)
      .map(([entityId,count])=>({entityId,count,level:profile.shipLevel}));
    if(!pirates.length)continue;
    const report=resolveCombat(inputFor('base',faction,profile,ownFleet,[],pirates,level,seedBase),
      {reportId:seedBase,missionType:'pirate-elimination'});
    const fullWin=report.winner==='attacker'&&report.defenderForce.populationAfter===0;
    const basePirateDebris=calculatePirateForceDebris(report.defenderForce,report.attackerForce,report.missionType);
    const baselineDebris=calculateAttackDebris(report,faction,faction);
    const multiplier=fullWin?pirateDebrisRewardMultiplier(ownFleet.population,H):1;
    const extraDebris=Math.max(0,Math.floor(basePirateDebris*multiplier)-basePirateDebris);
    const ownDebris=Math.max(0,baselineDebris-basePirateDebris);
    const producedDebris=baselineDebris+extraDebris;
    const collected=collectModel(faction,producedDebris,level);
    const ownLossCost=costOf(ownCatalog,report.attackerForce);
    const attackGas=calculateFlightFuel(faction,ownFleet.counts,12000,{2:level});
    const net75=sumCost(collected.output75)-ownLossCost-attackGas-collected.collectionGas;
    const net120=sumCost(collected.output120)-ownLossCost-attackGas-collected.collectionGas;
    rows.push({seed:seedBase,mode:'base',faction,score:band.id,tech:level,
      winner:report.winner,fullWin,sentPopulation:ownFleet.population,piratePopulation:budget.actualPopulation,
      garrisonCoefficient:budget.coefficient,rounds:report.roundCount,multiplier,
      ownLossCost,defenseLossCost:0,attackGas,collectionGas:collected.collectionGas,
      pirateDebris:basePirateDebris,ownDebris,extraDebris,producedDebris,
      collectedDebris:collected.debrisCollected,output75:collected.output75,output120:collected.output120,
      net75,net120,recycleTrips:collected.trips,recycleSeconds10Jobs:collected.recyclingMsTenJobs/1000,
      lostPlayerPopulation:report.attackerForce.populationBefore-report.attackerForce.populationAfter,
      specialCount:budget.ships['pirate-planet-breaker']??0});
    // Incoming raid with mixed or turret-heavy real defense.
    const incomingSeed=PREFIX+':incoming:'+faction+':'+band.id+':'+level+':'+index;
    const defenseCatalog=getFactionDefenseCatalog(faction);
    const defenses=index%2===0
      ?[{entityId:'plasma-turret',count:Math.max(1,Math.floor(band.population/3/defenseCatalog.find(x=>x.id==='plasma-turret').population))}]
      :[];
    const defensesPop=defenses.reduce((n,x)=>n+x.count*defenseCatalog.find(y=>y.id===x.entityId).population,0);
    const targetDef=[
      ...ownFleet.stacks.map(stack=>{
        const entity=getFactionShipCatalog(faction).find(x=>x.id===stack.entityId);
        return{kind:'ship',ordinaryClass:entity?.ordinaryClass,population:stack.count*entity.population,
          armorStrength:entity.combat.armorStrength};
      }),
      ...defenses.map(stack=>{
        const entity=defenseCatalog.find(x=>x.id===stack.entityId);
        return{kind:'defense',population:stack.count*entity.population,
          armorStrength:entity.combat.armorStrength};
      }),
    ];
    const counter=index%2===0;
    const fleet=planPirateRaidFleet({seed:incomingSeed,defendingPopulation:ownFleet.population+defensesPop,
      possibleLoot:2250000,historicalHangarCapacity:H,
      profile,counterFleet:counter,defense:targetDef});
    if(fleet.population<=0)continue;
    const raidPirates=Object.entries(fleet.ships).map(([entityId,count])=>({entityId,count,level:profile.shipLevel}));
    const defending=resolveCombat(inputFor('incoming',faction,profile,ownFleet,defenses,raidPirates,level,incomingSeed),
      {reportId:incomingSeed,missionType:'pirate-raid'});
    const loot=calculateAttackLoot(defending,{metal:1000000,minerals:1000000,gas:1000000},faction);
    const actualDebris=calculateAttackDebris(defending,faction,faction);
    const battleOwnLossCost=costOf(ownCatalog,defending.defenderForce);
    const damage=defending.defenderForce.populationBefore-defending.defenderForce.populationAfter;
    const collectedRaid=collectModel(faction,actualDebris,level);
    const stolen=sumCost(loot);
    rows.push({seed:incomingSeed,mode:'incoming',faction,score:band.id,tech:level,counter,
      winner:defending.winner,rounds:defending.roundCount,
      sentPopulation:ownFleet.population,defensePopulation:defensesPop,piratePopulation:fleet.population,
      garrisonCoefficient:fleet.coefficient,multiplier:1,
      lostPlayerPopulation:damage,ownLossCost:battleOwnLossCost,
      attackGas:0,collectionGas:collectedRaid.collectionGas,
      pirateDebris:calculatePirateForceDebris(defending.attackerForce,defending.defenderForce,'pirate-raid'),
      ownDebris:Math.max(0,actualDebris-calculatePirateForceDebris(defending.attackerForce,defending.defenderForce,'pirate-raid')),
      extraDebris:0,producedDebris:actualDebris,collectedDebris:collectedRaid.debrisCollected,
      loot,stolenResources:stolen,
      output75:collectedRaid.output75,output120:collectedRaid.output120,
      net75:sumCost(collectedRaid.output75)-battleOwnLossCost-collectedRaid.collectionGas-stolen,
      net120:sumCost(collectedRaid.output120)-battleOwnLossCost-collectedRaid.collectionGas-stolen,
      recycleTrips:collectedRaid.trips,recycleSeconds10Jobs:collectedRaid.recyclingMsTenJobs/1000});
  }
}
function mean(rows,key){return rows.length?rows.reduce((sum,x)=>sum+(x[key]??0),0)/rows.length:0;}
const groups=[];
for(const mode of ['base','incoming'])for(const faction of COMBAT_FACTION_IDS)for(const band of SCORE_BANDS){
  const sample=rows.filter(x=>x.mode===mode&&x.faction===faction&&x.score===band.id);
  if(!sample.length)continue;
  groups.push({mode,faction,score:band.id,samples:sample.length,
    attacker:sample.filter(x=>x.winner==='attacker').length,
    defender:sample.filter(x=>x.winner==='defender').length,
    draw:sample.filter(x=>x.winner==='draw').length,
    fullWins:sample.filter(x=>x.fullWin).length,
    meanOwnLossCost:mean(sample,'ownLossCost'),
    meanPirateDebris:mean(sample,'pirateDebris'),meanOwnDebris:mean(sample,'ownDebris'),
    meanProducedDebris:mean(sample,'producedDebris'),meanCollectedDebris:mean(sample,'collectedDebris'),
    meanFlightGas:mean(sample,'attackGas'),meanCollectionGas:mean(sample,'collectionGas'),
    meanStolen:mean(sample,'stolenResources'),meanNet75:mean(sample,'net75'),meanNet120:mean(sample,'net120')});
}
const fixed=[...rows.filter(x=>x.mode==='base'&&x.score==='high'&&x.tech===10)];
function table(header,rr,columns){
  return '| '+header.join(' | ')+' |\n|'+header.map(()=>'---').join('|')+'|\n'+rr.map(x=>'| '+columns.map(f=>String(f(x))).join(' | ')+' |').join('\n')+'\n';
}
let report='# PR91 — measured seeded combat & economic scenarios\n\n';
report+='Generated from actual resolveCombat outputs. Algorithm '+PREFIX+'. Run '+CASES_PER_COMBINATION+' seeds per faction/score/technology combination.\n\n';
report+='**Evidence boundary:** orbital debris comes from real combat, and collection is executed via the actual orbital-debris ledger and cargo-limited pickup; recycling uses actual domain start/collect transitions (L1 75%, L10 120%). Flight scheduling and available real recycler trips are still modelled with the canonical cargo and fuel rules, NOT persisted spacecraft flights. This is an optimistic full-collection economic upper bound. Units for net = sum of metal+minerals+gas, not currency.\n\n';
report+='**Net base** = modeled recycled resource total – destroyed player hull costs – actual game flight fuel (route=12000) – modeled recycler fuel. **Net incoming** = modeled recycled total – destroyed player hull/defense costs – resource loot removed – modeled recycler fuel.\n\n';
report+='## Real battle outcomes and sample EV\n\n';
report+=table(['Mission','Faction','Score','N','Attacker W','Defender W','Draw','Full base W','Lost cost','Pirate debris','Own debris','Produced debris','Modeled collected','Flight gas','Collector gas','Stolen','Net 75%','Net 120%'],groups,[
 x=>x.mode,x=>x.faction,x=>x.score,x=>x.samples,x=>x.attacker,x=>x.defender,x=>x.draw,x=>x.fullWins,
 x=>nf(x.meanOwnLossCost),x=>nf(x.meanPirateDebris),x=>nf(x.meanOwnDebris),x=>nf(x.meanProducedDebris),x=>nf(x.meanCollectedDebris),
 x=>nf(x.meanFlightGas),x=>nf(x.meanCollectionGas),x=>nf(x.meanStolen),x=>nf(x.meanNet75),x=>nf(x.meanNet120)]);
report+='\n## High-score 25,112-pop expensive hull scenarios (tech 10)\n\n';
report+=table(['Faction','Seed','Sent','Garrison','Breaker','Outcome','Tier','Own hull cost','Pirate debris','Own debris','Bonus','Modeled recovered','Net 75%','Net 120%'],fixed,[
 x=>x.faction,x=>x.seed,x=>x.sentPopulation,x=>x.piratePopulation,x=>x.specialCount,x=>x.winner,x=>'x'+x.multiplier,
 x=>nf(x.ownLossCost),x=>nf(x.pirateDebris),x=>nf(x.ownDebris),x=>nf(x.extraDebris),x=>nf(x.collectedDebris),
 x=>nf(x.net75),x=>nf(x.net120)]);
report+='\n## Recoverability and time\n\nReal level-10 throughput = 980 debris/sec/job, 10 jobs = 9,800/sec total; conversion 75–120% according to existing level configuration.\n';
report+='Recycler transport trips are ceil(produced debris / (10 × actual faction recycler cargo)), fuel paid per outgoing game fuel formula for each trip (distance 12000, chemistry tech matched); this is a modeled *unlimited-trip* upper-bound. In-game 24-hour auto collect, storage limits, flight scheduling, fleet damage, gas reserves and actual collector availability may reduce realized value.\n';
report+='\n## Interpretation / limitations\n\nOutcomes are deterministic samples, not provable live balance. Wins/losses are real combat-engine outcomes; no planet siege in incoming raid model. Counter optimization uses actual defending ship matchups and defense armor. Real-world net is <= modeled full-collection net if collection expires, stock is unavailable or caps bind. User approval required for any economic coefficient changes.\n';
await mkdir(ROOT,{recursive:true});
await writeFile(resolve(ROOT,'seeded-results.json'),JSON.stringify({prefix:PREFIX,totalBattles:rows.length,groups,rows},null,2));
await writeFile(resolve(ROOT,'seeded-report.md'),report);
console.log('[pr91-balance-summary] '+JSON.stringify({totalBattles:rows.length,groups,highPopulationScenarios:fixed.length}));
console.log('[pr91-balance] Wrote artifacts/pr91-balance/seeded-report.md and seeded-results.json');
