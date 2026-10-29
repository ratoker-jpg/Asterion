import { isAsterionLocalPlayerId, type BattleReport } from '../domain/combat/report.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import type { SaveState } from './contracts.ts';
import type { ExplorationContact } from '../domain/exploration/ledger.ts';

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
 * Window for battles between other owners (NPC attacks on NPCs and NPC
 * pirate eliminations): the player never sees them and only the newest are
 * read as fresh NPC observations. A report is ~35 KB and very active NPCs
 * fight constantly, so far fewer are kept than the pirate rule's 200.
 */
export const FOREIGN_NPC_BATTLE_REPORT_LIMIT = 60;

/**
 * Finished autonomous NPC flights stay this long after completion. Their
 * request ids are derived from replayed decision events that never recur
 * after the committed replay cursor, so older records are archive only.
 */
export const NPC_FLIGHT_ARCHIVE_MARGIN_MS = 60 * 60_000;

const PIRATE_OWNER_ID = 'pirates';

/**
 * Archives found clean, by identity (saves are immutable): pruning reads only
 * these arrays, the player id and the cursor, so an unchanged clean array
 * needs no rescan on the next group of a catch-up.
 */
const cleanFlights = new WeakMap<readonly FlightRecord[], { missions: unknown; playerId: string; firstArchivableAfter: number }>();
const cleanSpyReports = new WeakMap<readonly unknown[], { playerId: string; oldestNpcAt: number }>();
const cleanBattleReports = new WeakMap<readonly BattleReport[], { playerId: string; flights: readonly FlightRecord[] | null }>();
const rollChecks = new WeakMap<object, number>();
const cleanMissions = new WeakMap<readonly unknown[], readonly FlightRecord[]>();

function earliestRollCheck(rolls: Readonly<Record<string, { checkAt: number }>>): number {
  let earliest = rollChecks.get(rolls);
  if (earliest === undefined) {
    earliest = Number.POSITIVE_INFINITY;
    for (const roll of Object.values(rolls)) earliest = Math.min(earliest, roll.checkAt);
    rollChecks.set(rolls, earliest);
  }
  return earliest;
}
const TERMINAL_FLIGHT_PHASES = new Set<FlightRecord['phase']>(['completed', 'failed']);

/** NPC spy reports this old are dropped: estimates already fear anything older than 72 hours. */
export const NPC_SPY_REPORT_STALE_MS = 72 * 60 * 60_000;

function compactForeignReport(report: BattleReport): BattleReport {
  const { initialSnapshot: _initial, ...rest } = report;
  const { provenance: _provenance, unknowns: _unknowns, ...metadata } = report.metadata ?? { source: 'combat-resolver' as const };
  return { ...rest, rounds: [], metadata };
}

/** A pirate raid on an NPC owner: no player side, so only archive value remains once applied. */
export function isForeignPirateBattleReport(report: BattleReport, playerId: string): boolean {
  return report.missionType === 'pirate-raid'
    && report.attacker.playerId === PIRATE_OWNER_ID
    && !isPlayerSide(report.defender.playerId, playerId);
}

/** The live player's side, including the local-player aliases older reports carry (as ReportsView reads them). */
function isPlayerSide(sideId: string | undefined, playerId: string): boolean {
  return isAsterionLocalPlayerId(playerId) ? isAsterionLocalPlayerId(sideId) : sideId === playerId;
}

/** A battle between owners other than the player (NPC vs NPC, NPC vs pirates). */
export function isForeignNpcBattleReport(report: BattleReport, playerId: string): boolean {
  return (report.missionType === 'attack' || report.missionType === 'pirate-elimination')
    && !isPlayerSide(report.attacker.playerId, playerId)
    && !isPlayerSide(report.defender.playerId, playerId);
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
// Per flight (records keep unchanged flights' objects): whether it is a
// finished foreign pirate raid, and when it became an archive candidate.
const flightArchiveInfo = new WeakMap<FlightRecord, { playerId: string; pirateFinished: boolean; candidateAt: number }>();
const recordsArchiveSummary = new WeakMap<readonly FlightRecord[], { playerId: string; pirateFinished: boolean; firstCandidateAt: number }>();

// (owner, target) of each NPC spy report, built once per (immutable) report.
const spyReportKeys = new WeakMap<object, string>();
const flightIdSets = new WeakMap<readonly FlightRecord[], Set<string>>();
function flightIdSet(records: readonly FlightRecord[]): Set<string> {
  let ids = flightIdSets.get(records);
  if (!ids) flightIdSets.set(records, ids = new Set(records.map((flight) => flight.id)));
  return ids;
}

function flightArchiveSummary(records: readonly FlightRecord[], playerId: string) {
  const cached = recordsArchiveSummary.get(records);
  if (cached?.playerId === playerId) return cached;
  let pirateFinished = false;
  let firstCandidateAt = Number.POSITIVE_INFINITY;
  for (const flight of records) {
    let info = flightArchiveInfo.get(flight);
    if (info?.playerId !== playerId) {
      info = { playerId, pirateFinished: isFinishedForeignPirateFlight(flight, playerId),
        candidateAt: isArchivedNpcFlight(flight, Number.POSITIVE_INFINITY) ? flight.completedAt! : Number.POSITIVE_INFINITY };
      flightArchiveInfo.set(flight, info);
    }
    pirateFinished ||= info.pirateFinished;
    if (info.candidateAt < firstCandidateAt) firstCandidateAt = info.candidateAt;
  }
  const summary = { playerId, pirateFinished, firstCandidateAt };
  recordsArchiveSummary.set(records, summary);
  return summary;
}

export function pruneCampaignHistory(state: SaveState, at: number | undefined = state.npcReplay?.processedThroughAt): SaveState {
  const playerId = state.profile.playerId;
  let next = state;

  const flights = state.flights;
  const replayCursor = at;
  const archiveBefore = typeof replayCursor === 'number' ? replayCursor - NPC_FLIGHT_ARCHIVE_MARGIN_MS : Number.NEGATIVE_INFINITY;
  // Clean records stay clean until the earliest finished NPC flight ages past
  // the margin; until then (same arrays, earlier cursor) nothing is scanned.
  const flightMemo = cleanFlights.get(flights.records);
  const summary = flightArchiveSummary(flights.records, playerId);
  // Without a finished pirate raid and before the earliest finished NPC flight
  // ages past the margin nothing can leave, whatever the spy missions hold.
  const flightsClean = (!summary.pirateFinished && archiveBefore <= summary.firstCandidateAt)
    || (flightMemo !== undefined && flightMemo.missions === state.espionage?.missions
      && flightMemo.playerId === playerId && archiveBefore <= flightMemo.firstArchivableAfter);
  // A spy mission that is still live keeps its flight.
  const liveMissionFlights = flightsClean ? new Set<string>() : new Set((state.espionage?.missions ?? [])
    .filter((mission) => mission.status === 'transit' || mission.status === 'orbiting' || mission.status === 'returning')
    .map((mission) => mission.flightId));
  // flightArchiveSummary filled flightArchiveInfo for every record.
  const info = (flight: FlightRecord) => flightArchiveInfo.get(flight)!;
  const finished = flightsClean ? [] : flights.records.filter((flight) => info(flight).pirateFinished
    || (info(flight).candidateAt < archiveBefore && !liveMissionFlights.has(flight.id)));
  if (!flightsClean && !finished.length) {
    let firstArchivableAfter = Number.POSITIVE_INFINITY;
    for (const flight of flights.records) {
      const candidateAt = info(flight).candidateAt;
      if (candidateAt < firstArchivableAfter && !liveMissionFlights.has(flight.id)) firstArchivableAfter = candidateAt;
    }
    cleanFlights.set(flights.records, { missions: state.espionage?.missions, playerId, firstArchivableAfter });
  }
  if (finished.length) {
    const removed = new Set(finished.map((flight) => flight.id));
    // The request index holds thousands of entries late in a campaign: copy it only to drop one.
    let requestIndex = flights.requestIndex;
    for (const flight of finished) {
      if (requestIndex[flight.requestId] !== flight.id) continue;
      if (requestIndex === flights.requestIndex) requestIndex = { ...requestIndex };
      delete requestIndex[flight.requestId];
    }
    next = { ...next, flights: { ...flights, records: flights.records.filter((flight) => !removed.has(flight.id)), requestIndex } };
  }

  // An NPC spy mission that has ended and whose flight left the archive is
  // read by nothing: reports carry their owner, live missions are kept.
  const missions = next.espionage?.missions ?? [];
  if (missions.length && cleanMissions.get(missions) !== next.flights.records) {
    const keptAnyway = (mission: (typeof missions)[number]) => mission.ownerId === playerId
      || mission.status === 'transit' || mission.status === 'orbiting' || mission.status === 'returning';
    // Only ended NPC missions depend on the flights; most groups have none whose flight left.
    const flightIds = missions.some((mission) => !keptAnyway(mission)) ? flightIdSet(next.flights.records) : null;
    const kept = flightIds ? missions.filter((mission) => keptAnyway(mission) || flightIds.has(mission.flightId)) : missions;
    if (kept.length !== missions.length) next = { ...next, espionage: { ...next.espionage!, missions: kept } };
    cleanMissions.set(kept.length !== missions.length ? kept : missions, next.flights.records);
  }

  // NPC intelligence: only the newest spy report per (owner, target) is ever
  // read (the observed set and latest estimate), so older duplicates leave.
  // Reports older than the stale window are no basis for a decision either.
  const spyReports = next.espionage?.reports ?? [];
  // The threshold moves by whole hours, a pure function of the time, so the
  // archive is rescanned for age at most hourly however often it is pruned.
  const staleBefore = typeof at === 'number'
    ? Math.floor((at - NPC_SPY_REPORT_STALE_MS) / 3_600_000) * 3_600_000
    : Number.NEGATIVE_INFINITY;
  const spyMemo = cleanSpyReports.get(spyReports);
  if (!spyMemo || spyMemo.playerId !== playerId || staleBefore > spyMemo.oldestNpcAt) {
    const newestNpcReport = new Map<string, number>();
    spyReports.forEach((report, index) => {
      if (typeof report.ownerId !== 'string' || !report.ownerId || report.ownerId === playerId) return;
      let key = spyReportKeys.get(report);
      if (key === undefined) spyReportKeys.set(report, key = `${report.ownerId}\u0000${report.targetPlanetId}`);
      const previous = newestNpcReport.get(key);
      if (previous === undefined || spyReports[previous]!.createdAt <= report.createdAt) newestNpcReport.set(key, index);
    });
    const keptSpyIndexes = new Set(newestNpcReport.values());
    const spyKept = spyReports.filter((report, index) => typeof report.ownerId !== 'string' || !report.ownerId
      || report.ownerId === playerId || (keptSpyIndexes.has(index) && report.createdAt >= staleBefore));
    if (spyKept.length !== spyReports.length) next = { ...next, espionage: { ...next.espionage!, reports: spyKept } };
    let oldestNpcAt = Number.POSITIVE_INFINITY;
    for (const report of spyKept) {
      if (typeof report.ownerId === 'string' && report.ownerId && report.ownerId !== playerId) oldestNpcAt = Math.min(oldestNpcAt, report.createdAt);
    }
    // When every report survives, the state keeps the original array. Cache
    // against that identity so the next replay group can reuse this scan.
    cleanSpyReports.set(spyKept.length === spyReports.length ? spyReports : spyKept, { playerId, oldestNpcAt });
  }

  const battleMemo = cleanBattleReports.get(next.combat.reports);
  if (!battleMemo || battleMemo.playerId !== playerId || (battleMemo.flights !== null && battleMemo.flights !== next.flights.records)) {
    next = pruneForeignReports(next, state, playerId, isForeignPirateBattleReport, FOREIGN_PIRATE_BATTLE_REPORT_LIMIT);
    next = pruneForeignReports(next, state, playerId, isForeignNpcBattleReport, FOREIGN_NPC_BATTLE_REPORT_LIMIT);
    // Battles between other owners are never shown to the player: keep the
    // outcome and forces NPCs read, drop the round log and its provenance.
    if (next.combat.reports.some((report) => report.rounds.length > 0
      && (isForeignPirateBattleReport(report, playerId) || isForeignNpcBattleReport(report, playerId)))) {
      next = { ...next, combat: { ...next.combat, reports: next.combat.reports.map((report) => report.rounds.length > 0
        && (isForeignPirateBattleReport(report, playerId) || isForeignNpcBattleReport(report, playerId)) ? compactForeignReport(report) : report) } };
    }
    const reports = next.combat.reports;
    let pirate = 0;
    let npc = 0;
    for (const report of reports) {
      if (isForeignPirateBattleReport(report, playerId)) pirate += 1;
      if (isForeignNpcBattleReport(report, playerId)) npc += 1;
    }
    // Within both limits the protected set is never consulted, so the array is
    // clean whatever the flights; above them, live flights protect reports.
    const withinLimits = pirate <= FOREIGN_PIRATE_BATTLE_REPORT_LIMIT && npc <= FOREIGN_NPC_BATTLE_REPORT_LIMIT;
    cleanBattleReports.set(reports, { playerId, flights: withinLimits ? null : next.flights.records });
  }

  const pirate = state.pirate;
  const cursor = pirate?.raidProcessedAt;
  // Nothing is stale while every roll is checked at or after the threshold.
  const firstRollCheck = pirate?.raidRolls ? earliestRollCheck(pirate.raidRolls) : Number.POSITIVE_INFINITY;
  if (pirate?.raidRolls && typeof cursor === 'number' && cursor - PIRATE_ROLL_LEDGER_MARGIN_MS > firstRollCheck) {
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

  const exploration = boundExplorationLedger(next.exploration);
  if (exploration !== next.exploration) next = { ...next, exploration };

  return next;
}

/**
 * The exploration ledger keeps the newest entries load keeps (see
 * migrateExplorationState): a world that is saved and loaded between two
 * replay groups must go on exactly like one that was never saved.
 */
const boundedLedgers = new WeakSet<object>();
function boundExplorationLedger(ledger: SaveState['exploration']): SaveState['exploration'] {
  if (!ledger || boundedLedgers.has(ledger)) return ledger;
  const bounded = boundExplorationLedgerOnce(ledger);
  boundedLedgers.add(bounded);
  return bounded;
}

function boundExplorationLedgerOnce(ledger: NonNullable<SaveState['exploration']>): NonNullable<SaveState['exploration']> {
  const contactIds = Object.keys(ledger.contacts);
  const oversizedContact = (contact: ExplorationContact) => (contact.rareUsedByOwner?.length ?? 0) > 64 || (contact.events?.length ?? 0) > 100;
  const contactsOver = contactIds.length > 256 || contactIds.some((id) => oversizedContact(ledger.contacts[id]!));
  if (!contactsOver && Object.keys(ledger.highestScoresByOwner).length <= 256 && (ledger.acceptedContactIds?.length ?? 0) <= 256
    && (ledger.reconReports?.length ?? 0) <= 256 && ledger.completed.length <= 200) return ledger;
  const contacts = contactsOver ? Object.fromEntries(contactIds.slice(-256).map((id) => {
    const contact = ledger.contacts[id]!;
    return [id, oversizedContact(contact)
      ? { ...contact, rareUsedByOwner: contact.rareUsedByOwner.slice(-64), events: contact.events.slice(-100) } : contact];
  })) : ledger.contacts;
  const scores = Object.entries(ledger.highestScoresByOwner);
  return {
    ...ledger,
    contacts,
    highestScoresByOwner: scores.length > 256 ? Object.fromEntries(scores.slice(-256)) : ledger.highestScoresByOwner,
    acceptedContactIds: (ledger.acceptedContactIds?.length ?? 0) > 256 ? ledger.acceptedContactIds!.slice(-256) : ledger.acceptedContactIds,
    reconReports: (ledger.reconReports?.length ?? 0) > 256 ? ledger.reconReports!.slice(-256) : ledger.reconReports,
    completed: ledger.completed.length > 200 ? ledger.completed.slice(-200) : ledger.completed,
  };
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
