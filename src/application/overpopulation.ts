import {
  calculatePlanetCapacity,
  calculatePlanetPopulation,
  isPlanetOverpopulated,
  reconcileOverpopulation,
  type OverpopulationProtectedShipCounts,
  type OverpopulationShipLoss,
  type OverpopulationState,
} from '../domain/fleet/overpopulation.ts';
import { upsertOverpopulationEpisodeReport } from '../domain/reports/adapters.ts';
import { removeSolarSatellitesFromFleet } from '../domain/fleet/runtime.ts';
import { SHIP_IDS, type ShipId } from '../domain/combat/ids.ts';
import type { PlanetId, PlanetRuntime, SaveState } from './contracts.ts';

export type PlanetOverpopulationSummary = {
  actualPopulation: number;
  capacity: number;
  excess: number;
  blocked: boolean;
  episode: OverpopulationState | undefined;
  burnProgress: number;
};

const TIMER_KEYS = new Set([
  'enqueuedAt',
  'startedAt',
  'finishAt',
  'collectExpiresAt',
  'refillAt',
  'completedAt',
  'availableAt',
  'expiresAt',
  'returnAt',
  'nextAt',
  'endsAt',
]);

const DEPLOYMENT_RESERVATION_PHASES = new Set(['outbound', 'returning', 'arrived']);

function safeInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
}

function planetCapacity(planet: PlanetRuntime): number {
  return calculatePlanetCapacity(planet.buildings.hangar);
}

function satelliteCount(planet: PlanetRuntime, migratedCount: number): number {
  return Math.max(0, safeInteger(planet.solarSatellites, migratedCount));
}

function getReservedDeploymentShipsForPlanet(
  state: SaveState,
  planetId: PlanetId,
): OverpopulationProtectedShipCounts {
  const reserved: OverpopulationProtectedShipCounts = {};
  for (const flight of state.flights.records) {
    if (flight.missionId !== 'deployment'
      || flight.originPlanetId !== planetId
      || !DEPLOYMENT_RESERVATION_PHASES.has(flight.phase)) continue;
    for (const [rawShipId, quantity] of Object.entries(flight.selectedShips)) {
      if (!SHIP_IDS.includes(rawShipId as ShipId)
        || rawShipId === 'solar-satellite'
        || !Number.isFinite(quantity)
        || quantity <= 0) continue;
      const shipId = rawShipId as ShipId;
      const count = Math.floor(quantity);
      if (count > 0) reserved[shipId] = (reserved[shipId] ?? 0) + count;
    }
  }
  return reserved;
}

function withOverpopulationState(planet: PlanetRuntime, state: OverpopulationState | undefined): PlanetRuntime {
  if (state) return { ...planet, overpopulation: state };
  const { overpopulation: _discarded, ...withoutOverpopulation } = planet;
  return withoutOverpopulation;
}

function combineShipLosses(
  accumulated: readonly OverpopulationShipLoss[],
  latest: readonly OverpopulationShipLoss[],
): OverpopulationShipLoss[] {
  const counts = new Map<OverpopulationShipLoss['shipId'], number>();
  for (const loss of [...accumulated, ...latest]) {
    counts.set(loss.shipId, (counts.get(loss.shipId) ?? 0) + loss.count);
  }
  return [...counts.entries()]
    .map(([shipId, count]) => ({ shipId, count }))
    .filter((loss) => loss.count > 0)
    .sort((left, right) => left.shipId.localeCompare(right.shipId));
}

function shiftDeep(value: unknown, delta: number, parentKey?: string): unknown {
  if (typeof value === 'number' && Number.isFinite(value) && parentKey && TIMER_KEYS.has(parentKey)) {
    return Math.max(0, Math.floor(value + delta));
  }
  if (Array.isArray(value)) return value.map((item) => shiftDeep(item, delta, parentKey));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, shiftDeep(child, delta, key)]),
  );
}

function shiftPlanetTimers(planet: PlanetRuntime, delta: number): PlanetRuntime {
  const shifted = shiftDeep(planet, delta) as PlanetRuntime;
  return {
    ...shifted,
    trade: {
      ...shifted.trade,
      refillAtQueue: shifted.trade.refillAtQueue.map((timestamp) => Math.max(0, Math.floor(timestamp + delta))),
    },
  };
}

function shiftResourceClock(state: SaveState, planetId: PlanetId, delta: number): SaveState {
  const current = state.resourceClock.byPlanet?.[planetId];
  if (!current) {
    if (planetId !== 'helion-01') return state;
    return {
      ...state,
      resourceClock: {
        ...state.resourceClock,
        lastReconciledAt: Math.max(0, Math.floor(state.resourceClock.lastReconciledAt + delta)),
      },
    };
  }
  const shifted = {
    ...current,
    lastReconciledAt: Math.max(0, Math.floor(current.lastReconciledAt + delta)),
  };
  return {
    ...state,
    resourceClock: {
      ...state.resourceClock,
      ...(planetId === 'helion-01' ? shifted : {}),
      byPlanet: { ...state.resourceClock.byPlanet, [planetId]: shifted },
    },
  };
}

function getScienceQueuePause(
  queue: SaveState['science']['queue'],
  planets: SaveState['planets'],
  planetId: PlanetId,
  episodeStartedAt: number,
  now: number,
): { firstTaskIndex: number; delta: number } {
  const firstTaskIndex = queue.findIndex((task) => task.planetId === planetId);
  const task = queue[firstTaskIndex];
  if (!task) return { firstTaskIndex, delta: 0 };

  const reconciledAt = safeInteger(now);
  const pauseStart = Math.max(safeInteger(episodeStartedAt), safeInteger(task.startedAt));
  if (pauseStart >= reconciledAt) return { firstTaskIndex, delta: 0 };

  let earliestEarlierBlockStart = Number.POSITIVE_INFINITY;
  for (let index = 0; index < firstTaskIndex; index += 1) {
    const earlierTask = queue[index];
    if (!earlierTask?.planetId || earlierTask.startedAt > reconciledAt) continue;
    const earlierEpisode = planets[earlierTask.planetId]?.overpopulation;
    if (!earlierEpisode?.blocked) continue;

    const earlierBlockStart = Math.max(
      safeInteger(earlierEpisode.episodeStartedAt),
      safeInteger(earlierTask.startedAt),
    );
    if (earlierBlockStart < reconciledAt) {
      earliestEarlierBlockStart = Math.min(earliestEarlierBlockStart, earlierBlockStart);
    }
  }

  // Every episode being reconciled here is active through `now`. A prior
  // queue task therefore covers the suffix of this pause beginning at its
  // own effective block time. Keep only the uncovered prefix; treating any
  // earlier blocked task as covering the entire interval loses real pauses
  // that began before that task itself became blocked.
  const uncoveredUntil = Math.min(reconciledAt, earliestEarlierBlockStart);
  return {
    firstTaskIndex,
    delta: Math.max(0, Math.floor(uncoveredUntil - pauseStart)),
  };
}

function applyResolvedScienceQueuePauses(
  initialState: SaveState,
  nextState: SaveState,
  resolvedEpisodes: readonly { planetId: PlanetId; episodeStartedAt: number }[],
  now: number,
): SaveState {
  const pauses = resolvedEpisodes
    .map((episode) => ({
      ...getScienceQueuePause(
        initialState.science.queue,
        initialState.planets,
        episode.planetId,
        episode.episodeStartedAt,
        now,
      ),
    }))
    .filter((pause) => pause.firstTaskIndex >= 0 && pause.delta > 0);
  if (pauses.length === 0) return nextState;

  return {
    ...nextState,
    science: {
      ...nextState.science,
      queue: initialState.science.queue.map((task, index) => {
        const delta = pauses.reduce((total, pause) => (
          index >= pause.firstTaskIndex ? total + pause.delta : total
        ), 0);
        return delta > 0
          ? { ...task, startedAt: task.startedAt + delta, finishAt: task.finishAt + delta }
          : task;
      }),
    },
  };
}

function shiftPlanetOwnedTimers(
  state: SaveState,
  planetId: PlanetId,
  delta: number,
  episodeStartedAt: number,
  now: number,
  scienceQueuePauseDelta?: number,
): SaveState {
  const planet = state.planets[planetId];
  if (!planet || delta <= 0) return state;
  const sciencePause = getScienceQueuePause(
    state.science.queue,
    state.planets,
    planetId,
    episodeStartedAt,
    now,
  );
  const sciencePauseDelta = scienceQueuePauseDelta ?? sciencePause.delta;
  let next = {
    ...state,
    planets: { ...state.planets, [planetId]: shiftPlanetTimers(planet, delta) },
    queues: {
      ...state.queues,
      [planetId]: shiftDeep(state.queues[planetId] ?? [], delta) as NonNullable<SaveState['queues'][PlanetId]>,
    },
    science: {
      ...state.science,
      queue: state.science.queue.map((task, index) => sciencePauseDelta > 0 && index >= sciencePause.firstTaskIndex
        ? {
          ...task,
          startedAt: task.startedAt + sciencePauseDelta,
          finishAt: task.finishAt + sciencePauseDelta,
        }
        : task),
    },
  };
  next = shiftResourceClock(next, planetId, delta);
  return next;
}

export function getPlanetOverpopulationSummary(
  state: SaveState,
  planetId: PlanetId,
): PlanetOverpopulationSummary {
  const planet = state.planets[planetId];
  if (!planet) return { actualPopulation: 0, capacity: 0, excess: 0, blocked: false, episode: undefined, burnProgress: 0 };
  const migrated = removeSolarSatellitesFromFleet(planet.fleet);
  const satellites = satelliteCount(planet, migrated.count);
  const actualPopulation = calculatePlanetPopulation(migrated.fleet, satellites, state.profile.factionId);
  const capacity = planetCapacity(planet);
  const episode = planet.overpopulation?.blocked ? planet.overpopulation : undefined;
  const blocked = Boolean(episode) || isPlanetOverpopulated(actualPopulation, capacity);
  const burnProgress = episode && episode.scheduledBurnPool > 0
    ? Math.min(1, Math.max(0, episode.burnedPopulation / episode.scheduledBurnPool))
    : 0;
  return {
    actualPopulation,
    capacity,
    excess: Math.max(0, actualPopulation - capacity),
    blocked,
    episode,
    burnProgress,
  };
}

export function isPlanetBlocked(state: SaveState, planetId: PlanetId): boolean {
  return getPlanetOverpopulationSummary(state, planetId).blocked;
}

export type OverpopulationReconcileResult = {
  changed: boolean;
  state: SaveState;
  summary: PlanetOverpopulationSummary;
  resolved: boolean;
};

export function reconcilePlanetOverpopulation(
  state: SaveState,
  planetId: PlanetId,
  now: number,
  options: { deferScienceQueueShift?: boolean } = {},
): OverpopulationReconcileResult {
  const planet = state.planets[planetId];
  if (!planet) {
    return { changed: false, state, summary: getPlanetOverpopulationSummary(state, planetId), resolved: false };
  }
  const migrated = removeSolarSatellitesFromFleet(planet.fleet);
  const satellites = satelliteCount(planet, migrated.count);
  const result = reconcileOverpopulation(
    migrated.fleet,
    satellites,
    planet.buildings.hangar,
    state.profile.factionId,
    now,
    planet.overpopulation,
    getReservedDeploymentShipsForPlanet(state, planetId),
  );
  const hadEpisode = Boolean(planet.overpopulation?.blocked);
  const resolved = hadEpisode && !result.state;
  let next = state;
  const nextPlanet = withOverpopulationState(
    { ...planet, fleet: result.fleet, solarSatellites: satellites },
    result.state,
  );
  const planetChanged = nextPlanet !== planet
    && (JSON.stringify(nextPlanet) !== JSON.stringify(planet));
  if (planetChanged) next = { ...next, planets: { ...next.planets, [planetId]: nextPlanet } };
  if (resolved) {
    const episode = planet.overpopulation;
    const episodeStartedAt = episode?.episodeStartedAt ?? now;
    const delta = Math.max(0, Math.floor(now - episodeStartedAt));
    next = shiftPlanetOwnedTimers(
      next,
      planetId,
      delta,
      episodeStartedAt,
      now,
      options.deferScienceQueueShift ? 0 : undefined,
    );
    // The shifted timer pass must not resurrect the resolved episode.
    const shiftedPlanet = next.planets[planetId];
    if (shiftedPlanet?.overpopulation) {
      const { overpopulation: _discarded, ...withoutOverpopulation } = shiftedPlanet;
      next = { ...next, planets: { ...next.planets, [planetId]: withoutOverpopulation } };
    }
    if (episode) {
      const report = {
        planetId,
        planetName: planet.name,
        factionId: state.profile.factionId,
        populationBefore: episode.initialPopulation
          ?? (episode.initialExcess + (episode.initialCapacity ?? result.capacity)),
        populationAfter: result.actualPopulation,
        capacity: result.capacity,
        episodeStartedAt,
        episodeEndedAt: Math.max(episodeStartedAt, Math.floor(now)),
        removedShips: combineShipLosses(episode.removedShips ?? [], result.removedShipCounts),
      };
      next = {
        ...next,
        reports: upsertOverpopulationEpisodeReport(next.reports, report),
      };
    }
  }
  const summary = getPlanetOverpopulationSummary(next, planetId);
  return { changed: next !== state, state: next, summary, resolved };
}

export function reconcileAllPlanetOverpopulation(
  state: SaveState,
  now: number,
): { state: SaveState; changed: boolean; blockedPlanetIds: Set<PlanetId>; resolvedPlanetIds: PlanetId[] } {
  let next = state;
  let changed = false;
  const resolvedPlanetIds: PlanetId[] = [];
  const resolvedEpisodes: { planetId: PlanetId; episodeStartedAt: number }[] = [];
  for (const planetId of Object.keys(state.planets).sort()) {
    const result = reconcilePlanetOverpopulation(next, planetId, now, { deferScienceQueueShift: true });
    if (result.changed) {
      next = result.state;
      changed = true;
    }
    if (result.resolved) {
      resolvedPlanetIds.push(planetId);
      const episodeStartedAt = state.planets[planetId]?.overpopulation?.episodeStartedAt;
      resolvedEpisodes.push({
        planetId,
        episodeStartedAt: safeInteger(episodeStartedAt, now),
      });
    }
  }
  next = applyResolvedScienceQueuePauses(state, next, resolvedEpisodes, now);
  const blockedPlanetIds = new Set<PlanetId>();
  for (const planetId of Object.keys(next.planets)) {
    if (isPlanetBlocked(next, planetId)) blockedPlanetIds.add(planetId);
  }
  return { state: next, changed, blockedPlanetIds, resolvedPlanetIds };
}
