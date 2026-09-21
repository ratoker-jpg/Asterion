import { getBuildingPresentation, isBuildingRole } from '../buildings/resource-zone.ts';
import { getFactionCombatEntity } from './faction-catalog.ts';
import type { CombatFactionId } from './factions.ts';
import { createSeededCombatRng } from './resolver.ts';
import type {
  BattleForceSnapshot,
  BattleReport,
  BattleSiegeBlockedReason,
  BattleSiegeBuildingRoll,
  BattleSiegeDemolition,
  BattleSiegeDestroyerContribution,
  BattleSiegeDestruction,
  BattleSiegeReport,
} from './report.ts';
import type { SpyTargetState } from '../espionage/types.ts';

export type PlanetSiegeProfile = {
  demolitionPointsAtLevel10: number;
  destructionChanceAtLevel10Bps: number;
};

export const PLANET_SIEGE_PROFILES: Readonly<Record<CombatFactionId, PlanetSiegeProfile>> = Object.freeze({
  aegis: { demolitionPointsAtLevel10: 100, destructionChanceAtLevel10Bps: 300 },
  synod: { demolitionPointsAtLevel10: 90, destructionChanceAtLevel10Bps: 250 },
  veyra: { demolitionPointsAtLevel10: 55, destructionChanceAtLevel10Bps: 150 },
});

export type PlanetSiegeThreshold = {
  min: number;
  max: number | null;
  chanceBps: number;
  selectedBuildings: number | 'all';
};

export const PLANET_SIEGE_DEMOLITION_THRESHOLDS: readonly PlanetSiegeThreshold[] = [
  { min: 0, max: 19, chanceBps: 0, selectedBuildings: 0 },
  { min: 20, max: 100, chanceBps: 2_000, selectedBuildings: 1 },
  { min: 101, max: 200, chanceBps: 4_000, selectedBuildings: 1 },
  { min: 201, max: 400, chanceBps: 6_000, selectedBuildings: 1 },
  { min: 401, max: 550, chanceBps: 5_000, selectedBuildings: 2 },
  { min: 551, max: 700, chanceBps: 7_000, selectedBuildings: 2 },
  { min: 701, max: 850, chanceBps: 5_000, selectedBuildings: 3 },
  { min: 851, max: 1_000, chanceBps: 6_000, selectedBuildings: 5 },
  { min: 1_001, max: null, chanceBps: 3_300, selectedBuildings: 'all' },
];

export type PlanetSiegeContext = {
  seed: string;
  reportId: string;
  attackerFleetId: string;
  attackerFactionId: CombatFactionId;
  defenderFactionId: CombatFactionId;
  targetOwnerPlanetCount: number;
  eventSequence?: number;
};

export type PlanetSiegeResult = {
  target: SpyTargetState;
  report: BattleSiegeReport;
  planetDestroyed: boolean;
};

function safeInteger(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function clampLevel(value: unknown) {
  return Math.min(10, safeInteger(value));
}

function clampBps(value: number) {
  return Math.min(10_000, Math.max(0, Math.floor(value)));
}

function bytewiseCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function scaledPlanetSiegeValue(level10Value: number, level: number) {
  return Math.floor(Math.max(0, level10Value) * clampLevel(level) / 10);
}

export function getPlanetSiegeDemolitionThreshold(finalPoints: number): PlanetSiegeThreshold {
  return PLANET_SIEGE_DEMOLITION_THRESHOLDS.find((threshold) => (
    finalPoints >= threshold.min && (threshold.max == null || finalPoints <= threshold.max)
  )) ?? PLANET_SIEGE_DEMOLITION_THRESHOLDS[0];
}

function coordinateKey(target: SpyTargetState) {
  return `${target.coordinate.galaxy}:${target.coordinate.system}:${target.coordinate.position}`;
}

function randomSeed(context: PlanetSiegeContext, target: SpyTargetState, domain: string, subject = '') {
  return [
    context.seed,
    context.reportId,
    context.attackerFleetId,
    context.eventSequence ?? 0,
    context.targetOwnerPlanetCount,
    target.id,
    coordinateKey(target),
    domain,
    subject,
  ].join('|');
}

function forceDeathStars(force: BattleForceSnapshot, factionId: CombatFactionId): BattleSiegeDestroyerContribution[] {
  const entity = getFactionCombatEntity(factionId, 'death-star');
  const profile = PLANET_SIEGE_PROFILES[factionId];
  return force.stacks
    .filter((stack) => stack.entityId === 'death-star')
    .map((stack) => {
      const level = clampLevel(stack.level);
      return {
        factionId,
        entityId: 'death-star' as const,
        survivors: safeInteger(stack.countAfter),
        level,
        scaledDemolitionPoints: scaledPlanetSiegeValue(profile.demolitionPointsAtLevel10, level),
        scaledDestructionChanceBps: scaledPlanetSiegeValue(profile.destructionChanceAtLevel10Bps, level),
        baseAttack: safeInteger(entity.combat.attack),
        baseLife: safeInteger(entity.combat.life),
      };
    });
}

function contributionCount(contributions: readonly BattleSiegeDestroyerContribution[]) {
  return contributions.reduce((total, contribution) => total + contribution.survivors, 0);
}

function contributionValue(
  contributions: readonly BattleSiegeDestroyerContribution[],
  selector: (contribution: BattleSiegeDestroyerContribution) => number,
) {
  return contributions.reduce((total, contribution) => total + contribution.survivors * selector(contribution), 0);
}

function defensePopulationAfter(report: BattleReport, factionId: CombatFactionId) {
  const recorded = report.defenderForce.defensePopulationAfter;
  if (typeof recorded === 'number' && Number.isFinite(recorded)) return Math.max(0, Math.floor(recorded));
  return (report.defenderForce.defenses ?? []).reduce((total, stack) => {
    const entity = getFactionCombatEntity(factionId, stack.entityId);
    return total + safeInteger(stack.countAfter) * safeInteger(entity.population);
  }, 0);
}

function activeCommanderLevel(force: BattleForceSnapshot, commanderId: string) {
  if (force.activeCommanderId !== commanderId) return 0;
  return clampLevel(force.activeCommanderLevel
    ?? force.stacks.find((stack) => stack.entityId === commanderId)?.level);
}

function eligibleBuildings(target: SpyTargetState) {
  const locked = new Set(target.endgameLockedBuildings ?? []);
  return Object.entries(target.buildings)
    .filter(([buildingId, value]) => safeInteger(value) > 0 && !locked.has(buildingId))
    .map(([buildingId]) => buildingId)
    .sort(bytewiseCompare);
}

function selectBuildings(
  target: SpyTargetState,
  eligible: readonly string[],
  selectedCount: number | 'all',
  context: PlanetSiegeContext,
) {
  const count = selectedCount === 'all' ? eligible.length : Math.min(selectedCount, eligible.length);
  if (count <= 0) return [];
  const selectionRng = createSeededCombatRng(randomSeed(context, target, 'demolition-selection'));
  const ranked = eligible.map((buildingId) => ({ buildingId, rank: selectionRng.next() }));
  return ranked
    .sort((left, right) => left.rank - right.rank || bytewiseCompare(left.buildingId, right.buildingId))
    .slice(0, count)
    .map(({ buildingId }) => buildingId)
    .sort(bytewiseCompare);
}

function buildingName(buildingId: string) {
  return isBuildingRole(buildingId) ? getBuildingPresentation(buildingId).name : buildingId;
}

function blockedDemolition(
  reason: BattleSiegeBlockedReason,
  rawPoints: number,
  defenseReductionPoints: number,
  finalPoints: number,
  annihilatorBonusBps: number,
  eligibleBuildingCount: number,
  threshold: PlanetSiegeThreshold,
): BattleSiegeDemolition {
  return {
    status: 'blocked',
    blockedReason: reason,
    rawPoints,
    defenseReductionPoints,
    finalPoints,
    baseChanceBps: threshold.chanceBps,
    annihilatorBonusBps,
    eligibleBuildingCount,
    selectedBuildingCount: 0,
    destroyedBuildingLevels: 0,
    rolls: [],
  };
}

function resolveDemolition(
  report: BattleReport,
  target: SpyTargetState,
  attackerDestroyers: readonly BattleSiegeDestroyerContribution[],
  context: PlanetSiegeContext,
  defensePopulation: number,
) {
  const rawPoints = contributionValue(attackerDestroyers, (contribution) => contribution.scaledDemolitionPoints);
  const defenseReductionPoints = Math.floor(defensePopulation / 2_500) * 100;
  const finalPoints = Math.max(0, rawPoints - defenseReductionPoints);
  const threshold = getPlanetSiegeDemolitionThreshold(finalPoints);
  const eligible = eligibleBuildings(target);
  const annihilatorBonusBps = activeCommanderLevel(report.attackerForce, 'annihilator') * 50;

  if (report.winner !== 'attacker' && report.winner !== 'draw') {
    return blockedDemolition('BATTLE_RESULT_INELIGIBLE', rawPoints, defenseReductionPoints, finalPoints, annihilatorBonusBps, eligible.length, threshold);
  }
  if (contributionCount(attackerDestroyers) <= 0) {
    return blockedDemolition('NO_SURVIVING_PLANET_DESTROYER', rawPoints, defenseReductionPoints, finalPoints, annihilatorBonusBps, eligible.length, threshold);
  }
  if (threshold.chanceBps <= 0 || threshold.selectedBuildings === 0 || eligible.length === 0) {
    return {
      status: 'resolved' as const,
      rawPoints,
      defenseReductionPoints,
      finalPoints,
      baseChanceBps: threshold.chanceBps,
      annihilatorBonusBps,
      eligibleBuildingCount: eligible.length,
      selectedBuildingCount: 0,
      destroyedBuildingLevels: 0,
      rolls: [],
    };
  }

  const selected = selectBuildings(target, eligible, threshold.selectedBuildings, context);
  const chanceBps = clampBps(threshold.chanceBps + annihilatorBonusBps);
  const rolls: BattleSiegeBuildingRoll[] = selected.map((buildingId) => {
    const beforeLevel = safeInteger(target.buildings[buildingId]);
    const roll = createSeededCombatRng(randomSeed(context, target, 'demolition-roll', buildingId)).next();
    const success = roll < chanceBps / 10_000;
    const canceledQueueItems = success
      ? (target.buildingQueue ?? []).filter((item) => item.assetRole === buildingId).length
      : 0;
    return {
      buildingId,
      buildingName: buildingName(buildingId),
      beforeLevel,
      afterLevel: success ? Math.max(0, beforeLevel - 1) : beforeLevel,
      chanceBps,
      roll,
      success,
      canceledQueueItems,
    };
  });

  return {
    status: 'resolved' as const,
    rawPoints,
    defenseReductionPoints,
    finalPoints,
    baseChanceBps: threshold.chanceBps,
    annihilatorBonusBps,
    eligibleBuildingCount: eligible.length,
    selectedBuildingCount: selected.length,
    destroyedBuildingLevels: rolls.filter((roll) => roll.success).length,
    rolls,
  };
}

function applyDemolition(target: SpyTargetState, demolition: BattleSiegeDemolition) {
  const successful = demolition.rolls.filter((roll) => roll.success);
  if (successful.length === 0) return target;
  const buildings = { ...target.buildings };
  let buildingQueue = target.buildingQueue;
  for (const roll of successful) {
    buildings[roll.buildingId] = Math.max(0, safeInteger(buildings[roll.buildingId]) - 1);
    if (buildingQueue) buildingQueue = buildingQueue.filter((item) => item.assetRole !== roll.buildingId);
  }
  return {
    ...target,
    buildings,
    ...(buildingQueue ? { buildingQueue } : {}),
  };
}

function resolveDestruction(
  report: BattleReport,
  target: SpyTargetState,
  attackerDestroyers: readonly BattleSiegeDestroyerContribution[],
  defenderDestroyers: readonly BattleSiegeDestroyerContribution[],
  context: PlanetSiegeContext,
  defensePopulation: number,
): BattleSiegeDestruction {
  const rawChanceBps = contributionValue(attackerDestroyers, (contribution) => contribution.scaledDestructionChanceBps);
  const defenseReductionBps = Math.floor(defensePopulation / 1_000) * 100;
  const defenderDestroyerReductionBps = contributionValue(defenderDestroyers, (contribution) => contribution.scaledDestructionChanceBps);
  const poliasReductionBps = activeCommanderLevel(report.defenderForce, 'polias') * 25;
  const finalChanceBps = Math.min(3_000, Math.max(0, rawChanceBps - defenseReductionBps - defenderDestroyerReductionBps - poliasReductionBps));
  const ownerPlanetCount = Math.max(0, safeInteger(context.targetOwnerPlanetCount));

  if (report.winner !== 'attacker') {
    return { status: 'blocked', blockedReason: 'BATTLE_RESULT_INELIGIBLE', rawChanceBps, defenseReductionBps, defenderDestroyerReductionBps, poliasReductionBps, finalChanceBps, success: false, ownerPlanetCount };
  }
  if (contributionCount(attackerDestroyers) <= 0) {
    return { status: 'blocked', blockedReason: 'NO_SURVIVING_PLANET_DESTROYER', rawChanceBps, defenseReductionBps, defenderDestroyerReductionBps, poliasReductionBps, finalChanceBps, success: false, ownerPlanetCount };
  }
  if (ownerPlanetCount <= 1) {
    return { status: 'blocked', blockedReason: 'LAST_COLONY_PROTECTED', rawChanceBps, defenseReductionBps, defenderDestroyerReductionBps, poliasReductionBps, finalChanceBps, success: false, ownerPlanetCount };
  }
  if (finalChanceBps <= 0) {
    return { status: 'blocked', blockedReason: 'ZERO_FINAL_CHANCE', rawChanceBps, defenseReductionBps, defenderDestroyerReductionBps, poliasReductionBps, finalChanceBps, success: false, ownerPlanetCount };
  }

  const roll = createSeededCombatRng(randomSeed(context, target, 'planet-destruction-roll')).next();
  const success = roll < finalChanceBps / 10_000;
  return {
    status: success ? 'destroyed' : 'not-destroyed',
    rawChanceBps,
    defenseReductionBps,
    defenderDestroyerReductionBps,
    poliasReductionBps,
    finalChanceBps,
    roll,
    success,
    ownerPlanetCount,
  };
}

export function resolvePlanetSiege(
  report: BattleReport,
  target: SpyTargetState,
  context: PlanetSiegeContext,
): PlanetSiegeResult {
  const attackerDestroyers = forceDeathStars(report.attackerForce, context.attackerFactionId);
  const defenderDestroyers = forceDeathStars(report.defenderForce, context.defenderFactionId);
  const defensePopulation = defensePopulationAfter(report, context.defenderFactionId);
  const demolition = resolveDemolition(report, target, attackerDestroyers, context, defensePopulation);
  const targetAfterDemolition = applyDemolition(target, demolition);
  const destruction = resolveDestruction(report, target, attackerDestroyers, defenderDestroyers, context, defensePopulation);
  const planetDestroyed = destruction.success;
  const siegeReport: BattleSiegeReport = {
    version: 1,
    targetPlanetId: target.id,
    targetCoordinate: coordinateKey(target),
    attackerDestroyers: [...attackerDestroyers],
    defenderDestroyers: [...defenderDestroyers],
    demolition,
    destruction,
    planetDestroyed,
  };
  return { target: targetAfterDemolition, report: siegeReport, planetDestroyed };
}
