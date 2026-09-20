import {
  ASTERION_LOCAL_PLAYER_ID,
  getBattleResultForPlayer,
  type BattleReport,
  type BattleSide,
} from '../combat/report.ts';
import type { CommandState, JointOperation } from '../command/types.ts';
import type { OperationInstance, OperationsState } from '../operations/types.ts';
import type {
  ReportCategoryCounts,
  ReportItem,
  ReportQuery,
  ReportsState,
  ReportUnreadCounts,
} from './types.ts';
import type { EspionageState, SpyHunterNotice, SpyReportSnapshot } from '../espionage/types.ts';

const CATEGORY_TYPE_LABEL: Record<ReportItem['category'], string> = {
  system: 'Система',
  battle: 'Боевой доклад',
  command: 'Командный доклад',
  arena: 'Арена',
  flights: 'Полёт',
  alliances: 'Союз',
  achievements: 'Достижение',
};

const EMPTY_COUNTS = (): ReportCategoryCounts => ({
  system: 0,
  battle: 0,
  command: 0,
  arena: 0,
  flights: 0,
  alliances: 0,
  achievements: 0,
});

function localSide(report: BattleReport): BattleSide | null {
  if (report.attacker.playerId === ASTERION_LOCAL_PLAYER_ID) return 'attacker';
  if (report.defender.playerId === ASTERION_LOCAL_PLAYER_ID) return 'defender';
  return null;
}

function battleTargetName(report: BattleReport, side: BattleSide | null) {
  if (side === 'attacker') return report.defender.planetName ?? report.defender.playerName;
  if (side === 'defender') return report.defender.planetName ?? report.attacker.planetName ?? report.attacker.playerName;
  return report.defender.planetName ?? report.defender.playerName;
}

function battleStatus(report: BattleReport) {
  const side = localSide(report);
  const result = getBattleResultForPlayer(report, ASTERION_LOCAL_PLAYER_ID);
  if (side) {
    if (result === 'victory') return { label: 'ПОБЕДА', tone: 'success' as const };
    if (result === 'defeat') return { label: 'ПОРАЖЕНИЕ', tone: 'danger' as const };
    return { label: 'НИЧЬЯ', tone: 'warning' as const };
  }
  if (report.winner === 'draw') return { label: 'НИЧЬЯ', tone: 'warning' as const };
  return report.winner === 'attacker'
    ? { label: 'ПОБЕДА АТАКУЮЩЕГО', tone: 'info' as const }
    : { label: 'ПОБЕДА ЗАЩИТНИКА', tone: 'info' as const };
}

function operationLocationLabel(operation: OperationInstance) {
  if (operation.location.kind === 'coordinates') return operation.location.coordinates;
  if (operation.location.kind === 'system') return `[${operation.location.galaxy}:${operation.location.system}]`;
  return operation.location.label;
}

function battleTitle(report: BattleReport, operation?: OperationInstance) {
  if (operation) return `Операция: ${operation.title}`;
  const side = localSide(report);
  const target = battleTargetName(report, side);
  const result = getBattleResultForPlayer(report, ASTERION_LOCAL_PLAYER_ID);
  if (!side) return `Бой: ${report.attacker.playerName} → ${report.defender.playerName}`;
  if (result === 'draw') return `Ничья: бой за ${target}`;
  if (side === 'attacker') return `${result === 'victory' ? 'Победа' : 'Поражение'} при атаке ${target}`;
  return `${result === 'victory' ? 'Победа' : 'Поражение'} при обороне ${target}`;
}

export function battleReportToReportItem(report: BattleReport, operation?: OperationInstance): ReportItem {
  const status = battleStatus(report);
  const coordinates = [report.attacker.coordinates, report.defender.coordinates].filter((value): value is string => Boolean(value));
  const planetNames = [report.attacker.planetName, report.defender.planetName].filter((value): value is string => Boolean(value));
  return {
    id: `battle:${report.id}`,
    source: 'combat',
    category: 'battle',
    typeLabel: operation ? 'Доклад операции' : CATEGORY_TYPE_LABEL.battle,
    title: battleTitle(report, operation),
    preview: operation
      ? `${operation.objective.label}. Бой завершён за ${report.roundCount} раундов.`
      : `Бой завершён за ${report.roundCount} раундов. Откройте полный журнал боя.`,
    body: operation
      ? `Боевой результат операции «${operation.title}» связан с каноническим BattleReport ${report.id}.`
      : `Боевой журнал ${report.attacker.playerName} против ${report.defender.playerName}.`,
    timestamp: report.timestamp,
    statusLabel: status.label,
    statusTone: status.tone,
    participantNames: [report.attacker.playerName, report.defender.playerName],
    planetNames,
    coordinates,
    details: [
      { label: 'Раундов', value: String(report.roundCount) },
      { label: 'Атакующий', value: report.attacker.playerName },
      { label: 'Защитник', value: report.defender.playerName },
      ...(operation ? [{ label: 'Операция', value: operation.title }, { label: 'Локация', value: operationLocationLabel(operation) }] : []),
    ],
    battleReportId: report.id,
    operationId: operation?.id,
  };
}

export function operationIntelToReportItem(operation: OperationInstance): ReportItem | null {
  if (!operation.originSignalId || operation.intel <= 0) return null;
  const location = operationLocationLabel(operation);
  return {
    id: `system:operation:${operation.id}`,
    source: 'operations',
    category: 'system',
    typeLabel: 'Информация операции',
    title: `Сигнал классифицирован: ${operation.title}`,
    preview: `${location} · разведданные уровня ${operation.intel}.`,
    body: operation.briefing,
    statusLabel: 'ДАННЫЕ ПОЛУЧЕНЫ',
    statusTone: 'info',
    participantNames: [],
    planetNames: [],
    coordinates: operation.location.kind === 'coordinates' ? [operation.location.coordinates] : [],
    details: [
      { label: 'Локация', value: location },
      { label: 'Разведданные', value: `${operation.intel} / 3` },
      { label: 'Цель', value: operation.objective.label },
      { label: 'Источник сигнала', value: operation.originSignalId },
    ],
    operationId: operation.id,
  };
}

function allianceStatus(operation: JointOperation) {
  if (operation.state === 'mustering') return { label: 'СБОР СИЛ', tone: 'warning' as const };
  if (operation.state === 'awaiting') return { label: 'ОЖИДАЕТ УЧАСТНИКОВ', tone: 'info' as const };
  return { label: 'ПОДГОТОВКА', tone: 'info' as const };
}

export function allianceOperationToReportItem(operation: JointOperation): ReportItem | null {
  if (operation.joinedByPlayer || !['preparing', 'mustering', 'awaiting'].includes(operation.state)) return null;
  const status = allianceStatus(operation);
  return {
    id: `alliance:operation:${operation.id}`,
    source: 'command',
    category: 'alliances',
    typeLabel: operation.kind === 'sun_raid' ? 'Совместная атака на Солнце' : 'Совместная операция',
    title: `Присоединиться: ${operation.title}`,
    preview: `${operation.windowLabel} · ${operation.participants}/${operation.recommendedParticipants} участников.`,
    body: operation.description,
    statusLabel: status.label,
    statusTone: status.tone,
    participantNames: [],
    planetNames: [],
    coordinates: [],
    details: [
      { label: 'Цель', value: operation.objective },
      { label: 'Участники', value: `${operation.participants} / ${operation.recommendedParticipants}` },
      { label: 'Окно', value: operation.windowLabel },
    ],
    commandOperationId: operation.id,
    action: { kind: 'open_fleets', label: 'ПЕРЕЙТИ К ФЛОТАМ' },
  };
}

function spyQualityLabel(report: SpyReportSnapshot) {
  return report.quality === 'full' ? 'ПОЛНЫЙ СНИМОК' : report.quality === 'detailed' ? 'ДЕТАЛЬНЫЙ СНИМОК' : 'БАЗОВЫЙ СНИМОК';
}

function spyReportTitleLabel(report: SpyReportSnapshot) {
  return report.quality === 'full' ? 'Полный' : report.quality === 'detailed' ? 'Подробный' : 'Базовый';
}

function spyReportHasCombatIntel(report: SpyReportSnapshot) {
  const hasFleet = Object.entries(report.fleet ?? {}).some(([id, count]) => id !== 'spy-probe' && Number(count) > 0);
  const hasDefense = Object.values(report.defense ?? {}).some((count) => Number(count) > 0);
  const hasCombatCommander = Object.entries(report.commanders ?? {}).some(([id, value]) => id !== 'hunter' && Boolean(value) && value.count > 0);
  return hasFleet || hasDefense || hasCombatCommander;
}

export function spyReportToReportItem(report: SpyReportSnapshot, espionage?: EspionageState): ReportItem {
  const coordinates = `[${report.targetCoordinate.galaxy}:${report.targetCoordinate.system}:${report.targetCoordinate.position}]`;
  const mission = espionage?.missions.find((candidate) => candidate.id === report.missionId);
  return {
    id: `espionage:${report.id}`,
    source: 'espionage',
    category: 'system',
    typeLabel: `${spyReportTitleLabel(report)} шпионский отчёт`,
    title: `${spyReportTitleLabel(report)} шпионский отчёт: ${report.targetPlanetName}`,
    preview: `${spyQualityLabel(report)} · ${coordinates} · цель ${report.targetOwnerName}.`,
    body: report.quality === 'full'
      ? `Зонд передал полный снимок ${report.targetPlanetName}: ресурсы, население, флот и оборона цели.`
      : report.quality === 'detailed'
        ? `Зонд передал детальный снимок ${report.targetPlanetName}: ресурсы и оборона цели.`
        : `Зонд передал базовую оценку ${report.targetPlanetName}: доступны только общие ресурсы цели.`,
    timestamp: new Date(report.createdAt).toISOString(),
    statusLabel: spyQualityLabel(report),
    statusTone: report.quality === 'full' ? 'success' : report.quality === 'detailed' ? 'info' : 'neutral',
    participantNames: [report.targetOwnerName],
    planetNames: [report.targetPlanetName],
    coordinates: [coordinates],
    details: [
      { label: 'Владелец', value: report.targetOwnerName },
      { label: 'Отношение', value: report.targetRelation === 'enemy' ? 'Враг' : 'Нейтральный' },
      { label: 'Качество', value: spyQualityLabel(report) },
      ...(report.quality === 'full' && report.population ? [{ label: 'Население', value: `общее ${report.population.total} · флот ${report.population.fleet} · оборона ${report.population.defense}` }] : []),
    ],
    spyReport: report,
    action: report.quality === 'full' && spyReportHasCombatIntel(report) ? { kind: 'simulate_battle', label: 'МОДЕЛИРОВАТЬ СРАЖЕНИЕ' } : undefined,
    secondaryAction: mission?.status === 'orbiting' ? { kind: 'recall_spy', label: 'ВЕРНУТЬ ШПИОНА', missionId: mission.id } : undefined,
  };
}

export function spyHunterNoticeToReportItem(notice: SpyHunterNotice): ReportItem {
  const coordinates = `[${notice.targetCoordinate.galaxy}:${notice.targetCoordinate.system}:${notice.targetCoordinate.position}]`;
  return {
    id: `espionage:hunter:${notice.id}`,
    source: 'espionage',
    category: 'system',
    typeLabel: 'Контрразведка',
    title: `Зонд уничтожен: ${notice.targetPlanetName}`,
    preview: `Охотник ${notice.targetOwnerName} обнаружил шпионский зонд над целью.`,
    body: `Шпионский зонд был уничтожен на орбите ${notice.targetPlanetName}. Данные не переданы.`,
    timestamp: new Date(notice.createdAt).toISOString(),
    statusLabel: 'ЗОНД УНИЧТОЖЕН',
    statusTone: 'danger',
    participantNames: [notice.targetOwnerName],
    planetNames: [notice.targetPlanetName],
    coordinates: [coordinates],
    details: [
      { label: 'Цель', value: notice.targetPlanetName },
      { label: 'Охотник', value: `${notice.targetOwnerName} · уровень ${notice.hunterLevel}` },
      { label: 'Координаты', value: coordinates },
    ],
    spyHunterNotice: notice,
  };
}

export function buildReportsFeed(
  battleReports: readonly BattleReport[],
  operations: OperationsState,
  command: CommandState,
  espionage?: EspionageState,
): ReportItem[] {
  const operationByBattleId = new Map(
    operations.items
      .filter((operation): operation is OperationInstance & { battleReportId: string } => Boolean(operation.battleReportId))
      .map((operation) => [operation.battleReportId, operation]),
  );

  const battleItems = battleReports
    .filter((report) => report.missionType !== 'simulation' && report.missionType !== 'arena')
    .map((report) => battleReportToReportItem(report, operationByBattleId.get(report.id)));

  const systemItems = operations.items
    .map(operationIntelToReportItem)
    .filter((item): item is ReportItem => Boolean(item));

  const allianceItems = command.jointOperations
    .map(allianceOperationToReportItem)
    .filter((item): item is ReportItem => Boolean(item));

  const espionageItems = [
    ...(espionage?.reports ?? []).map((report) => spyReportToReportItem(report, espionage)),
    ...(espionage?.hunterNotices ?? []).map(spyHunterNoticeToReportItem),
  ];

  return [...battleItems, ...systemItems, ...allianceItems, ...espionageItems].sort((a, b) => {
    if (a.timestamp && b.timestamp) return Date.parse(b.timestamp) - Date.parse(a.timestamp);
    if (!a.timestamp && b.timestamp) return -1;
    if (a.timestamp && !b.timestamp) return 1;
    return a.id.localeCompare(b.id, 'ru');
  });
}

function searchableText(item: ReportItem) {
  return [
    item.title,
    item.preview,
    item.body,
    item.typeLabel,
    ...item.participantNames,
    ...item.planetNames,
    ...item.coordinates,
    ...item.details.flatMap((detail) => [detail.label, detail.value]),
  ].join(' ').toLocaleLowerCase('ru-RU');
}

export function filterReportItems(
  items: readonly ReportItem[],
  state: ReportsState,
  query: ReportQuery,
  savedBattleReportIds: readonly string[] = [],
) {
  const read = new Set(state.readIds);
  const saved = new Set(savedBattleReportIds);
  const needle = query.search.trim().toLocaleLowerCase('ru-RU');
  const hidden = new Set(state.hiddenIds);

  return items.filter((item) => {
    if (hidden.has(item.id)) return false;
    if (item.category !== query.category) return false;
    if (query.filter === 'unread' && read.has(item.id)) return false;
    if (query.filter === 'saved' && (!item.battleReportId || !saved.has(item.battleReportId))) return false;
    if (needle && !searchableText(item).includes(needle)) return false;
    return true;
  });
}

export function getVisibleReportItems(items: readonly ReportItem[], state: ReportsState): ReportItem[] {
  const hidden = new Set(state.hiddenIds);
  return items.filter((item) => !hidden.has(item.id));
}

export function getReportCategoryCounts(items: readonly ReportItem[], state?: ReportsState): ReportCategoryCounts {
  const counts = EMPTY_COUNTS();
  (state ? getVisibleReportItems(items, state) : items).forEach((item) => { counts[item.category] += 1; });
  return counts;
}

export function getReportUnreadCounts(items: readonly ReportItem[], state: ReportsState): ReportUnreadCounts {
  const counts = EMPTY_COUNTS() as ReportUnreadCounts;
  const read = new Set(state.readIds);
  getVisibleReportItems(items, state).forEach((item) => {
    if (!read.has(item.id)) counts[item.category] += 1;
  });
  return counts;
}

export function findBattleReport(battleReports: readonly BattleReport[], reportItem: ReportItem | null) {
  if (!reportItem?.battleReportId) return null;
  return battleReports.find((report) => report.id === reportItem.battleReportId) ?? null;
}

export function reportTypeLabel(category: ReportItem['category']) {
  return CATEGORY_TYPE_LABEL[category];
}
