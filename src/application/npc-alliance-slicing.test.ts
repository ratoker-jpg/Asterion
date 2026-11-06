// NPC alliance choice (leaving, joining, consolidating) is decided inside the replay.
// The world must come out the same wherever calculation slices end and across reloads.
import assert from 'node:assert/strict';
import test from 'node:test';

import { acceptApplication, applyToAlliance, createAlliance } from '../domain/command/membership.ts';
import { selectOwnerMembership } from '../domain/command/selectors.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';
import { freezeNpcCatchupTarget, isNpcCatchupPending } from './npc-catchup.ts';
import { reconcileRuntime } from './reconcile.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { memoryStorage } from './npc-runtime.test-support.ts';

const T0 = Date.UTC(2026, 10, 1, 12);
const HOUR = 3_600_000;
const DAYS = 2;
const targetAt = T0 + DAYS * 24 * HOUR;
const SETTINGS = (name: string, tag: string) => ({ name, tag, motto: '', description: '', emblem: { glyph: 'starforge' as const, accent: 'cyan' as const } });

/** Restless warlike NPCs sit in a weak alliance next to a strong one: somebody walks out during the replay. */
function fixture(): { state: SaveState; leavers: string[] } {
  const config = createDefaultNewGameConfig({ seed: 'ALLIANCESLICE', factionId: 'aegis', playerName: 'Игрок' });
  const initial = createInitialSaveState('production', T0, { ...config, world: { ...config.world, npcCount: 6 } });
  const ids = [...new Set(Object.values(initial.espionage!.targets!).filter((target) => target.kind === 'npc').map((target) => target.ownerId))].sort();
  let state: SaveState = { ...initial, npc: createNpcState(ids, 'alliance-slicing', T0) };
  const [weakLeader, a, b, strongLeader] = ids as [string, string, string, string];
  const found = (ownerId: string, name: string, tag: string) => {
    const made = createAlliance(state.command, { ownerId, displayName: ownerId, settings: SETTINGS(name, tag) }, { now: T0 - 48 * HOUR, random: () => 0.3 });
    assert.equal(made.ok, true);
    state = { ...state, command: made.state };
  };
  const join = (ownerId: string, leaderId: string) => {
    const alliance = selectOwnerMembership(state.command, leaderId)!.alliance;
    const applied = applyToAlliance(state.command, { ownerId, displayName: ownerId, allianceId: alliance.id }, { now: T0 - 47 * HOUR });
    assert.equal(applied.ok, true);
    const accepted = acceptApplication(applied.state, leaderId, applied.applicationId, { now: T0 - 47 * HOUR, random: () => 0.5 });
    assert.equal(accepted.ok, true);
    state = { ...state, command: accepted.state };
  };
  found(weakLeader, 'Слабые', 'WEK');
  found(strongLeader, 'Сильные', 'STR');
  join(a, weakLeader);
  join(b, weakLeader);
  const profiles = { ...state.npc!.profiles };
  for (const id of [a, b]) {
    profiles[id] = { ...profiles[id]!, traits: { ...profiles[id]!.traits, militaryFocus: 1, aggression: 1, economyFocus: 0, cooperation: 0.1, persistence: 0, adaptability: 1 } };
  }
  state = {
    ...state,
    npc: { ...state.npc!, profiles },
    rating: { ...state.rating, archivedBattlePoints: { ...state.rating.archivedBattlePoints, [strongLeader]: 600_000 } },
  };
  return { state, leavers: [a, b] };
}

function drain(start: SaveState, groups: number, reload = false): SaveState {
  let current = freezeNpcCatchupTarget(start, targetAt);
  while (isNpcCatchupPending(current)) {
    current = reconcileRuntime(current, { planetId: current.currentPlanetId, now: targetAt, mode: 'production', testTimeScale: 1, replayMaxGroups: groups }).state;
    if (reload) {
      const facade = createPersistenceFacade({ mode: 'production', storage: memoryStorage(), saveKey: 'alliance-slicing', now: () => targetAt });
      assert.equal(facade.write(current).ok, true);
      const loaded = facade.load();
      assert.equal(loaded.status, 'loaded');
      if (loaded.status === 'loaded') current = loaded.state;
    }
  }
  return current;
}

test('NPCs leaving and joining alliances give the same world in any slicing and across reloads', () => {
  const { state, leavers } = fixture();
  const large = drain(state, 100_000);
  const departed = (large.command.departures ?? []).filter((entry) => leavers.includes(entry.ownerId));
  assert.ok(departed.length > 0, 'the scenario really makes somebody leave (otherwise this proves nothing)');
  const small = drain(state, 8);
  assert.equal(JSON.stringify(small.command), JSON.stringify(large.command), 'alliances, applications, departures: identical in 8-group slices');
  assert.equal(JSON.stringify(small.flights.records), JSON.stringify(large.flights.records));
  const reloaded = drain(state, 64, true);
  // Load only re-orders the keys of relation records; the content is compared, not the key order.
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded.command)), JSON.parse(JSON.stringify(large.command)), 'save and load between slices changes nothing');
});
