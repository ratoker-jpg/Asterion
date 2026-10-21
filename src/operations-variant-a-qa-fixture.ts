import type { ExplorationOperationPresentation } from './application/exploration.ts';
import { pirateContactOperation } from './application/pirate-presentation.ts';
import type { PirateContactPresentation } from './pirate-ui.ts';
import { EXPLORATION_RULES } from './domain/exploration/model.ts';
import { completeExplorationReturn, materializeExplorationContact, occupyExplorationContact, prepareExplorationRecall, releaseExplorationClaim } from './domain/exploration/ledger.ts';
import { createUniverseSystem, SYSTEM_COUNT } from './domain/universe/runtime.ts';
import type { OperationsState } from './domain/operations/types.ts';
import { EXPLORATION_ARTS } from './exploration-art.ts';

const FIXTURE_ROUTE = 'operations-variant-a';
const FIXTURE_NOW = 1_792_237_021_353;

export type OperationsVariantAStatus = 'available' | 'active' | 'completed';

export function getOperationsVariantAQaStatus(mode: string): OperationsVariantAStatus | null {
  if (mode !== 'test' || typeof window === 'undefined') return null;
  const match = new RegExp(`^#${FIXTURE_ROUTE}-(available|active|completed)$`).exec(window.location.hash);
  return (match?.[1] as OperationsVariantAStatus | undefined) ?? null;
}

function findCanonicalNode(kind: 'unique' | 'anomaly', nowMs: number) {
  for (let system = 1; system <= SYSTEM_COUNT; system += 1) {
    const found = createUniverseSystem({
      mode: 'test', galaxy: 1, system, nowMs,
      playerPlanets: [], registeredPlanets: [], pirateContactDefeats: [], asteroidStates: [],
      assets: { uniqueArts: EXPLORATION_ARTS.unique, anomalyArts: EXPLORATION_ARTS.anomaly },
    }).positions.find((node) => node.kind === kind && node.special?.startAt
      && node.special.startAt <= nowMs - 60_000
      && node.special.expiresAt > nowMs + EXPLORATION_RULES.recallPreparationMs);
    if (found) return found;
  }
  return undefined;
}

function completedExplorationContact(node: ExplorationOperationPresentation['node'], ownerId: string, nowMs: number, originExists: boolean) {
  const flightId = `qa-variant-a:${node.id}`;
  const claim = `claim:${flightId}`;
  const arrivalAt = Math.max(node.special?.startAt ?? nowMs, nowMs - 60_000);
  const initial = materializeExplorationContact(node);
  const occupied = occupyExplorationContact(initial, {
    claimId: claim, ownerId, originPlanetId: 'helion-01', flightId,
    arrivedAt: arrivalAt,
    capacity: { all: 0, transporters: 0, recyclers: 0 },
    resourcePointsLaunch: 0, catchupMultiplier: 1,
  });
  const recalled = prepareExplorationRecall(occupied, ownerId, nowMs - EXPLORATION_RULES.recallPreparationMs);
  return completeExplorationReturn(releaseExplorationClaim(recalled, nowMs), flightId, nowMs + 1, originExists).contact;
}

export function createOperationsVariantAQaFixture(
  pirateContact: PirateContactPresentation,
  ownerId: string,
  status: OperationsVariantAStatus,
) {
  const unique = findCanonicalNode('unique', FIXTURE_NOW);
  const anomaly = findCanonicalNode('anomaly', FIXTURE_NOW);
  if (!unique || !anomaly) return null;
  const clonePirateContact = (suffix: number): PirateContactPresentation => {
    const [version, galaxy, system, cycle] = pirateContact.contactCycleKey.split(':');
    const startAt = FIXTURE_NOW - 180_000 - suffix * 1_000;
    return {
      ...pirateContact,
      contactCycleKey: `${version}:${galaxy}:${system}:${Number(cycle) + suffix}:${startAt}`,
      expiresAt: FIXTURE_NOW + 3_900_000,
    };
  };
  const selectedPirate = clonePirateContact(status === 'available' ? 0 : status === 'active' ? 1 : 2);
  const state: OperationsState = { items: status === 'active' ? [pirateContactOperation(selectedPirate, 'active')] : [] };
  const completedPirateOperations = status === 'completed' ? [{
    cycleKey: selectedPirate.contactCycleKey,
    coordinate: selectedPirate.coordinate,
    reportId: `qa-variant-a:${selectedPirate.contactCycleKey}`,
    defeatedAt: FIXTURE_NOW,
    rounds: 1,
    debris: 0,
  }] : [];
  const createExplorationRow = (node: ExplorationOperationPresentation['node']): ExplorationOperationPresentation => ({
    node, occupancy: 'free', ownerId, stage: status,
    ...(status === 'completed'
      ? { contact: completedExplorationContact(node, ownerId, FIXTURE_NOW, node.kind !== 'anomaly') }
      : {}),
  });

  return {
    state,
    explorationContacts: [createExplorationRow(unique), createExplorationRow(anomaly)],
    pirateContacts: status === 'completed' ? [] : [selectedPirate],
    completedPirateOperations,
    nowMs: FIXTURE_NOW,
  };
}
