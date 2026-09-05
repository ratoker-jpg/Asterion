import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { COMBAT_ENTITY_BY_ID } from './domain/combat/catalog.ts';
import type { BattleForceSnapshot, BattleReport, BattleSide, BattleStackSnapshot } from './domain/combat/report.ts';
import {
  buildReportsFeed,
  filterReportItems,
  findBattleReport,
  getBattlePerspective,
  getBattleRewardEntries,
  getReportCategoryCounts,
  getReportUnreadCounts,
} from './domain/reports/adapters.ts';
import {
  archiveReport,
  markAllReportsRead,
  markReportRead,
  toggleReportFavorite,
  unarchiveReport,
} from './domain/reports/repository.ts';
import type {
  BattleRewardEntry,
  ReportCategory,
  ReportFilter,
  ReportItem,
  ReportsCategoryKey,
  ReportsState,
} from './domain/reports/types.ts';
import './reports.css';

const PAGE_SIZE = 7;

const CATEGORY_META: ReadonlyArray<{ key: ReportsCategoryKey; label: string; icon: ReportCategory | 'all' | 'archive' }> = [
  { key: 'all', label: 'Все отчёты', icon: 'all' },
  { key: 'battle', label: 'Боевые отчёты', icon: 'battle' },
  { key: 'flights', label: 'Полёты', icon: 'flights' },
  { key: 'recon', label: 'Разведка', icon: 'recon' },
  { key: 'economy', label: 'Экономика', icon: 'economy' },
  { key: 'construction', label: 'Строительство', icon: 'construction' },
  { key: 'diplomacy', label: 'Дипломатия', icon: 'diplomacy' },
  { key: 'system', label: 'Системные', icon: 'system' },
  { key: 'inbox', label: 'Входящие', icon: 'inbox' },
  { key: 'archive', label: 'Архив', icon: 'archive' },
];

const FILTER_LABELS: Record<ReportFilter, string> = {
  all: 'ВСЕ',
  unread: 'НЕПРОЧИТАННЫЕ',
  favorite: 'ИЗБРАННЫЕ',
};

const MISSION_LABELS: Record<BattleReport['missionType'], string> = {
  attack: 'Атака',
  raid: 'Рейд',
  defense: 'Оборона',
  arena: 'Арена',
  simulation: 'Симуляция',
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatDate(timestamp: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function ReportGlyph({ kind }: { kind: ReportCategory | 'all' | 'archive' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.55, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'battle') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m7 5 18 22M25 5 7 27M8 7l5 5m11-5-5 5M6 25l4-1-2-2M26 25l-4-1 2-2" /></svg>;
  if (kind === 'flights') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m17 4 6 8-5 3-2 13-3-8-7-2 8-5 3-9Z" /><path {...common} d="m10 22-4 4m6-2-2 4" /></svg>;
  if (kind === 'recon') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16Z" /><circle {...common} cx="16" cy="16" r="4" /></svg>;
  if (kind === 'economy') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m16 4 10 6-10 6L6 10l10-6Z" /><path {...common} d="m6 10 10 6 10-6v12l-10 6-10-6V10Z" /><path {...common} d="M16 16v12" /></svg>;
  if (kind === 'construction') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M5 27h22M8 27V13l8-5 8 5v14M12 27v-7h8v7" /><path {...common} d="M16 8V3m-3 2h6" /></svg>;
  if (kind === 'diplomacy') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m4 12 6-4 6 5-5 5-7-6Zm24 0-6-4-6 5 5 5 7-6Z" /><path {...common} d="m11 18 5 5 5-5M14 21l-3 3m7-3 3 3" /></svg>;
  if (kind === 'system') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="4" /><path {...common} d="M16 3v5m0 16v5M3 16h5m16 0h5M7 7l4 4m10 10 4 4M25 7l-4 4M11 21l-4 4" /></svg>;
  if (kind === 'inbox') return <svg viewBox="0 0 32 32" aria-hidden="true"><rect {...common} x="4" y="7" width="24" height="18" rx="2" /><path {...common} d="m5 9 11 9L27 9" /></svg>;
  if (kind === 'archive') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M5 8h22v6H5V8Zm3 6h16v13H8V14Z" /><path {...common} d="M13 19h6" /></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M8 4h12l4 4v20H8V4Z" /><path {...common} d="M20 4v5h5M12 14h8M12 19h8M12 24h6" /></svg>;
}

function ActionGlyph({ kind }: { kind: 'favorite' | 'archive' | 'restore' | 'prev' | 'next' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'favorite') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></svg>;
  if (kind === 'restore') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M7 8V4m0 0H3m4 0-3 3a8 8 0 1 0 2-2" /><path {...common} d="M9 11h8v8H9z" /></svg>;
  if (kind === 'archive') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 6h16v4H4V6Zm2 4h12v10H6V10Z" /><path {...common} d="M10 14h4" /></svg>;
  if (kind === 'prev') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m15 5-7 7 7 7" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m9 5 7 7-7 7" /></svg>;
}

function StatusBadge({ item }: { item: ReportItem }) {
  return <span className={`reports-status reports-status--${item.statusTone}`}>{item.statusLabel}</span>;
}

function SideMark({ hostile = false }: { hostile?: boolean }) {
  return (
    <span className={`reports-side-mark ${hostile ? 'reports-side-mark--hostile' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 72 72">
        <path d="M36 4 46 24l22 3-16 15 4 22-20-10-20 10 4-22L4 27l22-3L36 4Z" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="36" cy="36" r="12" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </span>
  );
}

function BattleHero() {
  return (
    <div className="reports-battle-hero" aria-label="Тактическая визуализация космического боя">
      <span className="reports-hero-grid" />
      <span className="reports-hero-planet" />
      <span className="reports-hero-orbit reports-hero-orbit--one" />
      <span className="reports-hero-orbit reports-hero-orbit--two" />
      <span className="reports-hero-flare reports-hero-flare--one" />
      <span className="reports-hero-flare reports-hero-flare--two" />
      <span className="reports-hero-laser reports-hero-laser--one" />
      <span className="reports-hero-laser reports-hero-laser--two" />
      <span className="reports-hero-ship reports-hero-ship--one" />
      <span className="reports-hero-ship reports-hero-ship--two" />
      <span className="reports-hero-ship reports-hero-ship--three" />
      <small>TACTICAL RECONSTRUCTION // BATTLE REPORT</small>
    </div>
  );
}

function forceForSide(report: BattleReport, side: BattleSide) {
  return side === 'attacker' ? report.attackerForce : report.defenderForce;
}

function participantForSide(report: BattleReport, side: BattleSide) {
  return side === 'attacker' ? report.attacker : report.defender;
}

function populationLoss(force: BattleForceSnapshot) {
  return Math.max(0, force.populationBefore - force.populationAfter);
}

function lossStacks(force: BattleForceSnapshot) {
  return [...force.stacks, ...(force.defenses ?? [])].filter((stack) => stack.destroyed > 0);
}

function LossStrip({ title, stacks }: { title: string; stacks: BattleStackSnapshot[] }) {
  return (
    <section className="reports-loss-block">
      <header><span>{title}</span><small>{stacks.reduce((sum, stack) => sum + stack.destroyed, 0)} ЕД. УНИЧТОЖЕНО</small></header>
      {stacks.length ? (
        <div className="reports-loss-grid">
          {stacks.map((stack) => {
            const entity = COMBAT_ENTITY_BY_ID.get(stack.entityId);
            return (
              <article key={stack.entityId}>
                <span className="reports-loss-art">
                  {entity?.art ? <img src={entity.art} alt="" draggable={false} /> : <i />}
                </span>
                <strong>×{formatNumber(stack.destroyed)}</strong>
                <small>{entity?.name ?? stack.entityId}</small>
              </article>
            );
          })}
        </div>
      ) : <div className="reports-empty-inline">Потерь не зафиксировано.</div>}
    </section>
  );
}

function RewardGlyph({ reward }: { reward: BattleRewardEntry }) {
  return <span className={`reports-reward-glyph reports-reward-glyph--${reward.key}`} aria-hidden="true"><i /></span>;
}

function BattleDossier({ item, report }: { item: ReportItem; report: BattleReport }) {
  const perspective = getBattlePerspective(report);
  const leftParticipant = participantForSide(report, perspective.leftSide);
  const rightParticipant = participantForSide(report, perspective.rightSide);
  const leftForce = forceForSide(report, perspective.leftSide);
  const rightForce = forceForSide(report, perspective.rightSide);
  const totalBefore = Math.max(1, leftForce.populationBefore + rightForce.populationBefore);
  const leftShare = Math.round((leftForce.populationBefore / totalBefore) * 100);
  const rewards = getBattleRewardEntries(report);

  return (
    <div className="reports-dossier reports-dossier--battle">
      <div className="reports-dossier-heading">
        <div className="reports-dossier-heading__icon"><ReportGlyph kind="battle" /></div>
        <div>
          <small>{item.typeLabel}</small>
          <h2>{item.title}</h2>
          <p>{item.preview}</p>
        </div>
        <div className="reports-dossier-heading__status"><StatusBadge item={item} /><time>{formatDate(item.timestamp)}</time></div>
      </div>

      <BattleHero />

      <section className="reports-versus">
        <div className="reports-versus-side reports-versus-side--left">
          <SideMark />
          <div><small>{perspective.leftLabel}</small><strong>{leftParticipant.playerName}</strong><span>{leftParticipant.planetName ?? leftParticipant.race ?? '—'} {leftParticipant.coordinates ?? ''}</span></div>
          <b>{formatNumber(leftForce.populationBefore)}</b>
          <em>СОСТАВ ДО БОЯ</em>
        </div>
        <div className="reports-versus-center">
          <strong>VS</strong>
          <small>СОСТАВ ДО БОЯ</small>
          <div><i style={{ '--reports-left-share': `${leftShare}%` } as CSSProperties} /></div>
        </div>
        <div className="reports-versus-side reports-versus-side--right">
          <SideMark hostile />
          <div><small>{perspective.rightLabel}</small><strong>{rightParticipant.playerName}</strong><span>{rightParticipant.planetName ?? rightParticipant.race ?? '—'} {rightParticipant.coordinates ?? ''}</span></div>
          <b>{formatNumber(rightForce.populationBefore)}</b>
          <em>СОСТАВ ДО БОЯ</em>
        </div>
      </section>

      <section className="reports-population-metrics">
        <article><small>{perspective.leftLabel}</small><span><b>{formatNumber(leftForce.populationAfter)}</b> осталось</span><span><b>{formatNumber(populationLoss(leftForce))}</b> потери населения</span></article>
        <article><small>РАУНДЫ</small><strong>{report.roundCount}</strong><span>{MISSION_LABELS[report.missionType]}</span></article>
        <article><small>{perspective.rightLabel}</small><span><b>{formatNumber(rightForce.populationAfter)}</b> осталось</span><span><b>{formatNumber(populationLoss(rightForce))}</b> потери населения</span></article>
      </section>

      <div className="reports-losses-wrap">
        <LossStrip title={`ПОТЕРИ · ${perspective.leftLabel}`} stacks={lossStacks(leftForce)} />
        <LossStrip title={`ПОТЕРИ · ${perspective.rightLabel}`} stacks={lossStacks(rightForce)} />
      </div>

      {rewards.length ? (
        <section className="reports-rewards">
          <header><span>НАГРАДА / ИТОГ</span><small>ТОЛЬКО ДАННЫЕ BATTLE REPORT</small></header>
          <div>
            {rewards.map((reward) => <article key={reward.key}><RewardGlyph reward={reward} /><strong>{formatNumber(reward.value)}</strong><small>{reward.label}</small></article>)}
          </div>
        </section>
      ) : null}

      <section className="reports-battle-details">
        <header>ДЕТАЛИ ОТЧЁТА</header>
        <dl>
          <div><dt>Дата / время</dt><dd>{formatDate(report.timestamp)}</dd></div>
          <div><dt>Тип миссии</dt><dd>{MISSION_LABELS[report.missionType]}</dd></div>
          <div><dt>Раундов</dt><dd>{report.roundCount}</dd></div>
          <div><dt>Атакующий</dt><dd>{report.attacker.playerName}</dd></div>
          <div><dt>Защитник</dt><dd>{report.defender.playerName}</dd></div>
          <div><dt>Цель</dt><dd>{report.defender.planetName ?? '—'} {report.defender.coordinates ?? ''}</dd></div>
          {report.repairEligibility?.status ? <div><dt>Ремонт</dt><dd>{report.repairEligibility.status}</dd></div> : null}
          {report.metadata?.source ? <div><dt>Источник</dt><dd>{report.metadata.source}</dd></div> : null}
        </dl>
        <p>{report.metadata?.note ?? 'Подробные потери, состав сторон и результат взяты напрямую из существующего BattleReport.'}</p>
      </section>
    </div>
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
        <div><small>ASTERION EVENT DOSSIER</small><strong>{item.typeLabel.toUpperCase()}</strong><span>{item.statusLabel}</span></div>
        <i />
      </section>
      <section className="reports-generic-details">
        <header>ДЕТАЛИ</header>
        <dl>{item.details.map((detail) => <div key={`${detail.label}-${detail.value}`}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>
      </section>
      <section className="reports-generic-body"><small>СВОДКА СОБЫТИЯ</small><p>{item.body}</p></section>
      {item.source === 'fixture' ? <p className="reports-fixture-note">Presentation/foundation fixture. Канонический runtime event этой системы будет подключён отдельно.</p> : null}
    </div>
  );
}

function ReportListItem({ item, active, read, favorite, onOpen }: {
  item: ReportItem;
  active: boolean;
  read: boolean;
  favorite: boolean;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={`reports-list-item ${active ? 'active' : ''} ${read ? 'read' : 'unread'}`} onClick={onOpen}>
      <span className={`reports-list-icon reports-list-icon--${item.category}`}><ReportGlyph kind={item.category} /></span>
      <span className="reports-list-copy"><small>{item.typeLabel}</small><strong>{item.title}</strong><em>{item.preview}</em></span>
      <span className="reports-list-meta"><time>{formatTime(item.timestamp)}</time>{favorite ? <i className="reports-favorite-dot" aria-label="В избранном" /> : null}{!read ? <b className="reports-unread-dot" aria-label="Непрочитано" /> : null}</span>
    </button>
  );
}

function EmptyDossier() {
  return <div className="reports-empty-dossier"><ReportGlyph kind="all" /><strong>НЕТ ОТЧЁТОВ</strong><span>Измени категорию, фильтр или поисковый запрос.</span></div>;
}

export function ReportsView({
  battleReports,
  state,
  onStateChange,
}: {
  battleReports: readonly BattleReport[];
  state: ReportsState;
  onStateChange: (next: ReportsState) => void;
}) {
  const [category, setCategory] = useState<ReportsCategoryKey>('all');
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');

  const items = useMemo(() => buildReportsFeed(battleReports), [battleReports]);
  const counts = useMemo(() => getReportCategoryCounts(items, state), [items, state]);
  const unreadCounts = useMemo(() => getReportUnreadCounts(items, state), [items, state]);
  const visibleItems = useMemo(() => filterReportItems(items, state, { category, filter, search }), [items, state, category, filter, search]);
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  const pagedItems = visibleItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedItem = visibleItems.find((item) => item.id === selectedId) ?? null;
  const selectedBattle = findBattleReport(battleReports, selectedItem);
  const isSelectedFavorite = selectedItem ? state.favoriteIds.includes(selectedItem.id) : false;
  const isSelectedArchived = selectedItem ? state.archivedIds.includes(selectedItem.id) : false;

  useEffect(() => setPage(1), [category, filter, search]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  useEffect(() => {
    if (!visibleItems.length) {
      if (selectedId) setSelectedId('');
      return;
    }
    if (!visibleItems.some((item) => item.id === selectedId)) setSelectedId(visibleItems[0].id);
  }, [visibleItems, selectedId]);
  useEffect(() => {
    if (!selectedItem || state.readIds.includes(selectedItem.id)) return;
    onStateChange(markReportRead(state, selectedItem.id));
  }, [selectedItem, state, onStateChange]);

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

  const selectedIndex = selectedItem ? visibleItems.findIndex((item) => item.id === selectedItem.id) : -1;
  const heading = category === 'inbox' ? 'ВХОДЯЩИЕ СООБЩЕНИЯ' : category === 'archive' ? 'АРХИВ ОТЧЁТОВ' : 'СПИСОК ОТЧЁТОВ';

  return (
    <main className="reports-view" aria-label="Центр отчётов Asterion">
      <aside className="reports-categories">
        <header><h1>ОТЧЁТЫ</h1><span><i /> ИИ-АНАЛИТИКА АКТИВНА</span></header>
        <nav aria-label="Категории отчётов">
          {CATEGORY_META.map((entry) => (
            <button key={entry.key} type="button" className={category === entry.key ? 'active' : ''} onClick={() => setCategory(entry.key)}>
              <span><ReportGlyph kind={entry.icon} /></span>
              <strong>{entry.label}</strong>
              <b>{counts[entry.key]}</b>
              {unreadCounts[entry.key] > 0 ? <i className="reports-category-unread" title={`${unreadCounts[entry.key]} непрочитанных`} /> : null}
            </button>
          ))}
        </nav>
        <button className="reports-mark-all" type="button" disabled={!unreadCounts.all && !unreadCounts.archive} onClick={() => onStateChange(markAllReportsRead(state, items.map((item) => item.id)))}>
          <span>✓</span> ОТМЕТИТЬ ВСЕ ПРОЧИТАННЫМИ
        </button>
        <div className="reports-ai-note"><small>REPORTS CORE</small><strong>ДАННЫЕ ВАЖНЕЕ ДЕКОРА</strong><span>Боевые результаты читаются напрямую из BattleHistory.</span></div>
      </aside>

      <section className="reports-feed">
        <header className="reports-feed-head"><div><small>REPORT CHANNEL</small><h2>{heading}</h2></div><select value={filter} onChange={(event) => setFilter(event.target.value as ReportFilter)} aria-label="Фильтр отчётов">{(Object.keys(FILTER_LABELS) as ReportFilter[]).map((key) => <option key={key} value={key}>{FILTER_LABELS[key]}</option>)}</select></header>
        <label className="reports-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск отчёта..." /></label>
        <div className="reports-list">
          {pagedItems.length ? pagedItems.map((item) => <ReportListItem key={item.id} item={item} active={item.id === selectedId} read={state.readIds.includes(item.id)} favorite={state.favoriteIds.includes(item.id)} onOpen={() => openItem(item)} />) : <div className="reports-list-empty"><ReportGlyph kind="all" /><strong>Ничего не найдено</strong><span>Измени фильтр или поисковый запрос.</span></div>}
        </div>
        <footer className="reports-pagination">
          <button type="button" aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ActionGlyph kind="prev" /></button>
          <span><b>{page}</b> / {pageCount}<small>{visibleItems.length} сообщений</small></span>
          <button type="button" aria-label="Следующая страница" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><ActionGlyph kind="next" /></button>
        </footer>
      </section>

      <section className="reports-preview">
        <header className="reports-preview-head">
          <div><small>REPORT DOSSIER</small><h2>ПРОСМОТР ОТЧЁТА</h2></div>
          <div className="reports-preview-actions">
            <button type="button" aria-label={isSelectedFavorite ? 'Убрать из избранного' : 'Добавить в избранное'} aria-pressed={isSelectedFavorite} disabled={!selectedItem} className={isSelectedFavorite ? 'active' : ''} onClick={() => selectedItem && onStateChange(toggleReportFavorite(state, selectedItem.id))}><ActionGlyph kind="favorite" /></button>
            <button type="button" aria-label={isSelectedArchived ? 'Вернуть из архива' : 'Архивировать'} disabled={!selectedItem} onClick={() => selectedItem && onStateChange(isSelectedArchived ? unarchiveReport(state, selectedItem.id) : archiveReport(state, selectedItem.id))}><ActionGlyph kind={isSelectedArchived ? 'restore' : 'archive'} /></button>
            <span />
            <button type="button" aria-label="Предыдущий отчёт" disabled={selectedIndex <= 0} onClick={() => navigateSelected(-1)}><ActionGlyph kind="prev" /></button>
            <button type="button" aria-label="Следующий отчёт" disabled={selectedIndex < 0 || selectedIndex >= visibleItems.length - 1} onClick={() => navigateSelected(1)}><ActionGlyph kind="next" /></button>
          </div>
        </header>
        <div className="reports-preview-scroll">
          {selectedItem ? (selectedBattle ? <BattleDossier item={selectedItem} report={selectedBattle} /> : <GenericDossier item={selectedItem} />) : <EmptyDossier />}
        </div>
        {selectedItem ? (
          <footer className="reports-preview-footer">
            <span>{isSelectedArchived ? 'Отчёт находится в архиве.' : 'Отчёт находится в текущем канале.'}</span>
            <button type="button" className={isSelectedArchived ? 'restore' : ''} onClick={() => onStateChange(isSelectedArchived ? unarchiveReport(state, selectedItem.id) : archiveReport(state, selectedItem.id))}>{isSelectedArchived ? 'ВЕРНУТЬ ИЗ АРХИВА' : 'АРХИВИРОВАТЬ'}</button>
          </footer>
        ) : null}
      </section>
    </main>
  );
}