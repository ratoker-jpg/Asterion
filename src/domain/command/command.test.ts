import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVITY_TOUCH_INTERVAL_MS,
  LEADER_ABSENCE_MS,
  MAX_ALLIANCE_MEMBERS,
  REAPPLY_COOLDOWN_MS,
  TEST_ALLY_OWNER_ID,
  TEST_FIXTURE_ALLIANCE_ID,
} from './catalog.ts';
import {
  acceptApplication,
  applyToAlliance,
  createAlliance,
  creditDeliveredUnits,
  kickMember,
  leaveAlliance,
  pickLeaderSuccessor,
  refreshPresence,
  rejectApplication,
  setDeputy,
  settleLeadership,
  touchMember,
  transferLeadership,
  updateAllianceSettings,
  withdrawApplication,
} from './membership.ts';
import {
  createDefaultCommandState,
  migrateCommandState,
  persistCommandState,
  readCommandState,
} from './repository.ts';
import {
  selectAllianceCatalog,
  selectAllianceRating,
  selectCommandHallLevel,
  selectOwnerAlliance,
  selectOwnerMembership,
  selectPendingApplication,
  selectReapplyBlock,
} from './selectors.ts';
import type { AllianceSettingsInput, CommandResult, CommandState } from './types.ts';
import { syncPlayerProfileWithCommand, createDefaultPlayerProfileState } from '../profile/repository.ts';
import { TEST_OWNER_SCORE_FIXTURES, withTestOwnerScoreFixtures } from '../rating/fixtures.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const T0 = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const SAVE_KEY = 'asterion.vertical-slice.v1';
const random = () => 0.42;

function settings(name: string, tag: string, patch: Partial<AllianceSettingsInput> = {}): AllianceSettingsInput {
  return { name, tag, motto: 'Девиз', description: 'Описание', emblem: { glyph: 'orbit', accent: 'amber' }, ...patch };
}

function ok<T extends object>(result: CommandResult<T>) {
  assert.equal(result.ok, true, result.ok ? '' : `${result.code}: ${result.message}`);
  return result as Extract<CommandResult<T>, { ok: true }>;
}

function failure(result: CommandResult<object>, code: string) {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, code, result.message);
}

function found(state: CommandState, owner = 'leader', name = 'Звёздный Дозор', tag = 'DOZ', now = T0) {
  const result = createAlliance(state, { ownerId: owner, displayName: `Имя ${owner}`, settings: settings(name, tag) }, { now, random });
  assert.equal(result.ok, true);
  return result as Extract<typeof result, { ok: true }>;
}

/** Joins `owner` through the real apply + accept flow. */
function join(state: CommandState, allianceId: string, owner: string, actor = 'leader', at = T0) {
  const applied = applyToAlliance(state, { ownerId: owner, displayName: `Имя ${owner}`, allianceId }, { now: at, random });
  assert.equal(applied.ok, true, applied.ok ? '' : applied.message);
  const application = selectPendingApplication(applied.state, owner)!;
  const accepted = acceptApplication(applied.state, actor, application.id, { now: at, random });
  assert.equal(accepted.ok, true, accepted.ok ? '' : accepted.message);
  return accepted.state;
}

function fill(state: CommandState, allianceId: string, count: number, at = T0) {
  let next = state;
  for (let index = 0; index < count; index += 1) next = join(next, allianceId, `member-${index}`, 'leader', at);
  return next;
}

test('production starts without any alliance; Test Mode seeds only the player and Ira Vel', () => {
  const production = createDefaultCommandState('production');
  assert.deepEqual(production, { version: 3, alliances: [], applications: [], cooldowns: [], diplomacy: [], requests: [], aidLedgers: [], aidEvents: [], nextSerial: 1 });

  const test = createDefaultCommandState('test', { playerId: 'player-current', playerDisplayName: 'Dendrilion' });
  assert.equal(test.alliances.length, 1);
  const [alliance] = test.alliances;
  assert.equal(alliance.id, TEST_FIXTURE_ALLIANCE_ID);
  assert.equal(alliance.fixtureId, 'test-command-default-v1');
  assert.equal(alliance.leaderOwnerId, 'player-current');
  assert.deepEqual(alliance.members.map((member) => member.ownerId), ['player-current', TEST_ALLY_OWNER_ID]);
  assert.deepEqual(test.applications, []);
  assert.deepEqual(createDefaultCommandState('test'), createDefaultCommandState('test'));
});

test('default factories do not share mutable state', () => {
  const first = createDefaultCommandState('test');
  const second = createDefaultCommandState('test');
  first.alliances[0].members[0].displayName = 'changed';
  first.alliances[0].emblem.glyph = 'vanguard';
  assert.deepEqual(second, createDefaultCommandState('test'));
});

test('creating an alliance makes the creator its leader with a stable id', () => {
  const created = found(createDefaultCommandState('production'));
  assert.equal(created.allianceId, 'alliance-1');
  const alliance = created.state.alliances[0];
  assert.equal(alliance.leaderOwnerId, 'leader');
  assert.equal(alliance.members.length, 1);
  assert.equal(alliance.members[0].joinedAt, T0);
  assert.equal(alliance.members[0].tieBreaker, 0.42);
  assert.equal(created.state.nextSerial, 2);
  assert.equal(selectOwnerMembership(created.state, 'leader')?.role, 'leader');
});

test('name and tag are unique across the world, case-insensitively, and an owner joins one alliance only', () => {
  const base = found(createDefaultCommandState('production')).state;
  failure(createAlliance(base, { ownerId: 'other', displayName: 'Other', settings: settings('  звёздный   дозор ', 'ZZZ') }, { now: T0 }), 'duplicate_name');
  failure(createAlliance(base, { ownerId: 'other', displayName: 'Other', settings: settings('Другой', 'doz') }, { now: T0 }), 'duplicate_tag');
  failure(createAlliance(base, { ownerId: 'leader', displayName: 'Leader', settings: settings('Новый союз', 'NEW') }, { now: T0 }), 'already_member');
  failure(createAlliance(base, { ownerId: 'other', displayName: 'Other', settings: settings('Aa', 'NEW') }, { now: T0 }), 'invalid_name');
  failure(createAlliance(base, { ownerId: 'other', displayName: 'Other', settings: settings('Хороший союз', 'a b!') }, { now: T0 }), 'invalid_tag');
  failure(createAlliance(base, { ownerId: 'other', displayName: 'Other', settings: settings('Хороший союз', 'X') }, { now: T0 }), 'invalid_tag');
});

test('renaming keeps uniqueness, allows keeping the own name, and needs leader or deputy', () => {
  let state = found(createDefaultCommandState('production')).state;
  state = ok(createAlliance(state, { ownerId: 'rival', displayName: 'Rival', settings: settings('Ржавый Орден', 'RUS') }, { now: T0, random })).state;
  const allianceId = state.alliances[0].id;
  state = join(state, allianceId, 'plain');

  failure(updateAllianceSettings(state, 'leader', settings('ржавый орден', 'DOZ')), 'duplicate_name');
  failure(updateAllianceSettings(state, 'leader', settings('Звёздный Дозор', 'rus')), 'duplicate_tag');
  failure(updateAllianceSettings(state, 'plain', settings('Новое имя', 'NEW')), 'not_allowed');
  failure(updateAllianceSettings(state, 'ghost', settings('Новое имя', 'NEW')), 'not_member');

  const renamed = ok(updateAllianceSettings(state, 'leader', settings('Звёздный Дозор II', 'doz')));
  assert.equal(renamed.state.alliances[0].name, 'Звёздный Дозор II');
  assert.equal(renamed.state.alliances[0].tag, 'DOZ');
  // The identity stays attached to the same stable id, so ratings and the galaxy never double the alliance.
  assert.equal(renamed.state.alliances[0].id, allianceId);
  assert.equal(selectOwnerAlliance(renamed.state, 'plain')?.id, allianceId);
  assert.equal(renamed.state.alliances.length, 2);

  state = ok(setDeputy(state, 'leader', 'plain')).state;
  assert.equal(updateAllianceSettings(state, 'plain', settings('Имя заместителя', 'DEP')).ok, true);
});

test('applications: one pending at a time, withdrawal is free, no instant joining', () => {
  const base = found(createDefaultCommandState('production')).state;
  const second = ok(createAlliance(base, { ownerId: 'rival', displayName: 'Rival', settings: settings('Ржавый Орден', 'RUS') }, { now: T0, random })).state;
  const [first, other] = second.alliances;

  const applied = ok(applyToAlliance(second, { ownerId: 'applicant', displayName: 'Заявитель', allianceId: first.id }, { now: T0 }));
  assert.equal(selectOwnerMembership(applied.state, 'applicant'), null);
  assert.equal(selectPendingApplication(applied.state, 'applicant')?.allianceId, first.id);
  failure(applyToAlliance(applied.state, { ownerId: 'applicant', displayName: 'Заявитель', allianceId: other.id }, { now: T0 }), 'pending_exists');
  failure(applyToAlliance(applied.state, { ownerId: 'leader', displayName: 'L', allianceId: other.id }, { now: T0 }), 'already_member');
  failure(applyToAlliance(applied.state, { ownerId: 'x', displayName: 'X', allianceId: 'alliance-missing' }, { now: T0 }), 'alliance_not_found');

  const withdrawn = ok(withdrawApplication(applied.state, 'applicant', T0 + 1000));
  assert.equal(selectPendingApplication(withdrawn.state, 'applicant'), null);
  assert.equal(withdrawn.state.cooldowns.length, 0, 'withdrawing must not start a delay');
  assert.equal(applyToAlliance(withdrawn.state, { ownerId: 'applicant', displayName: 'Заявитель', allianceId: first.id }, { now: T0 + 2000 }).ok, true);
  failure(withdrawApplication(withdrawn.state, 'applicant', T0), 'application_not_found');
});

test('a refusal blocks the same alliance for two hours but not other alliances', () => {
  let state = found(createDefaultCommandState('production')).state;
  state = ok(createAlliance(state, { ownerId: 'rival', displayName: 'Rival', settings: settings('Ржавый Орден', 'RUS') }, { now: T0, random })).state;
  const [first, other] = state.alliances;
  const applied = ok(applyToAlliance(state, { ownerId: 'applicant', displayName: 'Заявитель', allianceId: first.id }, { now: T0 }));
  const application = selectPendingApplication(applied.state, 'applicant')!;

  failure(rejectApplication(applied.state, 'rival', application.id, T0), 'not_allowed');
  const rejected = ok(rejectApplication(applied.state, 'leader', application.id, T0));
  assert.equal(rejected.state.applications[0].status, 'rejected');
  assert.equal(rejected.state.applications[0].reason, 'declined');

  const blocked = applyToAlliance(rejected.state, { ownerId: 'applicant', displayName: 'Заявитель', allianceId: first.id }, { now: T0 + REAPPLY_COOLDOWN_MS - 1 });
  failure(blocked, 'cooldown');
  assert.equal(!blocked.ok && blocked.retryAt, T0 + REAPPLY_COOLDOWN_MS);
  assert.equal(applyToAlliance(rejected.state, { ownerId: 'applicant', displayName: 'Заявитель', allianceId: other.id }, { now: T0 + 1 }).ok, true);
  assert.equal(applyToAlliance(rejected.state, { ownerId: 'applicant', displayName: 'Заявитель', allianceId: first.id }, { now: T0 + REAPPLY_COOLDOWN_MS }).ok, true);
  failure(rejectApplication(rejected.state, 'leader', application.id, T0), 'application_not_pending');
});

test('leaving or being kicked blocks applying anywhere for two hours', () => {
  let state = found(createDefaultCommandState('production')).state;
  state = ok(createAlliance(state, { ownerId: 'rival', displayName: 'Rival', settings: settings('Ржавый Орден', 'RUS') }, { now: T0, random })).state;
  const [first, other] = state.alliances;
  state = join(state, first.id, 'leaver');
  state = join(state, first.id, 'kicked');

  const left = ok(leaveAlliance(state, 'leaver', T0 + HOUR));
  assert.equal(selectOwnerMembership(left.state, 'leaver'), null);
  failure(applyToAlliance(left.state, { ownerId: 'leaver', displayName: 'L', allianceId: first.id }, { now: T0 + HOUR + 1 }), 'cooldown');
  failure(applyToAlliance(left.state, { ownerId: 'leaver', displayName: 'L', allianceId: other.id }, { now: T0 + HOUR + 1 }), 'cooldown');
  assert.equal(applyToAlliance(left.state, { ownerId: 'leaver', displayName: 'L', allianceId: other.id }, { now: T0 + HOUR + REAPPLY_COOLDOWN_MS }).ok, true);

  failure(kickMember(state, 'kicked', 'leaver', T0), 'not_allowed');
  const kicked = ok(kickMember(state, 'leader', 'kicked', T0 + HOUR));
  failure(applyToAlliance(kicked.state, { ownerId: 'kicked', displayName: 'K', allianceId: other.id }, { now: T0 + HOUR + 5 }), 'cooldown');
  assert.equal(selectReapplyBlock(kicked.state, 'kicked', other.id, T0 + HOUR + 5)?.cause, 'kicked');
  assert.equal(selectReapplyBlock(kicked.state, 'kicked', other.id, T0 + HOUR + REAPPLY_COOLDOWN_MS), null);
});

test('a full alliance (15/15) auto-rejects every pending application with "no seats" and refuses new ones', () => {
  const created = found(createDefaultCommandState('production'));
  const allianceId = created.allianceId;
  let state = fill(created.state, allianceId, MAX_ALLIANCE_MEMBERS - 2); // 14 members incl. the leader
  assert.equal(state.alliances[0].members.length, MAX_ALLIANCE_MEMBERS - 1);

  for (const owner of ['p1', 'p2', 'p3']) {
    state = ok(applyToAlliance(state, { ownerId: owner, displayName: owner, allianceId }, { now: T0 + 1 })).state;
  }
  const first = selectPendingApplication(state, 'p1')!;
  const accepted = ok(acceptApplication(state, 'leader', first.id, { now: T0 + 2, random }));
  assert.equal(accepted.state.alliances[0].members.length, MAX_ALLIANCE_MEMBERS);
  for (const owner of ['p2', 'p3']) {
    assert.equal(selectPendingApplication(accepted.state, owner), null);
    const application = accepted.state.applications.find((candidate) => candidate.ownerId === owner)!;
    assert.equal(application.status, 'auto_rejected');
    assert.equal(application.reason, 'full');
  }
  assert.equal(accepted.state.cooldowns.length, 0, '"no seats" must not start a re-application delay');
  failure(applyToAlliance(accepted.state, { ownerId: 'late', displayName: 'Late', allianceId }, { now: T0 + 3 }), 'alliance_full');
});

test('acceptance re-validates: stale applicant already elsewhere, and a stale full alliance', () => {
  let state = found(createDefaultCommandState('production')).state;
  state = ok(createAlliance(state, { ownerId: 'rival', displayName: 'Rival', settings: settings('Ржавый Орден', 'RUS') }, { now: T0, random })).state;
  const [first, other] = state.alliances;
  const applied = ok(applyToAlliance(state, { ownerId: 'wanderer', displayName: 'W', allianceId: first.id }, { now: T0 }));
  const application = selectPendingApplication(applied.state, 'wanderer')!;

  // The applicant founds their own alliance meanwhile: their pending application is withdrawn.
  const founded = ok(createAlliance(applied.state, { ownerId: 'wanderer', displayName: 'W', settings: settings('Странники', 'WND') }, { now: T0 + 1, random }));
  assert.equal(selectPendingApplication(founded.state, 'wanderer'), null);
  failure(acceptApplication(founded.state, 'leader', application.id, { now: T0 + 2 }), 'application_not_pending');

  // Tampered/stale data: a pending application whose owner is already a member.
  const stale = { ...founded.state, applications: founded.state.applications.map((entry) => entry.id === application.id ? { ...entry, status: 'pending' as const, resolvedAt: null, reason: null } : entry) };
  const result = acceptApplication(stale, 'leader', application.id, { now: T0 + 3 });
  failure(result, 'already_member');
  assert.equal(result.state.applications.find((entry) => entry.id === application.id)?.reason, 'already_member');
  assert.equal(selectOwnerMembership(result.state, 'wanderer')?.alliance.name, 'Странники');
  assert.equal(other.members.length, 1);
});

test('exactly one deputy: only the leader appoints; no second appointment; deputy rights are limited', () => {
  const created = found(createDefaultCommandState('production'));
  const allianceId = created.allianceId;
  let state = fill(created.state, allianceId, 3);

  failure(setDeputy(state, 'member-0', 'member-1'), 'not_allowed');
  state = ok(setDeputy(state, 'leader', 'member-0')).state;
  assert.equal(selectOwnerMembership(state, 'member-0')?.role, 'deputy');
  failure(setDeputy(state, 'leader', 'member-1'), 'deputy_exists');
  failure(setDeputy(state, 'member-0', 'member-1'), 'not_allowed');
  failure(setDeputy(state, 'leader', 'leader'), 'self_target');
  failure(setDeputy(state, 'leader', 'stranger'), 'target_not_member');
  assert.equal(setDeputy(state, 'leader', 'member-0').ok, true, 're-appointing the same deputy is a no-op');

  // Deputy can manage ordinary members but never the leader, and cannot touch itself via kick.
  failure(kickMember(state, 'member-0', 'leader', T0), 'not_allowed');
  failure(kickMember(state, 'member-0', 'member-0', T0), 'self_target');
  assert.equal(kickMember(state, 'member-0', 'member-1', T0).ok, true);
  assert.equal(updateAllianceSettings(state, 'member-0', settings('Звёздный Дозор', 'DOZ')).ok, true);

  // The leader can remove the deputy; a regular member can never kick.
  failure(kickMember(state, 'member-1', 'member-2', T0), 'not_allowed');
  const kickedDeputy = ok(kickMember(state, 'leader', 'member-0', T0));
  assert.equal(kickedDeputy.state.alliances[0].deputyOwnerId, null);
  const dismissed = ok(setDeputy(state, 'leader', null));
  assert.equal(dismissed.state.alliances[0].deputyOwnerId, null);
  assert.equal(setDeputy(dismissed.state, 'leader', 'member-1').ok, true);
});

test('leader exit: must hand over leadership; sole member disbands and closes pending applications', () => {
  const created = found(createDefaultCommandState('production'));
  const allianceId = created.allianceId;
  let state = fill(created.state, allianceId, 2);

  const blocked = leaveAlliance(state, 'leader', T0);
  failure(blocked, 'leader_must_transfer');
  assert.equal(selectOwnerMembership(blocked.state, 'leader')?.role, 'leader', 'a failed exit changes nothing');
  failure(leaveAlliance(state, 'leader', T0, { successorOwnerId: 'stranger' }), 'target_not_member');
  failure(leaveAlliance(state, 'leader', T0, { successorOwnerId: 'leader' }), 'target_not_member');

  const chosen = ok(leaveAlliance(state, 'leader', T0, { successorOwnerId: 'member-1' }));
  assert.equal(chosen.state.alliances[0].leaderOwnerId, 'member-1');
  assert.equal(chosen.disbanded, false);

  state = ok(setDeputy(state, 'leader', 'member-0')).state;
  const viaDeputy = ok(leaveAlliance(state, 'leader', T0));
  assert.equal(viaDeputy.state.alliances[0].leaderOwnerId, 'member-0');
  assert.equal(viaDeputy.state.alliances[0].deputyOwnerId, null);

  failure(transferLeadership(state, 'member-1', 'leader', T0), 'not_allowed');
  const transferred = ok(transferLeadership(state, 'leader', 'member-1', T0 + 5));
  assert.equal(selectOwnerMembership(transferred.state, 'member-1')?.role, 'leader');
  assert.equal(selectOwnerMembership(transferred.state, 'leader')?.role, 'member');
  assert.equal(transferred.state.alliances[0].leaderSince, T0 + 5);

  // A sole member disbands the alliance; applications to it are closed, nothing dangles.
  const solo = found(createDefaultCommandState('production'));
  const withApplicant = ok(applyToAlliance(solo.state, { ownerId: 'hopeful', displayName: 'H', allianceId: solo.allianceId }, { now: T0 }));
  const disbanded = ok(leaveAlliance(withApplicant.state, 'leader', T0 + 10));
  assert.equal(disbanded.disbanded, true);
  assert.deepEqual(disbanded.state.alliances, []);
  assert.equal(disbanded.state.applications[0].status, 'auto_rejected');
  assert.equal(disbanded.state.applications[0].reason, 'disbanded');
  assert.equal(selectPendingApplication(disbanded.state, 'hopeful'), null);
});

test('leader absence for more than 24 hours hands over: deputy first, then delivered units, activity, operations, stored tie-break', () => {
  const created = found(createDefaultCommandState('production'), 'leader', 'Звёздный Дозор', 'DOZ', T0);
  const allianceId = created.allianceId;
  let state = fill(created.state, allianceId, 3, T0);
  const edit = (ownerId: string, patch: Partial<NonNullable<ReturnType<typeof selectOwnerMembership>>['member']>) => {
    state = { ...state, alliances: state.alliances.map((alliance) => ({ ...alliance, members: alliance.members.map((member) => member.ownerId === ownerId ? { ...member, ...patch } : member) })) };
  };

  // Not absent long enough: exactly 24 h is still fine.
  assert.equal(settleLeadership(state, T0 + LEADER_ABSENCE_MS), state);
  // A present owner is never replaced.
  assert.equal(settleLeadership(state, T0 + LEADER_ABSENCE_MS + 1, ['leader']), state);

  // Deputy wins regardless of contribution.
  edit('member-2', { deliveredUnits: 9_999_999 });
  const withDeputy = ok(setDeputy(state, 'leader', 'member-0')).state;
  const byDeputy = settleLeadership(withDeputy, T0 + LEADER_ABSENCE_MS + 1);
  assert.equal(byDeputy.alliances[0].leaderOwnerId, 'member-0');
  assert.equal(byDeputy.alliances[0].deputyOwnerId, null);
  assert.equal(byDeputy.alliances[0].leaderSince, T0 + LEADER_ABSENCE_MS + 1);
  // The clock restarts: no ping-pong back to the old leader on the next pass.
  assert.equal(settleLeadership(byDeputy, T0 + LEADER_ABSENCE_MS + 2), byDeputy);

  // No deputy: most delivered units regardless of resource kind (single aggregate), all types equal.
  assert.equal(pickLeaderSuccessor(state.alliances[0])?.ownerId, 'member-2');
  // Tie on units -> more recent activity.
  edit('member-1', { deliveredUnits: 9_999_999, lastActiveAt: T0 + 500 });
  edit('member-2', { lastActiveAt: T0 + 100 });
  assert.equal(pickLeaderSuccessor(state.alliances[0])?.ownerId, 'member-1');
  // Tie on activity -> joint operations.
  edit('member-1', { lastActiveAt: T0 + 100 });
  edit('member-2', { jointOperationCount: 3 });
  assert.equal(pickLeaderSuccessor(state.alliances[0])?.ownerId, 'member-2');
  // Full tie -> the tie-break value drawn once at join, so repeated evaluation never re-rolls.
  edit('member-2', { jointOperationCount: 0 });
  edit('member-1', { tieBreaker: 0.9 });
  edit('member-2', { tieBreaker: 0.1 });
  assert.equal(pickLeaderSuccessor(state.alliances[0])?.ownerId, 'member-1');
  assert.equal(pickLeaderSuccessor(state.alliances[0])?.ownerId, 'member-1');
  const settled = settleLeadership(state, T0 + LEADER_ABSENCE_MS + 1);
  assert.equal(settled.alliances[0].leaderOwnerId, 'member-1');
});

test('contribution aggregate is stored per membership and credited only for actual units', () => {
  const created = found(createDefaultCommandState('production'));
  let state = join(created.state, created.allianceId, 'helper');
  state = creditDeliveredUnits(state, 'helper', 1_250);
  state = creditDeliveredUnits(state, 'helper', -50);
  state = creditDeliveredUnits(state, 'helper', Number.NaN);
  state = creditDeliveredUnits(state, 'outsider', 999);
  assert.equal(selectOwnerMembership(state, 'helper')?.member.deliveredUnits, 1_250);
  const reloaded = migrateCommandState(JSON.parse(JSON.stringify(state)), 'production');
  assert.equal(selectOwnerMembership(reloaded, 'helper')?.member.deliveredUnits, 1_250);
});

test('touching a member is throttled and keeps the display name current', () => {
  const created = found(createDefaultCommandState('production'));
  const state = created.state;
  assert.equal(touchMember(state, 'leader', T0 + 1000), state);
  assert.equal(touchMember(state, 'stranger', T0 + 10 * HOUR), state);
  assert.equal(touchMember(state, 'leader', T0 + ACTIVITY_TOUCH_INTERVAL_MS - 1), state);
  const later = touchMember(state, 'leader', T0 + ACTIVITY_TOUCH_INTERVAL_MS);
  assert.equal(selectOwnerMembership(later, 'leader')?.member.lastActiveAt, T0 + ACTIVITY_TOUCH_INTERVAL_MS);
  const renamed = touchMember(state, 'leader', T0 + 1000, '  Новое   Имя ');
  assert.equal(selectOwnerMembership(renamed, 'leader')?.member.displayName, 'Новое Имя');
  assert.equal(selectOwnerMembership(renamed, 'leader')?.member.lastActiveAt, T0);
});

test('Hall access uses the highest level of any planet and never sums them', () => {
  const planets = (levels: number[]) => Object.fromEntries(levels.map((level, index) => [`p${index}`, { buildings: { 'planetary-government': level } }]));
  assert.equal(selectCommandHallLevel(planets([0, 0])), 0);
  assert.equal(selectCommandHallLevel(planets([3, 7, 5])), 7);
  assert.equal(selectCommandHallLevel(planets([0, 1])), 1);
  assert.equal(selectCommandHallLevel({}), 0);
  assert.equal(selectCommandHallLevel({ a: { buildings: {} }, b: {} }), 0);
});

test('losing the Hall does not touch alliance data (access is a UI/App concern, not a membership change)', () => {
  const created = found(createDefaultCommandState('production'));
  const before = JSON.stringify(created.state);
  assert.equal(selectCommandHallLevel({ home: { buildings: { 'planetary-government': 0 } } }), 0);
  assert.equal(JSON.stringify(migrateCommandState(JSON.parse(before), 'production')), before);
  assert.equal(selectOwnerMembership(created.state, 'leader')?.role, 'leader');
});

test('alliance rating is the mean of member totals; resource/combat means are separate components', () => {
  const created = found(createDefaultCommandState('production'));
  const state = join(created.state, created.allianceId, 'second');
  const scores = {
    leader: { resourcePoints: 100, battlePoints: 50, totalPoints: 150, achievementPoints: 0 },
    second: { resourcePoints: 300, battlePoints: 0, totalPoints: 300, achievementPoints: 0 },
  };
  assert.deepEqual(selectAllianceRating(state.alliances[0], scores), {
    memberCount: 2,
    averageTotalPoints: 225,
    averageResourcePoints: 200,
    averageBattlePoints: 25,
  });
  // A member without a known score counts as zero rather than being skipped or invented.
  assert.equal(selectAllianceRating(state.alliances[0], {}).averageTotalPoints, 0);
  assert.deepEqual(selectAllianceRating({ members: [] }, scores), { memberCount: 0, averageTotalPoints: 0, averageResourcePoints: 0, averageBattlePoints: 0 });
});

test('the catalog lists only real alliances, strongest average first', () => {
  assert.deepEqual(selectAllianceCatalog(createDefaultCommandState('production'), {}), []);
  let state = found(createDefaultCommandState('production')).state;
  state = ok(createAlliance(state, { ownerId: 'rival', displayName: 'Rival', settings: settings('Ржавый Орден', 'RUS') }, { now: T0, random })).state;
  const catalog = selectAllianceCatalog(state, { rival: { resourcePoints: 10, battlePoints: 0, totalPoints: 10, achievementPoints: 0 } });
  assert.deepEqual(catalog.map((entry) => [entry.alliance.name, entry.rank]), [['Ржавый Орден', 1], ['Звёздный Дозор', 2]]);
  assert.equal(catalog[0].leaderName, 'Rival');
});

test('Test Mode score fixtures: Ira Vel has 1,000,000 resource points; never in production', () => {
  assert.deepEqual(TEST_OWNER_SCORE_FIXTURES[TEST_ALLY_OWNER_ID], {
    ownerId: TEST_ALLY_OWNER_ID, resourcePoints: 1_000_000, battlePoints: 0, totalPoints: 1_000_000, achievementPoints: 0,
  });
  assert.equal(withTestOwnerScoreFixtures({}, 'test')[TEST_ALLY_OWNER_ID]?.totalPoints, 1_000_000);
  assert.equal(withTestOwnerScoreFixtures({}, 'production')[TEST_ALLY_OWNER_ID], undefined);
  const real = { [TEST_ALLY_OWNER_ID]: { ownerId: TEST_ALLY_OWNER_ID, resourcePoints: 5, battlePoints: 1, totalPoints: 6, achievementPoints: 0 as const } };
  assert.equal(withTestOwnerScoreFixtures(real, 'test')[TEST_ALLY_OWNER_ID]?.totalPoints, 6, 'a score derived from real data wins over a fixture');

  const test = createDefaultCommandState('test', { playerId: 'player-current' });
  const rating = selectAllianceRating(test.alliances[0], withTestOwnerScoreFixtures({}, 'test'));
  assert.equal(rating.memberCount, 2);
  assert.equal(rating.averageTotalPoints, 500_000);
});

test('legacy v1 saves: Test Mode rebuilds the managed seed and keeps player edits; fictitious members vanish', () => {
  const legacy = {
    alliance: { name: 'Мой Контур', tag: 'mk', motto: 'Свой путь.', description: 'Правка игрока.', emblem: { glyph: 'vanguard', accent: 'violet' }, leaderMemberId: 'member-kai-norden' },
    members: Array.from({ length: 8 }, (_, index) => ({ id: `member-${index}`, callsign: `Фиктивный ${index}` })),
    diplomacy: [{ id: 'relation-aurora' }],
    jointOperations: [{ id: 'joint-sun-raid', joinedByPlayer: true }],
    resourceRequests: [{ id: 'request-1' }],
    events: [{ id: 'event-01' }],
  };
  const migrated = migrateCommandState(legacy, 'test', { playerId: 'player-current', playerDisplayName: 'Dendrilion' });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.alliances.length, 1);
  const [alliance] = migrated.alliances;
  assert.equal(alliance.name, 'Мой Контур');
  assert.equal(alliance.tag, 'MK');
  assert.deepEqual(alliance.emblem, { glyph: 'vanguard', accent: 'violet' });
  assert.deepEqual(alliance.members.map((member) => member.ownerId), ['player-current', TEST_ALLY_OWNER_ID]);
  assert.equal(alliance.leaderOwnerId, 'player-current');
  assert.equal(Object.keys(migrated).sort().join(), 'aidEvents,aidLedgers,alliances,applications,cooldowns,diplomacy,nextSerial,requests,version');
});

test('legacy v1 saves in production: fixture dropped, a real alliance becomes a one-member alliance of the player', () => {
  const fixture = createLegacyFixture();
  assert.deepEqual(migrateCommandState(fixture, 'production'), createDefaultCommandState('production'));

  const real = migrateCommandState({
    alliance: { name: 'Содружество Гелион', tag: 'HLN', motto: 'Живой союз.', description: 'Настоящие данные игрока.', emblem: { glyph: 'orbit', accent: 'amber' } },
  }, 'production', { playerId: 'player-custom', playerDisplayName: 'Игрок', now: T0 });
  assert.equal(real.alliances.length, 1);
  assert.equal(real.alliances[0].leaderOwnerId, 'player-custom');
  assert.equal(real.alliances[0].members.length, 1);
  assert.equal(real.alliances[0].fixtureId, undefined);
  assert.equal(real.alliances[0].id, 'alliance-1');
  assert.equal(real.nextSerial, 2);

  assert.deepEqual(migrateCommandState(undefined, 'production'), createDefaultCommandState('production'));
  assert.deepEqual(migrateCommandState({}, 'production'), createDefaultCommandState('production'));
});

function createLegacyFixture() {
  return {
    alliance: { name: 'Содружество Гелион', tag: 'HLN', fixtureId: 'test-command-default-v1', motto: 'x', description: 'y', emblem: { glyph: 'starforge', accent: 'cyan' } },
    members: [{ id: 'member-kai-norden' }],
  };
}

test('v2 saves round-trip; production strips the Test Mode seed; invariants are repaired', () => {
  let state = found(createDefaultCommandState('production')).state;
  state = join(state, 'alliance-1', 'member-a');
  state = ok(applyToAlliance(state, { ownerId: 'pending', displayName: 'P', allianceId: 'alliance-1' }, { now: T0 + 5 })).state;
  state = ok(setDeputy(state, 'leader', 'member-a')).state;
  state = ok(leaveAlliance(ok(createAlliance(state, { ownerId: 'solo', displayName: 'S', settings: settings('Одиночка', 'SOL') }, { now: T0, random })).state, 'solo', T0 + 9)).state;

  assert.deepEqual(migrateCommandState(JSON.parse(JSON.stringify(state)), 'production'), state);

  const seed = createDefaultCommandState('test');
  assert.deepEqual(migrateCommandState(JSON.parse(JSON.stringify(seed)), 'production'), createDefaultCommandState('production'));
  assert.deepEqual(migrateCommandState(JSON.parse(JSON.stringify(seed)), 'test'), seed);

  const broken = JSON.parse(JSON.stringify(state)) as CommandState;
  broken.alliances.push({ ...broken.alliances[0], id: 'alliance-99', name: 'Клон', tag: 'CLN' });
  broken.alliances[0].leaderOwnerId = 'nobody';
  broken.alliances[0].deputyOwnerId = 'nobody';
  broken.nextSerial = 1;
  const repaired = migrateCommandState(broken, 'production');
  assert.equal(repaired.alliances.length, 1, 'an owner can be in one alliance only; the empty clone is dropped');
  assert.ok(repaired.alliances[0].members.some((member) => member.ownerId === repaired.alliances[0].leaderOwnerId));
  assert.equal(repaired.alliances[0].deputyOwnerId, null);
  assert.ok(repaired.nextSerial > 1, 'ids are never reused after a damaged counter');
});

test('malformed data never throws and never fabricates alliances', () => {
  for (const value of [null, 42, 'x', [], { version: 2 }, { version: 2, alliances: 'no' }, { version: 2, alliances: [null, 7, {}, { id: 'a' }] }]) {
    assert.doesNotThrow(() => migrateCommandState(value, 'production'));
    assert.deepEqual(migrateCommandState(value, 'production').alliances, []);
  }
  const hostile = migrateCommandState({
    version: 2,
    alliances: [{
      id: 'alliance-5', name: 'Ok name', tag: 'okay', members: [{ ownerId: 'a', joinedAt: -5, tieBreaker: 7, deliveredUnits: -3 }, { ownerId: 'a' }, { nope: true }],
      leaderOwnerId: 'a', deputyOwnerId: 'a',
    }],
    applications: [{ id: 'application-1', allianceId: 'missing', ownerId: 'x', status: 'pending' }, { id: 'application-2', allianceId: 'alliance-5', ownerId: 'a', status: 'pending' }, { id: 'application-3', allianceId: 'alliance-5', ownerId: 'b', status: 'weird' }],
    cooldowns: [{ ownerId: 'a', until: 'soon' }, { ownerId: 'a', until: 5, cause: 'left' }],
    nextSerial: 'x',
  }, 'production');
  assert.equal(hostile.alliances.length, 1);
  assert.equal(hostile.alliances[0].members.length, 1);
  assert.equal(hostile.alliances[0].members[0].joinedAt, 0);
  assert.equal(hostile.alliances[0].members[0].deliveredUnits, 0);
  assert.ok(hostile.alliances[0].members[0].tieBreaker >= 0 && hostile.alliances[0].members[0].tieBreaker < 1);
  assert.equal(hostile.alliances[0].deputyOwnerId, null);
  assert.equal(hostile.applications.length, 0, 'applications of unknown alliances, of members, or with unknown status are dropped');
  assert.equal(hostile.cooldowns.length, 1);
  assert.equal(hostile.nextSerial, 6);
});

test('persisting command keeps unrelated save fields and reads back identically', () => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, JSON.stringify({ metal: 777, operations: { items: [] } }));
  const state = found(createDefaultCommandState('production')).state;
  const persisted = persistCommandState(state, storage, undefined);
  assert.equal(persisted.ok, true);
  const envelope = JSON.parse(storage.getItem(SAVE_KEY)!);
  assert.equal(envelope.metal, 777);
  assert.deepEqual(envelope.operations, { items: [] });
  assert.deepEqual(readCommandState(storage), migrateCommandState(state, 'test'));
});

test('profile mirrors the real membership and clears it when the owner has none', () => {
  const profile = createDefaultPlayerProfileState();
  const created = found(createDefaultCommandState('production'), profile.playerId, 'Звёздный Дозор', 'DOZ');
  const synced = syncPlayerProfileWithCommand(profile, created.state);
  assert.equal(synced.allianceId, created.allianceId);
  assert.equal(synced.alliance?.tag, 'DOZ');
  const left = ok(leaveAlliance(created.state, profile.playerId, T0));
  const cleared = syncPlayerProfileWithCommand(synced, left.state);
  assert.equal(cleared.allianceId, null);
  assert.equal(cleared.alliance, null);
  assert.equal(syncPlayerProfileWithCommand(profile, createDefaultCommandState('production')), profile);
});

test('audit P0-1: founding is blocked by the global delay after leaving or being kicked, in the domain', () => {
  const base = found(createDefaultCommandState('production')).state;
  const withMember = join(base, 'alliance-1', 'leaver');
  const left = ok(leaveAlliance(withMember, 'leaver', T0 + HOUR)).state;
  const attempt = createAlliance(left, { ownerId: 'leaver', displayName: 'L', settings: settings('Новый союз', 'NEW') }, { now: T0 + HOUR + REAPPLY_COOLDOWN_MS - 1, random });
  failure(attempt, 'cooldown');
  assert.equal(attempt.state, left, 'a refused founding leaves the state untouched');
  assert.equal(!attempt.ok && attempt.retryAt, T0 + HOUR + REAPPLY_COOLDOWN_MS);
  assert.equal(createAlliance(left, { ownerId: 'leaver', displayName: 'L', settings: settings('Новый союз', 'NEW') }, { now: T0 + HOUR + REAPPLY_COOLDOWN_MS, random }).ok, true);

  const kicked = ok(kickMember(withMember, 'leader', 'leaver', T0 + HOUR)).state;
  failure(createAlliance(kicked, { ownerId: 'leaver', displayName: 'L', settings: settings('Новый союз', 'NEW') }, { now: T0 + HOUR + 1, random }), 'cooldown');

  // A refusal from one alliance is scoped to it and does not stop founding a new one.
  const applied = ok(applyToAlliance(base, { ownerId: 'applicant', displayName: 'A', allianceId: 'alliance-1' }, { now: T0 }));
  const refused = ok(rejectApplication(applied.state, 'leader', selectPendingApplication(applied.state, 'applicant')!.id, T0)).state;
  assert.equal(createAlliance(refused, { ownerId: 'applicant', displayName: 'A', settings: settings('Свой союз', 'OWN') }, { now: T0 + 1, random }).ok, true);
});

test('audit P0-2: leadership is settled against the stored activity stamp before it is refreshed', () => {
  const created = found(createDefaultCommandState('production'), 'leader', 'Звёздный Дозор', 'DOZ', T0);
  let state = join(created.state, created.allianceId, 'deputy', 'leader', T0);
  state = ok(setDeputy(state, 'leader', 'deputy')).state;
  const stale = (now: number) => refreshPresence(state, 'leader', now);

  // Returning after more than 24 h of a closed game: the stored stamp decides, then the stamp refreshes.
  const returned = stale(T0 + LEADER_ABSENCE_MS + 1);
  assert.equal(returned.alliances[0].leaderOwnerId, 'deputy');
  assert.equal(returned.alliances[0].leaderSince, T0 + LEADER_ABSENCE_MS + 1);
  assert.equal(selectOwnerMembership(returned, 'leader')?.member.lastActiveAt, T0 + LEADER_ABSENCE_MS + 1);

  // Reloading again does not re-elect or ping-pong.
  const again = refreshPresence(returned, 'leader', T0 + LEADER_ABSENCE_MS + 2);
  assert.equal(again.alliances[0].leaderOwnerId, 'deputy');
  assert.equal(again.alliances[0].leaderSince, T0 + LEADER_ABSENCE_MS + 1);

  // Under 24 h nothing moves; exactly 24 h is still fine.
  assert.equal(stale(T0 + LEADER_ABSENCE_MS).alliances[0].leaderOwnerId, 'leader');
  assert.equal(stale(T0 + HOUR).alliances[0].leaderOwnerId, 'leader');

  // A game kept open for 30 hours (a heartbeat every minute) never hands over leadership.
  let running = state;
  for (let at = T0; at <= T0 + 30 * HOUR; at += 60_000) running = refreshPresence(running, 'leader', at);
  assert.equal(running.alliances[0].leaderOwnerId, 'leader');
});

test('audit P1-4: finished applications to a vanished alliance survive a reload; pending ones do not', () => {
  const solo = found(createDefaultCommandState('production'));
  const withApplicant = ok(applyToAlliance(solo.state, { ownerId: 'hopeful', displayName: 'H', allianceId: solo.allianceId }, { now: T0 })).state;
  assert.equal(withApplicant.applications[0].allianceName, 'Звёздный Дозор');
  const disbanded = ok(leaveAlliance(withApplicant, 'leader', T0 + 10)).state;
  assert.deepEqual(disbanded.alliances, []);

  const reloaded = migrateCommandState(JSON.parse(JSON.stringify(disbanded)), 'production');
  assert.equal(reloaded.applications.length, 1);
  assert.equal(reloaded.applications[0].status, 'auto_rejected');
  assert.equal(reloaded.applications[0].reason, 'disbanded');
  assert.equal(reloaded.applications[0].allianceName, 'Звёздный Дозор');
  assert.equal(reloaded.nextSerial, disbanded.nextSerial, 'ids stay unique and are not reused');

  const tampered = JSON.parse(JSON.stringify(disbanded)) as CommandState;
  tampered.applications.push({ ...tampered.applications[0], id: 'application-77', ownerId: 'ghost', status: 'pending', reason: null, resolvedAt: null, resolvedByOwnerId: null });
  const cleaned = migrateCommandState(tampered, 'production');
  assert.equal(cleaned.applications.some((entry) => entry.status === 'pending'), false);
  assert.ok(cleaned.nextSerial > 77);
});
