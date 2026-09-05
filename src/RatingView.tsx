import { useEffect, useMemo, useState } from 'react';

import { ASTERION_LOCAL_PLAYER_ID } from './domain/combat/report.ts';
import type { CommandState } from './domain/command/types.ts';
import {
  buildRatingFoundation,
  getLocalAlliance,
  getLocalPlayer,
  getRankDelta,
  searchAllianceRows,
  searchPlayerRows,
  sortAllianceRows,
  sortPlayerRows,
} from './domain/rating/selectors.ts';
import type { AllianceRatingRow, PlayerRatingRow, RatingMode, RatingSort } from './domain/rating/types.ts';
import './rating.css';

function formatScore(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function RankDelta({ current, previous }: { current: number; previous: number }) {
  const delta = getRankDelta(current, previous);
  if (delta === 0) return <span className="rating-delta rating-delta--same">—</span>;
  return <span className={`rating-delta ${delta > 0 ? 'rating-delta--up' : 'rating-delta--down'}`}>{delta > 0 ? '↑' : '↓'} {Math.abs(delta)}</span>;
}

function RatingMark({ tag, local = false }: { tag: string; local?: boolean }) {
  return <span className={`rating-mark ${local ? 'local' : ''}`} aria-hidden="true"><i /><b>{tag.slice(0, 2)}</b></span>;
}

function PlayerDossier({ row }: { row: PlayerRatingRow }) {
  return <aside className="rating-dossier"><header><small>ПРОФИЛЬ ИГРОКА</small><span>{row.isLocal ? 'ВЫ' : 'FIXTURE'}</span></header><div className="rating-dossier-hero"><RatingMark tag={row.alliance.tag} local={row.isLocal} /><div><strong>{row.name}</strong><small>{row.sector}</small><em>{row.alliance.name} [{row.alliance.tag}]</em></div></div><dl><div><dt>Место</dt><dd>#{row.rank}</dd></div><div><dt>Очки</dt><dd>{formatScore(row.score)}</dd></div><div><dt>Изменение</dt><dd><RankDelta current={row.rank} previous={row.previousRank} /></dd></div><div><dt>Источник</dt><dd>Local fixture</dd></div></dl><p>Ranking v1 не содержит серверной формулы, winrate, силы флота или экономики. Панель показывает только поля foundation read-model.</p></aside>;
}

function AllianceDossier({ row }: { row: AllianceRatingRow }) {
  return <aside className="rating-dossier"><header><small>ПРОФИЛЬ СОЮЗА</small><span>{row.isLocal ? 'ВАШ СОЮЗ' : 'FIXTURE'}</span></header><div className="rating-dossier-hero"><RatingMark tag={row.tag} local={row.isLocal} /><div><strong>{row.name}</strong><small>[{row.tag}]</small><em>{row.members} участников</em></div></div><dl><div><dt>Место</dt><dd>#{row.rank}</dd></div><div><dt>Очки</dt><dd>{formatScore(row.score)}</dd></div><div><dt>Изменение</dt><dd><RankDelta current={row.rank} previous={row.previousRank} /></dd></div><div><dt>Источник</dt><dd>Local fixture</dd></div></dl><p>Название и тег вашего союза берутся из текущего CommandState. Очки и позиция остаются детерминированным fixture до появления canonical scoring/backend.</p></aside>;
}

export function RatingView({ command }: { command: CommandState }) {
  const model = useMemo(() => buildRatingFoundation(command), [command]);
  const [mode, setMode] = useState<RatingMode>('players');
  const [sort, setSort] = useState<RatingSort>('rank');
  const [search, setSearch] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState(ASTERION_LOCAL_PLAYER_ID);
  const [selectedAllianceId, setSelectedAllianceId] = useState('rating-alliance-local');

  const visiblePlayers = useMemo(() => sortPlayerRows(searchPlayerRows(model.players, search), sort), [model.players, search, sort]);
  const visibleAlliances = useMemo(() => sortAllianceRows(searchAllianceRows(model.alliances, search), sort), [model.alliances, search, sort]);
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

  return <main className="rating-view">
    <header className="utility-view-heading rating-heading"><div><small>ЛОКАЛЬНЫЙ READ-MODEL</small><h1>РЕЙТИНГ</h1><p>{model.season.label} · серверный leaderboard и формула очков ещё не подключены</p></div><div className="utility-truth-badge limited"><i />DETERMINISTIC FIXTURE</div></header>

    <div className="rating-tabs"><button type="button" className={mode === 'players' ? 'active' : ''} onClick={() => switchMode('players')}>ИГРОКИ</button><button type="button" className={mode === 'alliances' ? 'active' : ''} onClick={() => switchMode('alliances')}>СОЮЗЫ</button><span>{model.season.statusLabel}</span></div>

    <div className="rating-layout">
      <aside className="rating-filters"><header>ФИЛЬТРЫ</header><label><small>ПОИСК</small><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={mode === 'players' ? 'Игрок, союз, сектор…' : 'Союз или тег…'} /></label><div className="rating-sort"><small>СОРТИРОВКА</small><button type="button" className={sort === 'rank' ? 'active' : ''} onClick={() => setSort('rank')}>ПО МЕСТУ</button><button type="button" className={sort === 'score' ? 'active' : ''} onClick={() => setSort('score')}>ПО ОЧКАМ</button></div><div className="rating-source-note"><b>DATA TRUTH</b><span>Таблица — локальный deterministic fixture. Название/tag вашего союза синхронизируются с Командованием.</span></div></aside>

      <section className="rating-table-panel">
        {mode === 'players' ? <><div className="rating-table-head rating-table-head--players"><span>МЕСТО</span><span>ИГРОК</span><span>СОЮЗ</span><span>ОЧКИ</span><span>ИЗМЕНЕНИЕ</span></div><div className="rating-table-body">{visiblePlayers.map((row) => <button type="button" key={row.id} className={`rating-row rating-row--players ${row.isLocal ? 'local' : ''} ${selectedPlayer?.id === row.id ? 'active' : ''}`} onClick={() => setSelectedPlayerId(row.id)}><b className="rating-place">{row.rank}</b><span className="rating-player-cell"><RatingMark tag={row.alliance.tag} local={row.isLocal} /><span><strong>{row.name}{row.isLocal ? <em>ВЫ</em> : null}</strong><small>{row.sector}</small></span></span><span className="rating-alliance-cell"><strong>{row.alliance.name}</strong><small>[{row.alliance.tag}]</small></span><b className="rating-score">{formatScore(row.score)}</b><RankDelta current={row.rank} previous={row.previousRank} /></button>)}</div></> : <><div className="rating-table-head rating-table-head--alliances"><span>МЕСТО</span><span>СОЮЗ</span><span>УЧАСТНИКИ</span><span>ОЧКИ</span><span>ИЗМЕНЕНИЕ</span></div><div className="rating-table-body">{visibleAlliances.map((row) => <button type="button" key={row.id} className={`rating-row rating-row--alliances ${row.isLocal ? 'local' : ''} ${selectedAlliance?.id === row.id ? 'active' : ''}`} onClick={() => setSelectedAllianceId(row.id)}><b className="rating-place">{row.rank}</b><span className="rating-player-cell"><RatingMark tag={row.tag} local={row.isLocal} /><span><strong>{row.name}{row.isLocal ? <em>ВАШ</em> : null}</strong><small>[{row.tag}]</small></span></span><b>{row.members}</b><b className="rating-score">{formatScore(row.score)}</b><RankDelta current={row.rank} previous={row.previousRank} /></button>)}</div></>}
        {((mode === 'players' && !visiblePlayers.length) || (mode === 'alliances' && !visibleAlliances.length)) ? <div className="rating-empty">По текущему фильтру ничего не найдено.</div> : null}
      </section>

      {mode === 'players' ? (selectedPlayer ? <PlayerDossier row={selectedPlayer} /> : <div className="rating-dossier" />) : (selectedAlliance ? <AllianceDossier row={selectedAlliance} /> : <div className="rating-dossier" />)}
    </div>

    <footer className="rating-bottom">
      <section className="rating-my-place"><small>МОЁ МЕСТО</small>{localPlayer ? <><strong>#{localPlayer.rank}</strong><span>{localPlayer.name}<em>{formatScore(localPlayer.score)} очков</em></span><RankDelta current={localPlayer.rank} previous={localPlayer.previousRank} /></> : null}</section>
      <section className="rating-alliance-strip"><header><small>РЕЙТИНГ СОЮЗОВ</small>{localAlliance ? <b>Ваш союз: #{localAlliance.rank}</b> : null}</header><div>{model.alliances.slice(0, 5).map((row) => <button type="button" key={row.id} onClick={() => { setMode('alliances'); setSelectedAllianceId(row.id); }}><span>#{row.rank}</span><RatingMark tag={row.tag} /><strong>{row.name}<small>{formatScore(row.score)}</small></strong></button>)}</div></section>
    </footer>
  </main>;
}
