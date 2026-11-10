import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { describeOwnerPresence } from './application/owner-presence.ts';
import { UNIVERSE_COORDINATE_OPEN_EVENT } from './application/flights.ts';
import { getFactionGeneralAsset } from './domain/profile/faction-assets.ts';
import type { RatedAllianceDetails, RatedOwnerIdentity } from './domain/runtime/state-store.ts';
import { EmblemGlyph } from './CommandView';
import { RATING_BACKDROP, RATING_MEDALS } from './ui/ui-art.ts';
import { asterionAssetIntegrationAssets } from './assets/generated/asterionAssetIntegrationManifest.generated.ts';
import { CURRENT_PLAYER_ID, createOwnerRatingEntries, createPlayerRatingEntries, withTestOwnerScoreFixtures } from './domain/rating/fixtures.ts';
import {
  ALLIANCE_CRYSTALS_NOTE,
  createAllianceRatingEntries,
  GATE_RULE_ALLIANCE,
  GATE_RULE_SOLO,
  selectAllianceRoster,
  type AllianceRosterEntry,
} from './domain/rating/alliances.ts';
import { selectOwnerAlliance, selectOwnerMembership } from './domain/command/selectors.ts';
import { MAX_ALLIANCE_MEMBERS } from './domain/command/catalog.ts';
import type { AllianceRole, CommandState } from './domain/command/types.ts';
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
  const openPlayer = (ownerId: string) => {
    setMode('players');
    setQuery('');
    setDirection('desc');
    setSelectedId(ownerId);
    setExpandedId(ownerId);
    const clean = sortPlayers(players, playerSort, 'desc');
    setPage(pageForEntry(clean, PAGE_SIZE, (entry) => entry.id === ownerId));
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
  const listedPlayerIds = useMemo(() => new Set(players.map((entry) => entry.id)), [players]);

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
      <header className="rating-heading-v2" style={{ '--rating-backdrop': `url("${RATING_BACKDROP}")` } as CSSProperties}>
        <div>
          <small className="utility-secondary">СТАТИСТИКА ГАЛАКТИКИ</small>
          <h1 className="utility-page-title">РЕЙТИНГ</h1>
        </div>
        <div className="rating-mode-tabs-v2" role="tablist" aria-label="Режим рейтинга">
          <button type="button" className={`utility-control ${mode === 'players' ? 'active' : ''}`} onClick={() => changeMode('players')}>ИГРОКИ</button>
          <button type="button" className={`utility-control ${mode === 'alliances' ? 'active' : ''}`} onClick={() => changeMode('alliances')}>АЛЬЯНСЫ</button>
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
          <span className="utility-secondary">
            Показано {results.items.length} из {results.total} результатов
            {mode === 'alliances' ? <em className="rating-meta-v2__hint" data-qa-rating-average-hint> · очки союза — среднее по его участникам</em> : null}
          </span>
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
            allianceDetails={allianceDetails}
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
            command={command}
            ownerScores={scoresWithFixtures}
            owners={owners}
            currentPlayerId={currentPlayerId}
            listedPlayerIds={listedPlayerIds}
            onOpenPlayer={openPlayer}
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
  allianceDetails,
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
  allianceDetails?: Readonly<Record<string, RatedAllianceDetails>>;
}) {
  const playerAlliance = selectOwnerAlliance(command, currentPlayerId);
  const roleOf = (ownerId: string) => selectOwnerMembership(command, ownerId)?.role ?? null;
  const card = (entry: PlayerRatingEntry) => {
    if (expandedId !== entry.id) return null;
    const membership = selectOwnerMembership(command, entry.id);
    return <PlayerCard entry={entry} owner={owners?.[entry.id]} alliance={selectOwnerAlliance(command, entry.id)}
      role={membership?.role ?? null}
      allianceDetails={membership ? allianceDetails?.[membership.alliance.id] : undefined}
      exactPresence={entry.id === currentPlayerId || Boolean(playerAlliance && membership?.alliance.id === playerAlliance.id)}
      onOpenAlliance={onOpenAlliance} />;
  };
  const currentPlayerAlreadyVisible = Boolean(currentPlayer && entries.some((entry) => entry.id === currentPlayer.id));
  const showPinnedCurrentPlayer = Boolean(currentPlayer && !currentPlayerAlreadyVisible);

  return (
    <div className="rating-table-v2 rating-table-v2--players" role="table" aria-label="Рейтинг игроков">
      <div className="rating-row-v2 rating-head-v2" role="row">
        <span>МЕСТО</span><span>ИГРОК</span><span>РАСА</span><span>АЛЬЯНС</span>
        <ScoreHead label="ОБЩИЕ" iconPath={asterionAssetIntegrationAssets.scoreIcons.totalPoints} scoreKey="totalPoints" selected={sortKey === 'totalPoints'} direction={direction} onSort={onSort} />
        <ScoreHead label="РЕСУРС." iconPath={asterionAssetIntegrationAssets.scoreIcons.resourcePoints} scoreKey="resourcePoints" selected={sortKey === 'resourcePoints'} direction={direction} onSort={onSort} />
        <ScoreHead label="БОЕВЫЕ" iconPath={asterionAssetIntegrationAssets.scoreIcons.battlePoints} scoreKey="battlePoints" selected={sortKey === 'battlePoints'} direction={direction} onSort={onSort} />
      </div>
      {entries.map((entry) => (
        <Fragment key={entry.id}>
          <PlayerRow entry={entry} role={roleOf(entry.id)} selectedId={selectedId} onSelect={onSelect} expanded={expandedId === entry.id} />
          {card(entry)}
        </Fragment>
      ))}
      {showPinnedCurrentPlayer && currentPlayer ? (
        <>
          <div className="rating-self-separator-v2" role="row" aria-hidden="true"><span>…</span></div>
          <PlayerRow entry={currentPlayer} role={roleOf(currentPlayer.id)} selectedId={selectedId} onSelect={onSelect} pinned expanded={expandedId === currentPlayer.id} />
          {card(currentPlayer)}
        </>
      ) : null}
    </div>
  );
}

function PlayerRow({
  entry,
  role,
  selectedId,
  onSelect,
  pinned = false,
  expanded = false,
}: {
  entry: PlayerRatingEntry;
  role: AllianceRole | null;
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
      <span className="rank-v2">{entry.rank <= 3 ? <img className="rating-medal-v2" src={RATING_MEDALS[entry.rank - 1]} alt="" draggable={false} /> : null}<b>{entry.rank}</b></span>
      <span className="identity-v2"><strong className="utility-data-text" title={entry.name}>{entry.name}</strong><i className="rating-expand-mark-v2" aria-hidden="true">{expanded ? '▴' : '▾'}</i></span>
      <span className={`race-label-v2 race-${entry.race}`}>{RACE_LABELS[entry.race]}</span>
      <span className="rating-alliance-cell-v2">
        {entry.allianceTag ? <span className="alliance-tag-v2">[{entry.allianceTag}]</span> : <span className="rating-solo-v2">одиночка</span>}
        {role && role !== 'member' ? <RoleBadge role={role} compact /> : null}
      </span>
      <Value value={entry.totalPoints} lead />
      <Value value={entry.resourcePoints} />
      <Value value={entry.battlePoints} />
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
  command,
  ownerScores,
  owners,
  currentPlayerId,
  listedPlayerIds,
  onOpenPlayer,
}: {
  entries: readonly AllianceRatingEntry[];
  selectedId: string | null;
  sortKey: AllianceScoreKey;
  direction: SortDirection;
  onSelect: (id: string) => void;
  onSort: (key: AllianceScoreKey) => void;
  expandedId: string | null;
  details?: Readonly<Record<string, RatedAllianceDetails>>;
  command: CommandState;
  ownerScores: Readonly<Record<string, OwnerScore | undefined>>;
  owners?: Readonly<Record<string, RatedOwnerIdentity>>;
  currentPlayerId: string;
  listedPlayerIds: ReadonlySet<string>;
  onOpenPlayer: (ownerId: string) => void;
}) {
  const rosterOf = (allianceId: string) => {
    const record = command.alliances.find((alliance) => alliance.id === allianceId);
    return record ? selectAllianceRoster(record, ownerScores, currentPlayerId, (ownerId) => owners?.[ownerId]?.name) : [];
  };
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
          <span className="rank-v2">{entry.rank <= 3 ? <img className="rating-medal-v2" src={RATING_MEDALS[entry.rank - 1]} alt="" draggable={false} /> : null}<b>{entry.rank}</b></span>
          <span className="identity-v2"><span className="alliance-emblem-v2">{entry.emblem ? <EmblemGlyph compact emblem={entry.emblem} /> : entry.tag.slice(0, 1)}</span><strong className="utility-data-text" title={entry.name}>{entry.name}</strong><i className="rating-expand-mark-v2" aria-hidden="true">{expandedId === entry.id ? '▴' : '▾'}</i></span>
          <span className="alliance-tag-v2">[{entry.tag}]</span>
          <span className="utility-data-text">{entry.memberCount}/{MAX_ALLIANCE_MEMBERS}</span>
          <Value value={entry.totalPoints} lead />
          <Value value={entry.resourcePoints} />
          <Value value={entry.battlePoints} />
        </button>
        {expandedId === entry.id ? <AllianceCard entry={entry} details={details?.[entry.id]} roster={rosterOf(entry.id)} listedPlayerIds={listedPlayerIds} onOpenPlayer={onOpenPlayer} /> : null}
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
function PlayerCard({ entry, owner, alliance, role, allianceDetails, exactPresence, onOpenAlliance }: {
  entry: PlayerRatingEntry;
  owner?: RatedOwnerIdentity;
  alliance: ReturnType<typeof selectOwnerAlliance>;
  role: AllianceRole | null;
  allianceDetails?: RatedAllianceDetails;
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
        <strong className="ut-selectable">{entry.name}</strong>
        <span>{RACE_LABELS[entry.race]}</span>
        <em className={`rating-presence-v2 is-${presence.tone}`}><i aria-hidden="true" />{presence.text}</em>
        {alliance ? (
          <span className="rating-card-v2__membership">
            {role ? <RoleBadge role={role} /> : null}
            <button type="button" className="rating-card-v2__link" onClick={() => onOpenAlliance(alliance.id)} data-qa-rating-open-alliance>[{alliance.tag}] {alliance.name} ↗</button>
          </span>
        ) : <span>Без союза</span>}
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
      {alliance ? (
        // Solo crystals burn when an owner joins an alliance: a member never holds
        // personal ones, so the card shows the alliance's crystals and Gate instead of a 0.
        <div className="rating-card-v2__block" data-qa-rating-player-crystals="alliance">
          <small>КРИСТАЛЛЫ СОЮЗА [{alliance.tag}]</small>
          <CrystalDots count={allianceDetails?.crystals ?? 0} />
          <span className="rating-card-v2__note">{ALLIANCE_CRYSTALS_NOTE}</span>
          <span className={`rating-card-v2__note${role === 'leader' ? ' is-key' : ''}`}>
            {role === 'leader' ? 'Как глава, строит Галактические Врата союза.' : 'Галактические Врата строит глава союза.'}
          </span>
          {allianceDetails?.gate ? <span className="rating-card-v2__gate">{allianceDetails.gate === 'completed' ? 'Врата союза построены' : 'Союз строит Врата'}</span> : null}
        </div>
      ) : (
        <div className="rating-card-v2__block" data-qa-rating-player-crystals="solo">
          <small>КРИСТАЛЛЫ СОЛНЦ · ЛИЧНЫЕ</small>
          <CrystalDots count={owner?.crystals ?? 0} />
          <span className="rating-card-v2__note">{GATE_RULE_SOLO}</span>
          {owner?.gate ? <span className="rating-card-v2__gate">{owner.gate === 'completed' ? 'Врата построены' : 'Строит Врата'}</span> : null}
        </div>
      )}
      <div className="rating-card-v2__actions">
        <button type="button" disabled={!home} onClick={() => home && openOwnerOnMap(home.coordinate, entry.id, home.id)} data-qa-rating-open-profile>ПРОФИЛЬ</button>
      </div>
    </div>
  );
}

const ROLE_LABELS: Readonly<Record<AllianceRole, { full: string; short: string }>> = {
  leader: { full: 'Глава', short: 'Глава' },
  deputy: { full: 'Заместитель', short: 'Зам.' },
  member: { full: 'Участник', short: 'Участник' },
};

function RoleBadge({ role, compact = false }: { role: AllianceRole; compact?: boolean }) {
  return <span className={`rating-role-v2 is-${role}${compact ? ' is-compact' : ''}`} data-qa-rating-role={role}>{compact ? ROLE_LABELS[role].short : ROLE_LABELS[role].full}</span>;
}

function RosterName({ member, listed, onOpenPlayer }: { member: AllianceRosterEntry; listed: boolean; onOpenPlayer: (ownerId: string) => void }) {
  return listed
    ? <button type="button" className="rating-roster-v2__name" onClick={() => onOpenPlayer(member.ownerId)}>{member.name}</button>
    : <span className="rating-roster-v2__name">{member.name}</span>;
}

/** The card under an alliance row: who leads it, its crystals and Gate, and the whole roster. */
function AllianceCard({ entry, details, roster, listedPlayerIds, onOpenPlayer }: {
  entry: AllianceRatingEntry;
  details?: RatedAllianceDetails;
  roster: readonly AllianceRosterEntry[];
  listedPlayerIds: ReadonlySet<string>;
  onOpenPlayer: (ownerId: string) => void;
}) {
  const leader = roster.find((member) => member.role === 'leader');
  const deputies = roster.filter((member) => member.role === 'deputy');
  const wars = details?.wars ?? 0;
  const memberCount = details?.members ?? entry.memberCount;
  return (
    <div className="rating-card-v2 rating-card-v2--alliance" role="row" data-qa-rating-alliance-card={entry.id}>
      <div className="rating-alliance-facts-v2">
        <div className="rating-card-v2__block" data-qa-rating-leader>
          <small>ГЛАВА СОЮЗА</small>
          {leader ? <span className="rating-card-v2__person"><RoleBadge role="leader" /><RosterName member={leader} listed={listedPlayerIds.has(leader.ownerId)} onOpenPlayer={onOpenPlayer} /></span> : <span className="rating-card-v2__note">не назначен</span>}
        </div>
        <div className="rating-card-v2__block" data-qa-rating-deputies>
          <small>{deputies.length > 1 ? 'ЗАМЕСТИТЕЛИ' : 'ЗАМЕСТИТЕЛЬ'}</small>
          {deputies.length
            ? deputies.map((deputy) => <span key={deputy.ownerId} className="rating-card-v2__person"><RoleBadge role="deputy" /><RosterName member={deputy} listed={listedPlayerIds.has(deputy.ownerId)} onOpenPlayer={onOpenPlayer} /></span>)
            : <span className="rating-card-v2__note">не назначен</span>}
        </div>
        <div className="rating-card-v2__block" data-qa-rating-alliance-crystals>
          <small>КРИСТАЛЛЫ СОЮЗА</small>
          <CrystalDots count={details?.crystals ?? 0} />
          <span className="rating-card-v2__note">Общие на весь союз</span>
        </div>
        <div className="rating-card-v2__block" data-qa-rating-gate-rule>
          <small>ГАЛАКТИЧЕСКИЕ ВРАТА</small>
          <span className="rating-card-v2__stat">{details?.gate === 'completed' ? 'Построены' : details?.gate === 'building' ? 'Строятся' : 'Не начаты'}</span>
          <span className="rating-card-v2__note">{GATE_RULE_ALLIANCE}</span>
        </div>
      </div>
      <div className="rating-roster-v2" data-qa-rating-roster>
        <div className="rating-roster-v2__head">
          <small>СОСТАВ · {memberCount} из {MAX_ALLIANCE_MEMBERS}</small>
          <small>{wars ? `${wars} ${pluralWars(wars)}` : 'войн нет'}</small>
        </div>
        <ol className="rating-roster-v2__list">
          {roster.map((member) => (
            <li key={member.ownerId} className={`is-${member.role}${member.isCurrentPlayer ? ' is-current' : ''}`} data-qa-rating-roster-member={member.role}>
              {member.role === 'member' ? <span aria-hidden="true" /> : <RoleBadge role={member.role} compact />}
              <RosterName member={member} listed={listedPlayerIds.has(member.ownerId)} onOpenPlayer={onOpenPlayer} />
              <b className="utility-data-text">{new Intl.NumberFormat('ru-RU').format(member.totalPoints)}</b>
            </li>
          ))}
        </ol>
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
