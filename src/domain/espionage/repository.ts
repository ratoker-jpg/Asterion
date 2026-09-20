import type {
  Bot01PlanetState,
  EspionageState,
  SpyHunterNotice,
  SpyMission,
  SpyReportSnapshot,
} from './types.ts';
import { createDefaultEspionageState } from './runtime.ts';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function nonNegative(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function list<T>(value: unknown, migrate: (candidate: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.flatMap((candidate) => {
    const migrated = migrate(candidate);
    return migrated ? [migrated] : [];
  }) : [];
}

function migrateMission(value: unknown): SpyMission | null {
  const source = record(value);
  const status = source.status as SpyMission['status'];
  if (!['transit', 'orbiting', 'returning', 'returned', 'destroyed'].includes(String(status))) return null;
  const targetRelation = source.targetRelation;
  if (targetRelation !== 'enemy' && targetRelation !== 'neutral') return null;
  const coordinate = record(source.targetCoordinate);
  if (![coordinate.galaxy, coordinate.system, coordinate.position].every((part) => Number.isInteger(part) && Number(part) >= 1)) return null;
  const id = text(source.id);
  const flightId = text(source.flightId);
  const targetPlanetId = text(source.targetPlanetId);
  if (!id || !flightId || !targetPlanetId) return null;
  return {
    id,
    flightId,
    ownerId: text(source.ownerId, 'unknown-owner'),
    originPlanetId: text(source.originPlanetId, 'helion-01'),
    targetPlanetId,
    targetPlanetName: text(source.targetPlanetName, 'Неизвестная планета'),
    targetOwnerId: text(source.targetOwnerId, 'unknown-owner'),
    targetOwnerName: text(source.targetOwnerName, 'Неизвестный владелец'),
    targetRaceId: source.targetRaceId === 'synod' || source.targetRaceId === 'veyra' ? source.targetRaceId : 'aegis',
    targetAlliance: source.targetAlliance && typeof source.targetAlliance === 'object' ? source.targetAlliance as SpyMission['targetAlliance'] : null,
    targetRelation,
    targetCoordinate: { galaxy: Number(coordinate.galaxy), system: Number(coordinate.system), position: Number(coordinate.position) },
    spyLevel: nonNegative(source.spyLevel),
    targetEspionageLevel: nonNegative(source.targetEspionageLevel, 10),
    status,
    sentAt: nonNegative(source.sentAt),
    arrivalAt: nonNegative(source.arrivalAt),
    ...(Number.isFinite(source.arrivedAt) ? { arrivedAt: Number(source.arrivedAt) } : {}),
    ...(Number.isFinite(source.lastReportAt) ? { lastReportAt: Number(source.lastReportAt) } : {}),
    ...(Number.isFinite(source.nextReportAt) ? { nextReportAt: Number(source.nextReportAt) } : {}),
    ...(Number.isFinite(source.returnedAt) ? { returnedAt: Number(source.returnedAt) } : {}),
    ...(Number.isFinite(source.destroyedAt) ? { destroyedAt: Number(source.destroyedAt) } : {}),
    reportIds: Array.isArray(source.reportIds) ? source.reportIds.filter((item): item is string => typeof item === 'string') : [],
  };
}

function migrateReport(value: unknown): SpyReportSnapshot | null {
  const source = record(value);
  const quality = source.quality;
  if (quality !== 'basic' && quality !== 'detailed' && quality !== 'full') return null;
  const relation = source.targetRelation;
  if (relation !== 'enemy' && relation !== 'neutral') return null;
  const coordinate = record(source.targetCoordinate);
  if (![coordinate.galaxy, coordinate.system, coordinate.position].every((part) => Number.isInteger(part) && Number(part) >= 1)) return null;
  const id = text(source.id);
  const missionId = text(source.missionId);
  if (!id || !missionId) return null;
  const resources = record(source.resources);
  const population = record(source.population);
  const base: SpyReportSnapshot = {
    id,
    missionId,
    createdAt: nonNegative(source.createdAt),
    sourcePlanetId: text(source.sourcePlanetId, 'helion-01'),
    targetPlanetId: text(source.targetPlanetId),
    targetPlanetName: text(source.targetPlanetName, 'Неизвестная планета'),
    targetOwnerId: text(source.targetOwnerId, 'unknown-owner'),
    targetOwnerName: text(source.targetOwnerName, 'Неизвестный владелец'),
    targetRaceId: source.targetRaceId === 'synod' || source.targetRaceId === 'veyra' ? source.targetRaceId : 'aegis',
    targetRelation: relation,
    targetCoordinate: { galaxy: Number(coordinate.galaxy), system: Number(coordinate.system), position: Number(coordinate.position) },
    spyLevel: nonNegative(source.spyLevel),
    targetEspionageLevel: nonNegative(source.targetEspionageLevel, 10),
    delta: Number.isFinite(source.delta) ? Number(source.delta) : 0,
    roll: nonNegative(source.roll),
    quality,
    resources: {
      metal: nonNegative(resources.metal),
      minerals: nonNegative(resources.minerals),
      gas: nonNegative(resources.gas),
      debris: nonNegative(resources.debris),
      developmentEnergy: nonNegative(resources.developmentEnergy, nonNegative(resources.energy)),
    },
    firstReport: source.firstReport === true,
  };
  if (quality === 'detailed' || quality === 'full') {
    base.defense = record(source.defense) as SpyReportSnapshot['defense'];
  }
  if (quality === 'full') {
    base.fleet = record(source.fleet) as SpyReportSnapshot['fleet'];
    base.commanders = record(source.commanders) as SpyReportSnapshot['commanders'];
    base.population = {
      total: nonNegative(population.total, nonNegative(population.civilian) + nonNegative(population.fleet) + nonNegative(population.defense)),
      fleet: nonNegative(population.fleet),
      defense: nonNegative(population.defense),
    };
  }
  return base;
}

function migrateNotice(value: unknown): SpyHunterNotice | null {
  const source = record(value);
  const coordinate = record(source.targetCoordinate);
  if (!text(source.id) || !text(source.missionId) || !text(source.targetPlanetId)
    || ![coordinate.galaxy, coordinate.system, coordinate.position].every((part) => Number.isInteger(part) && Number(part) >= 1)) return null;
  return {
    id: text(source.id),
    missionId: text(source.missionId),
    createdAt: nonNegative(source.createdAt),
    targetPlanetId: text(source.targetPlanetId),
    targetPlanetName: text(source.targetPlanetName, 'Неизвестная планета'),
    targetOwnerName: text(source.targetOwnerName, 'Неизвестный владелец'),
    targetCoordinate: { galaxy: Number(coordinate.galaxy), system: Number(coordinate.system), position: Number(coordinate.position) },
    hunterLevel: nonNegative(source.hunterLevel),
  };
}

function migrateBotPlanet(value: unknown): Bot01PlanetState | null {
  const source = record(value);
  const coordinate = record(source.coordinate);
  if (!text(source.id) || ![coordinate.galaxy, coordinate.system, coordinate.position].every((part) => Number.isInteger(part) && Number(part) >= 1)) return null;
  return {
    ...source,
    id: text(source.id),
    coordinate: { galaxy: Number(coordinate.galaxy), system: Number(coordinate.system), position: Number(coordinate.position) },
    // Bot 01's test espionage level is an explicit fixture contract, not a
    // value that can drift with a saved building or fleet snapshot.
    espionageLevel: 10,
  } as unknown as Bot01PlanetState;
}

export function migrateEspionageState(value: unknown): EspionageState {
  if (!value || typeof value !== 'object') return createDefaultEspionageState();
  const source = record(value);
  const bot01Planets = source.bot01Planets && typeof source.bot01Planets === 'object' && !Array.isArray(source.bot01Planets)
    ? Object.fromEntries(Object.entries(source.bot01Planets).flatMap(([id, candidate]) => {
      const migrated = migrateBotPlanet(candidate);
      return migrated ? [[id, migrated]] : [];
    }))
    : undefined;
  return {
    missions: list(source.missions, migrateMission),
    reports: list(source.reports, migrateReport),
    hunterNotices: list(source.hunterNotices, migrateNotice),
    ...(bot01Planets && Object.keys(bot01Planets).length ? { bot01Planets } : {}),
  };
}
