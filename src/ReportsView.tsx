import { useEffect, useMemo, useRef, useState } from 'react';

import { SunReportStrip } from './ui/sun-raid/SunReportStrip.tsx';
import { BattleReportModal } from './BattleReportsView';
import { FactionGeneralPortrait } from './ui/FactionGeneralPortrait.tsx';
import { EMPTY_ART } from './ui/ui-art.ts';
import { EmblemGlyph } from './ui/command/EmblemGlyph.tsx';
import { ReportArtwork, ReportGlyph, ReportSheetView } from './ui/messages/ReportSheetView.tsx';
import { asterionAssetIntegrationAssets } from './assets/generated/asterionAssetIntegrationManifest.generated.ts';
import { isAsterionLocalPlayerId, type BattleReport } from './domain/combat/report.ts';
import { createBattleReportViewModel } from './domain/combat/battle-report-view-model.ts';
import type { CommandState } from './domain/command/types.ts';
import { selectOwnerMembership, toAllianceIdentity } from './domain/command/selectors.ts';
import type { OperationsState } from './domain/operations/types.ts';
import {
  buildReportsFeed,
  filterReportItems,
  findBattleReport,
  getReportCategoryCounts,
  getReportUnreadCounts,
  getVisibleReportItems,
  reportReadCheck,
  preservePersistentReportCollections,
  dropExpiredReportItems,
} from './domain/reports/adapters.ts';
import {
  deleteAllReports,
  deleteSelectedReports,
  markAllReportsRead,
  markReportRead,
} from './domain/reports/repository.ts';
import { buildReportSheet, type ReportSheetAction } from './domain/reports/sheet.ts';
import type { ReportCategory, ReportFilter, ReportItem, ReportsState } from './domain/reports/types.ts';
import type { PlayerProfileState } from './domain/profile/types.ts';
import { selectPlayerProfileMetrics } from './domain/profile/selectors.ts';
import type { PlayerProfileMetricKey } from './domain/profile/selectors.ts';
import type { OwnerScore } from './domain/rating/types.ts';
import type { RatingPrototypeState } from './domain/rating/fixtures.ts';
import { selectRecordedBattlePointAwards } from './domain/rating/scoring.ts';
import { RUNTIME_RESET_EVENT, type RuntimeMode } from './domain/runtime/mode.ts';
import type { SpyReportSnapshot } from './domain/espionage/types.ts';
import { getCombatFactionName } from './domain/combat/factions.ts';
import type { UniverseCoordinate } from './domain/universe/types.ts';
import type { PirateReconReport } from './domain/pirates/recon-report.ts';
import './ui/messages/messages.css';

const PAGE_SIZE = 7;
const numberFormat = new Intl.NumberFormat('ru-RU');

type MessageFolderId =
  | 'profile'
  | 'personal'
  | 'system'
  | 'battle'
  | 'command'
  | 'arena'
  | 'flights'
  | 'alliances'
  | 'achievements';

type MessageFolder = {
  id: Exclude<MessageFolderId, 'profile'>;
  label: string;
  glyph: ReportCategory;
  category?: ReportCategory;
  emptyTitle?: string;
  emptyBody?: string;
};

const MESSAGE_FOLDERS: readonly MessageFolder[] = [
  { id: 'personal', label: 'Личные', glyph: 'personal', category: 'personal' },
  { id: 'system', label: 'Система', glyph: 'system', category: 'system' },
  { id: 'battle', label: 'Доклады', glyph: 'battle', category: 'battle' },
  { id: 'command', label: 'Командные доклады', glyph: 'command', category: 'command' },
  { id: 'arena', label: 'Арена', glyph: 'arena', category: 'arena' },
  { id: 'flights', label: 'Полёты', glyph: 'flights', category: 'flights' },
  { id: 'alliances', label: 'Союзы', glyph: 'alliances', category: 'alliances' },
  { id: 'achievements', label: 'Достижения', glyph: 'achievements', category: 'achievements' },
];

const EMPTY_COPY: Record<ReportCategory, { title: string; body: string }> = {
  personal: { title: 'Личных писем пока нет', body: 'Сюда приходят письма лично вам: ответы союзов на ваши заявки и заявки в союз, которым вы управляете.' },
  system: { title: 'Системных данных пока нет', body: 'Сюда попадут шпионские отчёты, уведомления контрразведки и результаты операций, которые дают новую информацию.' },
  battle: { title: 'Боевых докладов пока нет', body: 'Здесь хранятся реальные боевые отчёты и бои из операций. Симуляции и Арена в этот канал не попадают.' },
  command: { title: 'Командных докладов пока нет', body: 'Здесь будут отчёты об атаках на союзников и результаты атак на Солнце, когда эти события появятся в боевом контуре.' },
  arena: { title: 'Арена — пока пусто', body: 'Отчёты и очки Арены появятся здесь вместе с реализацией самой Арены.' },
  flights: { title: 'Завершённых полётов пока нет', body: 'После подключения реальной отправки флотов сюда будут сохраняться завершённые рейсы, прибытия и возвраты флота на ваши планеты.' },
  alliances: { title: 'Союзных приглашений пока нет', body: 'Здесь появляются доступные совместные операции союза. Из приглашения можно сразу перейти к выбору флота.' },
  achievements: { title: 'Достижения — пока пусто', body: 'Этот канал зарезервирован под будущую систему достижений.' },
};

const FILTER_LABELS: Record<ReportFilter, string> = {
  all: 'Все',
  unread: 'Непрочитанные',
  saved: 'Сохранённые бои',
};

function formatDate(timestamp?: string) {
  if (!timestamp) return 'Сейчас';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function formatTime(timestamp?: string) {
  if (!timestamp) return 'Сейчас';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

/** «1 сообщение», «3 сообщения», «500 сообщений». */
function messagesLabel(count: number) {
  const tens = count % 100;
  const ones = count % 10;
  const word = tens >= 11 && tens <= 14 ? 'сообщений' : ones === 1 ? 'сообщение' : ones >= 2 && ones <= 4 ? 'сообщения' : 'сообщений';
  return `${numberFormat.format(count)} ${word}`;
}

function withOverpopulationReports(next: ReportsState, previous: ReportsState): ReportsState {
  return preservePersistentReportCollections(next, previous);
}

function ProfileGlyph() {
  return <img className="reports-glyph-image" src={asterionAssetIntegrationAssets.reportIcons.profile} alt="" aria-hidden="true" draggable={false} />;
}

function SearchGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m15.5 15.5 5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function ActionGlyph({ kind }: { kind: 'prev' | 'next' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'prev') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m15 5-7 7 7 7" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m9 5 7 7-7 7" /></svg>;
}

function ReportListItem({ item, active, read, saved, selected, onOpen, onSelect }: {
  item: ReportItem;
  active: boolean;
  read: boolean;
  saved: boolean;
  selected: boolean;
  onOpen: () => void;
  onSelect: (checked: boolean) => void;
}) {
  return (
    <article className={`reports-list-item reports-v2-tone-${item.statusTone} ${item.brief ? 'reports-list-item--brief' : ''} ${active ? 'active' : ''} ${read ? 'read' : 'unread'} ${selected ? 'selected' : ''}`} data-report-item-id={item.id} data-report-kind={item.spyReport ? "spy" : item.pirateReconReport ? "pirate-recon" : item.overpopulationReport ? "overpopulation" : item.source} data-pirate-recon-outcome={item.pirateReconReport?.outcome}>
      <label className="reports-list-check">
        <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Выбрать сообщение: ${item.title}`} />
        <span aria-hidden="true" />
      </label>
      <button type="button" className="reports-list-open" onClick={onOpen} aria-current={active ? 'true' : undefined} aria-label={`Открыть сообщение: ${item.title}`}>
        <span className={`reports-list-icon reports-list-icon--${item.category} reports-v2-art`}><ReportArtwork item={item} /></span>
        <span className="reports-list-copy">{item.brief ? null : <small>{item.typeLabel}</small>}<strong>{item.title}</strong><em>{item.preview}</em></span>
        <span className="reports-list-meta"><time>{formatTime(item.timestamp)}</time>{saved ? <i className="reports-favorite-dot" aria-label="Бой сохранён" /> : null}{!read ? <b className="reports-unread-dot" aria-label="Непрочитано" /> : null}</span>
      </button>
    </article>
  );
}

function EmptyDossier({ category, savedOnly }: { category: ReportCategory; savedOnly: boolean }) {
  const copy = EMPTY_COPY[category];
  return <div className="reports-empty-dossier"><img className="ui-empty-art" src={savedOnly ? EMPTY_ART.battles : EMPTY_ART.reports} alt="" draggable={false} /><strong>{savedOnly ? 'Сохранённых боёв нет' : copy.title}</strong><span>{savedOnly ? 'Сохрани нужный бой звездой в «Докладах» или во вкладке Флоты → Битвы.' : copy.body}</span></div>;
}

function EmptyFolder({ folder }: { folder: MessageFolder }) {
  const title = folder.category ? EMPTY_COPY[folder.category].title : folder.emptyTitle ?? 'Раздел пока пуст';
  const body = folder.category ? EMPTY_COPY[folder.category].body : folder.emptyBody ?? 'Для этого раздела пока нет подключённого источника данных.';
  return <div className="reports-empty-dossier reports-empty-folder" data-qa-empty-folder><img className="ui-empty-art" src={EMPTY_ART.reports} alt="" draggable={false} /><strong>{title}</strong><span>{body}</span></div>;
}

function ProfileAvatar({ displayName, factionId }: { displayName: string; factionId: string }) {
  return (
    <div className="reports-profile-avatar">
      <div className="reports-profile-avatar__art"><FactionGeneralPortrait factionId={factionId} className="reports-profile-avatar__portrait faction-general-portrait--large" /></div>
      <div className="reports-profile-avatar__caption"><small>{getCombatFactionName(factionId)} · генерал</small><h3 className="ut-selectable">{displayName}</h3></div>
    </div>
  );
}

function MetricGlyph({ metric }: { metric: PlayerProfileMetricKey }) {
  return <img className="reports-score-glyph" src={asterionAssetIntegrationAssets.scoreIcons[metric]} alt="" aria-hidden="true" draggable={false} />;
}

function ProfileRecentEvents({ items }: { items: readonly ReportItem[] }) {
  return (
    <section className="reports-profile-events" aria-label="Последние события">
      <header>Последние события</header>
      {items.length ? <ul>{items.map((item) => <li key={item.id}><span className="reports-v2-art reports-profile-event-art"><ReportGlyph kind={item.category} /></span><span>{item.title}</span><time>{formatTime(item.timestamp)}</time></li>)}</ul> : <p>Недавних сообщений пока нет.</p>}
    </section>
  );
}

function PlayerProfile({ profile, score, command, mode, recentItems, onOpenCommand }: { profile: PlayerProfileState; score: OwnerScore | null; command: CommandState; mode: RuntimeMode; recentItems: readonly ReportItem[]; onOpenCommand: () => void }) {
  const metrics = selectPlayerProfileMetrics(profile, score, mode);
  const membership = selectOwnerMembership(command, profile.playerId);
  const alliance = membership ? toAllianceIdentity(membership.alliance) : null;
  return (
    <section className="reports-profile-view" data-qa-profile aria-labelledby="reports-profile-title">
      <header className="reports-profile-title-plate"><h2 id="reports-profile-title">Профиль игрока</h2></header>
      <div className="reports-profile-card">
        <section className="reports-profile-identity" aria-label="Аватар игрока"><ProfileAvatar displayName={profile.displayName} factionId={profile.factionId} /></section>
        <section className="reports-profile-metrics" aria-label="Рейтинг игрока">
          {metrics.map((metric) => <div key={metric.key} className="reports-profile-metric" data-qa-profile-metric={metric.key} tabIndex={0} role="img" aria-label={`${metric.label}: ${metric.value == null ? 'нет данных' : numberFormat.format(metric.value)}. ${metric.description}`}><span className="reports-profile-metric__glyph"><MetricGlyph metric={metric.key} /></span><span><small>{metric.label}</small><strong>{metric.value == null ? '—' : numberFormat.format(metric.value)}</strong><em>{metric.description}</em></span></div>)}
        </section>
        <section className="reports-profile-alliance" aria-label="Состояние союза">
          <small>Союз</small>
          {alliance ? <button type="button" className="reports-profile-alliance-link" onClick={onOpenCommand} aria-label={`Открыть Командование союза ${alliance.name}`}><span className="reports-v2-art reports-profile-alliance-art reports-profile-alliance-crest">{membership ? <EmblemGlyph emblem={membership.alliance.emblem} /> : <ReportGlyph kind="alliances" />}</span><span><strong>{alliance.name}</strong><small>[{alliance.tag}] · {numberFormat.format(membership?.alliance.members.length ?? 0)} участников</small></span><b>Командование <i aria-hidden="true">→</i></b></button> : <div className="reports-profile-no-alliance"><span className="reports-profile-diamond" aria-hidden="true">?</span><span><strong>Без Союза</strong><small>Членство не задано в профиле</small></span></div>}
          <ProfileRecentEvents items={recentItems} />
        </section>
      </div>
      {profile.protectionMode ? <div className="reports-profile-protection"><i aria-hidden="true" /> Защитный режим включён</div> : null}
      {mode === 'test' ? <p className="reports-fixture-note">Профильная идентичность тестовая; очки рассчитаны по текущим активам владельца, достижения не начисляются.</p> : null}
    </section>
  );
}

function FolderActions({ folder, items, selectedIds, onSelectAll, onDeleteAll, onDeleteSelected }: { folder: MessageFolder; items: readonly ReportItem[]; selectedIds: ReadonlySet<string>; onSelectAll: (checked: boolean) => void; onDeleteAll: () => void; onDeleteSelected: () => void }) {
  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));
  return (
    <div className="reports-folder-actions" data-qa-folder-actions>
      <label className="reports-select-all"><input type="checkbox" checked={allSelected} disabled={!items.length} onChange={(event) => onSelectAll(event.target.checked)} aria-label={`Выбрать все сообщения в разделе ${folder.label}`} /><span>Выбрать все</span><b>{selectedIds.size} из {items.length}</b></label>
      <div className="reports-delete-actions"><button type="button" data-qa-delete-all disabled={!items.length} onClick={onDeleteAll}>Удалить все</button><button type="button" data-qa-delete-selected disabled={!selectedIds.size} onClick={onDeleteSelected}>Удалить выбранные</button></div>
    </div>
  );
}

export function ReportsView({ retentionCutoff, battleReports, planetNames, savedBattleReportIds, operations, command, espionage, pirateReconReports, pirateFlights, exploration, initialSelectedReportId, profile, score, rating, mode, state, onStateChange, onToggleBattleSaved, onOpenFleets, onOpenCommand, onSimulateBattle, onRecallSpy, onOpenUniverseTarget, onOpenPirateUniverse, canRepeatFlight, onRepeatFlight, onCollectDebris, onAttackSpyTarget }: {
  /** Letters older than this world time are gone (24-hour rule); absent in Test Mode. */
  retentionCutoff?: number;
  battleReports: readonly BattleReport[];
  /** Live names of the player's planets, so flight summaries never show ids. */
  planetNames?: Readonly<Record<string, string>>;
  savedBattleReportIds: readonly string[];
  operations: OperationsState;
  command: CommandState;
  espionage?: import('./domain/espionage/types.ts').EspionageState;
  pirateReconReports?: readonly PirateReconReport[];
  pirateFlights?: readonly import('./domain/flights/types.ts').FlightRecord[];
  exploration?: import('./domain/exploration/ledger.ts').ExplorationState;
  initialSelectedReportId?: string;
  profile: PlayerProfileState;
  score: OwnerScore | null;
  rating: RatingPrototypeState;
  mode: RuntimeMode;
  state: ReportsState;
  onStateChange: (next: ReportsState) => void;
  onToggleBattleSaved: (reportId: string, saved: boolean) => void;
  onOpenFleets: () => void;
  onOpenCommand: () => void;
  onSimulateBattle: (report: SpyReportSnapshot) => void;
  onRecallSpy: (missionId: string) => void;
  onOpenUniverseTarget: (target: { coordinate: UniverseCoordinate; planetId?: string; ownerId?: string }) => void;
  onOpenPirateUniverse: (coordinate: UniverseCoordinate, contactCycleKey: string) => void;
  /** The Fleets screen prefilled from a report (existing launch and repeat flows). */
  canRepeatFlight?: (flightId: string) => boolean;
  onRepeatFlight?: (flightId: string) => void;
  onCollectDebris?: (coordinate: UniverseCoordinate) => void;
  onAttackSpyTarget?: (report: SpyReportSnapshot) => void;
}) {
  const [activeFolder, setActiveFolder] = useState<MessageFolderId>('profile');
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [openBattleReportId, setOpenBattleReportId] = useState<string | null>(null);
  const pendingInitialReportId = useRef<string | null>(null);
  const handledInitialReportId = useRef<string | null>(null);

  const items = useMemo(() => dropExpiredReportItems(buildReportsFeed(battleReports, operations, command, espionage, state.overpopulationReports, state.recyclerArrivalReports, state.gasExtractionArrivalReports, pirateReconReports, pirateFlights, exploration, profile.playerId, { planetNames, factionId: profile.factionId }), retentionCutoff, savedBattleReportIds)
    // Battles between third parties (e.g. pirates raiding Bot 01) are not the player's mail.
    .filter((item) => {
      if (!item.battleReportId) return true;
      const report = findBattleReport(battleReports, item);
      if (!report) return true;
      const mine = (id?: string) => isAsterionLocalPlayerId(profile.playerId) ? isAsterionLocalPlayerId(id) : id === profile.playerId;
      return mine(report.attacker.playerId) || mine(report.defender.playerId);
    }), [battleReports, operations, command, espionage, state.overpopulationReports, state.recyclerArrivalReports, state.gasExtractionArrivalReports, pirateReconReports, pirateFlights, exploration, profile.playerId, planetNames, profile.factionId, retentionCutoff, savedBattleReportIds]);
  const counts = useMemo(() => getReportCategoryCounts(items, state), [items, state]);
  const unreadCounts = useMemo(() => getReportUnreadCounts(items, state), [items, state]);
  const activeFolderMeta = MESSAGE_FOLDERS.find((folder) => folder.id === activeFolder) ?? MESSAGE_FOLDERS[0];
  const activeCategory = activeFolderMeta.category;
  const folderItems = useMemo(() => activeCategory ? getVisibleReportItems(items, state).filter((item) => item.category === activeCategory) : [], [activeCategory, items, state]);
  const isRead = useMemo(() => reportReadCheck(state), [state]);
  const visibleItems = useMemo(() => activeCategory ? filterReportItems(items, state, { category: activeCategory, filter, search, keepId: selectedId || undefined }, savedBattleReportIds) : [], [activeCategory, items, state, filter, search, selectedId, savedBattleReportIds]);
  const recentProfileItems = getVisibleReportItems(items, state).slice(0, 3);
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  const pagedItems = visibleItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedItem = visibleItems.find((item) => item.id === selectedId) ?? null;
  const selectedBattle = findBattleReport(battleReports, selectedItem);
  const selectedBattleSaved = selectedItem?.battleReportId ? savedBattleReportIds.includes(selectedItem.battleReportId) : false;
  const openBattleReport = openBattleReportId ? battleReports.find((report) => report.id === openBattleReportId) ?? null : null;
  const openBattleViewModel = openBattleReport ? createBattleReportViewModel(openBattleReport, {
    awardedBattlePoints: selectRecordedBattlePointAwards(rating, openBattleReport, profile.playerId),
  }) : null;

  useEffect(() => {
    setPage(1);
    if (pendingInitialReportId.current === null) setSelectedId('');
    setSelectedIds(new Set());
    if (activeFolderMeta.category) setFilter('all');
  }, [activeFolder, activeFolderMeta.category]);
  useEffect(() => {
    if (!initialSelectedReportId || handledInitialReportId.current === initialSelectedReportId) return;
    handledInitialReportId.current = initialSelectedReportId;
    pendingInitialReportId.current = initialSelectedReportId;
    const target = items.find((item) => item.id === initialSelectedReportId
      || item.pirateReconReport?.id === initialSelectedReportId
      || item.battleReportId === initialSelectedReportId);
    // Pirate recon is a System report; completed pirate raids link to Battle reports.
    const folder = MESSAGE_FOLDERS.find((item) => item.category === (target?.category ?? 'system'));
    setActiveFolder(folder?.id ?? 'system');
    setFilter('all');
    setSearch('');
  }, [initialSelectedReportId, items]);
  useEffect(() => {
    const requestedId = pendingInitialReportId.current;
    if (!requestedId) return;
    const targetIndex = visibleItems.findIndex((item) => item.id === requestedId
      || item.pirateReconReport?.id === requestedId
      || item.battleReportId === requestedId);
    if (targetIndex < 0) return;
    const target = visibleItems[targetIndex]!;
    if (activeCategory !== target.category) return;
    setPage(Math.floor(targetIndex / PAGE_SIZE) + 1);
    setSelectedId(target.id);
    pendingInitialReportId.current = null;
  }, [activeCategory, initialSelectedReportId, visibleItems]);
  useEffect(() => { if (activeCategory !== 'battle' && filter === 'saved') setFilter('all'); }, [activeCategory, filter]);
  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);
  useEffect(() => {
    if (activeFolder === 'profile' || !activeCategory || !visibleItems.length) {
      if (selectedId) setSelectedId('');
      return;
    }
    if (!visibleItems.some((item) => item.id === selectedId)) setSelectedId(visibleItems[0].id);
  }, [activeCategory, activeFolder, selectedId, visibleItems]);
  useEffect(() => {
    const allowed = new Set(folderItems.map((item) => item.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => allowed.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [folderItems]);
  useEffect(() => {
    const onRuntimeReset = () => {
      setActiveFolder('profile');
      setFilter('all');
      setSearch('');
      setPage(1);
      setSelectedId('');
      setSelectedIds(new Set());
      setOpenBattleReportId(null);
    };
    window.addEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
    return () => window.removeEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
  }, []);

  const openFolder = (folder: MessageFolderId) => {
    setActiveFolder(folder);
    setFilter('all');
    setSearch('');
  };

  const openItem = (item: ReportItem) => {
    setSelectedId(item.id);
    const index = visibleItems.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1);
    if (!isRead(item)) onStateChange(withOverpopulationReports(markReportRead(state, item.id), state));
  };
  // Owner rule (06.11.2026): what is open in the reading pane is read, the first
  // message opened on entering a section included; no extra click.
  useEffect(() => {
    if (selectedItem && !isRead(selectedItem)) onStateChange(withOverpopulationReports(markReportRead(state, selectedItem.id), state));
  }, [selectedItem, isRead, state, onStateChange]);

  const navigateSelected = (direction: -1 | 1) => {
    if (!visibleItems.length) return;
    const currentIndex = Math.max(0, visibleItems.findIndex((item) => item.id === selectedId));
    const nextIndex = Math.min(visibleItems.length - 1, Math.max(0, currentIndex + direction));
    openItem(visibleItems[nextIndex]);
  };

  const selectAll = (checked: boolean) => setSelectedIds(checked ? new Set(folderItems.map((item) => item.id)) : new Set());
  const toggleSelected = (id: string, checked: boolean) => setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  const deleteAll = () => {
    if (!activeCategory || !window.confirm('Вы уверены, что хотите удалить все сообщения в этом разделе?')) return;
    onStateChange(withOverpopulationReports(deleteAllReports(state, items, activeCategory), state));
    setSelectedIds(new Set());
    setSelectedId('');
  };
  const deleteSelected = () => {
    if (!activeCategory || !window.confirm('Вы уверены, что хотите удалить выбранные сообщения в этом разделе?')) return;
    onStateChange(withOverpopulationReports(deleteSelectedReports(state, items, activeCategory, [...selectedIds]), state));
    setSelectedIds(new Set());
    setSelectedId('');
  };

  const deleteCurrent = () => {
    if (!activeCategory || !selectedItem || !window.confirm('Удалить это сообщение?')) return;
    onStateChange(withOverpopulationReports(deleteSelectedReports(state, items, activeCategory, [selectedItem.id]), state));
    setSelectedIds((current) => new Set([...current].filter((id) => id !== selectedItem.id)));
    setSelectedId('');
  };

  const selectedIndex = selectedItem ? visibleItems.findIndex((item) => item.id === selectedItem.id) : -1;
  const availableFilters: ReportFilter[] = activeCategory === 'battle' ? ['all', 'unread', 'saved'] : ['all', 'unread'];
  const markableItems = getVisibleReportItems(items, state);
  const markAll = () => onStateChange(withOverpopulationReports(markAllReportsRead(state, markableItems), state));

  // One format for every report: the sheet (header, shared blocks, actions).
  const selectedBattleViewModel = useMemo(() => selectedBattle ? createBattleReportViewModel(selectedBattle, {
    awardedBattlePoints: selectRecordedBattlePointAwards(rating, selectedBattle, profile.playerId),
  }) : null, [selectedBattle, rating, profile.playerId]);
  const selectedSheet = useMemo(() => selectedItem ? buildReportSheet(selectedItem, selectedBattleViewModel, { canRepeatFlight: onRepeatFlight ? canRepeatFlight : undefined }) : null, [selectedItem, selectedBattleViewModel, canRepeatFlight, onRepeatFlight]);
  const runAction = (action: ReportSheetAction) => {
    if (!selectedItem) return;
    if (action.kind === 'open_battle' && selectedBattle) setOpenBattleReportId(selectedBattle.id);
    else if (action.kind === 'simulate_battle' && selectedItem.spyReport) onSimulateBattle(selectedItem.spyReport);
    else if (action.kind === 'recall_spy' && action.missionId) onRecallSpy(action.missionId);
    else if (action.kind === 'open_fleets') onOpenFleets();
    else if (action.kind === 'open_command') onOpenCommand();
    else if (action.kind === 'collect_debris' && action.coordinate) onCollectDebris?.(action.coordinate);
    else if (action.kind === 'attack_target' && selectedItem.spyReport) onAttackSpyTarget?.(selectedItem.spyReport);
    else if (action.kind === 'repeat_flight' && action.flightId) onRepeatFlight?.(action.flightId);
  };
  const wired: Partial<Record<ReportSheetAction['kind'], boolean>> = {
    collect_debris: Boolean(onCollectDebris), attack_target: Boolean(onAttackSpyTarget), repeat_flight: Boolean(onRepeatFlight),
    // Answers with no game action yet («Принять» / «Отказаться» of bot letters) are not drawn.
    accept: false, decline: false,
  };
  const offered = (selectedSheet?.actions ?? []).filter((action) => wired[action.kind] !== false);
  // One primary: the first offered primary keeps it.
  const firstPrimary = offered.findIndex((action) => action.primary);
  const sheetActions = offered.map((action, index) => ({ ...action, primary: index === firstPrimary }));

  const previewBody = !activeCategory
    ? <EmptyFolder folder={activeFolderMeta} />
    : !selectedItem || !selectedSheet
      ? <EmptyDossier category={activeCategory} savedOnly={filter === 'saved'} />
      : <ReportSheetView
        key={selectedItem.id}
        item={selectedItem}
        sheet={selectedSheet}
        exploration={exploration}
        command={command}
        onOpenUniverseTarget={onOpenUniverseTarget}
        onOpenPirateUniverse={onOpenPirateUniverse}
        lead={selectedBattle ? <SunReportStrip report={selectedBattle} /> : undefined}
      />;

  return (
    <main className={`reports-view ${activeFolder === 'profile' ? 'reports-view--profile' : 'reports-view--folder'}`} aria-label="Сообщения">
      <aside className="reports-categories">
        <header><h1>Сообщения</h1></header>
        <button type="button" className={`reports-profile-nav ${activeFolder === 'profile' ? 'active' : ''}`} onClick={() => openFolder('profile')} data-message-profile aria-label="Открыть профиль" aria-current={activeFolder === 'profile' ? 'page' : undefined}><span className="reports-nav-art"><ProfileGlyph /></span><strong>Профиль</strong></button>
        <nav className="reports-message-nav" aria-label="Папки сообщений">
          {MESSAGE_FOLDERS.map((folder) => {
            const unread = folder.category ? unreadCounts[folder.category] : 0;
            const total = folder.category ? counts[folder.category] : 0;
            return <button key={folder.id} type="button" data-message-folder={folder.id} className={activeFolder === folder.id ? 'active' : ''} onClick={() => openFolder(folder.id)} aria-current={activeFolder === folder.id ? 'page' : undefined} aria-label={`${folder.label}: ${unread} непрочитанных из ${total}`}><span className="reports-nav-art"><ReportGlyph kind={folder.glyph} /></span><strong>{folder.label}</strong><span className="reports-folder-counter" aria-hidden="true"><b className={`reports-v2-unread-count ${unread > 0 ? 'is-new' : ''}`}>{unread}</b><i>/{numberFormat.format(total)}</i></span></button>;
          })}
        </nav>
        <button className="reports-mark-all" type="button" data-qa-mark-all-read disabled={!markableItems.some((item) => !isRead(item))} onClick={markAll}>Отметить все прочитанными</button>
      </aside>

      {activeFolder === 'profile' ? <PlayerProfile profile={profile} score={score} command={command} mode={mode} recentItems={recentProfileItems} onOpenCommand={onOpenCommand} /> : <section className="reports-folder-workspace" data-qa-folder-view={activeFolder}>
        <section className="reports-feed" data-qa-message-folder-view={activeFolder}>
          <header className="reports-feed-head"><h2>{activeFolderMeta.label}</h2>{activeCategory ? <span className="reports-folder-count">{messagesLabel(counts[activeCategory])}</span> : null}</header>
          {activeCategory ? <div className="reports-feed-tools">
            <div className="reports-v2-filter-segments" role="group" aria-label="Фильтр сообщений">{availableFilters.map((key) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{FILTER_LABELS[key]}</button>)}</div>
            <label className="reports-search"><span aria-hidden="true"><SearchGlyph /></span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск в разделе" aria-label="Поиск в разделе сообщений" /></label>
          </div> : null}
          {activeCategory ? <FolderActions folder={activeFolderMeta} items={folderItems} selectedIds={selectedIds} onSelectAll={selectAll} onDeleteAll={deleteAll} onDeleteSelected={deleteSelected} /> : null}
          <div className="reports-list" data-qa-message-list>
            {activeCategory ? pagedItems.length ? pagedItems.map((item) => <ReportListItem key={item.id} item={item} active={item.id === selectedId} read={isRead(item)} selected={selectedIds.has(item.id)} saved={Boolean(item.battleReportId && savedBattleReportIds.includes(item.battleReportId))} onOpen={() => openItem(item)} onSelect={(checked) => toggleSelected(item.id, checked)} />) : <p className="reports-list-empty-status" role="status">{search || filter !== 'all' ? 'Ничего не найдено.' : 'Сообщений в этом разделе пока нет.'}</p> : <EmptyFolder folder={activeFolderMeta} />}
          </div>
          {activeCategory && pageCount > 1 ? <footer className="reports-pagination"><button type="button" aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ActionGlyph kind="prev" /></button><span>Страница <b>{page}</b> из {pageCount}</span><button type="button" aria-label="Следующая страница" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><ActionGlyph kind="next" /></button></footer> : null}
        </section>

        <section className="reports-preview" aria-label="Открытое сообщение">
          {activeCategory && selectedItem ? <header className="reports-preview-head"><span>{selectedIndex + 1} из {visibleItems.length}</span><div className="reports-preview-actions"><button type="button" aria-label="Предыдущее сообщение" disabled={selectedIndex <= 0} onClick={() => navigateSelected(-1)}><ActionGlyph kind="prev" /></button><button type="button" aria-label="Следующее сообщение" disabled={selectedIndex < 0 || selectedIndex >= visibleItems.length - 1} onClick={() => navigateSelected(1)}><ActionGlyph kind="next" /></button></div></header> : null}
          <div className="reports-preview-scroll">{previewBody}</div>
          {activeCategory && selectedItem ? <footer className="reports-preview-footer">
            <div className="reports-preview-footer-actions">
              {selectedItem.battleReportId ? <button type="button" className={selectedBattleSaved ? 'restore' : ''} aria-pressed={selectedBattleSaved} onClick={() => onToggleBattleSaved(selectedItem.battleReportId!, !selectedBattleSaved)}>{selectedBattleSaved ? 'УБРАТЬ ИЗ СОХРАНЁННЫХ' : 'СОХРАНИТЬ БОЙ'}</button> : null}
              <button type="button" className="reports-delete-current" onClick={deleteCurrent}>Удалить</button>
            </div>
            <div className="reports-preview-footer-actions">
              {[...sheetActions.filter((action) => !action.primary), ...sheetActions.filter((action) => action.primary)].map((action) => <button
                key={action.kind}
                type="button"
                className={action.primary ? 'reports-primary-action' : action.kind === 'recall_spy' ? 'restore' : ''}
                data-report-action={action.kind}
                onClick={() => runAction(action)}
              >{action.label}</button>)}
            </div>
          </footer> : null}
        </section>
        {openBattleReport && openBattleViewModel ? <BattleReportModal report={openBattleReport} viewModel={openBattleViewModel} saved={savedBattleReportIds.includes(openBattleReport.id)} onToggleSaved={() => onToggleBattleSaved(openBattleReport.id, !savedBattleReportIds.includes(openBattleReport.id))} onClose={() => setOpenBattleReportId(null)} /> : null}
      </section>}
    </main>
  );
}
