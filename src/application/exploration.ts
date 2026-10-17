import type { SaveState } from './contracts.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { createUniverseSystem, SYSTEM_COUNT } from '../domain/universe/runtime.ts';
import type { UniverseCoordinate, UniversePlanetNode, UniversePersistedPlayerPlanet, UniverseRegisteredPlanet } from '../domain/universe/types.ts';
import { explorationNodeId, visibleExplorationContacts } from '../domain/exploration/model.ts';
import type { RuntimeMode } from '../domain/runtime/mode.ts';
import { EXPLORATION_ARTS } from '../exploration-art.ts';

/** The shared selector for Fleet and Operations: only actual local owned colonies grant visibility. */
export function selectExplorationTargets(
  state: SaveState,
  nowMs: number,
  mode: RuntimeMode = Object.keys(state.alliedPlanets ?? {}).length ? 'test' : 'production',
  limit = 5,
): UniversePlanetNode[] {
  const playerPlanets: UniversePersistedPlayerPlanet[] = Object.entries(state.planets)
    .map(([id, planet]) => ({
      id, name: planet.name, isHomeworld: id === 'helion-01',
      coordinate: {
        galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1,
        position: planet.universePosition ?? 1,
      },
    }));
  const owned: UniverseCoordinate[] = playerPlanets.map(p => p.coordinate)
    .filter(c => Number.isInteger(c.galaxy) && c.galaxy >= 1
      && Number.isInteger(c.system) && c.system >= 1 && c.system <= SYSTEM_COUNT);
  if (!owned.length) return [];
  const targets: UniverseRegisteredPlanet[] = Object.values(getEspionageTargets(state.espionage)).map(p => ({
    id: p.id, name: p.name, coordinate: { ...p.coordinate },
    kind: p.kind ?? 'npc', ownerId: p.ownerId,
  }));
  const systems = new Map<string, { galaxy: number; system: number }>();
  for (const colony of owned) for (let s = Math.max(1, colony.system - 5); s <= Math.min(SYSTEM_COUNT, colony.system + 5); s++) {
    systems.set(colony.galaxy + ':' + s, { galaxy: colony.galaxy, system: s });
  }
  const nodes = [...systems.values()].flatMap(({ galaxy, system }) => createUniverseSystem({
    mode, galaxy, system, nowMs, playerPlanets, registeredPlanets: targets,
    pirateContactDefeats: Object.values(state.pirate?.contact.defeatedCycles ?? {}),
    asteroidStates: state.asteroidSimulation?.asteroids ?? [],
    assets: { uniqueArts: EXPLORATION_ARTS.unique, anomalyArts: EXPLORATION_ARTS.anomaly },
  }).positions.filter(node => explorationNodeId(node) !== null));
  return visibleExplorationContacts(nodes, owned, nowMs, limit);
}

/** Reconstruct canonical timed objects at selected historical systems without
 * rebuilding every currently visible system for each offline risk timestamp. */
export function selectExplorationTargetsInSystems(
  state: SaveState,
  nowMs: number,
  requestedSystems: readonly Pick<UniverseCoordinate, 'galaxy' | 'system'>[],
  mode: RuntimeMode = Object.keys(state.alliedPlanets ?? {}).length ? 'test' : 'production',
): UniversePlanetNode[] {
  const playerPlanets: UniversePersistedPlayerPlanet[] = Object.entries(state.planets)
    .map(([id, planet]) => ({
      id, name: planet.name, isHomeworld: id === 'helion-01',
      coordinate: {
        galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1,
        position: planet.universePosition ?? 1,
      },
    }));
  const owned: UniverseCoordinate[] = playerPlanets.map(planet => planet.coordinate)
    .filter(coordinate => Number.isInteger(coordinate.galaxy) && coordinate.galaxy >= 1
      && Number.isInteger(coordinate.system) && coordinate.system >= 1 && coordinate.system <= SYSTEM_COUNT);
  if (!owned.length) return [];
  const targets: UniverseRegisteredPlanet[] = Object.values(getEspionageTargets(state.espionage)).map(planet => ({
    id: planet.id, name: planet.name, coordinate: { ...planet.coordinate },
    kind: planet.kind ?? 'npc', ownerId: planet.ownerId,
  }));
  const visibleSystems = new Map<string, { galaxy: number; system: number }>();
  for (const requested of requestedSystems) {
    if (!Number.isInteger(requested.galaxy) || requested.galaxy < 1
      || !Number.isInteger(requested.system) || requested.system < 1 || requested.system > SYSTEM_COUNT
      || !owned.some(colony => colony.galaxy === requested.galaxy
        && Math.abs(colony.system - requested.system) <= 5)) continue;
    visibleSystems.set(`${requested.galaxy}:${requested.system}`, {
      galaxy: requested.galaxy, system: requested.system,
    });
  }
  const nodes = [...visibleSystems.values()].flatMap(({ galaxy, system }) => createUniverseSystem({
    mode, galaxy, system, nowMs, playerPlanets, registeredPlanets: targets,
    pirateContactDefeats: Object.values(state.pirate?.contact.defeatedCycles ?? {}),
    asteroidStates: state.asteroidSimulation?.asteroids ?? [],
    assets: { uniqueArts: EXPLORATION_ARTS.unique, anomalyArts: EXPLORATION_ARTS.anomaly },
  }).positions.filter(node => explorationNodeId(node) !== null));
  return visibleExplorationContacts(nodes, owned, nowMs, 500);
}

export function getExplorationTarget(
  state: SaveState,
  id: string,
  nowMs: number,
  mode?: RuntimeMode,
): UniversePlanetNode | undefined {
  return selectExplorationTargets(state, nowMs, mode, 500).find(node => explorationNodeId(node) === id);
}

/** Avoid stale UI state: a target's live claim is authoritative only in the persisted exploration ledger. */
export function explorationTargetStatus(state: SaveState, node: UniversePlanetNode): 'free' | 'self' | 'occupied' {
  const claim = state.exploration?.contacts[node.id]?.claim;
  return !claim ? 'free' : claim.ownerId === state.profile.playerId ? 'self' : 'occupied';
}

import { explorationArtForCycle } from '../exploration-art.ts';
import { explorationProfile } from '../domain/exploration/model.ts';
import type { ExplorationContact, ExplorationReconRecord } from '../domain/exploration/ledger.ts';

export type ExplorationOperationPresentation = {
  node: UniversePlanetNode;
  occupancy: 'free' | 'self' | 'occupied';
  ownerId: string;
  stage: 'available' | 'active' | 'completed';
  contact?: ExplorationContact;
  recon?: ExplorationReconRecord;
  reconInFlight?: { phase: 'outbound' | 'returning'; arrivalAt: number; returnAt?: number };
};
export function selectExplorationOperations(state: SaveState, nowMs: number, mode: RuntimeMode): ExplorationOperationPresentation[] {
  const live = selectExplorationTargets(state, nowMs, mode);
  const accepted = new Set(state.exploration?.acceptedContactIds ?? []);
  const stored = state.exploration?.contacts ?? {};
  const recon = state.exploration?.reconReports ?? [];
  const report = (id: string) => [...recon].reverse().find(item => item.contactId === id && item.ownerId === state.profile.playerId);
  const inFlight = (id: string) => state.flights.records.find(f => f.missionId === 'exploration-recon'
    && f.operationId === id && (f.phase === 'outbound' || f.phase === 'returning'));
  const displayed: ExplorationOperationPresentation[] = live.map(node => {
    const occupancy = explorationTargetStatus(state, node);
    return {
      node, occupancy, ownerId: state.profile.playerId, contact: stored[node.id], recon: report(node.id),
      reconInFlight: inFlight(node.id) ? { phase: inFlight(node.id)!.phase as 'outbound' | 'returning',
        arrivalAt: inFlight(node.id)!.arrivalAt, returnAt: inFlight(node.id)!.returnAt } : undefined,
      stage: stored[node.id]?.events.some(event =>
        event.ownerId === state.profile.playerId && event.kind === 'returned') ? 'completed'
        : accepted.has(node.id) || occupancy === 'self' ? 'active' : 'available',
    };
  });
  // An accepted but never executed contact is NOT a completed mission.
  // Archive only cycles with an actual player expedition return receipt.
  const historical: ExplorationOperationPresentation[] = Object.values(stored).filter(contact =>
    contact.expiresAt <= nowMs && !live.some(n => n.id === contact.id)
    && contact.events.some(event => event.ownerId === state.profile.playerId && event.kind === 'returned'))
    .map(contact => {
      const cycleIndex = Number(contact.id.split(':')[3] ?? 0);
      return {
        node: {
          id: contact.id, coordinate: contact.coordinate,
          kind: contact.kind, name: explorationProfile(contact.kind, contact.variant).name,
          art: explorationArtForCycle(contact.kind, contact.coordinate.system, cycleIndex),
          description: 'Завершённый исследовательский контакт',
          statusLabel: 'Контакт завершён',
          special: {
            startAt: contact.appearedAt, expiresAt: contact.expiresAt, cycleIndex,
            contactCycleKey: contact.id, profileVariant: contact.variant,
            respawnAt: contact.expiresAt, lifetimeMs: contact.expiresAt - contact.appearedAt, spawnChance: 0,
          },
        },
        ownerId: state.profile.playerId, occupancy: 'free' as const, stage: 'completed' as const,
        contact, recon: report(contact.id),
      };
    }).slice(-60);
  return [...displayed, ...historical];
}
