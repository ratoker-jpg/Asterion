import assert from 'node:assert/strict';
import test from 'node:test';
import { PIRATE_BASE_SHIPS, PIRATE_CATALOG_BY_ID } from './catalog.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../combat/faction-catalog.ts';
import { calculateEffectiveDamage, getCombatMatchupMultiplier } from '../combat/resolver.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import { createPirateProfile } from './profile.ts';
import { planPirateRaidFleet } from './raid.ts';
import { pirateSeededDraw, pirateRaidChance, pirateCounterFleetChance } from './threat.ts';

const profile = createPirateProfile({
  ownerId:'raid-owner',contactCycleKey:'pirate-cycle-v1:1:2:3:123456',
  score:{resourcePoints:1_000_000,battlePoints:0,totalPoints:1_000_000},
});
function plan(overrides:Partial<Parameters<typeof planPirateRaidFleet>[0]>={}){
  return planPirateRaidFleet({
    seed:'raid-test-v1',defendingPopulation:5000,possibleLoot:50_000,
    historicalHangarCapacity:25_112,profile,counterFleet:false,
    defense:[{ordinaryClass:'battleship',population:5000}],
    ...overrides,
  });
}
test('pirate fleets freeze seeded 90-95% budgets and exclude planet breakers for both tactics',()=>{
  for(let i=0;i<100;i++){
    const result=plan({seed:`seed-${i}`,counterFleet:i%2===0});
    assert.deepEqual(result,plan({seed:`seed-${i}`,counterFleet:i%2===0}));
    assert.ok(result.coefficient>=0.9&&result.coefficient<0.95);
    assert.ok(result.population>0&&result.population<=result.targetPopulation);
    assert.equal(result.targetPopulation,Math.floor(5000*result.coefficient));
    assert.equal(result.ships['pirate-planet-breaker' as never],undefined);
    const actual=Object.entries(result.ships).reduce((sum,[id,count])=>
      sum+(PIRATE_CATALOG_BY_ID[id as keyof typeof PIRATE_CATALOG_BY_ID]?.population??0)*count,0);
    assert.equal(result.population,actual);
    assert.ok(PIRATE_BASE_SHIPS.every(ship=>Object.keys(result.ships).includes(ship.id)===Boolean(result.ships[ship.id as keyof typeof result.ships])));
  }
});
test('empty rich colony receives a real cargo floor capped to 95% owner historical hangar',()=>{
  const result=plan({defendingPopulation:0,possibleLoot:1_000_000});
  assert.ok(result.population>0);
  assert.ok(result.population<=Math.floor(25_112*0.95));
  assert.ok(result.availableCargo>0);
  assert.ok(Object.values(result.ships).some((count)=>count>0));
});
test('roll chance and counter chance are independent seeded draws',()=>{
  const owner='owner';
  const cycle='pirate-cycle-v1:1:4:1:123456';
  const key=`pirate-raid-v1:${owner}:${cycle}`;
  assert.equal(pirateSeededDraw(key),pirateSeededDraw(key));
  assert.notEqual(pirateSeededDraw(key),pirateSeededDraw(`${key}:counter`));
  assert.equal(pirateRaidChance(1_000_000,0,8),0.02);
  assert.ok(Math.abs(pirateCounterFleetChance(1_000_000,0,0.132)-0.34)<1e-10);
});

test('counterfleet consumes production defense armor + population in all three races',()=>{
  const races:readonly CombatFactionId[]=['aegis','synod','veyra'];
  for(const race of races){
    const ship=getFactionShipCatalog(race).find(x=>x.id==='battleship')!;
    const turret=getFactionDefenseCatalog(race).find(x=>x.id==='plasma-turret')!;
    assert.equal(turret.ordinaryClass,undefined,'production turrets have neutral matchup');
    const onlyShips=plan({counterFleet:true,defense:[{
      kind:'ship',ordinaryClass:ship.ordinaryClass!,
      population:5000,armorStrength:ship.combat.armorStrength,
    }]});
    const onlyTurrets=plan({counterFleet:true,defense:[{
      kind:'defense',population:5000,armorStrength:turret.combat.armorStrength,
    }]});
    const mixed=plan({counterFleet:true,defense:[
      {kind:'ship',ordinaryClass:ship.ordinaryClass!,population:1000,armorStrength:ship.combat.armorStrength},
      {kind:'defense',population:4000,armorStrength:turret.combat.armorStrength},
    ]});
    for(const result of [onlyShips,onlyTurrets,mixed]){
      assert.ok(result.population>0);
      assert.ok(result.population<=result.targetPopulation);
      assert.equal(result.targetPopulation,plan({counterFleet:false}).targetPopulation);
      assert.equal(result.ships['pirate-planet-breaker' as never],undefined);
    }
    const neutral=calculateEffectiveDamage(PIRATE_BASE_SHIPS[0]!.combat.attack,turret.combat.armorStrength);
    assert.ok(neutral>0);
    assert.equal(getCombatMatchupMultiplier('scout','battleship'),1.7);
    assert.ok(Object.values(onlyTurrets.ships).some(n=>n>0));
    assert.ok(Object.values(mixed.ships).some(n=>n>0));
  }
});
