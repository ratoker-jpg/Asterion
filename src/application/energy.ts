import {
  calculateEnergySources,
  consumeEnergy,
  createEnergyLedger,
  hydrateEnergyLedger,
  rebuildEnergyLedger,
  refundEnergy,
  type EnergyLedger,
  type EnergyOperationResult,
  type EnergyRebuildOptions,
  type EnergySourceSnapshot,
} from '../domain/energy/runtime.ts';
import type { BuildingRole } from '../domain/buildings/resource-zone.ts';
import type { ScienceLevels } from '../domain/science/runtime.ts';
import type { PlanetRuntime } from './contracts.ts';

export type PlanetEnergyCoordinates = {
  system: number;
  position: number;
};

export type EnergyTransitionResult = {
  ok: boolean;
  planet: PlanetRuntime;
  operation: EnergyOperationResult | null;
  reason: string | null;
};

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeCoordinate(value: unknown, fallback: number, max: number): number {
  const numeric = Math.floor(finiteNumber(value, fallback));
  return numeric >= 1 && numeric <= max ? numeric : fallback;
}

export function getPlanetEnergyCoordinates(planet: Pick<PlanetRuntime, 'universeSystem' | 'universePosition'>): PlanetEnergyCoordinates {
  return {
    system: safeCoordinate(planet.universeSystem, 1, 40),
    position: safeCoordinate(planet.universePosition, 1, 24),
  };
}

export function getPlanetEnergySources(
  planet: Pick<PlanetRuntime, 'buildings' | 'solarSatellites' | 'universeSystem' | 'universePosition'>,
  scienceLevels: ScienceLevels | Readonly<Partial<Record<number, number>>> = {},
): EnergySourceSnapshot[] {
  const coordinates = getPlanetEnergyCoordinates(planet);
  return calculateEnergySources({
    buildings: planet.buildings,
    scienceLevels,
    solarSatellites: planet.solarSatellites ?? 0,
    system: coordinates.system,
    position: coordinates.position,
  });
}

function directLedgerValue(planet: PlanetRuntime): unknown {
  if (planet.energyLedger) return planet.energyLedger;
  if (
    planet.producedEnergy !== undefined
    || planet.consumedEnergy !== undefined
    || planet.availableEnergy !== undefined
    || planet.energySources !== undefined
  ) {
    return {
      producedEnergy: planet.producedEnergy,
      consumedEnergy: planet.consumedEnergy,
      availableEnergy: planet.availableEnergy,
      sources: planet.energySources,
      consumedBySource: planet.energyExpenseAttribution,
    };
  }
  return undefined;
}

export function getPlanetEnergyLedger(
  planet: PlanetRuntime,
  scienceLevels: ScienceLevels | Readonly<Partial<Record<number, number>>> = {},
): EnergyLedger {
  const sources = getPlanetEnergySources(planet, scienceLevels);
  return hydrateEnergyLedger(directLedgerValue(planet), sources, finiteNumber(planet.energy));
}

export function withPlanetEnergyLedger(planet: PlanetRuntime, ledger: EnergyLedger): PlanetRuntime {
  return {
    ...planet,
    energy: ledger.availableEnergy,
    energyLedger: ledger,
    producedEnergy: ledger.producedEnergy,
    consumedEnergy: ledger.consumedEnergy,
    availableEnergy: ledger.availableEnergy,
    energySources: ledger.sources,
    energyExpenseAttribution: { ...ledger.consumedBySource, ...ledger.retiredConsumedBySource },
  };
}

export function initializePlanetEnergy(
  planet: PlanetRuntime,
  scienceLevels: ScienceLevels | Readonly<Partial<Record<number, number>>> = {},
): PlanetRuntime {
  const sources = getPlanetEnergySources(planet, scienceLevels);
  const ledger = createEnergyLedger(sources, finiteNumber(planet.energy));
  return withPlanetEnergyLedger(planet, ledger);
}

export function syncPlanetEnergySources(
  planet: PlanetRuntime,
  scienceLevels: ScienceLevels | Readonly<Partial<Record<number, number>>> = {},
  options: EnergyRebuildOptions = {},
): PlanetRuntime {
  return transitionPlanetEnergySources(planet, planet, scienceLevels, scienceLevels, options);
}

/** Rebuilds a planet's ledger when either its source inputs or its science snapshot changed. */
export function transitionPlanetEnergySources(
  previousPlanet: PlanetRuntime,
  nextPlanet: PlanetRuntime,
  previousScienceLevels: ScienceLevels | Readonly<Partial<Record<number, number>>> = {},
  nextScienceLevels: ScienceLevels | Readonly<Partial<Record<number, number>>> = previousScienceLevels,
  options: EnergyRebuildOptions = {},
): PlanetRuntime {
  const current = getPlanetEnergyLedger(previousPlanet, previousScienceLevels);
  const sources = getPlanetEnergySources(nextPlanet, nextScienceLevels);
  return withPlanetEnergyLedger(nextPlanet, rebuildEnergyLedger(current, sources, options));
}

export function settlePlanetEnergyWallet(
  previousPlanet: PlanetRuntime,
  scienceLevels: ScienceLevels | Readonly<Partial<Record<number, number>>> = {},
  targetAvailableEnergy: number,
  options: EnergyRebuildOptions = {},
  nextPlanet: PlanetRuntime = previousPlanet,
): EnergyTransitionResult {
  const current = getPlanetEnergyLedger(previousPlanet, scienceLevels);
  const target = finiteNumber(targetAvailableEnergy, current.availableEnergy);
  const delta = target - current.availableEnergy;
  let operation: EnergyOperationResult | null = null;
  let ledger = current;
  if (delta < 0) operation = consumeEnergy(current, -delta);
  if (delta > 0) operation = refundEnergy(current, delta);
  if (operation && !operation.ok) {
    return { ok: false, planet: previousPlanet, operation, reason: operation.reason };
  }
  if (operation) ledger = operation.ledger;
  const sources = getPlanetEnergySources(nextPlanet, scienceLevels);
  ledger = rebuildEnergyLedger(ledger, sources, options);
  return { ok: true, planet: withPlanetEnergyLedger(nextPlanet, ledger), operation, reason: null };
}

export function spendPlanetEnergy(
  planet: PlanetRuntime,
  scienceLevels: ScienceLevels | Readonly<Partial<Record<number, number>>> = {},
  amount: number,
  transactionId?: string,
): EnergyTransitionResult {
  const current = getPlanetEnergyLedger(planet, scienceLevels);
  const operation = consumeEnergy(current, amount, transactionId);
  return {
    ok: operation.ok,
    planet: withPlanetEnergyLedger(planet, operation.ledger),
    operation,
    reason: operation.reason,
  };
}

export function refundPlanetEnergy(
  planet: PlanetRuntime,
  scienceLevels: ScienceLevels | Readonly<Partial<Record<number, number>>> = {},
  amount: number,
  transactionId?: string,
): EnergyTransitionResult {
  const current = getPlanetEnergyLedger(planet, scienceLevels);
  const operation = refundEnergy(current, amount, transactionId);
  return {
    ok: operation.ok,
    planet: withPlanetEnergyLedger(planet, operation.ledger),
    operation,
    reason: operation.reason,
  };
}

export function energySummaryForPlanet(
  planet: PlanetRuntime,
  scienceLevels: ScienceLevels | Readonly<Partial<Record<number, number>>> = {},
): EnergyLedger {
  return getPlanetEnergyLedger(planet, scienceLevels);
}

export function energySourceChangeForBuilding(role: BuildingRole): EnergyRebuildOptions['sourceChanges'] {
  if (role === 'basic-energy') return { 'solar-station': 'building' };
  if (role === 'advanced-energy') return { 'nuclear-reactor': 'building' };
  return undefined;
}
