import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSaveState } from './persistence.ts';
import { buildPirateBattleAnalysisExport, getPirateBattleExportReportCount } from './pirate-battle-export.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import type { FlightRecord } from '../domain/flights/types.ts';

const stamp = '2026-10-16T09:00:00.000Z';
function battle(id: string, ownerId: string, result: 'attacker'|'defender'|'draw', offset: number): BattleReport {
  return {
    id, timestamp: new Date(Date.parse(stamp)+offset*60_000).toISOString(),
    missionType:'pirate-elimination', winner:result,roundCount:2,
    attacker:{side:'attacker',playerId:ownerId,playerName:'Player',race:'Астеры'},
    defender:{side:'defender',playerId:'pirates',playerName:'Pirates',race:'pirates'},
    attackerForce:{populationBefore:60,populationAfter:30,stacks:[
      {entityId:'destroyer',countBefore:2,countAfter:1,destroyed:1},
    ]},
    defenderForce:{populationBefore:55,populationAfter:result==='attacker'?0:20,stacks:[
      {entityId:'pirate-butcher',countBefore:2,countAfter:result==='attacker'?0:1,
        destroyed:result==='attacker'?2:1},
    ]},
    rounds:[{index:1,events:[{sequence:1,actorSide:'attacker',actorEntityId:'destroyer',targetSide:'defender'}]},
      {index:2,events:[]}],
    debris:10_000, resources:{metal:0,minerals:0,gas:0},
    metadata:{source:'combat-resolver',rngProvenance:{mode:'non-replayable',note:'fixture'}},
    pirateReward:{version:1,sentCombatPopulation:60,historicalHangarCapacity:60,
      garrisonCoefficient:.93,garrisonTargetPopulation:56,multiplier:1.5,
      basePirateDebris:5000,bonusPirateDebris:2500,ownDebris:2500,
      threatReductionFraction:1},
  } as BattleReport;
}
function fixture(){
  const initial=createInitialSaveState('test',Date.parse(stamp));
  const owner=initial.profile.playerId;
  const reports=Array.from({length:15},(_,i)=>battle('battle-pirate-flight-'.$i,owner,i===0?'defender':'attacker',i));
  const sample={
    id:'flight-0',missionId:'pirate-elimination',gasCost:292_000,
    selectedShips:{destroyer:2},selectedCommanders:{corsair:1},
    originCoordinate:{galaxy:1,system:2,position:13},
    destinationCoordinate:{galaxy:1,system:3,position:19},
    departedAt:Date.parse(stamp),arrivalAt:Date.parse(stamp)+600,
    phase:'completed',populationReserved:60,routeDistance:50,oneWayDurationMs:600,
    pirateSnapshot:{version:1,missionId:'pirate-elimination',ownerId:owner,contactCycleKey:'fixture',
      adaptiveQ:0,adaptiveWeight:.9,
      eliminationBudget:{coefficient:.93,targetPopulation:56,actualPopulation:55,absoluteError:1,
        ships:{'pirate-butcher':2}},rewardMultiplier:1.5},
    attackSnapshot:{version:1,maxRounds:12,attackerFactionId:'aegis',attackerTechnologies:{},
      attackerShipLevels:{destroyer:10},attackerCommanderLevels:{corsair:40},attackerPriority:[]},
    attackResolution:{reportId:reports[0]!.id,resolvedAt:Date.parse(stamp),debris:10_000,
      loot:{metal:0,minerals:0,gas:0,debris:0}},
  } as FlightRecord;
  return {...initial,combat:{reports:[...reports,battle('npc', 'bot01','defender',16),
      {...battle('incoming',owner,'attacker',20),missionType:'pirate-raid'} as BattleReport],
      savedReportIds:[]},flights:{...initial.flights,records:[sample]}};
}

test('one click exports all 15 owner pirate combats, including initial loss and unmatched reports',()=>{
  const state=fixture();
  assert.equal(getPirateBattleExportReportCount(state),15);
  const data=buildPirateBattleAnalysisExport(state,Date.parse(stamp));
  assert.equal(data.battles.length,15);
  assert.equal(data.battles[0]?.summary.winner,'defender');
  assert.equal(data.battles[0]?.flight?.gasCost,292_000);
  assert.equal(data.battles[0]?.flight?.pirateSnapshot?.adaptiveQ,0);
  assert.equal(data.battles[0]?.flight?.attackSnapshot?.attackerShipLevels.destroyer,10);
  assert.equal(data.battles[0]?.report.rounds[0]?.events[0]?.actorEntityId,'destroyer');
  assert.equal(data.battles[14]?.summary.winner,'attacker');
  assert.equal(data.currentState.unlinkedReportCount,14);
  assert.equal(data.battles[1]?.summary.illustrativeFullCollectionNetAt120Percent,null,
    'missing flight data must never fake exact fuel cost');
  assert.equal(data.battles[0]?.summary.estimateIsActualWalletProfit,false);
  const json=JSON.parse(JSON.stringify(data));
  assert.equal(json.battles.length,15);
  assert.equal(json.battles[0].flight.attackResolution.reportId,json.battles[0].reportId);
  assert.equal(json.battles[0].summary.outgoingGasCost,292000);
  assert.equal(state.combat.reports.length,17,'export is read only');
  assert.equal(state.flights.records.length,1,'no save changes');
});

test('report ordering is chronological and empty export stays valid',()=>{
  const state=fixture(),reversed={...state,combat:{...state.combat,reports:[...state.combat.reports].reverse()}};
  assert.deepEqual(buildPirateBattleAnalysisExport(reversed,Date.parse(stamp)).battles.map(b=>b.reportId),
    buildPirateBattleAnalysisExport(state,Date.parse(stamp)).battles.map(b=>b.reportId));
  const empty={...state,combat:{...state.combat,reports:[]}};
  const payload=buildPirateBattleAnalysisExport(empty,Date.parse(stamp));
  assert.equal(payload.currentState.exportedBattleCount,0);
  assert.equal(payload.battles.length,0);
  assert.equal(JSON.parse(JSON.stringify(payload)).battles.length,0);
});
