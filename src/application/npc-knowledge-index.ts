import { getOrbitalDebrisByCoordinate } from '../domain/espionage/orbital-debris.ts';
import type { EspionageState } from '../domain/espionage/types.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import type { SpyMission, SpyReportSnapshot } from '../domain/espionage/types.ts';
import type { FlightRecord } from '../domain/flights/types.ts';

/**
 * Per-owner views of the save's append-mostly archives. Each index is built
 * once per immutable array (a new battle or report produces a new array), so
 * the many decisions read at one moment share it instead of rescanning
 * everything. Contents are exactly what a full scan would select.
 */

// Report ownership may fall back to the producing mission, so that index is tied to both arrays.
const spyByOwner = new WeakMap<readonly SpyReportSnapshot[], { missions: readonly SpyMission[]; index: Map<string, SpyReportSnapshot[]> }>();
const battlesByOwner = new WeakMap<readonly BattleReport[], Map<string, BattleReport[]>>();
const flightsByOwner = new WeakMap<readonly FlightRecord[], Map<string, FlightRecord[]>>();

function push<T>(map: Map<string, T[]>, key: string | undefined, value: T): void {
  if (!key) return;
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

/** Spy reports an owner received (by report owner, else by the mission that produced it), in save order. */
export function ownerSpyReports(reports: readonly SpyReportSnapshot[], missions: readonly SpyMission[], ownerId: string): readonly SpyReportSnapshot[] {
  const cached = spyByOwner.get(reports);
  if (cached && cached.missions === missions) return cached.index.get(ownerId) ?? [];
  const extended = extendSpyIndex(reports, missions);
  if (extended) return extended.get(ownerId) ?? [];
  const index = new Map<string, SpyReportSnapshot[]>();
  // First match, as Array.find over the missions would pick.
  const missionOwner = new Map<string, string>();
  for (const mission of missions) if (!missionOwner.has(mission.id)) missionOwner.set(mission.id, mission.ownerId);
  for (const report of reports) {
    const owner = typeof report.ownerId === 'string' && report.ownerId.length > 0 ? report.ownerId : missionOwner.get(report.missionId);
    push(index, owner, report);
  }
  spyByOwner.set(reports, { missions, index });
  lastSpyIndex = { reports, missions, index, ownerless: reports.some((report) => !(typeof report.ownerId === 'string' && report.ownerId.length > 0)) };
  return index.get(ownerId) ?? [];
}

/**
 * A new report usually only appends to the archive. When the previous indexed
 * array is an exact prefix and every report carries its owner (so missions are
 * not consulted), the index is that one plus the new reports: buckets of
 * untouched owners are shared, touched ones copied (older arrays keep theirs).
 */
let lastSpyIndex: { reports: readonly SpyReportSnapshot[]; missions: readonly SpyMission[]; index: Map<string, SpyReportSnapshot[]>; ownerless: boolean } | null = null;
function extendSpyIndex(reports: readonly SpyReportSnapshot[], missions: readonly SpyMission[]): Map<string, SpyReportSnapshot[]> | null {
  const last = lastSpyIndex;
  if (!last || last.ownerless || reports.length < last.reports.length) return null;
  for (let at = last.reports.length - 1; at >= 0; at -= 1) if (reports[at] !== last.reports[at]) return null;
  const index = new Map(last.index);
  const copied = new Set<string>();
  for (let at = last.reports.length; at < reports.length; at += 1) {
    const report = reports[at]!;
    if (!(typeof report.ownerId === 'string' && report.ownerId.length > 0)) return null;
    const owner = report.ownerId;
    if (!copied.has(owner)) { copied.add(owner); index.set(owner, [...(index.get(owner) ?? [])]); }
    index.get(owner)!.push(report);
  }
  spyByOwner.set(reports, { missions, index });
  lastSpyIndex = { reports, missions, index, ownerless: false };
  return index;
}

/** Battles an owner fought on either side, in save order. */
export function ownerBattleReports(reports: readonly BattleReport[], ownerId: string): readonly BattleReport[] {
  let index = battlesByOwner.get(reports);
  if (!index) {
    index = new Map();
    for (const report of reports) {
      push(index, report.attacker.playerId, report);
      if (report.defender.playerId !== report.attacker.playerId) push(index, report.defender.playerId, report);
    }
    battlesByOwner.set(reports, index);
  }
  return index.get(ownerId) ?? [];
}

/** Flights an owner launched (owner-bound records), in save order. */
export function ownerFlights(records: readonly FlightRecord[], ownerId: string): readonly FlightRecord[] {
  let index = flightsByOwner.get(records);
  if (!index) {
    index = new Map();
    for (const flight of records) push(index, flight.ownerId, flight);
    flightsByOwner.set(records, index);
  }
  return index.get(ownerId) ?? [];
}

const flightsByDestination = new WeakMap<readonly FlightRecord[], Map<string, FlightRecord[]>>();

/** Flights headed for a planet (by destination planet id), in save order. */
export function flightsToPlanet(records: readonly FlightRecord[], planetId: string): readonly FlightRecord[] {
  let index = flightsByDestination.get(records);
  if (!index) {
    index = new Map();
    for (const flight of records) push(index, flight.destinationPlanetId, flight);
    flightsByDestination.set(records, index);
  }
  return index.get(planetId) ?? [];
}

const debrisByEspionage = new WeakMap<object, ReturnType<typeof getOrbitalDebrisByCoordinate>>();

/** Debris on the public map (planet orbits, ledger records), built once per immutable espionage state. */
export function publicDebrisEntries(espionage: EspionageState | undefined): ReturnType<typeof getOrbitalDebrisByCoordinate> {
  if (!espionage) return [];
  let entries = debrisByEspionage.get(espionage);
  if (!entries) debrisByEspionage.set(espionage, entries = getOrbitalDebrisByCoordinate(espionage));
  return entries;
}
