import assert from 'node:assert/strict';
import test from 'node:test';

import { SCIENCE_CATALOG } from '../science/catalog.ts';
import { TEST_TIME_SCALE } from '../runtime/mode.ts';
import {
  FACTION_SHIP_UPGRADE_TIMES,
  FACTION_SHIP_BASE_PRODUCTION_TIMES,
  ORDINARY_UPGRADE_SHIP_IDS,
  parseTimeRebalancedDurationMs,
} from '../combat/ship-time-rebalanced.ts';
import { createDefaultBuildingLevels, type ScienceLevels } from './resource-zone.ts';
import { calculateUnitProductionDurationMs } from './balance-v1.ts';
import { FACTION_SPACEPORT_UPGRADE_BALANCE_V1, SPACEPORT_UPGRADE_BALANCE_V1 } from './spaceport-upgrade-balance-v1.ts';
import { COMMANDER_SPACEPORT_UPGRADE_BALANCE, COMMANDER_UPGRADE_SOURCE_FILES } from './commander-upgrade-balance-v1.ts';
import { COMMANDER_COMBAT_CATALOG } from '../combat/catalog.ts';
import {
  PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS,
  SPACEPORT_UPGRADE_MAX_LEVEL_BY_TRACK,
  SPACEPORT_UPGRADE_QUEUE_CAPACITY,
  calculateSpaceportEffectiveDuration,
  cancelSpaceportUpgrade,
  createDefaultSpaceportUpgradeState,
  enqueueSpaceportUpgrade,
  evaluateSpaceportUpgradeRequirements,
  getSpaceportUpgradeCatalog,
  getSpaceportUpgradeEntity,
  getSpaceportUpgradeMaxLevel,
  migrateSpaceportUpgradeState,
  previewSpaceportUpgrade,
  reconcileSpaceportUpgradeState,
  selectSpaceportCancelRefundPercent,
  type SpaceportUpgradeContext,
  type SpaceportUpgradeState,
  type SpaceportUpgradeTrack,
} from './spaceport-upgrades.ts';

const wallet = { metal: 100_000, minerals: 100_000, gas: 100_000 };

function durationMs(hours: number, minutes: number, seconds: number): number {
  return ((hours * 60 + minutes) * 60 + seconds) * 1_000;
}

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

test('rebalanced unit times are base inputs and building/Spaceport bonuses are applied exactly once', () => {
  const transporterBase = parseTimeRebalancedDurationMs(FACTION_SHIP_BASE_PRODUCTION_TIMES.aegis.transporter);
  assert.equal(transporterBase, 12_000);
  assert.equal(calculateUnitProductionDurationMs(transporterBase, 0, 0), 12_000);
  assert.equal(calculateUnitProductionDurationMs(transporterBase, 1, 1), 10_830);
  assert.equal(calculateSpaceportEffectiveDuration(180_000, 1), 171_000);
  assert.equal(calculateSpaceportEffectiveDuration(180_000, 10), 90_000);
});

test('Balance v1 supplies every ordinary ship upgrade cost and duration transition', () => {
  for (const [shipId, rows] of Object.entries(SPACEPORT_UPGRADE_BALANCE_V1)) {
    for (const [fromLevel, balance] of rows.entries()) {
      const state = createDefaultSpaceportUpgradeState();
      state.shipLevels[shipId] = fromLevel;
      const preview = previewSpaceportUpgrade(context(state), 'ships', shipId);
      assert.deepEqual(preview.cost, balance.cost, `${shipId} ${fromLevel} → ${fromLevel + 1} cost`);
      assert.equal(preview.baseDurationMs, balance.durationMs, `${shipId} ${fromLevel} → ${fromLevel + 1} duration`);
    }
  }

  const transporter = previewSpaceportUpgrade(context(), 'ships', 'transporter');
  assert.deepEqual(transporter.cost, { metal: 1_000, minerals: 0, gas: 0 });
  assert.equal(transporter.baseDurationMs, 180_000);

  const transporterLevelTwoState = createDefaultSpaceportUpgradeState();
  transporterLevelTwoState.shipLevels.transporter = 1;
  const transporterLevelTwo = previewSpaceportUpgrade(context(transporterLevelTwoState), 'ships', 'transporter');
  assert.deepEqual(transporterLevelTwo.cost, { metal: 2_000, minerals: 0, gas: 0 });
  assert.equal(transporterLevelTwo.baseDurationMs, 225_000);

  const deathStarLevelEightState = createDefaultSpaceportUpgradeState();
  deathStarLevelEightState.shipLevels['death-star'] = 7;
  const deathStarLevelEight = previewSpaceportUpgrade(context(deathStarLevelEightState), 'ships', 'death-star');
  assert.deepEqual(deathStarLevelEight.cost, { metal: 192_000_000, minerals: 96_000_000, gas: 48_000_000 });
  assert.equal(deathStarLevelEight.baseDurationMs, durationMs(2, 6, 30));
});

test('Spaceport preview uses the selected faction ship data and keeps Balance v1 timing', () => {
  const synodTransporter = getSpaceportUpgradeEntity('ships', 'transporter', 'synod');
  const veyraTransporter = getSpaceportUpgradeEntity('ships', 'transporter', 'veyra');
  assert.equal(synodTransporter?.name, 'Транспортный дрон');
  assert.equal(veyraTransporter?.name, 'Носильщик');
  assert.equal(synodTransporter?.population, 1);
  assert.equal(veyraTransporter?.population, 2);
  assert.equal(synodTransporter?.ship?.speed, 22_000);
  assert.equal(veyraTransporter?.ship?.speed, 21_000);

  const synodPreview = previewSpaceportUpgrade({ ...context(), factionId: 'synod' }, 'ships', 'transporter');
  const synodBalance = FACTION_SPACEPORT_UPGRADE_BALANCE_V1.synod.transporter[0];
  assert.deepEqual(synodPreview.cost, synodBalance.cost);
  assert.equal(synodPreview.baseDurationMs, synodBalance.durationMs);
  assert.equal(synodPreview.effectiveDurationMs, calculateSpaceportEffectiveDuration(
    synodBalance.durationMs,
    1,
  ));

  const buildings = createDefaultBuildingLevels();
  buildings.shipyard = 20;
  const unresolvedVeyraRequirement = evaluateSpaceportUpgradeRequirements(
    'ships',
    'destroyer',
    buildings,
    unlockedScienceLevels(),
    'veyra',
  ).find((requirement) => requirement.label === 'Немезис' && requirement.valueKind === 'quantity');
  assert.ok(unresolvedVeyraRequirement);
  assert.equal(unresolvedVeyraRequirement.kind, 'unresolved-catalog-requirement');
  assert.equal(unresolvedVeyraRequirement.valueKind, 'quantity');
  assert.equal(unresolvedVeyraRequirement.currentLevel, null);
  assert.equal(unresolvedVeyraRequirement.met, false);
});

test('Factory upgrades are faction-specific and resolve L → L+1 without a level shift', () => {
  const ordinaryShipIds = ['transporter', 'mega-transporter', 'scout', 'cruiser', 'defender', 'battleship', 'destroyer', 'bomber', 'death-star'] as const;
  for (const factionId of ['aegis', 'synod', 'veyra'] as const) {
    for (const shipId of ordinaryShipIds) {
      const rows = FACTION_SPACEPORT_UPGRADE_BALANCE_V1[factionId][shipId];
      assert.ok(rows, `${factionId} ${shipId} must have a Factory upgrades table`);
      assert.equal(rows.length, 10, `${factionId} ${shipId} must have ten published levels`);
    }
  }

  const fixtures = [
    { factionId: 'aegis' as const, shipId: 'transporter', rows: [
      { fromLevel: 0, cost: { metal: 1_000, minerals: 0, gas: 0 }, durationMs: durationMs(0, 3, 0) },
      { fromLevel: 1, cost: { metal: 2_000, minerals: 0, gas: 0 }, durationMs: durationMs(0, 3, 45) },
    ] },
    { factionId: 'aegis' as const, shipId: 'destroyer', rows: [
      { fromLevel: 0, cost: { metal: 50_000, minerals: 25_000, gas: 10_000 }, durationMs: durationMs(0, 4, 12) },
      { fromLevel: 1, cost: { metal: 100_000, minerals: 50_000, gas: 20_000 }, durationMs: durationMs(0, 5, 53) },
    ] },
    { factionId: 'aegis' as const, shipId: 'death-star', rows: [
      { fromLevel: 0, cost: { metal: 2_000_000, minerals: 1_000_000, gas: 500_000 }, durationMs: durationMs(0, 12, 0) },
      { fromLevel: 1, cost: { metal: 4_000_000, minerals: 2_000_000, gas: 1_000_000 }, durationMs: durationMs(0, 16, 48) },
    ] },
    { factionId: 'synod' as const, shipId: 'transporter', rows: [
      { fromLevel: 0, cost: { metal: 1_000, minerals: 0, gas: 0 }, durationMs: durationMs(0, 3, 0) },
      { fromLevel: 1, cost: { metal: 2_000, minerals: 0, gas: 0 }, durationMs: durationMs(0, 3, 45) },
    ] },
    { factionId: 'synod' as const, shipId: 'destroyer', rows: [
      { fromLevel: 0, cost: { metal: 45_000, minerals: 22_500, gas: 10_000 }, durationMs: durationMs(0, 4, 12) },
      { fromLevel: 1, cost: { metal: 90_000, minerals: 45_000, gas: 20_000 }, durationMs: durationMs(0, 5, 53) },
    ] },
    { factionId: 'synod' as const, shipId: 'death-star', rows: [
      { fromLevel: 0, cost: { metal: 2_000_000, minerals: 1_000_000, gas: 500_000 }, durationMs: durationMs(0, 10, 48) },
      { fromLevel: 1, cost: { metal: 4_000_000, minerals: 2_000_000, gas: 1_000_000 }, durationMs: durationMs(0, 15, 7) },
    ] },
    { factionId: 'veyra' as const, shipId: 'transporter', rows: [
      { fromLevel: 0, cost: { metal: 1_600, minerals: 800, gas: 0 }, durationMs: durationMs(0, 3, 0) },
      { fromLevel: 1, cost: { metal: 3_200, minerals: 1_600, gas: 0 }, durationMs: durationMs(0, 3, 45) },
    ] },
    { factionId: 'veyra' as const, shipId: 'destroyer', rows: [
      { fromLevel: 0, cost: { metal: 25_000, minerals: 15_000, gas: 1_500 }, durationMs: durationMs(0, 3, 36) },
      { fromLevel: 1, cost: { metal: 50_000, minerals: 30_000, gas: 3_000 }, durationMs: durationMs(0, 5, 2) },
    ] },
    { factionId: 'veyra' as const, shipId: 'death-star', rows: [
      { fromLevel: 0, cost: { metal: 2_000_000, minerals: 1_000_000, gas: 500_000 }, durationMs: durationMs(0, 9, 36) },
      { fromLevel: 1, cost: { metal: 4_000_000, minerals: 2_000_000, gas: 1_000_000 }, durationMs: durationMs(0, 13, 26) },
    ] },
  ] as const;

  for (const fixture of fixtures) {
    for (const expected of fixture.rows) {
      const state = createDefaultSpaceportUpgradeState();
      state.shipLevels[fixture.shipId] = expected.fromLevel;
      const preview = previewSpaceportUpgrade({ ...context(state), factionId: fixture.factionId }, 'ships', fixture.shipId);
      assert.deepEqual(preview.cost, expected.cost, `${fixture.factionId} ${fixture.shipId} ${expected.fromLevel} → ${expected.fromLevel + 1} cost`);
      assert.equal(preview.baseDurationMs, expected.durationMs, `${fixture.factionId} ${fixture.shipId} ${expected.fromLevel} → ${expected.fromLevel + 1} duration`);
    }
  }

  assert.notDeepEqual(
    FACTION_SPACEPORT_UPGRADE_BALANCE_V1.aegis.destroyer[0],
    FACTION_SPACEPORT_UPGRADE_BALANCE_V1.synod.destroyer[0],
    'Synod must not fall back to the Aegis destroyer table',
  );
  assert.notDeepEqual(
    FACTION_SPACEPORT_UPGRADE_BALANCE_V1.aegis['death-star'][0],
    FACTION_SPACEPORT_UPGRADE_BALANCE_V1.veyra['death-star'][0],
    'Veyra must not fall back to the Aegis death-star table',
  );
});

test('Time Rebalanced upgrade durations cover every ordinary ship, faction, and L → L+1 transition', () => {
  let checkedTransitions = 0;
  for (const factionId of ['aegis', 'synod', 'veyra'] as const) {
    for (const shipId of ORDINARY_UPGRADE_SHIP_IDS) {
      const rows = FACTION_SPACEPORT_UPGRADE_BALANCE_V1[factionId][shipId];
      const times = FACTION_SHIP_UPGRADE_TIMES[factionId][shipId];
      assert.equal(rows.length, 10, `${factionId}/${shipId} must expose ten transitions`);
      assert.equal(times.length, 10, `${factionId}/${shipId} must expose ten Time Rebalanced durations`);

      for (const fromLevel of Array.from({ length: 10 }, (_, level) => level)) {
        const state = createDefaultSpaceportUpgradeState();
        state.shipLevels[shipId] = fromLevel;
        const preview = previewSpaceportUpgrade({ ...context(state), factionId }, 'ships', shipId);
        assert.equal(preview.currentLevel, fromLevel, `${factionId}/${shipId} current level`);
        assert.equal(preview.projectedLevel, fromLevel, `${factionId}/${shipId} projected level`);
        assert.equal(preview.nextLevel, fromLevel + 1, `${factionId}/${shipId} next level`);
        assert.deepEqual(preview.cost, rows[fromLevel].cost, `${factionId}/${shipId} ${fromLevel} → ${fromLevel + 1} cost`);
        assert.equal(
          preview.baseDurationMs,
          parseTimeRebalancedDurationMs(times[fromLevel]),
          `${factionId}/${shipId} ${fromLevel} → ${fromLevel + 1} Time Rebalanced duration`,
        );
        checkedTransitions += 1;
      }
    }
  }
  assert.equal(checkedTransitions, 270);
});

test('queued upgrades retain their captured faction-specific duration snapshot', () => {
  const initial = { ...context(), factionId: 'synod' as const };
  const queued = enqueueSpaceportUpgrade(initial, 'ships', 'destroyer', 5_000, 'synod-destroyer');
  assert.equal(queued.ok, true);
  assert.ok(queued.task);
  assert.equal(queued.task.effectiveDurationMs, calculateSpaceportEffectiveDuration(
    FACTION_SPACEPORT_UPGRADE_BALANCE_V1.synod.destroyer[0].durationMs,
    1,
  ));
  const reloadedWithAnotherFaction = { ...initial, factionId: 'veyra' as const, state: queued.state };
  const reconciled = reconcileSpaceportUpgradeState(reloadedWithAnotherFaction.state, 5_000);
  assert.equal(reconciled.state.shipQueue[0]?.effectiveDurationMs, queued.task.effectiveDurationMs);
  assert.equal(reconciled.state.shipQueue[0]?.finishAt, queued.task.finishAt);
});

test('commander balance connects all 13 source files, every 40 transition, and never uses the prototype ×2 cost', () => {
  assert.deepEqual(Object.keys(COMMANDER_UPGRADE_SOURCE_FILES), COMMANDER_COMBAT_CATALOG.map((entity) => entity.id));
  for (const entity of COMMANDER_COMBAT_CATALOG) {
    const rows = COMMANDER_SPACEPORT_UPGRADE_BALANCE[entity.id];
    assert.equal(rows.length, 40, `${entity.id} must expose 40 transitions`);
    assert.equal(rows[0]?.sourceLevel, 1);
    assert.equal(rows[39]?.sourceLevel, 40);

    const state = createDefaultSpaceportUpgradeState();
    state.shipLevels[entity.id] = 0;
    const first = previewSpaceportUpgrade({
      ...context(state),
      wallet: { metal: Number.MAX_SAFE_INTEGER, minerals: Number.MAX_SAFE_INTEGER, gas: Number.MAX_SAFE_INTEGER },
    }, 'commanders', entity.id);
    assert.deepEqual(first.cost, rows[0]?.cost);
    assert.equal(first.baseDurationMs, rows[0]?.durationMs);
    assert.equal(first.costSource, 'commander-ability-upgrades');
    assert.equal(first.gasSpecified, false);

    state.shipLevels[entity.id] = 39;
    const last = previewSpaceportUpgrade({
      ...context(state),
      wallet: { metal: Number.MAX_SAFE_INTEGER, minerals: Number.MAX_SAFE_INTEGER, gas: Number.MAX_SAFE_INTEGER },
    }, 'commanders', entity.id);
    assert.deepEqual(last.cost, rows[39]?.cost);
    assert.equal(last.baseDurationMs, rows[39]?.durationMs);
    assert.equal(last.nextLevel, 40);
    assert.notDeepEqual(first.cost, { metal: 500, minerals: 250, gas: 0 });
  }
});

test('commander preview and enqueue use the same effective duration in Production and Test modes', () => {
  for (const mode of ['production', 'test'] as const) {
    for (const spaceportLevel of [0, 4, 10]) {
      for (const fromLevel of [0, 1, 17, 39]) {
        const state = createDefaultSpaceportUpgradeState();
        state.shipLevels.corsair = fromLevel;
        const initial = {
          ...context(state, unlockedScienceLevels(), spaceportLevel),
          wallet: { metal: Number.MAX_SAFE_INTEGER, minerals: Number.MAX_SAFE_INTEGER, gas: Number.MAX_SAFE_INTEGER },
          mode,
          testTimeScale: TEST_TIME_SCALE,
        };
        const preview = previewSpaceportUpgrade(initial, 'commanders', 'corsair');
        const queued = enqueueSpaceportUpgrade(initial, 'commanders', 'corsair', 5_000, `preview-${mode}-${spaceportLevel}-${fromLevel}`);
        assert.equal(queued.ok, true);
        assert.equal(queued.task?.effectiveDurationMs, preview.effectiveDurationMs);
        assert.equal(queued.task?.finishAt, 5_000 + preview.effectiveDurationMs);
        assert.deepEqual(queued.task?.cost, preview.cost);
      }
    }
  }
});

test('Test Mode snapshots the same Spaceport speed policy with accelerated absolute timestamps', () => {
  const queued = enqueueSpaceportUpgrade({ ...context(), mode: 'test' }, 'ships', 'transporter', 5_000, 'test-speed');
  assert.equal(queued.ok, true);
  assert.equal(queued.task?.effectiveDurationMs, 171_000 / TEST_TIME_SCALE);
  assert.equal(queued.task?.finishAt, 5_000 + 171_000 / TEST_TIME_SCALE);
});

test('queued task snapshots Spaceport speed and does not recalculate after building upgrade', () => {
  const startedAt = 5_000;
  const initial = context(createDefaultSpaceportUpgradeState(), unlockedScienceLevels(), 1);
  const queued = enqueueSpaceportUpgrade(initial, 'ships', 'transporter', startedAt, 'snapshot');
  assert.equal(queued.ok, true);
  assert.ok(queued.task);
  assert.equal(queued.task.spaceportLevelAtStart, 1);
  assert.equal(queued.task.effectiveDurationMs, 171_000);
  assert.equal(queued.task.finishAt, startedAt + 171_000);

  const upgradedContext = { ...initial, state: queued.state, spaceportLevel: 10 };
  const beforeFinish = reconcileSpaceportUpgradeState(upgradedContext.state, startedAt + 1_000);
  assert.equal(beforeFinish.changed, false);
  assert.equal(beforeFinish.state.shipQueue[0].finishAt, startedAt + 171_000);
  assert.equal(beforeFinish.state.shipQueue[0].spaceportLevelAtStart, 1);
});

test('already-created queue tasks keep their captured duration after the balance update', () => {
  const legacyDurationMs = 9_000_000;
  const migrated = migrateSpaceportUpgradeState({
    shipLevels: { transporter: 0 },
    shipQueue: [{
      id: 'pre-rebalance',
      shipId: 'transporter',
      fromLevel: 0,
      toLevel: 1,
      startedAt: 5_000,
      finishAt: 5_000 + legacyDurationMs,
      spaceportLevelAtStart: 1,
      effectiveDurationMs: legacyDurationMs,
    }],
  });
  const beforeFinish = reconcileSpaceportUpgradeState(migrated, 6_000);
  assert.equal(beforeFinish.state.shipQueue[0]?.effectiveDurationMs, legacyDurationMs);
  assert.equal(beforeFinish.state.shipQueue[0]?.finishAt, 5_000 + legacyDurationMs);
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

test('cancellation refunds one active task, restarts the remaining queue, and leaves the independent commander queue intact', () => {
  const initial = context();
  initial.wallet = { metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000 };
  const first = enqueueSpaceportUpgrade(initial, 'ships', 'transporter', 1_000, 'ship-active');
  assert.equal(first.ok, true);
  const second = enqueueSpaceportUpgrade({ ...initial, state: first.state, wallet: first.wallet }, 'ships', 'mega-transporter', 1_000, 'ship-waiting');
  assert.equal(second.ok, true);
  const commander = enqueueSpaceportUpgrade({ ...initial, state: second.state, wallet: second.wallet }, 'commanders', 'corsair', 1_000, 'commander-independent');
  assert.equal(commander.ok, true);
  assert.ok(first.task);
  assert.ok(second.task);
  assert.ok(commander.task);

  const beforeRefund = commander.wallet;
  const transition = cancelSpaceportUpgrade({ ...initial, state: commander.state, wallet: beforeRefund }, 'ship-active', 1_100, () => 0);
  assert.equal(transition.ok, true);
  assert.equal(transition.refundPercent, 60);
  assert.deepEqual(transition.refundPercents, [60]);
  assert.deepEqual(transition.canceledTasks.map((task) => task.id), ['ship-active']);
  assert.equal(transition.wallet.metal, beforeRefund.metal + Math.floor((first.task.cost.metal * 60) / 100));
  assert.equal(transition.wallet.minerals, beforeRefund.minerals + Math.floor((first.task.cost.minerals * 60) / 100));
  assert.equal(transition.wallet.gas, beforeRefund.gas);
  assert.deepEqual(transition.state.shipQueue.map((task) => task.id), ['ship-waiting']);
  assert.equal(transition.state.shipQueue[0]?.startedAt, 1_100);
  assert.equal(transition.state.shipQueue[0]?.finishAt, 1_100 + second.task.effectiveDurationMs);
  assert.deepEqual(transition.state.commanderQueue.map((task) => task.id), ['commander-independent']);
  assert.equal(transition.state.commanderQueue[0]?.startedAt, commander.task.startedAt);
  assert.equal(transition.state.commanderQueue[0]?.finishAt, commander.task.finishAt);
});

test('waiting cancellation cascades only dependent later transitions of the same ship and reschedules other ships', () => {
  const initial = context();
  initial.wallet = { metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000 };
  const first = enqueueSpaceportUpgrade(initial, 'ships', 'transporter', 1_000, 'transporter-1');
  assert.equal(first.ok, true);
  const second = enqueueSpaceportUpgrade({ ...initial, state: first.state, wallet: first.wallet }, 'ships', 'transporter', 1_000, 'transporter-2');
  assert.equal(second.ok, true);
  const third = enqueueSpaceportUpgrade({ ...initial, state: second.state, wallet: second.wallet }, 'ships', 'transporter', 1_000, 'transporter-3');
  assert.equal(third.ok, true);
  assert.ok(first.task);
  assert.ok(second.task);
  assert.ok(third.task);

  const samples = [0, 0.999_999];
  const transition = cancelSpaceportUpgrade({ ...initial, state: third.state, wallet: third.wallet }, 'transporter-2', 1_100, () => samples.shift() ?? 0);
  assert.equal(transition.ok, true);
  assert.deepEqual(transition.canceledTasks.map((task) => task.id), ['transporter-2', 'transporter-3']);
  assert.deepEqual(transition.refundPercents, [60, 80]);
  assert.deepEqual(transition.state.shipQueue.map((task) => task.id), ['transporter-1']);
  assert.equal(transition.state.shipQueue[0]?.startedAt, first.task.startedAt);
  assert.equal(transition.state.shipQueue[0]?.finishAt, first.task.finishAt);
  assert.equal(transition.wallet.gas, third.wallet.gas);
});

test('cancellation refund sampling is inclusive from 60% through 80%', () => {
  assert.equal(selectSpaceportCancelRefundPercent(() => 0), 60);
  assert.equal(selectSpaceportCancelRefundPercent(() => 0.5), 70);
  assert.equal(selectSpaceportCancelRefundPercent(() => 0.999_999_999), 80);
});

test('legacy queue tasks without a saved cost cannot receive an invented cancellation refund', () => {
  const migrated = migrateSpaceportUpgradeState({
    shipLevels: { transporter: 0 },
    shipQueue: [{
      id: 'legacy-no-cost',
      shipId: 'transporter',
      fromLevel: 0,
      toLevel: 1,
      startedAt: 1_000,
      finishAt: 20_000,
      spaceportLevelAtStart: 1,
      effectiveDurationMs: 19_000,
    }],
  });
  const initial = context(migrated);
  const result = cancelSpaceportUpgrade(initial, 'legacy-no-cost', 1_100, () => 0);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'Невозможно подтвердить сохранённую стоимость старого задания.');
  assert.deepEqual(result.wallet, initial.wallet);
  assert.equal(result.state.shipQueue.length, 1);
  assert.deepEqual(result.refundPercents, []);
});

test('ordinary ships never exceed level 10 in preview, enqueue, completion or migration', () => {
  const state = createDefaultSpaceportUpgradeState();
  state.shipLevels.transporter = 9;
  const initial = context(state);
  initial.wallet = { metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000 };
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
  initial.wallet = { metal: Number.MAX_SAFE_INTEGER, minerals: Number.MAX_SAFE_INTEGER, gas: Number.MAX_SAFE_INTEGER };
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
    cost: { metal: 100, minerals: 50, gas: 0 },
    costSource: 'faction-factory-upgrades',
    refundEligible: true,
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
  assert.equal(success.wallet.metal, wallet.metal - 1_000);
  assert.equal(success.wallet.minerals, wallet.minerals);
  assert.equal(success.wallet.gas, wallet.gas);
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
  assert.deepEqual(restored.shipQueue[0].cost, { metal: 0, minerals: 0, gas: 0 });
  assert.equal(restored.shipQueue[0].costSource, 'legacy-unknown');
  assert.equal(restored.shipQueue[0].refundEligible, false);
});
