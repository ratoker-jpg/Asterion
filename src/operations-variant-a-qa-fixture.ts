import type { ExplorationOperationPresentation } from './application/exploration.ts';
import { pirateContactOperation } from './application/pirate-presentation.ts';
import type { PirateContactPresentation } from './pirate-ui.ts';
import { EXPLORATION_RULES } from './domain/exploration/model.ts';
import { type ExplorationContact, completeExplorationReturn, materializeExplorationContact, occupyExplorationContact, prepareExplorationRecall, releaseExplorationClaim } from './domain/exploration/ledger.ts';
import { createUniverseSystem, SYSTEM_COUNT } from './domain/universe/runtime.ts';
import type { OperationsState } from './domain/operations/types.ts';
import { EXPLORATION_ARTS } from './exploration-art.ts';

const FIXTURE_ROUTE = 'operations-variant-a';
const FIXTURE_NOW = 1_792_237_021_353;

/**
 * Test Mode screenshot scenarios of «Операции» (`#operations-variant-a-<scenario>`):
 * one per tab plus the worst cases of the old-screens redo (11.11.2026): a long list
 * with long names and running-out timers, and a world without any operation.
 */
export type OperationsVariantAStatus = 'available' | 'active' | 'completed' | 'many' | 'empty';

export function getOperationsVariantAQaStatus(mode: string): OperationsVariantAStatus | null {
  if (mode !== 'test' || typeof window === 'undefined') return null;
  const match = new RegExp(`^#${FIXTURE_ROUTE}-(available|active|completed|many|empty)$`).exec(window.location.hash);
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

const HUGE = 987_654_321_000;
const LONG_NAMES = [
  'Обломки дредноутов Северного Рубежа у Ледяного Перевала',
  'Сердце сингулярности за Восточной Кассиопеей и Глубинной Шахтой',
  'Архив забытых машин Седьмого Сектора Звёздной Гавани',
  'Пространственный шов на границе Внешнего Кольца Окраин',
];

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

function cargo(metal: number, minerals: number, gas: number, debris: number) {
  return { metal, minerals, gas, debris };
}

export function createOperationsVariantAQaFixture(
  pirateContact: PirateContactPresentation,
  ownerId: string,
  status: OperationsVariantAStatus,
) {
  const unique = findCanonicalNode('unique', FIXTURE_NOW);
  const anomaly = findCanonicalNode('anomaly', FIXTURE_NOW);
  if (!unique || !anomaly) return null;
  if (status === 'empty') {
    return { state: { items: [] } as OperationsState, explorationContacts: [], pirateContacts: [], completedPirateOperations: [], nowMs: FIXTURE_NOW };
  }
  const clonePirateContact = (suffix: number, overrides: Partial<PirateContactPresentation> = {}): PirateContactPresentation => {
    const [version, galaxy, system, cycle] = pirateContact.contactCycleKey.split(':');
    const startAt = FIXTURE_NOW - 180_000 - suffix * 1_000;
    return {
      ...pirateContact,
      contactCycleKey: `${version}:${galaxy}:${system}:${Number(cycle) + suffix}:${startAt}`,
      expiresAt: FIXTURE_NOW + 3_900_000,
      ...overrides,
    };
  };
  const hugeReserve = (contact: ExplorationContact, left: number): ExplorationContact => {
    const initial = cargo(0, 0, 0, 0);
    const reserve = cargo(0, 0, 0, 0);
    for (const key of ['metal', 'minerals', 'gas', 'debris'] as const) {
      if (contact.initialReserve[key] > 0) { initial[key] = HUGE; reserve[key] = Math.round(HUGE * left); }
    }
    return { ...contact, initialReserve: initial, resourceReserve: reserve };
  };
  const recon = (node: ExplorationOperationPresentation['node'], success: boolean) => ({
    id: `qa-variant-a:recon:${node.id}`, contactId: node.id, ownerId, flightId: `qa-variant-a:probe:${node.id}`,
    resolvedAt: FIXTURE_NOW - 30_000, success,
  });
  const selfMining = (node: ExplorationOperationPresentation['node']): ExplorationContact => {
    const flightId = `qa-variant-a:mine:${node.id}`;
    const occupied = occupyExplorationContact(materializeExplorationContact(node), {
      claimId: `claim:${flightId}`, ownerId, originPlanetId: 'helion-01', flightId,
      arrivedAt: FIXTURE_NOW - 600_000,
      capacity: { all: 999_999_999, transporters: 999_999_999, recyclers: 999_999_999 },
      resourcePointsLaunch: 0, catchupMultiplier: 1,
    });
    const claim = occupied.claim!;
    return { ...hugeReserve(occupied, .58), claim: { ...claim, lastAccruedAt: FIXTURE_NOW, cargo: cargo(412_345_678, 398_765_432, 187_654_321, 0), cargoCapacity: 1_999_999_998 } };
  };

  if (status === 'available' || status === 'many') {
    const many = status === 'many';
    const pirates = many
      ? Array.from({ length: 14 }, (_, index) => clonePirateContact(index, {
        // The last two run out: seconds left.
        expiresAt: FIXTURE_NOW + (index >= 12 ? 9_000 + index * 1_000 : 3_900_000 - index * 240_000),
      }))
      : [clonePirateContact(0)];
    const exploration: ExplorationOperationPresentation[] = [unique, anomaly].map((node) => ({ node, occupancy: 'free', ownerId, stage: 'available' }));
    if (many) {
      exploration.push(...[unique, anomaly, unique, anomaly].map((node, index): ExplorationOperationPresentation => ({
        node: {
          ...node,
          id: `${node.id}:qa-long-${index}`,
          name: LONG_NAMES[index]!,
          special: node.special ? { ...node.special, expiresAt: FIXTURE_NOW + (index === 3 ? 7_000 : 5_400_000) } : node.special,
        },
        occupancy: index % 2 ? 'occupied' : 'free', ownerId, stage: 'available',
      })));
    }
    return { state: { items: [] } as OperationsState, explorationContacts: exploration, pirateContacts: pirates, completedPirateOperations: [], nowMs: FIXTURE_NOW };
  }

  if (status === 'active') {
    const scouted = clonePirateContact(1, { latestReportId: 'qa-variant-a:pirate-recon', latestReportOutcome: 'success' });
    const blind = clonePirateContact(3, {
      latestReportId: null, latestReportOutcome: null, expiresAt: FIXTURE_NOW + 95_000,
      recon: { enabled: false, disabledReason: 'На текущей планете нет шпионских зондов' },
    });
    const miningNode = { ...unique, name: LONG_NAMES[0]! };
    const mining: ExplorationOperationPresentation = { node: miningNode, occupancy: 'self', ownerId, stage: 'active', recon: recon(miningNode, true), contact: selfMining(miningNode) };
    const taken: ExplorationOperationPresentation = { node: anomaly, occupancy: 'occupied', ownerId, stage: 'active', recon: recon(anomaly, false) };
    return {
      state: { items: [pirateContactOperation(scouted, 'active'), pirateContactOperation(blind, 'active')] } as OperationsState,
      explorationContacts: [mining, taken],
      pirateContacts: [scouted, blind],
      completedPirateOperations: [],
      nowMs: FIXTURE_NOW,
    };
  }

  // completed: a victory with the full reward breakdown, a delivered expedition with
  // rare finds and an expedition whose home planet was lost on the way back.
  const won = clonePirateContact(2);
  const completedPirateOperations = [{
    cycleKey: won.contactCycleKey,
    coordinate: won.coordinate,
    reportId: `qa-variant-a:${won.contactCycleKey}`,
    defeatedAt: FIXTURE_NOW,
    rounds: 6,
    debris: 12_345_678_900,
    reward: { sentCombatPopulation: 1_250_000, historicalHangarCapacity: 2_000_000, multiplier: 1.75, basePirateDebris: 7_054_673_657, bonusPirateDebris: 5_291_005_243, ownDebris: 98_765_432, threatReductionFraction: .125 },
  }];
  const finished = (node: ExplorationOperationPresentation['node'], originExists: boolean): ExplorationOperationPresentation => {
    const contact = completedExplorationContact(node, ownerId, FIXTURE_NOW, originExists);
    const haul = cargo(412_345_678, 398_765_432, 187_654_321, 98_765_432);
    const events = contact.events.map((event) => event.kind === 'returned' ? { ...event, cargo: haul, creditedCargo: haul, repairTokens: 3 } : event);
    const shown = originExists ? { ...node, name: LONG_NAMES[2]! } : node;
    return { node: shown, occupancy: 'free', ownerId, stage: 'completed', contact: { ...contact, events }, recon: recon(shown, true) };
  };
  return {
    state: { items: [] } as OperationsState,
    explorationContacts: [finished(unique, true), finished(anomaly, false)],
    pirateContacts: [],
    completedPirateOperations,
    nowMs: FIXTURE_NOW,
  };
}
