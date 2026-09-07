import { useEffect, useMemo, useState } from 'react';

import { BattleReportDetailBody } from './BattleReportsView';
import { EmblemGlyph } from './CommandView';
import aegisProfileAvatar from '../assets/source/generated-factions-v1/factions/aegis_profile_avatar.png';
import type { BattleReport } from './domain/combat/report.ts';
import type { CommandState } from './domain/command/types.ts';
import type { OperationsState } from './domain/operations/types.ts';
import {
  buildReportsFeed,
  filterReportItems,
  findBattleReport,
  getReportCategoryCounts,
  getReportUnreadCounts,
  getVisibleReportItems,
} from './domain/reports/adapters.ts';
import {
  deleteAllReports,
  deleteSelectedReports,
  markAllReportsRead,
  markReportRead,
} from './domain/reports/repository.ts';
import type { ReportCategory, ReportFilter, ReportItem, ReportsState } from './domain/reports/types.ts';
import type { PlayerProfileState } from './domain/profile/types.ts';
import { selectPlayerProfileMetrics } from './domain/profile/selectors.ts';
import type { RatingPrototypeState } from './domain/rating/fixtures.ts';
import './reports.css';

const PAGE_SIZE = 7;
const numberFormat = new Intl.NumberFormat('ru-RU');

type MessageFolderId =
  | 'profile'
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
  count: boolean;
  emptyTitle?: string;
  emptyBody?: string;
};

const MESSAGE_FOLDERS: readonly MessageFolder[] = [
  { id: 'system', label: 'Система', glyph: 'system', category: 'system', count: true },
  { id: 'battle', label: 'Доклады', glyph: 'battle', category: 'battle', count: true },
  { id: 'command', label: 'Командные доклады', glyph: 'command', category: 'command', count: true },
  { id: 'arena', label: 'Арена', glyph: 'arena', category: 'arena', count: true },
  { id: 'flights', label: 'Полёты', glyph: 'flights', category: 'flights', count: true },
  { id: 'alliances', label: 'Союзы', glyph: 'alliances', category: 'alliances', count: true },
  { id: 'achievements', label: 'Достижения', glyph: 'achievements', category: 'achievements', count: true },
];

const EMPTY_COPY: Record<ReportCategory, { title: string; body: string }> = {
  system: { title: 'Системных данных пока нет', body: 'Сюда попадут шпионские отчёты и результаты операций, которые дают новую информацию. Текущая отправка шпионских флотов ещё не подключена.' },
  battle: { title: 'Боевых докладов пока нет', body: 'Здесь хранятся реальные боевые отчёты и бои из операций. Симуляции и Арена в этот канал не попадают.' },
  command: { title: 'Командных докладов пока нет', body: 'Здесь будут отчёты об атаках на союзников и результаты атак на Солнце, когда эти события появятся в боевом контуре.' },
  arena: { title: 'Арена — пока пусто', body: 'Отчёты и очки Арены появятся здесь вместе с реализацией самой Арены.' },
  flights: { title: 'Завершённых полётов пока нет', body: 'После подключения реальной отправки флотов сюда будут сохраняться завершённые рейсы, прибытия и возвраты флота на ваши планеты.' },
  alliances: { title: 'Союзных приглашений пока нет', body: 'Здесь появляются доступные совместные операции союза. Из приглашения можно сразу перейти к выбору флота.' },
  achievements: { title: 'Достижения — пока пусто', body: 'Этот канал зарезервирован под будущую систему достижений.' },
};

const FILTER_LABELS: Record<ReportFilter, string> = {
  all: 'ВСЕ',
  unread: 'НЕПРОЧИТАННЫЕ',
  saved: 'СОХРАНЁННЫЕ БОИ',
};

function formatDate(timestamp?: string) {
  if (!timestamp) return 'ТЕКУЩЕЕ';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function formatTime(timestamp?: string) {
  if (!timestamp) return 'NOW';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function ReportGlyph({ kind }: { kind: ReportCategory }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.55, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'system') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16Z" /><circle {...common} cx="16" cy="16" r="4" /><path {...common} d="M16 3v3M16 26v3M3 16h3M26 16h3" /></svg>;
  if (kind === 'battle') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m7 5 18 22M25 5 7 27M8 7l5 5m11-5-5 5M6 25l4-1-2-2M26 25l-4-1 2-2" /></svg>;
  if (kind === 'command') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M16 4 27 9v7c0 7-4.7 10.8-11 13-6.3-2.2-11-6-11-13V9l11-5Z" /><path {...common} d="m11 17 4-4 6 6" /></svg>;
  if (kind === 'arena') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M10 5h12v6c0 6-2 9-6 11-4-2-6-5-6-11V5Z" /><path {...common} d="M10 8H5v3c0 4 2 6 6 6M22 8h5v3c0 4-2 6-6 6M16 22v5M11 28h10" /></svg>;
  if (kind === 'flights') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m17 4 6 8-5 3-2 13-3-8-7-2 8-5 3-9Z" /><path {...common} d="m10 22-4 4m6-2-2 4" /></svg>;
  if (kind === 'alliances') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="10" cy="12" r="4" /><circle {...common} cx="22" cy="12" r="4" /><path {...common} d="M3 27c1-6 3-9 7-9s6 3 7 9M15 27c1-6 3-9 7-9 3.5 0 5.7 2.5 7 7M13 13h6" /></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m16 4 3.5 7.1 7.8 1.1-5.7 5.5 1.3 7.8-6.9-3.7-6.9 3.7 1.3-7.8-5.7-5.5 7.8-1.1L16 4Z" /></svg>;
}

function ProfileGlyph() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="10" r="5" fill="none" stroke="currentColor" strokeWidth="1.55" /><path d="M6 28c.8-6.2 4.2-9.3 10-9.3S25.2 21.8 26 28" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" /></svg>;
}

function SearchGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m15.5 15.5 5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function ActionGlyph({ kind }: { kind: 'save' | 'prev' | 'next' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'save') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></svg>;
  if (kind === 'prev') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m15 5-7 7 7 7" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m9 5 7 7-7 7" /></svg>;
}

function StatusBadge({ item }: { item: ReportItem }) {
  return <span className={`reports-status reports-status--${item.statusTone}`}>{item.statusLabel}</span>;
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
    <article className={`reports-list-item ${active ? 'active' : ''} ${read ? 'read' : 'unread'} ${selected ? 'selected' : ''}`} data-report-item-id={item.id}>
      <label className="reports-list-check">
        <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Выбрать сообщение: ${item.title}`} />
        <span aria-hidden="true" />
      </label>
      <button type="button" className="reports-list-open" onClick={onOpen} aria-current={active ? 'true' : undefined} aria-label={`Открыть сообщение: ${item.title}`}>
        <span className={`reports-list-icon reports-list-icon--${item.category}`}><ReportGlyph kind={item.category} /></span>
        <span className="reports-list-copy"><small>{item.typeLabel}</small><strong>{item.title}</strong><em>{item.preview}</em></span>
        <span className="reports-list-meta"><time>{formatTime(item.timestamp)}</time>{saved ? <i className="reports-favorite-dot" aria-label="Бой сохранён" /> : null}{!read ? <b className="reports-unread-dot" aria-label="Непрочитано" /> : null}</span>
      </button>
    </article>
  );
}

function GenericDossier({ item }: { item: ReportItem }) {
  return (
    <div className="reports-dossier reports-dossier--generic">
      <div className="reports-dossier-heading">
        <div className="reports-dossier-heading__icon"><ReportGlyph kind={item.category} /></div>
        <div><small>{item.typeLabel}</small><h2>{item.title}</h2><p>{item.preview}</p></div>
        <div className="reports-dossier-heading__status"><StatusBadge item={item} /><time>{formatDate(item.timestamp)}</time></div>
      </div>
      <section className={`reports-generic-hero reports-generic-hero--${item.category}`}>
        <ReportGlyph kind={item.category} />
        <div><small>ASTERION REPORT CHANNEL</small><strong>{item.typeLabel.toUpperCase()}</strong><span>{item.statusLabel}</span></div>
        <i />
      </section>
      <section className="reports-generic-details"><header>ДЕТАЛИ</header><dl>{item.details.map((detail) => <div key={`${detail.label}-${detail.value}`}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl></section>
      <section className="reports-generic-body"><small>СВОДКА</small><p>{item.body}</p></section>
    </div>
  );
}

function BattleDossier({ item, report }: { item: ReportItem; report: BattleReport }) {
  return (
    <div className="reports-dossier reports-dossier--battle">
      <div className="reports-dossier-heading">
        <div className="reports-dossier-heading__icon"><ReportGlyph kind="battle" /></div>
        <div><small>{item.typeLabel}</small><h2>{item.title}</h2><p>{item.preview}</p></div>
        <div className="reports-dossier-heading__status"><StatusBadge item={item} /><time>{formatDate(item.timestamp)}</time></div>
      </div>
      <BattleReportDetailBody report={report} />
    </div>
  );
}

function EmptyDossier({ category, savedOnly }: { category: ReportCategory; savedOnly: boolean }) {
  const copy = EMPTY_COPY[category];
  return <div className="reports-empty-dossier"><ReportGlyph kind={category} /><strong>{savedOnly ? 'СОХРАНЁННЫХ БОЁВ НЕТ' : copy.title.toUpperCase()}</strong><span>{savedOnly ? 'Сохрани нужный бой звездой в «Докладах» или во вкладке Флоты → Битвы.' : copy.body}</span></div>;
}

function EmptyFolder({ folder }: { folder: MessageFolder }) {
  const title = folder.category ? EMPTY_COPY[folder.category].title : folder.emptyTitle ?? 'Раздел пока пуст';
  const body = folder.category ? EMPTY_COPY[folder.category].body : folder.emptyBody ?? 'Для этого раздела пока нет подключённого источника данных.';
  return <div className="reports-empty-dossier reports-empty-folder" data-qa-empty-folder><ReportGlyph kind={folder.glyph} /><strong>{title.toUpperCase()}</strong><span>{body}</span></div>;
}

const PROFILE_EMBLEM = { glyph: 'starforge', accent: 'cyan' } as const;

function ProfileAvatar({ displayName }: { displayName: string }) {
  return (
    <div className="reports-profile-avatar">
      <div className="reports-profile-avatar__art"><img src={aegisProfileAvatar} alt="" /></div>
      <strong>{displayName}</strong>
    </div>
  );
}

function MetricGlyph({ metric }: { metric: string }) {
  if (metric === 'resourcePoints') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 5v8l-8 5-8-5V8l8-5Z" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="m7 10 5 3 5-3M12 13v5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>;
  if (metric === 'battlePoints') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 4 14 16M19 4 5 20M7 6l4 4m6-4-4 4M5 18l3-1-1-2m12 3-3-1 1-2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
  if (metric === 'totalPoints') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="m8 12 2.5 2.5L16 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.6 5.3 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
}

function PlayerProfile({ profile, rating, command, onOpenCommand }: { profile: PlayerProfileState; rating: RatingPrototypeState; command: CommandState; onOpenCommand: () => void }) {
  const metrics = selectPlayerProfileMetrics(profile, rating);
  const alliance = command.alliance ? {
    id: 'alliance-current',
    name: command.alliance.name,
    tag: command.alliance.tag,
    emblem: command.alliance.emblem,
  } : null;
  return (
    <section className="reports-profile-view" data-qa-profile aria-labelledby="reports-profile-title">
      <header className="reports-profile-title-plate"><span className="reports-profile-title-plate__side">PLAYER PROFILE</span><h2 id="reports-profile-title">ПРОФИЛЬ ИГРОКА</h2><span className="reports-profile-title-plate__side reports-profile-title-plate__side--right">ASTERION // IDENTITY</span></header>
      <div className="reports-profile-name-plate"><small>ИМЯ ИГРОКА</small><h3>{profile.displayName}</h3><span>{profile.playerId}</span></div>
      <div className="reports-profile-card">
        <div className="reports-profile-asterion-mark" aria-hidden="true"><EmblemGlyph emblem={PROFILE_EMBLEM} /></div>
        <section className="reports-profile-identity" aria-label="Аватар игрока"><ProfileAvatar displayName={profile.displayName} /></section>
        <section className="reports-profile-metrics" aria-label="Рейтинг игрока">
          {metrics.map((metric) => <div key={metric.key} className="reports-profile-metric" data-qa-profile-metric={metric.key} tabIndex={0} role="img" title={metric.description} aria-label={`${metric.label}: ${metric.value == null ? 'нет данных' : numberFormat.format(metric.value)}. ${metric.description}`}><span className="reports-profile-metric__glyph"><MetricGlyph metric={metric.key} /></span><span><small>{metric.label}</small><strong>{metric.value == null ? '—' : numberFormat.format(metric.value)}</strong></span></div>)}
        </section>
        <section className="reports-profile-alliance" aria-label="Состояние союза">
          <small>СОЮЗ</small>
          {alliance ? <button type="button" className="reports-profile-alliance-link" onClick={onOpenCommand} aria-label={`Открыть Командование союза ${alliance.name}`}><EmblemGlyph compact emblem={alliance.emblem} /><span><strong>{alliance.name}</strong><small>[{alliance.tag}] · {alliance.id}</small></span><b>КОМАНДОВАНИЕ <i>→</i></b></button> : <div className="reports-profile-no-alliance"><span className="reports-profile-diamond" aria-hidden="true">?</span><span><strong>Без Союза</strong><small>Членство не задано в профиле</small></span></div>}
        </section>
      </div>
      {profile.protectionMode ? <div className="reports-profile-protection"><i /> ЗАЩИТНЫЙ РЕЖИМ АКТИВЕН</div> : null}
      <p className="reports-fixture-note">Профильная идентичность и четыре очка — prototype fixture, сохранённые в общем состоянии. Формулы рейтинга остаются в существующем доменном провайдере.</p>
    </section>
  );
}

function FolderActions({ folder, items, selectedIds, onSelectAll, onDeleteAll, onDeleteSelected }: { folder: MessageFolder; items: readonly ReportItem[]; selectedIds: ReadonlySet<string>; onSelectAll: (checked: boolean) => void; onDeleteAll: () => void; onDeleteSelected: () => void }) {
  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));
  return (
    <div className="reports-folder-actions" data-qa-folder-actions>
      <label className="reports-select-all"><input type="checkbox" checked={allSelected} disabled={!items.length} onChange={(event) => onSelectAll(event.target.checked)} aria-label={`Выбрать все сообщения в разделе ${folder.label}`} /><span>ВЫБРАТЬ ВСЕ</span><b>{selectedIds.size}/{items.length}</b></label>
      <div className="reports-delete-actions"><button type="button" data-qa-delete-all disabled={!items.length} onClick={onDeleteAll}>УДАЛИТЬ ВСЕ</button><button type="button" data-qa-delete-selected disabled={!selectedIds.size} onClick={onDeleteSelected}>УДАЛИТЬ ВЫБРАННОЕ</button></div>
    </div>
  );
}

export function ReportsView({ battleReports, savedBattleReportIds, operations, command, profile, rating, state, onStateChange, onToggleBattleSaved, onOpenFleets, onOpenCommand }: {
  battleReports: readonly BattleReport[];
  savedBattleReportIds: readonly string[];
  operations: OperationsState;
  command: CommandState;
  profile: PlayerProfileState;
  rating: RatingPrototypeState;
  state: ReportsState;
  onStateChange: (next: ReportsState) => void;
  onToggleBattleSaved: (reportId: string, saved: boolean) => void;
  onOpenFleets: () => void;
  onOpenCommand: () => void;
}) {
  const [activeFolder, setActiveFolder] = useState<MessageFolderId>('profile');
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const items = useMemo(() => buildReportsFeed(battleReports, operations, command), [battleReports, operations, command]);
  const counts = useMemo(() => getReportCategoryCounts(items, state), [items, state]);
  const unreadCounts = useMemo(() => getReportUnreadCounts(items, state), [items, state]);
  const activeFolderMeta = MESSAGE_FOLDERS.find((folder) => folder.id === activeFolder) ?? MESSAGE_FOLDERS[0];
  const activeCategory = activeFolderMeta.category;
  const folderItems = useMemo(() => activeCategory ? getVisibleReportItems(items, state).filter((item) => item.category === activeCategory) : [], [activeCategory, items, state]);
  const visibleItems = useMemo(() => activeCategory ? filterReportItems(items, state, { category: activeCategory, filter, search }, savedBattleReportIds) : [], [activeCategory, items, state, filter, search, savedBattleReportIds]);
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  const pagedItems = visibleItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedItem = visibleItems.find((item) => item.id === selectedId) ?? null;
  const selectedBattle = findBattleReport(battleReports, selectedItem);
  const selectedBattleSaved = selectedItem?.battleReportId ? savedBattleReportIds.includes(selectedItem.battleReportId) : false;

  useEffect(() => {
    setPage(1);
    setSelectedId('');
    setSelectedIds(new Set());
    if (activeFolderMeta.category) setFilter('all');
  }, [activeFolder, activeFolderMeta.category]);
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

  const openFolder = (folder: MessageFolderId) => {
    setActiveFolder(folder);
    setFilter('all');
    setSearch('');
  };

  const openItem = (item: ReportItem) => {
    setSelectedId(item.id);
    const index = visibleItems.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1);
    if (!state.readIds.includes(item.id)) onStateChange(markReportRead(state, item.id));
  };

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
    onStateChange(deleteAllReports(state, items, activeCategory));
    setSelectedIds(new Set());
    setSelectedId('');
  };
  const deleteSelected = () => {
    if (!activeCategory || !window.confirm('Вы уверены, что хотите удалить выбранные сообщения в этом разделе?')) return;
    onStateChange(deleteSelectedReports(state, items, activeCategory, [...selectedIds]));
    setSelectedIds(new Set());
    setSelectedId('');
  };

  const selectedIndex = selectedItem ? visibleItems.findIndex((item) => item.id === selectedItem.id) : -1;
  const availableFilters: ReportFilter[] = activeCategory === 'battle' ? ['all', 'unread', 'saved'] : ['all', 'unread'];
  const markableItems = getVisibleReportItems(items, state);

  return (
    <main className={`reports-view ${activeFolder === 'profile' ? 'reports-view--profile' : 'reports-view--folder'}`} aria-label="Центр сообщений Asterion">
      <aside className="reports-categories">
        <header><h1>ОТЧЁТЫ</h1><span><i /> КАНАЛЫ ОТЧЁТОВ</span></header>
        <button type="button" className={`reports-profile-nav ${activeFolder === 'profile' ? 'active' : ''}`} onClick={() => openFolder('profile')} data-message-profile aria-label="Открыть профиль игрока"><span><ProfileGlyph /></span><strong>Профиль игрока</strong><b>ОБЗОР</b></button>
        <nav className="reports-message-nav" aria-label="Папки сообщений">
          {MESSAGE_FOLDERS.map((folder) => {
            const unread = folder.category ? unreadCounts[folder.category] : 0;
            const total = folder.category ? counts[folder.category] : 0;
            return <button key={folder.id} type="button" data-message-folder={folder.id} className={activeFolder === folder.id ? 'active' : ''} onClick={() => openFolder(folder.id)} aria-current={activeFolder === folder.id ? 'page' : undefined}><span><ReportGlyph kind={folder.glyph} /></span><strong>{folder.label}</strong>{folder.count ? <b>{unread}/{total}</b> : <b className="reports-folder-action-label">+</b>}{unread > 0 ? <i className="reports-category-unread" title={`${unread} непрочитанных`} /> : null}</button>;
          })}
        </nav>
        <button className="reports-mark-all" type="button" disabled={!markableItems.some((item) => !state.readIds.includes(item.id))} onClick={() => onStateChange(markAllReportsRead(state, markableItems.map((item) => item.id)))}><span>✓</span> ОТМЕТИТЬ ВСЕ ПРОЧИТАННЫМИ</button>
        <div className="reports-ai-note"><small>MESSAGE CENTER CORE</small><strong>БЕЗ ФАЛЬШИВЫХ СОБЫТИЙ</strong><span>Доклады читают BattleHistory. Остальные каналы наполняются только из существующих игровых контуров.</span></div>
      </aside>

      {activeFolder === 'profile' ? <PlayerProfile profile={profile} rating={rating} command={command} onOpenCommand={onOpenCommand} /> : <section className="reports-folder-workspace" data-qa-folder-view={activeFolder}>
        <section className="reports-feed" data-qa-message-folder-view={activeFolder}>
          <header className="reports-feed-head"><div><small>MESSAGE FOLDER</small><h2>{activeFolderMeta.label.toUpperCase()}</h2></div>{activeCategory ? <div className="reports-feed-head-tools"><span className="reports-folder-count">{counts[activeCategory]} СООБЩЕНИЙ</span><select value={filter} onChange={(event) => setFilter(event.target.value as ReportFilter)} aria-label="Фильтр сообщений">{availableFilters.map((key) => <option key={key} value={key}>{FILTER_LABELS[key]}</option>)}</select></div> : null}</header>
          {activeCategory ? <FolderActions folder={activeFolderMeta} items={folderItems} selectedIds={selectedIds} onSelectAll={selectAll} onDeleteAll={deleteAll} onDeleteSelected={deleteSelected} /> : null}
          {activeCategory ? <label className="reports-search"><span aria-hidden="true"><SearchGlyph /></span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск в разделе..." aria-label="Поиск в разделе сообщений" /></label> : null}
          <div className="reports-list" data-qa-message-list>
            {activeCategory ? pagedItems.length ? pagedItems.map((item) => <ReportListItem key={item.id} item={item} active={item.id === selectedId} read={state.readIds.includes(item.id)} selected={selectedIds.has(item.id)} saved={Boolean(item.battleReportId && savedBattleReportIds.includes(item.battleReportId))} onOpen={() => openItem(item)} onSelect={(checked) => toggleSelected(item.id, checked)} />) : <EmptyDossier category={activeCategory} savedOnly={filter === 'saved'} /> : <EmptyFolder folder={activeFolderMeta} />}
          </div>
          {activeCategory ? <footer className="reports-pagination"><button type="button" aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ActionGlyph kind="prev" /></button><span><b>{page}</b> / {pageCount}<small>{visibleItems.length} сообщений</small></span><button type="button" aria-label="Следующая страница" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><ActionGlyph kind="next" /></button></footer> : null}
        </section>

        <section className="reports-preview">
          <header className="reports-preview-head"><div><small>MESSAGE DOSSIER</small><h2>ПРОСМОТР СООБЩЕНИЯ</h2></div>{activeCategory ? <div className="reports-preview-actions"><button type="button" aria-label={selectedBattleSaved ? 'Убрать бой из сохранённых' : 'Сохранить бой'} aria-pressed={selectedBattleSaved} disabled={!selectedItem?.battleReportId} className={selectedBattleSaved ? 'active' : ''} onClick={() => selectedItem?.battleReportId && onToggleBattleSaved(selectedItem.battleReportId, !selectedBattleSaved)}><ActionGlyph kind="save" /></button><span /><button type="button" aria-label="Предыдущее сообщение" disabled={selectedIndex <= 0} onClick={() => navigateSelected(-1)}><ActionGlyph kind="prev" /></button><button type="button" aria-label="Следующее сообщение" disabled={selectedIndex < 0 || selectedIndex >= visibleItems.length - 1} onClick={() => navigateSelected(1)}><ActionGlyph kind="next" /></button></div> : null}</header>
          <div className="reports-preview-scroll">{activeCategory ? selectedItem ? (selectedBattle ? <BattleDossier item={selectedItem} report={selectedBattle} /> : <GenericDossier item={selectedItem} />) : <EmptyDossier category={activeCategory} savedOnly={filter === 'saved'} /> : <EmptyFolder folder={activeFolderMeta} />}</div>
          {activeCategory && selectedItem?.action?.kind === 'open_fleets' ? <footer className="reports-preview-footer"><span>Выбери состав флота для совместной операции.</span><button type="button" onClick={onOpenFleets}>{selectedItem.action.label}</button></footer> : activeCategory && selectedItem?.battleReportId ? <footer className="reports-preview-footer"><span>{selectedBattleSaved ? 'Бой находится в сохранённых.' : 'Этот бой можно сохранить и открыть позже во Флоты → Битвы.'}</span><button type="button" className={selectedBattleSaved ? 'restore' : ''} onClick={() => onToggleBattleSaved(selectedItem.battleReportId!, !selectedBattleSaved)}>{selectedBattleSaved ? 'УБРАТЬ ИЗ СОХРАНЁННЫХ' : 'СОХРАНИТЬ БОЙ'}</button></footer> : null}
        </section>
      </section>}
    </main>
  );
}
