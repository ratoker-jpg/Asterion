import type { SaveState } from './contracts.ts';
import type { BattleReport, BattleStackSnapshot } from '../domain/combat/report.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { COMMANDER_COMBAT_CATALOG } from '../domain/combat/catalog.ts';
import { PIRATE_CATALOG } from '../domain/pirates/catalog.ts';
import { getRecyclingEfficiencyPercent } from '../domain/buildings/recycling.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';

/**
 * Read-only export. Never persist or mutate anything, and never serialize the
 * entire save: it can contain unrelated colonies, third-party/NPC profiles etc.
 * The full battle report (all rounds and RNG provenance) is kept verbatim.
 */
const costValue = (cost: { metal: number; minerals: number; gas: number }): number =>
  cost.metal + cost.minerals + cost.gas;

type CatalogRow = Readonly<{
  id: string;
  name: string;
  population: number;
  cost: { metal: number; minerals: number; gas: number };
  combat: unknown;
  ability?: unknown;
}>;

function catalogRows(state: SaveState): {
  playerShips: CatalogRow[];
  pirateShips: CatalogRow[];
  commanders: CatalogRow[];
} {
  const shipCatalog = getFactionShipCatalog(state.profile.factionId as CombatFactionId);
  return {
    playerShips: shipCatalog.map(({ id, name, population, cost, combat }) => ({
      id, name, population, cost: { ...cost }, combat,
    })),
    pirateShips: PIRATE_CATALOG.map(({ id, name, population, cost, combat, ability }) => ({
      id, name, population, cost: { ...cost }, combat, ability,
    })),
    commanders: COMMANDER_COMBAT_CATALOG.map(({ id, name, population, cost, combat }) => ({
      id, name, population, cost: { ...cost }, combat,
    })),
  };
}

function lostHullRows(
  stacks: readonly BattleStackSnapshot[],
  catalog: ReadonlyMap<string, CatalogRow>,
) {
  return stacks.filter(stack => stack.destroyed > 0).map(stack => {
    const entity = catalog.get(stack.entityId);
    return {
      entityId: stack.entityId,
      unitsDestroyed: stack.destroyed,
      unitCost: entity?.cost ?? null,
      replacementResources: entity ? {
        metal: entity.cost.metal * stack.destroyed,
        minerals: entity.cost.minerals * stack.destroyed,
        gas: entity.cost.gas * stack.destroyed,
      } : null,
      totalCost: entity ? costValue(entity.cost) * stack.destroyed : null,
    };
  });
}

function matchFlight(report: BattleReport, flights: readonly FlightRecord[]): FlightRecord | null {
  return flights.find(flight => flight.missionId === 'pirate-elimination' &&
    (flight.attackResolution?.reportId === report.id || report.id === `battle-pirate-${flight.id}`)) ?? null;
}

export function getPirateBattleExportReportCount(state: SaveState): number {
  const ownerId = state.profile.playerId;
  return state.combat.reports.filter(report =>
    report.missionType === 'pirate-elimination'
    && report.attacker.playerId === ownerId
    && report.defender.race === 'pirates').length;
}

export function buildPirateBattleAnalysisExport(state: SaveState, exportedAt: number = Date.now()) {
  const ownerId = state.profile.playerId;
  const catalogs = catalogRows(state);
  const ownCosts = new Map<string, CatalogRow>(
    [...catalogs.playerShips, ...catalogs.commanders].map(row => [row.id, row]),
  );
  const pirateCosts = new Map<string, CatalogRow>(catalogs.pirateShips.map(row => [row.id, row]));
  const reports = state.combat.reports.filter(report =>
    report.missionType === 'pirate-elimination'
    && report.attacker.playerId === ownerId
    && report.defender.race === 'pirates'
  ).sort((left, right) => {
    const byTime = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    return (Number.isFinite(byTime) ? byTime : 0) || left.id.localeCompare(right.id);
  });

  const recyclingLevel = Math.max(0, ...Object.values(state.planets)
    .map(planet => planet.buildings.recycling ?? 0));
  const currentEfficiencyPercent = recyclingLevel > 0
    ? getRecyclingEfficiencyPercent(recyclingLevel) : null;

  const battles = reports.map((report, chronologicalIndex) => {
    const flight = matchFlight(report, state.flights.records);
    const snapshot = flight?.pirateSnapshot ?? null;
    const playerLossRows = lostHullRows(report.attackerForce.stacks, ownCosts);
    const pirateLossRows = lostHullRows(report.defenderForce.stacks, pirateCosts);
    const playerHullLossCostKnown = playerLossRows.reduce((sum, row) => sum + (row.totalCost ?? 0), 0);
    const playerHullCostUnknown = playerLossRows.some(row => row.totalCost === null);
    const capturedOutboundFuelGas = flight?.gasCost ?? null;
    const orbitalDebrisGenerated = report.debris ?? null;

    return {
      index: chronologicalIndex + 1,
      reportId: report.id,
      timestamp: report.timestamp,
      summary: {
        winner: report.winner,
        fullPirateBaseDestroyed: report.winner === 'attacker' && report.defenderForce.populationAfter === 0,
        rounds: report.roundCount,
        playerPopulationBefore: report.attackerForce.populationBefore,
        playerPopulationAfter: report.attackerForce.populationAfter,
        piratePopulationBefore: report.defenderForce.populationBefore,
        piratePopulationAfter: report.defenderForce.populationAfter,
        playerShipLosses: playerLossRows,
        pirateShipLosses: pirateLossRows,
        playerHullLossCostKnown,
        playerHullCostUnknown,
        pirateHullLossCostKnown: pirateLossRows.reduce((sum, row) => sum + (row.totalCost ?? 0), 0),
        orbitalDebrisGenerated,
        pirateRewardBreakdown: report.pirateReward ?? null,
        outgoingGasCost: capturedOutboundFuelGas,
        /**
         * NOT actual income. Recycling, real collection flights and unused
         * gas on return have not been reconciled for individual battles.
         */
        illustrativeFullCollectionNetAt120Percent:
          orbitalDebrisGenerated !== null && !playerHullCostUnknown && capturedOutboundFuelGas !== null
          ? orbitalDebrisGenerated * 1.2 - playerHullLossCostKnown - capturedOutboundFuelGas : null,
        estimateIsActualWalletProfit: false,
      },
      flight: flight ? {
        id: flight.id,
        phase: flight.phase,
        departedAt: flight.departedAt,
        arrivalAt: flight.arrivalAt,
        returnAt: flight.returnAt ?? null,
        completedAt: flight.completedAt ?? null,
        originCoordinate: flight.originCoordinate,
        destinationCoordinate: flight.destinationCoordinate,
        selectedShips: flight.selectedShips,
        selectedCommanders: flight.selectedCommanders ?? {},
        selectedCommanderLevels: flight.selectedCommanderLevels ?? {},
        populationReserved: flight.populationReserved,
        routeDistance: flight.routeDistance,
        oneWayDurationMs: flight.oneWayDurationMs,
        gasCost: flight.gasCost,
        attackSnapshot: flight.attackSnapshot ?? null,
        pirateSnapshot: snapshot,
        attackResolution: flight.attackResolution ?? null,
      } : null,
      missingFlightSnapshot: flight === null,
      /** Actual complete battle record, including per-round events, priority, RNG, technologies, all stacks. */
      report,
    };
  });

  return {
    format: 'asterion-pirate-battles-analysis',
    exportSchemaVersion: 1,
    exportedAt: new Date(exportedAt).toISOString(),
    runtimeMode: 'test' as const,
    scope: 'current player / outgoing pirate-elimination fights (all outcomes)' as const,
    currentState: {
      playerFactionId: state.profile.factionId,
      fullBattleReportCount: state.combat.reports.length,
      exportedBattleCount: battles.length,
      unlinkedReportCount: battles.filter(battle => battle.missingFlightSnapshot).length,
      adaptation: state.pirate?.ownerAdaptations?.[ownerId] ?? null,
      ownerHistoricalHangarLevel: state.pirate?.ownerMaxHangarLevel?.[ownerId] ?? null,
      recyclerMaxCurrentLevel: recyclingLevel,
      recyclerCurrentEfficiencyPercent: currentEfficiencyPercent,
    },
    assumptions: [
      'Battles are sorted oldest first and include wins, losses and draws. NPC incoming raids and unrelated PvP/demo fights are excluded.',
      'Each report is a real saved record. Missing dispatch snapshots are null, NEVER backfilled from today’s fleet/tech.',
      'Full original reports retain all rounds, stacks, commander levels, combat tech, RNG and combat modifiers when present.',
      'Flight gasCost is the saved outbound fuel cost. Actual return-flight gas, recycler flight gas, debris collection and resource storage are not attributed per battle.',
      'illustrativeFullCollectionNetAt120Percent is a theoretical before-collection-cost example, NOT realised profit. Raw costs can be examined per material.',
      'Owner adaptation is a current aggregate snapshot; Q per launch and weight are recorded in each surviving pirateSnapshot. There is no fabricated historical Q for missing snapshots.',
      'Current refinery level/efficiency may not match historical levels at each fight. 120% is a what-if assumption, not necessarily the actual completed recycling output.',
    ],
    catalogs,
    battles,
  };
}
