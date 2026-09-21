import type {
  Bot01PlanetState,
  Bot01Profile,
  EspionageState,
  SpyHunterNotice,
  SpyMission,
  SpyOwnerProfile,
  SpyReportSnapshot,
  SpyTargetState,
} from './types.ts';
import { createDefaultEspionageState } from './runtime.ts';
import { createBot01Planets, createDefaultBot01Profile } from './fixtures.ts';
import { migrateFleetState } from '../fleet/runtime.ts';
import { migrateDefenseState } from '../fleet/production.ts';
import { migrateRepairWorkshopState } from '../repair/workshop.ts';
import { createDefaultBuildingLevels, migrateBuildingQueue } from '../buildings/resource-zone.ts';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function nonNegative(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function numericRecord(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([key, candidate]) => (
    typeof candidate === 'number' && Number.isFinite(candidate) ? [[key, Math.max(0, Math.floor(candidate))]] : []
  )));
}

function migrateTargetResourceClock(value: unknown, now: number) {
  const source = record(value);
  const safeNow = nonNegative(now, Date.now());
  const lastReconciledAt = Math.min(safeNow, nonNegative(source.lastReconciledAt, safeNow));
  const remainder = record(source.remainder);
  return {
    lastReconciledAt,
    remainder: {
      metal: Math.min(0.999_999_999, Math.max(0, Number(remainder.metal) || 0)),
      minerals: Math.min(0.999_999_999, Math.max(0, Number(remainder.minerals) || 0)),
      gas: Math.min(0.999_999_999, Math.max(0, Number(remainder.gas) || 0)),
    },
  };
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
  if (targetRelation !== 'self' && targetRelation !== 'ally' && targetRelation !== 'enemy' && targetRelation !== 'neutral') return null;
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
    if (source.fleetLevels && typeof source.fleetLevels === 'object' && !Array.isArray(source.fleetLevels)) {
      base.fleetLevels = numericRecord(source.fleetLevels) as SpyReportSnapshot['fleetLevels'];
    }
    base.commanders = record(source.commanders) as SpyReportSnapshot['commanders'];
    const fleetPopulation = nonNegative(population.fleet);
    const defensePopulation = nonNegative(population.defense);
    // Preserve the stored total for historical reports. New reports write the
    // owner-wide orbital composition total; old snapshots are never rewritten.
    const storedTotal = nonNegative(population.total, fleetPopulation + defensePopulation);
    base.population = {
      total: storedTotal,
      fleet: fleetPopulation,
      defense: defensePopulation,
      ...(Number.isFinite(population.civilian) ? { civilian: nonNegative(population.civilian) } : {}),
    };
  }
  return base;
}

function migrateBot01Profile(value: unknown): Bot01Profile | null {
  const source = record(value);
  if (!Object.keys(source).length) return null;
  return migrateSpyOwnerProfile(source) as Bot01Profile;
}

function migrateSpyOwnerProfile(value: unknown): SpyOwnerProfile | undefined {
  const source = record(value);
  if (!Object.keys(source).length) return undefined;
  return {
    scienceLevels: numericRecord(source.scienceLevels) as SpyOwnerProfile['scienceLevels'],
    shipLevels: numericRecord(source.shipLevels) as SpyOwnerProfile['shipLevels'],
    commanderLevels: numericRecord(source.commanderLevels) as SpyOwnerProfile['commanderLevels'],
  };
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

function migrateSpyTarget(value: unknown, now: number): SpyTargetState | null {
  const source = record(value);
  const coordinate = record(source.coordinate);
  if (!text(source.id) || ![coordinate.galaxy, coordinate.system, coordinate.position].every((part) => Number.isInteger(part) && Number(part) >= 1)) return null;
  const resources = record(source.resources);
  const legacyDebris = nonNegative(source.debris);
  const canonicalDebris = nonNegative(resources.debris, legacyDebris);
  const commanders = record(source.commanders);
  const migratedCommanders = Object.fromEntries(Object.entries(commanders).flatMap(([id, candidate]) => {
    const entry = record(candidate);
    const count = Math.min(1, nonNegative(entry.count));
    return count > 0 ? [[id, { level: nonNegative(entry.level), count }]] : [];
  }));
  const ownerProfile = migrateSpyOwnerProfile(source.ownerProfile)
    ?? (Object.keys(record(source.shipLevels)).length
      ? migrateSpyOwnerProfile({ shipLevels: source.shipLevels })
      : undefined);
  const buildingLevels = numericRecord(source.buildings);
  const buildingQueue = Array.isArray(source.buildingQueue)
    ? migrateBuildingQueue(source.buildingQueue, text(source.id), { ...createDefaultBuildingLevels(), ...buildingLevels })
    : undefined;
  const endgameLockedBuildings = Array.isArray(source.endgameLockedBuildings)
    ? source.endgameLockedBuildings.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined;
  const {
    debris: _legacyDebris,
    ownerProfile: _legacyOwnerProfile,
    shipLevels: _legacyShipLevels,
    buildingQueue: _legacyBuildingQueue,
    endgameLockedBuildings: _legacyEndgameLockedBuildings,
    ...sourceWithoutLegacyProfile
  } = source;
  return {
    ...sourceWithoutLegacyProfile,
    id: text(source.id),
    coordinate: { galaxy: Number(coordinate.galaxy), system: Number(coordinate.system), position: Number(coordinate.position) },
    ownerId: text(source.ownerId, 'unknown-owner'),
    ownerName: text(source.ownerName, 'Неизвестный владелец'),
    raceId: source.raceId === 'synod' || source.raceId === 'veyra' ? source.raceId : 'aegis',
    alliance: source.alliance && typeof source.alliance === 'object' ? source.alliance as SpyTargetState['alliance'] : null,
    // Bot 01's test espionage level is an explicit fixture contract, while
    // injected future owners may provide their own level.
    espionageLevel: nonNegative(source.espionageLevel, 10),
    resources: {
      metal: nonNegative(resources.metal),
      minerals: nonNegative(resources.minerals),
      gas: nonNegative(resources.gas),
      debris: canonicalDebris,
      developmentEnergy: nonNegative(resources.developmentEnergy),
    },
    buildings: buildingLevels,
    fleet: migrateFleetState(source.fleet),
    defense: migrateDefenseState(source.defense),
    commanders: migratedCommanders as SpyTargetState['commanders'],
    ...(ownerProfile ? { ownerProfile } : {}),
    repair: migrateRepairWorkshopState(source.repair),
    ...(buildingQueue ? { buildingQueue } : {}),
    ...(endgameLockedBuildings ? { endgameLockedBuildings } : {}),
    resourceClock: migrateTargetResourceClock(source.resourceClock, now),
  } as unknown as SpyTargetState;
}

function spyTargetMatchesCurrentContract(value: SpyTargetState): boolean {
  const population = value.population as SpyTargetState['population'] & { civilian?: number };
  return Number.isFinite(population.total)
    && Number.isFinite(population.fleet)
    && Number.isFinite(population.defense)
    && population.total === population.fleet + population.defense
    && !('civilian' in population)
    // `shipLevels` was the old per-planet experiment. Current levels live in
    // the owner profile and must not survive as a second source of truth.
    && !('shipLevels' in value);
}

export function migrateEspionageState(value: unknown, now = Date.now()): EspionageState {
  if (!value || typeof value !== 'object') return createDefaultEspionageState();
  const source = record(value);
  const bot01Profile = migrateBot01Profile(source.bot01Profile);
  const hasCanonicalTargets = Boolean(source.targets && typeof source.targets === 'object' && !Array.isArray(source.targets));
  const hasLegacyBotTargets = Boolean(source.bot01Planets && typeof source.bot01Planets === 'object' && !Array.isArray(source.bot01Planets));
  const rawTargets = hasCanonicalTargets ? source.targets : source.bot01Planets;
  const migratedTargets = rawTargets
    ? Object.fromEntries(Object.entries(rawTargets).flatMap(([id, candidate]) => {
      const migrated = migrateSpyTarget(candidate, now);
      return migrated ? [[id, migrated]] : [];
    }))
    : undefined;
  const hasTargets = Boolean(migratedTargets && Object.keys(migratedTargets).length);
  const legacyBotTargetsNeedRepair = !hasCanonicalTargets
    && hasTargets
    && !Object.values(migratedTargets!).every(spyTargetMatchesCurrentContract);
  const targets = legacyBotTargetsNeedRepair ? createBot01Planets(now) : migratedTargets;
  const currentBot01Profile = bot01Profile ?? (hasLegacyBotTargets && hasTargets ? createDefaultBot01Profile() : undefined);
  return {
    missions: list(source.missions, migrateMission),
    reports: list(source.reports, migrateReport),
    hunterNotices: list(source.hunterNotices, migrateNotice),
    ...(targets ? { targets } : {}),
    ...(hasLegacyBotTargets && targets ? { bot01Planets: targets as Record<string, Bot01PlanetState> } : {}),
    ...(currentBot01Profile ? { bot01Profile: currentBot01Profile } : {}),
  };
}
