import type { SaveState } from './contracts.ts';
import { isAsterionLocalPlayerId } from '../domain/combat/report.ts';
import type { DiplomaticRelation } from '../domain/command/types.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';
import { createWorldCatchupSummary, type WorldCatchupSummary } from '../domain/npc/world-catchup-summary.ts';

/**
 * Owner decision (31.10.2026): the world news of an absence are shown only
 * when the player was away longer than this (game time the catch-up covered:
 * replayed here or lived on the cloud server). A shorter absence is caught up
 * quietly — no summary window, and no progress window unless the catch-up
 * itself takes a while (QUIET_CATCHUP_SHOW_AFTER_MS in NpcCatchupBanner).
 */
export const WORLD_SUMMARY_MIN_ABSENCE_MS = 3 * 3_600_000;

/** A finished summary worth its window: an absence longer than WORLD_SUMMARY_MIN_ABSENCE_MS. */
export function isWorldSummaryWorthShowing(summary: Pick<WorldCatchupSummary, 'fromAt' | 'finishedAt'>): boolean {
  return (summary.finishedAt ?? summary.fromAt) - summary.fromAt > WORLD_SUMMARY_MIN_ABSENCE_MS;
}

/** Starts the world news of one catch-up from the ratings as they stand now. */
export function startWorldCatchupSummary(state: SaveState, fromAt: number, complete = true): WorldCatchupSummary {
  const startScores: Record<string, number> = {};
  for (const [ownerId, score] of Object.entries(selectOwnerScores(state))) startScores[ownerId] = score.totalPoints;
  return createWorldCatchupSummary(fromAt, startScores, complete);
}

function relationPairs(relations: readonly DiplomaticRelation[], statuses: ReadonlySet<string>): Set<string> {
  const pairs = new Set<string>();
  for (const relation of relations) {
    if (!statuses.has(relation.status) || !relation.ownerAllianceId) continue;
    pairs.add([relation.ownerAllianceId, relation.id].sort().join('\u0000'));
  }
  return pairs;
}

const WAR = new Set(['war']);
const PACT = new Set(['ally', 'trade_pact']);

export function countNewWorldBattles(
  summary: WorldCatchupSummary,
  reports: SaveState['combat']['reports'],
  counted: Set<string>,
  playerId: string,
): WorldCatchupSummary {
  let next: WorldCatchupSummary | undefined;
  const mine = (id?: string) => isAsterionLocalPlayerId(playerId) ? isAsterionLocalPlayerId(id) : id === playerId;
  for (const report of reports) {
    if (counted.has(report.id)) continue;
    counted.add(report.id);
    if (report.missionType === 'simulation' || report.missionType === 'arena') continue;
    next ??= { ...summary };
    next.battles += 1;
    if (report.winner === 'attacker') next.attackerWins += 1;
    else if (report.winner === 'defender') next.defenderWins += 1;
    else next.draws += 1;
    if (mine(report.attacker.playerId) || mine(report.defender.playerId)) next.playerBattles += 1;
    if (report.missionType === 'pirate-raid') next.pirateRaids += 1;
    if (report.siege?.planetDestroyed) next.planetsDestroyed += 1;
  }
  return next ?? summary;
}

/**
 * Adds the slow-moving world changes of one replay slice: colonies, alliances,
 * diplomacy, Sun raids and crystals. Battles are counted separately with
 * countNewWorldBattles before every history prune, because NPC battle reports
 * are archived after each replay group.
 */
export function accumulateWorldCatchupSummary(summary: WorldCatchupSummary, before: SaveState, after: SaveState): WorldCatchupSummary {
  const next = { ...summary };

  const planetIds = (state: SaveState) => new Set([...Object.keys(state.espionage?.targets ?? {}), ...Object.keys(state.planets)]);
  if (after.espionage?.targets !== before.espionage?.targets || after.planets !== before.planets) {
    const known = planetIds(before);
    for (const id of planetIds(after)) if (!known.has(id)) next.colonies += 1;
  }

  if (after.command !== before.command) {
    const known = new Set(before.command.alliances.map((alliance) => alliance.id));
    const current = new Set(after.command.alliances.map((alliance) => alliance.id));
    for (const id of current) if (!known.has(id)) next.alliancesFounded += 1;
    for (const id of known) if (!current.has(id)) next.alliancesDissolved += 1;
    const warsBefore = relationPairs(before.command.diplomacy, WAR);
    const warsAfter = relationPairs(after.command.diplomacy, WAR);
    for (const pair of warsAfter) if (!warsBefore.has(pair)) next.warsDeclared += 1;
    for (const pair of warsBefore) {
      // A war that ended with both alliances standing ended in a truce.
      if (!warsAfter.has(pair) && pair.split('\u0000').every((id) => current.has(id))) next.truces += 1;
    }
    const pactsBefore = relationPairs(before.command.diplomacy, PACT);
    for (const pair of relationPairs(after.command.diplomacy, PACT)) if (!pactsBefore.has(pair)) next.pacts += 1;
  }

  if (after.sunRaid !== before.sunRaid && after.sunRaid) {
    const resolved = new Set((before.sunRaid?.raids ?? []).filter((raid) => raid.status === 'resolved').map((raid) => raid.id));
    for (const raid of after.sunRaid.raids) {
      if (raid.status !== 'resolved' || resolved.has(raid.id)) continue;
      next.sunRaids += 1;
      if (raid.result?.winner === 'attacker') next.sunRaidsWon += 1;
    }
    const held = new Set(Object.entries(before.sunRaid?.crystals ?? {}).flatMap(([holder, crystals]) => crystals.map((crystal) => `${holder}\u0000${crystal}`)));
    for (const [holder, crystals] of Object.entries(after.sunRaid.crystals)) {
      for (const crystal of crystals) if (!held.has(`${holder}\u0000${crystal}`)) next.crystalsTaken += 1;
    }
  }
  return next;
}

export type WorldSummaryLeader = { ownerId: string; name: string; points: number; growth: number; isPlayer: boolean };

/** Rating leaders now and the biggest climbers since the catch-up began. */
export function selectWorldSummaryLeaders(state: SaveState, summary: WorldCatchupSummary, limit = 3) {
  const names = new Map<string, string>();
  for (const target of Object.values(state.espionage?.targets ?? {})) {
    if (target.ownerName && !names.has(target.ownerId)) names.set(target.ownerId, target.ownerName);
  }
  names.set(state.profile.playerId, state.profile.displayName);
  const rows: WorldSummaryLeader[] = Object.entries(selectOwnerScores(state)).map(([ownerId, score]) => ({
    ownerId,
    name: names.get(ownerId) ?? 'Неизвестный правитель',
    points: score.totalPoints,
    growth: score.totalPoints - (summary.startScores[ownerId] ?? 0),
    isPlayer: ownerId === state.profile.playerId,
  }));
  const byPoints = [...rows].sort((left, right) => right.points - left.points || left.name.localeCompare(right.name, 'ru'));
  const byGrowth = rows.filter((row) => row.growth > 0)
    .sort((left, right) => right.growth - left.growth || left.name.localeCompare(right.name, 'ru'));
  const totalGrowth = rows.reduce((sum, row) => sum + Math.max(0, row.growth), 0);
  return { leaders: byPoints.slice(0, limit), climbers: byGrowth.slice(0, limit), totalGrowth };
}
