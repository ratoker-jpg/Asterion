import type { FlightRecord } from '../flights/types.ts';
import type { BattleReport } from '../combat/report.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import type { CombatEntityId } from '../combat/ids.ts';
import { getCombatEntity } from '../combat/catalog.ts';
import { getFactionCombatEntity } from '../combat/faction-catalog.ts';
import type { ReportFact, ReportItem, ReportResourceGroup, ReportResource, ReportUnitGroup } from '../reports/types.ts';
import { explorationProfile } from './model.ts';
import type { ExplorationState } from './ledger.ts';

const number = new Intl.NumberFormat('ru-RU');
const KINDS = ['metal', 'minerals', 'gas', 'debris'] as const;
const LABELS = { metal: 'Металл', minerals: 'Минералы', gas: 'Газ', debris: 'Обломки' } as const;
const FLIGHT_NAMES: Readonly<Record<string,string>> = {
  transport: 'Транспортировка', attack: 'Атака', deployment: 'Дислокация',
  colonize: 'Колонизация', recycle: 'Переработка', gas: 'Добыча газа',
  'space-flight': 'Космический рейс', 'pirate-elimination': 'Пиратский рейд',
  'pirate-recon': 'Разведка пиратов', 'sun-support': 'Поддержка солнца',
};
function coords(c: {galaxy: number; system: number; position: number}) {
  return '[' + c.galaxy + ':' + c.system + ':' + c.position + ']';
}
/** Project persisted flight and contact events into the existing real System / Flights mailbox. */
export function explorationMailboxReports(ledger?: ExplorationState, flights: readonly FlightRecord[] = [], playerOwnerId?: string, context: FlightReportContext = {}): ReportItem[] {
  const contacts = ledger?.contacts ?? {};
  const recon: ReportItem[] = (ledger?.reconReports ?? []).filter(record => !playerOwnerId || record.ownerId === playerOwnerId).map(record => {
    const contact = contacts[record.contactId];
    const profile = contact ? explorationProfile(contact.kind, contact.variant) : null;
    const location = contact ? coords(contact.coordinate) : 'Неизвестные координаты';
    const reserveDetails = record.success && contact
      ? KINDS.filter(key => (contact.initialReserve[key] ?? 0) > 0)
        .map(key => ({ label: LABELS[key] + ' · исходный запас', value: number.format(contact.initialReserve[key]) }))
      : [];
    return {
      id: 'exploration-recon:' + record.flightId,
      source: 'exploration',
      category: 'system',
      typeLabel: 'Исследование объекта',
      title: record.success ? 'Исследование завершено' : 'Разведка не удалась',
      preview: (profile?.name ?? 'Космический объект') + ' · ' + location,
      body: record.success
        ? 'Шпионский зонд получил разведданные. Запасы конечны: другие экспедиции могут уменьшить остаток. Фактическая добыча ограничена скоростью, временем и трюмом.'
        : 'Зонд достиг объекта, но не смог классифицировать его ресурсы. Данные о запасах не раскрыты. Повторная разведка возможна после задержки.',
      timestamp: new Date(record.resolvedAt).toISOString(),
      statusLabel: record.success ? 'УСПЕШНО' : 'НЕУДАЧА',
      statusTone: record.success ? 'success' : 'warning',
      participantNames: record.occupant ? [record.occupant.ownerName] : [], planetNames: profile ? [profile.name] : [], coordinates: [location],
      ...(record.occupant ? { occupantRecon: record.occupant } : {}),
      details: [
        { label: 'Цель', value: profile?.name ?? 'Неизвестный объект' },
        { label: 'Координаты', value: location },
        { label: 'Результат', value: record.success ? 'Достоверный состав найден' : 'Сведения не получены' },
        ...(record.success && profile
          ? [{ label: 'Категория риска (из V)', value: ['I','II','III','IV','V'][profile.risk-1]! },
              ...reserveDetails,
              { label: 'Остатки зависят от уже выполненной добычи', value: 'Да' }]
          : []),
      ],
      blocks: {
        place: { name: profile?.name, ...(contact ? { coordinate: { ...contact.coordinate } } : {}) },
        result: record.success ? { label: 'Разведано', tone: 'success' } : { label: 'Провал', tone: 'warning' },
        sides: record.occupant && contact ? [{
          key: 'occupant', role: 'Хозяин объекта', name: record.occupant.ownerName,
          meta: record.occupant.alliance ? '[' + record.occupant.alliance.tag + '] ' + record.occupant.alliance.name : 'Без союза',
          place: { coordinate: { ...contact.coordinate }, ownerId: record.occupant.ownerId },
          portrait: { kind: 'faction', factionId: record.occupant.raceId },
        }] : [],
        ships: record.occupant ? [occupantFleet(record.occupant)] : [],
        resources: record.success && contact ? [cargoGroup('reserve', 'Исходный запас', contact.initialReserve)] : [],
        details: record.success && profile ? [{ label: 'Категория риска', value: ['I','II','III','IV','V'][profile.risk-1]! + ' из V' }] : [],
      },
    };
  });

  // Report the actual landing outcome; do not replace a zero-yield flight with a fictional reward.
  const expedition: ReportItem[] = Object.values(contacts).flatMap(contact =>
    contact.events.filter(event => (event.kind === 'returned' || event.kind === 'origin-destroyed') && (!playerOwnerId || event.ownerId === playerOwnerId)).map(event => {
      const profile = explorationProfile(contact.kind, contact.variant);
      const returned = event.kind === 'returned';
      const cargo = event.cargo ?? { metal: 0, minerals: 0, gas: 0, debris: 0 };
      const credited = event.creditedCargo ?? cargo;
      const burned = event.burnedCargo;
      const total = KINDS.reduce((sum,key)=>sum + credited[key],0);
      const pieces = KINDS.map(key => LABELS[key] + ' ' + number.format(credited[key]));
      const location = coords(contact.coordinate);
      return {
        id: 'exploration-return:' + event.flightId,
        source: 'exploration', category: 'flights',
        typeLabel: 'Возвращение экспедиции',
        title: returned ? 'Экспедиция вернулась' : 'Экспедиция потеряла планету назначения',
        preview: profile.name + ' · ' + (returned ? pieces.join(' · ') : 'Груз потерян'),
        body: returned
          ? total > 0
            ? 'Флот вернулся на планету отправления. Металл, минералы и газ поступили на склады с учётом лимитов. Обломки помещены в запас переработки на исходной планете, а не на обычный склад.'
            : 'Флот вернулся БЕЗ ДОБЫЧИ. Проверьте специализацию кораблей: для обломков нужны переработчики, транспортёры их не добывают.'
          : 'Планета отправления уничтожена. Ресурсы экспедиции не доставлены.',
        timestamp: new Date(event.at).toISOString(),
        statusLabel: returned ? (total ? 'ДОСТАВЛЕНО' : '0 РЕСУРСОВ') : 'ПОТЕРЯНО',
        statusTone: returned ? (total ? 'success' : 'warning') : 'danger',
        participantNames: [], planetNames: [profile.name], coordinates: [location],
        details: [
          { label: 'Цель', value: profile.name + ' ' + location },
          { label: 'Планета отправления', value: (event.originPlanetId && context.planetNames?.[event.originPlanetId]) || (returned ? UNAVAILABLE : 'Утрачена') },
          ...KINDsDetails(credited),
          ...(burned ? KINDsDetails(burned,'Сгорело при переполнении · ') : []),
          { label: 'Обломки хранятся', value: 'На исходной планете → Переработка (не склад металла)' },
          { label: 'Жетоны ремонта', value: String(event.repairTokens ?? 0) },
        ],
        blocks: {
          place: { name: profile.name, coordinate: { ...contact.coordinate } },
          result: returned ? (total ? { label: 'Доставлено', tone: 'success' } : { label: 'Пусто', tone: 'warning' }) : { label: 'Потеряно', tone: 'danger' },
          resources: returned ? [
            cargoGroup('credited', 'Доставлено', credited, 'gain'),
            ...(burned && cargoTotal(burned) ? [cargoGroup('burned', 'Сгорело при переполнении склада', burned, 'loss')] : []),
          ] : [],
          details: [
            { label: 'Планета отправления', value: (event.originPlanetId && context.planetNames?.[event.originPlanetId]) || (returned ? UNAVAILABLE : 'Утрачена') },
            ...(returned && credited.debris > 0 ? [{ label: 'Обломки', value: 'В запасе переработки исходной планеты' }] : []),
            { label: 'Жетоны ремонта', value: event.repairTokens ? '+' + number.format(event.repairTokens) : 'Не найдены' },
          ],
        },
      };
    }));

  // Every landed/returned canonical flight with a completed record gets a flight-mailbox trail.
  // Expedition deliveries have the exact escrow receipt above, avoiding duplicate reporting.
  // Only the player's own flights: NPC flights are private to their owners
  // (an NPC attack on the player reaches the mailbox as its battle report).
  const generic: ReportItem[] = flights.filter(f => (f.phase === 'completed' || f.phase === 'failed')
    && f.ownerSide !== 'pirate' && f.ownerSide !== 'bot01' && f.ownerSide !== 'npc'
    && f.missionId !== 'expedition' && f.missionId !== 'exploration-recon'
    && f.missionId !== 'espionage').map(flight => flightSummaryReport(flight, context));
  return [...recon,...expedition,...generic];
}

/** Names the report cannot derive from a flight record alone. */
export type FlightReportContext = {
  /** Live names of the player's planets by id. */
  planetNames?: Readonly<Record<string, string>>;
  battleReports?: readonly BattleReport[];
  factionId?: CombatFactionId;
};

const UNAVAILABLE = 'данные недоступны';
type Outcome = { label: string; title: string; status: string; tone: ReportItem['statusTone'] };

function flightOutcome(flight: FlightRecord, battle?: BattleReport): Outcome {
  const reason = flight.phase === 'failed' && !flight.completionReason ? 'mission-failed' : flight.completionReason;
  switch (reason) {
    case 'recalled': return { label: 'Отозван', title: 'Рейс отозван', status: 'ОТОЗВАН', tone: 'neutral' };
    case 'target-unavailable': return { label: 'Цель недоступна', title: 'Цель недоступна', status: 'ЦЕЛЬ НЕДОСТУПНА', tone: 'warning' };
    case 'target-occupied': return { label: 'Координата занята', title: 'Координата занята', status: 'КООРДИНАТА ЗАНЯТА', tone: 'warning' };
    case 'colonized': return { label: 'Колонизировано', title: 'Колония основана', status: 'КОЛОНИЗИРОВАНО', tone: 'success' };
    case 'deployed': return { label: 'Дислоцировано', title: 'Флот дислоцирован', status: 'ДИСЛОЦИРОВАНО', tone: 'success' };
    case 'spy-destroyed': return { label: 'Зонд уничтожен', title: 'Зонд уничтожен', status: 'ЗОНД УНИЧТОЖЕН', tone: 'danger' };
    case 'origin-destroyed': return { label: 'Исходная планета потеряна', title: 'Исходная планета потеряна', status: 'ФЛОТ ПОТЕРЯН', tone: 'danger' };
    case 'mission-failed': return { label: 'Миссия провалена', title: 'Миссия провалена', status: 'ПРОВАЛ', tone: 'danger' };
    case 'normal': case 'normal-return': case 'arrived': {
      if (battle && (flight.missionId === 'attack' || flight.missionId === 'pirate-elimination')) {
        if (battle.winner === 'defender') return { label: 'Штатный возврат после поражения', title: 'Атака отбита', status: 'ПОРАЖЕНИЕ', tone: 'danger' };
        if (battle.winner === 'draw') return { label: 'Штатный возврат после ничьей', title: 'Бой закончился ничьей', status: 'НИЧЬЯ', tone: 'warning' };
      }
      return { label: 'Штатный возврат', title: flight.missionId === 'transport' ? 'Груз доставлен' : 'Флот вернулся', status: 'ЗАВЕРШЕНО', tone: 'success' };
    }
    default: return { label: UNAVAILABLE, title: 'Рейс завершён', status: 'ЗАВЕРШЕНО', tone: 'info' };
  }
}

function unitName(context: FlightReportContext, id: string): string {
  try {
    return context.factionId
      ? getFactionCombatEntity(context.factionId, id as CombatEntityId).name
      : getCombatEntity(id as CombatEntityId).name;
  } catch {
    return 'Неизвестный корабль';
  }
}

function unitsLabel(context: FlightReportContext, units: Readonly<Record<string, number | undefined>>): string {
  const parts = Object.entries(units).filter(([, count]) => Number.isSafeInteger(count) && count! > 0)
    .map(([id, count]) => unitName(context, id) + ' × ' + number.format(count!));
  return parts.length ? parts.join(', ') : 'нет';
}

/** Ships that actually came home; undefined when the record cannot tell. */
function returnedFleet(flight: FlightRecord, context: FlightReportContext, battle?: BattleReport): string | undefined {
  const reason = flight.completionReason;
  if (reason === 'origin-destroyed' || reason === 'spy-destroyed' || (flight.phase === 'failed' && reason !== 'recalled')) return 'Флот потерян';
  if (reason === 'colonized') return 'Колонизатор остался в новой колонии';
  if (reason === 'deployed') return 'Флот остался на планете назначения';
  if (flight.attackResolution) {
    if (!battle) return undefined;
    const survivors: Record<string, number> = {};
    for (const stack of battle.attackerForce.stacks ?? []) {
      if (stack.countAfter > 0) survivors[stack.entityId] = stack.countAfter;
    }
    return Object.keys(survivors).length ? unitsLabel(context, survivors) : 'Флот уничтожен в бою';
  }
  return unitsLabel(context, { ...flight.selectedShips, ...(flight.selectedCommanders ?? {}) });
}

function cargoRows(prefix: string, cargo: Record<typeof KINDS[number], number>) {
  return KINDS.filter(key => cargo[key] > 0).map(key => ({ label: prefix + LABELS[key], value: number.format(cargo[key]) }));
}

function cargoTotal(cargo?: Record<typeof KINDS[number], number>) {
  return cargo ? KINDS.reduce((sum, key) => sum + cargo[key], 0) : 0;
}

/** Resource lines: what the mission brought and where it landed. Never the departure cargo. */
function resourceRows(flight: FlightRecord): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const settlement = flight.cargoSettlement;
  if (flight.attackResolution) {
    const loot = flight.attackResolution.loot;
    rows.push(...(cargoTotal(loot) ? cargoRows('Добыча · ', loot) : [{ label: 'Добыча', value: 'нет' }]));
    if (flight.attackResolution.debris > 0) rows.push({ label: 'Обломки на орбите цели', value: number.format(flight.attackResolution.debris) });
    if (flight.attackResolution.planetDestroyed) rows.push({ label: 'Планета цели', value: 'Уничтожена' });
    if (!cargoTotal(loot)) return rows;
  } else if (flight.missionId === 'colonize' && flight.completionReason === 'colonized') {
    rows.push({ label: 'Новая колония', value: coords(flight.destinationCoordinate) });
    return rows;
  } else if (flight.missionId === 'aid') {
    if (flight.cargoState === 'delivered' && flight.aid?.creditedUnits !== undefined) {
      rows.push({ label: 'Зачислено союзнику · ' + LABELS[flight.aid.resource], value: number.format(flight.aid.creditedUnits) });
      return rows;
    }
  } else if (!['transport', 'recycle', 'gas', 'space-flight'].includes(flight.missionId)) {
    return rows;
  }
  if (flight.cargoState === 'voided') {
    rows.push({ label: 'Груз', value: 'Потерян: цель недоступна' });
    return rows;
  }
  if (!settlement) {
    rows.push({ label: 'Зачислено на склад', value: UNAVAILABLE });
    return rows;
  }
  if (settlement.lost) {
    rows.push(...(cargoTotal(settlement.lost) ? cargoRows('Потеряно · ', settlement.lost) : [{ label: 'Груз', value: 'нет' }]));
    return rows;
  }
  const delivered = settlement.stage === 'delivered';
  rows.push(...(cargoTotal(settlement.credited)
    ? cargoRows(delivered ? 'Доставлено · ' : 'Зачислено · ', settlement.credited)
    : [{ label: delivered ? 'Доставлено' : 'Зачислено', value: 'нет' }]));
  if (settlement.credited.debris > 0 && !delivered) rows.push({ label: 'Обломки хранятся', value: 'В запасе переработки исходной планеты' });
  rows.push(...cargoRows('Сгорело при переполнении склада · ', settlement.burned));
  return rows;
}

function flightSummaryReport(flight: FlightRecord, context: FlightReportContext): ReportItem {
  const location = coords(flight.destinationCoordinate);
  const battle = flight.attackResolution
    ? context.battleReports?.find(report => report.id === flight.attackResolution!.reportId) : undefined;
  const outcome = flightOutcome(flight, battle);
  const mission = FLIGHT_NAMES[flight.missionId] ?? 'Полёт';
  const originName = context.planetNames?.[flight.originPlanetId];
  const originAt = flight.originCoordinate ? coords(flight.originCoordinate) : '';
  const origin = originName ? (originName + ' ' + originAt).trim() : originAt ? 'Планета ' + originAt : UNAVAILABLE;
  const target = flight.targetPlanetName ? flight.targetPlanetName + ' ' + location : location;
  return {
    id: 'flight-landing:' + flight.id,
    source: 'flights', category: 'flights',
    typeLabel: 'Итог полёта',
    title: outcome.title,
    preview: mission + ' · ' + location,
    body: 'Итог записан по фактическому рейсу: исход, вернувшийся флот и ресурсы, которые действительно поступили на склады.',
    timestamp: new Date(flight.completedAt ?? flight.returnAt ?? flight.arrivalAt).toISOString(),
    statusLabel: outcome.status,
    statusTone: outcome.tone,
    participantNames: [],
    planetNames: [originName, flight.targetPlanetName].filter((name): name is string => Boolean(name)),
    coordinates: [location],
    details: [
      { label: 'Миссия', value: mission },
      { label: 'Исход', value: outcome.label },
      { label: 'Планета отправления', value: origin },
      { label: 'Цель', value: target },
      ...(battle ? [{ label: 'Бой', value: battle.winner === 'attacker' ? 'Победа' : battle.winner === 'defender' ? 'Поражение' : 'Ничья' }] : []),
      { label: 'Вернувшийся флот', value: returnedFleet(flight, context, battle) ?? UNAVAILABLE },
      ...resourceRows(flight),
    ],
    blocks: flightBlocks(flight, context, outcome, battle, originName, target),
  };
}

/** Block data of a flight summary: the same facts as the rows above, structured. */
function flightBlocks(flight: FlightRecord, context: FlightReportContext, outcome: Outcome, battle: BattleReport | undefined, originName: string | undefined, target: string): NonNullable<ReportItem['blocks']> {
  const groups: ReportResourceGroup[] = [];
  const facts: ReportFact[] = [{ label: 'Миссия', value: FLIGHT_NAMES[flight.missionId] ?? 'Полёт' }, { label: 'Исход', value: outcome.label }];
  for (const row of resourceRows(flight)) {
    const split = row.label.indexOf(' · ');
    const kind = split < 0 ? undefined : KINDS.find((key) => LABELS[key] === row.label.slice(split + 3));
    const amount = Number(row.value.replace(/[\s  ]/g, ''));
    if (kind && Number.isFinite(amount)) {
      const title = row.label.slice(0, split);
      let group = groups.find((entry) => entry.title === title);
      if (!group) {
        group = { key: 'cargo-' + groups.length, title, items: [], tone: /Сгорело|Потеряно/.test(title) ? 'loss' : 'gain' };
        groups.push(group);
      }
      group.items.push({ kind, label: LABELS[kind], value: amount });
    } else {
      facts.push(row);
    }
  }
  const units = returnedUnits(flight, context, battle);
  return {
    place: { ...(flight.targetPlanetName ? { name: flight.targetPlanetName } : {}), coordinate: { ...flight.destinationCoordinate } },
    result: { label: flightResultWord(flight, outcome), tone: outcome.tone },
    sides: [
      { key: 'origin', role: 'Отправление', name: originName ?? 'Планета', ...(flight.originCoordinate ? { place: { coordinate: { ...flight.originCoordinate } } } : {}) },
      { key: 'target', role: 'Цель', name: flight.targetPlanetName ?? target, place: { coordinate: { ...flight.destinationCoordinate } } },
    ],
    ships: [units
      ? { key: 'returned', title: 'Вернувшийся флот', units }
      : { key: 'returned', title: 'Вернувшийся флот', units: [], empty: returnedFleet(flight, context, battle) ?? UNAVAILABLE }],
    resources: groups,
    details: [...facts, ...(battle ? [{ label: 'Бой', value: battle.winner === 'attacker' ? 'Победа' : battle.winner === 'defender' ? 'Поражение' : 'Ничья' }] : [])],
  };
}

function flightResultWord(flight: FlightRecord, outcome: Outcome): string {
  switch (outcome.status) {
    case 'ОТОЗВАН': return 'Отозван';
    case 'ЦЕЛЬ НЕДОСТУПНА': return 'Недоступна';
    case 'КООРДИНАТА ЗАНЯТА': return 'Занято';
    case 'КОЛОНИЗИРОВАНО': return 'Колония';
    case 'ДИСЛОЦИРОВАНО': return 'Дислоцирован';
    case 'ЗОНД УНИЧТОЖЕН': case 'ФЛОТ ПОТЕРЯН': return 'Потерян';
    case 'ПРОВАЛ': return 'Провал';
    case 'ПОРАЖЕНИЕ': return 'Поражение';
    case 'НИЧЬЯ': return 'Ничья';
    default: return flight.missionId === 'transport' || flight.missionId === 'aid' ? 'Доставлено' : 'Вернулся';
  }
}

/** Ship lines of the fleet that came home; undefined when it is a sentence (lost, stayed, unknown). */
function returnedUnits(flight: FlightRecord, context: FlightReportContext, battle?: BattleReport) {
  const reason = flight.completionReason;
  if (reason === 'origin-destroyed' || reason === 'spy-destroyed' || reason === 'colonized' || reason === 'deployed' || (flight.phase === 'failed' && reason !== 'recalled')) return undefined;
  let fleet: Record<string, number | undefined>;
  if (flight.attackResolution) {
    if (!battle) return undefined;
    fleet = {};
    for (const stack of battle.attackerForce.stacks ?? []) if (stack.countAfter > 0) fleet[stack.entityId] = stack.countAfter;
  } else {
    fleet = { ...flight.selectedShips, ...(flight.selectedCommanders ?? {}) };
  }
  const units = Object.entries(fleet).filter(([, count]) => Number.isSafeInteger(count) && count! > 0).map(([id, count]) => {
    const art = unitArt(context, id);
    return { key: id, name: unitName(context, id), ...(art ? { art } : {}), count: count! };
  });
  return units.length ? units : undefined;
}

function unitArt(context: FlightReportContext, id: string): string | undefined {
  try {
    return context.factionId ? getFactionCombatEntity(context.factionId, id as CombatEntityId).art : getCombatEntity(id as CombatEntityId).art;
  } catch {
    return undefined;
  }
}

function cargoGroup(key: string, title: string, cargo: Record<typeof KINDS[number], number>, tone?: ReportResourceGroup['tone']): ReportResourceGroup {
  const items: ReportResource[] = KINDS.filter((kind) => (cargo[kind] ?? 0) > 0).map((kind) => ({ kind, label: LABELS[kind], value: cargo[kind] }));
  return { key, title, items, ...(tone ? { tone } : {}), empty: 'Ничего.' };
}

function occupantFleet(occupant: NonNullable<ReportItem['occupantRecon']>): ReportUnitGroup {
  if (occupant.quality !== 'full') return { key: 'occupant-fleet', title: 'Флот хозяина', units: [], hidden: true, empty: 'Состав флота не раскрыт: уровень шпионажа зонда ниже, чем нужно для полного отчёта.' };
  const units = Object.entries(occupant.fleet ?? {}).filter(([, count]) => Number(count) > 0).map(([id, count]) => {
    let unit: { name: string; art: string; role: string } | null = null;
    try { unit = getFactionCombatEntity(occupant.raceId, id as CombatEntityId); } catch { unit = null; }
    const level = occupant.fleetLevels?.[id];
    return { key: id, name: unit?.name ?? 'Неизвестный корабль', ...(unit ? { art: unit.art } : {}), ...(level !== undefined ? { note: 'Уровень ' + level } : unit ? { note: unit.role } : {}), count: Number(count) };
  });
  return { key: 'occupant-fleet', title: 'Флот хозяина', units, empty: 'Корабли не найдены.' };
}

function KINDsDetails(cargo: Record<typeof KINDS[number],number>, prefix = '') {
  return KINDS.map(key => ({ label: prefix + LABELS[key], value: number.format(cargo[key] ?? 0) }));
}
