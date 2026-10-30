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
const cleanSpyReports = new WeakMap<readonly unknown[], { playerId: string; oldestAt: number }>();
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

/**
 * Owner rule (30.10.2026): a report of any kind (battle, spy, hunter notice,
 * recon, arrival, overpopulation; the player's and NPCs') lives at most 24
 * game hours. Only battle reports the player saved stay, plus reports a live
 * flight or operation still names.
 */
export const REPORT_RETENTION_MS = 24 * 60 * 60_000;
/** NPC spy reports this old are gone: an owner re-spies a target it wants to read again. */
export const NPC_SPY_REPORT_STALE_MS = REPORT_RETENTION_MS;
const HOUR_MS = 3_600_000;

/**
 * The oldest report time still kept at `at`. It moves by whole hours (so the
 * archives are rescanned for age at most hourly) and rounds up, so nothing is
 * older than 24 hours. Readers that decide anything (NPCs) skip reports older
 * than the cutoff of their own moment: a prune made at any earlier time, e.g.
 * where a catch-up slice or a live tick ended, removes only what they skip.
 */
export function reportRetentionCutoff(at: number): number {
  return Math.ceil((at - REPORT_RETENTION_MS) / HOUR_MS) * HOUR_MS;
}

/** Whether a report made at `createdAt` is still within the retention window at `at`. */
export function isReportRetained(createdAt: number, at: number): boolean {
  return createdAt >= reportRetentionCutoff(at);
}

const battleTimes = new WeakMap<BattleReport, number>();
/** A battle report's game time (its ISO timestamp), parsed once per report. */
export function battleReportTime(report: BattleReport): number {
  let time = battleTimes.get(report);
  if (time === undefined) {
    const parsed = Date.parse(report.timestamp);
    battleTimes.set(report, time = Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY);
  }
  return time;
}

/** The player's read/hidden marks of reports long gone stop growing the save past this many. */
export const REPORT_MARK_LIMIT = 5_000;

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

const LIVE_REPORT_PREFIXES = ['battle-pirate-raid-', 'battle-pirate-', 'battle-attack-'] as const;
const liveReportIndexes = new WeakMap<readonly FlightRecord[], { flightIds: Set<string>; resolutions: Set<string> }>();
function liveFlightReportIndex(records: readonly FlightRecord[]) {
  let index = liveReportIndexes.get(records);
  if (!index) {
    index = { flightIds: new Set(), resolutions: new Set() };
    for (const flight of records) {
      if (TERMINAL_FLIGHT_PHASES.has(flight.phase)) continue;
      index.flightIds.add(flight.id);
      if (flight.attackResolution?.reportId) index.resolutions.add(flight.attackResolution.reportId);
    }
    liveReportIndexes.set(records, index);
  }
  return index;
}

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
  // Any report (the player's too) older than the retention window leaves.
  const spyReports = next.espionage?.reports ?? [];
  const cutoff = typeof at === 'number' ? reportRetentionCutoff(at) : Number.NEGATIVE_INFINITY;
  const spyMemo = cleanSpyReports.get(spyReports);
  if (!spyMemo || spyMemo.playerId !== playerId || cutoff > spyMemo.oldestAt) {
    const newestNpcReport = new Map<string, number>();
    spyReports.forEach((report, index) => {
      if (typeof report.ownerId !== 'string' || !report.ownerId || report.ownerId === playerId) return;
      let key = spyReportKeys.get(report);
      if (key === undefined) spyReportKeys.set(report, key = `${report.ownerId}\u0000${report.targetPlanetId}`);
      const previous = newestNpcReport.get(key);
      if (previous === undefined || spyReports[previous]!.createdAt <= report.createdAt) newestNpcReport.set(key, index);
    });
    const keptSpyIndexes = new Set(newestNpcReport.values());
    const spyKept = spyReports.filter((report, index) => report.createdAt >= cutoff && (typeof report.ownerId !== 'string' || !report.ownerId
      || report.ownerId === playerId || keptSpyIndexes.has(index)));
    if (spyKept.length !== spyReports.length) next = { ...next, espionage: { ...next.espionage!, reports: spyKept } };
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const report of spyKept) oldestAt = Math.min(oldestAt, report.createdAt);
    // When every report survives, the state keeps the original array. Cache
    // against that identity so the next replay group can reuse this scan.
    cleanSpyReports.set(spyKept.length === spyReports.length ? spyReports : spyKept, { playerId, oldestAt });
  }
  next = pruneExpiredNotes(next, cutoff);

  next = pruneExpiredBattleReports(next, state, cutoff);
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

  next = foldArchivedBattleAwards(next);
  if (typeof at === 'number') next = pruneOldPirateProfiles(next, at);

  return next;
}

/**
 * Pirate profiles are fixed per owner and contact cycle when the owner first
 * meets that cycle; a cycle is up for at most 75 minutes and its raids are
 * settled within hours, so a profile a day past its cycle's start is read by
 * nothing. Cycle keys end with the cycle's start time.
 */
export const PIRATE_PROFILE_ARCHIVE_MS = REPORT_RETENTION_MS;
const oldestProfileCycles = new WeakMap<object, number>();

function cycleStartAt(cycleKey: string): number {
  const start = Number(cycleKey.slice(cycleKey.lastIndexOf(':') + 1));
  return Number.isFinite(start) ? start : Number.POSITIVE_INFINITY;
}

function pruneOldPirateProfiles(next: SaveState, at: number): SaveState {
  const pirate = next.pirate;
  const profiles = pirate?.contact.ownerProfiles;
  if (!pirate || !profiles) return next;
  // Whole hours, as the report window: a pure function of the time.
  const before = Math.floor((at - PIRATE_PROFILE_ARCHIVE_MS) / HOUR_MS) * HOUR_MS;
  let oldest = oldestProfileCycles.get(profiles);
  if (oldest === undefined) {
    oldest = Number.POSITIVE_INFINITY;
    for (const cycles of Object.values(profiles)) for (const key of Object.keys(cycles)) oldest = Math.min(oldest, cycleStartAt(key));
    oldestProfileCycles.set(profiles, oldest);
  }
  if (oldest >= before) return next;
  let kept: Record<string, Readonly<Record<string, (typeof profiles)[string][string]>>> | null = null;
  let keptOldest = Number.POSITIVE_INFINITY;
  for (const [ownerId, cycles] of Object.entries(profiles)) {
    const keys = Object.keys(cycles);
    const recent = keys.filter((key) => cycleStartAt(key) >= before);
    for (const key of recent) keptOldest = Math.min(keptOldest, cycleStartAt(key));
    kept ??= {};
    if (recent.length === keys.length) kept[ownerId] = cycles;
    else if (recent.length) kept[ownerId] = Object.freeze(Object.fromEntries(recent.map((key) => [key, cycles[key]!])));
  }
  const ownerProfiles = Object.freeze(kept ?? {});
  oldestProfileCycles.set(ownerProfiles, keptOldest);
  return { ...next, pirate: Object.freeze({ ...pirate, contact: Object.freeze({ ...pirate.contact, ownerProfiles }) }) };
}

const foldedAwards = new WeakMap<object, readonly BattleReport[]>();

/**
 * A battle report that left the save takes its rating award along into the
 * per-owner archive total: totals stay exact, the ledger stays as small as
 * the reports. The archive is kept sorted by owner id, so its text does not
 * depend on the order reports left in.
 */
function foldArchivedBattleAwards(next: SaveState): SaveState {
  const rating = next.rating;
  const awards = rating.battleAwardsByReportId;
  if (foldedAwards.get(awards) === next.combat.reports) return next;
  const live = new Set(next.combat.reports.map((report) => report.id));
  let archive: Record<string, number> | null = null;
  let kept: Record<string, Record<string, number>> | null = null;
  for (const [reportId, owners] of Object.entries(awards)) {
    if (live.has(reportId)) {
      if (kept) kept[reportId] = owners;
      continue;
    }
    if (!kept) {
      kept = {};
      for (const [id, entry] of Object.entries(awards)) {
        if (id === reportId) break;
        kept[id] = entry;
      }
    }
    archive ??= { ...rating.archivedBattlePoints };
    for (const [ownerId, points] of Object.entries(owners)) {
      if (Number.isFinite(points) && points > 0) archive[ownerId] = (archive[ownerId] ?? 0) + Math.floor(points);
    }
  }
  if (!kept) {
    foldedAwards.set(awards, next.combat.reports);
    return next;
  }
  const sorted = archive ? Object.fromEntries(Object.entries(archive).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) : rating.archivedBattlePoints;
  foldedAwards.set(kept, next.combat.reports);
  return { ...next, rating: { ...rating, battleAwardsByReportId: kept, ...(sorted && Object.keys(sorted).length ? { archivedBattlePoints: sorted } : {}) } };
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

/** Battle reports no rule may drop: saved by the player, named by an operation or a live flight. */
function protectedBattleReportIds(next: SaveState, state: SaveState): { has: (id: string) => boolean } {
  const saved = new Set<string>(state.combat.savedReportIds);
  for (const operation of state.operations.items) if (operation.battleReportId) saved.add(operation.battleReportId);
  // A live flight resolves (and re-finds) its report by battle-pirate-raid-,
  // battle-pirate- or battle-attack- plus its id, or its resolution's id.
  const live = liveFlightReportIndex(next.flights.records);
  return { has: (id: string) => saved.has(id) || live.resolutions.has(id)
    || LIVE_REPORT_PREFIXES.some((prefix) => id.startsWith(prefix) && live.flightIds.has(id.slice(prefix.length))) };
}

// The oldest unprotected battle time of a report array, by identity.
const oldestBattles = new WeakMap<readonly BattleReport[], number>();

/** Battle reports past the retention window leave unless protected (see protectedBattleReportIds). */
function pruneExpiredBattleReports(next: SaveState, state: SaveState, cutoff: number): SaveState {
  const reports = next.combat.reports;
  let oldest = oldestBattles.get(reports);
  if (oldest === undefined) {
    oldest = Number.POSITIVE_INFINITY;
    for (const report of reports) oldest = Math.min(oldest, battleReportTime(report));
    oldestBattles.set(reports, oldest);
  }
  if (oldest >= cutoff) return next;
  const protectedIds = protectedBattleReportIds(next, state);
  const kept = reports.filter((report) => battleReportTime(report) >= cutoff || protectedIds.has(report.id));
  // The true oldest, protected ones included: whether a report leaves never
  // depends on which arrays were scanned before (a protection ends with a new
  // flights array or saved list, so old protected reports are re-checked).
  let oldestKept = Number.POSITIVE_INFINITY;
  for (const report of kept) oldestKept = Math.min(oldestKept, battleReportTime(report));
  const result = kept.length === reports.length ? reports : kept;
  oldestBattles.set(result, oldestKept);
  return result === reports ? next : { ...next, combat: { ...next.combat, reports: result } };
}

function keepRecent<T>(items: readonly T[] | undefined, time: (item: T) => number, cutoff: number): readonly T[] | undefined {
  if (!items?.length) return items;
  let expired = false;
  for (const item of items) if (time(item) < cutoff) { expired = true; break; }
  return expired ? items.filter((item) => time(item) >= cutoff) : items;
}

/**
 * The other report archives under the same window: hunter notices,
 * overpopulation, recycler and gas-extraction arrivals, pirate recon and
 * exploration recon. Each is a pure function of its records and the cutoff.
 */
function pruneExpiredNotes(next: SaveState, cutoff: number): SaveState {
  const reports = next.reports;
  if (reports.readIds.length > REPORT_MARK_LIMIT || reports.hiddenIds.length > REPORT_MARK_LIMIT) {
    next = { ...next, reports: { ...reports, readIds: reports.readIds.slice(-REPORT_MARK_LIMIT), hiddenIds: reports.hiddenIds.slice(-REPORT_MARK_LIMIT) } };
  }
  if (cutoff === Number.NEGATIVE_INFINITY) return next;
  const espionage = next.espionage;
  const notices = keepRecent(espionage?.hunterNotices, (notice) => notice.createdAt, cutoff);
  if (espionage && notices !== espionage.hunterNotices) next = { ...next, espionage: { ...espionage, hunterNotices: [...notices!] } };
  const mail = next.reports;
  const overpopulationReports = keepRecent(mail.overpopulationReports, (report) => report.episodeEndedAt, cutoff);
  const recyclerArrivalReports = keepRecent(mail.recyclerArrivalReports, (report) => report.arrivedAtMs, cutoff);
  const gasExtractionArrivalReports = keepRecent(mail.gasExtractionArrivalReports, (report) => report.arrivalAt, cutoff);
  if (overpopulationReports !== mail.overpopulationReports || recyclerArrivalReports !== mail.recyclerArrivalReports
    || gasExtractionArrivalReports !== mail.gasExtractionArrivalReports) {
    next = { ...next, reports: {
      ...mail,
      ...(overpopulationReports ? { overpopulationReports: [...overpopulationReports] } : {}),
      ...(recyclerArrivalReports ? { recyclerArrivalReports: [...recyclerArrivalReports] } : {}),
      ...(gasExtractionArrivalReports ? { gasExtractionArrivalReports: [...gasExtractionArrivalReports] } : {}),
    } };
  }
  const pirate = next.pirate;
  const reconReports = keepRecent(pirate?.reconReports, (report) => report.arrivedAt, cutoff);
  if (pirate && reconReports !== pirate.reconReports) next = { ...next, pirate: Object.freeze({ ...pirate, reconReports: Object.freeze([...reconReports!]) }) };
  const exploration = next.exploration;
  const explorationRecon = keepRecent(exploration?.reconReports, (report) => report.resolvedAt, cutoff);
  if (exploration && explorationRecon !== exploration.reconReports) next = { ...next, exploration: { ...exploration, reconReports: [...explorationRecon!] } };
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
  const protectedIds = protectedBattleReportIds(next, state);
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
