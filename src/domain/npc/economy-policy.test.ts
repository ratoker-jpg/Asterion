import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseNpcEconomyAction, NPC_ECONOMY_ROLES } from './economy-policy.ts';
import { createNpcState } from './state.ts';
import type { SpyTargetState } from '../espionage/types.ts';
import type { BuildAvailability, BuildingRole } from '../buildings/resource-zone.ts';

const availability = { canBuild: true } as BuildAvailability;
const target = {
  id: 'planet-npc-a', ownerId: 'npc-a', kind: 'npc',
  resources: { metal: 100, minerals: 100, gas: 100, debris: 0, developmentEnergy: 100 },
  buildings: { 'metal-storage': 0, 'mineral-storage': 0, 'gas-storage': 0 },
} as unknown as SpyTargetState;

function candidate(role: BuildingRole) { return { role, availability }; }

test('policy chooses only caller-supplied legal economy roles and repeats identically', () => {
  const profile = createNpcState(['npc-a'], 'policy-salt', 0).profiles['npc-a']!;
  const candidates = [candidate('metal-production-1'), candidate('trade-center')];
  const first = chooseNpcEconomyAction(profile, target, candidates, 'event-1');
  const again = chooseNpcEconomyAction(profile, target, candidates, 'event-1');
  assert.deepEqual(first, again);
  assert.ok(first.role === null || first.role === 'metal-production-1');
  assert.equal(first.idempotencyKey.includes(profile.privateSeed), false);
  assert.ok(NPC_ECONOMY_ROLES.includes('construction'));
  assert.equal(NPC_ECONOMY_ROLES.includes('research' as BuildingRole), false);
});

test('policy waits when no legal in-scope action is available', () => {
  const profile = createNpcState(['npc-a'], 'policy-salt', 0).profiles['npc-a']!;
  const action = chooseNpcEconomyAction(profile, target, [candidate('trade-center')], 'event-2');
  assert.deepEqual({ role: action.role, wait: action.wait }, { role: null, wait: true });
});
