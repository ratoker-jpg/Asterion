import { Fragment, useMemo, useState } from 'react';
import { describeOwnerPresence } from './application/owner-presence.ts';
import { UNIVERSE_COORDINATE_OPEN_EVENT } from './application/flights.ts';
import { getFactionGeneralAsset } from './domain/profile/faction-assets.ts';
import type { RatedAllianceDetails, RatedOwnerIdentity } from './domain/runtime/state-store.ts';
import { EmblemGlyph } from './CommandView';
import { asterionAssetIntegrationAssets } from './assets/generated/asterionAssetIntegrationManifest.generated.ts';
import { CURRENT_PLAYER_ID, createOwnerRatingEntries, createPlayerRatingEntries, withTestOwnerScoreFixtures } from './domain/rating/fixtures.ts';
import { createAllianceRatingEntries } from './domain/rating/alliances.ts';
import { selectOwnerAlliance } from './domain/command/selectors.ts';
import type { CommandState } from './domain/command/types.ts';
import type { RuntimeMode } from './domain/runtime/mode.ts';
import {
  filterAlliances,
  filterPlayers,
  pageForEntry,
  paginate,
  sortAlliances,
  sortPlayers,
} from './domain/rating/selectors.ts';
import type {
  AllianceRatingEntry,
  AllianceScoreKey,
  OwnerScore,
  PlayerRatingEntry,
  PlayerScoreKey,
  RatingMode,
  SortDirection,
} from './domain/rating/types.ts';

const PAGE_SIZE = 12;

export function RatingView({
  mode: runtimeMode = 'test',
  command,
  ownerScores = {},
  currentPlayerScore,
  currentPlayerId = CURRENT_PLAYER_ID,
  owners,
  allianceDetails,
}: {
  mode?: RuntimeMode;
  command: CommandState;
  ownerScores?: Readonly<Record<string, OwnerScore>>;
  currentPlayerScore?: OwnerScore;
  currentPlayerId?: string;
  owners?: Readonly<Record<string, RatedOwnerIdentity>>;
  allianceDetails?: Readonly<Record<string, RatedAllianceDetails>>;
}) {
  const [mode, setMode] = useState<RatingMode>('players');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [playerSort, setPlayerSort] = useState<PlayerScoreKey>('totalPoints');
  const [allianceSort, setAllianceSort] = useState<AllianceScoreKey>('totalPoints');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Nemexia-style: a click on a row opens its card under it; another click closes it.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleRow = (id: string) => {
    setSelectedId(id);
    setExpandedId((current) => current === id ? null : id);
  };
  const openAlliance = (allianceId: string) => {
    setMode('alliances');
    setQuery('');
    setDirection('desc');
    setSelectedId(allianceId);
    setExpandedId(allianceId);
    const clean = sortAlliances(alliances, allianceSort, 'desc');
    setPage(pageForEntry(clean, PAGE_SIZE, (entry) => entry.id === allianceId));
  };

  const currentAlliance = useMemo(() => selectOwnerAlliance(command, currentPlayerId), [command, currentPlayerId]);
  const players = useMemo(
    () => (runtimeMode === 'production' && owners
      ? createOwnerRatingEntries(ownerScores, owners, currentPlayerId)
        .map((entry) => ({ ...entry, allianceTag: selectOwnerAlliance(command, entry.id)?.tag ?? null }))
      : createPlayerRatingEntries(currentPlayerScore, runtimeMode, currentPlayerId)
        .map((entry) => entry.isCurrentPlayer ? { ...entry, allianceTag: currentAlliance?.tag ?? null } : entry)),
    [currentPlayerScore, currentPlayerId, currentAlliance, runtimeMode, owners, ownerScores, command],
  );
  const scoresWithFixtures = useMemo(() => withTestOwnerScoreFixtures(ownerScores, runtimeMode), [ownerScores, runtimeMode]);
  const alliances = useMemo(
    () => createAllianceRatingEntries(command, scoresWithFixtures, currentPlayerId),
    [command, scoresWithFixtures, currentPlayerId],
  );
  const currentPlayer = useMemo(() => players.find((entry) => entry.isCurrentPlayer) ?? null, [players]);

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
    setExpandedId(null);
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
            currentPlayer={currentPlayer}
            selectedId={selectedId}
            sortKey={playerSort}
            direction={direction}
            onSelect={toggleRow}
            onSort={sortPlayer}
            expandedId={expandedId}
            owners={owners}
            command={command}
            currentPlayerId={currentPlayerId}
            onOpenAlliance={openAlliance}
          />
        ) : alliances.length === 0 ? (
          <div className="rating-empty-v2" data-qa-rating-empty role="status">
            <strong>Союзов пока нет.</strong>
            <span>Создайте союз в разделе «Командование», чтобы здесь появилась его позиция.</span>
          </div>
        ) : (
          <AllianceTable
            entries={results.items as AllianceRatingEntry[]}
            selectedId={selectedId}
            sortKey={allianceSort}
            direction={direction}
            onSelect={toggleRow}
            onSort={sortAlliance}
            expandedId={expandedId}
            details={allianceDetails}
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
  currentPlayer,
  selectedId,
  sortKey,
  direction,
  onSelect,
  onSort,
  expandedId,
  owners,
  command,
  currentPlayerId,
  onOpenAlliance,
}: {
  entries: readonly PlayerRatingEntry[];
  currentPlayer: PlayerRatingEntry | null;
  selectedId: string | null;
  sortKey: PlayerScoreKey;
  direction: SortDirection;
  onSelect: (id: string) => void;
  onSort: (key: PlayerScoreKey) => void;
  expandedId: string | null;
  owners?: Readonly<Record<string, RatedOwnerIdentity>>;
  command: CommandState;
  currentPlayerId: string;
  onOpenAlliance: (allianceId: string) => void;
}) {
  const playerAlliance = selectOwnerAlliance(command, currentPlayerId);
  const card = (entry: PlayerRatingEntry) => expandedId === entry.id
    ? <PlayerCard entry={entry} owner={owners?.[entry.id]} alliance={selectOwnerAlliance(command, entry.id)}
      exactPresence={entry.id === currentPlayerId || Boolean(playerAlliance && selectOwnerAlliance(command, entry.id)?.id === playerAlliance.id)}
      onOpenAlliance={onOpenAlliance} />
    : null;
  const currentPlayerAlreadyVisible = Boolean(currentPlayer && entries.some((entry) => entry.id === currentPlayer.id));
  const showPinnedCurrentPlayer = Boolean(currentPlayer && !currentPlayerAlreadyVisible);

  return (
    <div className="rating-table-v2 rating-table-v2--players" role="table" aria-label="Рейтинг игроков">
      <div className="rating-row-v2 rating-head-v2" role="row">
        <span>МЕСТО</span><span>ИГРОК</span><span>РАСА</span><span>АЛЬЯНС</span>
        <ScoreHead label="ОБЩИЕ" iconPath={asterionAssetIntegrationAssets.scoreIcons.totalPoints} scoreKey="totalPoints" selected={sortKey === 'totalPoints'} direction={direction} onSort={onSort} />
        <ScoreHead label="РЕСУРС." iconPath={asterionAssetIntegrationAssets.scoreIcons.resourcePoints} scoreKey="resourcePoints" selected={sortKey === 'resourcePoints'} direction={direction} onSort={onSort} />
        <ScoreHead label="БОЕВЫЕ" iconPath={asterionAssetIntegrationAssets.scoreIcons.battlePoints} scoreKey="battlePoints" selected={sortKey === 'battlePoints'} direction={direction} onSort={onSort} />
        <ScoreHead label="ДОСТИЖ." iconPath={asterionAssetIntegrationAssets.scoreIcons.achievementPoints} scoreKey="achievementPoints" selected={sortKey === 'achievementPoints'} direction={direction} onSort={onSort} />
      </div>
      {entries.map((entry) => (
        <Fragment key={entry.id}>
          <PlayerRow entry={entry} selectedId={selectedId} onSelect={onSelect} expanded={expandedId === entry.id} />
          {card(entry)}
        </Fragment>
      ))}
      {showPinnedCurrentPlayer && currentPlayer ? (
        <>
          <div className="rating-self-separator-v2" role="row" aria-hidden="true"><span>…</span></div>
          <PlayerRow entry={currentPlayer} selectedId={selectedId} onSelect={onSelect} pinned expanded={expandedId === currentPlayer.id} />
          {card(currentPlayer)}
        </>
      ) : null}
    </div>
  );
}

function PlayerRow({
  entry,
  selectedId,
  onSelect,
  pinned = false,
  expanded = false,
}: {
  entry: PlayerRatingEntry;
  selectedId: string | null;
  onSelect: (id: string) => void;
  pinned?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      role="row"
      className={[
        'rating-row-v2',
        entry.rank <= 3 ? `top-${entry.rank}` : '',
        entry.isCurrentPlayer ? 'current' : '',
        pinned ? 'pinned-current' : '',
        selectedId === entry.id ? 'selected' : '',
        expanded ? 'expanded' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => onSelect(entry.id)}
      aria-expanded={expanded}
      data-qa-rating-player-row={entry.id}
    >
      <span className="rank-v2"><b>{entry.rank}</b></span>
      <span className="identity-v2"><strong className="utility-data-text">{entry.name}</strong><i className="rating-expand-mark-v2" aria-hidden="true">{expanded ? '▴' : '▾'}</i></span>
      <span className={`race-label-v2 race-${entry.race}`}>{RACE_LABELS[entry.race]}</span>
      <span className="alliance-tag-v2">{entry.allianceTag ? `[${entry.allianceTag}]` : '—'}</span>
      <Value value={entry.totalPoints} lead />
      <Value value={entry.resourcePoints} />
      <Value value={entry.battlePoints} />
      <Value value={entry.achievementPoints} />
    </button>
  );
}

function AllianceTable({
  entries,
  selectedId,
  sortKey,
  direction,
  onSelect,
  onSort,
  expandedId,
  details,
}: {
  entries: readonly AllianceRatingEntry[];
  selectedId: string | null;
  sortKey: AllianceScoreKey;
  direction: SortDirection;
  onSelect: (id: string) => void;
  onSort: (key: AllianceScoreKey) => void;
  expandedId: string | null;
  details?: Readonly<Record<string, RatedAllianceDetails>>;
}) {
  return (
    <div className="rating-table-v2 rating-table-v2--alliances" role="table" aria-label="Рейтинг альянсов">
      <div className="rating-row-v2 rating-head-v2" role="row">
        <span>МЕСТО</span><span>АЛЬЯНС</span><span>ТЕГ</span><span>УЧАСТНИКИ</span>
        <ScoreHead label="ОБЩИЕ (СРЕДН.)" scoreKey="totalPoints" selected={sortKey === 'totalPoints'} direction={direction} onSort={onSort} />
        <ScoreHead label="РЕСУРС. (СРЕДН.)" scoreKey="resourcePoints" selected={sortKey === 'resourcePoints'} direction={direction} onSort={onSort} />
        <ScoreHead label="БОЕВЫЕ (СРЕДН.)" scoreKey="battlePoints" selected={sortKey === 'battlePoints'} direction={direction} onSort={onSort} />
      </div>
      {entries.map((entry) => (
        <Fragment key={entry.id}>
        <button
          type="button"
          role="row"
          className={[
            'rating-row-v2',
            entry.rank <= 3 ? `top-${entry.rank}` : '',
            entry.isCurrentAlliance ? 'current' : '',
            selectedId === entry.id ? 'selected' : '',
            expandedId === entry.id ? 'expanded' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => onSelect(entry.id)}
          aria-expanded={expandedId === entry.id}
          data-qa-rating-alliance-row={entry.id}
        >
          <span className="rank-v2"><b>{entry.rank}</b></span>
          <span className="identity-v2"><span className="alliance-emblem-v2">{entry.emblem ? <EmblemGlyph compact emblem={entry.emblem} /> : entry.tag.slice(0, 1)}</span><strong className="utility-data-text">{entry.name}</strong><i className="rating-expand-mark-v2" aria-hidden="true">{expandedId === entry.id ? '▴' : '▾'}</i></span>
          <span className="alliance-tag-v2">[{entry.tag}]</span>
          <span className="utility-data-text">{entry.memberCount}/15</span>
          <Value value={entry.totalPoints} lead />
          <Value value={entry.resourcePoints} />
          <Value value={entry.battlePoints} />
        </button>
        {expandedId === entry.id ? <AllianceCard entry={entry} details={details?.[entry.id]} /> : null}
        </Fragment>
      ))}
    </div>
  );
}

function ScoreHead<K extends string>({
  label,
  iconPath,
  scoreKey,
  selected,
  direction,
  onSort,
}: {
  label: string;
  iconPath?: string;
  scoreKey: K;
  selected: boolean;
  direction: SortDirection;
  onSort: (key: K) => void;
}) {
  return <button type="button" className={`utility-control score-head-v2 ${selected ? 'selected' : ''}`} onClick={() => onSort(scoreKey)}><span>{label}</span>{iconPath ? <img className="score-head-v2__icon" src={iconPath} alt="" aria-hidden="true" draggable={false} /> : null}{selected ? <b>{direction === 'desc' ? '▼' : '▲'}</b> : null}</button>;
}

function Value({ value, lead = false }: { value: number; lead?: boolean }) {
  return <span className={`utility-data-text score-value-v2${lead ? ' is-lead' : ''}`}>{new Intl.NumberFormat('ru-RU').format(value)}</span>;
}

const RACE_LABELS: Record<PlayerRatingEntry['race'], string> = { aster: 'Астеры', cyber: 'Илары', xeno: 'Рой' };
const CRYSTAL_COUNT = 4;

function openOwnerOnMap(coordinate: { galaxy: number; system: number; position: number }, ownerId?: string, planetId?: string) {
  window.dispatchEvent(new CustomEvent(UNIVERSE_COORDINATE_OPEN_EVENT, { detail: { coordinate, ...(ownerId ? { ownerId } : {}), ...(planetId ? { planetId } : {}) } }));
}

function CrystalDots({ count }: { count: number }) {
  return <span className="rating-crystals-v2" aria-label={`Кристаллы: ${count} из ${CRYSTAL_COUNT}`}>{Array.from({ length: CRYSTAL_COUNT }, (_, index) => <i key={index} className={index < count ? 'is-owned' : ''} />)}<b>{count}/{CRYSTAL_COUNT}</b></span>;
}

/** The card under a player row: what anyone can see about this owner, and the way to their profile. */
function PlayerCard({ entry, owner, alliance, exactPresence, onOpenAlliance }: {
  entry: PlayerRatingEntry;
  owner?: RatedOwnerIdentity;
  alliance: ReturnType<typeof selectOwnerAlliance>;
  exactPresence: boolean;
  onOpenAlliance: (allianceId: string) => void;
}) {
  const planets = owner?.planets ?? [];
  const home = planets[0];
  const presence = describeOwnerPresence(owner?.presence?.online ? { online: true }
    : owner?.presence?.lastSeenAt !== undefined ? { online: false, lastSeenAt: owner.presence.lastSeenAt } : undefined, Date.now(), exactPresence);
  const general = getFactionGeneralAsset(owner?.factionId);
  return (
    <div className="rating-card-v2" role="row" data-qa-rating-player-card={entry.id}>
      <div className="rating-card-v2__art">{general ? <img src={general} alt="" draggable={false} /> : null}</div>
      <div className="rating-card-v2__who">
        <strong>{entry.name}</strong>
        <span>{RACE_LABELS[entry.race]}</span>
        <em className={`rating-presence-v2 is-${presence.tone}`}><i aria-hidden="true" />{presence.text}</em>
        {alliance ? <button type="button" className="rating-card-v2__link" onClick={() => onOpenAlliance(alliance.id)}>Союз [{alliance.tag}] {alliance.name} ↗</button> : <span>Без союза</span>}
      </div>
      <div className="rating-card-v2__block">
        <small>ПЛАНЕТЫ · {planets.length}</small>
        <div className="rating-card-v2__planets">
          {planets.map((planet) => (
            <button type="button" key={planet.id} title={`${planet.name} [${planet.coordinate.galaxy}:${planet.coordinate.system}:${planet.coordinate.position}]`}
              onClick={() => openOwnerOnMap(planet.coordinate)}>
              <span>{planet.name}</span><b>[{planet.coordinate.galaxy}:{planet.coordinate.system}:{planet.coordinate.position}]</b>
            </button>
          ))}
        </div>
      </div>
      <div className="rating-card-v2__block">
        <small>КРИСТАЛЛЫ СОЛНЦ</small>
        <CrystalDots count={owner?.crystals ?? 0} />
        {owner?.gate ? <span className="rating-card-v2__gate">{owner.gate === 'completed' ? 'Врата построены' : 'Строит Врата'}</span> : null}
      </div>
      <div className="rating-card-v2__actions">
        <button type="button" disabled={!home} onClick={() => home && openOwnerOnMap(home.coordinate, entry.id, home.id)} data-qa-rating-open-profile>ПРОФИЛЬ</button>
      </div>
    </div>
  );
}

/** The card under an alliance row: its wars, size, crystals and Gate. */
function AllianceCard({ entry, details }: { entry: AllianceRatingEntry; details?: RatedAllianceDetails }) {
  return (
    <div className="rating-card-v2 rating-card-v2--alliance" role="row" data-qa-rating-alliance-card={entry.id}>
      <div className="rating-card-v2__block">
        <small>ПОЛИТИКА</small>
        <span className="rating-card-v2__stat"><b>{details?.wars ?? 0}</b> {pluralWars(details?.wars ?? 0)}</span>
      </div>
      <div className="rating-card-v2__block">
        <small>УЧАСТНИКИ</small>
        <span className="rating-card-v2__stat"><b>{details?.members ?? entry.memberCount}</b> из 15</span>
      </div>
      <div className="rating-card-v2__block">
        <small>КРИСТАЛЛЫ СОЛНЦ</small>
        <CrystalDots count={details?.crystals ?? 0} />
      </div>
      <div className="rating-card-v2__block">
        <small>ГАЛАКТИЧЕСКИЕ ВРАТА</small>
        <span className="rating-card-v2__stat">{details?.gate === 'completed' ? 'Построены' : details?.gate === 'building' ? 'Строятся' : 'Нет'}</span>
      </div>
    </div>
  );
}

function pluralWars(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return 'войн';
  if (count % 10 === 1) return 'война';
  if (count % 10 >= 2 && count % 10 <= 4) return 'войны';
  return 'войн';
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
      <span className="utility-data-text">Средние общие очки: {new Intl.NumberFormat('ru-RU').format(selected.totalPoints)}</span>
    </div>
  );
}
