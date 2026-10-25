import assert from 'node:assert/strict';
import test from 'node:test';
import { createBot01Planets } from '../domain/espionage/fixtures.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import { createNpcState } from '../domain/npc/state.ts';
import {
  estimateAttackUtility, estimateBuildingUtility, estimateEspionageUtility, estimateProductionUtility, estimateRaidEconomics,
  type NpcUtilityContext,
} from './npc-utility.ts';

const HOUR = 3_600_000;
const AT = 100 * HOUR;
const origin = { ...Object.values(createBot01Planets(0))[0]!, id: 'own-origin', ownerId: 'npc-a', raceId: 'aegis' } as SpyTargetState;

function context(traits: Record<string, number> = {}, reports: SpyReportSnapshot[] = [], threat = 0): NpcUtilityContext {
  const base = createNpcState(['npc-a'], 'npc-utility-app', 0).profiles['npc-a']!;
  const profile = { ...base, traits: { ...base.traits, riskTolerance: 0.5, aggression: 0.5, mechanicsKnowledge: 1, ...traits } };
  return { profile, at: AT, timeScale: 1, dayValue: 50_000, ownPlanets: [origin], threat,
    latestReports: new Map(reports.map((report) => [report.targetPlanetId, report])) };
}

function report(targetPlanetId: string, fleet: Record<string, number> | undefined, createdAt = AT - HOUR, metal = 200_000): SpyReportSnapshot {
  return {
    id: `r-${targetPlanetId}`, missionId: 'm', ownerId: 'npc-a', createdAt, sourcePlanetId: 'own-origin', targetPlanetId,
    targetPlanetName: targetPlanetId, targetOwnerId: 'other', targetOwnerName: 'other', targetRaceId: 'aegis', targetRelation: 'neutral',
    targetCoordinate: { galaxy: 1, system: 2, position: 3 }, spyLevel: 1, targetEspionageLevel: 1, delta: 0, roll: 1,
    quality: fleet ? 'detailed' : 'basic', resources: { metal, minerals: 0, gas: 0, debris: 0, developmentEnergy: 0 },
    ...(fleet ? { fleet, defense: {} } : {}), firstReport: true,
  };
}

test('an attack the owner expects to win is attractive; one it expects to lose is not', () => {
  const reports = [report('weak', { scout: 2 }), report('strong', { battleship: 60 })];
  const ships = { cruiser: 20 };
  const easy = estimateAttackUtility(context({}, reports), origin, 'weak', ships);
  const hopeless = estimateAttackUtility(context({}, reports), origin, 'strong', ships);
  assert.ok(easy > 0.5, `easy ${easy}`);
  assert.ok(hopeless < -0.5, `hopeless ${hopeless}`);
});

test('a raid for a handful of resources is never worth the flight, however warlike the owner (25.10.2026)', () => {
  const ships = { cruiser: 20 };
  const crumbs = [report('crumbs', {}, AT - HOUR, 63)];
  const warlike = context({ aggression: 1, riskTolerance: 1 }, crumbs);
  assert.equal(estimateRaidEconomics(warlike, origin, crumbs[0]!, ships).worthFlight, false);
  assert.ok(estimateAttackUtility(warlike, origin, 'crumbs', ships) <= -2);
  const rich = [report('rich', {}, AT - HOUR, 200_000)];
  assert.equal(estimateRaidEconomics(context({}, rich), origin, rich[0]!, ships).worthFlight, true);
  assert.ok(estimateAttackUtility(context({}, rich), origin, 'rich', ships) > 0.5);
});

test('without own intelligence an attack is feared, and stale intelligence is trusted less', () => {
  const ships = { cruiser: 20 };
  assert.ok(estimateAttackUtility(context(), origin, 'unknown', ships) < -0.8);
  const fresh = estimateAttackUtility(context({}, [report('t', { cruiser: 12 }, AT - HOUR, 5_000_000)]), origin, 't', ships);
  const stale = estimateAttackUtility(context({}, [report('t', { cruiser: 12 }, AT - 70 * HOUR, 5_000_000)]), origin, 't', ships);
  assert.ok(fresh > stale, `fresh ${fresh} stale ${stale}`);
});

test('risk-averse and peaceful owners value the same attack lower', () => {
  // A rich enough haul that both owners consider the raid at all.
  const reports = [report('even', { cruiser: 18 }, AT - HOUR, 5_000_000)];
  const ships = { cruiser: 20 };
  const bold = estimateAttackUtility(context({ riskTolerance: 1, aggression: 1 }, reports), origin, 'even', ships);
  const careful = estimateAttackUtility(context({ riskTolerance: 0, aggression: 0 }, reports), origin, 'even', ships);
  assert.ok(bold > careful);
});

test('spying is worth more on an unknown target than on a freshly scouted one', () => {
  const traits = { aggression: 0.8, militaryFocus: 0.8 };
  assert.ok(estimateEspionageUtility(context(traits), 'unknown') > estimateEspionageUtility(context(traits, [report('seen', undefined, AT - HOUR)]), 'seen'));
});

test('being attacked raises the value of defence', () => {
  const cost = { metal: 2_000, minerals: 1_000, gas: 0 };
  assert.ok(estimateProductionUtility(context({}, [], 1), 'defense', cost) > estimateProductionUtility(context({}, [], 0), 'defense', cost) + 0.8);
});

test('storage is worth building only when it is filling up', () => {
  const cost = { metal: 1_000, minerals: 500, gas: 0 };
  const full = { ...origin, resources: { ...origin.resources, metal: 95_000 } };
  const empty = { ...origin, resources: { ...origin.resources, metal: 1_000 } };
  const capacity = { metal: 100_000 };
  assert.ok(estimateBuildingUtility(context(), full, 'metal-storage', 2, cost, capacity) > estimateBuildingUtility(context(), empty, 'metal-storage', 2, cost, capacity) + 0.8);
});
