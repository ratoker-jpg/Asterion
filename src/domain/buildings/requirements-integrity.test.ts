import assert from 'node:assert/strict';
import test from 'node:test';

import { BUILDING_ROLES, type BuildingFaction } from './balance-v1.ts';
import {
  completeBuildingProject,
  createDefaultBuildingLevels,
  evaluateBuildingBuild,
  getBuildingsForZone,
  startBuildingProject,
  type BuildingEconomyState,
} from './resource-zone.ts';
import { COMMANDER_COMBAT_CATALOG, type CatalogEntity } from '../combat/catalog.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import { evaluateProductionRequirements, type ProductionRequirementContext } from '../fleet/requirements.ts';
import {
  createDefaultFleetProductionState,
  createEmptyDefenseState,
  enqueueFleetProduction,
  reconcileFleetProductionState,
  type FleetProductionContext,
} from '../fleet/production.ts';
import { createEmptyFleetState } from '../fleet/runtime.ts';
import { SCIENCE_CATALOG } from '../science/catalog.ts';
import { createDefaultScienceLevels, type ScienceLevels } from '../science/runtime.ts';
import type { ScienceId } from '../science/types.ts';

const FACTIONS: readonly CombatFactionId[] = ['aegis', 'synod', 'veyra'];
const ZONES = ['resource', 'industry', 'military'] as const;
const SCIENCE_IDS = new Set<number>(SCIENCE_CATALOG.map((science) => science.id));
const scienceByName = new Map(SCIENCE_CATALOG.map((science) => [science.name, science.id]));
const noScience = createDefaultScienceLevels();

function productionEntities(factionId: CombatFactionId): readonly CatalogEntity[] {
  return [...getFactionShipCatalog(factionId), ...getFactionDefenseCatalog(factionId), ...COMMANDER_COMBAT_CATALOG];
}

function requirementContext(factionId: CombatFactionId, overrides: Partial<ProductionRequirementContext> = {}): ProductionRequirementContext {
  return {
    scienceLevels: noScience,
    shipyardLevel: 0,
    hangarLevel: 0,
    advancedFactoryLevel: 0,
    factionId,
    fleet: { ships: {}, commanders: {} },
    ...overrides,
  };
}

function levels(entries: Record<number, number>): ScienceLevels {
  return { ...noScience, ...entries } as ScienceLevels;
}

test('guard: no requirement of any unit or building of any race names a missing science, building or ship', () => {
  for (const factionId of FACTIONS) {
    for (const entity of productionEntities(factionId)) {
      const evaluation = evaluateProductionRequirements(entity, requirementContext(factionId));
      const unresolved = evaluation.requirements.filter((requirement) => requirement.kind === 'unresolved');
      assert.deepEqual(unresolved.map((requirement) => requirement.source), [], `${factionId} ${entity.kind} ${entity.id}`);
      // The shipyard level in the text and the typed field must agree.
      for (const source of entity.construction.requirements) {
        const shipyard = source.match(/^Верфь · уровень (\d+)$/u);
        if (shipyard) assert.equal(Number(shipyard[1]), entity.construction.requiredShipyardLevel, `${factionId} ${entity.id}: ${source}`);
      }
      for (const requirement of entity.construction.scienceRequirements ?? []) {
        assert.ok(SCIENCE_IDS.has(requirement.scienceId), `${factionId} ${entity.id}: science ${requirement.scienceId}`);
      }
    }
    for (const zone of ZONES) {
      for (const building of getBuildingsForZone(zone, factionId as BuildingFaction)) {
        for (const requirement of building.requirements) {
          if (requirement.kind === 'building-level') {
            assert.ok((BUILDING_ROLES as readonly string[]).includes(requirement.assetRole), `${factionId} ${building.assetRole} → ${requirement.assetRole}`);
          } else {
            assert.ok(SCIENCE_IDS.has(requirement.scienceId), `${factionId} ${building.assetRole} → science ${requirement.scienceId}`);
          }
        }
      }
    }
  }
  for (const science of SCIENCE_CATALOG) {
    for (const prerequisite of science.prerequisites) {
      assert.ok(SCIENCE_IDS.has(prerequisite.scienceId), `${science.name} → science ${prerequisite.scienceId}`);
    }
  }
});

test('the guard catches a requirement naming a science that does not exist', () => {
  const [tower] = getFactionDefenseCatalog('aegis').filter((entity) => entity.id === 'tower-shield');
  const broken = { ...tower!, construction: { ...tower!.construction, requirements: ['Верфь · уровень 5', 'Щитовые системы · уровень 7'] } };
  const evaluation = evaluateProductionRequirements(broken, requirementContext('aegis', { shipyardLevel: 99, scienceLevels: levels({ 7: 99 }) }));
  assert.equal(evaluation.met, false);
  assert.equal(evaluation.missing[0]?.kind, 'unresolved');
});

function economy(buildings: Partial<BuildingEconomyState['buildings']>, queue: BuildingEconomyState['queue'] = []): BuildingEconomyState {
  return {
    resources: { metal: 1e12, minerals: 1e12, gas: 1e12, energy: 1e12 },
    buildings: { ...createDefaultBuildingLevels(), ...buildings },
    queue,
    scienceLevels: noScience,
  };
}

test('Mineral mine II and Gas well II need level 10 of the first mine, for every race', () => {
  for (const factionId of FACTIONS) {
    for (const [second, first] of [['mineral-production-2', 'mineral-production-1'], ['gas-production-2', 'gas-production-1']] as const) {
      const definition = getBuildingsForZone('resource', factionId).find((item) => item.assetRole === second)!;
      assert.deepEqual(definition.requirements, [{ kind: 'building-level', assetRole: first, level: 10 }], `${factionId} ${second}`);
      const blocked = evaluateBuildingBuild(economy({ [first]: 9, [second]: 0 }), second);
      assert.equal(blocked.status, 'requirements-unmet');
      assert.equal(blocked.canBuild, false);
      assert.match(blocked.reason ?? '', /ур\. 10; сейчас 9/);
      assert.equal(evaluateBuildingBuild(economy({ [first]: 10, [second]: 0 }), second).canBuild, true);
      // The authoritative start is refused too, not only the card.
      assert.equal(startBuildingProject(economy({ [first]: 9, [second]: 0 }), second, 'helion-01', 0).ok, false);
    }
  }
  // The hangar stays free of requirements (owner decision).
  assert.deepEqual(getBuildingsForZone('resource').find((item) => item.assetRole === 'hangar')!.requirements, []);
});

test('older saves keep what was built and finish what was queued; the next level waits for the requirement', () => {
  const queued = economy({ 'mineral-production-1': 3, 'mineral-production-2': 4 }, [{
    kind: 'building', id: 'legacy-mineral-2', assetRole: 'mineral-production-2', planetId: 'helion-01',
    enqueuedAt: 0, startedAt: 0, finishAt: 100, targetLevel: 5, durationMs: 100,
  }]);
  const completed = completeBuildingProject(queued, 100);
  assert.equal(completed.completedRole, 'mineral-production-2');
  assert.equal(completed.state.buildings['mineral-production-2'], 5, 'a queued level from before the rule completes');
  const next = evaluateBuildingBuild(completed.state, 'mineral-production-2');
  assert.equal(next.currentLevel, 5);
  assert.equal(next.status, 'requirements-unmet');
});

const DEFENSE_TABLE: Record<string, { shipyard: number; science: Record<number, number> }> = {
  'ballistic-turret': { shipyard: 2, science: {} },
  'laser-turret': { shipyard: 3, science: { 1: 2 } },
  'ion-turret': { shipyard: 5, science: { 1: 5 } },
  'plasma-turret': { shipyard: 7, science: { 12: 3 } },
  'laser-ion-battery': { shipyard: 8, science: { 11: 5, 22: 5 } },
  'plasma-laser-battery': { shipyard: 10, science: { 12: 5, 23: 5 } },
  'ion-plasma-battery': { shipyard: 12, science: { 11: 10, 12: 10, 22: 5 } },
  'tower-shield': { shipyard: 5, science: { 7: 6 } },
  'planetary-shield': { shipyard: 8, science: { 7: 9 } },
};

test('defense follows the Nemexia table for every race; both shields are buildable again', () => {
  assert.equal(scienceByName.get('Физика'), 1);
  assert.equal(scienceByName.get('Броня кораблей'), 7);
  for (const factionId of FACTIONS) {
    const defenses = getFactionDefenseCatalog(factionId);
    assert.deepEqual(defenses.map((entity) => entity.id).sort(), Object.keys(DEFENSE_TABLE).sort());
    for (const entity of defenses) {
      const row = DEFENSE_TABLE[entity.id]!;
      const exact = evaluateProductionRequirements(entity, requirementContext(factionId, { shipyardLevel: row.shipyard, scienceLevels: levels(row.science) }));
      assert.equal(exact.met, true, `${factionId} ${entity.id} at exactly its requirements`);
      assert.deepEqual(
        exact.requirements.filter((requirement) => requirement.kind === 'science').map((requirement) => [requirement.scienceId, requirement.requiredLevel]).sort(),
        Object.entries(row.science).map(([id, level]) => [Number(id) as ScienceId, level]).sort(),
        `${factionId} ${entity.id} sciences`,
      );
      assert.equal(evaluateProductionRequirements(entity, requirementContext(factionId, { shipyardLevel: row.shipyard - 1, scienceLevels: levels(row.science) })).met, false);
      for (const [scienceId, level] of Object.entries(row.science)) {
        const lower = evaluateProductionRequirements(entity, requirementContext(factionId, {
          shipyardLevel: row.shipyard, scienceLevels: levels({ ...row.science, [scienceId]: level - 1 }),
        }));
        assert.equal(lower.met, false, `${factionId} ${entity.id} with science ${scienceId} one level short`);
      }
    }
  }
});

test('the Reanimator needs only Shipyard 10', () => {
  const reanimator = COMMANDER_COMBAT_CATALOG.find((entity) => entity.id === 'reanimator')!;
  assert.deepEqual(reanimator.construction.requirements, ['Верфь · уровень 10']);
  assert.equal(evaluateProductionRequirements(reanimator, requirementContext('veyra', { shipyardLevel: 10 })).met, true);
  assert.equal(evaluateProductionRequirements(reanimator, requirementContext('veyra', { shipyardLevel: 9 })).met, false);
});

function productionContext(overrides: Partial<FleetProductionContext> = {}): FleetProductionContext {
  return {
    factionId: 'aegis',
    state: createDefaultFleetProductionState(),
    fleet: createEmptyFleetState(),
    defense: createEmptyDefenseState(),
    wallet: { metal: 1e12, minerals: 1e12, gas: 1e12 },
    capacities: { metal: 1e12, minerals: 1e12, gas: 1e12 },
    hangarLevel: 40,
    shipyardLevel: 20,
    advancedFactoryLevel: 0,
    scienceLevels: levels({ 1: 10, 7: 10, 11: 10, 12: 10, 22: 10, 23: 10 }),
    now: 0,
    mode: 'production',
    testTimeScale: 1,
    ...overrides,
  };
}

test('production queues: new orders meet the new table, an order already queued still completes', () => {
  // Under the old table the Ion turret needed Shipyard 3 and Ion science 2.
  const oldRules = productionContext({ shipyardLevel: 3, scienceLevels: levels({ 11: 2 }) });
  const refused = enqueueFleetProduction(oldRules, 'defense', 'ion-turret', 1, 'ion-new-order');
  assert.equal(refused.ok, false);
  assert.match(refused.reason ?? '', /верфь уровня 5/);

  const shield = enqueueFleetProduction(productionContext({ shipyardLevel: 5, scienceLevels: levels({ 7: 6 }) }), 'defense', 'tower-shield', 1, 'shield-order');
  assert.equal(shield.ok, true, shield.reason ?? '');
  const reanimator = enqueueFleetProduction(productionContext({ shipyardLevel: 10, scienceLevels: noScience }), 'commanders', 'reanimator', 1, 'reanimator-order');
  assert.equal(reanimator.ok, true, reanimator.reason ?? '');

  // A save that already holds a queued Ion turret: the queue does not re-check requirements.
  const queued = enqueueFleetProduction(productionContext(), 'defense', 'ion-turret', 2, 'legacy-ion-order');
  assert.equal(queued.ok, true);
  const finished = reconcileFleetProductionState(queued.state, queued.fleet, queued.defense, 'aegis', 1e12);
  assert.equal(finished.defense.defenses['ion-turret'], 2);
});
