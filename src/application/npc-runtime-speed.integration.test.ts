import assert from 'node:assert/strict';
import test from 'node:test';

import { getNpcSessionEvents } from '../domain/npc/calendar.ts';
import { reconcileRuntime, type RuntimeReconcileEvent } from './reconcile.ts';
import { getPlanetResources, type SaveState } from './contracts.ts';
import { advanceTo, campaign, clone, DAY, keepNpcEvents, npcTargets, START } from './npc-runtime.test-support.ts';

test('zero NPC and campaign speed scale stay isolated from player resources and saved clocks', () => {
  const empty = campaign(0, 'NPC-REPLAY-EMPTY');
  const emptyResult = reconcileRuntime(empty, {
    planetId: empty.currentPlanetId,
    now: START + DAY,
    mode: 'production',
    testTimeScale: 1,
  });
  assert.equal(npcTargets(emptyResult.state).length, 0);
  assert.equal(Object.keys(emptyResult.state.npc!.profiles).length, 0);
  assert.equal(keepNpcEvents(emptyResult.events).length, 0);

  const standard = campaign(1, 'NPC-SPEED-SCALE');
  const faster: SaveState = {
    ...clone(standard),
    worldConfig: { ...standard.worldConfig!, world: { ...standard.worldConfig!.world, campaignSpeed: 'fast' } },
  };
  const end = START + 7 * DAY;
  // NPC owners may attack the player like any other planet; what their
  // battles carry away is the only legal transfer out of the player wallet.
  const lootFromPlayer = () => {
    const loot = new Map<string, { metal: number; minerals: number; gas: number }>();
    return { loot, onEvents: (events: readonly RuntimeReconcileEvent[]) => {
      for (const event of events) if (event.kind === 'flight') for (const { flight } of event.events) {
        if (flight.missionId === 'attack' && flight.destinationPlanetId === 'helion-01' && flight.attackResolution) {
          loot.set(flight.id, flight.attackResolution.loot);
        }
      }
    } };
  };
  const standardLoot = lootFromPlayer();
  const fastLoot = lootFromPlayer();
  const standardResult = advanceTo(clone(standard), end, [end], { onEvents: standardLoot.onEvents });
  const fastResult = advanceTo(clone(faster), end, [end], { onEvents: fastLoot.onEvents });
  // Faster queues legitimately change when an attentive NPC looks again,
  // hence the emitted action IDs are not a speed-independent calendar.
  // The owner's actual online session schedule must nevertheless stay fixed.
  const ownerId = npcTargets(standard)[0]!.ownerId;
  const standardProfile = standardResult.state.npc!.profiles[ownerId]!;
  const fastProfile = fastResult.state.npc!.profiles[ownerId]!;
  assert.deepEqual(
    getNpcSessionEvents(standardProfile, START, end),
    getNpcSessionEvents(fastProfile, START, end),
    'campaign speed cannot rewrite the owner’s online session schedule',
  );
  assert.equal(fastProfile.activity.completedSessions, standardProfile.activity.completedSessions,
    'campaign speed must not change the number of completed online sessions');
  // Campaign speed scales NPC timers, never the player's own income: with no
  // NPC owners the player wallet is identical at both speeds.
  const withoutNpc = (state: SaveState): SaveState => ({ ...clone(state), npc: { ...state.npc!, profiles: {} } });
  const standardControl = reconcileRuntime(withoutNpc(standard), { planetId: standard.currentPlanetId, now: end, mode: 'production', testTimeScale: 1 });
  const fastControl = reconcileRuntime(withoutNpc(faster), { planetId: faster.currentPlanetId, now: end, mode: 'production', testTimeScale: 1 });
  assert.deepEqual(fastControl.state.planets['helion-01']?.resources, standardControl.state.planets['helion-01']?.resources,
    'campaign speed does not change the player income');
  // With NPC owners the speed changes how they attack, so the wallets differ;
  // what the player kept plus what battles carried off must not. Any NPC
  // decision debiting or crediting the player outside a battle would break it.
  // (In this fixture the raided wallet never reaches its stores' cap, so no
  // income is burned at the cap in either run.)
  const playerTotal = (result: { state: SaveState }, loot: Map<string, { metal: number; minerals: number; gas: number }>) => {
    const wallet = getPlanetResources(result.state, 'helion-01');
    const total = { metal: wallet.metal, minerals: wallet.minerals, gas: wallet.gas };
    for (const item of loot.values()) { total.metal += item.metal; total.minerals += item.minerals; total.gas += item.gas; }
    return total;
  };
  assert.deepEqual(playerTotal(fastResult, fastLoot.loot), playerTotal(standardResult, standardLoot.loot),
    'NPC replay never draws resources from the current player except through battle loot');
});
