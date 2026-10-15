import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPirateContactDefeatsToSchedules,
  createDefaultPirateContactState,
  createPirateContactCycleKey,
  getOrCreatePirateOwnerProfile,
  getPirateOwnerProfile,
  migratePirateContactState,
  PIRATE_CONTACT_QUIET_MS,
  recordPirateContactDefeat,
  validatePirateContactState,
} from './contact.ts';

import { getPirateRaidCheckProgress, PIRATE_RAID_CHECK_INTERVAL_MS } from './contact-schedule.ts';
import { createPirateProfile, pirateTechnologyLevelForResourcePoints, PIRATE_TECH_LEVEL_THRESHOLDS, PIRATE_EXCLUSIVE_TECHNOLOGIES, pirateTechnologyLevels } from './profile.ts';
import { COMBAT_TECHNOLOGIES } from '../combat/technologies.ts';
import { normalizePirateMissionSnapshot, normalizePirateRaidSnapshot } from './mission.ts';

const coordinate = { galaxy: 1, system: 2, position: 7 } as const;

test('pirate cycle key includes the authoritative schedule identity', () => {
  const first = createPirateContactCycleKey({ galaxy: 1, system: 2, cycleIndex: 3, startAt: 100_000 });
  assert.equal(first, 'pirate-cycle-v1:1:2:3:100000');
  assert.notEqual(first, createPirateContactCycleKey({ galaxy: 1, system: 2, cycleIndex: 4, startAt: 100_000 }));
  assert.notEqual(first, createPirateContactCycleKey({ galaxy: 1, system: 2, cycleIndex: 3, startAt: 100_001 }));
});

test('owner profiles freeze on first contact and remain independent across owners', () => {
  const key = createPirateContactCycleKey({ galaxy: 1, system: 2, cycleIndex: 3, startAt: 100_000 });
  const score = { resourcePoints: 10_000, battlePoints: 5_000, totalPoints: 15_000 };
  const first = getOrCreatePirateOwnerProfile(createDefaultPirateContactState(), { ownerId: 'owner-a', contactCycleKey: key, score });
  const secondScore = { resourcePoints: 1_000_000, battlePoints: 0, totalPoints: 1_000_000 };
  const repeated = getOrCreatePirateOwnerProfile(first.state, { ownerId: 'owner-a', contactCycleKey: key, score: secondScore });
  const otherOwner = getOrCreatePirateOwnerProfile(repeated.state, { ownerId: 'owner-b', contactCycleKey: key, score: secondScore });

  assert.equal(repeated.profile, first.profile);
  assert.equal(repeated.profile.score.resourcePoints, 10_000);
  assert.equal(getPirateOwnerProfile(otherOwner.state, 'owner-b', key)?.score.resourcePoints, 1_000_000);
  assert.notEqual(getPirateOwnerProfile(otherOwner.state, 'owner-a', key), getPirateOwnerProfile(otherOwner.state, 'owner-b', key));
  assert.equal(validatePirateContactState(otherOwner.state).valid, true);
});

test('global defeat shortens the quiet interval from victory and advances the cycle schedule', () => {
  const schedules = [
    { cycleIndex: 0, startAt: 0, expiresAt: 60_000, respawnAt: 960_000, lifetimeMs: 60_000, spawnChance: 0.9, present: true },
    { cycleIndex: 1, startAt: 960_000, expiresAt: 1_020_000, respawnAt: 1_920_000, lifetimeMs: 60_000, spawnChance: 0.9, present: true },
    { cycleIndex: 2, startAt: 1_920_000, expiresAt: 1_980_000, respawnAt: 2_880_000, lifetimeMs: 60_000, spawnChance: 0.9, present: true },
  ] as const;
  const firstKey = createPirateContactCycleKey({ galaxy: 1, system: 2, cycleIndex: 0, startAt: 0 });
  const state = recordPirateContactDefeat(createDefaultPirateContactState(), {
    contactCycleKey: firstKey,
    galaxy: 1,
    system: 2,
    cycleIndex: 0,
    startAt: 0,
    coordinate,
    defeatedAt: 40_000,
  });
  const winner = Object.values(state.defeatedCycles)[0]!;
  const conflictingButWellFormed = {
    ...winner,
    contactCycleKey: createPirateContactCycleKey({ galaxy: 1, system: 2, cycleIndex: 0, startAt: 1 }),
    startAt: 1,
    defeatedAt: 30_000,
    nextEligibleAt: 30_000 + PIRATE_CONTACT_QUIET_MS,
  };
  const defeats = [winner, conflictingButWellFormed];
  const projected = applyPirateContactDefeatsToSchedules(schedules, 1, 2, defeats);
  const reverseProjected = applyPirateContactDefeatsToSchedules(schedules, 1, 2, [...defeats].reverse());

  assert.equal(state.defeatedCycles[firstKey]?.nextEligibleAt, 40_000 + PIRATE_CONTACT_QUIET_MS);
  assert.equal(projected[0]?.expiresAt, 40_000);
  assert.deepEqual(reverseProjected, projected);
  assert.equal(projected[1]?.startAt, 40_000 + PIRATE_CONTACT_QUIET_MS);
  assert.equal(projected[1]?.lifetimeMs, schedules[1].lifetimeMs);
  assert.equal(projected[1]?.spawnChance, schedules[1].spawnChance);
  assert.equal(projected[2]?.startAt, projected[1]!.respawnAt);
});

test('defeat recording is idempotent and malformed persisted pirate entries migrate away safely', () => {
  const first = recordPirateContactDefeat(createDefaultPirateContactState(), {
    contactCycleKey: 'pirate-cycle-v1:1:2:3:100000',
    galaxy: 1,
    system: 2,
    cycleIndex: 3,
    startAt: 100_000,
    coordinate,
    defeatedAt: 120_000,
  });
  assert.equal(recordPirateContactDefeat(first, {
    contactCycleKey: 'pirate-cycle-v1:1:2:3:100000',
    galaxy: 1,
    system: 2,
    cycleIndex: 3,
    startAt: 100_000,
    coordinate,
    defeatedAt: 120_000,
  }), first);

  const broken = {
    version: 1,
    defeatedCycles: { 'pirate-cycle-v1:1:2:3:100000': { ...first.defeatedCycles['pirate-cycle-v1:1:2:3:100000'], coordinate: { galaxy: 1, system: -2, position: 7 } } },
    ownerProfiles: { '': { broken: { ownerId: '', contactCycleKey: 'broken' } } },
  };
  assert.equal(validatePirateContactState(broken).valid, false);
  assert.deepEqual(migratePirateContactState(broken), createDefaultPirateContactState());
  assert.deepEqual(migratePirateContactState(undefined), createDefaultPirateContactState());
});

test('raid-check UI period is exactly 15 minutes and independent of base lifetime', () => {
  const start = 100_000;
  const first = getPirateRaidCheckProgress(start, start);
  assert.equal(PIRATE_RAID_CHECK_INTERVAL_MS, 900_000);
  assert.equal(first.remainingMs, 900_000);
  assert.equal(first.percent, 0);
  const halfway = getPirateRaidCheckProgress(start, start + 450_000);
  assert.equal(halfway.remainingMs, 450_000);
  assert.equal(halfway.percent, 50);
  const second = getPirateRaidCheckProgress(start, start + 900_000);
  assert.equal(second.remainingMs, 0);
  assert.equal(second.nextAt, start + 900_000);
  assert.equal(second.percent, 100);
  const later = getPirateRaidCheckProgress(start, start + 4_500_000);
  assert.equal(later.remainingMs, 0);
  assert.equal(later.percent, 100);
  const accelerated = getPirateRaidCheckProgress(start, start + 1_800, 1_800);
  assert.equal(accelerated.remainingMs, 0);
  assert.equal(accelerated.percent, 100);
});

test('approved pirate tech is per-science max percentage at every threshold and one point below',()=>{
  const values=[
    [800_000,7,7,11,14],
    [1_500_000,8,8,12,16],
    [3_000_000,9,9,14,18],
    [3_500_000,9,9,14,18],
    [6_000_000,10,10,15,20],
  ] as const;
  for(const [points,tier,max10,max15,max20] of values){
    assert.equal(pirateTechnologyLevelForResourcePoints(points),tier);
    for(const selected of PIRATE_EXCLUSIVE_TECHNOLOGIES){
      const scaled=pirateTechnologyLevels(points,selected);
      for(const tech of COMBAT_TECHNOLOGIES){
        const expected=Math.round(tech.maxLevel*tier/10);
        const exclusive=PIRATE_EXCLUSIVE_TECHNOLOGIES.includes(tech.id as typeof selected);
        assert.equal(scaled[tech.id],exclusive&&tech.id!==selected?0:expected,
          `${points}/${selected}/${tech.id}`);
        assert.ok(scaled[tech.id]>=0&&scaled[tech.id]<=tech.maxLevel);
        if(tech.maxLevel===10&&(!exclusive||tech.id===selected)) assert.equal(scaled[tech.id],max10);
        if(tech.maxLevel===15&&(!exclusive||tech.id===selected)) assert.equal(scaled[tech.id],max15);
        if(tech.maxLevel===20&&(!exclusive||tech.id===selected)) assert.equal(scaled[tech.id],max20);
      }
    }
  }
  for(let tier=0;tier<PIRATE_TECH_LEVEL_THRESHOLDS.length;tier++){
    const threshold=PIRATE_TECH_LEVEL_THRESHOLDS[tier]!;
    assert.equal(pirateTechnologyLevelForResourcePoints(threshold),tier);
    if(tier>0) assert.equal(pirateTechnologyLevelForResourcePoints(threshold-1),tier-1);
    for(const value of tier>0?[threshold-1,threshold]:[threshold]){
      const t=pirateTechnologyLevelForResourcePoints(value);
      const tech=pirateTechnologyLevels(value,'maneuverDefense');
      for(const definition of COMBAT_TECHNOLOGIES){
        const expected=Math.round(definition.maxLevel*t/10);
        assert.equal(tech[definition.id],
          ['piercingAttack','criticalHit'].includes(definition.id)?0:expected);
      }
    }
  }
  assert.equal(Math.round(13.5),14);
  assert.equal(COMBAT_TECHNOLOGIES.length,10);
});
test('legacy frozen tier technology profiles survive strict validation without silent upgrades',()=>{
  const cycleKey=createPirateContactCycleKey({galaxy:1,system:2,cycleIndex:9,startAt:900_000});
  const input={ownerId:'legacy-owner',contactCycleKey:cycleKey,
    score:{resourcePoints:3_000_000,battlePoints:0,totalPoints:3_000_000}};
  const modern=createPirateProfile(input);
  const legacyTier=modern.technologyLevel;
  const legacyTechnologies=Object.fromEntries(COMBAT_TECHNOLOGIES.map(t=>[
    t.id,PIRATE_EXCLUSIVE_TECHNOLOGIES.includes(t.id as typeof modern.exclusiveTechnologyId)
      &&t.id!==modern.exclusiveTechnologyId?0:legacyTier,
  ]));
  const legacy={...modern,technologies:legacyTechnologies};
  const contact={version:1,defeatedCycles:{},ownerProfiles:{[input.ownerId]:{[cycleKey]:legacy}}};
  assert.equal(validatePirateContactState(contact).valid,true);
  const restored=migratePirateContactState(JSON.parse(JSON.stringify(contact)));
  assert.deepEqual(restored.ownerProfiles[input.ownerId]?.[cycleKey]?.technologies,legacyTechnologies);
  const modernRestored=migratePirateContactState({
    version:1,defeatedCycles:{},ownerProfiles:{[input.ownerId]:{[cycleKey]:modern}}});
  assert.deepEqual(modernRestored.ownerProfiles[input.ownerId]?.[cycleKey]?.technologies,modern.technologies);
  const raid={version:1,ownerId:input.ownerId,contactCycleKey:cycleKey,targetPlanetId:'helion-01',
    checkAt:900_000,counterFleet:false,composition:{'pirate-hound':1},profile:legacy};
  const oldRaid=normalizePirateRaidSnapshot(JSON.parse(JSON.stringify(raid)));
  assert.deepEqual(oldRaid?.profile.technologies,legacyTechnologies);
  assert.equal(oldRaid?.maxRounds,undefined);
  const newRaid=normalizePirateRaidSnapshot({...raid,profile:modern,maxRounds:12});
  assert.equal(newRaid?.maxRounds,12);
  assert.deepEqual(newRaid?.profile.technologies,modern.technologies);
  assert.equal(normalizePirateRaidSnapshot({...raid,profile:{...legacy,technologies:{...legacyTechnologies,shipArmor:3}}}),null,
    'tampered legacy technology levels must still be rejected');
  const mission={version:1,missionId:'pirate-elimination',ownerId:input.ownerId,
    contactCycleKey:cycleKey,coordinate:{galaxy:1,system:2,position:7},
    cycleIndex:9,startAt:900_000,expiresAt:900_000+30*60_000,profile:legacy};
  assert.deepEqual(normalizePirateMissionSnapshot(mission)?.profile.technologies,legacyTechnologies);
});
test('pirate profile keeps seed and fleet shares stable while moving to per-science percent',()=>{
  const input={ownerId:'seed-check',contactCycleKey:'pirate-cycle-v1:1:2:1:120000',
    score:{resourcePoints:3_500_000,battlePoints:0,totalPoints:3_500_000}};
  const p=createPirateProfile(input);
  assert.deepEqual(p,createPirateProfile(input));
  assert.equal(p.technologyLevel,9);
  assert.deepEqual(p.shares,createPirateProfile(input).shares);
  assert.equal(Object.entries(p.technologies).filter(([key,val])=>
    PIRATE_EXCLUSIVE_TECHNOLOGIES.includes(key as typeof p.exclusiveTechnologyId)&&val>0).length,1);
});
