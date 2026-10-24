import type { BattleReport } from '../domain/combat/report.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import type { SaveState } from './contracts.ts';

/**
 * Owner rule: the save keeps the newest 200 pirate-vs-NPC battle reports in
 * one shared history. Battles involving the player and reports the player
 * saved follow the existing rules and are never pruned here.
 */
export const FOREIGN_PIRATE_BATTLE_REPORT_LIMIT = 200;

/**
 * Roll entries stay this long behind the raid cursor: a pirate contact lives
 * up to 75 minutes and is checked 15 minutes after it appears, and the
 * operations screen still looks up the current contact's roll by key.
 */
export const PIRATE_ROLL_LEDGER_MARGIN_MS = (75 + 15) * 60_000;

/**
 * Same window for battles between other owners (NPC attacks on NPCs and NPC
 * pirate eliminations): the player never sees them and only the newest are
 * read as fresh NPC observations. Without it a 100-NPC month adds thousands.
 */
export const FOREIGN_NPC_BATTLE_REPORT_LIMIT = 200;

/**
 * Finished autonomous NPC flights stay this long after completion. Their
 * request ids are derived from replayed decision events that never recur
 * after the committed replay cursor, so older records are archive only.
 */
export const NPC_FLIGHT_ARCHIVE_MARGIN_MS = 24 * 60 * 60_000;

const PIRATE_OWNER_ID = 'pirates';
const TERMINAL_FLIGHT_PHASES = new Set<FlightRecord['phase']>(['completed', 'failed']);

/** A pirate raid on an NPC owner: no player side, so only archive value remains once applied. */
export function isForeignPirateBattleReport(report: BattleReport, playerId: string): boolean {
  return report.missionType === 'pirate-raid'
    && report.attacker.playerId === PIRATE_OWNER_ID
    && report.defender.playerId !== playerId;
}

/** A battle between owners other than the player (NPC vs NPC, NPC vs pirates). */
export function isForeignNpcBattleReport(report: BattleReport, playerId: string): boolean {
  return (report.missionType === 'attack' || report.missionType === 'pirate-elimination')
    && report.attacker.playerId !== playerId
    && report.defender.playerId !== playerId;
}

/** A finished autonomous NPC flight with nothing left to settle. */
export function isArchivedNpcFlight(flight: FlightRecord, before: number): boolean {
  return flight.ownerSide === 'npc'
    && typeof flight.ownerId === 'string'
    && flight.requestId.startsWith('npc-autonomy:')
    && flight.phase === 'completed'
    && typeof flight.completedAt === 'number'
    && flight.completedAt < before
    && flight.cargoState !== 'loaded';
}

/** A finished pirate raid flight against an NPC owner; its battle, losses and return are applied. */
export function isFinishedForeignPirateFlight(flight: FlightRecord, playerId: string): boolean {
  // 'failed' is left alone: persistence treats some failed records specially.
  return flight.ownerSide === 'pirate'
    && flight.missionId === 'pirate-raid'
    && flight.phase === 'completed'
    && flight.targetKind === 'npc'
    && flight.destinationOwnerId !== undefined
    && flight.destinationOwnerId !== playerId;
}

/**
 * Drops archive records that no mechanic reads any more, so a long campaign
 * (or a 30-day catch-up) does not grow the save without bound:
 * - pirate-vs-NPC battle reports older than the newest limit; reports the
 *   player saved or a live flight or operation references stay on top of it;
 * - battles between other owners (NPC vs NPC, NPC vs pirates) past their own
 *   newest limit, with the same protections;
 * - finished pirate raid flights against NPCs and their request index entry;
 * - NPC-owned spy reports older than that owner's newest one on the same target;
 * - finished autonomous NPC flights a day behind the replay cursor, unless a
 *   live spy mission or unsettled cargo still names them;
 * - pirate roll ledger entries checked more than the margin before the
 *   processed raid cursor, which no roll selection can name again.
 * Game state (wallets, fleets, ownership, ratings, cursors) is untouched.
 * Returns the same object when nothing is pruned.
 */
export function pruneCampaignHistory(state: SaveState, at: number | undefined = state.npcReplay?.processedThroughAt): SaveState {
  const playerId = state.profile.playerId;
  let next = state;

  const flights = state.flights;
  const replayCursor = at;
  const archiveBefore = typeof replayCursor === 'number' ? replayCursor - NPC_FLIGHT_ARCHIVE_MARGIN_MS : Number.NEGATIVE_INFINITY;
  // A spy mission that is still live keeps its flight.
  const liveMissionFlights = new Set((state.espionage?.missions ?? [])
    .filter((mission) => mission.status === 'transit' || mission.status === 'orbiting' || mission.status === 'returning')
    .map((mission) => mission.flightId));
  const finished = flights.records.filter((flight) => isFinishedForeignPirateFlight(flight, playerId)
    || (isArchivedNpcFlight(flight, archiveBefore) && !liveMissionFlights.has(flight.id)));
  if (finished.length) {
    const removed = new Set(finished.map((flight) => flight.id));
    const requestIndex = { ...flights.requestIndex };
    for (const flight of finished) {
      if (requestIndex[flight.requestId] === flight.id) delete requestIndex[flight.requestId];
    }
    next = { ...next, flights: { ...flights, records: flights.records.filter((flight) => !removed.has(flight.id)), requestIndex } };
  }

  // NPC intelligence: only the newest spy report per (owner, target) is ever
  // read (the observed set and latest estimate), so older duplicates leave.
  const spyReports = next.espionage?.reports ?? [];
  const newestNpcReport = new Map<string, number>();
  spyReports.forEach((report, index) => {
    if (typeof report.ownerId !== 'string' || !report.ownerId || report.ownerId === playerId) return;
    const key = JSON.stringify([report.ownerId, report.targetPlanetId]);
    const previous = newestNpcReport.get(key);
    if (previous === undefined || spyReports[previous]!.createdAt <= report.createdAt) newestNpcReport.set(key, index);
  });
  const keptSpyIndexes = new Set(newestNpcReport.values());
  const spyKept = spyReports.filter((report, index) => typeof report.ownerId !== 'string' || !report.ownerId
    || report.ownerId === playerId || keptSpyIndexes.has(index));
  if (spyKept.length !== spyReports.length) next = { ...next, espionage: { ...next.espionage!, reports: spyKept } };

  next = pruneForeignReports(next, state, playerId, isForeignPirateBattleReport, FOREIGN_PIRATE_BATTLE_REPORT_LIMIT);
  next = pruneForeignReports(next, state, playerId, isForeignNpcBattleReport, FOREIGN_NPC_BATTLE_REPORT_LIMIT);

  const pirate = state.pirate;
  const cursor = pirate?.raidProcessedAt;
  if (pirate?.raidRolls && typeof cursor === 'number') {
    // Selection takes checks strictly after the cursor, which never moves
    // back, so older entries are never consulted again as idempotency guards.
    const pruneBefore = cursor - PIRATE_ROLL_LEDGER_MARGIN_MS;
    const liveFlightIds = new Set(next.flights.records.filter((flight) => !TERMINAL_FLIGHT_PHASES.has(flight.phase)).map((flight) => flight.id));
    const keep = (roll: { checkAt: number; flightId?: string }) => roll.checkAt >= pruneBefore
      || (roll.flightId !== undefined && liveFlightIds.has(roll.flightId));
    let stale = 0;
    for (const roll of Object.values(pirate.raidRolls)) if (!keep(roll)) stale += 1;
    if (stale) {
      const raidRolls = Object.fromEntries(Object.entries(pirate.raidRolls).filter(([, roll]) => keep(roll)));
      next = { ...next, pirate: { ...pirate, raidRolls } };
    }
  }

  return next;
}

function pruneForeignReports(
  next: SaveState,
  state: SaveState,
  playerId: string,
  isForeign: (report: BattleReport, playerId: string) => boolean,
  limit: number,
): SaveState {
  const reports = next.combat.reports;
  const foreignCount = reports.reduce((count, report) => count + Number(isForeign(report, playerId)), 0);
  if (foreignCount <= limit) return next;
  const protectedIds = new Set<string>(state.combat.savedReportIds);
  for (const flight of next.flights.records) {
    if (TERMINAL_FLIGHT_PHASES.has(flight.phase)) continue;
    // A live flight resolves (and re-finds) its report by these ids.
    protectedIds.add(`battle-pirate-raid-${flight.id}`);
    protectedIds.add(`battle-pirate-${flight.id}`);
    protectedIds.add(`battle-attack-${flight.id}`);
    if (flight.attackResolution?.reportId) protectedIds.add(flight.attackResolution.reportId);
  }
  for (const operation of state.operations.items) if (operation.battleReportId) protectedIds.add(operation.battleReportId);
  // Protected reports stay on top of the limit; the newest unprotected
  // foreign reports fill it. Reports are appended chronologically.
  const prunable = reports.filter((report) => isForeign(report, playerId) && !protectedIds.has(report.id)).length;
  let excess = prunable - limit;
  if (excess <= 0) return next;
  const kept: BattleReport[] = [];
  for (const report of reports) {
    if (excess > 0 && isForeign(report, playerId) && !protectedIds.has(report.id)) {
      excess -= 1;
      continue;
    }
    kept.push(report);
  }
  return { ...next, combat: { ...next.combat, reports: kept } };
}
