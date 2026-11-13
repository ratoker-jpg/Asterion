import type { FlightRecord, MissionId } from '../../domain/flights/types.ts';
import type { ShipId } from '../../domain/combat/ids.ts';
import type { PirateRaidSnapshot } from '../../domain/pirates/mission.ts';
import type { UniverseCoordinate } from '../../domain/universe/types.ts';

/**
 * Test Mode screenshot scenarios of «Рейсы и миссии» (`#flights-board-<scenario>`),
 * concepts v2 section 1. The board shows these flights instead of the save's,
 * against a frozen clock, so every frame is the same on every run. Nothing is
 * written to the save: the records exist only on the screen.
 */
export const FLIGHTS_BOARD_QA_SCENARIOS = ['empty', 'one', 'many', 'attacks', 'long', 'nine'] as const;
export type FlightsBoardQaScenario = typeof FLIGHTS_BOARD_QA_SCENARIOS[number];

const ROUTE = 'flights-board-';

export function getFlightsBoardQaScenario(mode: string): FlightsBoardQaScenario | null {
  if (mode !== 'test' || typeof window === 'undefined') return null;
  const name = window.location.hash.startsWith(`#${ROUTE}`) ? window.location.hash.slice(ROUTE.length + 1) : '';
  return (FLIGHTS_BOARD_QA_SCENARIOS as readonly string[]).includes(name) ? name as FlightsBoardQaScenario : null;
}

export type FlightsBoardQaFixture = {
  /** Frozen «now»: 12.11.2026 23:41 Moscow time. */
  nowMs: number;
  records: FlightRecord[];
  /** Espionage level the incoming attacks are read with (10 reveals their composition). */
  espionageLevel: number;
  /** Planet names shown instead of the save's (long names live here). */
  planetNames: Record<string, string>;
  /** The flight the bottom card opens on. */
  focusId?: string;
  /** Fleet-slot limit of the seeded player (3 + 1,5 per «Компьютерные системы»), so «занято X из Y» matches the list. */
  slotLimit: number;
};

const NOW = Date.UTC(2026, 10, 12, 20, 41, 0);
const MIN = 60_000;
const LONG_PLANET = 'Северный Предел Звездоплавателя-Командора Кассиопеи';
const LONG_TARGET = 'Туманность Кассиопея-Прайм за Поясом Отступников';
const LONG_OWNER = 'Звездоплаватель-Командор Северного Предела';
const BIG = 987_654_321_098; // 12 digits

const at = (galaxy: number, system: number, position: number): UniverseCoordinate => ({ galaxy, system, position });

type Spec = {
  id: string;
  missionId: MissionId;
  phase: FlightRecord['phase'];
  /** Minutes since departure and minutes the leg takes. */
  ago: number;
  leg: number;
  origin?: string;
  ships: Partial<Record<ShipId, number>>;
  target?: UniverseCoordinate;
  targetName?: string;
  ownerSide?: FlightRecord['ownerSide'];
  extra?: Partial<FlightRecord>;
};

function build(spec: Spec, home: string, homeAt: UniverseCoordinate, playerId: string): FlightRecord {
  // `ago`: minutes since departure; `leg`: minutes left until the next event (arrival, return or release).
  const departedAt = NOW - spec.ago * MIN;
  const outbound = spec.phase === 'outbound';
  const oneWay = outbound ? (spec.ago + spec.leg) * MIN : Math.round((spec.ago + spec.leg) / 2) * MIN;
  const arrivalAt = outbound ? departedAt + oneWay : spec.phase === 'arrived' ? NOW - 10 * MIN : departedAt + oneWay;
  const target = spec.target ?? at(2, 301, 11);
  const foreign = spec.ownerSide && spec.ownerSide !== 'player';
  return {
    id: spec.id,
    requestId: `qa-${spec.id}`,
    ownerSide: spec.ownerSide ?? 'player',
    missionId: spec.missionId,
    originPlanetId: foreign ? `qa-foreign-${spec.id}` : spec.origin ?? home,
    originCoordinate: foreign ? at(1, 14, 9) : homeAt,
    destination: foreign
      ? { kind: 'planet', planetId: home, coordinate: homeAt }
      : spec.missionId === 'space-flight' ? { kind: 'space', coordinate: homeAt } : { kind: 'coordinate', coordinate: target },
    destinationCoordinate: foreign ? homeAt : spec.missionId === 'space-flight' ? homeAt : target,
    ...(foreign ? { destinationPlanetId: home, destinationOwnerId: playerId } : {}),
    ...(spec.targetName ? { targetPlanetName: spec.targetName } : {}),
    selectedShips: spec.ships,
    populationReserved: 0,
    routeDistance: 1000,
    effectiveSpeed: 10_000,
    oneWayDurationMs: oneWay,
    departedAt,
    arrivalAt,
    ...(spec.phase === 'returning' || spec.phase === 'arrived' ? { returnAt: NOW + spec.leg * MIN, arrivedAt: arrivalAt } : {}),
    gasCost: 0,
    phase: spec.phase,
    ...spec.extra,
  };
}

const NINE: Partial<Record<ShipId, number>> = {
  'death-star': 12, bomber: 44_210, destroyer: 120_567, battleship: 88_210, defender: 312_044,
  cruiser: 900_311, scout: 1_240_567, 'mega-transporter': 61_000, recycler: 9_870,
};

function attackSpecs(): Spec[] {
  return [
    { id: 'qa-attack-npc', missionId: 'attack', phase: 'outbound', ago: 30, leg: 4, ownerSide: 'npc', ships: { 'death-star': 3, battleship: 88_210, bomber: 12_044, cruiser: 900_311 }, extra: { targetOwnerName: LONG_OWNER, ownerId: 'qa-npc-1' } },
    { id: 'qa-attack-pirate', missionId: 'pirate-raid', phase: 'outbound', ago: 20, leg: 11, ownerSide: 'pirate', ships: {}, extra: {
      pirateRaidSnapshot: { composition: { 'pirate-hound': 4_200, 'pirate-raider': 610 } } as unknown as PirateRaidSnapshot,
    } },
    { id: 'qa-attack-bot', missionId: 'attack', phase: 'outbound', ago: 5, leg: 120, ownerSide: 'bot01', ships: { scout: BIG, cruiser: 1 } },
  ];
}

function ownSpecs(count: number, colony: string): Spec[] {
  const missions: { missionId: MissionId; ships: Partial<Record<ShipId, number>>; extra?: Partial<FlightRecord>; targetName?: string }[] = [
    { missionId: 'space-flight', ships: { cruiser: 600 } },
    { missionId: 'expedition', ships: { recycler: 4_000, transporter: 700 }, targetName: LONG_TARGET },
    { missionId: 'gas', ships: { recycler: 1_020 }, extra: { cargo: { metal: 0, minerals: 0, gas: 34_500_000, debris: 0 } }, targetName: 'Астероид Кассиопея-7' },
    { missionId: 'attack', ships: { battleship: 86_000, bomber: 1_200 }, extra: { cargo: { metal: 988_000_000_000, minerals: 45_000_000_000, gas: 3_000_000, debris: 0 }, targetOwnerName: 'Ноктюрн' }, targetName: 'Ноктюрн-9' },
    { missionId: 'transport', ships: { 'mega-transporter': 2_400 }, extra: { cargo: { metal: BIG, minerals: BIG, gas: BIG, debris: BIG }, targetRelation: 'self' }, targetName: 'Helion 03' },
    { missionId: 'deployment', ships: { cruiser: 40, defender: 12 }, extra: { targetRelation: 'self' }, targetName: 'Helion 02' },
    { missionId: 'recycle', ships: { recycler: 310 } },
    { missionId: 'colonize', ships: { colonizer: 1 } },
    { missionId: 'espionage', ships: { 'spy-probe': 5 } },
  ];
  const phases: FlightRecord['phase'][] = ['returning', 'arrived', 'arrived', 'returning', 'outbound', 'outbound', 'outbound', 'outbound'];
  const out: Spec[] = [];
  for (let index = 0; index < count; index += 1) {
    const pick = missions[index % missions.length];
    if (pick.missionId === 'espionage') continue; // spies live in «Шпионские отчёты», not in the flight list
    const phase = phases[index % phases.length];
    out.push({
      id: `qa-own-${String(index + 1).padStart(2, '0')}`,
      missionId: pick.missionId,
      phase: pick.missionId === 'expedition' || pick.missionId === 'gas' ? 'arrived' : pick.missionId === 'colonize' || pick.missionId === 'deployment' ? 'outbound' : phase,
      ago: 400 - index * 14,
      leg: 12 + (index % 5) * 47 + index,
      origin: index % 3 === 1 ? colony : undefined,
      ships: index === 0 ? NINE : pick.ships,
      target: at(1 + (index % 4), 100 + index * 7, 1 + (index % 15)),
      targetName: pick.targetName,
      extra: pick.extra,
    });
  }
  return out;
}

export function createFlightsBoardQaFixture(
  scenario: FlightsBoardQaScenario,
  context: { home: string; homeAt: UniverseCoordinate; colony: string; playerId: string },
): FlightsBoardQaFixture {
  const { home, homeAt, colony, playerId } = context;
  const make = (specs: Spec[]) => specs.map((spec) => build(spec, home, homeAt, playerId));
  const base = { nowMs: NOW, planetNames: {} as Record<string, string>, espionageLevel: 10, slotLimit: 3 };
  switch (scenario) {
    case 'empty':
      return { ...base, records: [] };
    case 'one':
      return { ...base, records: make([{ id: 'qa-one', missionId: 'transport', phase: 'outbound', ago: 10, leg: 42, ships: { transporter: 120, 'mega-transporter': 4 }, target: at(1, 12, 8), targetName: 'Helion 02', extra: { cargo: { metal: 1_200_000, minerals: 640_000, gas: 0, debris: 0 }, targetRelation: 'self' } }]) };
    case 'attacks':
      return { ...base, records: make(attackSpecs()) };
    case 'many':
      // 3 attacks with the composition hidden (Espionage 9) and 25 own missions.
      return { ...base, espionageLevel: 9, slotLimit: 30, records: make([...attackSpecs(), ...ownSpecs(28, colony)]) };
    case 'long':
      return {
        ...base,
        slotLimit: 9,
        planetNames: { [home]: LONG_PLANET, [colony]: 'Пояс Отступников Кассиопеи-Прайм у Северного Предела' },
        records: make([...attackSpecs().slice(0, 1), ...ownSpecs(6, colony)]),
        focusId: 'qa-own-05',
      };
    case 'nine':
      return { ...base, slotLimit: 6, records: make(ownSpecs(4, colony)), focusId: 'qa-own-01' };
  }
}
