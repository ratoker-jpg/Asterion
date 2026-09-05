import { useEffect, useMemo, useState } from 'react';

import { ASTERION_LOCAL_PLAYER_ID } from './domain/combat/report.ts';
import type { CommandState } from './domain/command/types.ts';
import {
  buildRatingFoundation,
  getDisplayedRank,
  getLocalAlliance,
  getLocalPlayer,
  getRankDelta,
  getRatingScore,
  searchAllianceRows,
  searchPlayerRows,
  sortAllianceRows,
  sortPlayerRows,
} from './domain/rating/selectors.ts';
import type { AllianceRatingRow, PlayerRatingRow, RatingMode, RatingScoreKind } from './domain/rating/types.ts';
import './rating.css';

const PAGE_SIZE = 8;

const SCORE_META: ReadonlyArray<{ id: RatingScoreKind; label: string; short: string; hint: string }> = [
  { id: 'achievement', label: 'Очки достижений', short: 'ДОСТИЖ.', hint: 'Отдельный рейтинг' },
  { id: 'total', label: 'Общие очки', short: 'ОБЩИЕ', hint: 'Ресурсные + боевые' },
  { id: 'resource', label: 'Ресурсные очки', short: 'РЕСУРСЫ', hint: 'Экономический рейтинг' },
  { id: 'combat', label: 'Боевые очки', short: 'БОЕВЫЕ', hint: 'Боевой рейтинг' },
];

function formatScore(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function ScoreGlyph({ kind }: { kind: RatingScoreKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'resource') return <svg viewBox="0 0 28 28" aria-hidden="true"><path {...common} d="M14 3c-5 3-8 8-8 13 5 0 9-2 12-7M14 3c4 2 7 6 8 11-4 1-7 0-10-2M14 8v16M9 21h10"/></svg>;
  if (kind === 'combat') return <svg viewBox="0 0 28 28" aria-hidden="true"><path {...common} d="m15 3 7 9-5 2-2 11-3-7-8-2 8-5 3-8Z"/><path {...common} d="m8 20-4 4m7-2-2 3"/></svg>;
  if (kind === 'achievement') return <svg viewBox="0 0 28 28" aria-hidden="true"><path {...common} d="M9 4h10v6c0 5-2 8-5 10-3-2-5-5-5-10V4Z"/><path {...common} d="M9 7H4v3c0 4 2 6 6 6M19 7h5v3c0 4-2 6-6 6M14 20v4M9 25h10"/></svg>;
  return <svg viewBox="0 0 28 28" aria-hidden="true"><path {...common} d="M5 23V14h4v9M12 23V8h4v15M19 23V4h4v19M3 23h22"/></svg>;
}

function RankDelta({ current, previous, enabled = true }: { current: number; previous: number; enabled?: boolean }) {
  if (!enabled) return <span className="rating-delta rating-delta--same">—</span>;
  const delta = getRankDelta(current, previous);
  if (delta === 0) return <span className="rating-delta rating-delta--same">—</span>;
  return <span className={`rating-delta ${delta > 0 ? 'rating-delta--up' : 'rating-delta--down'}`}>{delta > 0 ? '↑' : '↓'} {Math.abs(delta)}</span>;
}

function RatingMark({ tag, local = false }: { tag: string; local?: boolean }) {
  return <span className={`rating-mark ${local ? 'local' : ''}`} aria-hidden="true"><i /><b>{tag.slice(0, 2)}</b></span>;
}

function ScoreHeader({ kind, active, onSelect }: { kind: RatingScoreKind; active: boolean; onSelect: () => void }) {
  const meta = SCORE_META.find((item) => item.id === kind)!;
  return <button type="button" className={`rating-score-head ${active ? 'active' : ''}`} onClick={onSelect} title={meta.label}><ScoreGlyph kind={kind}/><span>{meta.short}</span><b>{active ? '▼' : ''}</b></button>;
}

function LocalPosition({ mode, player, alliance, scoreKind, playerRank, allianceRank }: {
  mode: RatingMode;
  player: PlayerRatingRow | null;
  alliance: AllianceRatingRow | null;
  scoreKind: RatingScoreKind;
  playerRank: number | null;
  allianceRank: number | null;
}) {
  const meta = SCORE_META.find((item) => item.id === scoreKind)!;
  if (mode === 'players' && player) return <section className="rating-local-position"><small>МОЯ ПОЗИЦИЯ</small><strong>#{playerRank ?? player.rank}</strong><div><b>{player.name}</b><span>{player.alliance.name} [{player.alliance.tag}] · {player.sector}</span></div><em>{formatScore(getRatingScore(player, scoreKind))}<small>{meta.short}</small></em></section>;
  if (mode === 'alliances' && alliance) return <section className="rating-local-position"><small>МОЙ СОЮЗ</small><strong>#{allianceRank ?? alliance.rank}</strong><div><b>{alliance.name} [{alliance.tag}]</b><span>{alliance.members} участников</span></div><em>{formatScore(getRatingScore(alliance, scoreKind))}<small>{meta.short}</small></em></section>;
  return <section className="rating-local-position rating-local-position--empty">Локальная позиция недоступна.</section>;
}

export function RatingView({ command }: { command: CommandState }) {
  const model = useMemo(() => buildRatingFoundation(command), [command]);
  const [mode, setMode] = useState<RatingMode>('players');
  const [scoreKind, setScoreKind] = useState<RatingScoreKind>('total');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const rankedPlayers = useMemo(() => sortPlayerRows(model.players, 'score', scoreKind), [model.players, scoreKind]);
  const rankedAlliances = useMemo(() => sortAllianceRows(model.alliances, 'score', scoreKind), [model.alliances, scoreKind]);
  const visiblePlayers = useMemo(() => searchPlayerRows(rankedPlayers, search), [rankedPlayers, search]);
  const visibleAlliances = useMemo(() => searchAllianceRows(rankedAlliances, search), [rankedAlliances, search]);
  const activeRows = mode === 'players' ? visiblePlayers : visibleAlliances;
  const pageCount = Math.max(1, Math.ceil(activeRows.length / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pagePlayers = visiblePlayers.slice(pageStart, pageStart + PAGE_SIZE);
  const pageAlliances = visibleAlliances.slice(pageStart, pageStart + PAGE_SIZE);
  const localPlayer = getLocalPlayer(model.players);
  const localAlliance = getLocalAlliance(model.alliances);
  const localPlayerRank = localPlayer ? getDisplayedRank(model.players, localPlayer.id, scoreKind) ?? localPlayer.rank : null;
  const localAllianceRank = localAlliance ? getDisplayedRank(model.alliances, localAlliance.id, scoreKind) ?? localAlliance.rank : null;

  useEffect(() => {
    if (page >= pageCount) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  const switchMode = (next: RatingMode) => {
    setMode(next);
    setSearch('');
    setPage(0);
  };

  const selectScore = (next: RatingScoreKind) => {
    setScoreKind(next);
    setPage(0);
  };

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  return <main className="rating-view">
    <header className="utility-view-heading rating-heading"><div><small>ТАБЕЛЬ ИМПЕРИЙ · NEMEXIA RANKING STRUCTURE</small><h1>РЕЙТИНГ</h1><p>{model.season.label} · игроки и союзы · четыре реальных типа рейтинговых очков</p></div><div className="utility-truth-badge limited"><i />LOCAL FIXTURE</div></header>

    <nav className="rating-tabs" aria-label="Тип рейтинга"><button type="button" className={mode === 'players' ? 'active' : ''} onClick={() => switchMode('players')}><span>01</span><strong>ИГРОКИ</strong><small>{model.players.length} участников</small></button><button type="button" className={mode === 'alliances' ? 'active' : ''} onClick={() => switchMode('alliances')}><span>02</span><strong>СОЮЗЫ</strong><small>{model.alliances.length} объединений</small></button><div><small>СОСТОЯНИЕ</small><strong>{model.season.statusLabel}</strong></div></nav>

    <section className="rating-controlbar">
      <label className="rating-search"><span>ПОИСК</span><input value={search} onChange={(event) => updateSearch(event.target.value)} placeholder={mode === 'players' ? 'Игрок, союз или сектор…' : 'Название союза или тег…'}/><b>{activeRows.length}</b></label>
      <div className="rating-score-switcher">{SCORE_META.map((metric) => <button type="button" key={metric.id} className={scoreKind === metric.id ? 'active' : ''} onClick={() => selectScore(metric.id)}><ScoreGlyph kind={metric.id}/><span><strong>{metric.label}</strong><small>{metric.hint}</small></span></button>)}</div>
    </section>

    <section className="rating-table-panel">
      <header className="rating-table-title"><div><small>{mode === 'players' ? 'РЕЙТИНГ ИГРОКОВ' : 'РЕЙТИНГ СОЮЗОВ'}</small><strong>{SCORE_META.find((item) => item.id === scoreKind)?.label}</strong></div><span>Страница {page + 1} / {pageCount}</span></header>
      {mode === 'players' ? <><div className="rating-table-head rating-table-head--players"><span>МЕСТО</span><span>ИГРОК</span><span>СОЮЗ</span><ScoreHeader kind="achievement" active={scoreKind === 'achievement'} onSelect={() => selectScore('achievement')}/><ScoreHeader kind="total" active={scoreKind === 'total'} onSelect={() => selectScore('total')}/><ScoreHeader kind="resource" active={scoreKind === 'resource'} onSelect={() => selectScore('resource')}/><ScoreHeader kind="combat" active={scoreKind === 'combat'} onSelect={() => selectScore('combat')}/><span>ИЗМ.</span></div><div className="rating-table-body">{pagePlayers.map((row) => { const rank = getDisplayedRank(model.players, row.id, scoreKind) ?? row.rank; return <div key={row.id} className={`rating-row rating-row--players ${row.isLocal ? 'local' : ''}`}><b className="rating-place">{rank}</b><span className="rating-player-cell"><RatingMark tag={row.alliance.tag} local={row.isLocal}/><span><strong>{row.name}{row.id === ASTERION_LOCAL_PLAYER_ID ? <em>ВЫ</em> : null}</strong><small>{row.sector}</small></span></span><span className="rating-alliance-cell"><strong>{row.alliance.name}</strong><small>[{row.alliance.tag}]</small></span>{(['achievement', 'total', 'resource', 'combat'] as RatingScoreKind[]).map((kind) => <b key={kind} className={`rating-score ${scoreKind === kind ? 'active' : ''}`}>{formatScore(getRatingScore(row, kind))}</b>)}<RankDelta current={row.rank} previous={row.previousRank} enabled={scoreKind === 'total'}/></div>; })}</div></> : <><div className="rating-table-head rating-table-head--alliances"><span>МЕСТО</span><span>СОЮЗ</span><span>УЧ.</span><ScoreHeader kind="achievement" active={scoreKind === 'achievement'} onSelect={() => selectScore('achievement')}/><ScoreHeader kind="total" active={scoreKind === 'total'} onSelect={() => selectScore('total')}/><ScoreHeader kind="resource" active={scoreKind === 'resource'} onSelect={() => selectScore('resource')}/><ScoreHeader kind="combat" active={scoreKind === 'combat'} onSelect={() => selectScore('combat')}/><span>ИЗМ.</span></div><div className="rating-table-body">{pageAlliances.map((row) => { const rank = getDisplayedRank(model.alliances, row.id, scoreKind) ?? row.rank; return <div key={row.id} className={`rating-row rating-row--alliances ${row.isLocal ? 'local' : ''}`}><b className="rating-place">{rank}</b><span className="rating-player-cell"><RatingMark tag={row.tag} local={row.isLocal}/><span><strong>{row.name}{row.isLocal ? <em>ВАШ</em> : null}</strong><small>[{row.tag}]</small></span></span><b className="rating-members">{row.members}</b>{(['achievement', 'total', 'resource', 'combat'] as RatingScoreKind[]).map((kind) => <b key={kind} className={`rating-score ${scoreKind === kind ? 'active' : ''}`}>{formatScore(getRatingScore(row, kind))}</b>)}<RankDelta current={row.rank} previous={row.previousRank} enabled={scoreKind === 'total'}/></div>; })}</div></>}
      {!activeRows.length ? <div className="rating-empty">По текущему фильтру ничего не найдено.</div> : null}
      <footer className="rating-pagination"><button type="button" disabled={page <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>‹ НАЗАД</button><div>{Array.from({ length: pageCount }, (_, index) => <button type="button" key={index} className={index === page ? 'active' : ''} onClick={() => setPage(index)}>{index + 1}</button>)}</div><button type="button" disabled={page >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>ВПЕРЁД ›</button></footer>
    </section>

    <div className="rating-bottom">
      <LocalPosition mode={mode} player={localPlayer ?? null} alliance={localAlliance ?? null} scoreKind={scoreKind} playerRank={localPlayerRank} allianceRank={localAllianceRank}/>
      <section className="rating-data-truth"><div><small>DATA TRUTH</small><strong>DETERMINISTIC LOCAL FIXTURE</strong></div><p>Структура таблицы и типы очков повторяют сохранённый Nemexia Ranking. Общие очки = ресурсные + боевые; достижения идут отдельно. Серверный рейтинг и правила начисления пока не подключены.</p></section>
    </div>
  </main>;
}
