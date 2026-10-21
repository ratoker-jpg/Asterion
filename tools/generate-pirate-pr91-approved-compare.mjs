import { mkdir, writeFile } from 'node:fs/promises';
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
import { pirateDebrisRewardMultiplier } from '../src/domain/pirates/threat.ts';
import { calculateAttackDebris } from '../src/application/attack.ts';
import { calculateFlightFuel } from '../src/domain/flights/fuel.ts';
import { getRecyclingOutput } from '../src/domain/buildings/recycling.ts';

// APPROVED CONTROLLED EXPERIMENT. The battle seed and every input except
// the pirate's technology levels are identical between old/new profiles.
// "Planet breaker = 2" is a controlled scenario, NOT its production 10% draw.
const HANGAR = 25_112;
const POINTS = [3_000_000, 3_500_000];
const POPULATIONS = [25_090, 25_112];
const PLAYER_DESTROYER_LEVELS = [0, 10];
const BREAKER_COUNTS = [0, 2];
const OUT = resolve('artifacts/pr91-approved-tech-compare');
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
const legacyProfile = profile => {
  const tier=profile.technologyLevel;
  return {...profile,technologies:Object.fromEntries(COMBAT_TECHNOLOGIES.map(t=>[
    t.id,['piercingAttack','maneuverDefense','criticalHit'].includes(t.id)
      && t.id!==profile.exclusiveTechnologyId ? 0 : tier,
  ]))};
};
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
function garrison(profile, requestedPopulation, breakerCount, seed){
  const budget=calculatePirateEliminationPopulationBudget(requestedPopulation,profile.shares,seed);
  const counts={...budget.ships};
  const special=breakerCount*PIRATE_CATALOG_BY_ID['pirate-planet-breaker'].population;
  // Replace ordinary ships within the approved 75–90% target, instead of
  // adding extra NPC population. Replacement is deterministic and documented.
  let used=Object.entries(counts).reduce((sum,[id,n])=>
    sum+(PIRATE_CATALOG_BY_ID[id]?.population||0)*n,0);
  if(special>0){
    const candidates=PIRATE_BASE_SHIPS.filter(s=>counts[s.id]>0)
      .sort((a,b)=>b.population-a.population||a.id.localeCompare(b.id));
    let pass=0;
    while(used+special>budget.targetPopulation){
      const ship=candidates[pass%candidates.length];
      if(!ship || pass>100000)throw Error('Cannot reserve population for special ships');
      if(counts[ship.id]>0){counts[ship.id]--;used-=ship.population;}
      pass++;
    }
    counts['pirate-planet-breaker']=breakerCount;
  }
  const actual=used+special;
  if(actual>budget.targetPopulation)throw Error('Garrison over population budget');
  return {budget,actual,ships:Object.entries(counts).filter(([,n])=>n>0).map(([entityId,count])=>
    ({entityId,count,level:profile.shipLevel}))};
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
    profileId:'pr91-approved-tech-compare-v1',
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
    debrisFromPirates:destroyedPirate,totalDebris,collectionTrips:trips,conversion};
};
const rows=[];
for(const faction of COMBAT_FACTION_IDS){
  for(const points of POINTS){
    const ownerId='pr91-controlled-'+faction;
    const profile=createPirateProfile({ownerId,
      contactCycleKey:'pr91-controlled:'+points,
      score:{resourcePoints:points,battlePoints:0,totalPoints:points}});
    const old=legacyProfile(profile);
    for(const requestedPopulation of POPULATIONS){
      for(const shipLevel of PLAYER_DESTROYER_LEVELS){
        const player=controlledFleet(faction,requestedPopulation,shipLevel);
        for(const breakers of BREAKER_COUNTS){
          const seed=['pr91-compare-v1',faction,points,requestedPopulation,shipLevel,breakers].join(':');
          const pirates=garrison(profile,player.actual,breakers,seed);
          const results={};
          for(const [name,technologies] of [['old',old],['approved',profile]]){
            const report=runBattle(faction,player,technologies,pirates,seed);
            if(report.roundCount>12)throw Error('12-round limit violated');
            const force=report.defenderForce;
            const power=force.stacks.reduce((n,x)=>n+(x.attackPerUnit||0)*x.countBefore,0);
            const life=force.stacks.reduce((n,x)=>n+(x.lifePerUnit||0)*x.countBefore,0);
            results[name]={winner:report.winner,rounds:report.roundCount,
              attack:power,life,attackerRemaining:report.attackerForce.populationAfter,
              pirateRemaining:report.defenderForce.populationAfter,
              ...net(faction,player,report)};
          }
          rows.push({seed,faction,resourcePoints:points,requestedPopulation,
            actualPopulation:player.actual,destroyers:player.shipsRecord.destroyer,
            scoutFiller:player.scoutQty,destroyerLevel:shipLevel,
            planetBreakers:breakers,pirateGarrisonPopulation:pirates.actual,
            pirateTechnologyTier:profile.technologyLevel,
            oldTechnology:old.technologies,approvedTechnology:profile.technologies,
            old:results.old,approved:results.approved,
            deltaAttack:results.approved.attack-results.old.attack,
            deltaLife:results.approved.life-results.old.life,
            deltaNet75:results.approved.conversion[75].net-results.old.conversion[75].net,
            deltaNet120:results.approved.conversion[120].net-results.old.conversion[120].net});
        }
      }
    }
  }
}
const aggregate={count:rows.length,
  meanPirateAttackBefore:rows.reduce((n,x)=>n+x.old.attack,0)/rows.length,
  meanPirateAttackAfter:rows.reduce((n,x)=>n+x.approved.attack,0)/rows.length,
  meanPirateLifeBefore:rows.reduce((n,x)=>n+x.old.life,0)/rows.length,
  meanPirateLifeAfter:rows.reduce((n,x)=>n+x.approved.life,0)/rows.length,
  winsBefore:rows.filter(x=>x.old.winner==='attacker').length,
  winsAfter:rows.filter(x=>x.approved.winner==='attacker').length,
  meanNet75Before:rows.reduce((n,x)=>n+x.old.conversion[75].net,0)/rows.length,
  meanNet75After:rows.reduce((n,x)=>n+x.approved.conversion[75].net,0)/rows.length,
  meanNet120Before:rows.reduce((n,x)=>n+x.old.conversion[120].net,0)/rows.length,
  meanNet120After:rows.reduce((n,x)=>n+x.approved.conversion[120].net,0)/rows.length};
let markdown='# PR91 approved pirate technology — matched-seed before/after comparison\n\n';
markdown+='**Method:** '+rows.length+' paired scenarios, each executed by the production combat resolver twice (old flat tier and approved percentage-based pirate tech) with exactly the same seed and garrison/player manifests, 12-round ceiling, no commanders. Three factions, 3.0m/3.5m resource points, 25,090/25,112 population, destroyers L0/L10, controlled zero/two Planet Breakers.\n\n';
markdown+='**Controlled breaker scenario:** replaces ordinary pirate units to fit the same 75–90% seeded garrison limit. This is NOT an estimate of the production 10% special-spawn chance. Remaining population is actual, not rounded.\n\n';
markdown+='**Net accounting:** game output from destroyed ships, true hull replacement cost, canonical flight fuel for a 12,000-unit route and modeled ten-recycler collection trips, resource conversion at 75%/120%. All orbital debris is assumed retrievable and refinery capacity available; actual trips/payouts/storage limits are NOT simulated as persisted flights; therefore net is a **model upper bound** rather than guaranteed profit. No invented currency conversion: metal+minerals+gas simply summed into resource-equivalent units. All cases include losses and draws, not wins only.\n\n';
markdown+='Summary: '+JSON.stringify(aggregate)+'\n\n';
const cols=['Faction','Pts','Population','Destroyer L','Breakers','Seed','Garrison','W old→new','Rounds old→new','Attack old→new','Life old→new','Net75 old→new','Net120 old→new'];
markdown+='| '+cols.join(' | ')+' |\n|'+cols.map(()=>'---').join('|')+'|\n';
for(const r of rows){
  const pair=(a,b)=>fmt(a)+' → '+fmt(b);
  markdown+='| '+[
    r.faction,r.resourcePoints,r.actualPopulation,r.destroyerLevel,r.planetBreakers,r.seed,
    r.pirateGarrisonPopulation,r.old.winner+' → '+r.approved.winner,
    r.old.rounds+' → '+r.approved.rounds,
    pair(r.old.attack,r.approved.attack),pair(r.old.life,r.approved.life),
    pair(r.old.conversion[75].net,r.approved.conversion[75].net),
    pair(r.old.conversion[120].net,r.approved.conversion[120].net)
  ].join(' | ')+' |\n';
}
markdown+='\nFull rows include player destroyer counts and scout filler, original/new technology objects, debris, flights, fuel, replacement costs, win states and seed; see JSON. No balance coefficient was changed.\n';
await mkdir(OUT,{recursive:true});
await writeFile(resolve(OUT,'comparison.json'),JSON.stringify({aggregate,rows},null,2));
await writeFile(resolve(OUT,'comparison.md'),markdown);
console.log('[pr91-approved-comparison] '+JSON.stringify(aggregate));
console.log('[pr91-approved-example] '+JSON.stringify(rows.filter(r=>r.faction==='aegis'&&r.resourcePoints===3_000_000&&r.actualPopulation===25_112&&r.destroyerLevel===10)));

console.log('[pr91-approved-comparison] '+OUT);
