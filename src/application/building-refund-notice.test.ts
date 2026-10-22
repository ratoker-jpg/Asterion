import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState } from './persistence.ts';
import { cancelBuilding, describeBuildingRefund, destroyBuilding, startBuilding } from './buildings.ts';
import { getPlanetResources, type SaveState } from './contracts.ts';
import { BUILDING_CANCEL_REFUND_PERCENT, getStorageCapacities } from '../domain/buildings/resource-zone.ts';

const HOME = 'helion-01';
const T0 = 1_000_000;
const ctx = (now = T0) => ({ planetId: HOME, now, mode: 'production' as const, testTimeScale: 1 as const });

function withWallet(state: SaveState, wallet: { metal: number; minerals: number; gas: number }): SaveState {
  return { ...state, ...wallet, planets: { ...state.planets, [HOME]: { ...state.planets[HOME]!, resources: { ...wallet } } } };
}

function startedProject() {
  const started = startBuilding(createInitialSaveState('production', T0), ctx(), 'metal-production-1');
  assert.equal(started.ok, true);
  return started.state;
}

for (const [label, fill] of [['empty', 0], ['partial', 0.5], ['full', 1]] as const) {
  test(`F-06: canceling with a ${label} storage reports accepted + burned = nominal 90%`, () => {
    const state = startedProject();
    const item = state.queues[HOME]![0]!;
    const caps = getStorageCapacities(state.planets[HOME]!.buildings);
    // «partial» leaves room for only part of the refund.
    const nominal = { metal: Math.floor(item.cost!.metal * 0.9), minerals: Math.floor(item.cost!.minerals * 0.9), gas: Math.floor(item.cost!.gas * 0.9) };
    const wallet = fill === 0
      ? { metal: 0, minerals: 0, gas: 0 }
      : fill === 1
        ? { metal: caps.metal, minerals: caps.minerals, gas: caps.gas }
        : { metal: caps.metal - Math.floor(nominal.metal / 2), minerals: caps.minerals - Math.floor(nominal.minerals / 2), gas: caps.gas - Math.floor(nominal.gas / 2) };
    const filled = withWallet(state, wallet);
    const canceled = cancelBuilding(filled, ctx(T0 + 1), item.id);
    assert.equal(canceled.ok, true);
    const credit = canceled.credit!;
    for (const key of ['metal', 'minerals', 'gas'] as const) {
      assert.equal(credit.accepted[key] + credit.burned[key], nominal[key], key);
      assert.equal(getPlanetResources(canceled.state, HOME)[key], wallet[key] + credit.accepted[key], `${key} wallet grows by accepted only`);
    }
    const notice = describeBuildingRefund(BUILDING_CANCEL_REFUND_PERCENT, credit);
    if (fill === 0) assert.equal(notice, 'Возвращено 90% ресурсов.');
    else assert.match(notice, /склад переполнен — сгорело/);
    if (fill === 1) assert.match(notice, /зачислено ничего/);

    // A second cancel of the same project credits nothing.
    const again = cancelBuilding(canceled.state, ctx(T0 + 2), item.id);
    assert.equal(again.ok, false);
    assert.deepEqual(getPlanetResources(again.state, HOME), getPlanetResources(canceled.state, HOME));
  });
}

test('F-06: destroying a level on a full storage reports the burned refund too', () => {
  const initial = createInitialSaveState('production', T0);
  const caps = getStorageCapacities(initial.planets[HOME]!.buildings);
  const full = withWallet(initial, { metal: caps.metal, minerals: caps.minerals, gas: caps.gas });
  const destroyed = destroyBuilding(full, ctx(), 'metal-production-1', () => 0);
  assert.equal(destroyed.ok, true, destroyed.reason ?? '');
  assert.equal(destroyed.refundPercent, 50);
  assert.match(describeBuildingRefund(destroyed.refundPercent!, destroyed.credit), /сгорело/);
});
