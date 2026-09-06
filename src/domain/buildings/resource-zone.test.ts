import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASTER_RESOURCE_BUILDINGS,
  RESOURCE_BUILDING_QUEUE_CAPACITY,
  RESOURCE_BUILDING_ROLES,
  completeResourceBuildingProject,
  createDefaultResourceBuildingLevels,
  evaluateBuildingRequirements,
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
  queue: [],
  scienceLevels: { 1: 6, 2: 5 },
  ...overrides,
});

test('Aster resource zone exposes exactly the ten canonical neutral roles and confirmed max levels', () => {
  assert.equal(ASTER_RESOURCE_BUILDINGS.length, 10);
  assert.deepEqual(ASTER_RESOURCE_BUILDINGS.map((building) => building.assetRole), RESOURCE_BUILDING_ROLES);
  assert.equal(new Set(ASTER_RESOURCE_BUILDINGS.map((building) => building.assetRole)).size, 10);
  for (const role of ['metal-production-1', 'metal-production-2', 'metal-production-3', 'mineral-production-1', 'mineral-production-2', 'gas-production-1', 'gas-production-2', 'basic-energy'] as const) {
    assert.equal(getResourceBuildingDefinition(role).maxLevel, 30);
  }
  assert.equal(getResourceBuildingDefinition('advanced-energy').maxLevel, 20);
  assert.equal(getResourceBuildingDefinition('hangar').maxLevel, 20);
});

test('UI availability and charged price are derived from the same catalog definition', () => {
  const role = 'metal-production-1' as const;
  const definition = getResourceBuildingDefinition(role);
  const state = createState({ resources: { ...createState().resources, metal: definition.prototypeCost.metal - 1 } });
  const availability = evaluateResourceBuildingBuild(state, role);
  assert.deepEqual(availability.cost, definition.prototypeCost);
  assert.equal(availability.canBuild, false);
  assert.equal(availability.status, 'insufficient-resource');
  assert.equal(availability.reason, 'Недостаточно металла.');
  assert.equal(availability.missing.metal, 1);
});

test('metal II and III requirements use current Metal I level and return concrete reasons', () => {
  const levels = createDefaultResourceBuildingLevels();
  levels['metal-production-1'] = 4;
  const state = createState({ buildings: levels });

  const metal2 = evaluateResourceBuildingBuild(state, 'metal-production-2');
  assert.equal(metal2.status, 'requirements-unmet');
  assert.equal(metal2.canBuild, false);
  assert.equal(metal2.reason, 'Требуется: Металлическая шахта I — ур. 10; сейчас 4.');

  levels['metal-production-1'] = 10;
  assert.equal(evaluateResourceBuildingBuild(createState({ buildings: levels }), 'metal-production-2').canBuild, true);
  assert.equal(evaluateResourceBuildingBuild(createState({ buildings: levels }), 'metal-production-3').canBuild, false);

  levels['metal-production-1'] = 15;
  assert.equal(evaluateResourceBuildingBuild(createState({ buildings: levels }), 'metal-production-3').canBuild, true);
});

test('nuclear reactor requirements use building levels and existing science ids', () => {
  const levels = createDefaultResourceBuildingLevels();
  levels['basic-energy'] = 9;
  const locked = createState({ buildings: levels, scienceLevels: { 1: 4, 2: 5 } });
  const requirements = evaluateBuildingRequirements(locked, 'advanced-energy');
  assert.deepEqual(requirements.map((item) => [item.label, item.requiredLevel, item.currentLevel, item.met]), [
    ['Солнечная электростанция', 10, 9, false],
    ['Химия', 5, 5, true],
    ['Физика', 5, 4, false],
  ]);
  assert.equal(evaluateResourceBuildingBuild(locked, 'advanced-energy').status, 'requirements-unmet');

  levels['basic-energy'] = 10;
  assert.equal(evaluateResourceBuildingBuild(createState({ buildings: levels, scienceLevels: { 1: 5, 2: 5 } }), 'advanced-energy').canBuild, true);
});

test('adding projects deducts resources once per accepted slot and stores three FIFO slots', () => {
  let state = createState();
  const initialMetal = state.resources.metal;
  const roles = ['gas-production-1', 'mineral-production-1', 'hangar'] as const;

  roles.forEach((role, index) => {
    const transition = startResourceBuildingProject(state, role, 'helion-01', 10_000 + index * 100);
    assert.equal(transition.ok, true);
    state = transition.state;
  });

  assert.equal(state.queue.length, RESOURCE_BUILDING_QUEUE_CAPACITY);
  assert.deepEqual(state.queue.map((item) => item.assetRole), roles);
  assert.equal(state.resources.metal, initialMetal - 3 * 1200);
  assert.equal(state.queue[1].startedAt, state.queue[0].finishAt);
  assert.equal(state.queue[2].startedAt, state.queue[1].finishAt);
});

test('fourth project is rejected when all three slots are occupied and does not charge resources', () => {
  let state = createState();
  for (const role of ['gas-production-1', 'mineral-production-1', 'hangar'] as const) {
    state = startResourceBuildingProject(state, role, 'helion-01', 10_000).state;
  }
  const metalBefore = state.resources.metal;
  const fourth = startResourceBuildingProject(state, 'gas-production-2', 'helion-01', 11_000);
  assert.equal(fourth.ok, false);
  assert.equal(fourth.reason, 'Очередь заполнена.');
  assert.equal(fourth.state.queue.length, 3);
  assert.equal(fourth.state.resources.metal, metalBefore);
});

test('unmet requirements prevent enqueue and resource deduction', () => {
  const state = createState();
  const transition = startResourceBuildingProject(state, 'metal-production-2', 'helion-01', 10_000);
  assert.equal(transition.ok, false);
  assert.equal(transition.state.queue.length, 0);
  assert.equal(transition.state.resources.metal, state.resources.metal);
  assert.match(transition.reason ?? '', /Металлическая шахта I/);
});

test('FIFO completion removes the first project and automatically exposes the second as active', () => {
  let state = createState();
  for (const role of ['gas-production-1', 'mineral-production-1', 'hangar'] as const) {
    state = startResourceBuildingProject(state, role, 'helion-01', 1_000).state;
  }
  const first = state.queue[0];
  const second = state.queue[1];
  const completed = completeResourceBuildingProject(state, first.finishAt);
  assert.equal(completed.completedRole, 'gas-production-1');
  assert.equal(completed.state.buildings['gas-production-1'], 1);
  assert.equal(completed.state.queue.length, 2);
  assert.equal(completed.state.queue[0].assetRole, 'mineral-production-1');
  assert.equal(completed.state.queue[0].startedAt, second.startedAt);
});

test('queue completion raises the queued assetRole rather than the solar building', () => {
  const state = startResourceBuildingProject(createState(), 'hangar', 'helion-01', 1_000).state;
  const completed = completeResourceBuildingProject(state, state.queue[0].finishAt);
  assert.equal(completed.completedRole, 'hangar');
  assert.equal(completed.state.buildings.hangar, 1);
  assert.equal(completed.state.buildings['basic-energy'], 0);
  assert.equal(completed.state.resources.energy, state.resources.energy);
  assert.equal(completed.state.queue.length, 0);
});

test('basic-energy completion applies only its declared +25 energy effect', () => {
  const state = startResourceBuildingProject(createState(), 'basic-energy', 'helion-01', 1_000).state;
  const completed = completeResourceBuildingProject(state, state.queue[0].finishAt);
  assert.equal(completed.state.buildings['basic-energy'], 1);
  assert.equal(completed.state.resources.energy, state.resources.energy + 25);
});

test('legacy solarStations save migrates to a valid ten-building state without old level-1 clamp', () => {
  const migrated = migrateResourceBuildingLevels(undefined, 3);
  assert.deepEqual(Object.keys(migrated), [...RESOURCE_BUILDING_ROLES]);
  for (const role of RESOURCE_BUILDING_ROLES) assert.equal(Number.isInteger(migrated[role]), true);
  assert.equal(migrated['basic-energy'], 3);
});

test('legacy single solar-station queue migrates into first slot of new queue', () => {
  const buildings = createDefaultResourceBuildingLevels();
  const migrated = migrateResourceBuildingQueue({
    id: 'solar-station',
    name: 'Солнечная станция',
    startedAt: 100,
    finishAt: 200,
  }, 'helion-01', buildings);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].assetRole, 'basic-energy');
  assert.equal(migrated[0].planetId, 'helion-01');
  assert.equal(migrated[0].targetLevel, 1);
});
