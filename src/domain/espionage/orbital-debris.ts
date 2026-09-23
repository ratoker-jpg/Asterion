import { getEspionageTargets } from './runtime.ts';
import type { EspionageState, OrbitalDebrisRecord, SpyTargetState } from './types.ts';
import type { UniverseCoordinate } from '../universe/types.ts';

type DebrisSource =
  | { kind: 'live'; targetId: string; targetKey: string; target: SpyTargetState; debris: number }
  | { kind: 'orbital'; targetId: string; ledgerKey: string; record: OrbitalDebrisRecord; debris: number };

function safeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

function addSafe(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function sameCoordinate(left: UniverseCoordinate, right: UniverseCoordinate): boolean {
  return left.galaxy === right.galaxy
    && left.system === right.system
    && left.position === right.position;
}

function coordinateKey(coordinate: UniverseCoordinate): string {
  return `${coordinate.galaxy}:${coordinate.system}:${coordinate.position}`;
}

function compareCoordinate(left: UniverseCoordinate, right: UniverseCoordinate): number {
  return left.galaxy - right.galaxy
    || left.system - right.system
    || left.position - right.position;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function getSourcesAtCoordinate(
  espionage: EspionageState,
  coordinate: UniverseCoordinate,
): DebrisSource[] {
  const targets = getEspionageTargets(espionage);
  const liveIds = new Set(Object.values(targets).map((target) => target.id));
  const sources: DebrisSource[] = [];
  const seenLiveIds = new Set<string>();

  const liveTargets = Object.entries(targets)
    .sort(([leftKey, left], [rightKey, right]) => compareText(left.id, right.id) || compareText(leftKey, rightKey));
  for (const [targetKey, target] of liveTargets) {
    if (seenLiveIds.has(target.id)) continue;
    seenLiveIds.add(target.id);
    if (!sameCoordinate(target.coordinate, coordinate)) continue;
    sources.push({
      kind: 'live',
      targetId: target.id,
      targetKey,
      target,
      debris: safeCount(target.resources?.debris),
    });
  }

  const seenOrbitalIds = new Set<string>();
  const orbitalRecords = Object.entries(espionage.orbitalDebris ?? {})
    .sort(([leftKey, left], [rightKey, right]) => compareText(left.targetPlanetId, right.targetPlanetId) || compareText(leftKey, rightKey));
  for (const [ledgerKey, record] of orbitalRecords) {
    if (liveIds.has(record.targetPlanetId) || seenOrbitalIds.has(record.targetPlanetId)) continue;
    seenOrbitalIds.add(record.targetPlanetId);
    if (!sameCoordinate(record.targetCoordinate, coordinate)) continue;
    sources.push({
      kind: 'orbital',
      targetId: record.targetPlanetId,
      ledgerKey,
      record,
      debris: safeCount(record.debris),
    });
  }

  return sources.sort((left, right) => compareText(left.targetId, right.targetId));
}

export function getOrbitalDebrisAtCoordinate(
  espionage: EspionageState,
  coordinate: UniverseCoordinate,
): number {
  return getSourcesAtCoordinate(espionage, coordinate)
    .reduce((total, source) => addSafe(total, source.debris), 0);
}

export function getOrbitalDebrisByCoordinate(
  espionage: EspionageState,
): Array<{ coordinate: UniverseCoordinate; debris: number }> {
  const coordinates = new Map<string, UniverseCoordinate>();
  const targets = getEspionageTargets(espionage);
  const liveIds = new Set(Object.values(targets).map((target) => target.id));
  for (const target of Object.values(targets)) coordinates.set(coordinateKey(target.coordinate), target.coordinate);
  for (const record of Object.values(espionage.orbitalDebris ?? {})) {
    if (liveIds.has(record.targetPlanetId)) continue;
    coordinates.set(coordinateKey(record.targetCoordinate), record.targetCoordinate);
  }

  return [...coordinates.values()]
    .sort(compareCoordinate)
    .map((coordinate) => ({ coordinate: { ...coordinate }, debris: getOrbitalDebrisAtCoordinate(espionage, coordinate) }));
}

export function collectOrbitalDebrisAtCoordinate(
  espionage: EspionageState,
  coordinate: UniverseCoordinate,
  capacity: number,
): { espionage: EspionageState; collected: number } {
  let remainingCapacity = safeCount(capacity);
  if (remainingCapacity <= 0) return { espionage, collected: 0 };

  const targets = getEspionageTargets(espionage);
  let updatedTargets: Record<string, SpyTargetState> | undefined;
  let updatedOrbitalDebris: Record<string, OrbitalDebrisRecord> | undefined;
  let collected = 0;

  for (const source of getSourcesAtCoordinate(espionage, coordinate)) {
    if (remainingCapacity <= 0 || source.debris <= 0) continue;
    const amount = Math.min(source.debris, remainingCapacity);
    const remainder = source.debris - amount;
    remainingCapacity -= amount;
    collected = addSafe(collected, amount);

    if (source.kind === 'live') {
      updatedTargets ??= { ...targets };
      updatedTargets[source.targetKey] = {
        ...source.target,
        resources: { ...source.target.resources, debris: remainder },
      };
    } else {
      updatedOrbitalDebris ??= { ...(espionage.orbitalDebris ?? {}) };
      if (remainder <= 0) delete updatedOrbitalDebris[source.ledgerKey];
      else updatedOrbitalDebris[source.ledgerKey] = { ...source.record, debris: remainder };
    }
  }

  if (!updatedTargets && !updatedOrbitalDebris) return { espionage, collected: 0 };

  const next: EspionageState = { ...espionage };
  if (updatedTargets) {
    if (espionage.targets) next.targets = updatedTargets;
    else if (espionage.bot01Planets) next.bot01Planets = updatedTargets as EspionageState['bot01Planets'];
    else next.targets = updatedTargets;
  }
  if (updatedOrbitalDebris) next.orbitalDebris = updatedOrbitalDebris;
  return { espionage: next, collected };
}
