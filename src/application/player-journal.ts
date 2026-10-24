import type { SaveState } from './contracts.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';

/**
 * Owner request (24.10.2026): a journal of everything the player does in a
 * campaign, exported as JSON so NPC decisions can be studied against an
 * expert's play and improved cycle by cycle. Entries are found by comparing
 * the state before and after each change, so every way of issuing a command
 * is covered; only the player's own actions are recorded. Keys are short to
 * keep a long campaign compact.
 */

export const PLAYER_JOURNAL_VERSION = 1;
/** A snapshot of the player's position is taken at most this often (game time). */
export const PLAYER_JOURNAL_SNAPSHOT_INTERVAL_MS = 60 * 60_000;

export type PlayerJournalEntry = Readonly<{
  /** Game time of the action (ms). */
  t: number;
  /** Kind: build, science, order, flight, recall, colony, alliance, snapshot. */
  k: string;
  /** Kind-specific details, short keys. */
  d: Readonly<Record<string, unknown>>;
}>;

function playerFlights(state: SaveState) {
  return state.flights.records.filter((flight) => flight.ownerSide === undefined || flight.ownerSide === 'player');
}

function coordinate(value: { galaxy: number; system: number; position: number } | undefined): string | undefined {
  return value ? `${value.galaxy}:${value.system}:${value.position}` : undefined;
}

function positive(record: Readonly<Record<string, number | undefined>> | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(record ?? {}).filter(([, count]) => (count ?? 0) > 0)) as Record<string, number>;
}

/** The player's actions that appear between two states (pure; same inputs, same entries). */
export function diffPlayerActions(before: SaveState, after: SaveState, at: number): PlayerJournalEntry[] {
  const entries: PlayerJournalEntry[] = [];
  for (const [planetId, queue] of Object.entries(after.queues)) {
    const known = new Set((before.queues[planetId] ?? []).map((item) => item.id));
    for (const item of queue) {
      if (known.has(item.id)) continue;
      entries.push({ t: at, k: 'build', d: { p: planetId, r: item.assetRole, l: item.targetLevel, c: item.cost, ms: item.durationMs } });
    }
  }
  const knownScience = new Set(before.science.queue.map((task) => task.id));
  for (const task of after.science.queue) {
    if (knownScience.has(task.id)) continue;
    entries.push({ t: at, k: 'science', d: { s: task.scienceId, l: task.toLevel, p: task.planetId, c: task.cost, ms: task.durationMs } });
  }
  for (const [planetId, planet] of Object.entries(after.planets)) {
    const previous = before.planets[planetId]?.fleetProduction;
    for (const queueKind of ['shipQueue', 'defenseQueue', 'commanderQueue'] as const) {
      const known = new Set((previous?.[queueKind] ?? []).map((order) => order.id));
      for (const order of planet.fleetProduction?.[queueKind] ?? []) {
        if (known.has(order.id)) continue;
        entries.push({ t: at, k: 'order', d: { p: planetId, q: order.queueKind, i: order.itemId, n: order.quantity, c: order.cost } });
      }
    }
  }
  const beforeFlights = new Map(playerFlights(before).map((flight) => [flight.id, flight]));
  for (const flight of playerFlights(after)) {
    const previous = beforeFlights.get(flight.id);
    if (!previous) {
      entries.push({ t: at, k: 'flight', d: {
        m: flight.missionId, from: flight.originPlanetId, to: coordinate(flight.destinationCoordinate),
        ...(flight.targetOwnerName ? { owner: flight.targetOwnerName } : {}),
        ...(flight.targetRelation ? { rel: flight.targetRelation } : {}),
        ships: positive(flight.selectedShips as Record<string, number>),
        ...(flight.selectedCommanders ? { cmd: positive(flight.selectedCommanders as Record<string, number>) } : {}),
        ...(flight.cargo ? { cargo: flight.cargo } : {}),
        arr: flight.arrivalAt, gas: flight.gasCost,
      } });
    } else if (previous.completionReason !== 'recalled' && flight.completionReason === 'recalled') {
      entries.push({ t: at, k: 'recall', d: { m: flight.missionId, id: flight.id } });
    }
  }
  for (const planetId of Object.keys(after.planets)) {
    if (!before.planets[planetId]) entries.push({ t: at, k: 'colony', d: { p: planetId, name: after.planets[planetId]!.name } });
  }
  const playerId = after.profile.playerId;
  const allianceOf = (state: SaveState) => state.command.alliances.find((alliance) => alliance.members.some((member) => member.ownerId === playerId));
  const beforeAlliance = allianceOf(before);
  const afterAlliance = allianceOf(after);
  if (beforeAlliance?.id !== afterAlliance?.id) {
    entries.push({ t: at, k: 'alliance', d: afterAlliance ? { join: afterAlliance.tag } : { left: beforeAlliance?.tag } });
  }
  return entries;
}

/** The player's position: planets with their levels, stores and fleets, and the score. */
export function snapshotPlayer(state: SaveState, at: number): PlayerJournalEntry {
  const score = selectOwnerScore(state, state.profile.playerId);
  return { t: at, k: 'snapshot', d: {
    pts: score ? { t: Math.round(score.totalPoints), r: Math.round(score.resourcePoints), b: Math.round(score.battlePoints) } : undefined,
    planets: Object.fromEntries(Object.entries(state.planets).map(([id, planet]) => [id, {
      b: positive(planet.buildings as Record<string, number>),
      res: planet.resources ? { m: Math.floor(planet.resources.metal), mi: Math.floor(planet.resources.minerals), g: Math.floor(planet.resources.gas) } : undefined,
      ships: positive(planet.fleet.ships as Record<string, number>),
      def: positive(planet.defense.defenses as Record<string, number>),
      sat: planet.solarSatellites ?? 0,
    }])),
    sci: positive(state.science.levels as Record<string, number>),
  } };
}
