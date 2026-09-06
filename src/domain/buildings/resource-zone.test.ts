import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASTER_RESOURCE_BUILDINGS,
  RESOURCE_BUILDING_ROLES,
  completeResourceBuildingProject,
  createDefaultResourceBuildingLevels,
  evaluateResourceBuildingBuild,
  getResourceBuildingDefinition,
  migrateResourceBuildingLevels,
  migrateResourceBuildingQueue,
  startResourceBuildingProject,
  type ResourceEconomyState,
} from './resource-zone.ts';

const createState = (overrides: Partial<ResourceEconomyState> = {}): ResourceEconomyState => ({
  resources: { metal: 15_880, minerals: 12_712, gas: 6_421, energy: 140 },
  buildings: createDefaultResourceBuildingLevels(),
  queue: null,
  ...overrides,
});

test('Aster resource zone exposes exactly the ten canonical neutral roles', () => {
  assert.equal(ASTER_RESOURCE_BUILDINGS.length, 10);
  assert.deepEqual(ASTER_RESOURCE_BUILDINGS.map((building) => building.assetRole), RESOURCE_BUILDING_ROLES);
  assert.equal(new Set(ASTER_RESOURCE_BUILDINGS.map((building) => building.assetRole)).size, 10);
});

test('UI availability and charged price are derived from the same catalog definition', () => {
  const role = 'metal-production-1' as const;
  const definition = getResourceBuildingDefinition(role);
  const state = createState({
    resources: { ...createState().resources, metal: definition.prototypeCost.metal - 1 },
  });

  const availability = evaluateResourceBuildingBuild(state, role);
  assert.deepEqual(availability.cost, definition.prototypeCost);
  assert.equal(availability.canBuild, false);
  assert.equal(availability.status, 'insufficient-resource');
  assert.equal(availability.reason, 'Недостаточно металла.');
  assert.equal(availability.missing.metal, 1);
});

test('successful queue start deducts resources once and repeated start cannot charge twice', () => {
  const role = 'gas-production-1' as const;
  const initial = createState();
  const first = startResourceBuildingProject(initial, role, 'helion-01', 10_000);
  assert.equal(first.ok, true);
  assert.equal(first.state.resources.metal, initial.resources.metal - getResourceBuildingDefinition(role).prototypeCost.metal);
  assert.equal(first.state.queue?.assetRole, role);

  const second = startResourceBuildingProject(first.state, role, 'helion-01', 11_000);
  assert.equal(second.ok, false);
  assert.equal(second.state.resources.metal, first.state.resources.metal);
  assert.equal(second.state.queue?.assetRole, role);
});

test('busy global queue and one missing resource both block construction', () => {
  const role = 'mineral-production-2' as const;
  const busy = createState({
    queue: {
      kind: 'building',
      assetRole: 'basic-energy',
      planetId: 'helion-01',
      startedAt: 100,
      finishAt: 200,
    },
  });
  assert.equal(evaluateResourceBuildingBuild(busy, role).status, 'queue-busy');

  const missingMetal = createState({ resources: { metal: 0, minerals: 99_999, gas: 99_999, energy: 99_999 } });
  assert.equal(evaluateResourceBuildingBuild(missingMetal, role).status, 'insufficient-resource');
});

test('queue completion raises the queued assetRole rather than the solar building', () => {
  const role = 'hangar' as const;
  const initial = createState({
    queue: {
      kind: 'building',
      assetRole: role,
      planetId: 'helion-01',
      startedAt: 1_000,
      finishAt: 2_000,
    },
  });

  const completed = completeResourceBuildingProject(initial, 2_000);
  assert.equal(completed.completedRole, role);
  assert.equal(completed.state.buildings[role], 1);
  assert.equal(completed.state.buildings['basic-energy'], 0);
  assert.equal(completed.state.resources.energy, initial.resources.energy);
  assert.equal(completed.state.queue, null);
});

test('basic-energy completion applies only its declared +25 energy effect', () => {
  const initial = createState({
    queue: {
      kind: 'building',
      assetRole: 'basic-energy',
      planetId: 'helion-01',
      startedAt: 1_000,
      finishAt: 2_000,
    },
  });
  const completed = completeResourceBuildingProject(initial, 2_000);
  assert.equal(completed.state.buildings['basic-energy'], 1);
  assert.equal(completed.state.resources.energy, initial.resources.energy + 25);
});

test('legacy solarStations save migrates to a valid ten-building state', () => {
  const migrated = migrateResourceBuildingLevels(undefined, 3);
  assert.deepEqual(Object.keys(migrated), [...RESOURCE_BUILDING_ROLES]);
  for (const role of RESOURCE_BUILDING_ROLES) assert.equal(Number.isInteger(migrated[role]), true);
  assert.equal(migrated['basic-energy'], getResourceBuildingDefinition('basic-energy').maxLevel);
});

test('legacy solar-station queue migrates to the neutral basic-energy role', () => {
  const migrated = migrateResourceBuildingQueue({
    id: 'solar-station',
    name: 'Солнечная станция',
    startedAt: 100,
    finishAt: 200,
  }, 'helion-01');
  assert.equal(migrated?.assetRole, 'basic-energy');
  assert.equal(migrated?.planetId, 'helion-01');
});
