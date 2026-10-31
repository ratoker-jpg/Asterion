import assert from 'node:assert/strict';
import test from 'node:test';
import { createNpcState, validateNpcState } from './state.ts';
import {
  chooseNpcAutonomyAction,
  updateNpcAutonomyMemory,
  weightNpcAction,
  type NpcAutonomyCandidate,
} from './autonomy-policy.ts';
import type { NpcProfile } from './types.ts';

const ownerId = 'npc-policy-test';
const sourceProfile = createNpcState([ownerId], 'policy-test-salt', 0).profiles[ownerId]!;
const candidates: readonly NpcAutonomyCandidate[] = Object.freeze<NpcAutonomyCandidate[]>([
  { id: 'science-lab', kind: 'science', weight: 1, payload: { target: 'planet-a' } },
  { id: 'new-colony', kind: 'colonize', weight: 1, payload: { slot: 4 } },
]);

function withTraits(profile: NpcProfile, patch: Partial<NpcProfile['traits']>): NpcProfile {
  return { ...profile, traits: { ...profile.traits, ...patch } };
}

test('action selection is stable across reloads and candidate enumeration order', () => {
  const first = chooseNpcAutonomyAction(sourceProfile, candidates, 'decision-17');
  const reloadedProfile = JSON.parse(JSON.stringify(sourceProfile)) as NpcProfile;
  const afterReload = chooseNpcAutonomyAction(reloadedProfile, [...candidates].reverse(), 'decision-17');
  assert.deepEqual(afterReload, first);

  const nextEvent = chooseNpcAutonomyAction(sourceProfile, candidates, 'decision-18');
  assert.deepEqual(chooseNpcAutonomyAction(sourceProfile, candidates, 'decision-18'), nextEvent);
});

test('selection only uses supplied legal candidates and wait shares the draw', () => {
  const invalid = [
    { id: 'bad-zero', kind: 'attack', weight: 0 },
    { id: 'bad-nan', kind: 'attack', weight: Number.NaN },
  ] as NpcAutonomyCandidate[];
  assert.equal(chooseNpcAutonomyAction(sourceProfile, [], 'empty'), null);
  assert.equal(chooseNpcAutonomyAction(sourceProfile, invalid, 'invalid'), null);

  let waits = 0;
  const lowAttention = withTraits(sourceProfile, { attention: 0, persistence: 0 });
  const allowed = new Set(candidates.map(({ id }) => id));
  for (let index = 0; index < 128; index += 1) {
    const selected = chooseNpcAutonomyAction(lowAttention, candidates, `bounded-${index}`);
    if (selected === null) waits += 1;
    assert.ok(selected === null || allowed.has(selected.id));
  }
  assert.ok(waits > 0, 'wait must participate in the weighted draw');
});

test('matching personalities favor different supplied strategies reproducibly', () => {
  const expansion = withTraits(sourceProfile, {
    expansionFocus: 1,
    scienceFocus: 0,
    attention: 1,
    persistence: 1,
  });
  const research = withTraits(sourceProfile, {
    expansionFocus: 0,
    scienceFocus: 1,
    attention: 1,
    persistence: 1,
  });
  assert.ok(weightNpcAction(expansion, 'colonize') > weightNpcAction(expansion, 'science'));
  assert.ok(weightNpcAction(research, 'science') > weightNpcAction(research, 'colonize'));

  const counts = (profile: NpcProfile) => {
    const result = { colonize: 0, science: 0 };
    for (let index = 0; index < 256; index += 1) {
      const selected = chooseNpcAutonomyAction(profile, candidates, `series-${index}`);
      if (selected?.kind === 'colonize') result.colonize += 1;
      if (selected?.kind === 'science') result.science += 1;
    }
    return result;
  };
  const expansionCounts = counts(expansion);
  const researchCounts = counts(research);
  assert.ok(expansionCounts.colonize > expansionCounts.science, JSON.stringify(expansionCounts));
  assert.ok(researchCounts.science > researchCounts.colonize, JSON.stringify(researchCounts));
  assert.deepEqual(counts(expansion), expansionCounts);
});

test('memory learns only explicit fact references and records event outcomes once', () => {
  const noFacts = updateNpcAutonomyMemory(sourceProfile, 'event-no-facts', 5, 'battle-loss', false, []);
  assert.equal(noFacts, sourceProfile);

  const learned = updateNpcAutonomyMemory(sourceProfile, 'battle-1', 10, 'attack', true,
    ['visible-report-1', 'visible-report-1', 'observed-loss-2']);
  assert.equal(learned.memory.length, 1);
  assert.deepEqual(learned.memory[0]?.factIds, ['visible-report-1', 'observed-loss-2']);
  assert.equal(learned.memory[0]?.valence, 0.75);
  assert.equal(learned.longTermGoals.at(-1)?.kind, 'attack');
  assert.equal(learned.longTermGoals.at(-1)?.status, 'active');
  assert.ok(learned.planning.reconsiderAt! > 10);

  assert.equal(updateNpcAutonomyMemory(learned, 'battle-1', 10, 'attack', true,
    ['visible-report-1']), learned);
  const beforeReconsideration = updateNpcAutonomyMemory(learned, 'battle-2', 11, 'science', false,
    ['observed-research-queue']);
  assert.equal(beforeReconsideration.longTermGoals.at(-1)?.kind, 'attack');
  assert.equal(beforeReconsideration.planning.reconsiderAt, learned.planning.reconsiderAt);
});

test('a fact-backed battle loss changes attack weight and forces timely goal reconsideration', () => {
  const cautiousLearner = withTraits(sourceProfile, {
    militaryFocus: 0.8,
    aggression: 0.7,
    adaptability: 1,
    persistence: 0,
    riskTolerance: 0,
  });
  const priorGoal = updateNpcAutonomyMemory(cautiousLearner, 'prior-goal', 100, 'colonize', true,
    ['observed-colony-progress']);
  assert.equal(priorGoal.longTermGoals.at(-1)?.kind, 'colonize');
  const attackBefore = weightNpcAction(priorGoal, 'attack');

  const learnedLoss = updateNpcAutonomyMemory(priorGoal, 'battle-loss-1', 101, 'battle-loss', false,
    ['own-battle-report-1']);
  assert.ok(weightNpcAction(learnedLoss, 'attack') < attackBefore);
  // A battle is no goal: the goal stands until the next look reconsiders it (due at once).
  assert.ok(learnedLoss.longTermGoals.every((goal) => !goal.kind.startsWith('battle-')));
  assert.equal(learnedLoss.planning.reconsiderAt, 101);
  const nextLook = updateNpcAutonomyMemory(learnedLoss, 'look-after-loss', 102, 'production', true, ['decision:look-after-loss'],
    { goalKind: 'production', goalKinds: new Set(['production', 'attack']) });
  assert.equal(nextLook.longTermGoals.find((goal) => goal.kind === 'colonize')?.status, 'paused');
  assert.equal(nextLook.longTermGoals.at(-1)?.kind, 'production');
  assert.ok(nextLook.planning.reconsiderAt! > 102);
  assert.ok(validateNpcState({ version: 1, personaSalt: 'policy-test-salt', profiles: { [ownerId]: learnedLoss } }));
});

test('battle wins count for attack weight, under their name and the old one', () => {
  const learner = withTraits(sourceProfile, { adaptability: 1, persistence: 0, riskTolerance: 0.5 });
  const before = weightNpcAction(learner, 'attack');
  assert.ok(weightNpcAction(updateNpcAutonomyMemory(learner, 'win-1', 100, 'battle-win', true, ['own-report-win-1']), 'attack') > before);
  assert.ok(weightNpcAction(updateNpcAutonomyMemory(learner, 'win-old', 100, 'battle-victory', true, ['own-report-win-old']), 'attack') > before,
    'a win saved before the fix still counts');
});

test('a look full of started/denied entries does not push battles out of memory', () => {
  let profile = updateNpcAutonomyMemory(sourceProfile, 'fight-1', 10, 'battle-loss', false, ['own-report-fight-1']);
  for (let index = 0; index < 200; index += 1) {
    profile = updateNpcAutonomyMemory(profile, `look:${index}`, 11 + index, index % 2 ? 'production' : 'attack', index % 3 > 0,
      [`decision:look:${index}`]);
  }
  assert.ok(profile.memory.some((entry) => entry.kind === 'battle-loss'), 'the battle survives 200 decisions');
  assert.equal(profile.memory.filter((entry) => !entry.kind.startsWith('battle-')).length, 64);
  for (let index = 0; index < 30; index += 1) {
    profile = updateNpcAutonomyMemory(profile, `fight-${index + 2}`, 1000 + index, index % 2 ? 'battle-win' : 'battle-loss', index % 2 === 1,
      [`own-report-fight-${index + 2}`]);
  }
  assert.equal(profile.memory.filter((entry) => entry.kind.startsWith('battle-')).length, 16, 'battles keep a ring of their own');
  assert.ok(validateNpcState({ version: 1, personaSalt: 'policy-test-salt', profiles: { [ownerId]: profile } }));
});

test('adaptability, persistence, and risk tolerance scale the effect of fact-backed outcomes', () => {
  const cautious = withTraits(sourceProfile, { adaptability: 1, persistence: 0, riskTolerance: 0 });
  const persistentRiskTaker = withTraits(sourceProfile, { adaptability: 0, persistence: 1, riskTolerance: 1 });
  const recordLoss = (profile: NpcProfile, eventId: string) => updateNpcAutonomyMemory(
    profile, eventId, 100, 'battle-loss', false, [`own-report-${eventId}`],
  );
  const cautiousBefore = weightNpcAction(cautious, 'attack');
  const persistentBefore = weightNpcAction(persistentRiskTaker, 'attack');
  const cautiousAfter = weightNpcAction(recordLoss(cautious, 'cautious-loss'), 'attack');
  const persistentAfter = weightNpcAction(recordLoss(persistentRiskTaker, 'persistent-loss'), 'attack');
  assert.ok(cautiousAfter / cautiousBefore < persistentAfter / persistentBefore,
    'adaptive low-persistence cautious profiles should reduce attack weight more after a witnessed loss');
});

test('recon and diplomacy observations also invalidate a still-live goal', () => {
  const profile = sourceProfile;
  for (const outcomeKind of ['recon', 'diplomacy']) {
    const priorGoal = updateNpcAutonomyMemory(profile, `${outcomeKind}-goal`, 100, 'colonize', true,
      [`${outcomeKind}-setup-fact`]);
    const reconsidered = updateNpcAutonomyMemory(priorGoal, `${outcomeKind}-outcome`, 101, outcomeKind, true,
      [`${outcomeKind}-observed-fact`]);
    assert.equal(reconsidered.longTermGoals.find((goal) => goal.kind === 'colonize')?.status, 'paused');
    assert.equal(reconsidered.longTermGoals.at(-1)?.kind, outcomeKind);
    assert.ok(reconsidered.planning.reconsiderAt! > 101);
  }
});

test('saved memory and long-term goals remain bounded through repeated outcomes', () => {
  const shortHorizon = withTraits(sourceProfile, {
    planningHorizon: 0,
  });
  const horizonMs = 6 * 60 * 60 * 1000;
  let profile: NpcProfile = { ...shortHorizon, planning: { ...shortHorizon.planning, horizon: 0 } };
  for (let index = 0; index < 100; index += 1) {
    profile = updateNpcAutonomyMemory(profile, `event-${index}`, index * (horizonMs + 1),
      index % 2 === 0 ? 'recon' : 'pve', index % 2 === 0, [`fact-${index}`]);
  }
  assert.equal(profile.memory.length, 64);
  assert.equal(profile.longTermGoals.length, 8);
  assert.equal(profile.memory[0]?.id, `npc-memory:${ownerId}:event-36`);
  assert.equal(profile.longTermGoals.at(-1)?.id, `npc-goal:${ownerId}:event-99`);
  assert.ok(validateNpcState({ version: 1, personaSalt: 'policy-test-salt', profiles: { [ownerId]: profile } }));

  const nearLimit = updateNpcAutonomyMemory(sourceProfile, 'max-safe-time', Number.MAX_SAFE_INTEGER,
    'wait', true, ['explicit-terminal-fact']);
  assert.equal(nearLimit.planning.reconsiderAt, Number.MAX_SAFE_INTEGER);
  assert.ok(validateNpcState({ version: 1, personaSalt: 'policy-test-salt', profiles: { [ownerId]: nearLimit } }));
});

test('v1 validation rejects out-of-range policy values and unsafe reconsideration timestamps', () => {
  const remembered = updateNpcAutonomyMemory(sourceProfile, 'validation-fact', 10, 'attack', true,
    ['visible-validation-fact']);
  const profile = {
    ...remembered,
    knowledge: { report: { level: 0.5, confidence: 0.5, observedAt: 10 } },
  };
  const valid = { version: 1, personaSalt: 'policy-test-salt', profiles: { [ownerId]: profile } };
  assert.ok(validateNpcState(valid));

  const numericCases: Array<(entry: Record<string, any>) => void> = [
    ...Object.keys(profile.traits).map((key) => (entry: Record<string, any>) => { entry.traits[key] = -0.01; }),
    ...Object.keys(profile.traits).map((key) => (entry: Record<string, any>) => { entry.traits[key] = 1.01; }),
    (entry) => { entry.planning.horizon = -0.01; },
    (entry) => { entry.planning.commitment = 1.01; },
    (entry) => { entry.knowledge.report.level = -0.01; },
    (entry) => { entry.knowledge.report.confidence = 1.01; },
    (entry) => { entry.activity.propensity = -0.01; },
    (entry) => { entry.memory[0].valence = 1.01; },
    (entry) => { entry.memory[0].salience = -0.01; },
    (entry) => { entry.longTermGoals[0].priority = 1.01; },
    (entry) => { entry.longTermGoals[0].progress = -0.01; },
  ];
  for (const mutate of numericCases) {
    const invalid = structuredClone(valid) as unknown as { version: number; personaSalt: string; profiles: Record<string, Record<string, any>> };
    mutate(invalid.profiles[ownerId]!);
    assert.equal(validateNpcState(invalid), false);
  }

  for (const reconsiderAt of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = structuredClone(valid) as unknown as { version: number; personaSalt: string; profiles: Record<string, Record<string, any>> };
    invalid.profiles[ownerId]!.planning.reconsiderAt = reconsiderAt;
    assert.equal(validateNpcState(invalid), false);
  }
});
