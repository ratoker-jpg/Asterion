import { PIRATE_BASE_SHIPS } from './catalog.ts';
import type { PirateProfile, PirateShipShares } from './profile.ts';
import { PIRATE_RECON_SUCCESS_THRESHOLD, type PirateReconMissionSnapshot, type PirateReconOutcome } from './recon.ts';
import { isCanonicalPirateContactCycleKey } from './contact-schedule.ts';

const SHIP_NAME_BY_ID = new Map(PIRATE_BASE_SHIPS.map((ship) => [ship.id, ship.name]));
const SHIP_ID_BY_NAME = new Map(PIRATE_BASE_SHIPS.map((ship) => [ship.name, ship.id]));

export type PirateReconReportShip = Readonly<{
  name: string;
  populationPercent: number;
}>;

/** Public intel is limited to allowed ship names, population shares, and ship level; it excludes counts, tiers, and technologies. */
export type PirateReconReport = Readonly<{
  id: `pirate-recon:${string}`;
  missionId: string;
  ownerId: string;
  contactCycleKey: string;
  coordinate: Readonly<{ galaxy: number; system: number; position: number }>;
  dispatchedAt: number;
  arrivedAt: number;
  outcome: PirateReconOutcome;
  intel?: Readonly<{
    ships: readonly PirateReconReportShip[];
    shipLevel: number;
  }>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function normalizedPercentages(shares: PirateShipShares): PirateReconReportShip[] {
  const total = PIRATE_BASE_SHIPS.reduce((sum, ship) => sum + (shares[ship.id] ?? 0), 0);
  if (!Number.isFinite(total) || Math.abs(total - 100) > 1e-9) {
    throw new Error('A successful pirate recon report requires ship shares totaling 100%.');
  }

  const active = PIRATE_BASE_SHIPS
    .map((ship) => ({ id: ship.id, name: SHIP_NAME_BY_ID.get(ship.id)!, share: shares[ship.id] ?? 0 }))
    .filter((ship) => ship.share > 0);
  if (!active.length) throw new Error('A successful pirate recon report requires at least one ship class.');

  // Profiles currently use 5% slices; largest remainder also keeps this adapter
  // exact if future profile versions use fractional shares.
  const raw = active.map((ship) => ({ ...ship, exact: ship.share * 100 / total }));
  const rounded = raw.map((ship) => Math.floor(ship.exact));
  let remaining = 100 - rounded.reduce((sum, percent) => sum + percent, 0);
  const remainderOrder = raw
    .map((ship, index) => ({ index, remainder: ship.exact - rounded[index]! }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const item of remainderOrder) {
    if (remaining <= 0) break;
    rounded[item.index]! += 1;
    remaining -= 1;
  }
  return active.flatMap((ship, index) => rounded[index]! > 0
    ? [Object.freeze({ name: ship.name, populationPercent: rounded[index]! })]
    : []);
}

/** Build a historical report from the frozen profile for this exact contact cycle. */
export function createPirateReconReport(input: {
  mission: PirateReconMissionSnapshot;
  coordinate: Readonly<{ galaxy: number; system: number; position: number }>;
  arrivedAt: number;
  profile?: PirateProfile;
  currentContactCycleKey?: string;
}): PirateReconReport {
  const { mission } = input;
  if (!Number.isSafeInteger(input.arrivedAt) || input.arrivedAt < mission.dispatchedAt) {
    throw new Error('Pirate recon arrival time must be a valid timestamp after dispatch.');
  }
  const coordinate = Object.freeze({ ...input.coordinate });
  const base = {
    id: `pirate-recon:${mission.missionId}` as const,
    missionId: mission.missionId,
    ownerId: mission.ownerId,
    contactCycleKey: mission.contactCycleKey,
    coordinate,
    dispatchedAt: mission.dispatchedAt,
    arrivedAt: input.arrivedAt,
  };
  if (input.currentContactCycleKey !== mission.contactCycleKey) {
    return Object.freeze({ ...base, outcome: 'no-target' as const });
  }

  const outcome = mission.roll < PIRATE_RECON_SUCCESS_THRESHOLD ? 'success' : 'failure';
  if (outcome === 'failure') return Object.freeze({ ...base, outcome });
  const profile = input.profile;
  if (!profile || profile.ownerId !== mission.ownerId || profile.contactCycleKey !== mission.contactCycleKey) {
    throw new Error('A successful pirate recon report requires the frozen profile for its owner and contact cycle.');
  }
  const intel = Object.freeze({
    ships: Object.freeze(normalizedPercentages(profile.shares)),
    shipLevel: profile.shipLevel,
  });
  return Object.freeze({ ...base, outcome, intel });
}

/** Strict save normalizer: invalid or revealing legacy payloads are discarded. */
export function normalizePirateReconReport(value: unknown): PirateReconReport | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.missionId !== 'string'
    || !value.missionId.trim()
    || value.id !== `pirate-recon:${value.missionId}`
    || typeof value.ownerId !== 'string'
    || !value.ownerId.trim()
    || typeof value.contactCycleKey !== 'string'
    || !isCanonicalPirateContactCycleKey(value.contactCycleKey)
    || !isTimestamp(value.dispatchedAt)
    || !isTimestamp(value.arrivedAt)
    || value.arrivedAt < value.dispatchedAt
    || !isRecord(value.coordinate)
    || !['success', 'failure', 'no-target'].includes(String(value.outcome))) return null;

  const coordinateValue = value.coordinate;
  if (!['galaxy', 'system', 'position'].every((key) => Number.isSafeInteger(coordinateValue[key]))) return null;
  const cycleParts = value.contactCycleKey.split(':');
  const galaxy = coordinateValue.galaxy as number;
  const system = coordinateValue.system as number;
  const position = coordinateValue.position as number;
  if (galaxy < 1 || system < 1 || system > 40 || position < 1 || position > 24
    || Number(cycleParts[1]) !== galaxy
    || Number(cycleParts[2]) !== system) return null;
  const coordinate = Object.freeze({
    galaxy,
    system,
    position,
  });
  const common = {
    id: value.id as `pirate-recon:${string}`,
    missionId: value.missionId,
    ownerId: value.ownerId,
    contactCycleKey: value.contactCycleKey,
    coordinate,
    dispatchedAt: value.dispatchedAt,
    arrivedAt: value.arrivedAt,
  };
  if (value.outcome !== 'success') {
    if (value.intel !== undefined) return null;
    return Object.freeze({ ...common, outcome: value.outcome as 'failure' | 'no-target' });
  }

  if (!isRecord(value.intel)
    || !Array.isArray(value.intel.ships)
    || !Number.isSafeInteger(value.intel.shipLevel)
    || Number(value.intel.shipLevel) < 0
    || Number(value.intel.shipLevel) > 10) return null;

  const seenShips = new Set<string>();
  let percentTotal = 0;
  const ships: PirateReconReportShip[] = [];
  for (const candidate of value.intel.ships) {
    if (!isRecord(candidate)
      || typeof candidate.name !== 'string'
      || !SHIP_ID_BY_NAME.has(candidate.name)
      || seenShips.has(candidate.name)
      || !Number.isSafeInteger(candidate.populationPercent)
      || Number(candidate.populationPercent) <= 0
      || Number(candidate.populationPercent) > 100) return null;
    seenShips.add(candidate.name);
    percentTotal += Number(candidate.populationPercent);
    ships.push(Object.freeze({ name: candidate.name, populationPercent: Number(candidate.populationPercent) }));
  }
  if (!ships.length || percentTotal !== 100) return null;

  const intel = Object.freeze({
    ships: Object.freeze(ships),
    shipLevel: Number(value.intel.shipLevel),
  });
  return Object.freeze({ ...common, outcome: 'success' as const, intel });
}

/** Upsert by mission identity; there is deliberately no age-based retention cap. */
export function upsertPirateReconReport(
  reports: readonly PirateReconReport[],
  report: PirateReconReport,
): PirateReconReport[] {
  return [...reports.filter((item) => item.id !== report.id), report];
}

export type PirateReconReportItem = Readonly<{
  id: string;
  source: 'pirate-recon';
  category: 'system';
  typeLabel: 'Отчёт разведки пиратов';
  title: string;
  preview: string;
  body: string;
  timestamp: string;
  statusLabel: string;
  statusTone: 'success' | 'danger' | 'info';
  participantNames: string[];
  planetNames: string[];
  coordinates: string[];
  details: Array<{ label: string; value: string }>;
  pirateReconReport: PirateReconReport;
}>;

/** Present the dedicated pirate recon report without creating a SpyReportSnapshot. */
export function pirateReconReportToReportItem(report: PirateReconReport): PirateReconReportItem {
  const coordinate = `[${report.coordinate.galaxy}:${report.coordinate.system}:${report.coordinate.position}]`;
  const ships = report.intel?.ships ?? [];
  const title = report.outcome === 'success'
    ? 'Разведка пиратов успешна'
    : report.outcome === 'failure'
      ? 'Разведка пиратов не удалась'
      : 'Планета пиратов не обнаружена';
  const details: Array<{ label: string; value: string }> = [{ label: 'Координаты', value: coordinate }];
  if (report.outcome === 'success' && report.intel) {
    details.push({ label: 'Уровень кораблей', value: String(report.intel.shipLevel) });
    ships.forEach((ship) => details.push({ label: ship.name, value: `${ship.populationPercent}% населения` }));
  }
  const statusLabel = report.outcome === 'success' ? 'РАЗВЕДКА УСПЕШНА'
    : report.outcome === 'failure' ? 'РАЗВЕДКА НЕ УДАЛАСЬ' : 'ЦЕЛЬ НЕ НАЙДЕНА';
  const statusTone = report.outcome === 'success' ? 'success' : report.outcome === 'failure' ? 'danger' : 'info';
  const body = report.outcome === 'success' && report.intel
    ? `${title}. Координаты: ${coordinate}. Состав по населению: ${ships.map((ship) => `${ship.name} — ${ship.populationPercent}%`).join(', ')}. Уровень кораблей: ${report.intel.shipLevel}.`
    : report.outcome === 'failure'
      ? `${title}. Пиратский комплекс обнаружен по координатам ${coordinate}, но зонд не смог получить данные о составе.`
      : `По указанным координатам планеты пиратов не обнаружено: ${coordinate}.`;
  return {
    id: report.id,
    source: 'pirate-recon',
    category: 'system',
    typeLabel: 'Отчёт разведки пиратов',
    title,
    preview: body,
    body,
    timestamp: new Date(report.arrivedAt).toISOString(),
    statusLabel,
    statusTone,
    participantNames: [],
    planetNames: [],
    coordinates: [coordinate],
    details,
    pirateReconReport: report,
  };
}
