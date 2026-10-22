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

const PIRATE_OWNER_ID = 'pirates';
const TERMINAL_FLIGHT_PHASES = new Set<FlightRecord['phase']>(['completed', 'failed']);

/** A pirate raid on an NPC owner: no player side, so only archive value remains once applied. */
export function isForeignPirateBattleReport(report: BattleReport, playerId: string): boolean {
  return report.missionType === 'pirate-raid'
    && report.attacker.playerId === PIRATE_OWNER_ID
    && report.defender.playerId !== playerId;
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
 * - finished pirate raid flights against NPCs and their request index entry;
 * - pirate roll ledger entries checked more than the margin before the
 *   processed raid cursor, which no roll selection can name again.
 * Game state (wallets, fleets, ownership, ratings, cursors) is untouched.
 * Returns the same object when nothing is pruned.
 */
export function pruneCampaignHistory(state: SaveState): SaveState {
  const playerId = state.profile.playerId;
  let next = state;

  const flights = state.flights;
  const finished = flights.records.filter((flight) => isFinishedForeignPirateFlight(flight, playerId));
  if (finished.length) {
    const removed = new Set(finished.map((flight) => flight.id));
    const requestIndex = { ...flights.requestIndex };
    for (const flight of finished) {
      if (requestIndex[flight.requestId] === flight.id) delete requestIndex[flight.requestId];
    }
    next = { ...next, flights: { ...flights, records: flights.records.filter((flight) => !removed.has(flight.id)), requestIndex } };
  }

  const reports = state.combat.reports;
  const foreignCount = reports.reduce((count, report) => count + Number(isForeignPirateBattleReport(report, playerId)), 0);
  if (foreignCount > FOREIGN_PIRATE_BATTLE_REPORT_LIMIT) {
    const protectedIds = new Set<string>(state.combat.savedReportIds);
    for (const flight of next.flights.records) {
      if (TERMINAL_FLIGHT_PHASES.has(flight.phase)) continue;
      // A live raid resolves (and re-finds) its report by this id on arrival.
      protectedIds.add(`battle-pirate-raid-${flight.id}`);
      if (flight.attackResolution?.reportId) protectedIds.add(flight.attackResolution.reportId);
    }
    for (const operation of state.operations.items) if (operation.battleReportId) protectedIds.add(operation.battleReportId);
    // Protected reports stay on top of the limit; the newest unprotected
    // foreign reports fill it. Reports are appended chronologically.
    const prunable = reports.filter((report) => isForeignPirateBattleReport(report, playerId) && !protectedIds.has(report.id)).length;
    let excess = prunable - FOREIGN_PIRATE_BATTLE_REPORT_LIMIT;
    if (excess > 0) {
      const kept: BattleReport[] = [];
      for (const report of reports) {
        if (excess > 0 && isForeignPirateBattleReport(report, playerId) && !protectedIds.has(report.id)) {
          excess -= 1;
          continue;
        }
        kept.push(report);
      }
      next = { ...next, combat: { ...next.combat, reports: kept } };
    }
  }

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
