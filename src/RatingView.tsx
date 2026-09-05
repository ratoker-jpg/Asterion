import { useMemo, useState } from 'react';
import { createAllianceRatingEntries, createPlayerRatingEntries } from './domain/rating/fixtures.ts';
import {
  filterAlliances,
  filterPlayers,
  pageForEntry,
  paginate,
  sortAlliances,
  sortPlayers,
} from './domain/rating/selectors.ts';
import type {
  AllianceIdentity,
  AllianceRatingEntry,
  AllianceScoreKey,
  PlayerRatingEntry,
  PlayerScoreKey,
  RatingMode,
  SortDirection,
} from './domain/rating/types.ts';

const PAGE_SIZE = 12;

export function RatingView({ currentAlliance }: { currentAlliance?: AllianceIdentity | null }) {
  const [mode, setMode] = useState<RatingMode>('players');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [playerSort, setPlayerSort] = useState<PlayerScoreKey>('totalPoints');
  const [allianceSort, setAllianceSort] = useState<AllianceScoreKey>('alliancePoints');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const players = useMemo(() => createPlayerRatingEntries(), []);
  const alliances = useMemo(() => createAllianceRatingEntries(currentAlliance), [currentAlliance]);

  const playerResults = useMemo(
    () => sortPlayers(filterPlayers(players, query), playerSort, direction),
    [players, query, playerSort, direction],
  );
  const allianceResults = useMemo(
    () => sortAlliances(filterAlliances(alliances, query), allianceSort, direction),
    [alliances, query, allianceSort, direction],
  );

  const results = mode === 'players'
    ? paginate(playerResults, page, PAGE_SIZE)
    : paginate(allianceResults, page, PAGE_SIZE);

  const changeMode = (next: RatingMode) => {
    setMode(next);
    setPage(1);
    setQuery('');
    setSelectedId(null);
    setDirection('desc');
  };

  const changeQuery = (value: string) => {
    setQuery(value);
    setPage(1);
    setSelectedId(null);
  };

  const sortPlayer = (key: PlayerScoreKey) => {
    if (playerSort === key) setDirection((current) => current === 'desc' ? 'asc' : 'desc');
    else {
      setPlayerSort(key);
      setDirection('desc');
    }
    setPage(1);
  };

  const sortAlliance = (key: AllianceScoreKey) => {
    if (allianceSort === key) setDirection((current) => current === 'desc' ? 'asc' : 'desc');
    else {
      setAllianceSort(key);
      setDirection('desc');
    }
    setPage(1);
  };

  const showMyPosition = () => {
    setQuery('');
    setSelectedId(null);
    if (mode === 'players') {
      const clean = sortPlayers(players, playerSort, direction);
      setPage(pageForEntry(clean, PAGE_SIZE, (entry) => entry.isCurrentPlayer));
    } else {
      const clean = sortAlliances(alliances, allianceSort, direction);
      setPage(pageForEntry(clean, PAGE_SIZE, (entry) => entry.isCurrentAlliance));
    }
  };

  const selected = mode === 'players'
    ? players.find((entry) => entry.id === selectedId) ?? null
    : alliances.find((entry) => entry.id === selectedId) ?? null;

  return (
    <div className="utility-view rating-view-v2">
      <header className="rating-heading-v2">
        <div>
          <small className="utility-secondary">СТАТИСТИКА ГАЛАКТИКИ</small>
          <h1 className="utility-page-title">РЕЙТИНГ</h1>
        </div>
        <div className="rating-mode-tabs-v2" role="tablist" aria-label="Режим рейтинга">
          <button type="button" className={`utility-control ${mode === 'players' ? 'active' : ''}`} onClick={() => changeMode('players')}>ИГРОКИ</button>
          <button type="button" className={`utility-control ${mode === 'alliances' ? 'active' : ''}`} onClick={() => changeMode('alliances')}>АЛЬЯНСЫ</button>
          <button type="button" className="utility-control" disabled>ЧЕМПИОНАТЫ</button>
          <button type="button" className="utility-control" disabled>ЗАЛ СЛАВЫ</button>
        </div>
      </header>

      <section className="rating-toolbar-v2">
        <label className="rating-search-v2">
          <span>⌕</span>
          <input
            className="utility-control"
            value={query}
            onChange={(event: { target: { value: string } }) => changeQuery(event.target.value)}
            placeholder={mode === 'players' ? 'Найти игрока или альянс' : 'Найти альянс или тег'}
            aria-label="Поиск по рейтингу"
          />
        </label>
        <button type="button" className="utility-control rating-self-v2" onClick={showMyPosition}>ПОКАЗАТЬ МОЮ ПОЗИЦИЮ</button>
      </section>

      <section className="rating-panel-v2">
        <div className="rating-meta-v2">
          <span className="utility-secondary">Показано {results.items.length} из {results.total} результатов</span>
          <Pagination page={results.page} pageCount={results.pageCount} onPage={setPage} />
        </div>

        {mode === 'players' ? (
          <PlayerTable
            entries={results.items as PlayerRatingEntry[]}
            selectedId={selectedId}
            sortKey={playerSort}
            direction={direction}
            onSelect={setSelectedId}
            onSort={sortPlayer}
          />
        ) : (
          <AllianceTable
            entries={results.items as AllianceRatingEntry[]}
            selectedId={selectedId}
            sortKey={allianceSort}
            direction={direction}
            onSelect={setSelectedId}
            onSort={sortAlliance}
          />
        )}

        <div className="rating-bottom-v2">
          <Pagination page={results.page} pageCount={results.pageCount} onPage={setPage} />
          <SelectionStrip selected={selected} />
        </div>
      </section>
    </div>
  );
}

function PlayerTable({
  entries,
  selectedId,
  sortKey,
  direction,
  onSelect,
  onSort,
}: {
  entries: readonly PlayerRatingEntry[];
  selectedId: string | null;
  sortKey: PlayerScoreKey;
  direction: SortDirection;
  onSelect: (id: string) => void;
  onSort: (key: PlayerScoreKey) => void;
}) {
  return (
    <div className="rating-table-v2 rating-table-v2--players" role="table" aria-label="Рейтинг игроков">
      <div className="rating-row-v2 rating-head-v2" role="row">
        <span>МЕСТО</span><span>ИГРОК</span><span>АЛЬЯНС</span>
        <ScoreHead label="ДОСТИЖ." scoreKey="achievementPoints" selected={sortKey === 'achievementPoints'} direction={direction} onSort={onSort} />
        <ScoreHead label="ОБЩИЕ" scoreKey="totalPoints" selected={sortKey === 'totalPoints'} direction={direction} onSort={onSort} />
        <ScoreHead label="РЕСУРС." scoreKey="resourcePoints" selected={sortKey === 'resourcePoints'} direction={direction} onSort={onSort} />
        <ScoreHead label="БОЕВЫЕ" scoreKey="battlePoints" selected={sortKey === 'battlePoints'} direction={direction} onSort={onSort} />
      </div>
      {entries.map((entry) => (
        <button
          type="button"
          role="row"
          key={entry.id}
          className={[
            'rating-row-v2',
            entry.rank <= 3 ? `top-${entry.rank}` : '',
            entry.isCurrentPlayer ? 'current' : '',
            selectedId === entry.id ? 'selected' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => onSelect(entry.id)}
        >
          <span className="rank-v2"><b>{entry.rank}</b></span>
          <span className="identity-v2"><RaceEmblem race={entry.race} /><strong className="utility-data-text">{entry.name}</strong></span>
          <span className="alliance-tag-v2">{entry.allianceTag ? `[${entry.allianceTag}]` : '—'}</span>
          <Value value={entry.achievementPoints} />
          <Value value={entry.totalPoints} />
          <Value value={entry.resourcePoints} />
          <Value value={entry.battlePoints} />
        </button>
      ))}
    </div>
  );
}

function AllianceTable({
  entries,
  selectedId,
  sortKey,
  direction,
  onSelect,
  onSort,
}: {
  entries: readonly AllianceRatingEntry[];
  selectedId: string | null;
  sortKey: AllianceScoreKey;
  direction: SortDirection;
  onSelect: (id: string) => void;
  onSort: (key: AllianceScoreKey) => void;
}) {
  return (
    <div className="rating-table-v2 rating-table-v2--alliances" role="table" aria-label="Рейтинг альянсов">
      <div className="rating-row-v2 rating-head-v2" role="row">
        <span>МЕСТО</span><span>АЛЬЯНС</span><span>ТЕГ</span><span>УРОВЕНЬ</span>
        <ScoreHead label="ОЧКИ АЛЬЯНСА" scoreKey="alliancePoints" selected={sortKey === 'alliancePoints'} direction={direction} onSort={onSort} />
        <ScoreHead label="ОБЩИЕ ОЧКИ" scoreKey="totalPoints" selected={sortKey === 'totalPoints'} direction={direction} onSort={onSort} />
      </div>
      {entries.map((entry) => (
        <button
          type="button"
          role="row"
          key={entry.id}
          className={[
            'rating-row-v2',
            entry.rank <= 3 ? `top-${entry.rank}` : '',
            entry.isCurrentAlliance ? 'current' : '',
            selectedId === entry.id ? 'selected' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => onSelect(entry.id)}
        >
          <span className="rank-v2"><b>{entry.rank}</b></span>
          <span className="identity-v2"><span className="alliance-emblem-v2">{entry.tag.slice(0, 1)}</span><strong className="utility-data-text">{entry.name}</strong></span>
          <span className="alliance-tag-v2">[{entry.tag}]</span>
          <span className="utility-data-text">{entry.level}</span>
          <Value value={entry.alliancePoints} />
          <Value value={entry.totalPoints} />
        </button>
      ))}
    </div>
  );
}

function ScoreHead<K extends string>({
  label,
  scoreKey,
  selected,
  direction,
  onSort,
}: {
  label: string;
  scoreKey: K;
  selected: boolean;
  direction: SortDirection;
  onSort: (key: K) => void;
}) {
  return <button type="button" className={`utility-control score-head-v2 ${selected ? 'selected' : ''}`} onClick={() => onSort(scoreKey)}>{label}<b>{selected ? (direction === 'desc' ? '▼' : '▲') : '◇'}</b></button>;
}

function Value({ value }: { value: number }) {
  return <span className="utility-data-text score-value-v2">{new Intl.NumberFormat('ru-RU').format(value)}</span>;
}

function RaceEmblem({ race }: { race: PlayerRatingEntry['race'] }) {
  const label = race === 'aster' ? 'A' : race === 'cyber' ? 'C' : 'X';
  return <span className={`race-emblem-v2 race-${race}`} aria-label={race}>{label}</span>;
}

function Pagination({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  return (
    <nav className="rating-pagination-v2" aria-label="Страницы рейтинга">
      {pages.map((item) => <button type="button" className={`utility-control ${item === page ? 'active' : ''}`} key={item} onClick={() => onPage(item)}>{item}</button>)}
    </nav>
  );
}

function SelectionStrip({ selected }: { selected: PlayerRatingEntry | AllianceRatingEntry | null }) {
  if (!selected) return <div className="rating-selection-v2 utility-helper">Выбери строку, чтобы закрепить краткие данные.</div>;
  if ('achievementPoints' in selected) {
    return (
      <div className="rating-selection-v2">
        <strong className="utility-section-title">{selected.name}</strong>
        <span className="utility-secondary">#{selected.rank}</span>
        <span className="utility-data-text">Общие: {new Intl.NumberFormat('ru-RU').format(selected.totalPoints)}</span>
        <span className="utility-data-text">Боевые: {new Intl.NumberFormat('ru-RU').format(selected.battlePoints)}</span>
      </div>
    );
  }
  return (
    <div className="rating-selection-v2">
      <strong className="utility-section-title">{selected.name}</strong>
      <span className="utility-secondary">[{selected.tag}] · #{selected.rank}</span>
      <span className="utility-data-text">Очки альянса: {new Intl.NumberFormat('ru-RU').format(selected.alliancePoints)}</span>
    </div>
  );
}
