import type { SaveState } from './contracts.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { createUniverseSystem, SYSTEM_COUNT } from '../domain/universe/runtime.ts';
import type { UniverseCoordinate, UniversePlanetNode, UniversePersistedPlayerPlanet, UniverseRegisteredPlanet } from '../domain/universe/types.ts';
import { explorationNodeId, visibleExplorationContacts } from '../domain/exploration/model.ts';
import type { RuntimeMode } from '../domain/runtime/mode.ts';

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
    pirateContactDefeats: state.pirate?.contact.defeatedCycles,
    asteroidStates: state.asteroidSimulation?.asteroids ?? [],
  }).positions.filter(node => explorationNodeId(node) !== null));
  return visibleExplorationContacts(nodes, owned, nowMs, limit);
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
