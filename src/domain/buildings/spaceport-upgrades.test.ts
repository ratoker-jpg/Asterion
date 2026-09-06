import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultBuildingLevels, type ScienceLevels } from './resource-zone.ts';
import {
  PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS,
  PROTOTYPE_SPACEPORT_UPGRADE_COST,
  SPACEPORT_DUPLICATE_POLICY_TBD,
  SPACEPORT_UPGRADE_QUEUE_CAPACITY,
  calculateSpaceportEffectiveDuration,
  createDefaultSpaceportUpgradeState,
  enqueueSpaceportUpgrade,
  evaluateSpaceportUpgradeRequirements,
  migrateSpaceportUpgradeState,
  previewSpaceportUpgrade,
  reconcileSpaceportUpgradeState,
  type SpaceportUpgradeContext,
  type SpaceportUpgradeState,
  type SpaceportUpgradeTrack,
} from './spaceport-upgrades.ts';

const wallet = { metal: 100_000, minerals: 100_000, gas: 100_000 };

function context(
  state: SpaceportUpgradeState = createDefaultSpaceportUpgradeState(),
  scienceLevels: ScienceLevels = {},
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
    const result = enqueueSpaceportUpgrade(current, track, shipId, 1_000, `${track}-${index}`);
    assert.equal(result.ok, true, result.reason ?? 'enqueue failed');
    current = { ...current, state: result.state, wallet: result.wallet };
  }
  return current;
}

test('prototype duration is 15 minutes; Spaceport level 1 = 95% and level 10 = 50%', () => {
  assert.equal(PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS, 900_000);
  assert.equal(calculateSpaceportEffectiveDuration(PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS, 1), 855_000);
  assert.equal(calculateSpaceportEffectiveDuration(PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS, 10), 450_000);
});

test('queued task snapshots Spaceport speed and does not recalculate after building upgrade', () => {
  const startedAt = 5_000;
  const initial = context(createDefaultSpaceportUpgradeState(), {}, 1);
  const queued = enqueueSpaceportUpgrade(initial, 'ships', 'solar-satellite', startedAt, 'snapshot');
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

test('ship and commander queues are independent FIFO queues with three slots each', () => {
  let current = enqueueRepeated('ships', 'solar-satellite', 3);
  assert.equal(current.state.shipQueue.length, SPACEPORT_UPGRADE_QUEUE_CAPACITY);
  assert.equal(current.state.commanderQueue.length, 0);
  assert.equal(current.state.shipQueue[1].startedAt, current.state.shipQueue[0].finishAt);
  assert.equal(current.state.shipQueue[2].startedAt, current.state.shipQueue[1].finishAt);

  const fourthShip = enqueueSpaceportUpgrade(current, 'ships', 'solar-satellite', 1_000, 'ship-fourth');
  assert.equal(fourthShip.ok, false);
  assert.equal(fourthShip.reason, 'Очередь заполнена.');
  assert.deepEqual(fourthShip.wallet, current.wallet);

  current = enqueueRepeated('commanders', 'corsair', 3, current);
  assert.equal(current.state.shipQueue.length, 3);
  assert.equal(current.state.commanderQueue.length, 3);
  const fourthCommander = enqueueSpaceportUpgrade(current, 'commanders', 'corsair', 1_000, 'commander-fourth');
  assert.equal(fourthCommander.ok, false);
  assert.equal(fourthCommander.reason, 'Очередь заполнена.');
  assert.match(SPACEPORT_DUPLICATE_POLICY_TBD, /TBD/);
});

test('enqueue N → N+1 completes exactly once and repeated reconciliation cannot double-level', () => {
  const initial = context();
  initial.state.shipLevels['solar-satellite'] = 4;
  const queued = enqueueSpaceportUpgrade(initial, 'ships', 'solar-satellite', 2_000, 'level-up');
  assert.equal(queued.ok, true);
  assert.equal(queued.task?.fromLevel, 4);
  assert.equal(queued.task?.toLevel, 5);

  const finishAt = queued.task?.finishAt ?? 0;
  const completed = reconcileSpaceportUpgradeState(queued.state, finishAt);
  assert.equal(completed.changed, true);
  assert.equal(completed.state.shipLevels['solar-satellite'], 5);
  assert.equal(completed.state.shipQueue.length, 0);
  assert.equal(completed.completed.length, 1);

  const again = reconcileSpaceportUpgradeState(completed.state, finishAt + 50_000);
  assert.equal(again.changed, false);
  assert.equal(again.state.shipLevels['solar-satellite'], 5);
  assert.equal(again.completed.length, 0);
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
  }
});

test('failed enqueue is atomic and does not deduct prototype resources', () => {
  const initial = context();
  initial.buildings.shipyard = 0;
  const before = { ...initial.wallet };
  const result = enqueueSpaceportUpgrade(initial, 'ships', 'solar-satellite', 10_000, 'blocked');
  assert.equal(result.ok, false);
  assert.deepEqual(result.wallet, before);
  assert.equal(result.state.shipQueue.length, 0);

  initial.buildings.shipyard = 1;
  const success = enqueueSpaceportUpgrade(initial, 'ships', 'solar-satellite', 10_000, 'success');
  assert.equal(success.ok, true);
  assert.equal(success.wallet.metal, before.metal - PROTOTYPE_SPACEPORT_UPGRADE_COST.metal);
  assert.equal(success.wallet.minerals, before.minerals - PROTOTYPE_SPACEPORT_UPGRADE_COST.minerals);
  assert.equal(success.wallet.gas, before.gas - PROTOTYPE_SPACEPORT_UPGRADE_COST.gas);
});

test('migration restores absolute timestamps and offline reconciliation applies completed tasks once', () => {
  const legacy = {
    shipLevels: { 'solar-satellite': 2, corsair: 1 },
    shipQueue: [{
      id: 'offline-ship',
      track: 'ships',
      shipId: 'solar-satellite',
      fromLevel: 2,
      toLevel: 3,
      startedAt: 10_000,
      finishAt: 20_000,
      spaceportLevelAtStart: 1,
      effectiveDurationMs: 10_000,
    }],
    commanderQueue: [{
      id: 'offline-commander',
      track: 'commanders',
      shipId: 'corsair',
      fromLevel: 1,
      toLevel: 2,
      startedAt: 11_000,
      finishAt: 21_000,
      spaceportLevelAtStart: 2,
      effectiveDurationMs: 10_000,
    }],
  };

  const restored = migrateSpaceportUpgradeState(legacy);
  assert.equal(restored.shipQueue[0].startedAt, 10_000);
  assert.equal(restored.shipQueue[0].finishAt, 20_000);
  assert.equal(restored.commanderQueue[0].finishAt, 21_000);

  const offline = reconcileSpaceportUpgradeState(restored, 50_000);
  assert.equal(offline.state.shipLevels['solar-satellite'], 3);
  assert.equal(offline.state.shipLevels.corsair, 2);
  assert.equal(offline.state.shipQueue.length, 0);
  assert.equal(offline.state.commanderQueue.length, 0);
  assert.equal(offline.completed.length, 2);

  const secondReload = reconcileSpaceportUpgradeState(migrateSpaceportUpgradeState(offline.state), 60_000);
  assert.equal(secondReload.changed, false);
  assert.equal(secondReload.state.shipLevels['solar-satellite'], 3);
  assert.equal(secondReload.state.shipLevels.corsair, 2);
});
