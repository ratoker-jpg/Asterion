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

const SCORE_META: ReadonlyArray<{ id: RatingScoreKind; label: string; short: string }> = [
  { id: 'total', label: 'Общие очки', short: 'ОБЩИЕ' },
  { id: 'resource', label: 'Ресурсные очки', short: 'РЕСУРСЫ' },
  { id: 'combat', label: 'Боевые очки', short: 'БОЕВЫЕ' },
  { id: 'achievement', label: 'Очки достижений', short: 'ДОСТИЖ.' },
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

function ScoreDeck({ row, active }: { row: PlayerRatingRow | AllianceRatingRow; active: RatingScoreKind }) {
  return <div className="rating-score-deck">{SCORE_META.map((metric) => <div key={metric.id} className={active === metric.id ? 'active' : ''}><span><ScoreGlyph kind={metric.id} /></span><small>{metric.label}</small><strong>{formatScore(getRatingScore(row, metric.id))}</strong></div>)}</div>;
}

function PlayerDossier({ row, scoreKind, rank }: { row: PlayerRatingRow; scoreKind: RatingScoreKind; rank: number }) {
  return <aside className="rating-dossier"><header><small>ПРОФИЛЬ ИГРОКА</small><span>{row.isLocal ? 'ВЫ' : 'FIXTURE'}</span></header><div className="rating-dossier-hero"><RatingMark tag={row.alliance.tag} local={row.isLocal} /><div><strong>{row.name}</strong><small>{row.sector}</small><em>{row.alliance.name} [{row.alliance.tag}]</em></div></div><div className="rating-dossier-rank"><span>МЕСТО · {SCORE_META.find((item) => item.id === scoreKind)?.short}</span><strong>#{rank}</strong><RankDelta current={row.rank} previous={row.previousRank} enabled={scoreKind === 'total'} /></div><ScoreDeck row={row} active={scoreKind} /><p>Общие очки считаются строго как ресурсные + боевые. Достижения идут отдельным показателем и в общую сумму не входят.</p></aside>;
}

function AllianceDossier({ row, scoreKind, rank }: { row: AllianceRatingRow; scoreKind: RatingScoreKind; rank: number }) {
  return <aside className="rating-dossier"><header><small>ПРОФИЛЬ СОЮЗА</small><span>{row.isLocal ? 'ВАШ СОЮЗ' : 'FIXTURE'}</span></header><div className="rating-dossier-hero"><RatingMark tag={row.tag} local={row.isLocal} /><div><strong>{row.name}</strong><small>[{row.tag}]</small><em>{row.members} участников</em></div></div><div className="rating-dossier-rank"><span>МЕСТО · {SCORE_META.find((item) => item.id === scoreKind)?.short}</span><strong>#{rank}</strong><RankDelta current={row.rank} previous={row.previousRank} enabled={scoreKind === 'total'} /></div><ScoreDeck row={row} active={scoreKind} /><p>Союзный рейтинг пока использует детерминированный локальный срез. Формулы начисления очков будут подключены отдельным игровым контрактом.</p></aside>;
}

function ScoreHeader({ kind, active, onSelect }: { kind: RatingScoreKind; active: boolean; onSelect: () => void }) {
  const meta = SCORE_META.find((item) => item.id === kind)!;
  return <button type="button" className={`rating-score-head ${active ? 'active' : ''}`} onClick={onSelect} title={meta.label}><ScoreGlyph kind={kind} /><span>{meta.short}</span><b>↓</b></button>;
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
  const selectedPlayer = visiblePlayers.find((row) => row.id === selectedPlayerId) ?? visiblePlayers[0] ?? null;
  const selectedAlliance = visibleAlliances.find((row) => row.id === selectedAllianceId) ?? visibleAlliances[0] ?? null;
  const localPlayer = getLocalPlayer(model.players);
  const localAlliance = getLocalAlliance(model.alliances);

  useEffect(() => {
    if (mode === 'players' && selectedPlayer && selectedPlayer.id !== selectedPlayerId) setSelectedPlayerId(selectedPlayer.id);
    if (mode === 'alliances' && selectedAlliance && selectedAlliance.id !== selectedAllianceId) setSelectedAllianceId(selectedAlliance.id);
  }, [mode, selectedAlliance, selectedAllianceId, selectedPlayer, selectedPlayerId]);

  const switchMode = (next: RatingMode) => {
    setMode(next);
    setSearch('');
  };

  const localPlayerRank = localPlayer ? getDisplayedRank(model.players, localPlayer.id, scoreKind) ?? localPlayer.rank : null;
  const localAllianceRank = localAlliance ? getDisplayedRank(model.alliances, localAlliance.id, scoreKind) ?? localAlliance.rank : null;

  return <main className="rating-view">
    <header className="utility-view-heading rating-heading"><div><small>РЕЙТИНГ ИМПЕРИЙ</small><h1>РЕЙТИНГ</h1><p>{model.season.label} · выбери тип очков — таблица перестроится по нему</p></div><div className="utility-truth-badge limited"><i />DETERMINISTIC FIXTURE</div></header>

    <div className="rating-tabs"><button type="button" className={mode === 'players' ? 'active' : ''} onClick={() => switchMode('players')}>ИГРОКИ</button><button type="button" className={mode === 'alliances' ? 'active' : ''} onClick={() => switchMode('alliances')}>СОЮЗЫ</button><span>{model.season.statusLabel}</span></div>

    <section className="rating-score-switcher" aria-label="Тип рейтинговых очков">{SCORE_META.map((metric) => <button type="button" key={metric.id} className={scoreKind === metric.id ? 'active' : ''} onClick={() => setScoreKind(metric.id)}><ScoreGlyph kind={metric.id} /><span><strong>{metric.label}</strong><small>{metric.id === 'total' ? 'Ресурсные + боевые' : metric.id === 'achievement' ? 'Не входят в общие' : 'Отдельный рейтинг'}</small></span></button>)}</section>

    <div className="rating-layout">
      <aside className="rating-filters"><header>ФИЛЬТРЫ</header><label><small>ПОИСК</small><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={mode === 'players' ? 'Игрок, союз, сектор…' : 'Союз или тег…'} /></label><div className="rating-active-filter"><small>АКТИВНЫЙ РЕЙТИНГ</small><span><ScoreGlyph kind={scoreKind} /></span><strong>{SCORE_META.find((item) => item.id === scoreKind)?.label}</strong><p>{scoreKind === 'total' ? 'Общие = ресурсные + боевые.' : scoreKind === 'achievement' ? 'Достижения считаются отдельно.' : 'Таблица отсортирована по выбранному типу очков.'}</p></div><div className="rating-source-note"><b>DATA TRUTH</b><span>Числа пока локальный fixture. Структура четырёх типов очков зафиксирована; правила начисления будут добавлены позже.</span></div></aside>

      <section className="rating-table-panel">
        {mode === 'players' ? <><div className="rating-table-head rating-table-head--players"><span>МЕСТО</span><span>ИГРОК</span><span>СОЮЗ</span><ScoreHeader kind="achievement" active={scoreKind === 'achievement'} onSelect={() => setScoreKind('achievement')} /><ScoreHeader kind="total" active={scoreKind === 'total'} onSelect={() => setScoreKind('total')} /><ScoreHeader kind="resource" active={scoreKind === 'resource'} onSelect={() => setScoreKind('resource')} /><ScoreHeader kind="combat" active={scoreKind === 'combat'} onSelect={() => setScoreKind('combat')} /><span>ИЗМ.</span></div><div className="rating-table-body">{visiblePlayers.map((row) => { const rank = getDisplayedRank(model.players, row.id, scoreKind) ?? row.rank; return <button type="button" key={row.id} className={`rating-row rating-row--players ${row.isLocal ? 'local' : ''} ${selectedPlayer?.id === row.id ? 'active' : ''}`} onClick={() => setSelectedPlayerId(row.id)}><b className="rating-place">{rank}</b><span className="rating-player-cell"><RatingMark tag={row.alliance.tag} local={row.isLocal} /><span><strong>{row.name}{row.isLocal ? <em>ВЫ</em> : null}</strong><small>{row.sector}</small></span></span><span className="rating-alliance-cell"><strong>{row.alliance.name}</strong><small>[{row.alliance.tag}]</small></span>{(['achievement', 'total', 'resource', 'combat'] as RatingScoreKind[]).map((kind) => <b key={kind} className={`rating-score ${scoreKind === kind ? 'active' : ''}`}>{formatScore(getRatingScore(row, kind))}</b>)}<RankDelta current={row.rank} previous={row.previousRank} enabled={scoreKind === 'total'} /></button>; })}</div></> : <><div className="rating-table-head rating-table-head--alliances"><span>МЕСТО</span><span>СОЮЗ</span><span>УЧ.</span><ScoreHeader kind="achievement" active={scoreKind === 'achievement'} onSelect={() => setScoreKind('achievement')} /><ScoreHeader kind="total" active={scoreKind === 'total'} onSelect={() => setScoreKind('total')} /><ScoreHeader kind="resource" active={scoreKind === 'resource'} onSelect={() => setScoreKind('resource')} /><ScoreHeader kind="combat" active={scoreKind === 'combat'} onSelect={() => setScoreKind('combat')} /><span>ИЗМ.</span></div><div className="rating-table-body">{visibleAlliances.map((row) => { const rank = getDisplayedRank(model.alliances, row.id, scoreKind) ?? row.rank; return <button type="button" key={row.id} className={`rating-row rating-row--alliances ${row.isLocal ? 'local' : ''} ${selectedAlliance?.id === row.id ? 'active' : ''}`} onClick={() => setSelectedAllianceId(row.id)}><b className="rating-place">{rank}</b><span className="rating-player-cell"><RatingMark tag={row.tag} local={row.isLocal} /><span><strong>{row.name}{row.isLocal ? <em>ВАШ</em> : null}</strong><small>[{row.tag}]</small></span></span><b>{row.members}</b>{(['achievement', 'total', 'resource', 'combat'] as RatingScoreKind[]).map((kind) => <b key={kind} className={`rating-score ${scoreKind === kind ? 'active' : ''}`}>{formatScore(getRatingScore(row, kind))}</b>)}<RankDelta current={row.rank} previous={row.previousRank} enabled={scoreKind === 'total'} /></button>; })}</div></>}
        {((mode === 'players' && !visiblePlayers.length) || (mode === 'alliances' && !visibleAlliances.length)) ? <div className="rating-empty">По текущему фильтру ничего не найдено.</div> : null}
      </section>

      {mode === 'players' ? (selectedPlayer ? <PlayerDossier row={selectedPlayer} scoreKind={scoreKind} rank={getDisplayedRank(model.players, selectedPlayer.id, scoreKind) ?? selectedPlayer.rank} /> : <div className="rating-dossier" />) : (selectedAlliance ? <AllianceDossier row={selectedAlliance} scoreKind={scoreKind} rank={getDisplayedRank(model.alliances, selectedAlliance.id, scoreKind) ?? selectedAlliance.rank} /> : <div className="rating-dossier" />)}
    </div>

    <footer className="rating-bottom">
      <section className="rating-my-place"><small>МОЁ МЕСТО</small>{localPlayer && localPlayerRank ? <><strong>#{localPlayerRank}</strong><span>{localPlayer.name}<em>{formatScore(getRatingScore(localPlayer, scoreKind))} · {SCORE_META.find((item) => item.id === scoreKind)?.short}</em></span><RankDelta current={localPlayer.rank} previous={localPlayer.previousRank} enabled={scoreKind === 'total'} /></> : null}</section>
      <section className="rating-alliance-strip"><header><small>РЕЙТИНГ СОЮЗОВ · {SCORE_META.find((item) => item.id === scoreKind)?.short}</small>{localAllianceRank ? <b>Ваш союз: #{localAllianceRank}</b> : null}</header><div>{rankedAlliances.slice(0, 5).map((row, index) => <button type="button" key={row.id} onClick={() => { setMode('alliances'); setSearch(''); setSelectedAllianceId(row.id); }}><span>#{index + 1}</span><RatingMark tag={row.tag} /><strong>{row.name}<small>{formatScore(getRatingScore(row, scoreKind))}</small></strong></button>)}</div></section>
    </footer>
  </main>;
}
