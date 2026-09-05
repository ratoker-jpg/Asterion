import { useMemo, useState } from 'react';

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

const SCORE_META: ReadonlyArray<{ id: RatingScoreKind; label: string; short: string }> = [
  { id: 'achievement', label: 'Очки достижений', short: 'ДОСТИЖ.' },
  { id: 'total', label: 'Общие очки', short: 'ОБЩИЕ' },
  { id: 'resource', label: 'Ресурсные очки', short: 'РЕСУРСЫ' },
  { id: 'combat', label: 'Боевые очки', short: 'БОЕВЫЕ' },
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

function RatingMark({ tag, local = false }: { tag: string; local?: boolean }) {
  return <span className={`rating-mark ${local ? 'local' : ''}`} aria-hidden="true"><i /><b>{tag.slice(0, 2)}</b></span>;
}

function RankDelta({ current, previous, enabled }: { current: number; previous: number; enabled: boolean }) {
  if (!enabled) return null;
  const delta = getRankDelta(current, previous);
  if (!delta) return <small className="rating-place-delta same">—</small>;
  return <small className={`rating-place-delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</small>;
}

function ScoreHeader({ kind, active, onSelect }: { kind: RatingScoreKind; active: boolean; onSelect: () => void }) {
  const meta = SCORE_META.find((item) => item.id === kind)!;
  return <button type="button" className={`rating-score-head ${active ? 'active' : ''}`} onClick={onSelect} title={meta.label}><ScoreGlyph kind={kind} /><span>{meta.short}</span><b>{active ? '▼' : ''}</b></button>;
}

function SelectedPlayer({ row, scoreKind, rank }: { row: PlayerRatingRow; scoreKind: RatingScoreKind; rank: number }) {
  return <section className="rating-selected-card"><header><small>ВЫБРАННЫЙ ИГРОК</small><span>{row.isLocal ? 'ВЫ' : 'LOCAL FIXTURE'}</span></header><div className="rating-selected-main"><RatingMark tag={row.alliance.tag} local={row.isLocal} /><div><strong>{row.name}</strong><small>{row.sector}</small><em>{row.alliance.name} [{row.alliance.tag}]</em></div><b>#{rank}</b></div><div className="rating-selected-scores">{SCORE_META.map((metric) => <span key={metric.id} className={metric.id === scoreKind ? 'active' : ''}><ScoreGlyph kind={metric.id} /><small>{metric.short}</small><strong>{formatScore(getRatingScore(row, metric.id))}</strong></span>)}</div></section>;
}

function SelectedAlliance({ row, scoreKind, rank }: { row: AllianceRatingRow; scoreKind: RatingScoreKind; rank: number }) {
  return <section className="rating-selected-card"><header><small>ВЫБРАННЫЙ СОЮЗ</small><span>{row.isLocal ? 'ВАШ СОЮЗ' : 'LOCAL FIXTURE'}</span></header><div className="rating-selected-main"><RatingMark tag={row.tag} local={row.isLocal} /><div><strong>{row.name}</strong><small>[{row.tag}]</small><em>{row.members} участников</em></div><b>#{rank}</b></div><div className="rating-selected-scores">{SCORE_META.map((metric) => <span key={metric.id} className={metric.id === scoreKind ? 'active' : ''}><ScoreGlyph kind={metric.id} /><small>{metric.short}</small><strong>{formatScore(getRatingScore(row, metric.id))}</strong></span>)}</div></section>;
}

export function RatingView({ command }: { command: CommandState }) {
  const model = useMemo(() => buildRatingFoundation(command), [command]);
  const [mode, setMode] = useState<RatingMode>('players');
  const [scoreKind, setScoreKind] = useState<RatingScoreKind>('total');
  const [search, setSearch] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState(ASTERION_LOCAL_PLAYER_ID);
  const [selectedAllianceId, setSelectedAllianceId] = useState('rating-alliance-local');

  const rankedPlayers = useMemo(() => sortPlayerRows(model.players, 'score', scoreKind), [model.players, scoreKind]);
  const rankedAlliances = useMemo(() => sortAllianceRows(model.alliances, 'score', scoreKind), [model.alliances, scoreKind]);
  const visiblePlayers = useMemo(() => searchPlayerRows(rankedPlayers, search), [rankedPlayers, search]);
  const visibleAlliances = useMemo(() => searchAllianceRows(rankedAlliances, search), [rankedAlliances, search]);
  const selectedPlayer = model.players.find((row) => row.id === selectedPlayerId) ?? getLocalPlayer(model.players) ?? model.players[0] ?? null;
  const selectedAlliance = model.alliances.find((row) => row.id === selectedAllianceId) ?? getLocalAlliance(model.alliances) ?? model.alliances[0] ?? null;
  const localPlayer = getLocalPlayer(model.players);
  const localAlliance = getLocalAlliance(model.alliances);

  const switchMode = (next: RatingMode) => {
    setMode(next);
    setSearch('');
    if (next === 'players' && localPlayer) setSelectedPlayerId(localPlayer.id);
    if (next === 'alliances' && localAlliance) setSelectedAllianceId(localAlliance.id);
  };

  const showMyPosition = () => {
    setSearch('');
    const local = mode === 'players' ? localPlayer : localAlliance;
    if (!local) return;
    if (mode === 'players') setSelectedPlayerId(local.id);
    else setSelectedAllianceId(local.id);
    requestAnimationFrame(() => document.getElementById(`rating-row-${local.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  const totalVisible = mode === 'players' ? visiblePlayers.length : visibleAlliances.length;
  const totalRows = mode === 'players' ? model.players.length : model.alliances.length;

  return <main className="rating-view">
    <header className="utility-view-heading rating-heading"><div><small>NEMEXIA RANKING PATTERN · ASTERION DATA FOUNDATION</small><h1>РЕЙТИНГ</h1><p>{model.season.label} · таблица, поиск и сортировка по тем же четырём типам очков</p></div><div className="utility-truth-badge limited"><i />LOCAL FIXTURE</div></header>

    <nav className="rating-tabs"><button type="button" className={mode === 'players' ? 'active' : ''} onClick={() => switchMode('players')}>ИГРОКИ</button><button type="button" className={mode === 'alliances' ? 'active' : ''} onClick={() => switchMode('alliances')}>АЛЬЯНСЫ</button><span>ЧЕМПИОНАТЫ</span><span>ЗАЛ СЛАВЫ</span></nav>

    <section className="rating-controls"><label><span>ПОИСК</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={mode === 'players' ? 'Игрок, альянс, сектор…' : 'Альянс или тег…'} /></label><button type="button" onClick={showMyPosition}>ПОКАЗАТЬ МОЮ ПОЗИЦИЮ</button><div><small>ПОКАЗАНО</small><strong>{totalVisible} / {totalRows}</strong></div><div className="rating-sort-status"><small>СОРТИРОВКА</small><strong>{SCORE_META.find((metric) => metric.id === scoreKind)?.label}</strong></div></section>

    <section className="rating-table-panel">
      {mode === 'players' ? <>
        <div className="rating-table-head rating-grid--players"><span>МЕСТО</span><span>ИГРОК</span><span>АЛЬЯНС</span><ScoreHeader kind="achievement" active={scoreKind === 'achievement'} onSelect={() => setScoreKind('achievement')} /><ScoreHeader kind="total" active={scoreKind === 'total'} onSelect={() => setScoreKind('total')} /><ScoreHeader kind="resource" active={scoreKind === 'resource'} onSelect={() => setScoreKind('resource')} /><ScoreHeader kind="combat" active={scoreKind === 'combat'} onSelect={() => setScoreKind('combat')} /></div>
        <div className="rating-table-body">{visiblePlayers.map((row) => { const rank = getDisplayedRank(model.players, row.id, scoreKind) ?? row.rank; return <button id={`rating-row-${row.id}`} type="button" key={row.id} className={`rating-row rating-grid--players ${row.isLocal ? 'local' : ''} ${selectedPlayer?.id === row.id ? 'active' : ''}`} onClick={() => setSelectedPlayerId(row.id)}><span className="rating-place"><b>{rank}</b><RankDelta current={row.rank} previous={row.previousRank} enabled={scoreKind === 'total'} /></span><span className="rating-player-cell"><RatingMark tag={row.alliance.tag} local={row.isLocal} /><span><strong>{row.name}{row.isLocal ? <em>ВЫ</em> : null}</strong><small>{row.sector}</small></span></span><span className="rating-alliance-cell"><strong>{row.alliance.name}</strong><small>[{row.alliance.tag}]</small></span>{SCORE_META.map((metric) => <b key={metric.id} className={`rating-score ${scoreKind === metric.id ? 'active' : ''}`}>{formatScore(getRatingScore(row, metric.id))}</b>)}</button>; })}</div>
      </> : <>
        <div className="rating-table-head rating-grid--alliances"><span>МЕСТО</span><span>АЛЬЯНС</span><span>УЧ.</span><ScoreHeader kind="achievement" active={scoreKind === 'achievement'} onSelect={() => setScoreKind('achievement')} /><ScoreHeader kind="total" active={scoreKind === 'total'} onSelect={() => setScoreKind('total')} /><ScoreHeader kind="resource" active={scoreKind === 'resource'} onSelect={() => setScoreKind('resource')} /><ScoreHeader kind="combat" active={scoreKind === 'combat'} onSelect={() => setScoreKind('combat')} /></div>
        <div className="rating-table-body">{visibleAlliances.map((row) => { const rank = getDisplayedRank(model.alliances, row.id, scoreKind) ?? row.rank; return <button id={`rating-row-${row.id}`} type="button" key={row.id} className={`rating-row rating-grid--alliances ${row.isLocal ? 'local' : ''} ${selectedAlliance?.id === row.id ? 'active' : ''}`} onClick={() => setSelectedAllianceId(row.id)}><span className="rating-place"><b>{rank}</b><RankDelta current={row.rank} previous={row.previousRank} enabled={scoreKind === 'total'} /></span><span className="rating-player-cell"><RatingMark tag={row.tag} local={row.isLocal} /><span><strong>{row.name}{row.isLocal ? <em>ВАШ</em> : null}</strong><small>[{row.tag}]</small></span></span><b className="rating-members">{row.members}</b>{SCORE_META.map((metric) => <b key={metric.id} className={`rating-score ${scoreKind === metric.id ? 'active' : ''}`}>{formatScore(getRatingScore(row, metric.id))}</b>)}</button>; })}</div>
      </>}
      {!totalVisible ? <div className="rating-empty">По текущему запросу ничего не найдено.</div> : null}
    </section>

    <div className="rating-lower-grid">
      {mode === 'players' ? (selectedPlayer ? <SelectedPlayer row={selectedPlayer} scoreKind={scoreKind} rank={getDisplayedRank(model.players, selectedPlayer.id, scoreKind) ?? selectedPlayer.rank} /> : null) : (selectedAlliance ? <SelectedAlliance row={selectedAlliance} scoreKind={scoreKind} rank={getDisplayedRank(model.alliances, selectedAlliance.id, scoreKind) ?? selectedAlliance.rank} /> : null)}
      <section className="rating-source-card"><header><small>DATA TRUTH</small><span>NEMEXIA UI SEMANTICS</span></header><p>Nemexia подтверждает четыре колонки рейтинга: достижения, общие, ресурсные и боевые очки. В Asterion значения пока детерминированные локальные fixtures: реального multiplayer leaderboard и формулы начисления ещё нет.</p><div><span>ОБЩИЕ = РЕСУРСНЫЕ + БОЕВЫЕ</span><b>ДОСТИЖЕНИЯ ОТДЕЛЬНО</b></div></section>
    </div>
  </main>;
}
