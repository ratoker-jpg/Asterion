import type { UniverseCoordinate, UniversePlanetNode } from '../../domain/universe/types.ts';
import type { PirateContactPresentation } from '../../pirate-ui.ts';
import type { QuickActionId } from '../../application/quick-actions.ts';
import type { AtlasCell } from './atlas-plans.ts';
import type { DebrisEntry, ExplorationIntel } from './object-card-model.ts';

/**
 * Test Mode screenshot scenarios of the Universe object card and «Обломки
 * поблизости» (`#universe-card-<scenario>`), old-screens redo 11.11.2026.
 * Every object is seeded here with a frozen clock: the screenshot run never
 * searches a live world for a pirate base or an anomaly.
 */
export const UNIVERSE_CARD_QA_SCENARIOS = [
  'empty', 'empty-huge-debris', 'uninhabited', 'asteroid-debris', 'asteroid',
  'pirate-new', 'pirate-scouted', 'pirate-no-probes',
  'unique-free', 'unique-occupied', 'unique-occupied-scouted', 'anomaly-self', 'anomaly-out',
  'debris-few', 'debris-many', 'debris-empty',
] as const;
export type UniverseCardQaScenario = typeof UNIVERSE_CARD_QA_SCENARIOS[number];

const ROUTE = 'universe-card-';

export function getUniverseCardQaScenario(mode: string): UniverseCardQaScenario | null {
  if (mode !== 'test' || typeof window === 'undefined') return null;
  const name = window.location.hash.startsWith(`#${ROUTE}`) ? window.location.hash.slice(ROUTE.length + 1) : '';
  return (UNIVERSE_CARD_QA_SCENARIOS as readonly string[]).includes(name) ? name as UniverseCardQaScenario : null;
}

export type UniverseCardQaArts = {
  planet: string;
  asteroid: string;
  pirate: string;
  unique: string;
  anomaly: string;
};

export type UniverseCardQaFixture = {
  nowMs: number;
  card?: {
    node: UniversePlanetNode;
    underlyingNode?: UniversePlanetNode;
    orbitalDebris: number;
    asteroidHasDebris: boolean;
    pirateContact?: PirateContactPresentation;
    explorationStatus?: 'free' | 'self' | 'occupied';
    intel?: ExplorationIntel;
    /** Seeded objects are not in the live world: their flight times are seeded too. */
    plansOverride: Partial<Record<QuickActionId, AtlasCell>>;
  };
  debris?: {
    origin: { planetName: string; coordinate: UniverseCoordinate };
    results: DebrisEntry[];
    plansOverride: Record<string, AtlasCell>;
  };
};

const ready = (minutes: number, seconds = 0): AtlasCell => ({ kind: 'ready', durationMs: (minutes * 60 + seconds) * 1_000 });
const refused = (reason: string): AtlasCell => ({ kind: 'refused', reason });
const NO_COLONIZER = 'На планетах рядом нет колонизатора. Постройте его на верфи.';
const NO_GAS = 'Не хватает газа на полёт: нужно 1 240, на планете 300.';
const NO_WARSHIPS = 'На планетах в пяти системах нет боевых кораблей.';
const NO_RECYCLERS = 'На планетах рядом нет свободных переработчиков.';

const MINUTE = 60_000;
const LONG_UNIQUE = 'Обломки дредноутов Северного Рубежа у Ледяного Перевала Кассиопеи';
const LONG_OWNER = 'Звездоплаватель-Командор Северного Рубежа';
const HOME: UniverseCoordinate = { galaxy: 1, system: 12, position: 7 };

const at = (system: number, position: number): UniverseCoordinate => ({ galaxy: 1, system, position });

function timed(nowMs: number, startedMinAgo: number, leftMs: number) {
  const startAt = nowMs - startedMinAgo * MINUTE;
  return { startAt, cycleIndex: 3, expiresAt: nowMs + leftMs, respawnAt: nowMs + leftMs + 15 * MINUTE, lifetimeMs: nowMs + leftMs - startAt, spawnChance: 1 };
}

function pirateContact(coordinate: UniverseCoordinate, nowMs: number, leftMs: number, patch: Partial<PirateContactPresentation>): PirateContactPresentation {
  return {
    contactCycleKey: `qa-card:pirate:${coordinate.system}:${coordinate.position}:3`,
    coordinate,
    cycleIndex: 3,
    expiresAt: nowMs + leftMs,
    remainingMs: leftMs,
    statusLabel: 'Доступна разведка',
    statusTone: 'active',
    recon: { enabled: true, disabledReason: null },
    elimination: { enabled: false, disabledReason: 'Сначала разведайте гарнизон базы.' },
    latestReportId: null,
    latestReportOutcome: null,
    ...patch,
  };
}

/** Recyclers fly longer to farther systems; one row (index `refusedAt`) has no free recyclers. */
function debrisPlans(coordinates: readonly UniverseCoordinate[], refusedAt: number): Record<string, AtlasCell> {
  return Object.fromEntries(coordinates.map((coordinate, index) => [
    `[${coordinate.galaxy}:${coordinate.system}:${coordinate.position}]`,
    index === refusedAt ? refused(NO_RECYCLERS) : ready(12 + Math.abs(coordinate.system - HOME.system) * 3, (coordinate.position * 7) % 60),
  ]));
}

export function createUniverseCardQaFixture(scenario: UniverseCardQaScenario, nowMs: number, arts: UniverseCardQaArts): UniverseCardQaFixture {
  const empty = (coordinate: UniverseCoordinate): UniversePlanetNode => ({
    id: `qa-card:empty:${coordinate.system}:${coordinate.position}`, coordinate, kind: 'empty', name: 'Свободная позиция', art: '',
    statusLabel: 'Свободно', description: 'Свободная орбитальная позиция.',
  });
  const asteroid = (coordinate: UniverseCoordinate): UniversePlanetNode => ({
    id: `qa-card:asteroid:${coordinate.system}:${coordinate.position}`, coordinate, kind: 'asteroid', name: 'Астероид', art: arts.asteroid,
    statusLabel: 'Движется', description: '',
    asteroid: { spawnIndex: 7, spawnedAt: nowMs - 90 * MINUTE, movementIndex: 4, previousMoveAt: nowMs - 6 * MINUTE, nextMoveAt: nowMs + 13 * MINUTE + 25_000, nextCoordinate: at(coordinate.system, coordinate.position + 1), gasYield: 0 },
  });
  const pirateNode = (coordinate: UniverseCoordinate, leftMs: number): UniversePlanetNode => ({
    id: `qa-card:pirate:${coordinate.system}:${coordinate.position}`, coordinate, kind: 'pirate', name: 'Пиратская база', art: arts.pirate,
    statusLabel: 'Активна', description: '',
    pirate: { ...timed(nowMs, 20, leftMs), contactCycleKey: `qa-card:pirate:${coordinate.system}:${coordinate.position}:3` },
  });
  const special = (kind: 'unique' | 'anomaly', name: string, coordinate: UniverseCoordinate, leftMs: number): UniversePlanetNode => ({
    id: `qa-card:${kind}:${coordinate.system}:${coordinate.position}`, coordinate, kind, name, art: kind === 'unique' ? arts.unique : arts.anomaly,
    statusLabel: 'Активен', description: '', special: timed(nowMs, 35, leftMs),
  });

  switch (scenario) {
    case 'empty':
      return { nowMs, card: { node: empty(at(12, 9)), orbitalDebris: 0, asteroidHasDebris: false, plansOverride: { recycle: ready(18, 5), colonize: ready(42, 10) } } };
    case 'empty-huge-debris':
      return { nowMs, card: { node: empty(at(14, 23)), orbitalDebris: 987_654_321_000, asteroidHasDebris: false, plansOverride: { recycle: ready(62, 40), colonize: refused(NO_COLONIZER) } } };
    case 'uninhabited':
      return { nowMs, card: { node: { ...empty(at(13, 2)), id: 'qa-card:uninhabited', kind: 'uninhabited', name: 'Необитаемая планета', art: arts.planet }, orbitalDebris: 48_250, asteroidHasDebris: false, plansOverride: { recycle: ready(21, 30) } } };
    case 'asteroid-debris':
      return { nowMs, card: { node: asteroid(at(12, 11)), underlyingNode: empty(at(12, 11)), orbitalDebris: 0, asteroidHasDebris: true, plansOverride: { colonize: ready(39, 50), gas: ready(16, 45) } } };
    case 'asteroid':
      return { nowMs, card: { node: asteroid(at(12, 20)), underlyingNode: { ...empty(at(12, 20)), kind: 'uninhabited', name: 'Необитаемая планета', art: arts.planet }, orbitalDebris: 0, asteroidHasDebris: false, plansOverride: { gas: refused(NO_GAS) } } };
    case 'pirate-new': {
      const node = pirateNode(at(12, 19), 47 * MINUTE + 12_000);
      return { nowMs, card: { node, orbitalDebris: 0, asteroidHasDebris: false, pirateContact: pirateContact(node.coordinate, nowMs, 47 * MINUTE + 12_000, {}), plansOverride: { 'pirate-recon': ready(1, 12), recycle: ready(18, 5) } } };
    }
    case 'pirate-scouted': {
      const node = pirateNode(at(12, 4), 41_000);
      return { nowMs, card: { node, orbitalDebris: 12_345_678_900, asteroidHasDebris: false, pirateContact: pirateContact(node.coordinate, nowMs, 41_000, {
        statusLabel: 'Гарнизон разведан', latestReportId: 'qa-card:pirate-report', latestReportOutcome: 'success',
        elimination: { enabled: true, disabledReason: null },
      }), plansOverride: { 'pirate-recon': ready(1, 12), recycle: ready(18, 5), 'pirate-elimination': ready(24, 40) } } };
    }
    case 'pirate-no-probes': {
      const node = pirateNode(at(13, 15), 2 * 3_600_000 + 5 * MINUTE);
      return { nowMs, card: { node, orbitalDebris: 0, asteroidHasDebris: false, pirateContact: pirateContact(node.coordinate, nowMs, 2 * 3_600_000 + 5 * MINUTE, {
        latestReportOutcome: 'failure', latestReportId: 'qa-card:pirate-report-failed',
        recon: { enabled: false, disabledReason: 'На планетах этой системы нет свободных шпионских зондов. Постройте зонд на верфи или верните флот.' },
        elimination: { enabled: false, disabledReason: 'Сначала разведайте гарнизон базы.' },
      }), plansOverride: { recycle: ready(26, 10) } } };
    }
    case 'unique-free':
      return { nowMs, card: { node: special('unique', LONG_UNIQUE, at(14, 3), 3 * 3_600_000 + 22 * MINUTE), orbitalDebris: 0, asteroidHasDebris: false, explorationStatus: 'free', plansOverride: { 'exploration-recon': ready(3, 30), recycle: ready(31, 5), expedition: ready(51, 0) } } };
    case 'unique-occupied':
      return { nowMs, card: { node: special('unique', 'Кристальный архипелаг', at(15, 8), 54 * MINUTE), orbitalDebris: 0, asteroidHasDebris: false, explorationStatus: 'occupied', plansOverride: { 'exploration-recon': ready(4, 10), recycle: ready(35, 20), 'exploration-attack': refused(NO_WARSHIPS) } } };
    case 'unique-occupied-scouted':
      return { nowMs, card: { node: special('unique', 'Кристальный архипелаг', at(15, 8), 54 * MINUTE), orbitalDebris: 3_400_000, asteroidHasDebris: false, explorationStatus: 'occupied',
        intel: { at: nowMs - 12 * MINUTE, success: true, occupantName: LONG_OWNER, allianceTag: 'СЕВЕР', fleetKnown: true },
        plansOverride: { 'exploration-recon': ready(4, 10), recycle: ready(35, 20), 'exploration-attack': ready(33, 15) } } };
    case 'anomaly-self':
      return { nowMs, card: { node: special('anomaly', 'Ионная рябь', at(11, 21), 7 * MINUTE + 3_000), orbitalDebris: 0, asteroidHasDebris: false, explorationStatus: 'self',
        intel: { at: nowMs - 3 * 3_600_000, success: true, fleetKnown: false },
        plansOverride: { 'exploration-recon': ready(2, 40), recycle: ready(12, 55) } } };
    case 'anomaly-out':
      return { nowMs, card: { node: special('anomaly', 'Пространственный шов', at(31, 6), 26 * MINUTE), orbitalDebris: 0, asteroidHasDebris: false, plansOverride: { recycle: ready(2 * 60 + 14, 0) } } };
    case 'debris-few':
      return { nowMs, debris: { origin: { planetName: 'Helion 01', coordinate: HOME }, plansOverride: debrisPlans([at(12, 3), at(13, 0), at(10, 17)], -1), results: [
        { coordinate: at(12, 3), debris: 125_000 },
        { coordinate: at(13, 0), debris: 2_400_000 },
        { coordinate: at(10, 17), debris: 8_750 },
      ] } };
    case 'debris-many': {
      const results: DebrisEntry[] = [];
      for (let index = 0; index < 22; index += 1) {
        const system = 3 + index;
        results.push({ coordinate: at(system, index % 5 === 0 ? 0 : 1 + ((index * 7) % 24)), debris: index === 2 ? 987_654_321_000 : index === 5 ? 12_345_678_900 : 1_000 + index * 73_911 });
      }
      results.sort((left, right) => Math.abs(left.coordinate.system - HOME.system) - Math.abs(right.coordinate.system - HOME.system)
        || left.coordinate.system - right.coordinate.system || left.coordinate.position - right.coordinate.position);
      return { nowMs, debris: { origin: { planetName: 'Звездоплаватель-Командор Северного Рубежа Прима', coordinate: HOME }, results, plansOverride: debrisPlans(results.map((entry) => entry.coordinate), 3) } };
    }
    case 'debris-empty':
      return { nowMs, debris: { origin: { planetName: 'Helion 01', coordinate: HOME }, results: [], plansOverride: {} } };
    default:
      return { nowMs };
  }
}
