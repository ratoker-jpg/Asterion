import type { BattleReport, BattleSide } from '../combat/report.ts';
import { getBattleResultForPlayer } from '../combat/report.ts';
import { NON_COMBAT_REPORT_FIXTURES } from './catalog.ts';
import type {
  BattlePerspective,
  BattleRewardEntry,
  ReportCategoryCounts,
  ReportItem,
  ReportQuery,
  ReportsState,
  ReportUnreadCounts,
} from './types.ts';

export const ASTERION_LOCAL_PLAYER_ID = 'player-aster';

const CATEGORY_TYPE_LABEL: Record<ReportItem['category'], string> = {
  battle: 'Боевой отчёт',
  flights: 'Полёт',
  recon: 'Разведка',
  economy: 'Экономика',
  construction: 'Строительство',
  diplomacy: 'Дипломатия',
  system: 'Системный',
  inbox: 'Входящее сообщение',
};

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

function battleTitle(report: BattleReport) {
  const side = localSide(report);
  const target = battleTargetName(report, side);
  const result = getBattleResultForPlayer(report, ASTERION_LOCAL_PLAYER_ID);

  if (!side) return `Бой: ${report.attacker.playerName} → ${report.defender.playerName}`;
  if (result === 'draw') return `Ничья: бой за ${target}`;
  if (side === 'attacker') return `${result === 'victory' ? 'Победа' : 'Поражение'} при атаке ${target}`;
  return `${result === 'victory' ? 'Победа' : 'Поражение'} при обороне ${target}`;
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

function battlePreview(report: BattleReport) {
  const side = localSide(report);
  const result = getBattleResultForPlayer(report, ASTERION_LOCAL_PLAYER_ID);
  if (!side) return `Бой завершён за ${report.roundCount} раундов. Открыть боевой журнал.`;
  if (result === 'victory') return `Бой завершён победой за ${report.roundCount} раундов. Потери зафиксированы в журнале.`;
  if (result === 'defeat') return `Бой завершён поражением за ${report.roundCount} раундов. Потери зафиксированы в журнале.`;
  return `Бой завершён ничьей за ${report.roundCount} раундов.`;
}

export function battleReportToReportItem(report: BattleReport): ReportItem {
  const status = battleStatus(report);
  const coordinates = [report.attacker.coordinates, report.defender.coordinates].filter((value): value is string => Boolean(value));
  const planetNames = [report.attacker.planetName, report.defender.planetName].filter((value): value is string => Boolean(value));
  return {
    id: report.id,
    source: 'combat',
    category: 'battle',
    typeLabel: CATEGORY_TYPE_LABEL.battle,
    title: battleTitle(report),
    preview: battlePreview(report),
    body: `Боевой журнал ${report.attacker.playerName} против ${report.defender.playerName}. Источник истины — существующий BattleReport.`,
    timestamp: report.timestamp,
    statusLabel: status.label,
    statusTone: status.tone,
    participantNames: [report.attacker.playerName, report.defender.playerName],
    planetNames,
    coordinates,
    details: [
      { label: 'Миссия', value: report.missionType },
      { label: 'Раундов', value: String(report.roundCount) },
      { label: 'Атакующий', value: report.attacker.playerName },
      { label: 'Защитник', value: report.defender.playerName },
    ],
    battleReportId: report.id,
  };
}

export function buildReportsFeed(
  battleReports: readonly BattleReport[],
  fixtures: readonly ReportItem[] = NON_COMBAT_REPORT_FIXTURES,
): ReportItem[] {
  return [
    ...battleReports.map(battleReportToReportItem),
    ...fixtures.map((item) => ({
      ...item,
      participantNames: [...item.participantNames],
      planetNames: [...item.planetNames],
      coordinates: [...item.coordinates],
      details: item.details.map((detail) => ({ ...detail })),
    })),
  ].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
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
  ].join(' ').toLocaleLowerCase('ru-RU');
}

export function filterReportItems(items: readonly ReportItem[], state: ReportsState, query: ReportQuery) {
  const archived = new Set(state.archivedIds);
  const read = new Set(state.readIds);
  const favorites = new Set(state.favoriteIds);
  const needle = query.search.trim().toLocaleLowerCase('ru-RU');

  return items.filter((item) => {
    const isArchived = archived.has(item.id);
    if (query.category === 'archive') {
      if (!isArchived) return false;
    } else {
      if (isArchived) return false;
      if (query.category !== 'all' && item.category !== query.category) return false;
    }
    if (query.filter === 'unread' && read.has(item.id)) return false;
    if (query.filter === 'favorite' && !favorites.has(item.id)) return false;
    if (needle && !searchableText(item).includes(needle)) return false;
    return true;
  });
}

export function getReportCategoryCounts(items: readonly ReportItem[], state: ReportsState): ReportCategoryCounts {
  const archived = new Set(state.archivedIds);
  const counts: ReportCategoryCounts = {
    all: 0,
    battle: 0,
    flights: 0,
    recon: 0,
    economy: 0,
    construction: 0,
    diplomacy: 0,
    system: 0,
    inbox: 0,
    archive: 0,
  };
  items.forEach((item) => {
    if (archived.has(item.id)) {
      counts.archive += 1;
      return;
    }
    counts.all += 1;
    counts[item.category] += 1;
  });
  return counts;
}

export function getReportUnreadCounts(items: readonly ReportItem[], state: ReportsState): ReportUnreadCounts {
  const archived = new Set(state.archivedIds);
  const read = new Set(state.readIds);
  const counts: ReportUnreadCounts = {
    all: 0,
    battle: 0,
    flights: 0,
    recon: 0,
    economy: 0,
    construction: 0,
    diplomacy: 0,
    system: 0,
    inbox: 0,
    archive: 0,
  };
  items.forEach((item) => {
    if (read.has(item.id)) return;
    if (archived.has(item.id)) {
      counts.archive += 1;
      return;
    }
    counts.all += 1;
    counts[item.category] += 1;
  });
  return counts;
}

export function getBattlePerspective(report: BattleReport): BattlePerspective {
  const playerSide = localSide(report);
  if (!playerSide) {
    return {
      localSide: null,
      leftSide: 'attacker',
      rightSide: 'defender',
      leftLabel: 'АТАКУЮЩИЙ',
      rightLabel: 'ЗАЩИТНИК',
    };
  }
  const otherSide: BattleSide = playerSide === 'attacker' ? 'defender' : 'attacker';
  return {
    localSide: playerSide,
    leftSide: playerSide,
    rightSide: otherSide,
    leftLabel: 'ВАШИ СИЛЫ',
    rightLabel: 'СИЛЫ ПРОТИВНИКА',
  };
}

export function getBattleRewardEntries(report: BattleReport): BattleRewardEntry[] {
  const entries: BattleRewardEntry[] = [];
  if (report.resources?.metal != null) entries.push({ key: 'metal', label: 'МЕТАЛЛ', value: report.resources.metal });
  if (report.resources?.minerals != null) entries.push({ key: 'minerals', label: 'МИНЕРАЛЫ', value: report.resources.minerals });
  if (report.resources?.gas != null) entries.push({ key: 'gas', label: 'ГАЗ', value: report.resources.gas });
  if (report.experience != null) entries.push({ key: 'experience', label: 'ОПЫТ', value: report.experience });
  if (report.debris != null) entries.push({ key: 'debris', label: 'ОБЛОМКИ', value: report.debris });
  return entries;
}

export function findBattleReport(battleReports: readonly BattleReport[], reportItem: ReportItem | null) {
  if (!reportItem?.battleReportId) return null;
  return battleReports.find((report) => report.id === reportItem.battleReportId) ?? null;
}

export function reportTypeLabel(category: ReportItem['category']) {
  return CATEGORY_TYPE_LABEL[category];
}