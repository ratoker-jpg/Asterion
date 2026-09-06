import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASTER_BUILDINGS,
  ASTER_INDUSTRY_BUILDINGS,
  ASTER_MILITARY_BUILDINGS,
  ASTER_RESOURCE_BUILDINGS,
  BUILDING_QUEUE_CAPACITY,
  BUILDING_ROLES,
  INDUSTRY_BUILDING_ROLES,
  MILITARY_BUILDING_ROLES,
  RESOURCE_BUILDING_ROLES,
  completeBuildingProject,
  createDefaultBuildingLevels,
  evaluateBuildingBuild,
  evaluateBuildingRequirements,
  getBuildingDefinition,
  migrateBuildingLevels,
  migrateBuildingQueue,
  startBuildingProject,
  type BuildingEconomyState,
} from './resource-zone.ts';

const createState = (overrides: Partial<BuildingEconomyState> = {}): BuildingEconomyState => ({
  resources: { metal: 15_880, minerals: 12_712, gas: 6_421, energy: 140 },
  buildings: createDefaultBuildingLevels(),
  queue: [],
  scienceLevels: { 1: 6, 2: 5 },
  ...overrides,
});

test('Aster ordinary catalog exposes exactly 10 resource, 7 industry and 5 military roles without duplicates', () => {
  assert.equal(ASTER_RESOURCE_BUILDINGS.length, 10);
  assert.equal(ASTER_INDUSTRY_BUILDINGS.length, 7);
  assert.equal(ASTER_MILITARY_BUILDINGS.length, 5);
  assert.equal(ASTER_BUILDINGS.length, 22);
  assert.deepEqual(ASTER_RESOURCE_BUILDINGS.map((item) => item.assetRole), RESOURCE_BUILDING_ROLES);
  assert.deepEqual(ASTER_INDUSTRY_BUILDINGS.map((item) => item.assetRole), INDUSTRY_BUILDING_ROLES);
  assert.deepEqual(ASTER_MILITARY_BUILDINGS.map((item) => item.assetRole), MILITARY_BUILDING_ROLES);
  assert.deepEqual(ASTER_BUILDINGS.map((item) => item.assetRole), BUILDING_ROLES);
  assert.equal(new Set(BUILDING_ROLES).size, 22);
});

test('all twelve new roles match canonical names, zones and real Aegis PNG paths', () => {
  const expected = {
    construction: ['Фабрика', 'industry', 'building.aegis.construction.png'],
    'advanced-factory': ['Промышленный комплекс', 'industry', 'building.aegis.advanced-factory.png'],
    'metal-storage': ['Склад металла', 'industry', 'building.aegis.metal-storage.png'],
    'mineral-storage': ['Склад минералов', 'industry', 'building.aegis.mineral-storage.png'],
    'gas-storage': ['Газовое хранилище', 'industry', 'building.aegis.gas-storage.png'],
    recycling: ['Перерабатывающий центр', 'industry', 'building.aegis.recycling.png'],
    'trade-center': ['Торговый центр', 'industry', 'building.aegis.trade-center.png'],
    shipyard: ['Верфь', 'military', 'building.aegis.shipyard.png'],
    research: ['Лаборатория', 'military', 'building.aegis.research.png'],
    spaceport: ['Космодром', 'military', 'building.aegis.spaceport.png'],
    'planetary-government': ['Палата управления', 'military', 'building.aegis.planetary-government.png'],
    bank: ['Банк', 'military', 'building.aegis.bank.png'],
  } as const;

  for (const [role, [name, zone, fileName]] of Object.entries(expected)) {
    const item = getBuildingDefinition(role as keyof typeof expected);
    assert.equal(item.name, name);
    assert.equal(item.zone, zone);
    assert.equal(item.art.includes(fileName.replace('.png', '')), true);
    assert.equal(item.prototypeBalance, true);
    assert.deepEqual(item.requirements, []);
  }
});

test('confirmed resource max levels and requirements are preserved unchanged', () => {
  for (const role of ['metal-production-1', 'metal-production-2', 'metal-production-3', 'mineral-production-1', 'mineral-production-2', 'gas-production-1', 'gas-production-2', 'basic-energy'] as const) {
    assert.equal(getBuildingDefinition(role).maxLevel, 30);
  }
  assert.equal(getBuildingDefinition('advanced-energy').maxLevel, 20);
  assert.equal(getBuildingDefinition('hangar').maxLevel, 20);

  const levels = createDefaultBuildingLevels();
  levels['metal-production-1'] = 4;
  const metal2 = evaluateBuildingBuild(createState({ buildings: levels }), 'metal-production-2');
  assert.equal(metal2.status, 'requirements-unmet');
  assert.equal(metal2.reason, 'Требуется: Металлическая шахта I — ур. 10; сейчас 4.');

  levels['basic-energy'] = 9;
  const reactorRequirements = evaluateBuildingRequirements(
    createState({ buildings: levels, scienceLevels: { 1: 4, 2: 5 } }),
    'advanced-energy',
  );
  assert.deepEqual(reactorRequirements.map((item) => [item.label, item.requiredLevel, item.currentLevel, item.met]), [
    ['Солнечная электростанция', 10, 9, false],
    ['Химия', 5, 5, true],
    ['Физика', 5, 4, false],
  ]);
});

test('one shared three-slot FIFO queue accepts projects from all three zones and charges once per slot', () => {
  let state = createState();
  const initialMetal = state.resources.metal;
  const roles = ['gas-production-1', 'construction', 'shipyard'] as const;

  roles.forEach((role, index) => {
    const transition = startBuildingProject(state, role, 'helion-01', 10_000 + index * 100);
    assert.equal(transition.ok, true);
    state = transition.state;
  });

  assert.equal(state.queue.length, BUILDING_QUEUE_CAPACITY);
  assert.deepEqual(state.queue.map((item) => item.assetRole), roles);
  assert.equal(state.resources.metal, initialMetal - 3 * 1200);
  assert.equal(state.queue[1].startedAt, state.queue[0].finishAt);
  assert.equal(state.queue[2].startedAt, state.queue[1].finishAt);

  const fourth = startBuildingProject(state, 'bank', 'helion-01', 11_000);
  assert.equal(fourth.ok, false);
  assert.equal(fourth.reason, 'Очередь заполнена.');
  assert.equal(fourth.state.resources.metal, state.resources.metal);
});

test('industrial and military completion raise only their queued building levels', () => {
  let industry = startBuildingProject(createState(), 'construction', 'helion-01', 1_000).state;
  industry = completeBuildingProject(industry, industry.queue[0].finishAt).state;
  assert.equal(industry.buildings.construction, 1);
  assert.equal(industry.buildings.shipyard, 0);
  assert.equal(industry.buildings['basic-energy'], 0);

  let military = startBuildingProject(createState(), 'shipyard', 'helion-01', 1_000).state;
  military = completeBuildingProject(military, military.queue[0].finishAt).state;
  assert.equal(military.buildings.shipyard, 1);
  assert.equal(military.buildings.construction, 0);
  assert.equal(military.buildings['basic-energy'], 0);
});

test('FIFO completion exposes a project from another zone as the next active item', () => {
  let state = createState();
  for (const role of ['construction', 'shipyard', 'gas-production-1'] as const) {
    state = startBuildingProject(state, role, 'helion-01', 1_000).state;
  }
  const first = state.queue[0];
  const completed = completeBuildingProject(state, first.finishAt);
  assert.equal(completed.completedRole, 'construction');
  assert.equal(completed.state.buildings.construction, 1);
  assert.equal(completed.state.queue[0].assetRole, 'shipyard');
});

test('new-zone projects use the same catalog values in availability and charging', () => {
  const item = getBuildingDefinition('trade-center');
  const state = createState({ resources: { ...createState().resources, metal: item.prototypeCost.metal - 1 } });
  const availability = evaluateBuildingBuild(state, 'trade-center');
  assert.deepEqual(availability.cost, item.prototypeCost);
  assert.equal(availability.status, 'insufficient-resource');
  assert.equal(availability.missing.metal, 1);
});

test('legacy resource save normalizes to all 22 roles and initializes new zones to zero', () => {
  const migrated = migrateBuildingLevels({
    'metal-production-1': 4,
    'basic-energy': 2,
  }, 3);
  assert.deepEqual(Object.keys(migrated), [...BUILDING_ROLES]);
  assert.equal(migrated['metal-production-1'], 4);
  assert.equal(migrated['basic-energy'], 3);
  for (const role of [...INDUSTRY_BUILDING_ROLES, ...MILITARY_BUILDING_ROLES]) {
    assert.equal(migrated[role], 0);
  }
});

test('legacy single queue, existing three-slot queue and unknown items migrate safely while preserving valid order', () => {
  const buildings = createDefaultBuildingLevels();
  const legacy = migrateBuildingQueue({
    id: 'solar-station',
    startedAt: 100,
    finishAt: 200,
  }, 'helion-01', buildings);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].assetRole, 'basic-energy');

  const mixed = migrateBuildingQueue([
    { assetRole: 'construction', startedAt: 100, finishAt: 200 },
    { assetRole: 'unknown-building', startedAt: 200, finishAt: 300 },
    { assetRole: 'shipyard', startedAt: 300, finishAt: 400 },
    { assetRole: 'gas-production-1', startedAt: 400, finishAt: 500 },
  ], 'helion-01', buildings);
  assert.deepEqual(mixed.map((item) => item.assetRole), ['construction', 'shipyard', 'gas-production-1']);
  assert.equal(mixed[1].startedAt, mixed[0].finishAt);
  assert.equal(mixed[2].startedAt, mixed[1].finishAt);
});

test('unmet confirmed resource requirements still prevent enqueue and resource deduction', () => {
  const state = createState();
  const transition = startBuildingProject(state, 'metal-production-2', 'helion-01', 10_000);
  assert.equal(transition.ok, false);
  assert.equal(transition.state.queue.length, 0);
  assert.equal(transition.state.resources.metal, state.resources.metal);
  assert.match(transition.reason ?? '', /Металлическая шахта I/);
});

test('basic-energy completion keeps its existing +25 energy effect and new zones add no invented effects', () => {
  let resource = startBuildingProject(createState(), 'basic-energy', 'helion-01', 1_000).state;
  const resourceBefore = resource.resources.energy;
  resource = completeBuildingProject(resource, resource.queue[0].finishAt).state;
  assert.equal(resource.resources.energy, resourceBefore + 25);

  let industry = startBuildingProject(createState(), 'construction', 'helion-01', 1_000).state;
  const industryBefore = industry.resources.energy;
  industry = completeBuildingProject(industry, industry.queue[0].finishAt).state;
  assert.equal(industry.resources.energy, industryBefore);
});
