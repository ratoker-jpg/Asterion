/**
 * What the player sees of the endgame outside «Командование»: Gates under
 * construction anywhere (public news, the same that NPCs hear through
 * `npcGateHosts`) and the quick «Защитить Солнце» window that sends support
 * from several planets at once.
 *
 * Nothing here is a new rule. Gate news is the public milestone notice every
 * owner receives; support legs are ordinary `sun-support` commands that
 * `previewSunLaunch` / `dispatchFlight` check exactly as «Флоты» does. This
 * module only gathers the data and chooses UI defaults («всё боевое»).
 */
import type { ShipId } from '../domain/combat/ids.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import { calculateRouteDistance } from '../domain/flights/distance.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { selectOwnerMembership } from '../domain/command/selectors.ts';
import type { GateProject, SunRaidRecord } from '../domain/sun-raid/types.ts';
import type { UniverseCoordinate } from '../domain/universe/types.ts';
import type { SaveState } from './contracts.ts';
import { getAvailableFleetForPlanet, type DispatchFlightCommand } from './flights.ts';
import { planetCoordinate, type QuickRuntime } from './quick-actions.ts';
import {
  currentSunRaidState,
  isSunCombatHull,
  previewSunLaunch,
  selectIncomingSunAlerts,
  selectRaidSides,
  sunFleetPopulation,
  sunOperationId,
  sunRouteCoordinate,
} from './sun-raid.ts';
import { sunRaidCapsOf } from '../domain/sun-raid/config.ts';

/* ------------------------------------------------------------------ Gates */

export type GateBeacon = {
  gateId: string;
  holderName: string;
  hostOwnerId: string;
  hostOwnerName: string;
  hostPlanetId: string;
  hostPlanetName: string;
  /** Null only when the host planet is not on the player's map at all. */
  coordinate: UniverseCoordinate | null;
  startedAt: number;
  completesAt: number;
  /** 0..100 of the build time. */
  progress: number;
  /** 'own': the player's side builds it (defend it); 'rival': break it before it is done. */
  side: 'own' | 'rival';
};

/** Where a planet of any owner stands, as the map knows it. */
export function knownPlanetCoordinate(state: SaveState, planetId: string): UniverseCoordinate | null {
  if (state.planets[planetId]) return planetCoordinate(state, planetId);
  const allied = state.alliedPlanets?.[planetId];
  if (allied?.universeGalaxy && allied.universeSystem && allied.universePosition) {
    return { galaxy: allied.universeGalaxy, system: allied.universeSystem, position: allied.universePosition };
  }
  const target = getEspionageTargets(state.espionage)[planetId];
  return target?.coordinate ? { ...target.coordinate } : null;
}

function gateSide(state: SaveState, gate: GateProject): 'own' | 'rival' {
  const playerId = state.profile.playerId;
  if (gate.holder.kind === 'owner') return gate.holder.id === playerId ? 'own' : 'rival';
  return selectOwnerMembership(state.command, playerId)?.alliance.id === gate.holder.id ? 'own' : 'rival';
}

/** Every Gate under construction: the public news, soonest finish first. */
export function selectGateBeacons(state: SaveState, now: number): GateBeacon[] {
  return currentSunRaidState(state).gates
    .filter((gate) => gate.status === 'building')
    .map((gate) => {
      const span = Math.max(1, gate.completesAt - gate.startedAt);
      return {
        gateId: gate.id,
        holderName: gate.holderName,
        hostOwnerId: gate.hostOwnerId,
        hostOwnerName: gate.hostOwnerName,
        hostPlanetId: gate.hostPlanetId,
        hostPlanetName: gate.hostPlanetName,
        coordinate: knownPlanetCoordinate(state, gate.hostPlanetId),
        startedAt: gate.startedAt,
        completesAt: gate.completesAt,
        progress: Math.max(0, Math.min(100, ((now - gate.startedAt) / span) * 100)),
        side: gateSide(state, gate),
      };
    })
    .sort((left, right) => left.completesAt - right.completesAt);
}

/* --------------------------------------------------------- Sun defence */

/** Raids the player may defend against right now (his galaxies, not his own alliance's). */
export function selectDefendableRaids(state: SaveState, now: number): SunRaidRecord[] {
  return selectIncomingSunAlerts(state, now).map((alert) => alert.raid);
}

export type SunDefenceShips = Partial<Record<ShipId, number>>;

export type SunDefenceSource = {
  planetId: string;
  name: string;
  coordinate: UniverseCoordinate;
  /** Free combat hulls only (civil ships never fly to a Sun). */
  free: SunDefenceShips;
  /** Population of every free combat hull. */
  population: number;
};

/** Free combat hulls of a planet (ships in flight or under repair are not free). */
export function freeSunCombatShips(state: SaveState, planetId: string): SunDefenceShips {
  if (!state.planets[planetId]) return {};
  const free = getAvailableFleetForPlanet(state, planetId).ships;
  return Object.fromEntries(Object.entries(free)
    .filter(([id, count]) => isSunCombatHull(id as ShipId) && Math.floor(count ?? 0) > 0)
    .map(([id, count]) => [id, Math.floor(count ?? 0)])) as SunDefenceShips;
}

/** Every planet of the player, nearest to the Sun first; planets without warships stay listed. */
export function sunDefenceSources(state: SaveState, raid: Pick<SunRaidRecord, 'galaxy' | 'system'>): SunDefenceSource[] {
  const sun = sunRouteCoordinate(raid.galaxy, raid.system);
  const factionId = state.profile.factionId as CombatFactionId;
  return Object.keys(state.planets)
    .map((planetId) => ({ planetId, distance: calculateRouteDistance(planetCoordinate(state, planetId), sun) }))
    .sort((a, b) => a.distance - b.distance || a.planetId.localeCompare(b.planetId))
    .map(({ planetId }) => {
      const free = freeSunCombatShips(state, planetId);
      return {
        planetId,
        name: state.planets[planetId]?.name ?? planetId,
        coordinate: planetCoordinate(state, planetId),
        free,
        population: sunFleetPopulation(free, factionId),
      };
    });
}

export type SunDefenceLegPreview = {
  population: number;
  oneWayMs: number;
  arrivesAt: number;
  gasCost: number;
  /** Arrives after the raid lands: the runtime refuses such a flight. */
  late: boolean;
  /** Raid landing minus fleet arrival (negative when late). */
  marginMs: number;
  /** The runtime's own refusal for exactly this leg (null: it would go). */
  error: string | null;
};

/**
 * The runtime's preview of one leg. With nothing picked the timing is shown for
 * the planet's whole combat fleet, so the player sees in advance who is in time.
 */
export function previewSunDefenceLeg(state: SaveState, raid: SunRaidRecord, planetId: string, ships: SunDefenceShips, runtime: QuickRuntime): SunDefenceLegPreview {
  const picked = Object.values(ships).some((count) => (count ?? 0) > 0);
  const probe = picked ? ships : freeSunCombatShips(state, planetId);
  const preview = previewSunLaunch(state, {
    kind: 'support', galaxy: raid.galaxy, system: raid.system, raidId: raid.id, originPlanetId: planetId, ships: probe,
  }, { now: runtime.now, mode: runtime.mode, testTimeScale: runtime.testTimeScale });
  const arrivesAt = runtime.now + preview.oneWayMs;
  return {
    population: picked ? preview.population : 0,
    oneWayMs: preview.oneWayMs,
    arrivesAt,
    gasCost: picked ? preview.gasCost : 0,
    late: preview.oneWayMs > 0 && arrivesAt > raid.arrivesAt,
    marginMs: raid.arrivesAt - arrivesAt,
    error: picked ? preview.error : null,
  };
}

/** Room left on the defending side (the per-side population cap). */
export function sunDefenceRoom(state: SaveState, raid: SunRaidRecord): { cap: number; committed: number; remaining: number } {
  const cap = sunRaidCapsOf(state).perSide;
  const committed = selectRaidSides(state, raid.id).defenders.population;
  return { cap, committed, remaining: Math.max(0, cap - committed) };
}

/** The exact command «Флоты → Поддержка солнца» sends for this leg. */
export function buildSunSupportCommand(raid: Pick<SunRaidRecord, 'galaxy' | 'system'>, planetId: string, ships: SunDefenceShips, runtime: QuickRuntime): DispatchFlightCommand {
  const operationId = sunOperationId(raid.galaxy, raid.system);
  return {
    requestId: `quick-sun-support-${operationId}-${planetId}-${runtime.now}`,
    missionId: 'sun-support',
    originPlanetId: planetId,
    operationId,
    destination: { kind: 'operation', operationId, coordinate: sunRouteCoordinate(raid.galaxy, raid.system) },
    selectedShips: Object.fromEntries(Object.entries(ships).filter(([, count]) => Math.floor(count ?? 0) > 0).map(([id, count]) => [id, Math.floor(count ?? 0)])) as SunDefenceShips,
    selectedCommanders: {},
    targetRelation: 'neutral',
    targetPlanetName: `Солнце ${raid.galaxy}:${raid.system}`,
    departedAt: runtime.now,
  };
}
