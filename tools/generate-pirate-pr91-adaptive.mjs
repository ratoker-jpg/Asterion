import {mkdir,writeFile} from 'node:fs/promises';
import {resolve as pathResolve} from 'node:path';
import {getFactionShipCatalog} from '../src/domain/combat/faction-catalog.ts';
import {COMBAT_FACTION_IDS} from '../src/domain/combat/factions.ts';
import {COMBAT_TECHNOLOGIES} from '../src/domain/combat/technologies.ts';
import {DEFAULT_COMBAT_PRIORITY} from '../src/domain/combat/priority.ts';
import {resolveCombat} from '../src/domain/combat/resolver.ts';
import {createPirateProfile,calculatePirateEliminationPopulationBudget} from '../src/domain/pirates/profile.ts';
import {calculatePirateForceDebris} from '../src/domain/pirates/debris.ts';
import {pirateDebrisRewardMultiplier} from '../src/domain/pirates/threat.ts';
import {calculateAttackDebris} from '../src/application/attack.ts';
import {calculateFlightFuel} from '../src/domain/flights/fuel.ts';
import {getRecyclingOutput} from '../src/domain/buildings/recycling.ts';
import assert from 'node:assert/strict';

const OUT=pathResolve('artifacts/pr91-adaptive-c');
const HANGAR=25_112;
const sum=x=>(x?.metal??0)+(x?.minerals??0)+(x?.gas??0);
const qLevels=[0,.5,1];
const rows=[];
const liveProfile=points=>({resourcePoints:points,battlePoints:0,totalPoints:points});
const technologies=()=>Object.fromEntries(COMBAT_TECHNOLOGIES.map(t=>[
  t.id,['maneuverDefense','criticalHit'].includes(t.id)?0:t.maxLevel,
]));
function playerFleet(faction,population,shipLevel){
  const catalog=getFactionShipCatalog(faction);
  const d=catalog.find(x=>x.id==='destroyer'),s=catalog.find(x=>x.id==='scout');
  if(!d||!s)throw Error('Missing combat ships');
  const destroyer=Math.floor(population/d.population);
  const scout=Math.floor((population-destroyer*d.population)/s.population);
  const pop=destroyer*d.population+scout*s.population;
  const stacks=[{entityId:'destroyer',count:destroyer,level:shipLevel},
    ...(scout?[{entityId:'scout',count:scout,level:0}]:[])];
  return {stacks,selected:{destroyer,scout},population:pop,catalog};
}
function run(faction,points,population,level,q,seedIndex){
  const attacker=playerFleet(faction,population,level);
  const ownerId='adaptive-study-'+faction;
  const cycleKey='adaptive-study-'+points+'-'+population+'-'+seedIndex;
  const profile=createPirateProfile({ownerId,contactCycleKey:cycleKey,score:liveProfile(points)});
  const seed='adaptive-C:'+faction+':'+points+':'+population+':'+level+':'+seedIndex;
  const budget=calculatePirateEliminationPopulationBudget(attacker.population,profile.shares,seed,
    {ownerId,cycleKey,totalPoints:profile.score.totalPoints},q);
  assert.ok(budget.coefficient>=.90&&budget.coefficient<1.10);
  assert.ok(budget.actualPopulation<=budget.targetPopulation);
  const pirates=Object.entries(budget.ships).filter(([,n])=>n>0)
    .map(([entityId,count])=>({entityId,count,level:profile.shipLevel}));
  const report=resolveCombat({
    scenarioId:seed,timestamp:'2026-10-16T00:00:00.000Z',
    attacker:{participant:{playerId:'player',playerName:'Player',race:faction,side:'attacker'},
      factionId:faction,ships:attacker.stacks,commanders:[],activeCommanderId:null},
    defender:{participant:{playerId:'pirates',playerName:'Pirates',race:'pirates',side:'defender'},
      combatProfile:{kind:'pirate',snapshot:profile},ships:pirates,commanders:[],activeCommanderId:null},
    maxRounds:12,attackerPriority:[...DEFAULT_COMBAT_PRIORITY.attack],
    defenderPriority:[...DEFAULT_COMBAT_PRIORITY.defense],
    attackerTechnologies:technologies(),defenderTechnologies:profile.technologies,
    technologyMode:'independent',executionMode:'production',seed,
    profileId:'pr91-adaptive-C-economics',
  },{reportId:seed,missionType:'pirate-elimination'});
  const fullWin=report.winner==='attacker'&&report.defenderForce.populationAfter===0;
  const pirateDebris=calculatePirateForceDebris(report.defenderForce,report.attackerForce,'pirate-elimination');
  const baseDebris=calculateAttackDebris(report,faction,faction);
  const mult=fullWin?pirateDebrisRewardMultiplier(attacker.population,HANGAR):
    report.winner==='draw'?.75:.5;
  const orbital=Math.max(0,baseDebris+Math.floor(pirateDebris*mult)-pirateDebris);
  const replacement=report.attackerForce.stacks.reduce((n,stack)=>{
    const cost=attacker.catalog.find(x=>x.id===stack.entityId)?.cost;
    return n+(stack.destroyed??0)*sum(cost);
  },0);
  const recycler=attacker.catalog.find(x=>x.id==='recycler');
  if(!recycler?.ship?.cargo)throw Error('No recycler cargo');
  const count=10,tripCargo=recycler.ship.cargo*count;
  const trips=Math.ceil(orbital/tripCargo);
  const fuel=calculateFlightFuel(faction,attacker.selected,12000,{2:15});
  const recyclerFuel=trips*calculateFlightFuel(faction,{recycler:count},12000,{2:15});
  const output=getRecyclingOutput(orbital,120,{metal:50,minerals:50,gas:0});
  return {seed,faction,points,population:attacker.population,level,q,winner:report.winner,
    fullWin,rounds:report.roundCount,coefficient:budget.coefficient,
    piratePopulation:budget.actualPopulation,specialBreakers:budget.ships['pirate-planet-breaker']??0,
    ownDestroyedPopulation:report.attackerForce.populationBefore-report.attackerForce.populationAfter,
    pirateDebris,ownDebris:baseDebris-pirateDebris,
    multiplier:mult,orbital,debrisOutput120:sum(output),
    replacement,fuel,recyclerFuel,trips,
    optimisticNet120:sum(output)-replacement-fuel-recyclerFuel};
}
for(const faction of COMBAT_FACTION_IDS)
for(const points of [3_000_000,3_500_000])
for(const population of [25_090,25_112])
for(const level of [0,10])
for(const q of qLevels)
for(let seed=0;seed<12;seed++) rows.push(run(faction,points,population,level,q,seed));
const stats=group=>{const n=group.length;const avg=k=>group.reduce((sum,r)=>sum+r[k],0)/n;
  return{count:n,wins:group.filter(r=>r.fullWin).length,
    draws:group.filter(r=>r.winner==='draw').length,
    losses:group.filter(r=>r.winner==='defender').length,
    meanOpponentPopulation:avg('piratePopulation'),meanCoefficient:avg('coefficient'),
    meanOwnPopulationLost:avg('ownDestroyedPopulation'),meanOrbit:avg('orbital'),
    meanLostHullCost:avg('replacement'),meanFuel:avg('fuel'),
    meanRecyclerFuel:avg('recyclerFuel'),meanOptimisticNet120:avg('optimisticNet120'),
    numberWithSpecial:group.filter(r=>r.specialBreakers>0).length};};
const summary=qLevels.map(q=>({q, ...stats(rows.filter(r=>r.q===q))}));
const grouped=[];
for(const faction of COMBAT_FACTION_IDS)
for(const q of qLevels)grouped.push({faction,q,...stats(rows.filter(r=>r.faction===faction&&r.q===q))});
const md=['# PR91 C: hidden Q, matched scenario seeded battle & optimistic economy',
  '', 'Uses the production combat resolver for 864 real battles; 3 races, 3m/3.5m',
  'resource points, 25,090/25,112 population, destroyers L0/L10, 12 independent seeds,',
  'three fixed Q conditions (0, 0.5, 1), common deterministic garrison seed per condition.',
  'Rare breaker uses the unchanged production 10% seeded special roll. No commanders.',
  'This is a **conditional Q scenario grid**, not a simulation of long-term feedback loops.',
  'The 55% goal is not guaranteed: a correct counter-fleet may keep winning at Q=1.',
  '', '**Net assumption:** all orbital debris collected, 120% recycling, canonical hull',
  'replacement costs, attack gas and modeled ten-recycler fuel/trips; fleet recycler flights',
  'and storage constraints are NOT executed. Figures are optimistic upper bounds.',
  '', '| Q | Battles | Full wins | Draws | Defender wins | Mean opponent pop | Mean own pop lost | Mean net 120% |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...summary.map(r=>`| ${r.q} | ${r.count} | ${r.wins} | ${r.draws} | ${r.losses} | ${r.meanOpponentPopulation.toFixed(0)} | ${r.meanOwnPopulationLost.toFixed(0)} | ${r.meanOptimisticNet120.toFixed(0)} |`),
  '', 'Full per-seed manifests, losses, fuel, debris and economics: results.json.'].join('\n');
await mkdir(OUT,{recursive:true});
await writeFile(pathResolve(OUT,'results.json'),JSON.stringify({summary,grouped,rows},null,2));
await writeFile(pathResolve(OUT,'summary.md'),md);
console.log('[pirate-adaptive-C-balance] '+JSON.stringify({summary,grouped}));
