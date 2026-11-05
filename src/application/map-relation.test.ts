import assert from 'node:assert/strict';
import test from 'node:test';

import { selectAllianceRelations } from '../domain/command/diplomacy.ts';
import { selectOwnerAlliance } from '../domain/command/selectors.ts';
import type { AllianceMember, AllianceRecord, CommandState, DiplomaticRelation } from '../domain/command/types.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { selectOwnerScore, selectOwnerScores } from '../domain/rating/scoring.ts';
import { UNIVERSE_NPC_OWNER_ID, getUniverseActionState, getUniverseOwnerRelation } from '../domain/universe/runtime.ts';
import type { UniversePlanetNode } from '../domain/universe/types.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { withAttackEligiblePoints } from './attack-eligibility.test-support.ts';
import type { SaveState } from './contracts.ts';
import { dispatchFlight } from './flights.ts';
import { classifyMapNode, classifyMapPlanet } from './map-relation.ts';
import { createInitialSaveState } from './persistence.ts';

const START = Date.UTC(2026, 10, 4, 12);
const PRODUCTION = { now: START, mode: 'production' as const, testTimeScale: 1 as const };

function campaign(): SaveState {
  const base = createDefaultNewGameConfig({ seed: 'map-relation-colours', factionId: 'aegis', playerName: 'Map colours QA' });
  return createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 3, campaignSpeed: 'standard' as const } });
}

function firstNpc(state: SaveState): SpyTargetState {
  return Object.values(getEspionageTargets(state.espionage))
    .filter((target) => target.kind === 'npc')
    .sort((left, right) => left.id.localeCompare(right.id))[0]!;
}

/** Exact public points: resource points through the cost ledger, the rest as battle points. */
function withPoints(state: SaveState, ownerId: string, totalPoints: number, resourcePoints = totalPoints): SaveState {
  const next = withAttackEligiblePoints(state, [ownerId], resourcePoints);
  const battle = totalPoints - resourcePoints;
  const result = battle === 0 ? next : {
    ...next,
    rating: { ...next.rating, battleAwardsByReportId: { ...next.rating.battleAwardsByReportId, [`qa-map-${ownerId}`]: { [ownerId]: battle } } },
  };
  assert.equal(selectOwnerScore(result, ownerId)!.totalPoints, totalPoints);
  return result;
}

function member(ownerId: string): AllianceMember {
  return { ownerId, displayName: ownerId, joinedAt: START, lastActiveAt: START, deliveredUnits: 0, jointOperationCount: 0, tieBreaker: 0.5 };
}

function alliance(id: string, ...ownerIds: string[]): AllianceRecord {
  return {
    id, name: `Союз ${id}`, tag: id.toUpperCase(), motto: '', description: '', emblem: { glyph: 'orbit', accent: 'violet' },
    createdAt: START, leaderOwnerId: ownerIds[0]!, deputyOwnerId: null, leaderSince: START, members: ownerIds.map(member),
  };
}

/** A war is stored as two mirrored views, as declareWar writes it. */
function war(left: string, right: string, extra: Partial<DiplomaticRelation> = {}): DiplomaticRelation[] {
  const view = (owner: string, other: string): DiplomaticRelation => ({
    id: other, allianceName: `Союз ${other}`, tag: other.toUpperCase(), status: 'war', ownerAllianceId: owner, since: START, truce: null, truceRejectedAt: null, ...extra,
  });
  return [view(left, right), view(right, left)];
}

function withCommand(state: SaveState, alliances: AllianceRecord[], diplomacy: DiplomaticRelation[] = []): SaveState {
  return { ...state, command: { ...state.command, alliances, diplomacy } as CommandState };
}

/** The map's own reading: the inputs UniverseView hands to the classifier. */
function mapStatusOf(state: SaveState, target: SpyTargetState) {
  const player = state.profile.playerId;
  const own = selectOwnerAlliance(state.command, player);
  const node = { kind: 'npc', ownerId: target.ownerId } as UniversePlanetNode;
  const relation = getUniverseOwnerRelation(
    node, player, own,
    { id: target.ownerId, displayName: target.ownerName, alliance: selectOwnerAlliance(state.command, target.ownerId), planetIds: [target.id] } as never,
    own ? selectAllianceRelations(state.command, own.id) : [],
  );
  const scores = selectOwnerScores(state);
  return { relation, status: classifyMapPlanet(node, relation, player, (ownerId) => scores[ownerId]) };
}

/** The attack command, sent with the relation the map shows, as the map's attack button does. */
function launch(state: SaveState, target: SpyTargetState, relation: string) {
  return dispatchFlight(state, {
    requestId: `map-colour-${target.id}-${relation}`,
    missionId: 'attack',
    originPlanetId: state.currentPlanetId,
    destination: { kind: 'planet', planetId: target.id, coordinate: target.coordinate },
    targetRelation: relation as 'neutral',
    targetOwnerId: target.ownerId,
    selectedShips: { scout: 5 },
    selectedCommanders: {},
    maxRounds: 5,
    departedAt: START,
  }, PRODUCTION);
}

/** The whole point: the colour's promise and the attack command's answer are one. */
function assertAgrees(state: SaveState, target: SpyTargetState, expected: { tone: string; attackable: boolean | null }, label: string) {
  const { relation, status } = mapStatusOf(state, target);
  assert.deepEqual({ tone: status.tone, attackable: status.attackable }, expected, label);
  const result = launch(state, target, relation);
  assert.equal(result.ok, expected.attackable === true, `${label}: ${result.ok ? 'launched' : result.error.message}`);
  if (!result.ok && expected.attackable === false) {
    assert.equal(result.error.code, 'attack-not-allowed', label);
    assert.equal(result.error.message, status.detail, `${label}: the map says the command's own reason`);
  }
  return status;
}

const eligible = (state: SaveState, ownerId: string) => withPoints(withPoints(state, state.profile.playerId, 10_000), ownerId, 8_000);

test('in range: a stranger reads soft red and the attack command launches', () => {
  const base = campaign();
  const target = firstNpc(base);
  const status = assertAgrees(eligible(base, target.ownerId), target, { tone: 'range', attackable: true }, 'in range');
  assert.equal(status.title, 'В диапазоне атаки');
  assert.equal(status.detail, null);
});

test('out of range, above and below: grey with the lock, and the command refuses', () => {
  const base = withPoints(campaign(), 'player-current', 10_000, 2_400);
  const target = firstNpc(base);
  const above = assertAgrees(withPoints(base, target.ownerId, 20_001, 1_000), target, { tone: 'neutral', attackable: false }, 'above');
  assert.equal(above.title, 'Вне диапазона атаки');
  assertAgrees(withPoints(base, target.ownerId, 4_999, 1_000), target, { tone: 'neutral', attackable: false }, 'below');
  // The band's edges and the resource branch count exactly as in the command.
  assertAgrees(withPoints(base, target.ownerId, 20_000, 1_000), target, { tone: 'range', attackable: true }, 'upper edge');
  assertAgrees(withPoints(base, target.ownerId, 5_000, 1_000), target, { tone: 'range', attackable: true }, 'lower edge');
  assertAgrees(withPoints(base, target.ownerId, 40_000, 2_400), target, { tone: 'range', attackable: true }, 'by resource points only');
});

test('protection: a new target and a new attacker are grey, each with its own reason', () => {
  const base = campaign();
  const player = base.profile.playerId;
  const target = firstNpc(base);
  const newbie = assertAgrees(withPoints(withPoints(base, player, 300), target.ownerId, 299), target, { tone: 'neutral', attackable: false }, 'target protected');
  assert.equal(newbie.title, 'Защита новичка');
  const self = assertAgrees(withPoints(withPoints(base, player, 299), target.ownerId, 300), target, { tone: 'neutral', attackable: false }, 'attacker protected');
  assert.equal(self.title, 'Вам пока рано атаковать');
  assertAgrees(withPoints(withPoints(base, player, 300), target.ownerId, 300), target, { tone: 'range', attackable: true }, 'both at the line');
});

test('enemy alliance: strong red in range and out of range, only the first can be hit', () => {
  const base = campaign();
  const player = base.profile.playerId;
  const target = firstNpc(base);
  const atWar = withCommand(base, [alliance('mine', player), alliance('foe', target.ownerId)], war('mine', 'foe'));
  const near = assertAgrees(eligible(atWar, target.ownerId), target, { tone: 'enemy', attackable: true }, 'enemy in range');
  assert.equal(near.title, 'Враг · в диапазоне атаки');
  const far = assertAgrees(withPoints(withPoints(atWar, player, 10_000, 2_400), target.ownerId, 20_001, 1_000), target, { tone: 'enemy', attackable: false }, 'enemy out of range');
  assert.equal(far.title, 'Враг · вне диапазона атаки');
});

test('a war does not lift the rule; a truce offer does not end the war', () => {
  const base = campaign();
  const player = base.profile.playerId;
  const target = firstNpc(base);
  const offered = withCommand(base, [alliance('mine', player), alliance('foe', target.ownerId)], war('mine', 'foe', { truce: { byAllianceId: 'mine', at: START } }));
  assertAgrees(eligible(offered, target.ownerId), target, { tone: 'enemy', attackable: true }, 'truce offered');
  // An accepted truce removes the pair: the same owner is a stranger again.
  const settled = withCommand(base, [alliance('mine', player), alliance('foe', target.ownerId)]);
  assertAgrees(eligible(settled, target.ownerId), target, { tone: 'range', attackable: true }, 'truce accepted');
});

test('a war between two other alliances changes nothing for the player', () => {
  const base = campaign();
  const player = base.profile.playerId;
  const target = firstNpc(base);
  const state = withCommand(base, [alliance('mine', player), alliance('foe', target.ownerId), alliance('third', 'owner-third')], war('foe', 'third'));
  assertAgrees(eligible(state, target.ownerId), target, { tone: 'range', attackable: true }, 'others at war');
  // Without an alliance of one's own, every stranger is simply a stranger.
  const alone = withCommand(base, [alliance('foe', target.ownerId), alliance('third', 'owner-third')], war('foe', 'third'));
  assertAgrees(eligible(alone, target.ownerId), target, { tone: 'range', attackable: true }, 'player without an alliance');
});

test('ally: green, never promised as a target, and the command refuses', () => {
  const base = campaign();
  const player = base.profile.playerId;
  const target = firstNpc(base);
  const state = eligible(withCommand(base, [alliance('mine', player, target.ownerId)]), target.ownerId);
  const status = assertAgrees(state, target, { tone: 'ally', attackable: null }, 'ally');
  assert.equal(status.title, 'Союзная планета');
});

test('own planet: never a target, on the map or by the action state', () => {
  const state = campaign();
  const player = state.profile.playerId;
  const node = { kind: 'player', ownerId: player } as UniversePlanetNode;
  const status = classifyMapPlanet(node, 'self', player, () => ({ totalPoints: 10_000, resourcePoints: 10_000 }));
  assert.deepEqual([status.tone, status.attackable, status.title], ['self', null, 'Ваша планета']);
  assert.equal(getUniverseActionState('attack', node, player, 'self').enabled, false);
});

test('the test bot stays outside the rule, as in the command', () => {
  const node = { kind: 'npc', ownerId: UNIVERSE_NPC_OWNER_ID } as UniversePlanetNode;
  const status = classifyMapPlanet(node, 'neutral', 'player-current', () => ({ totalPoints: 0, resourcePoints: 0 }));
  assert.deepEqual([status.tone, status.attackable], ['range', true]);
});

test('map objects have their own tones and no attack promise', () => {
  const tones = (['uninhabited', 'unique', 'pirate', 'anomaly'] as const).map((kind) => classifyMapNode({ kind }, null, null));
  assert.deepEqual(tones.map((status) => status.tone), ['wild', 'unique', 'pirate', 'anomaly']);
  assert.ok(tones.every((status) => status.attackable === null));
});
