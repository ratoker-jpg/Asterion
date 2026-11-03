import type { PlanetId, PlanetRuntime, SaveState } from '../../application/contracts.ts';
import { getPlanetResources } from '../../application/contracts.ts';
import { isHostileFlightIncomingToPlayer } from '../../application/flight-visibility.ts';
import type { SunAlert } from '../../application/sun-raid.ts';
import { getStorageCapacities } from '../../domain/buildings/balance-v1.ts';

export type HeaderAlertTone = 'danger' | 'warn' | 'info';

export type HeaderAlertTarget =
  | { kind: 'fleets' }
  | { kind: 'planet'; planetId: PlanetId };

export type HeaderAlert = {
  id: string;
  tone: HeaderAlertTone;
  title: string;
  detail: string;
  /** What the row opens; the label is shown on the row's right edge. */
  target: HeaderAlertTarget;
  action: string;
};

const STORAGE_LABELS = { metal: 'металла', minerals: 'минералов', gas: 'газа' } as const;
const TONE_ORDER: Record<HeaderAlertTone, number> = { danger: 0, warn: 1, info: 2 };

export function formatAlertEta(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes < 1) return 'меньше минуты';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

/**
 * «Сигналы» in the header: what needs the player's attention right now, across all planets.
 * Read-only view of the save; it never changes game state.
 */
export function selectHeaderAlerts(state: SaveState, sunAlerts: readonly SunAlert[], now: number): HeaderAlert[] {
  const alerts: HeaderAlert[] = [];

  for (const flight of state.flights.records) {
    if (!isHostileFlightIncomingToPlayer(flight, state.profile.playerId)) continue;
    const target = flight.destinationPlanetId ? state.planets[flight.destinationPlanetId]?.name : undefined;
    const raid = flight.ownerSide === 'pirate';
    alerts.push({
      id: `flight:${flight.id}`,
      tone: 'danger',
      title: `${raid ? 'Налёт пиратов' : 'Атака'} на ${target ?? flight.targetPlanetName ?? 'вашу планету'}`,
      detail: `Прибытие через ${formatAlertEta(flight.arrivalAt - now)}`,
      target: { kind: 'fleets' },
      action: 'Флоты',
    });
  }

  for (const { raid, arrivesInMs } of sunAlerts) {
    alerts.push({
      id: `sun:${raid.id}`,
      tone: 'danger',
      title: `Рейд на Солнце · [${raid.allianceTag}]`,
      detail: `Галактика ${raid.galaxy}, система ${raid.system} · через ${formatAlertEta(arrivesInMs)}`,
      target: { kind: 'fleets' },
      action: 'Флоты',
    });
  }

  for (const [planetId, planet] of Object.entries(state.planets) as [PlanetId, PlanetRuntime][]) {
    const resources = getPlanetResources(state, planetId);
    const capacities = getStorageCapacities(planet.buildings);
    const full = (Object.keys(STORAGE_LABELS) as (keyof typeof STORAGE_LABELS)[])
      .filter((kind) => capacities[kind] > 0 && resources[kind] >= capacities[kind]);
    if (full.length) {
      alerts.push({
        id: `storage:${planetId}`,
        tone: 'warn',
        title: `${planet.name}: склад заполнен`,
        detail: `Добыча ${full.map((kind) => STORAGE_LABELS[kind]).join(', ')} стоит`,
        target: { kind: 'planet', planetId },
        action: 'Планета',
      });
    }
    if (!(state.queues[planetId]?.length)) {
      alerts.push({
        id: `idle:${planetId}`,
        tone: 'info',
        title: `${planet.name}: стройка простаивает`,
        detail: 'Очередь строительства пуста',
        target: { kind: 'planet', planetId },
        action: 'Планета',
      });
    }
  }

  return alerts.sort((left, right) => TONE_ORDER[left.tone] - TONE_ORDER[right.tone]);
}
