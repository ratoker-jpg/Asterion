import { useEffect, useMemo, useState } from 'react';

import { BattleReportDetailBody } from './BattleReportsView';
import {
  BATTLE_HISTORY_CHANGED_EVENT,
  persistBattleHistory,
  readBattleHistory,
  setBattleReportSaved,
} from './domain/combat/battle-repository.ts';
import type { BattleReport } from './domain/combat/report.ts';
import type { CommandState } from './domain/command/types.ts';
import type { OperationsState } from './domain/operations/types.ts';
import {
  buildReportsFeed,
  filterReportItems,
  findBattleReport,
  getReportCategoryCounts,
  getReportUnreadCounts,
} from './domain/reports/adapters.ts';
import { markAllReportsRead, markReportRead } from './domain/reports/repository.ts';
import type { ReportCategory, ReportFilter, ReportItem, ReportsState } from './domain/reports/types.ts';
import './reports.css';

const PAGE_SIZE = 7;

const CATEGORY_META: ReadonlyArray<{ key: ReportCategory; label: string }> = [
  { key: 'system', label: 'Система' },
  { key: 'battle', label: 'Доклады' },
  { key: 'command', label: 'Командные доклады' },
  { key: 'arena', label: 'Арена' },
  { key: 'flights', label: 'Полёты' },
  { key: 'alliances', label: 'Союзы' },
  { key: 'achievements', label: 'Достижения' },
];

const FILTER_LABELS: Record<ReportFilter, string> = {
  all: 'ВСЕ',
  unread: 'НЕПРОЧИТАННЫЕ',
  saved: 'СОХРАНЁННЫЕ БОИ',
};

const EMPTY_COPY: Record<ReportCategory, { title: string; body: string }> = {
  system: { title: 'Системных данных пока нет', body: 'Сюда попадут шпионские отчёты и результаты операций, которые дают новую информацию. Текущая отправка шпионских флотов ещё не подключена.' },
  battle: { title: 'Боевых докладов пока нет', body: 'Здесь хранятся реальные боевые отчёты и бои из операций. Симуляции и Арена в этот канал не попадают.' },
  command: { title: 'Командных докладов пока нет', body: 'Здесь будут отчёты об атаках на союзников и результаты атак на Солнце, когда эти события появятся в боевом контуре.' },
  arena: { title: 'Арена — пока пусто', body: 'Отчёты и очки Арены появятся здесь вместе с реализацией самой Арены.' },
  flights: { title: 'Завершённых полётов пока нет', body: 'После подключения реальной отправки флотов сюда будут сохраняться завершённые рейсы, прибытия и возвраты флота на ваши планеты.' },
  alliances: { title: 'Союзных приглашений пока нет', body: 'Здесь появляются доступные совместные операции союза. Из приглашения можно сразу перейти к выбору флота.' },
  achievements: { title: 'Достижения — пока пусто', body: 'Этот канал зарезервирован под будущую систему достижений.' },
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

function ReportListItem({ item, active, read, saved, onOpen }: { item: ReportItem; active: boolean; read: boolean; saved: boolean; onOpen: () => void }) {
  return (
    <button type="button" className={`reports-list-item ${active ? 'active' : ''} ${read ? 'read' : 'unread'}`} onClick={onOpen}>
      <span className={`reports-list-icon reports-list-icon--${item.category}`}><ReportGlyph kind={item.category} /></span>
      <span className="reports-list-copy"><small>{item.typeLabel}</small><strong>{item.title}</strong><em>{item.preview}</em></span>
      <span className="reports-list-meta"><time>{formatTime(item.timestamp)}</time>{saved ? <i className="reports-favorite-dot" aria-label="Бой сохранён" /> : null}{!read ? <b className="reports-unread-dot" aria-label="Непрочитано" /> : null}</span>
    </button>
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

export function ReportsView({ battleReports, operations, command, state, onStateChange, onOpenFleets }: {
  battleReports: readonly BattleReport[];
  operations: OperationsState;
  command: CommandState;
  state: ReportsState;
  onStateChange: (next: ReportsState) => void;
  onOpenFleets: () => void;
}) {
  const [savedBattleReportIds, setSavedBattleReportIds] = useState<string[]>(() => readBattleHistory().savedReportIds);
  const [category, setCategory] = useState<ReportCategory>('system');
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    const sync = () => setSavedBattleReportIds(readBattleHistory().savedReportIds);
    window.addEventListener(BATTLE_HISTORY_CHANGED_EVENT, sync);
    return () => window.removeEventListener(BATTLE_HISTORY_CHANGED_EVENT, sync);
  }, []);

  const items = useMemo(() => buildReportsFeed(battleReports, operations, command), [battleReports, operations, command]);
  const counts = useMemo(() => getReportCategoryCounts(items), [items]);
  const unreadCounts = useMemo(() => getReportUnreadCounts(items, state), [items, state]);
  const visibleItems = useMemo(() => filterReportItems(items, state, { category, filter, search }, savedBattleReportIds), [items, state, category, filter, search, savedBattleReportIds]);
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  const pagedItems = visibleItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedItem = visibleItems.find((item) => item.id === selectedId) ?? null;
  const selectedBattle = findBattleReport(battleReports, selectedItem);
  const selectedBattleSaved = selectedItem?.battleReportId ? savedBattleReportIds.includes(selectedItem.battleReportId) : false;

  useEffect(() => setPage(1), [category, filter, search]);
  useEffect(() => { if (category !== 'battle' && filter === 'saved') setFilter('all'); }, [category, filter]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  useEffect(() => {
    if (!visibleItems.length) {
      if (selectedId) setSelectedId('');
      return;
    }
    if (!visibleItems.some((item) => item.id === selectedId)) setSelectedId(visibleItems[0].id);
  }, [visibleItems, selectedId]);

  const openItem = (item: ReportItem) => {
    setSelectedId(item.id);
    const index = visibleItems.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1);
    if (!state.readIds.includes(item.id)) onStateChange(markReportRead(state, item.id));
  };

  const toggleBattleSaved = (reportId: string, saved: boolean) => {
    const history = readBattleHistory();
    const result = persistBattleHistory(setBattleReportSaved(history, reportId, saved));
    setSavedBattleReportIds(result.value.savedReportIds);
  };

  const navigateSelected = (direction: -1 | 1) => {
    if (!visibleItems.length) return;
    const currentIndex = Math.max(0, visibleItems.findIndex((item) => item.id === selectedId));
    const nextIndex = Math.min(visibleItems.length - 1, Math.max(0, currentIndex + direction));
    openItem(visibleItems[nextIndex]);
  };

  const selectedIndex = selectedItem ? visibleItems.findIndex((item) => item.id === selectedItem.id) : -1;
  const categoryLabel = CATEGORY_META.find((entry) => entry.key === category)?.label ?? category;
  const availableFilters: ReportFilter[] = category === 'battle' ? ['all', 'unread', 'saved'] : ['all', 'unread'];

  return (
    <main className="reports-view" aria-label="Центр отчётов Asterion">
      <aside className="reports-categories">
        <header><h1>ОТЧЁТЫ</h1><span><i /> КАНАЛЫ ОТЧЁТОВ</span></header>
        <nav aria-label="Категории отчётов">
          {CATEGORY_META.map((entry) => (
            <button key={entry.key} type="button" className={category === entry.key ? 'active' : ''} onClick={() => setCategory(entry.key)}>
              <span><ReportGlyph kind={entry.key} /></span><strong>{entry.label}</strong><b>{unreadCounts[entry.key]}/{counts[entry.key]}</b>
              {unreadCounts[entry.key] > 0 ? <i className="reports-category-unread" title={`${unreadCounts[entry.key]} непрочитанных`} /> : null}
            </button>
          ))}
        </nav>
        <button className="reports-mark-all" type="button" disabled={!items.some((item) => !state.readIds.includes(item.id))} onClick={() => onStateChange(markAllReportsRead(state, items.map((item) => item.id)))}><span>✓</span> ОТМЕТИТЬ ВСЕ ПРОЧИТАННЫМИ</button>
        <div className="reports-ai-note"><small>REPORTS CORE</small><strong>БЕЗ ФАЛЬШИВЫХ СОБЫТИЙ</strong><span>Доклады читают BattleHistory. Остальные каналы наполняются только из существующих игровых контуров.</span></div>
      </aside>

      <section className="reports-feed">
        <header className="reports-feed-head"><div><small>REPORT CHANNEL</small><h2>{categoryLabel.toUpperCase()}</h2></div><select value={filter} onChange={(event) => setFilter(event.target.value as ReportFilter)} aria-label="Фильтр отчётов">{availableFilters.map((key) => <option key={key} value={key}>{FILTER_LABELS[key]}</option>)}</select></header>
        <label className="reports-search"><span aria-hidden="true"><SearchGlyph /></span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск в канале..." /></label>
        <div className="reports-list">
          {pagedItems.length ? pagedItems.map((item) => <ReportListItem key={item.id} item={item} active={item.id === selectedId} read={state.readIds.includes(item.id)} saved={Boolean(item.battleReportId && savedBattleReportIds.includes(item.battleReportId))} onOpen={() => openItem(item)} />) : <EmptyDossier category={category} savedOnly={filter === 'saved'} />}
        </div>
        <footer className="reports-pagination"><button type="button" aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ActionGlyph kind="prev" /></button><span><b>{page}</b> / {pageCount}<small>{visibleItems.length} сообщений</small></span><button type="button" aria-label="Следующая страница" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><ActionGlyph kind="next" /></button></footer>
      </section>

      <section className="reports-preview">
        <header className="reports-preview-head">
          <div><small>REPORT DOSSIER</small><h2>ПРОСМОТР ОТЧЁТА</h2></div>
          <div className="reports-preview-actions">
            <button type="button" aria-label={selectedBattleSaved ? 'Убрать бой из сохранённых' : 'Сохранить бой'} aria-pressed={selectedBattleSaved} disabled={!selectedItem?.battleReportId} className={selectedBattleSaved ? 'active' : ''} onClick={() => selectedItem?.battleReportId && toggleBattleSaved(selectedItem.battleReportId, !selectedBattleSaved)}><ActionGlyph kind="save" /></button>
            <span /><button type="button" aria-label="Предыдущий отчёт" disabled={selectedIndex <= 0} onClick={() => navigateSelected(-1)}><ActionGlyph kind="prev" /></button><button type="button" aria-label="Следующий отчёт" disabled={selectedIndex < 0 || selectedIndex >= visibleItems.length - 1} onClick={() => navigateSelected(1)}><ActionGlyph kind="next" /></button>
          </div>
        </header>
        <div className="reports-preview-scroll">{selectedItem ? (selectedBattle ? <BattleDossier item={selectedItem} report={selectedBattle} /> : <GenericDossier item={selectedItem} />) : <EmptyDossier category={category} savedOnly={filter === 'saved'} />}</div>
        {selectedItem?.action?.kind === 'open_fleets' ? <footer className="reports-preview-footer"><span>Выбери состав флота для совместной операции.</span><button type="button" onClick={onOpenFleets}>{selectedItem.action.label}</button></footer> : selectedItem?.battleReportId ? <footer className="reports-preview-footer"><span>{selectedBattleSaved ? 'Бой находится в сохранённых.' : 'Этот бой можно сохранить и открыть позже во Флоты → Битвы.'}</span><button type="button" className={selectedBattleSaved ? 'restore' : ''} onClick={() => toggleBattleSaved(selectedItem.battleReportId!, !selectedBattleSaved)}>{selectedBattleSaved ? 'УБРАТЬ ИЗ СОХРАНЁННЫХ' : 'СОХРАНИТЬ БОЙ'}</button></footer> : null}
      </section>
    </main>
  );
}
