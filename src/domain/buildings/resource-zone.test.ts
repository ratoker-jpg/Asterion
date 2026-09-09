import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASTER_BUILDINGS,
  ASTER_INDUSTRY_BUILDINGS,
  ASTER_MILITARY_BUILDINGS,
  ASTER_RESOURCE_BUILDINGS,
  BUILDING_QUEUE_CAPACITY,
  BUILDING_CANCEL_REFUND_PERCENT,
  BUILDING_ROLES,
  INDUSTRY_BUILDING_ROLES,
  MILITARY_BUILDING_ROLES,
  RESOURCE_BUILDING_ROLES,
  completeBuildingProject,
  createCanonicalStartingBuildingLevels,
  createDefaultBuildingLevels,
  destroyBuildingLevel,
  evaluateBuildingBuild,
  evaluateBuildingRequirements,
  getBuildingDefinition,
  getBuildingConstructionCost,
  migrateBuildingLevels,
  migrateBuildingQueue,
  cancelBuildingProject,
  startBuildingProject,
  type BuildingEconomyState,
} from './resource-zone.ts';

const createState = (overrides: Partial<BuildingEconomyState> = {}): BuildingEconomyState => ({
  resources: { metal: 10_000_000, minerals: 10_000_000, gas: 10_000_000, energy: 10_000_000 },
  buildings: createDefaultBuildingLevels(),
  queue: [],
  scienceLevels: { 1: 6, 2: 5 },
  ...overrides,
});

test('new players receive the canonical Phase 1 building levels', () => {
  const levels = createCanonicalStartingBuildingLevels();
  assert.deepEqual(
    Object.fromEntries(BUILDING_ROLES.map((role) => [role, levels[role]])),
    {
      'metal-production-1': 1,
      'mineral-production-1': 1,
      'gas-production-1': 1,
      'basic-energy': 1,
      hangar: 1,
      ...Object.fromEntries(BUILDING_ROLES
        .filter((role) => !['metal-production-1', 'mineral-production-1', 'gas-production-1', 'basic-energy', 'hangar'].includes(role))
        .map((role) => [role, 0])),
    },
  );
});

test('Aster ordinary catalog exposes exactly 10 resource, 7 industry and 4 military roles without duplicates', () => {
  assert.equal(ASTER_RESOURCE_BUILDINGS.length, 10);
  assert.equal(ASTER_INDUSTRY_BUILDINGS.length, 7);
  assert.equal(ASTER_MILITARY_BUILDINGS.length, 4);
  assert.equal(ASTER_BUILDINGS.length, 21);
  assert.deepEqual(ASTER_RESOURCE_BUILDINGS.map((item) => item.assetRole), RESOURCE_BUILDING_ROLES);
  assert.deepEqual(ASTER_INDUSTRY_BUILDINGS.map((item) => item.assetRole), INDUSTRY_BUILDING_ROLES);
  assert.deepEqual(ASTER_MILITARY_BUILDINGS.map((item) => item.assetRole), MILITARY_BUILDING_ROLES);
  assert.deepEqual(ASTER_BUILDINGS.map((item) => item.assetRole), BUILDING_ROLES);
  assert.equal(new Set(BUILDING_ROLES).size, 21);
});

test('all eleven new roles match canonical names, zones and real Aegis PNG paths', () => {
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
  } as const;

  for (const [role, [name, zone, fileName]] of Object.entries(expected)) {
    const item = getBuildingDefinition(role as keyof typeof expected);
    assert.equal(item.name, name);
    assert.equal(item.zone, zone);
    assert.equal(item.art.includes(fileName.replace('.png', '')), true);
    assert.equal(item.prototypeBalance, true);
  }
});

test('confirmed resource max levels and requirements are preserved unchanged', () => {
  for (const role of ['metal-production-1', 'metal-production-2', 'metal-production-3', 'mineral-production-1', 'mineral-production-2', 'gas-production-1', 'gas-production-2', 'basic-energy'] as const) {
    assert.equal(getBuildingDefinition(role).maxLevel, 30);
  }
  assert.equal(getBuildingDefinition('advanced-energy').maxLevel, 20);
  assert.equal(getBuildingDefinition('hangar').maxLevel, 20);

  assert.deepEqual(getBuildingDefinition('metal-production-2').requirements, [
    { kind: 'building-level', assetRole: 'metal-production-1', level: 10 },
  ]);
  assert.deepEqual(getBuildingDefinition('metal-production-3').requirements, [
    { kind: 'building-level', assetRole: 'metal-production-1', level: 15 },
  ]);
  assert.deepEqual(getBuildingDefinition('advanced-energy').requirements, [
    { kind: 'building-level', assetRole: 'basic-energy', level: 10 },
    { kind: 'science-level', scienceId: 2, level: 5 },
    { kind: 'science-level', scienceId: 1, level: 5 },
  ]);

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

test('advanced-factory requires construction level 10', () => {
  assert.deepEqual(getBuildingDefinition('advanced-factory').requirements, [
    { kind: 'building-level', assetRole: 'construction', level: 10 },
  ]);
  const levels = createDefaultBuildingLevels();
  levels.construction = 9;
  const blocked = evaluateBuildingBuild(createState({ buildings: levels }), 'advanced-factory');
  assert.equal(blocked.status, 'requirements-unmet');
  assert.equal(blocked.canBuild, false);
  assert.match(blocked.reason ?? '', /Фабрика — ур\. 10; сейчас 9/);
  levels.construction = 10;
  assert.equal(evaluateBuildingBuild(createState({ buildings: levels }), 'advanced-factory').status, 'available');
});

test('metal-storage requires metal-production-1 level 1', () => {
  assert.deepEqual(getBuildingDefinition('metal-storage').requirements, [
    { kind: 'building-level', assetRole: 'metal-production-1', level: 1 },
  ]);
  const levels = createDefaultBuildingLevels();
  assert.equal(evaluateBuildingBuild(createState({ buildings: levels }), 'metal-storage').status, 'requirements-unmet');
  levels['metal-production-1'] = 1;
  assert.equal(evaluateBuildingBuild(createState({ buildings: levels }), 'metal-storage').status, 'available');
});

test('mineral-storage requires mineral-production-1 level 1', () => {
  assert.deepEqual(getBuildingDefinition('mineral-storage').requirements, [
    { kind: 'building-level', assetRole: 'mineral-production-1', level: 1 },
  ]);
  const levels = createDefaultBuildingLevels();
  assert.equal(evaluateBuildingBuild(createState({ buildings: levels }), 'mineral-storage').status, 'requirements-unmet');
  levels['mineral-production-1'] = 1;
  assert.equal(evaluateBuildingBuild(createState({ buildings: levels }), 'mineral-storage').status, 'available');
});

test('gas-storage requires gas-production-1 level 1', () => {
  assert.deepEqual(getBuildingDefinition('gas-storage').requirements, [
    { kind: 'building-level', assetRole: 'gas-production-1', level: 1 },
  ]);
  const levels = createDefaultBuildingLevels();
  assert.equal(evaluateBuildingBuild(createState({ buildings: levels }), 'gas-storage').status, 'requirements-unmet');
  levels['gas-production-1'] = 1;
  assert.equal(evaluateBuildingBuild(createState({ buildings: levels }), 'gas-storage').status, 'available');
});

test('recycling requires shipyard level 5 and Chemistry ScienceId 2 level 6', () => {
  assert.deepEqual(getBuildingDefinition('recycling').requirements, [
    { kind: 'building-level', assetRole: 'shipyard', level: 5 },
    { kind: 'science-level', scienceId: 2, level: 6 },
  ]);
  const levels = createDefaultBuildingLevels();
  levels.shipyard = 5;
  const chemistryBlocked = evaluateBuildingBuild(createState({ buildings: levels, scienceLevels: { 2: 5 } }), 'recycling');
  assert.equal(chemistryBlocked.status, 'requirements-unmet');
  assert.match(chemistryBlocked.reason ?? '', /Химия — ур\. 6; сейчас 5/);
  assert.equal(evaluateBuildingBuild(createState({ buildings: levels, scienceLevels: { 2: 6 } }), 'recycling').status, 'available');
});

test('trade-center has no requirements', () => {
  assert.deepEqual(getBuildingDefinition('trade-center').requirements, []);
  assert.equal(evaluateBuildingBuild(createState(), 'trade-center').status, 'available');
});

test('research requires construction level 1', () => {
  assert.equal(getBuildingDefinition('research').maxLevel, 20);
  assert.deepEqual(getBuildingDefinition('research').requirements, [
    { kind: 'building-level', assetRole: 'construction', level: 1 },
  ]);
  const levels = createDefaultBuildingLevels();
  assert.equal(evaluateBuildingBuild(createState({ buildings: levels }), 'research').status, 'requirements-unmet');
  levels.construction = 1;
  assert.equal(evaluateBuildingBuild(createState({ buildings: levels }), 'research').status, 'available');
});

test('recycling reports several simultaneously unmet requirements with current and required levels', () => {
  const levels = createDefaultBuildingLevels();
  levels.shipyard = 2;
  const availability = evaluateBuildingBuild(createState({ buildings: levels, scienceLevels: { 2: 4 } }), 'recycling');
  assert.equal(availability.status, 'requirements-unmet');
  assert.equal(availability.canBuild, false);
  assert.deepEqual(availability.requirements.map((item) => [item.label, item.requiredLevel, item.currentLevel, item.met]), [
    ['Верфь', 5, 2, false],
    ['Химия', 6, 4, false],
  ]);
  assert.match(availability.reason ?? '', /Верфь — ур\. 5; сейчас 2/);
  assert.match(availability.reason ?? '', /Химия — ур\. 6; сейчас 4/);
});

test('recycling can be enqueued immediately after all requirements become satisfied', () => {
  const levels = createDefaultBuildingLevels();
  const state = createState({ buildings: levels, scienceLevels: { 2: 5 } });
  assert.equal(evaluateBuildingBuild(state, 'recycling').status, 'requirements-unmet');

  state.buildings.shipyard = 5;
  state.scienceLevels[2] = 6;
  const available = evaluateBuildingBuild(state, 'recycling');
  assert.equal(available.status, 'available');
  assert.equal(available.canBuild, true);

  const transition = startBuildingProject(state, 'recycling', 'helion-01', 10_000);
  assert.equal(transition.ok, true);
  assert.deepEqual(transition.state.queue.map((item) => item.assetRole), ['recycling']);
});

test('blocked building is not queued and does not deduct resources', () => {
  const state = createState();
  const before = { ...state.resources };
  const transition = startBuildingProject(state, 'advanced-factory', 'helion-01', 10_000);
  assert.equal(transition.ok, false);
  assert.equal(transition.state.queue.length, 0);
  assert.deepEqual(transition.state.resources, before);
  assert.equal(state.queue.length, 0);
  assert.deepEqual(state.resources, before);
});

test('trade-center, construction, shipyard, spaceport and planetary-government explicitly have no requirements', () => {
  for (const role of ['trade-center', 'construction', 'shipyard', 'spaceport', 'planetary-government'] as const) {
    assert.deepEqual(getBuildingDefinition(role).requirements, [], `${role} must stay requirement-free at this stage`);
  }
});

test('final shipyard transition 14 → 15 remains available with its published cost', () => {
  const buildings = { ...createDefaultBuildingLevels(), shipyard: 14 };
  const availability = evaluateBuildingBuild(createState({
    buildings,
    resources: { metal: 100_000_000, minerals: 100_000_000, gas: 100_000_000, energy: 100_000 },
  }), 'shipyard');

  assert.equal(availability.status, 'available');
  assert.equal(availability.nextLevel, 15);
  assert.deepEqual(availability.cost, { metal: 42_611_346, minerals: 21_305_673, gas: 8_522_269, energy: 68 });
  assert.equal(availability.rawTimeMs, 55 * 60 * 1000 + 54 * 1000);
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
  assert.equal(state.resources.metal, initialMetal - 112 - 400 - 500);
  assert.equal(state.queue[1].startedAt, state.queue[0].finishAt);
  assert.equal(state.queue[2].startedAt, state.queue[1].finishAt);
  assert.equal(new Set(state.queue.map((item) => item.id)).size, BUILDING_QUEUE_CAPACITY);

  const fourth = startBuildingProject(state, 'spaceport', 'helion-01', 11_000);
  assert.equal(fourth.ok, false);
  assert.equal(fourth.reason, 'Очередь заполнена.');
  assert.equal(fourth.state.resources.metal, state.resources.metal);
});

test('any queued slot can be canceled, returns 90 percent and keeps the remaining queue contiguous', () => {
  let state = createState();
  for (const role of ['gas-production-1', 'construction', 'shipyard'] as const) {
    state = startBuildingProject(state, role, 'helion-01', 1_000).state;
  }
  const canceled = state.queue[1];
  const canceledCost = getBuildingDefinition(canceled.assetRole);
  const balance = evaluateBuildingBuild({ ...state, queue: [] }, canceled.assetRole);
  const before = { ...state.resources };
  const transition = cancelBuildingProject(state, canceled.id, 2_000);

  assert.equal(transition.ok, true);
  assert.equal(transition.canceled?.assetRole, canceled.assetRole);
  assert.equal(transition.refund?.metal, Math.floor((balance.cost?.metal ?? canceledCost.prototypeCost.metal) * BUILDING_CANCEL_REFUND_PERCENT / 100));
  assert.deepEqual(transition.state.queue.map((item) => item.assetRole), ['gas-production-1', 'shipyard']);
  assert.equal(transition.state.queue[1].startedAt, transition.state.queue[0].finishAt);
  assert.equal(transition.state.resources.metal, before.metal + (transition.refund?.metal ?? 0));
});

test('canceling the active slot starts the next slot at the cancellation time', () => {
  let state = createState();
  state = startBuildingProject(state, 'construction', 'helion-01', 1_000).state;
  state = startBuildingProject(state, 'shipyard', 'helion-01', 1_000).state;
  const transition = cancelBuildingProject(state, state.queue[0].id, 5_000);

  assert.equal(transition.ok, true);
  assert.equal(transition.state.queue.length, 1);
  assert.equal(transition.state.queue[0].assetRole, 'shipyard');
  assert.equal(transition.state.queue[0].startedAt, 5_000);
  assert.equal(transition.state.queue[0].finishAt, 5_000 + transition.state.queue[0].durationMs);
});

test('queue cancellation keeps targeting the original project after an earlier slot shifts the queue', () => {
  let state = createState();
  for (const role of ['gas-production-1', 'construction', 'shipyard'] as const) {
    state = startBuildingProject(state, role, 'helion-01', 1_000).state;
  }
  const constructionId = state.queue[1].id;
  state = cancelBuildingProject(state, state.queue[0].id, 5_000).state;
  const transition = cancelBuildingProject(state, constructionId, 5_000);

  assert.equal(transition.ok, true);
  assert.equal(transition.canceled?.assetRole, 'construction');
  assert.deepEqual(transition.state.queue.map((item) => item.assetRole), ['shipyard']);
});

test('destroying the only built level removes the building and returns the bounded percentage', () => {
  const buildings = { ...createDefaultBuildingLevels(), construction: 1 };
  const state = createState({ buildings });
  const cost = evaluateBuildingBuild({ ...state, buildings: { ...buildings, construction: 0 } }, 'construction').cost;
  const transition = destroyBuildingLevel(state, 'construction', 65);

  assert.equal(transition.ok, true);
  assert.equal(transition.destroyedLevel, 1);
  assert.equal(transition.refundPercent, 65);
  assert.equal(transition.state.buildings.construction, 0);
  for (const key of ['metal', 'minerals', 'gas', 'energy'] as const) {
    assert.equal(transition.state.resources[key], state.resources[key] + Math.floor((cost?.[key] ?? 0) * 0.65));
  }
});

test('destroying a higher level uses that level cost and clamps malformed refund input safely', () => {
  const buildings = { ...createDefaultBuildingLevels(), construction: 2 };
  const state = createState({ buildings });
  const cost = evaluateBuildingBuild({ ...state, buildings: { ...buildings, construction: 1 } }, 'construction').cost;
  const transition = destroyBuildingLevel(state, 'construction', Number.NaN);

  assert.equal(transition.ok, true);
  assert.equal(transition.destroyedLevel, 2);
  assert.equal(transition.refundPercent, 50);
  assert.equal(transition.state.buildings.construction, 1);
  for (const key of ['metal', 'minerals', 'gas', 'energy'] as const) {
    assert.equal(transition.state.resources[key], state.resources[key] + Math.floor((cost?.[key] ?? 0) * 0.5));
  }
});

test('destroying a queued building level is blocked until its queue is empty', () => {
  const buildings = { ...createDefaultBuildingLevels(), construction: 1 };
  const queued = startBuildingProject(createState({ buildings }), 'construction', 'helion-01', 1_000).state;
  const transition = destroyBuildingLevel(queued, 'construction', 65);

  assert.equal(transition.ok, false);
  assert.match(transition.reason ?? '', /Нельзя разрушить/);
  assert.equal(transition.state.buildings.construction, 1);
  assert.equal(transition.state.queue.length, 1);
});

test('building availability and queue duration use the official factory coefficient', () => {
  const state = createState({ buildings: { ...createDefaultBuildingLevels(), construction: 1 } });
  const availability = evaluateBuildingBuild(state, 'metal-production-1');
  assert.equal(availability.rawTimeMs, 2_000);
  assert.equal(availability.timeMs, Math.round((availability.rawTimeMs ?? 0) * 0.98));

  const transition = startBuildingProject(state, 'metal-production-1', 'helion-01', 10_000);
  assert.equal(transition.ok, true);
  assert.equal(transition.state.queue[0].durationMs, availability.timeMs);
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

test('legacy resource save normalizes to all 21 roles and initializes new zones to zero', () => {
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

test('Improved Construction is used consistently for preview, charge, cancellation and destruction refunds', () => {
  const scienceLevels = { 1: 6, 2: 5, 17: 20 };
  const state = createState({ scienceLevels });
  const availability = evaluateBuildingBuild(state, 'construction');
  const discountedCost = getBuildingConstructionCost(
    { metal: 400, minerals: 120, gas: 200, energy: 3 },
    scienceLevels,
  );
  assert.deepEqual(availability.cost, discountedCost);

  const started = startBuildingProject(state, 'construction', 'helion-01', 1_000);
  assert.equal(started.ok, true);
  assert.deepEqual(started.state.queue[0].cost, discountedCost);
  assert.equal(started.state.resources.metal, state.resources.metal - discountedCost.metal);

  const cancelState = { ...started.state, scienceLevels: { ...scienceLevels, 17: 0 } };
  const canceled = cancelBuildingProject(cancelState, cancelState.queue[0].id, 2_000);
  assert.equal(canceled.ok, true);
  assert.equal(canceled.refund?.metal, Math.floor(discountedCost.metal * 0.9));

  const built = createState({
    scienceLevels,
    buildings: { ...createDefaultBuildingLevels(), construction: 1 },
  });
  const destroyed = destroyBuildingLevel(built, 'construction', 65);
  assert.equal(destroyed.ok, true);
  assert.equal(destroyed.refund?.metal, Math.floor(discountedCost.metal * 0.65));
});

test('energy-building completion deducts construction energy but hourly income stays derived', () => {
  let resource = startBuildingProject(createState(), 'basic-energy', 'helion-01', 1_000).state;
  const resourceBefore = resource.resources.energy;
  resource = completeBuildingProject(resource, resource.queue[0].finishAt).state;
  assert.equal(resource.resources.energy, resourceBefore);

  let industry = startBuildingProject(createState(), 'construction', 'helion-01', 1_000).state;
  const industryBefore = industry.resources.energy;
  industry = completeBuildingProject(industry, industry.queue[0].finishAt).state;
  assert.equal(industry.resources.energy, industryBefore);
});
