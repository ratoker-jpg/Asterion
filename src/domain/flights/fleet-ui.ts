import type { UniverseCoordinate } from '../universe/types.ts';
import { isFlightCoordinate } from './distance.ts';

/**
 * Fleet-screen conveniences kept in the save: favourite targets and the last
 * own planet picked for transport / deployment. UI data only; no game rule
 * reads it.
 */
export type FleetFavoriteTarget = {
  coordinate: UniverseCoordinate;
  /** Name shown in the list; a coordinate label when the target had none. */
  name?: string;
};

export type FleetOwnTargetMission = 'transport' | 'deployment';

export type FleetUiState = {
  favoriteTargets: FleetFavoriteTarget[];
  lastOwnTargets?: Partial<Record<FleetOwnTargetMission, string>>;
};

/** The fleet screen asks App to change the saved FleetUiState (detail: FleetUiUpdate). */
export const FLEET_UI_UPDATE_EVENT = 'asterion:fleet-ui-update';
export const FLEET_FAVORITE_LIMIT = 12;
const NAME_LIMIT = 60;

export function emptyFleetUiState(): FleetUiState {
  return { favoriteTargets: [] };
}

export function sameFavoriteCoordinate(left: UniverseCoordinate, right: UniverseCoordinate) {
  return left.galaxy === right.galaxy && left.system === right.system && left.position === right.position;
}

export function isFavoriteTarget(state: FleetUiState | undefined, coordinate: UniverseCoordinate) {
  return Boolean(state?.favoriteTargets.some((item) => sameFavoriteCoordinate(item.coordinate, coordinate)));
}

/** Adds the target on top of the list, or removes it when it is already there. */
export function toggleFavoriteTarget(state: FleetUiState | undefined, target: FleetFavoriteTarget): FleetUiState {
  const current = state ?? emptyFleetUiState();
  if (isFavoriteTarget(current, target.coordinate)) {
    return { ...current, favoriteTargets: current.favoriteTargets.filter((item) => !sameFavoriteCoordinate(item.coordinate, target.coordinate)) };
  }
  const name = target.name?.trim().slice(0, NAME_LIMIT);
  const entry: FleetFavoriteTarget = { coordinate: { ...target.coordinate }, ...(name ? { name } : {}) };
  return { ...current, favoriteTargets: [entry, ...current.favoriteTargets].slice(0, FLEET_FAVORITE_LIMIT) };
}

export function rememberOwnTarget(state: FleetUiState | undefined, missionId: FleetOwnTargetMission, planetId: string): FleetUiState {
  const current = state ?? emptyFleetUiState();
  if (current.lastOwnTargets?.[missionId] === planetId) return current;
  return { ...current, lastOwnTargets: { ...current.lastOwnTargets, [missionId]: planetId } };
}

/** Save migration: anything malformed is dropped, an absent field stays absent. */
export function migrateFleetUiState(value: unknown): FleetUiState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as { favoriteTargets?: unknown; lastOwnTargets?: unknown };
  const favoriteTargets: FleetFavoriteTarget[] = [];
  for (const item of Array.isArray(source.favoriteTargets) ? source.favoriteTargets : []) {
    if (!item || typeof item !== 'object') continue;
    const { coordinate, name } = item as { coordinate?: unknown; name?: unknown };
    if (!isFlightCoordinate(coordinate)) continue;
    const clean = { galaxy: coordinate.galaxy, system: coordinate.system, position: coordinate.position };
    if (favoriteTargets.some((entry) => sameFavoriteCoordinate(entry.coordinate, clean))) continue;
    const label = typeof name === 'string' ? name.trim().slice(0, NAME_LIMIT) : '';
    favoriteTargets.push({ coordinate: clean, ...(label ? { name: label } : {}) });
    if (favoriteTargets.length >= FLEET_FAVORITE_LIMIT) break;
  }
  const lastOwnTargets: Partial<Record<FleetOwnTargetMission, string>> = {};
  const rawLast = source.lastOwnTargets && typeof source.lastOwnTargets === 'object' ? source.lastOwnTargets as Record<string, unknown> : {};
  for (const missionId of ['transport', 'deployment'] as const) {
    const planetId = rawLast[missionId];
    if (typeof planetId === 'string' && planetId.length > 0 && planetId.length <= 120) lastOwnTargets[missionId] = planetId;
  }
  return { favoriteTargets, ...(Object.keys(lastOwnTargets).length ? { lastOwnTargets } : {}) };
}

export type FleetUiUpdate =
  | { kind: 'toggle-favorite'; target: FleetFavoriteTarget }
  | { kind: 'remember-own-target'; missionId: FleetOwnTargetMission; planetId: string };

export function applyFleetUiUpdate(state: FleetUiState | undefined, update: FleetUiUpdate): FleetUiState {
  return update.kind === 'toggle-favorite'
    ? toggleFavoriteTarget(state, update.target)
    : rememberOwnTarget(state, update.missionId, update.planetId);
}
