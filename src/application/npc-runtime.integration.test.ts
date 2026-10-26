import assert from 'node:assert/strict';
import test from 'node:test';

import { CAMPAIGN_SPEED_SCALE } from '../domain/runtime/mode.ts';
import { getNpcBuildingCandidates, settleNpcPlanet, startNpcBuilding } from './npc-economy.ts';
import { isNpcCatchupPending } from './npc-catchup.ts';
import { reconcileRuntime } from './reconcile.ts';
import { createPersistenceFacade } from './persistence.ts';
import type { SaveState } from './contracts.ts';
import { generateNpcReplayEvents } from './npc-replay.ts';
import { MAX_PLANETS_PER_OWNER } from '../domain/universe/runtime.ts';
import { npcReplayDays } from './npc-horizon.test-support.ts';
import {
  advanceTo, campaign, clone, DAY, economySnapshot, HOUR, irregularSteps, keepNpcEvents, memoryStorage, npcTargets,
  ownerEconomy, sessionIntervals, START,
} from './npc-runtime.test-support.ts';

// The frozen-target reload test lives in npc-runtime-reload.integration.test.ts
// and the speed-scale test in npc-runtime-speed.integration.test.ts, so the
// long replays run in parallel processes.

test('NPC runtime replay is equivalent at 1 and 7 days (30 on main and nightly) across continuous and irregular chunks', () => {
  const initial = campaign(1, 'NPC-REPLAY-EQUIVALENCE');
  assert.equal(npcTargets(initial).length, 1);

  for (const days of npcReplayDays([1, 7, 30])) {
    const targetAt = START + days * DAY;
    const continuous = advanceTo(clone(initial), targetAt, [targetAt]);
    const chunked = advanceTo(clone(initial), targetAt, irregularSteps(targetAt));

    assert.deepEqual(economySnapshot(chunked.state), economySnapshot(continuous.state), `${days}-day economy and replay metadata`);
    assert.deepEqual(chunked.emissions, continuous.emissions, `${days}-day NPC event emission sequence`);
    const ownerId = npcTargets(initial)[0]!.ownerId;
    const intervals = sessionIntervals(initial.npc!.profiles[ownerId]!, START, targetAt);
    for (const entry of continuous.emissions) {
      if (entry.kind !== 'npc-economy') continue;
      assert.ok(intervals.some(({ start, end }) => entry.event.at >= start && entry.event.at < end),
        `decision ${entry.event.eventId} must happen during its owner's generated online session`);
    }
  }
});

test('NPC decisions run inside generated sessions and debit only their own exact construction cost', () => {
  const initial = campaign(1, 'NPC-REPLAY-OWNER-COST');
  const target = npcTargets(initial)[0]!;
  const ownerId = target.ownerId;
  const horizon = START + 30 * DAY;
  const schedule = generateNpcReplayEvents(initial.npc!, START, horizon + 1, [ownerId]);
  const intervals = sessionIntervals(initial.npc!.profiles[ownerId]!, START, horizon);
  const timeScale = CAMPAIGN_SPEED_SCALE[initial.worldConfig!.world.campaignSpeed];
  let state: SaveState = clone(initial);
  let verified = false;

  for (const scheduled of schedule) {
    if (scheduled.priority !== 'npc-decision') continue;
    // A requested time can span several bounded catch-up slices. Establish the
    // committed prefix immediately before this decision, so the comparison
    // isolates its one debit rather than earlier actions in the same replay.
    state = advanceTo(state, scheduled.at - 1, [scheduled.at - 1]).state;
    const beforeTargets = npcTargets(state);
    const result = reconcileRuntime(state, {
      planetId: state.currentPlanetId,
      now: scheduled.at,
      mode: 'production',
      testTimeScale: 1,
    });
    state = result.state;
    const decision = keepNpcEvents(result.events).find((entry) =>
      entry.kind === 'npc-economy' && entry.event.at === scheduled.at && entry.event.started && Boolean(entry.event.selectedRole));
    if (!decision || decision.kind !== 'npc-economy') continue;
    // One look may do several things; isolate a building that was the only
    // paid action on its planet in that look.
    const samePlanet = keepNpcEvents(result.events).filter((entry) => entry.kind === 'npc-economy' && entry.event.at === scheduled.at
      && entry.event.started && entry.event.planetId === decision.event.planetId);
    if (samePlanet.length !== 1) continue;

    assert.ok(intervals.some(({ start, end }) => decision.event.at >= start && decision.event.at < end),
      'a persisted economic action must occur during the generated online session');
    assert.ok(decision.event.selectedRole);
    const beforeTarget = beforeTargets.find((item) => item.id === decision.event.planetId && item.ownerId === ownerId)!;
    assert.ok(beforeTarget, 'the decision identifies the actual paying owner planet');
    const settled = settleNpcPlanet(beforeTarget, decision.event.at, { timeScale }).target;
    const candidate = getNpcBuildingCandidates(settled, true).find((item) => item.role === decision.event.selectedRole);
    assert.ok(candidate?.availability.canBuild && candidate.availability.cost);
    const expected = startNpcBuilding(settled, decision.event.selectedRole, decision.event.at,
      { timeScale }, decision.event.idempotencyKey);
    assert.equal(expected.ok, true);
    assert.equal(expected.target.resources.metal, settled.resources.metal - candidate.availability.cost.metal);
    assert.equal(expected.target.resources.minerals, settled.resources.minerals - candidate.availability.cost.minerals);
    assert.equal(expected.target.resources.gas, settled.resources.gas - candidate.availability.cost.gas);

    const actualTarget = npcTargets(state).find((item) => item.id === beforeTarget.id)!;
    assert.deepEqual(ownerEconomy(actualTarget), ownerEconomy(expected.target),
      'reconcileRuntime must use the NPC owner wallet and energy ledger for the real building start');
    assert.ok(actualTarget.economyAppliedActionIds?.includes(decision.event.idempotencyKey));
    verified = true;
    break;
  }

  assert.equal(verified, true, 'the seeded 30-day real calendar should reach a legal NPC economy decision');
});


// Owner decision (25.10.2026): a long absence is replayed in full behind a
// progress bar, however long it takes. Today 100 very active owners replay
// one game day in tens of minutes of CPU, so a CI run covers the first six
// hours of the full world; long-horizon correctness is covered by the
// single-NPC 30-day equivalence tests (main and nightly), and the long 100-owner duration is
// measured (not gated) by the npc-full-world CI job.
test('100 real NPC owners finish a 6-hour production replay with their own bounded economy state', () => {
  const initial = campaign(100, 'NPC-REPLAY-100');
  assert.equal(npcTargets(initial).length, 100);
  assert.equal(Object.keys(initial.npc!.profiles).length, 100);
  const targetAt = START + 6 * HOUR;
  const completed = advanceTo(clone(initial), targetAt, [targetAt]);

  assert.equal(completed.state.npcReplay?.processedThroughAt, targetAt);
  assert.equal(isNpcCatchupPending(completed.state), false);
  assert.equal(Object.keys(completed.state.npc!.profiles).length, 100);
  // NPCs colonize through real flights: every owner keeps 1..7 canonical planets.
  const planetsByOwner = new Map<string, number>();
  for (const target of npcTargets(completed.state)) planetsByOwner.set(target.ownerId, (planetsByOwner.get(target.ownerId) ?? 0) + 1);
  assert.equal(planetsByOwner.size, 100);
  for (const [ownerId, count] of planetsByOwner) assert.ok(count >= 1 && count <= MAX_PLANETS_PER_OWNER, `${ownerId} owns ${count} planets`);
  const coordinates = npcTargets(completed.state).map((target) => `${target.coordinate.galaxy}:${target.coordinate.system}:${target.coordinate.position}`);
  assert.equal(new Set(coordinates).size, coordinates.length, 'no two planets share a coordinate');
  for (const target of npcTargets(completed.state)) {
    assert.ok(target.resources.metal >= 0 && target.resources.minerals >= 0 && target.resources.gas >= 0);
    assert.ok(target.buildingQueue!.length <= 3);
    assert.ok(target.resourceClock!.lastReconciledAt >= targetAt - HOUR,
      `owner ${target.ownerId} is economically settled through the bounded replay prefix`);
  }
});

test('legacy NPC queue and energy ledger survive schema migration and complete through runtime', () => {
  const initial = campaign(1, 'NPC-REPLAY-LEGACY-QUEUE');
  const target = npcTargets(initial)[0]!;
  const candidate = getNpcBuildingCandidates(target).find((item) => item.role === 'basic-energy');
  assert.ok(candidate?.availability.canBuild);
  const started = startNpcBuilding(target, 'basic-energy', START, { timeScale: 1 }, 'legacy-existing-energy-build');
  assert.equal(started.ok, true);
  const expectedTarget = started.target;
  const legacyState: SaveState = {
    ...initial,
    schemaVersion: 24,
    espionage: { ...initial.espionage!, targets: { ...initial.espionage!.targets, [target.id]: expectedTarget } },
  };
  const stored = { ...legacyState } as unknown as Record<string, unknown>;
  delete stored.npc;
  const raw = JSON.stringify(stored);
  const storage = memoryStorage();
  const saveKey = 'npc-runtime-legacy-queue';
  storage.setItem(saveKey, raw);
  const loaded = createPersistenceFacade({ mode: 'production', storage, saveKey, now: () => START + 1_000 }).load();
  assert.equal(loaded.status, 'loaded');
  const migrated = loaded.state.espionage!.targets![target.id]!;
  assert.deepEqual(migrated.buildingQueue, expectedTarget.buildingQueue);
  assert.deepEqual(migrated.energyLedger, expectedTarget.energyLedger);
  assert.deepEqual(migrated.resources, expectedTarget.resources);

  const finishAt = migrated.buildingQueue![0]!.finishAt;
  const completed = advanceTo(loaded.state, finishAt, [finishAt]);
  const after = completed.state.espionage!.targets![target.id]!;
  assert.equal(after.buildings['basic-energy'], expectedTarget.buildings['basic-energy']! + 1);
  assert.equal(after.buildingQueue!.some((item) => item.id === expectedTarget.buildingQueue![0]!.id), false);
  assert.ok(after.energyLedger);
  assert.ok(after.energyLedger.availableEnergy >= migrated.energyLedger!.availableEnergy);
});

