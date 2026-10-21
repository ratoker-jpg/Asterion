import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { getFactionShipCatalog } from '../src/domain/combat/faction-catalog.ts';
import { COMBAT_FACTION_IDS } from '../src/domain/combat/factions.ts';
import { COMBAT_TECHNOLOGIES, createDefaultCombatTechnologies } from '../src/domain/combat/technologies.ts';
import { DEFAULT_COMBAT_PRIORITY } from '../src/domain/combat/priority.ts';
import { resolveCombat } from '../src/domain/combat/resolver.ts';
import { createPirateProfile, calculatePirateEliminationPopulationBudget } from '../src/domain/pirates/profile.ts';
import { PIRATE_BASE_SHIPS, PIRATE_CATALOG_BY_ID } from '../src/domain/pirates/catalog.ts';
import { calculatePirateForceDebris } from '../src/domain/pirates/debris.ts';
import { battleDebrisRoll } from '../src/domain/combat/debris.ts';
import { pirateDebrisRewardMultiplier, pirateSeededDraw } from '../src/domain/pirates/threat.ts';
import { calculateAttackDebris } from '../src/application/attack.ts';
import { calculateFlightFuel } from '../src/domain/flights/fuel.ts';
import { getRecyclingOutput } from '../src/domain/buildings/recycling.ts';

// APPROVED garrison-interval comparison. Pair identical combat seeds, player
// manifest, pirate science, faction and exclusive-tech roll. The only
// experimental variable is the 75–90% vs 85–105% seeded garrison population.
const HANGAR=25_112;
const POINTS=[3_000_000,3_500_000];
const POPULATIONS=[25_090,25_112];
const PLAYER_DESTROYER_LEVELS=[0,10];
const OUT=resolve('artifacts/pr91-garrison-85-105');
const ORDINARY_SEEDS=24;
const CONTROLLED_BREAKER_SEEDS=8;
const add = c => (c?.metal || 0) + (c?.minerals || 0) + (c?.gas || 0);
const fmt = x => Number(x).toLocaleString('en-US', {maximumFractionDigits: 2});
const shipCost = (faction, report) => {
  const cat = new Map(getFactionShipCatalog(faction).map(x=>[x.id,x]));
  return report.attackerForce.stacks.reduce((sum,s)=>sum+
    (s.destroyed||0)*add(cat.get(s.entityId)?.cost),0);
};
const advancedPlayerTech = () => Object.fromEntries(COMBAT_TECHNOLOGIES.map(tech => [
  tech.id, ['maneuverDefense','criticalHit'].includes(tech.id) ? 0 : tech.maxLevel,
]));
const controlledFleet = (faction, requestedPopulation, destroyerLevel) => {
  const ships = getFactionShipCatalog(faction);
  const heavy = ships.find(x=>x.id==='destroyer');
  const light = ships.find(x=>x.id==='scout');
  if(!heavy?.population || !light?.population) throw Error('Missing unit populations');
  const heavyQty = Math.floor(requestedPopulation/heavy.population);
  const remain = requestedPopulation-heavyQty*heavy.population;
  // No battleships or bombers. A small number of scouts is used ONLY when
  // an exact population target is not divisible by destroyer population.
  const scoutQty = Math.floor(remain/light.population);
  const actual=heavyQty*heavy.population+scoutQty*light.population;
  if(actual!==requestedPopulation) throw Error('Cannot assemble EXACT '+requestedPopulation+' population with destroyers+scout filler for '+faction+': got '+actual);
  const shipsRecord={destroyer:heavyQty,...(scoutQty?{scout:scoutQty}:{})};
  return {actual,shipsRecord,scoutQty,
    stacks:[{entityId:'destroyer',count:heavyQty,level:destroyerLevel},
      ...(scoutQty?[{entityId:'scout',count:scoutQty,level:0}]:[])]};
};

function allocationAtTarget(targetPopulation, shares){
  // Counterfactual historical allocation: same 2^N floor/ceil search as
  // calculatePirateEliminationPopulationBudget before the interval patch.
  // It is NOT a second production allocation path.
  const entries=Object.entries(shares).filter(([,p])=>p>0);
  const options=entries.map(([id,share])=>{
    const population=PIRATE_CATALOG_BY_ID[id].population;
    const ideal=targetPopulation*share/100/population;
    return {id,population,lower:Math.floor(ideal),upper:Math.ceil(ideal)};
  });
  let bestError=Infinity,bestPopulation=0,bestCounts=[];
  for(let mask=0;mask<(1<<options.length);mask++){
    const counts=options.map((x,i)=>mask&(1<<i)?x.upper:x.lower);
    const actual=counts.reduce((sum,n,i)=>sum+n*options[i].population,0);
    if(actual>targetPopulation)continue;
    const error=targetPopulation-actual;
    if(error<bestError||(error===bestError&&actual<bestPopulation)){
      bestError=error;bestPopulation=actual;bestCounts=counts;
    }
  }
  const ships=Object.fromEntries(options.flatMap((x,i)=>bestCounts[i]>0?[[x.id,bestCounts[i]]]:[]));
  return {targetPopulation,actualPopulation:bestPopulation,absoluteError:bestError,ships};
}
function garrison(profile, sentPopulation, breakerCount, seed, cohort){
  const draw=pirateSeededDraw(`pirate-garrison-v2:${seed}`);
  const coefficient=cohort==='old'?0.75+0.15*draw:0.85+0.20*draw;
  const targetPopulation=Math.round(sentPopulation*coefficient);
  const actualNew=calculatePirateEliminationPopulationBudget(sentPopulation,profile.shares,seed);
  assert.equal(actualNew.coefficient,0.85+0.20*draw,'the real patched allocator must use the sampled quantile');
  const allocated=cohort==='new'
    ? actualNew
    : {...allocationAtTarget(targetPopulation,profile.shares),coefficient};
  if(cohort==='new') assert.equal(actualNew.targetPopulation,targetPopulation);
  if(cohort==='new'){
    const control=allocationAtTarget(targetPopulation,profile.shares);
    assert.deepEqual(actualNew.ships,control.ships,'old allocation algorithm must match production');
    assert.equal(actualNew.actualPopulation,control.actualPopulation);
  }
  // "2 Planet Breakers" is an intentionally forced, controlled scenario,
  // not the production 10% spawn probability. Replace ordinary ship stacks
  // within the original target; do not give either side free extra population.
  const counts={...allocated.ships};
  const special=breakerCount*PIRATE_CATALOG_BY_ID['pirate-planet-breaker'].population;
  let used=Object.entries(counts).reduce((sum,[id,n])=>sum+PIRATE_CATALOG_BY_ID[id].population*n,0);
  if(special>0){
    const candidates=PIRATE_BASE_SHIPS.filter(x=>counts[x.id]>0)
      .sort((a,b)=>b.population-a.population||a.id.localeCompare(b.id));
    let pass=0;
    while(used+special>targetPopulation){
      const ship=candidates[pass%candidates.length];
      if(!ship||pass>100000)throw Error('Cannot reserve special population');
      if(counts[ship.id]>0){counts[ship.id]--;used-=ship.population;}
      pass++;
    }
    counts['pirate-planet-breaker']=breakerCount;
  }
  const actual=used+special;
  assert.ok(actual<=targetPopulation,'do not exceed either approved or legacy population');
  return {coefficient,targetPopulation,actual,
    ships:Object.entries(counts).filter(([,n])=>n>0).map(([entityId,count])=>({
      entityId,count,level:profile.shipLevel,
    }))};
}
function runBattle(faction,player,profile,pirates,seed){
  const participant=(side,name,race)=>({playerId:name,playerName:name,race,side});
  return resolveCombat({
    scenarioId:seed,timestamp:'2026-10-16T00:00:00.000Z',
    attacker:{participant:participant('attacker','player',faction),
      factionId:faction,ships:player.stacks,commanders:[],activeCommanderId:null},
    defender:{participant:participant('defender','pirates','pirates'),
      combatProfile:{kind:'pirate',snapshot:profile},
      ships:pirates.ships,commanders:[],activeCommanderId:null},
    maxRounds:12,
    attackerPriority:[...DEFAULT_COMBAT_PRIORITY.attack],
    defenderPriority:[...DEFAULT_COMBAT_PRIORITY.defense],
    attackerTechnologies:advancedPlayerTech(),
    defenderTechnologies:profile.technologies,
    technologyMode:'independent',executionMode:'production',seed,
    profileId:'pr91-garrison-85-105-compare-v1',
  },{reportId:seed,missionType:'pirate-elimination'});
}
const net = (faction,player,report) => {
  const debrisRoll=battleDebrisRoll(report.id);
  const destroyedPirate=calculatePirateForceDebris(report.defenderForce,report.attackerForce,'pirate-elimination',debrisRoll);
  const orbitalDebris=calculateAttackDebris(report,faction,faction,debrisRoll);
  const fullWin=report.winner==='attacker'&&report.defenderForce.populationAfter===0;
  const multiplier=fullWin?pirateDebrisRewardMultiplier(player.actual,HANGAR):1;
  const extra=Math.max(0,Math.floor(destroyedPirate*multiplier)-destroyedPirate);
  const totalDebris=orbitalDebris+extra;
  const ownDebris=orbitalDebris-destroyedPirate;
  const factionRecycler=getFactionShipCatalog(faction).find(x=>x.id==='recycler');
  if(!factionRecycler?.ship?.cargo)throw Error('Missing recycler cargo');
  const flightFuel=calculateFlightFuel(faction,player.shipsRecord,12000,{2:15});
  const recyclerCount=10;
  const trips=totalDebris>0?Math.ceil(totalDebris/(factionRecycler.ship.cargo*recyclerCount)):0;
  const recyclerGas=trips*calculateFlightFuel(faction,{recycler:recyclerCount},12000,{2:15});
  const loss=shipCost(faction,report);
  const conversion={};
  for(const percent of [75,120]){
    const output=getRecyclingOutput(totalDebris,percent,{metal:50,minerals:50,gas:0});
    conversion[percent]={output,net:add(output)-loss-flightFuel-recyclerGas};
  }
  return {fullWin,multiplier,lostShipCost:loss,flightFuel,recyclerGas,
    debrisFromPirates:destroyedPirate,ownDebris,bonusPirateDebris:extra,totalDebris,collectionTrips:trips,conversion};
};

const rows=[];
for(const faction of COMBAT_FACTION_IDS)
for(const points of POINTS){
  const profile=createPirateProfile({ownerId:'garrison-study-'+faction,
    contactCycleKey:'pr91-garrison-study:'+points,
    score:{resourcePoints:points,battlePoints:0,totalPoints:points}});
  for(const population of POPULATIONS)
  for(const shipLevel of PLAYER_DESTROYER_LEVELS){
    const player=controlledFleet(faction,population,shipLevel);
    for(const planetBreakers of [0,2]){
      const count=planetBreakers===0?ORDINARY_SEEDS:CONTROLLED_BREAKER_SEEDS;
      for(let n=0;n<count;n++){
        const seed=['pr91-garrison-v3',faction,points,population,shipLevel,planetBreakers,n].join(':');
        const results={};
        for(const cohort of ['old','new']){
          const pirates=garrison(profile,player.actual,planetBreakers,seed,cohort);
          const report=runBattle(faction,player,profile,pirates,seed);
          assert.ok(report.roundCount<=12,'max 12 rounds');
          const economics=net(faction,player,report);
          const lossPopulation=report.attackerForce.populationBefore-report.attackerForce.populationAfter;
          results[cohort]={
            coefficient:pirates.coefficient,targetPopulation:pirates.targetPopulation,
            piratePopulation:pirates.actual,winner:report.winner,rounds:report.roundCount,
            playerPopulationAfter:report.attackerForce.populationAfter,
            piratePopulationAfter:report.defenderForce.populationAfter,
            destroyedPlayerPopulation:lossPopulation,
            destroyedPlayerPercent:lossPopulation/player.actual*100,
            ...economics,
          };
        }
        assert.ok(results.old.coefficient>=0.75&&results.old.coefficient<0.90);
        assert.ok(results.new.coefficient>=0.85&&results.new.coefficient<1.05);
        rows.push({seed,faction,resourcePoints:points,population,shipLevel,
          destroyers:player.shipsRecord.destroyer,scoutFiller:player.scoutQty,
          planetBreakers,old:results.old,new:results.new});
      }
    }
  }
}
const mean=(records,project)=>records.reduce((sum,r)=>sum+project(r),0)/records.length;
const percentile=(values,p)=>{
  const sorted=[...values].sort((a,b)=>a-b);
  const index=(sorted.length-1)*p,left=Math.floor(index),right=Math.ceil(index);
  return sorted[left]+(sorted[right]-sorted[left])*(index-left);
};
const summarize=(records)=>{
  const data={count:records.length};
  for(const phase of ['old','new']){
    const modes=['attacker','draw','defender'];
    data[phase]={
      wins:records.filter(x=>x[phase].winner==='attacker').length,
      draws:records.filter(x=>x[phase].winner==='draw').length,
      losses:records.filter(x=>x[phase].winner==='defender').length,
      fullWins:records.filter(x=>x[phase].fullWin).length,
      winRate:records.filter(x=>x[phase].winner==='attacker').length/records.length,
      drawRate:records.filter(x=>x[phase].winner==='draw').length/records.length,
      lossRate:records.filter(x=>x[phase].winner==='defender').length/records.length,
      meanCoefficient:mean(records,x=>x[phase].coefficient),
      meanPiratePopulation:mean(records,x=>x[phase].piratePopulation),
      meanRounds:mean(records,x=>x[phase].rounds),
      meanDestroyedPlayerPopulation:mean(records,x=>x[phase].destroyedPlayerPopulation),
      meanDestroyedPlayerPercent:mean(records,x=>x[phase].destroyedPlayerPercent),
      meanPirateDebris:mean(records,x=>x[phase].debrisFromPirates),
      meanOwnDebris:mean(records,x=>x[phase].ownDebris),
      meanBonusPirateDebris:mean(records,x=>x[phase].bonusPirateDebris),
      meanLossCost:mean(records,x=>x[phase].lostShipCost),
      meanFuel:mean(records,x=>x[phase].flightFuel+x[phase].recyclerGas),
      meanNet75:mean(records,x=>x[phase].conversion[75].net),
      meanNet120:mean(records,x=>x[phase].conversion[120].net),
      reward2:records.filter(x=>x[phase].multiplier===2).length,
      reward2_5:records.filter(x=>x[phase].multiplier===2.5).length,
      reward1:records.filter(x=>x[phase].multiplier===1).length,
      // Loss distribution across all seeds, including draws and failures.
      lostPopulationPercentMin:Math.min(...records.map(x=>x[phase].destroyedPlayerPercent)),
      lostPopulationPercentP10:percentile(records.map(x=>x[phase].destroyedPlayerPercent),0.10),
      lostPopulationPercentP50:percentile(records.map(x=>x[phase].destroyedPlayerPercent),0.50),
      lostPopulationPercentP90:percentile(records.map(x=>x[phase].destroyedPlayerPercent),0.90),
      lostPopulationPercentMax:Math.max(...records.map(x=>x[phase].destroyedPlayerPercent)),
    };
  }
  return data;
};
const aggregate=summarize(rows);
const byFaction=COMBAT_FACTION_IDS.map(faction=>({faction,...summarize(rows.filter(r=>r.faction===faction))}));
const byConfig=[];
for(const faction of COMBAT_FACTION_IDS)
for(const points of POINTS)
for(const shipLevel of PLAYER_DESTROYER_LEVELS)
for(const breakers of [0,2]){
  const part=rows.filter(r=>r.faction===faction&&r.resourcePoints===points&&r.shipLevel===shipLevel&&r.planetBreakers===breakers);
  byConfig.push({faction,points,shipLevel,planetBreakers:breakers,...summarize(part)});
}
const format=n=>fmt(n);
let markdown='# PR91 75–90% vs 85–105% pirate garrison — matched-seed combat comparison\n\n';
markdown+='**Scope:** '+rows.length+' paired scenarios = '+(rows.length*2)+' actual production-resolver battles. The input is identical per pair except for frozen pirate garrison size: 0.75+0.15×u (historical) vs 0.85+0.20×u (approved), with one identical deterministic seeded draw u from pirate-garrison-v2:seed. Old population manifests reproduce the former floor/ceil optimization and new manifests are checked against the real production allocation function. No combat/ship/science/reward coefficients differ.\n\n';
markdown+='**Sampling:** 3 playable races × 3m/3.5m resource points × 25,090/25,112 actual population × destroyer levels 0/10 × 24 independent seed scenarios with 0 special Planet Breakers and 8 scenarios forcing exactly 2 base defenders. No commanders. Player battle tech is near-maximum and 12-round ceiling. One or more scouts only make otherwise indivisible exact population. These are conditional scenario frequencies, **not guaranteed live probabilities**; the two-breaker cases do not model its 10% real spawn frequency.\n\n';
markdown+='**Accounting:** full-wipe wins receive the existing ×2/×2.5 pirate debris tier, all other outcomes get ×1. Own debris is never multiplied. Net=modeled recycled metal+minerals+gas−destroyed player hull replacement costs−canonical flight fuel−modeled recycler fuel at 75% and 120% conversion. Fully collected debris, available storage/recyclers and unlimited repeated collection trips are assumptions, not in-game persisted flight measurements. Wins, draws and losses all count. No currency conversion is asserted.\n\n';
markdown+='**Global summary:** '+JSON.stringify(aggregate)+'\n\n';
markdown+='| Faction | Points | Destroyer L | Breakers | N per range | Win old→new | Draw old→new | Loss old→new | Mean lost pop % old→new | Pirate debris old→new | Own debris old→new | Mean net75 old→new | Mean net120 old→new |\n|---|---:|---:|---:|---:|---|---|---|---|---|---|---|---|\n';
for(const g of byConfig){
  const pair=(key)=>format(g.old[key])+' → '+format(g.new[key]);
  markdown+='| '+[g.faction,g.points,g.shipLevel,g.planetBreakers,g.count,pair('wins'),pair('draws'),pair('losses'),pair('meanDestroyedPlayerPercent'),pair('meanPirateDebris'),pair('meanOwnDebris'),pair('meanNet75'),pair('meanNet120')].join(' | ')+' |\n';
}
markdown+='\nAll individual inputs, seeds, garrison coefficient, real losses, multipliers, round counts, produced debris, transport/fuel and net values are in comparison.json. Grouped means and conditional observed frequencies are in the aggregate. Do not infer a statistically representative economy from the forced ship rosters.\n';
await mkdir(OUT,{recursive:true});
await writeFile(resolve(OUT,'comparison.json'),JSON.stringify({aggregate,byFaction,byConfig,rows},null,2));
await writeFile(resolve(OUT,'comparison.md'),markdown);
console.log('[pr91-garrison-summary] '+JSON.stringify(aggregate));
console.log('[pr91-garrison-by-faction] '+JSON.stringify(byFaction));
console.log('[pr91-garrison-by-config] '+JSON.stringify(byConfig));
console.log('[pr91-garrison-artifacts] '+OUT);
