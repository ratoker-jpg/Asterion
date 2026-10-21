import assert from 'node:assert/strict';
import test from 'node:test';
import {getFactionShipCatalog} from '../combat/faction-catalog.ts';
import {pirateAdaptiveInterval,pirateAdaptiveFleetWeight,
  recordPirateAdaptiveOutcome,defaultPirateOwnerAdaptation,normalizedPirateOwnerAdaptation,
  PIRATE_ADAPTIVE_MIN_WEIGHT} from './adaptive.ts';
import {normalizePirateState} from './mission.ts';
import {calculatePirateEliminationPopulationBudget} from './profile.ts';
import {pirateSeededDraw} from './threat.ts';

test('C: Q=0 starts at 90–95%, reaches 105–110% and never forces combat results',()=>{
  const begin=defaultPirateOwnerAdaptation();
  assert.deepEqual(pirateAdaptiveInterval(begin.q),{min:0.90,max:0.95});
  let cur=begin;
  for(let i=0;i<20;i++)cur=recordPirateAdaptiveOutcome(cur,'flight-win-'+i,1,'win');
  assert.equal(cur.q,1);
  assert.deepEqual(pirateAdaptiveInterval(cur.q),{min:1.05,max:1.10});
  assert.equal(cur.wins,20);assert.equal(cur.weightedWins,20);
  for(let i=0;i<20;i++)cur=recordPirateAdaptiveOutcome(cur,'flight-loss-'+i,1,'loss');
  assert.ok(cur.q<0.01);
  assert.equal(cur.weightedWins/cur.weightedBattles,0.5);
  assert.equal(recordPirateAdaptiveOutcome(cur,'flight-loss-19',1,'loss'),cur,'same flight must not settle twice');
});

test('C: real fleet cost and population resist intentional light scout losses',()=>{
  const catalog=getFactionShipCatalog('aegis');
  const scout=catalog.find(x=>x.id==='scout')!;
  const destroyer=catalog.find(x=>x.id==='destroyer')!;
  const cap=25_112,full=destroyer.population*837;
  const small=pirateAdaptiveFleetWeight('aegis',{scout:10},scout.population*10,cap);
  const heavy=pirateAdaptiveFleetWeight('aegis',{destroyer:837},full,cap);
  assert.ok(small<0.00001);
  assert.ok(heavy>0.99);
  let cur=defaultPirateOwnerAdaptation();
  for(let i=0;i<20;i++)cur=recordPirateAdaptiveOutcome(cur,'flight-win-'+i,heavy,'win');
  const before=cur.q;
  for(let i=0;i<100;i++)cur=recordPirateAdaptiveOutcome(cur,'flight-scout-'+i,small,'loss');
  assert.equal(cur.q,before);
  assert.equal(cur.losses,0);
  assert.ok(PIRATE_ADAPTIVE_MIN_WEIGHT>small);
  cur=recordPirateAdaptiveOutcome(cur,'flight-real-loss',heavy,'loss');
  assert.ok(cur.q<before);
  assert.equal(cur.losses,1);
  assert.ok(pirateAdaptiveFleetWeight('aegis',{scout:10},full,cap)<0.15,'cheap fake full-fleet manifest not valuable');
  assert.equal(pirateAdaptiveFleetWeight('aegis',{},0,cap),0);
});

test('C: same seed locks exact coefficient; q changes only size and remains 90–110%',()=>{
  const shares={'pirate-hound':20,'pirate-raider':20,'pirate-corsair':20,
    'pirate-executioner':20,'pirate-butcher':10,'pirate-bruiser':10} as const;
  for(const q of [0,0.27,0.5,0.9,1]){
    for(let i=0;i<20;i++){
      const seed='adapt-test-seed-'+i;
      const expected=pirateAdaptiveInterval(q);
      const result=calculatePirateEliminationPopulationBudget(25_112,shares,seed,undefined,q);
      const draw=pirateSeededDraw('pirate-garrison-v2:'+seed);
      assert.ok(Math.abs(result.coefficient!-(expected.min+0.05*draw))<1e-12);
      assert.ok(result.coefficient!>=expected.min&&result.coefficient!<expected.max);
      assert.ok(result.actualPopulation<=result.targetPopulation);
      assert.deepEqual(result,calculatePirateEliminationPopulationBudget(25_112,shares,seed,undefined,q));
    }
  }
  const original=calculatePirateEliminationPopulationBudget(25_112,shares,'adapt-test-seed-0');
  assert.ok(original.coefficient!>=0.85&&original.coefficient!<1.05,'pre-C caller untouched');
});

test('C: saved owner stats round-trip and isolate malformed or forged fields',()=>{
  let alice=defaultPirateOwnerAdaptation();
  alice=recordPirateAdaptiveOutcome(alice,'flight-valid-1',1,'win');
  const saved=JSON.parse(JSON.stringify({
    version:1,contact:{version:1,defeatedCycles:{},ownerProfiles:{}},
    reconReports:[],reconLastDispatchAt:{},
    ownerAdaptations:{alice,bob:defaultPirateOwnerAdaptation()},
  }));
  const restored=normalizePirateState(saved);
  assert.deepEqual(restored.ownerAdaptations?.alice,alice);
  assert.equal(restored.ownerAdaptations?.bob?.q,0);
  assert.equal(normalizedPirateOwnerAdaptation({...alice,q:5}),null);
  assert.equal(normalizedPirateOwnerAdaptation({...alice,processedFlights:{'flight-evil':999}}),null);
  assert.deepEqual(normalizePirateState({version:1,contact:saved.contact,
    ownerAdaptations:{alice:{...alice,q:2},bob:saved.ownerAdaptations.bob}})
    .ownerAdaptations?.bob,defaultPirateOwnerAdaptation());
});

test('more than 20 000 processed flights trims the oldest ids instead of wiping the adaptation',()=>{
  const processedFlights=Object.fromEntries(Array.from({length:20_005},(_,i)=>['flight-old-'+i,1]));
  const saved={...defaultPirateOwnerAdaptation(),q:0.42,wins:7,weightedWins:7,weightedBattles:9,processedFlights};
  const restored=normalizedPirateOwnerAdaptation(saved);
  assert.ok(restored,'the owner adaptation survives');
  assert.equal(restored.q,0.42);
  assert.equal(Object.keys(restored.processedFlights).length,20_000);
  assert.equal(restored.processedFlights['flight-old-0'],undefined,'oldest id dropped');
  assert.equal(restored.processedFlights['flight-old-20004'],1,'newest id kept');
  const next=recordPirateAdaptiveOutcome(restored,'flight-new',1,'win');
  assert.equal(Object.keys(next.processedFlights).length,20_000);
  assert.equal(next.processedFlights['flight-new'],1);
  assert.equal(next.processedFlights['flight-old-5'],undefined);
});
