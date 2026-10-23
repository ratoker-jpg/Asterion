import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseNpcDevelopmentAction,
  chooseNpcEconomyAction,
  NPC_ECONOMY_ROLES,
} from './economy-policy.ts';
import { createNpcState } from './state.ts';
import { createDefaultScienceState, previewScience } from '../science/runtime.ts';
import type { NpcProfile } from './types.ts';
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
  assert.ok(NPC_ECONOMY_ROLES.includes('research'));
  // The legacy entry point remains economy-only even if a caller supplies a lab.
  const withLab = chooseNpcEconomyAction(profile, target, [candidate('research')], 'event-legacy-lab');
  assert.deepEqual({ role: withLab.role, wait: withLab.wait }, { role: null, wait: true });
});

test('policy waits when no legal in-scope action is available', () => {
  const profile = createNpcState(['npc-a'], 'policy-salt', 0).profiles['npc-a']!;
  const action = chooseNpcEconomyAction(profile, target, [candidate('trade-center')], 'event-2');
  assert.deepEqual({ role: action.role, wait: action.wait }, { role: null, wait: true });
});

test('development policy uses actual startable science previews and returns a stable single action', () => {
  const profile = createNpcState(['npc-a'], 'development-policy-salt', 0).profiles['npc-a']!;
  const context = {
    state: createDefaultScienceState(),
    wallet: { metal: 1e9, minerals: 1e9, gas: 1e9, energy: 1e9 },
    laboratoryLevel: 1,
    now: 0,
  };
  const legalPreview = previewScience(context, 1);
  const unavailablePreview = previewScience({ ...context, laboratoryLevel: 0 }, 1);
  assert.equal(legalPreview.canStart, true);
  assert.equal(unavailablePreview.canStart, false);

  const candidates = [candidate('metal-production-1'), candidate('trade-center')];
  const first = chooseNpcDevelopmentAction(profile, target, candidates, [legalPreview, unavailablePreview], 'event-3');
  const again = chooseNpcDevelopmentAction(profile, target, candidates, [legalPreview, unavailablePreview], 'event-3');
  assert.deepEqual(first, again);
  assert.ok(first.wait || first.role === 'metal-production-1' || first.scienceId === 1);
  assert.equal(first.role !== null && first.scienceId !== null, false);
  assert.equal(first.idempotencyKey.includes(profile.privateSeed), false);
});

test('scienceFocus measurably shifts the deterministic shared choice toward science', () => {
  const context = {
    state: createDefaultScienceState(),
    wallet: { metal: 1e9, minerals: 1e9, gas: 1e9, energy: 1e9 },
    laboratoryLevel: 1,
    now: 0,
  };
  const science = previewScience(context, 1);
  assert.equal(science.canStart, true);
  const buildingCandidates = [candidate('metal-production-1')];
  let lowFocusScience = 0;
  let highFocusScience = 0;

  for (let index = 0; index < 128; index += 1) {
    const base = createNpcState(['npc-a'], `development-policy-${index}`, 0).profiles['npc-a']!;
    const lowProfile = withFocus(base, { economyFocus: 0.5, scienceFocus: 0 });
    const highProfile = withFocus(base, { economyFocus: 0.5, scienceFocus: 1 });
    const eventId = `event-${index}`;
    if (chooseNpcDevelopmentAction(lowProfile, target, buildingCandidates, [science], eventId).scienceId === 1) {
      lowFocusScience += 1;
    }
    if (chooseNpcDevelopmentAction(highProfile, target, buildingCandidates, [science], eventId).scienceId === 1) {
      highFocusScience += 1;
    }
  }

  assert.ok(highFocusScience > lowFocusScience, `expected high science focus to choose more science (${highFocusScience} <= ${lowFocusScience})`);
});

test('scienceFocus raises level-0 laboratory preference relative to economyFocus', () => {
  const candidates = [candidate('research'), candidate('metal-production-1')];
  let lowScienceFocusLabs = 0;
  let highScienceFocusLabs = 0;

  for (let index = 0; index < 128; index += 1) {
    const base = createNpcState(['npc-a'], `laboratory-focus-${index}`, 0).profiles['npc-a']!;
    const lowScienceProfile = withFocus(base, { economyFocus: 1, scienceFocus: 0 });
    const highScienceProfile = withFocus(base, { economyFocus: 0, scienceFocus: 1 });
    const eventId = `lab-event-${index}`;
    if (chooseNpcDevelopmentAction(lowScienceProfile, target, candidates, [], eventId).role === 'research') {
      lowScienceFocusLabs += 1;
    }
    if (chooseNpcDevelopmentAction(highScienceProfile, target, candidates, [], eventId).role === 'research') {
      highScienceFocusLabs += 1;
    }
  }

  assert.ok(highScienceFocusLabs > lowScienceFocusLabs,
    `expected science focus to choose more level-0 labs (${highScienceFocusLabs} <= ${lowScienceFocusLabs})`);
});

test('laboratory weight decays with lab level and is zero when supplied previews show a full queue', () => {
  const candidates = [candidate('research'), candidate('metal-production-1')];
  let levelZeroLabs = 0;
  let levelThreeLabs = 0;
  for (let index = 0; index < 128; index += 1) {
    const profile = withFocus(createNpcState(['npc-a'], `lab-decay-${index}`, 0).profiles['npc-a']!, {
      economyFocus: 0,
      scienceFocus: 1,
    });
    const eventId = `lab-level-${index}`;
    if (chooseNpcDevelopmentAction(profile, target, candidates, [], eventId).role === 'research') {
      levelZeroLabs += 1;
    }
    if (chooseNpcDevelopmentAction(profile, {
      ...target,
      buildings: { ...target.buildings, research: 3 },
    }, candidates, [], eventId).role === 'research') {
      levelThreeLabs += 1;
    }
  }
  const fullQueuePreview = {
    ...previewScience({
      state: createDefaultScienceState(),
      wallet: { metal: 1e9, minerals: 1e9, gas: 1e9, energy: 1e9 },
      laboratoryLevel: 0,
      now: 0,
    }, 1),
    status: 'queue-full' as const,
    canStart: false,
  };
  const withFullQueue = chooseNpcDevelopmentAction(
    withFocus(createNpcState(['npc-a'], 'lab-decay-queue', 0).profiles['npc-a']!, {
      economyFocus: 0,
      scienceFocus: 1,
    }),
    target,
    [candidate('research')],
    [fullQueuePreview],
    'lab-queue-full',
  );

  assert.ok(levelZeroLabs > levelThreeLabs,
    `expected fewer lab picks at level 3 (${levelThreeLabs} >= ${levelZeroLabs})`);
  assert.equal(withFullQueue.wait, true);
});

function withFocus(
  profile: NpcProfile,
  focus: Readonly<{ economyFocus: number; scienceFocus: number }>,
): NpcProfile {
  return {
    ...profile,
    traits: { ...profile.traits, ...focus, mechanicsKnowledge: 1 },
  };
}
