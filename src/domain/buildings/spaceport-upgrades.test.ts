import assert from 'node:assert/strict';
import test from 'node:test';

import { SCIENCE_CATALOG } from '../science/catalog.ts';
import { TEST_TIME_SCALE } from '../runtime/mode.ts';
import { createDefaultBuildingLevels, type ScienceLevels } from './resource-zone.ts';
import {
  PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS,
  PROTOTYPE_SPACEPORT_UPGRADE_COST,
  SPACEPORT_UPGRADE_MAX_LEVEL_BY_TRACK,
  SPACEPORT_UPGRADE_QUEUE_CAPACITY,
  calculateSpaceportEffectiveDuration,
  createDefaultSpaceportUpgradeState,
  enqueueSpaceportUpgrade,
  evaluateSpaceportUpgradeRequirements,
  getSpaceportUpgradeCatalog,
  getSpaceportUpgradeEntity,
  getSpaceportUpgradeMaxLevel,
  migrateSpaceportUpgradeState,
  previewSpaceportUpgrade,
  reconcileSpaceportUpgradeState,
  type SpaceportUpgradeContext,
  type SpaceportUpgradeState,
  type SpaceportUpgradeTrack,
} from './spaceport-upgrades.ts';

const wallet = { metal: 100_000, minerals: 100_000, gas: 100_000 };

function unlockedScienceLevels(): ScienceLevels {
  return Object.fromEntries(SCIENCE_CATALOG.map((science) => [science.id, 99])) as ScienceLevels;
}

function context(
  state: SpaceportUpgradeState = createDefaultSpaceportUpgradeState(),
  scienceLevels: ScienceLevels = unlockedScienceLevels(),
  spaceportLevel = 1,
): SpaceportUpgradeContext {
  const buildings = createDefaultBuildingLevels();
  buildings.spaceport = spaceportLevel;
  buildings.shipyard = 20;
  return { state, wallet: { ...wallet }, buildings, scienceLevels, spaceportLevel };
}

function enqueueRepeated(
  track: SpaceportUpgradeTrack,
  shipId: string,
  count: number,
  initial = context(),
) {
  let current = initial;
  for (let index = 0; index < count; index += 1) {
    const result = enqueueSpaceportUpgrade(current, track, shipId, 1_000, `${track}-${shipId}-${index}`);
    assert.equal(result.ok, true, result.reason ?? 'enqueue failed');
    current = { ...current, state: result.state, wallet: result.wallet };
  }
  return current;
}

test('Spaceport upgrade catalog excludes only non-upgrade utility ships and keeps ordinary + commander catalogs intact otherwise', () => {
  const shipIds = getSpaceportUpgradeCatalog('ships').map((entity) => entity.id);
  const excluded = ['solar-satellite', 'spy-probe', 'colonizer', 'recycler'];
  for (const id of excluded) {
    assert.equal(shipIds.includes(id as never), false, `${id} must be hidden from Spaceport upgrades`);
    assert.equal(getSpaceportUpgradeEntity('ships', id), null);
    const initial = context();
    const result = enqueueSpaceportUpgrade(initial, 'ships', id, 1_000, `excluded-${id}`);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /недоступна для улучшения в Космодроме/);
    assert.deepEqual(result.wallet, initial.wallet);
    assert.equal(result.state.shipQueue.length, 0);
  }

  for (const id of ['transporter', 'mega-transporter', 'scout', 'cruiser', 'defender', 'battleship', 'destroyer', 'bomber', 'death-star']) {
    assert.equal(shipIds.includes(id as never), true, `${id} must remain in Spaceport upgrades`);
  }

  assert.equal(getSpaceportUpgradeCatalog('commanders').length, 13);
  assert.equal(getSpaceportUpgradeEntity('commanders', 'corsair')?.id, 'corsair');
  assert.equal(getSpaceportUpgradeEntity('commanders', 'polias')?.id, 'polias');
});

test('track-specific maximum levels are explicit: ships 10, commanders 40', () => {
  assert.deepEqual(SPACEPORT_UPGRADE_MAX_LEVEL_BY_TRACK, { ships: 10, commanders: 40 });
  assert.equal(getSpaceportUpgradeMaxLevel('ships'), 10);
  assert.equal(getSpaceportUpgradeMaxLevel('commanders'), 40);
});

test('prototype duration is 15 minutes; Spaceport level 1 = 95% and level 10 = 50%', () => {
  assert.equal(PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS, 900_000);
  assert.equal(calculateSpaceportEffectiveDuration(PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS, 1), 855_000);
  assert.equal(calculateSpaceportEffectiveDuration(PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS, 10), 450_000);
});

test('Test Mode snapshots the same Spaceport speed policy with accelerated absolute timestamps', () => {
  const queued = enqueueSpaceportUpgrade({ ...context(), mode: 'test' }, 'ships', 'transporter', 5_000, 'test-speed');
  assert.equal(queued.ok, true);
  assert.equal(queued.task?.effectiveDurationMs, 855_000 / TEST_TIME_SCALE);
  assert.equal(queued.task?.finishAt, 5_000 + 855_000 / TEST_TIME_SCALE);
});

test('queued task snapshots Spaceport speed and does not recalculate after building upgrade', () => {
  const startedAt = 5_000;
  const initial = context(createDefaultSpaceportUpgradeState(), unlockedScienceLevels(), 1);
  const queued = enqueueSpaceportUpgrade(initial, 'ships', 'transporter', startedAt, 'snapshot');
  assert.equal(queued.ok, true);
  assert.ok(queued.task);
  assert.equal(queued.task.spaceportLevelAtStart, 1);
  assert.equal(queued.task.effectiveDurationMs, 855_000);
  assert.equal(queued.task.finishAt, startedAt + 855_000);

  const upgradedContext = { ...initial, state: queued.state, spaceportLevel: 10 };
  const beforeFinish = reconcileSpaceportUpgradeState(upgradedContext.state, startedAt + 1_000);
  assert.equal(beforeFinish.changed, false);
  assert.equal(beforeFinish.state.shipQueue[0].finishAt, startedAt + 855_000);
  assert.equal(beforeFinish.state.shipQueue[0].spaceportLevelAtStart, 1);
});

test('ordinary ship can be enqueued three times in one FIFO queue with sequential levels', () => {
  const current = enqueueRepeated('ships', 'transporter', 3);
  assert.equal(current.state.shipQueue.length, SPACEPORT_UPGRADE_QUEUE_CAPACITY);
  assert.deepEqual(current.state.shipQueue.map((task) => [task.fromLevel, task.toLevel]), [
    [0, 1],
    [1, 2],
    [2, 3],
  ]);
  assert.equal(current.state.shipQueue[1].startedAt, current.state.shipQueue[0].finishAt);
  assert.equal(current.state.shipQueue[2].startedAt, current.state.shipQueue[1].finishAt);

  const fourth = enqueueSpaceportUpgrade(current, 'ships', 'transporter', 1_000, 'ship-fourth');
  assert.equal(fourth.ok, false);
  assert.equal(fourth.reason, 'Очередь улучшений заполнена.');
  assert.deepEqual(fourth.wallet, current.wallet);
});

test('Corsair can be enqueued 0→1, 1→2, 2→3 and commander queue remains independent', () => {
  let current = enqueueRepeated('ships', 'transporter', 3);
  current = enqueueRepeated('commanders', 'corsair', 3, current);

  assert.equal(current.state.shipQueue.length, 3);
  assert.equal(current.state.commanderQueue.length, 3);
  assert.deepEqual(current.state.commanderQueue.map((task) => [task.fromLevel, task.toLevel]), [
    [0, 1],
    [1, 2],
    [2, 3],
  ]);
  assert.equal(current.state.commanderQueue[1].startedAt, current.state.commanderQueue[0].finishAt);
  assert.equal(current.state.commanderQueue[2].startedAt, current.state.commanderQueue[1].finishAt);

  const fourthCommander = enqueueSpaceportUpgrade(current, 'commanders', 'corsair', 1_000, 'commander-fourth');
  assert.equal(fourthCommander.ok, false);
  assert.equal(fourthCommander.reason, 'Очередь улучшений заполнена.');
});

test('ordinary ships never exceed level 10 in preview, enqueue, completion or migration', () => {
  const state = createDefaultSpaceportUpgradeState();
  state.shipLevels.transporter = 9;
  const initial = context(state);
  const queued = enqueueSpaceportUpgrade(initial, 'ships', 'transporter', 2_000, 'ship-ten');
  assert.equal(queued.ok, true);
  assert.deepEqual([queued.task?.fromLevel, queued.task?.toLevel], [9, 10]);

  const preview = previewSpaceportUpgrade({ ...initial, state: queued.state, wallet: queued.wallet }, 'ships', 'transporter');
  assert.equal(preview.currentLevel, 9);
  assert.equal(preview.projectedLevel, 10);
  assert.equal(preview.nextLevel, null);
  assert.equal(preview.status, 'max-level');

  const completed = reconcileSpaceportUpgradeState(queued.state, queued.task?.finishAt ?? 0);
  assert.equal(completed.state.shipLevels.transporter, 10);
  const replay = reconcileSpaceportUpgradeState(completed.state, (queued.task?.finishAt ?? 0) + 1_000);
  assert.equal(replay.state.shipLevels.transporter, 10);

  const migrated = migrateSpaceportUpgradeState({ shipLevels: { transporter: 999 } });
  assert.equal(migrated.shipLevels.transporter, 10);
});

test('commander ships reach level 40 and are never clamped to the ordinary ship limit 10', () => {
  const state = createDefaultSpaceportUpgradeState();
  state.shipLevels.corsair = 39;
  const initial = context(state);
  const queued = enqueueSpaceportUpgrade(initial, 'commanders', 'corsair', 2_000, 'corsair-forty');
  assert.equal(queued.ok, true);
  assert.deepEqual([queued.task?.fromLevel, queued.task?.toLevel], [39, 40]);

  const preview = previewSpaceportUpgrade({ ...initial, state: queued.state, wallet: queued.wallet }, 'commanders', 'corsair');
  assert.equal(preview.currentLevel, 39);
  assert.equal(preview.projectedLevel, 40);
  assert.equal(preview.nextLevel, null);
  assert.equal(preview.status, 'max-level');

  const completed = reconcileSpaceportUpgradeState(queued.state, queued.task?.finishAt ?? 0);
  assert.equal(completed.state.shipLevels.corsair, 40);

  const migrated = migrateSpaceportUpgradeState({ shipLevels: { corsair: 999 } });
  assert.equal(migrated.shipLevels.corsair, 40);
});

test('three repeated completed tasks apply exactly once after offline/reload reconciliation', () => {
  const queued = enqueueRepeated('ships', 'transporter', 3);
  const finishAt = queued.state.shipQueue.at(-1)?.finishAt ?? 0;
  const offline = reconcileSpaceportUpgradeState(queued.state, finishAt);
  assert.equal(offline.changed, true);
  assert.equal(offline.state.shipLevels.transporter, 3);
  assert.equal(offline.state.shipQueue.length, 0);
  assert.equal(offline.completed.length, 3);

  const restored = migrateSpaceportUpgradeState(offline.state);
  const secondReload = reconcileSpaceportUpgradeState(restored, finishAt + 50_000);
  assert.equal(secondReload.changed, false);
  assert.equal(secondReload.state.shipLevels.transporter, 3);
  assert.equal(secondReload.completed.length, 0);
});

test('reconciliation is idempotent when a legacy task target was already applied before replay', () => {
  const state = createDefaultSpaceportUpgradeState();
  state.shipLevels.transporter = 1;
  state.shipQueue = [{
    id: 'already-applied',
    track: 'ships',
    shipId: 'transporter',
    fromLevel: 0,
    toLevel: 1,
    startedAt: 1_000,
    finishAt: 2_000,
    spaceportLevelAtStart: 1,
    effectiveDurationMs: 1_000,
  }];
  const reconciled = reconcileSpaceportUpgradeState(state, 3_000);
  assert.equal(reconciled.state.shipLevels.transporter, 1);
  assert.equal(reconciled.state.shipQueue.length, 0);
  assert.equal(reconciled.changed, true);
  assert.equal(reconciled.completed.length, 0);
});

test('migration drops an already-applied persisted task before read-save reconciliation', () => {
  const migrated = migrateSpaceportUpgradeState({
    shipLevels: { transporter: 1 },
    shipQueue: [{
      id: 'already-applied',
      shipId: 'transporter',
      fromLevel: 0,
      toLevel: 1,
      startedAt: 1_000,
      finishAt: 2_000,
      spaceportLevelAtStart: 1,
      effectiveDurationMs: 1_000,
    }],
  });

  assert.equal(migrated.shipQueue.length, 0);
  const reconciled = reconcileSpaceportUpgradeState(migrated, 3_000);
  assert.equal(reconciled.state.shipLevels.transporter, 1);
  assert.equal(reconciled.completed.length, 0);
});

test('malformed queue entries are skipped and valid later Spaceport tasks survive migration', () => {
  const migrated = migrateSpaceportUpgradeState({
    shipLevels: { transporter: 0 },
    shipQueue: [null, { id: 'later-valid', shipId: 'transporter', fromLevel: 0, toLevel: 1, startedAt: 10, finishAt: 20 }],
  });
  assert.equal(migrated.shipQueue.length, 1);
  assert.equal(migrated.shipQueue[0].id, 'later-valid');
});

test('Defender upgrade uses the same shipyard, ion science and fuel-cell requirements as the shared catalog', () => {
  const buildings = createDefaultBuildingLevels();
  buildings.spaceport = 1;
  buildings.shipyard = 5;
  const scienceLevels: ScienceLevels = { 8: 3, 11: 1 };
  const requirements = evaluateSpaceportUpgradeRequirements('ships', 'defender', buildings, scienceLevels);
  assert.deepEqual(requirements.map((item) => [item.label, item.requiredLevel, item.currentLevel, item.met]), [
    ['Верфь', 5, 5, true],
    ['Ионная наука', 2, 1, false],
    ['Топливные элементы', 4, 3, false],
  ]);
  assert.equal(requirements[0].buildingRole, 'shipyard');
  assert.equal(requirements[1].scienceId, 11);
  assert.equal(requirements[2].scienceId, 8);

  const blocked = previewSpaceportUpgrade({
    state: createDefaultSpaceportUpgradeState(),
    wallet: { ...wallet },
    buildings,
    scienceLevels,
    spaceportLevel: 1,
  }, 'ships', 'defender');
  assert.equal(blocked.status, 'requirements-unmet');
  assert.match(blocked.reason ?? '', /Ионная наука — уровень 2; сейчас 1/);
  assert.match(blocked.reason ?? '', /Топливные элементы — уровень 4; сейчас 3/);

  scienceLevels[8] = 4;
  scienceLevels[11] = 2;
  const available = previewSpaceportUpgrade({
    state: createDefaultSpaceportUpgradeState(),
    wallet: { ...wallet },
    buildings,
    scienceLevels,
    spaceportLevel: 1,
  }, 'ships', 'defender');
  assert.equal(available.status, 'available');
  assert.equal(available.canStart, true);
});

test('unknown catalog requirement is explicit and never represented as a fake current level zero', () => {
  const buildings = createDefaultBuildingLevels();
  buildings.shipyard = 20;
  const requirements = evaluateSpaceportUpgradeRequirements('commanders', 'reanimator', buildings, {});
  const unresolved = requirements.filter((item) => item.kind === 'unresolved-catalog-requirement');
  assert.equal(unresolved.length >= 1, true);
  for (const requirement of unresolved) {
    assert.equal(requirement.currentLevel, null);
    assert.equal(requirement.met, false);
    assert.equal(requirement.scienceId, undefined);
    assert.equal(requirement.buildingRole, undefined);
  }
});

test('failed enqueue is atomic and does not deduct prototype resources', () => {
  const initial = context();
  initial.wallet.metal = 0;
  const before = { ...initial.wallet };
  const result = enqueueSpaceportUpgrade(initial, 'ships', 'transporter', 10_000, 'blocked');
  assert.equal(result.ok, false);
  assert.deepEqual(result.wallet, before);
  assert.equal(result.state.shipQueue.length, 0);

  initial.wallet.metal = wallet.metal;
  const success = enqueueSpaceportUpgrade(initial, 'ships', 'transporter', 10_000, 'success');
  assert.equal(success.ok, true);
  assert.equal(success.wallet.metal, wallet.metal - PROTOTYPE_SPACEPORT_UPGRADE_COST.metal);
  assert.equal(success.wallet.minerals, wallet.minerals - PROTOTYPE_SPACEPORT_UPGRADE_COST.minerals);
  assert.equal(success.wallet.gas, wallet.gas - PROTOTYPE_SPACEPORT_UPGRADE_COST.gas);
});

test('migration restores FIFO timestamps, sequential duplicate levels and track-specific clamps', () => {
  const legacy = {
    shipLevels: { transporter: 2, corsair: 38, 'solar-satellite': 99 },
    shipQueue: [
      { id: 'ship-1', shipId: 'transporter', startedAt: 10_000, finishAt: 20_000, spaceportLevelAtStart: 1, effectiveDurationMs: 10_000 },
      { id: 'ship-2', shipId: 'transporter', startedAt: 12_000, finishAt: 22_000, spaceportLevelAtStart: 1, effectiveDurationMs: 10_000 },
      { id: 'excluded', shipId: 'solar-satellite', startedAt: 13_000, finishAt: 23_000, spaceportLevelAtStart: 1, effectiveDurationMs: 10_000 },
    ],
    commanderQueue: [
      { id: 'commander-1', shipId: 'corsair', startedAt: 11_000, finishAt: 21_000, spaceportLevelAtStart: 2, effectiveDurationMs: 10_000 },
      { id: 'commander-2', shipId: 'corsair', startedAt: 15_000, finishAt: 25_000, spaceportLevelAtStart: 2, effectiveDurationMs: 10_000 },
      { id: 'commander-over-max', shipId: 'corsair', startedAt: 16_000, finishAt: 26_000, spaceportLevelAtStart: 2, effectiveDurationMs: 10_000 },
    ],
  };

  const restored = migrateSpaceportUpgradeState(legacy);
  assert.equal(restored.shipLevels['solar-satellite'], 10);
  assert.equal(restored.shipLevels.corsair, 38);
  assert.equal(restored.shipQueue.length, 2);
  assert.deepEqual(restored.shipQueue.map((task) => [task.fromLevel, task.toLevel]), [[2, 3], [3, 4]]);
  assert.equal(restored.shipQueue[1].startedAt, restored.shipQueue[0].finishAt);
  assert.equal(restored.commanderQueue.length, 2);
  assert.deepEqual(restored.commanderQueue.map((task) => [task.fromLevel, task.toLevel]), [[38, 39], [39, 40]]);
  assert.equal(restored.commanderQueue[1].startedAt, restored.commanderQueue[0].finishAt);
});
