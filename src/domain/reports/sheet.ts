import { plural } from '../plural.ts';
import type { BattleReportViewModel, BattleSideViewModel, BattleStackViewModel } from '../combat/battle-report-view-model.ts';
import { COMMANDER_ABILITIES, formatCommanderPresentedEffect, getCommanderPresentedAbility, type CommanderId } from '../combat/commanders.ts';
import { getFactionCombatEntity } from '../combat/faction-catalog.ts';
import { getCombatFactionName, type CombatFactionId } from '../combat/factions.ts';
import type { CombatEntityId, ShipId } from '../combat/ids.ts';
import type { SpyReportSnapshot } from '../espionage/types.ts';
import { PIRATE_BASE_SHIPS } from '../pirates/catalog.ts';
import type {
  OverpopulationEpisodeReport,
  PersonalLetter,
  ReportCoordinate,
  ReportFact,
  ReportItem,
  ReportPlace,
  ReportPortrait,
  ReportResourceGroup,
  ReportResultWord,
  ReportRound,
  ReportSide,
  ReportUnit,
  ReportUnitGroup,
} from './types.ts';

// One format for every report (owner, 11.11.2026, Nemexia-like structure in our
// own look): a header (kind, title, place, time, result in one word), a body
// built only from the shared blocks «Участники», «Корабли», «Ресурсы»,
// «Постройки / Оборона / Науки» and a collapsed «Подробности», and a footer
// with the actions the game already has, one of them primary.

export type ReportSheetKind =
  | 'battle' | 'spy' | 'spy-lost' | 'overpopulation' | 'pirate-recon' | 'pirate-absence'
  | 'recycling' | 'gas' | 'exploration-recon' | 'expedition' | 'flight' | 'letter' | 'other';

export type ReportSheetActionKind =
  | 'open_battle' | 'simulate_battle' | 'recall_spy' | 'open_fleets' | 'open_command'
  /** The Fleets screen prefilled: recyclers to the battle's debris, an attack on the spied planet, the same flight again. */
  | 'collect_debris' | 'attack_target' | 'repeat_flight'
  | 'accept' | 'decline'
  /** The report's place on the map (the same link as its coordinates). */
  | 'show_on_map'
  /** The Fleets screen prefilled with an attack on the same planet (the same launch as «Атаковать» from a spy report). */
  | 'attack_again';
export type ReportSheetAction = { kind: ReportSheetActionKind; label: string; primary: boolean; missionId?: string; flightId?: string; coordinate?: ReportCoordinate };

/** A titled list of facts inside «Подробности» (the bonuses of one battle side…). */
export type ReportFactSection = { title: string; facts: ReportFact[] };

export type ReportSheet = {
  kind: ReportSheetKind;
  typeLabel: string;
  title: string;
  /** One sentence under the title. */
  summary: string;
  time?: string;
  place: ReportPlace | null;
  result: ReportResultWord;
  sides: ReportSide[];
  ships: ReportUnitGroup[];
  resources: ReportResourceGroup[];
  assets: ReportUnitGroup[];
  details: ReportFact[];
  /** More facts in «Подробности», each under its own title. */
  sections?: ReportFactSection[];
  rounds: ReportRound[];
  actions: ReportSheetAction[];
  letter?: PersonalLetter;
};

/** What the report screen can do beyond reading (the sheet only offers what is possible). */
export type ReportSheetContext = {
  /** Flights the player can send again right now. */
  canRepeatFlight?: (flightId: string) => boolean;
};

const number = new Intl.NumberFormat('ru-RU');
const dateTime = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const COORDINATE = /\[(\d+):(\d+):(\d+)\]/;

export function parseReportCoordinate(value: string | null | undefined): ReportCoordinate | undefined {
  const match = value ? COORDINATE.exec(value) : null;
  return match ? { galaxy: Number(match[1]), system: Number(match[2]), position: Number(match[3]) } : undefined;
}

export function formatReportCoordinate(coordinate: ReportCoordinate) {
  return `[${coordinate.galaxy}:${coordinate.system}:${coordinate.position}]`;
}

function at(ms: number) {
  return dateTime.format(new Date(ms));
}

function entity(factionId: string, id: string) {
  try {
    return getFactionCombatEntity(factionId as CombatFactionId, id as CombatEntityId);
  } catch {
    return null;
  }
}


// ---------------------------------------------------------------- battle

function isPirate(side: BattleSideViewModel) {
  const participant = side.participant as { race?: string | null; playerId?: string | null; playerName?: string };
  return /pirat|пират/i.test([participant.race, participant.playerId, participant.playerName].join(' '));
}

function battleUnit(stack: BattleStackViewModel): ReportUnit {
  return {
    key: stack.key,
    name: stack.name,
    art: stack.art,
    note: stack.tooltip.level != null ? `Уровень ${stack.tooltip.level}` : stack.role,
    count: stack.countBefore,
    lost: stack.destroyed,
  };
}

/** Bonuses one side fought with: «Подробности», not the first screen. */
function battleBonuses(side: BattleSideViewModel): ReportFact[] {
  return [
    ...(side.activeCommander ? [{ label: 'Командир', value: side.activeCommander.name }] : []),
    ...side.technologies.filter((technology) => technology.level > 0).map((technology) => ({
      label: technology.name,
      value: technology.bonusPercent > 0 ? `+${number.format(technology.bonusPercent)}%` : `Уровень ${technology.level}`,
    })),
    // Engine-only modifiers (snapshot ids, English keys) are not player words.
    ...side.modifiers.filter((modifier) => !/[A-Za-z]/.test(`${modifier.label}${modifier.value}`)).map((modifier) => ({ label: modifier.label, value: modifier.value })),
  ];
}

function battleSide(side: BattleSideViewModel, outcome: ReportSide['outcome']): ReportSide {
  const role = side.participant.side === 'attacker' ? 'Атакующий' : 'Защитник';
  const pirate = isPirate(side);
  const lost = (side.losses.ships ?? 0) + (side.losses.defenses ?? 0);
  const facts: ReportFact[] = side.losses.ships != null || side.losses.defenses != null ? [{ label: 'Потеряно единиц', value: number.format(lost) }] : [];
  return {
    key: side.participant.side,
    role,
    name: side.participant.playerName || side.participant.planetName || 'Неизвестный',
    meta: [pirate ? 'Пираты' : side.participant.race, side.participant.planetName].filter(Boolean).join(' · ') || undefined,
    place: side.participant.coordinates ? { name: side.participant.planetName ?? undefined, coordinate: parseReportCoordinate(side.participant.coordinates), ownerId: side.participant.playerId ?? undefined } : undefined,
    portrait: pirate ? { kind: 'pirate' } : { kind: 'faction', factionId: side.factionId },
    outcome,
    population: { before: side.populationBefore, after: side.populationAfter },
    facts,
  };
}

function battleResult(item: ReportItem, viewModel: BattleReportViewModel): ReportResultWord {
  if (!viewModel.roundCount) return { label: 'Без боя', tone: item.statusTone };
  if (item.statusTone === 'success') return { label: 'Победа', tone: 'success' };
  if (item.statusTone === 'danger') return { label: 'Поражение', tone: 'danger' };
  if (viewModel.winner === 'draw') return { label: 'Ничья', tone: 'warning' };
  return { label: viewModel.winner === 'attacker' ? 'Атака' : 'Оборона', tone: 'info' };
}

function roundFacts(viewModel: BattleReportViewModel): ReportRound[] {
  return viewModel.rounds.map((round) => {
    const summary = round.summary;
    const facts: ReportFact[] = [];
    if (summary?.attackerDamage != null) facts.push({ label: 'Урон атакующего', value: number.format(summary.attackerDamage) });
    if (summary?.defenderDamage != null) facts.push({ label: 'Урон защитника', value: number.format(summary.defenderDamage) });
    if (summary?.destroyedUnits != null) facts.push({ label: 'Уничтожено единиц', value: number.format(summary.destroyedUnits) });
    const left = summary?.survivingPopulation;
    if (left && left.attacker != null && left.defender != null) facts.push({ label: 'Осталось населения', value: `${number.format(left.attacker)} / ${number.format(left.defender)}` });
    if (!facts.length) facts.push({ label: 'Событий', value: number.format(round.events.length) });
    return { index: round.index, facts };
  });
}

function battleSheet(item: ReportItem, viewModel: BattleReportViewModel): ReportSheet {
  const outcome = (side: 'attacker' | 'defender') => viewModel.winner === 'draw' ? 'draw' as const : viewModel.winner === side ? 'winner' as const : 'loser' as const;
  const sides = [battleSide(viewModel.attacker, outcome('attacker')), battleSide(viewModel.defender, outcome('defender'))];
  const fleets = (side: BattleSideViewModel, role: string): ReportUnitGroup => {
    const units = [...side.ships, ...side.commanders].map(battleUnit);
    return {
      key: `fleet-${side.participant.side}`,
      title: role,
      units,
      total: side.losses.ships != null ? `потеряно ${number.format(side.losses.ships)}` : undefined,
      empty: 'Кораблей не было.',
    };
  };
  const defences = [viewModel.attacker, viewModel.defender]
    .filter((side) => side.defenses.length)
    .map((side): ReportUnitGroup => ({
      key: `defense-${side.participant.side}`,
      title: side.participant.side === 'attacker' ? 'Атакующий' : 'Защитник',
      units: side.defenses.map(battleUnit),
      total: side.losses.defenses != null ? `потеряно ${number.format(side.losses.defenses)}` : undefined,
    }));
  const resources: ReportResourceGroup[] = [];
  if (viewModel.resources.length) resources.push({ key: 'loot', title: 'Добыча', items: viewModel.resources.map((resource) => ({ kind: resource.kind, label: resource.label, value: resource.value })), tone: 'gain' });
  if (viewModel.debrisOnOrbit != null) resources.push({ key: 'debris', title: 'Обломки на орбите', items: [{ kind: 'debris', label: 'Обломки', value: viewModel.debrisOnOrbit }] });
  const details: ReportFact[] = [
    { label: 'Раундов', value: number.format(viewModel.roundCount) },
    ...(viewModel.experience != null ? [{ label: 'Опыт', value: number.format(viewModel.experience) }] : []),
    ...(viewModel.siege?.planetDestroyed ? [{ label: 'Планета цели', value: 'Уничтожена' }] : []),
    ...item.details.filter((detail) => detail.label === 'Операция' || detail.label === 'Локация'),
  ];
  const target = viewModel.defender.participant;
  const debrisCoordinate = parseReportCoordinate(target.coordinates);
  const noCombat = !viewModel.roundCount;
  return {
    kind: 'battle',
    typeLabel: item.typeLabel,
    title: item.title,
    // The blocks carry the numbers; only a battle without a fight needs a sentence.
    summary: noCombat ? item.preview : '',
    time: item.timestamp,
    place: { name: target.planetName ?? target.playerName, coordinate: parseReportCoordinate(target.coordinates), ownerId: target.playerId ?? undefined },
    result: battleResult(item, viewModel),
    sides,
    ships: [fleets(viewModel.attacker, 'Атакующий'), fleets(viewModel.defender, 'Защитник')],
    resources,
    assets: defences,
    details,
    sections: [
      { title: 'Бонусы атакующего', facts: battleBonuses(viewModel.attacker) },
      { title: 'Бонусы защитника', facts: battleBonuses(viewModel.defender) },
    ].filter((section) => section.facts.length),
    rounds: roundFacts(viewModel),
    actions: [
      // Owner journal: most attacks are followed by recyclers to the same point.
      ...(viewModel.debrisOnOrbit && viewModel.debrisOnOrbit > 0 && debrisCoordinate
        ? [{ kind: 'collect_debris' as const, label: 'Собрать обломки', primary: true, coordinate: debrisCoordinate }] : []),
      { kind: 'open_battle', label: 'Ход боя', primary: true },
    ],
  };
}

// ---------------------------------------------------------------- espionage

const NOT_REVEALED = 'Не раскрыто: зонду не хватило уровня шпионажа.';

function spyUnits(report: SpyReportSnapshot, values: Partial<Record<string, number>> | undefined, skip?: string): ReportUnit[] {
  return Object.entries(values ?? {})
    .filter(([id, count]) => id !== skip && Number(count) > 0)
    .map(([id, count]) => {
      const unit = entity(report.targetRaceId, id);
      const level = report.fleetLevels?.[id as ShipId];
      return { key: id, name: unit?.name ?? 'Неизвестный корабль', art: unit?.art, note: level !== undefined ? `Уровень ${level}` : unit?.role, count: Number(count) };
    });
}

function spySheet(item: ReportItem, report: SpyReportSnapshot): ReportSheet {
  const full = report.quality === 'full';
  const commanders: ReportUnit[] = Object.entries(report.commanders ?? {})
    .filter(([, value]) => Boolean(value))
    .map(([id, value]) => {
      const unit = entity(report.targetRaceId, id);
      const level = value?.level ?? 0;
      const definition = COMMANDER_ABILITIES[id as CommanderId];
      const ability = definition ? getCommanderPresentedAbility(id as CommanderId) : undefined;
      return {
        key: id,
        name: definition?.commanderName ?? unit?.name ?? 'Командир',
        art: unit?.art,
        note: `Уровень ${level}`,
        count: value?.count ?? 0,
        ...(ability ? { ability: { title: ability.ability, body: ability.description, effect: formatCommanderPresentedEffect(id as CommanderId, level), ...(ability.note ? { note: ability.note } : {}) } } : {}),
      };
    });
  const ships: ReportUnitGroup[] = full
    ? [
      { key: 'fleet', title: 'Флот', units: spyUnits(report, report.fleet, 'spy-probe'), empty: 'Кораблей на орбите нет.' },
      ...(commanders.length ? [{ key: 'commanders', title: 'Командиры', units: commanders }] : []),
    ]
    : [{ key: 'fleet', title: 'Флот', units: [], hidden: true, empty: NOT_REVEALED }];
  const resources: ReportResourceGroup[] = [{
    key: 'stock',
    title: 'На планете',
    items: [
      { kind: 'metal', label: 'Металл', value: report.resources.metal },
      { kind: 'minerals', label: 'Минералы', value: report.resources.minerals },
      { kind: 'gas', label: 'Газ', value: report.resources.gas },
      { kind: 'energy', label: 'Энергия', value: report.resources.developmentEnergy },
    ],
  }];
  if (report.resources.debris > 0) resources.push({ key: 'debris', title: 'Обломки на орбите', items: [{ kind: 'debris', label: 'Обломки', value: report.resources.debris }] });
  const assets: ReportUnitGroup[] = [report.quality === 'basic'
    ? { key: 'defense', title: 'Оборона', units: [], hidden: true, empty: NOT_REVEALED }
    : { key: 'defense', title: 'Оборона', units: spyUnits(report, report.defense), empty: 'Обороны нет.' }];
  const qualityWord = full ? 'Полный' : report.quality === 'detailed' ? 'Подробный' : 'Базовый';
  return {
    kind: 'spy',
    typeLabel: item.typeLabel,
    title: item.title,
    summary: '',
    time: item.timestamp,
    place: { name: report.targetPlanetName, coordinate: report.targetCoordinate, planetId: report.targetPlanetId, ownerId: report.targetOwnerId },
    result: { label: qualityWord, tone: item.statusTone },
    sides: [{
      key: 'target',
      role: 'Владелец',
      name: report.targetOwnerName,
      meta: `${getCombatFactionName(report.targetRaceId)} · ${report.targetRelation === 'enemy' ? 'враг' : 'нейтральный'}`,
      place: { name: report.targetPlanetName, coordinate: report.targetCoordinate, planetId: report.targetPlanetId, ownerId: report.targetOwnerId },
      portrait: { kind: 'faction', factionId: report.targetRaceId },
      facts: report.population ? [
        { label: 'Население', value: number.format(report.population.total) },
        { label: 'Экипажи флота', value: number.format(report.population.fleet) },
        { label: 'Гарнизоны обороны', value: number.format(report.population.defense) },
      ] : [],
    }],
    ships,
    resources,
    assets,
    details: [
      { label: 'Полнота снимка', value: qualityWord },
      { label: 'Отношение', value: report.targetRelation === 'enemy' ? 'Враг' : 'Нейтральный' },
      { label: 'Передан', value: at(report.createdAt) },
    ],
    rounds: [],
    // Owner journal: he attacks after spying; the simulator takes the same snapshot.
    actions: [
      ...(report.quality === 'basic' ? [] : [{ kind: 'simulate_battle' as const, label: 'Моделировать бой', primary: false }]),
      { kind: 'attack_target', label: 'Атаковать', primary: true },
    ],
  };
}

// ---------------------------------------------------------------- overpopulation

function overpopulationSheet(item: ReportItem, report: OverpopulationEpisodeReport): ReportSheet {
  const removed = report.removedShips.reduce((total, loss) => total + loss.count, 0);
  return {
    kind: 'overpopulation',
    typeLabel: item.typeLabel,
    title: item.title,
    summary: removed ? 'Перенаселение закончилось: часть кораблей и спутников потеряна, планета снова работает.' : 'Перенаселение закончилось без потерь, планета снова работает.',
    time: item.timestamp,
    place: { name: report.planetName, planetId: report.planetId },
    result: removed ? { label: 'Потери', tone: 'danger' } : { label: 'Без потерь', tone: 'success' },
    sides: [{
      key: 'planet',
      role: 'Планета',
      name: report.planetName,
      meta: getCombatFactionName(report.factionId),
      portrait: { kind: 'faction', factionId: report.factionId },
      population: { before: report.populationBefore, after: report.populationAfter },
      facts: [{ label: 'Вместимость', value: number.format(report.capacity) }],
    }],
    ships: [{
      key: 'overpopulation-loss',
      title: 'Уничтожено',
      tone: 'loss',
      total: `${number.format(removed)} ед.`,
      units: report.removedShips.map((loss) => {
        const unit = entity(report.factionId, loss.shipId);
        return { key: loss.shipId, name: unit?.name ?? 'Корабль', art: unit?.art, note: unit?.role, count: loss.count };
      }),
      empty: 'Потерь нет.',
    }],
    resources: [],
    assets: [],
    details: [
      { label: 'Начало перенаселения', value: at(report.episodeStartedAt) },
      { label: 'Планета разблокирована', value: at(report.episodeEndedAt) },
    ],
    rounds: [],
    actions: [],
  };
}

// ---------------------------------------------------------------- pirates

const pirateArtByName = new Map(PIRATE_BASE_SHIPS.map(({ name, art }) => [name, art] as const));

function pirateReconSheet(item: ReportItem): ReportSheet {
  const report = item.pirateReconReport!;
  const success = report.outcome === 'success' && report.intel;
  return {
    kind: 'pirate-recon',
    typeLabel: item.typeLabel,
    title: item.title,
    summary: success ? '' : item.body,
    time: item.timestamp,
    place: { name: 'Пиратская база', coordinate: report.coordinate, pirateContactKey: report.contactCycleKey },
    result: report.outcome === 'success' ? { label: 'Разведано', tone: 'success' } : report.outcome === 'failure' ? { label: 'Провал', tone: 'danger' } : { label: 'Пусто', tone: 'warning' },
    sides: success ? [{ key: 'pirates', role: 'Цель', name: 'Пиратская база', portrait: { kind: 'pirate' }, facts: [{ label: 'Уровень кораблей', value: number.format(report.intel!.shipLevel) }] }] : [],
    ships: [success
      ? { key: 'pirate-composition', title: 'Состав по населению', units: report.intel!.ships.map((ship) => ({ key: ship.name, name: ship.name, art: pirateArtByName.get(ship.name), percent: ship.populationPercent })) }
      : { key: 'pirate-composition', title: 'Состав', units: [], hidden: true, empty: report.outcome === 'failure' ? 'Сведения не получены.' : 'Цели на месте не было.' }],
    resources: [],
    assets: [],
    details: [
      { label: 'Отправление', value: at(report.dispatchedAt) },
      { label: 'Прибытие', value: at(report.arrivedAt) },
    ],
    rounds: [],
    actions: [],
  };
}

// ---------------------------------------------------------------- letters

/** The sender's portrait: alliance crest, the bot's general / race portrait, or an initial. Shared by the list and the open letter. */
export function letterSenderPortrait(sender: PersonalLetter['sender']): ReportPortrait {
  if (sender.kind === 'alliance') return sender.allianceId ? { kind: 'crest', allianceId: sender.allianceId } : { kind: 'initial', text: sender.name.slice(0, 1) };
  return sender.factionId ? { kind: 'faction', factionId: sender.factionId } : { kind: 'initial', text: sender.name.slice(0, 1) };
}

function letterSheet(item: ReportItem, letter: PersonalLetter): ReportSheet {
  const sender = letter.sender;
  const side: ReportSide = sender.kind === 'alliance'
    ? { key: 'sender', role: 'Союз', name: sender.name, meta: sender.tag ? `Союз [${sender.tag}]` : 'Союз', portrait: letterSenderPortrait(sender) }
    : {
      key: 'sender',
      role: 'Игрок',
      name: sender.name,
      meta: sender.alliance ? `[${sender.alliance.tag}] ${sender.alliance.name}` : 'Без союза',
      portrait: letterSenderPortrait(sender),
    };
  const attacker = letter.attacker;
  const sides: ReportSide[] = [side, ...(attacker ? [{
    key: 'attacker',
    role: 'Кто нападает',
    name: attacker.name,
    portrait: attacker.factionId ? { kind: 'faction', factionId: attacker.factionId } as const : attacker.ownerId ? { kind: 'initial', text: attacker.name.slice(0, 1) } as const : { kind: 'pirate' } as const,
  }] : [])];
  const answers = letter.answers.slice(0, 2);
  const primaryIndex = Math.max(0, answers.findIndex((answer) => answer.primary));
  return {
    kind: 'letter',
    typeLabel: item.typeLabel,
    title: letter.subject,
    summary: letter.text,
    time: item.timestamp,
    place: letter.place ?? null,
    result: letter.result,
    sides,
    ships: [],
    resources: [],
    assets: [],
    details: [],
    rounds: [],
    actions: answers.map((answer, index) => ({ kind: answer.kind, label: answer.label, primary: index === primaryIndex })),
    letter,
  };
}

// ---------------------------------------------------------------- everything else

const TECHNICAL_VALUE = /flight-|recon:|unique:|anomaly:|contact-|\d{9,}/i;

function firstWord(label: string) {
  const word = label.trim().split(/\s+/)[0] ?? '';
  return word ? word[0]!.toLocaleUpperCase('ru-RU') + word.slice(1).toLocaleLowerCase('ru-RU') : 'Готово';
}

function sheetKind(item: ReportItem): ReportSheetKind {
  if (item.spyHunterNotice) return 'spy-lost';
  if (item.source === 'recycling') return 'recycling';
  if (item.source === 'gas-extraction') return 'gas';
  if (item.source === 'pirate-mission') return 'pirate-absence';
  if (item.id.startsWith('exploration-recon:')) return 'exploration-recon';
  if (item.id.startsWith('exploration-return:')) return 'expedition';
  if (item.id.startsWith('flight-landing:')) return 'flight';
  return 'other';
}

function blockSheet(item: ReportItem): ReportSheet {
  const blocks = item.blocks ?? {};
  const coordinate = parseReportCoordinate(item.coordinates[0]);
  const place = blocks.place ?? (coordinate || item.planetNames[0] ? { name: item.planetNames[0], coordinate } : null);
  const details = blocks.details ?? item.details.filter((detail) => detail.value && !TECHNICAL_VALUE.test(detail.value));
  const notice = item.spyHunterNotice;
  return {
    kind: sheetKind(item),
    typeLabel: item.typeLabel,
    title: item.title,
    summary: blocks.summary ?? item.body,
    time: item.timestamp,
    place: notice ? { name: notice.targetPlanetName, coordinate: notice.targetCoordinate, planetId: notice.targetPlanetId } : place,
    result: blocks.result ?? (notice ? { label: 'Потерян', tone: 'danger' } : { label: firstWord(item.statusLabel), tone: item.statusTone }),
    sides: blocks.sides ?? (notice ? [{ key: 'hunter', role: 'Охотник', name: notice.targetOwnerName, meta: `Уровень охотника ${notice.hunterLevel}` }] : []),
    ships: blocks.ships ?? [],
    resources: blocks.resources ?? [],
    assets: blocks.assets ?? [],
    details: notice ? [] : details,
    rounds: [],
    actions: [],
  };
}

function itemActions(item: ReportItem, context: ReportSheetContext): ReportSheetAction[] {
  const actions: ReportSheetAction[] = [];
  if (item.flightId && context.canRepeatFlight?.(item.flightId)) actions.push({ kind: 'repeat_flight', label: 'Повторить полёт', primary: true, flightId: item.flightId });
  if (item.action?.kind === 'simulate_battle' && item.spyReport) actions.push({ kind: 'simulate_battle', label: 'Моделировать сражение', primary: false });
  if (item.action?.kind === 'open_fleets') actions.push({ kind: 'open_fleets', label: 'Открыть флоты', primary: true });
  if (item.secondaryAction?.kind === 'recall_spy' && item.secondaryAction.missionId) actions.push({ kind: 'recall_spy', label: 'Вернуть шпиона', primary: false, missionId: item.secondaryAction.missionId });
  return actions;
}

const MAP_KINDS: ReadonlySet<ReportSheetKind> = new Set(['recycling', 'gas', 'exploration-recon', 'expedition', 'flight', 'pirate-recon', 'pirate-absence']);

/** One sheet for any report: header, shared blocks, footer actions (at most one primary). */
export function buildReportSheet(item: ReportItem, battle?: BattleReportViewModel | null, context: ReportSheetContext = {}): ReportSheet {
  const sheet = item.letter
    ? letterSheet(item, item.letter)
    : battle && item.battleReportId
      ? battleSheet(item, battle)
      : item.spyReport
        ? spySheet(item, item.spyReport)
        : item.overpopulationReport
          ? overpopulationSheet(item, item.overpopulationReport)
          : item.pirateReconReport
            ? pirateReconSheet(item)
            : blockSheet(item);
  const coordinate = sheet.place?.coordinate;
  const mapAction: ReportSheetAction[] = MAP_KINDS.has(sheet.kind) && coordinate ? [{ kind: 'show_on_map', label: 'Показать на карте', primary: false, coordinate }] : [];
  const seen = new Set<ReportSheetActionKind>();
  const actions = [...sheet.actions, ...itemActions(item, context), ...mapAction].filter((action) => {
    if (seen.has(action.kind)) return false;
    seen.add(action.kind);
    return true;
  });
  let primarySeen = false;
  return {
    ...sheet,
    title: titleWithoutPlace(sheet.title, sheet.place),
    actions: actions.map((action) => {
      const primary = action.primary && !primarySeen;
      if (primary) primarySeen = true;
      return { ...action, primary };
    }),
  };
}

/**
 * The place is the line under the title: «Победа при атаке Кассиопея» over
 * «Кассиопея [1:40:24]» says it twice. The title keeps what happened.
 */
export function titleWithoutPlace(title: string, place: ReportPlace | null): string {
  let next = title.trim();
  const cut = (tail: string) => {
    if (tail && next.length > tail.length && next.toLocaleLowerCase('ru-RU').endsWith(tail.toLocaleLowerCase('ru-RU'))) next = next.slice(0, -tail.length).trim();
  };
  if (place?.coordinate) cut(formatReportCoordinate(place.coordinate));
  if (place?.name) cut(place.name);
  next = next.replace(/\s+(к|по|у)\s+координатам$/u, '').replace(/[:\s]+$/u, '').replace(/\s+(за|при)$/u, (match) => match.trim() === 'за' ? '' : match).trim();
  return next || title;
}

/** «3 раунда», «1 раунд», «6 раундов». */
export function roundsLabel(count: number) {
  return `${number.format(count)} ${plural(count, 'раунд', 'раунда', 'раундов')}`;
}
