import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILDING_QUEUE_CAPACITY,
  createCanonicalStartingBuildingLevels,
  evaluateBuildingBuild,
  getBuildingDefinition,
  startBuildingProject,
  type BuildingEconomyState,
} from './domain/buildings/resource-zone.ts';
import { describeQuickUpgrade } from './zone-quick-upgrade.ts';

const rich = { metal: 10_000_000, minerals: 10_000_000, gas: 10_000_000, energy: 10_000_000 };
const createState = (overrides: Partial<BuildingEconomyState> = {}): BuildingEconomyState => ({
  resources: rich,
  buildings: createCanonicalStartingBuildingLevels(),
  queue: [],
  scienceLevels: {},
  ...overrides,
});

const free = (state: BuildingEconomyState) => BUILDING_QUEUE_CAPACITY - state.queue.length;

test('quick upgrade mirrors the dialog: enabled with target level, cost and free slots', () => {
  const state = createState();
  const availability = evaluateBuildingBuild(state, 'metal-production-1');
  const view = describeQuickUpgrade('Поглотитель металла I', availability, free(state));
  assert.equal(view.enabled, true);
  assert.equal(view.verb, 'Улучшить');
  assert.equal(view.targetLevel, 2);
  assert.equal(view.ariaLabel, 'Улучшить Поглотитель металла I до ур. 2');
  assert.match(view.title, /^Улучшить Поглотитель металла I до ур\. 2\n/);
  assert.match(view.title, /Металл \d/);
  assert.match(view.title, /Энергия \d/);
  assert.match(view.title, new RegExp(`Свободно слотов: ${BUILDING_QUEUE_CAPACITY}\\.$`));
});

test('quick button on an empty slot says «Построить» to level 1', () => {
  const state = createState();
  const availability = evaluateBuildingBuild(state, 'construction');
  assert.equal(availability.currentLevel, 0);
  const view = describeQuickUpgrade('Строительный комплекс', availability, free(state));
  assert.equal(view.verb, 'Построить');
  assert.equal(view.targetLevel, 1);
  assert.equal(view.enabled, availability.canBuild);
});

test('repeated quick clicks queue consecutive levels through the same domain command until the queue is full', () => {
  let state = createState();
  const now = 1_000_000;
  const levels: number[] = [];
  for (let click = 0; click < BUILDING_QUEUE_CAPACITY; click += 1) {
    const availability = evaluateBuildingBuild(state, 'metal-production-1');
    const view = describeQuickUpgrade('Поглотитель', availability, free(state));
    assert.equal(view.enabled, true, `click ${click + 1} should be allowed`);
    const transition = startBuildingProject(state, 'metal-production-1', 'helion-01', now + click);
    assert.equal(transition.ok, true);
    levels.push(view.targetLevel ?? -1);
    state = transition.state;
  }
  assert.deepEqual(levels, [2, 3, 4]);
  assert.deepEqual(state.queue.map((item) => item.targetLevel), [2, 3, 4]);

  const full = describeQuickUpgrade('Поглотитель', evaluateBuildingBuild(state, 'metal-production-1'), free(state));
  assert.equal(full.enabled, false);
  assert.equal(full.targetLevel, 5);
  assert.match(full.ariaLabel, /недоступно\. Очередь заполнена\.$/);
  assert.match(full.title, /Очередь заполнена\.$/);
});

test('missing resources disable the quick button and name the shortfall', () => {
  const state = createState({ resources: { metal: 0, minerals: 0, gas: 0, energy: 0 } });
  const view = describeQuickUpgrade('Поглотитель', evaluateBuildingBuild(state, 'metal-production-1'), free(state));
  assert.equal(view.enabled, false);
  assert.match(view.title, /не хватает/);
  assert.match(view.title, /Недостаточно /);
});

test('unmet requirements and max level disable the quick button with the dialog reason', () => {
  const state = createState();
  const blockedRole = (['advanced-factory', 'shipyard', 'trade-center'] as const)
    .find((role) => evaluateBuildingBuild(state, role).status === 'requirements-unmet');
  assert.ok(blockedRole, 'a role with unmet requirements exists on a fresh planet');
  const blocked = describeQuickUpgrade('Здание', evaluateBuildingBuild(state, blockedRole), free(state));
  assert.equal(blocked.enabled, false);
  assert.match(blocked.title, /Требуется:/);

  const maxLevel = getBuildingDefinition('metal-production-1').maxLevel;
  const maxed = createState({ buildings: { ...createCanonicalStartingBuildingLevels(), 'metal-production-1': maxLevel } });
  const view = describeQuickUpgrade('Поглотитель', evaluateBuildingBuild(maxed, 'metal-production-1'), free(maxed));
  assert.equal(view.enabled, false);
  assert.equal(view.targetLevel, null);
  assert.equal(view.ariaLabel, 'Поглотитель: максимальный уровень');
  assert.equal(view.title, 'Достигнут максимальный уровень.');
});
