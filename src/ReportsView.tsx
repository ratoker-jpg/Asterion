import { useEffect, useMemo, useRef, useState } from 'react';

import { SunReportStrip } from './ui/sun-raid/SunReportStrip.tsx';
import { BattleReportModal } from './BattleReportsView';
import { FactionGeneralPortrait } from './ui/FactionGeneralPortrait.tsx';
import { EMPTY_ART } from './ui/ui-art.ts';
import { EmblemGlyph } from './ui/command/EmblemGlyph.tsx';
import { ReportArtwork, ReportGlyph, ReportHero, ReportSheetView } from './ui/messages/ReportSheetView.tsx';
import { MISSION_BANNERS } from './ui/ui-art.ts';
import { formatShortAmount, reportRowValue, type HeadlineContext, type ReportValue } from './domain/reports/headline.ts';
import { asterionAssetIntegrationAssets } from './assets/generated/asterionAssetIntegrationManifest.generated.ts';
import { isAsterionLocalPlayerId, type BattleReport } from './domain/combat/report.ts';
import { createBattleReportViewModel } from './domain/combat/battle-report-view-model.ts';
import type { AllianceRole, CommandState } from './domain/command/types.ts';
import { selectOwnerMembership, selectRole, toAllianceIdentity } from './domain/command/selectors.ts';
import type { OperationsState } from './domain/operations/types.ts';
import {
  buildReportsFeed,
  filterReportItems,
  findBattleReport,
  getReportCategoryCounts,
  getReportUnreadCounts,
  getVisibleReportItems,
  reportReadCheck,
  preservePersistentReportCollections,
  dropExpiredReportItems,
} from './domain/reports/adapters.ts';
import {
  deleteAllReports,
  deleteSelectedReports,
  markAllReportsRead,
  markReportRead,
} from './domain/reports/repository.ts';
import { buildReportSheet, type ReportSheetAction } from './domain/reports/sheet.ts';
import type { LetterRef, ReportCategory, ReportFilter, ReportItem, ReportsState } from './domain/reports/types.ts';
import type { NpcStrategyState } from './domain/npc/strategy.ts';
import type { PlayerProfileState } from './domain/profile/types.ts';
import { selectPlayerProfileMetrics } from './domain/profile/selectors.ts';
import type { PlayerProfileMetricKey } from './domain/profile/selectors.ts';
import type { OwnerScore } from './domain/rating/types.ts';
import type { RatingPrototypeState } from './domain/rating/fixtures.ts';
import { selectRecordedBattlePointAwards } from './domain/rating/scoring.ts';
import { RUNTIME_RESET_EVENT, type RuntimeMode } from './domain/runtime/mode.ts';
import type { SpyReportSnapshot } from './domain/espionage/types.ts';
import { getCombatFactionName } from './domain/combat/factions.ts';
import type { UniverseCoordinate } from './domain/universe/types.ts';
import type { PirateReconReport } from './domain/pirates/recon-report.ts';
import './ui/messages/messages.css';

const numberFormat = new Intl.NumberFormat('ru-RU');

type MessageFolderId =
  | 'profile'
  | 'personal'
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
  emptyTitle?: string;
  emptyBody?: string;
};

const MESSAGE_FOLDERS: readonly MessageFolder[] = [
  { id: 'personal', label: 'Личные', glyph: 'personal', category: 'personal' },
  { id: 'system', label: 'Система', glyph: 'system', category: 'system' },
  { id: 'battle', label: 'Бои', glyph: 'battle', category: 'battle' },
  { id: 'command', label: 'Командные', glyph: 'command', category: 'command' },
  { id: 'arena', label: 'Арена', glyph: 'arena', category: 'arena' },
  { id: 'flights', label: 'Полёты', glyph: 'flights', category: 'flights' },
  { id: 'alliances', label: 'Союзы', glyph: 'alliances', category: 'alliances' },
  { id: 'achievements', label: 'Достижения', glyph: 'achievements', category: 'achievements' },
];

const EMPTY_COPY: Record<ReportCategory, { title: string; body: string }> = {
  personal: { title: 'Личных писем пока нет', body: 'Сюда приходят письма лично вам: ответы союзов на ваши заявки и заявки в союз, которым вы управляете.' },
  system: { title: 'Системных данных пока нет', body: 'Сюда попадут шпионские отчёты, уведомления контрразведки и результаты операций, которые дают новую информацию.' },
  battle: { title: 'Боевых докладов пока нет', body: 'Здесь хранятся реальные боевые отчёты и бои из операций. Симуляции и Арена в этот канал не попадают.' },
  command: { title: 'Командных докладов пока нет', body: 'Здесь будут отчёты об атаках на союзников и результаты атак на Солнце, когда эти события появятся в боевом контуре.' },
  arena: { title: 'Арена — пока пусто', body: 'Отчёты и очки Арены появятся здесь вместе с реализацией самой Арены.' },
  flights: { title: 'Завершённых полётов пока нет', body: 'После подключения реальной отправки флотов сюда будут сохраняться завершённые рейсы, прибытия и возвраты флота на ваши планеты.' },
  alliances: { title: 'Союзных приглашений пока нет', body: 'Здесь появляются доступные совместные операции союза. Из приглашения можно сразу перейти к выбору флота.' },
  achievements: { title: 'Достижения — пока пусто', body: 'Этот канал зарезервирован под будущую систему достижений.' },
};

const FILTER_LABELS: Record<ReportFilter, string> = {
  all: 'Все',
  unread: 'Новые',
  saved: 'Сохранённые',
};

function formatTime(timestamp?: string) {
  if (!timestamp) return 'Сейчас';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

/** «1 сообщение», «3 сообщения», «500 сообщений». */
function messagesLabel(count: number) {
  const tens = count % 100;
  const ones = count % 10;
  const word = tens >= 11 && tens <= 14 ? 'сообщений' : ones === 1 ? 'сообщение' : ones >= 2 && ones <= 4 ? 'сообщения' : 'сообщений';
  return `${numberFormat.format(count)} ${word}`;
}

function withOverpopulationReports(next: ReportsState, previous: ReportsState): ReportsState {
  return preservePersistentReportCollections(next, previous);
}

function ProfileGlyph() {
  return <img className="reports-glyph-image" src={asterionAssetIntegrationAssets.reportIcons.profile} alt="" aria-hidden="true" draggable={false} />;
}

function SearchGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m15.5 15.5 5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

/** Folder counter: unread / total, the unread part capped so the pill never outgrows the nav. */
function formatUnread(unread: number) {
  return unread > 99 ? '99+' : String(unread);
}

/** «Сегодня», «Вчера», «10.11.2026»: the list is grouped by day. */
function dayLabel(timestamp: string | undefined, now: number) {
  if (!timestamp) return 'Сегодня';
  const at = new Date(timestamp);
  const day = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const today = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
  if (day >= today) return 'Сегодня';
  if (day >= today - 86_400_000) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(at);
}

/** One line under the title of a row: who and where. */
function whoWhere(item: ReportItem, battle: BattleReport | null | undefined, isMine: (id?: string | null) => boolean) {
  if (item.letter) return item.letter.sender.name;
  if (item.spyReport) return `${item.spyReport.targetOwnerName} · [${item.spyReport.targetCoordinate.galaxy}:${item.spyReport.targetCoordinate.system}:${item.spyReport.targetCoordinate.position}]`;
  if (battle) {
    const enemy = isMine(battle.attacker.playerId) ? battle.defender : battle.attacker;
    return [enemy.playerName || enemy.planetName, enemy.coordinates].filter(Boolean).join(' · ') || item.preview;
  }
  return item.preview;
}

function ReportListItem({ item, battle, value, who, command, active, read, saved, onOpen }: {
  item: ReportItem;
  battle?: BattleReport | null;
  value: ReportValue | null;
  who: string;
  command?: CommandState;
  active: boolean;
  read: boolean;
  saved: boolean;
  onOpen: () => void;
}) {
  const title = item.letter?.subject ?? item.title;
  return (
    <article className={`reports-list-item reports-v2-tone-${item.statusTone} ${item.brief ? 'reports-list-item--brief' : ''} ${active ? 'active' : ''} ${read ? 'read' : 'unread'}`} data-report-item-id={item.id} data-report-kind={item.spyReport ? "spy" : item.pirateReconReport ? "pirate-recon" : item.overpopulationReport ? "overpopulation" : battle ? "battle" : item.source} data-pirate-recon-outcome={item.pirateReconReport?.outcome}>
      <button type="button" className="reports-list-open" onClick={onOpen} aria-current={active ? 'true' : undefined} aria-label={`Открыть сообщение: ${title}${read ? '' : ', новое'}`}>
        <span className={`reports-list-icon reports-list-icon--${item.category} reports-v2-art`}><ReportArtwork item={item} command={command} /></span>
        <span className="reports-list-copy"><strong>{title}</strong><em>{who}</em></span>
        <span className="reports-list-meta">
          {value ? <b className={`reports-list-value reports-tone--${value.tone}`} data-report-row-value={value.amount ?? ''}>{value.text}</b> : null}
          <time>{saved ? <i className="reports-favorite-dot" aria-label="Бой сохранён" /> : null}{formatTime(item.timestamp)}</time>
        </span>
      </button>
    </article>
  );
}

function EmptyDossier({ category, savedOnly }: { category: ReportCategory; savedOnly: boolean }) {
  const copy = EMPTY_COPY[category];
  return <div className="reports-empty-dossier"><img className={`ui-empty-art ${savedOnly ? '' : 'reports-empty-art--mail'}`} src={savedOnly ? EMPTY_ART.battles : EMPTY_ART.mail} alt="" draggable={false} /><strong>{savedOnly ? 'Сохранённых боёв нет' : copy.title}</strong><span>{savedOnly ? 'Сохрани нужный бой звездой в «Докладах» или во вкладке Флоты → Битвы.' : copy.body}</span></div>;
}

function EmptyFolder({ folder }: { folder: MessageFolder }) {
  const title = folder.category ? EMPTY_COPY[folder.category].title : folder.emptyTitle ?? 'Раздел пока пуст';
  const body = folder.category ? EMPTY_COPY[folder.category].body : folder.emptyBody ?? 'Для этого раздела пока нет подключённого источника данных.';
  return <div className="reports-empty-dossier reports-empty-folder" data-qa-empty-folder><img className="ui-empty-art reports-empty-art--mail" src={EMPTY_ART.mail} alt="" draggable={false} /><strong>{title}</strong><span>{body}</span></div>;
}

function ProfileAvatar({ displayName, factionId }: { displayName: string; factionId: string }) {
  return (
    <div className="reports-profile-avatar">
      <div className="reports-profile-avatar__art"><FactionGeneralPortrait factionId={factionId} className="reports-profile-avatar__portrait faction-general-portrait--large" /></div>
      <div className="reports-profile-avatar__caption"><small>{getCombatFactionName(factionId)} · генерал</small><h3 className="ut-selectable">{displayName}</h3></div>
    </div>
  );
}

function MetricGlyph({ metric }: { metric: PlayerProfileMetricKey }) {
  return <img className="reports-score-glyph" src={asterionAssetIntegrationAssets.scoreIcons[metric]} alt="" aria-hidden="true" draggable={false} />;
}

/** The player's last messages from every folder; a click opens the message. */
function ProfileRecentEvents({ items, onOpen }: { items: readonly ReportItem[]; onOpen: (item: ReportItem) => void }) {
  return (
    <section className="reports-profile-events" aria-label="Последние события">
      <header>Последние события</header>
      {items.length ? <ul>{items.map((item) => <li key={item.id}><button type="button" onClick={() => onOpen(item)} data-qa-profile-event={item.id} aria-label={`Открыть: ${item.title}`}>
        <span className="reports-v2-art reports-profile-event-art"><ReportGlyph kind={item.category} /></span>
        <span className="reports-profile-event-copy"><small>{item.typeLabel}</small><strong>{item.title}</strong></span>
        <time>{formatTime(item.timestamp)}</time>
      </button></li>)}</ul> : <p>Сообщений пока нет. Здесь появятся последние отчёты и письма.</p>}
    </section>
  );
}

const ROLE_LABELS: Record<AllianceRole, string> = { leader: 'Глава', deputy: 'Заместитель', member: 'Участник' };

/** Facts the profile can show from data the game already has; the screen never invents numbers. */
export type ProfileFacts = {
  ratingPlace?: number;
  ratedPlayers?: number;
  planets?: number;
  crystals?: number;
  allianceCrystals?: number;
};

function PlayerProfile({ profile, score, command, mode, recentItems, facts, onOpenCommand, onOpenItem }: { profile: PlayerProfileState; score: OwnerScore | null; command: CommandState; mode: RuntimeMode; recentItems: readonly ReportItem[]; facts: ProfileFacts; onOpenCommand: () => void; onOpenItem: (item: ReportItem) => void }) {
  const metrics = selectPlayerProfileMetrics(profile, score, mode);
  const membership = selectOwnerMembership(command, profile.playerId);
  const alliance = membership ? toAllianceIdentity(membership.alliance) : null;
  const role = membership ? selectRole(membership.alliance, profile.playerId) : null;
  const totalPoints = metrics.find((metric) => metric.key === 'totalPoints')?.value ?? null;
  const factRows: { label: string; value: string }[] = [
    { label: 'Раса', value: getCombatFactionName(profile.factionId) },
    ...(facts.ratingPlace ? [{ label: 'Место в рейтинге', value: facts.ratedPlayers ? `${numberFormat.format(facts.ratingPlace)} из ${numberFormat.format(facts.ratedPlayers)}` : numberFormat.format(facts.ratingPlace) }] : []),
    { label: 'Союз', value: alliance ? `${role ? ROLE_LABELS[role] : 'Участник'} · [${alliance.tag}]` : 'Не в союзе' },
    ...(facts.planets ? [{ label: 'Планеты', value: numberFormat.format(facts.planets) }] : []),
    ...(facts.crystals ? [{ label: 'Кристаллы', value: numberFormat.format(facts.crystals) }] : []),
    ...(facts.allianceCrystals ? [{ label: 'Кристаллы союза', value: numberFormat.format(facts.allianceCrystals) }] : []),
  ];
  return (
    <section className="reports-profile-view" data-qa-profile aria-labelledby="reports-profile-title">
      <span id="reports-profile-title" hidden>Профиль игрока</span>
      <ReportHero
        banner={MISSION_BANNERS['sun-support']!}
        kicker="Профиль игрока"
        tone="info"
        title={<span className="ut-selectable">{profile.displayName}</span>}
        subline={`${getCombatFactionName(profile.factionId)} · ${alliance ? `[${alliance.tag}] ${alliance.name}` : 'без союза'}`}
        value={totalPoints == null ? '—' : formatShortAmount(totalPoints)}
        valueTone="info"
        caption={facts.ratingPlace ? `общие очки · ${numberFormat.format(facts.ratingPlace)} место${facts.ratedPlayers ? ` из ${numberFormat.format(facts.ratedPlayers)}` : ''}` : 'общие очки'}
        qa={{ 'data-qa-profile-hero': '' }}
      />
      <div className="reports-profile-card">
        <section className="reports-profile-identity" aria-label="Аватар игрока">
          <ProfileAvatar displayName={profile.displayName} factionId={profile.factionId} />
          <dl className="reports-profile-facts" data-qa-profile-facts>{factRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
        </section>
        <div className="reports-profile-main">
          <section className="reports-profile-metrics" aria-label="Рейтинг игрока">
            {metrics.map((metric) => <div key={metric.key} className="reports-profile-metric" data-qa-profile-metric={metric.key} tabIndex={0} role="img" aria-label={`${metric.label}: ${metric.value == null ? 'нет данных' : numberFormat.format(metric.value)}`}><span className="reports-profile-metric__glyph"><MetricGlyph metric={metric.key} /></span><span><small>{metric.label}</small><strong>{metric.value == null ? '—' : numberFormat.format(metric.value)}</strong></span></div>)}
          </section>
        </div>
        <section className="reports-profile-alliance" aria-label="Союз и последние события">
          <small>Союз</small>
          {alliance ? <button type="button" className="reports-profile-alliance-link" onClick={onOpenCommand} aria-label={`Открыть Командование союза ${alliance.name}`}><span className="reports-v2-art reports-profile-alliance-art reports-profile-alliance-crest">{membership ? <EmblemGlyph emblem={membership.alliance.emblem} /> : <ReportGlyph kind="alliances" />}</span><span><strong>{alliance.name}</strong><small>[{alliance.tag}] · {numberFormat.format(membership?.alliance.members.length ?? 0)} участников{role ? ` · вы: ${ROLE_LABELS[role].toLocaleLowerCase('ru-RU')}` : ''}</small></span><b>Командование <i aria-hidden="true">→</i></b></button> : <button type="button" className="reports-profile-no-alliance" onClick={onOpenCommand} aria-label="Открыть Командование: найти союз"><span className="reports-profile-diamond" aria-hidden="true">?</span><span><strong>Не в союзе</strong><small>Найти союз или создать свой</small></span><b>Командование <i aria-hidden="true">→</i></b></button>}
          <ProfileRecentEvents items={recentItems} onOpen={onOpenItem} />
        </section>
      </div>
      {profile.protectionMode ? <div className="reports-profile-protection"><i aria-hidden="true" /> Защитный режим включён</div> : null}
      {mode === 'test' ? <p className="reports-fixture-note">Профильная идентичность тестовая; очки рассчитаны по текущим активам владельца, достижения не начисляются.</p> : null}
    </section>
  );
}

export function ReportsView({ ownFleetAttack, retentionCutoff, battleReports, planetNames, savedBattleReportIds, operations, command, espionage, pirateReconReports, pirateFlights, exploration, initialSelectedReportId, profile, score, rating, mode, state, onStateChange, onToggleBattleSaved, onOpenFleets, onOpenCommand, onSimulateBattle, onRecallSpy, onOpenUniverseTarget, onOpenPirateUniverse, canRepeatFlight, onRepeatFlight, onCollectDebris, onAttackSpyTarget, profileFacts, npcStrategy, worldNow, onAnswerLetter }: {
  /** Letters older than this world time are gone (24-hour rule); absent in Test Mode. */
  retentionCutoff?: number;
  battleReports: readonly BattleReport[];
  /** Live names of the player's planets, so flight summaries never show ids. */
  planetNames?: Readonly<Record<string, string>>;
  savedBattleReportIds: readonly string[];
  operations: OperationsState;
  command: CommandState;
  espionage?: import('./domain/espionage/types.ts').EspionageState;
  pirateReconReports?: readonly PirateReconReport[];
  pirateFlights?: readonly import('./domain/flights/types.ts').FlightRecord[];
  exploration?: import('./domain/exploration/ledger.ts').ExplorationState;
  initialSelectedReportId?: string;
  profile: PlayerProfileState;
  score: OwnerScore | null;
  rating: RatingPrototypeState;
  mode: RuntimeMode;
  state: ReportsState;
  onStateChange: (next: ReportsState) => void;
  onToggleBattleSaved: (reportId: string, saved: boolean) => void;
  onOpenFleets: () => void;
  onOpenCommand: () => void;
  onSimulateBattle: (report: SpyReportSnapshot) => void;
  onRecallSpy: (missionId: string) => void;
  onOpenUniverseTarget: (target: { coordinate: UniverseCoordinate; planetId?: string; ownerId?: string }) => void;
  onOpenPirateUniverse: (coordinate: UniverseCoordinate, contactCycleKey: string) => void;
  /** The Fleets screen prefilled from a report (existing launch and repeat flows). */
  canRepeatFlight?: (flightId: string) => boolean;
  onRepeatFlight?: (flightId: string) => void;
  onCollectDebris?: (coordinate: UniverseCoordinate) => void;
  onAttackSpyTarget?: (report: SpyReportSnapshot) => void;
  /** Rating place, planets, crystals for «Профиль игрока». */
  profileFacts?: ProfileFacts;
  /** The bots' letters (invitations, requests, replies) and the world's time they are read at. */
  npcStrategy?: Pick<NpcStrategyState, 'proposals' | 'letters'>;
  worldNow?: number;
  /** «Принять» / «Отказаться» of a bot letter; returns why it could not be done, or null. */
  onAnswerLetter?: (ref: LetterRef, answer: 'accept' | 'decline') => string | null;
  /** Attack of all the player's ships: the risk plaque of a spy report. */
  ownFleetAttack?: number;
}) {
  const [activeFolder, setActiveFolder] = useState<MessageFolderId>('profile');
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [openBattleReportId, setOpenBattleReportId] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState('');
  useEffect(() => { setAnswerError(''); }, [selectedId]);
  const pendingInitialReportId = useRef<string | null>(null);
  const handledInitialReportId = useRef<string | null>(null);

  const npcLetterContext = useMemo(() => (npcStrategy && worldNow !== undefined ? { strategy: npcStrategy, now: worldNow, targets: espionage?.targets } : undefined), [npcStrategy, worldNow, espionage?.targets]);
  const items = useMemo(() => dropExpiredReportItems(buildReportsFeed(battleReports, operations, command, espionage, state.overpopulationReports, state.recyclerArrivalReports, state.gasExtractionArrivalReports, pirateReconReports, pirateFlights, exploration, profile.playerId, { planetNames, factionId: profile.factionId }, npcLetterContext), retentionCutoff, savedBattleReportIds)
    // Battles between third parties (e.g. pirates raiding Bot 01) are not the player's mail.
    .filter((item) => {
      if (!item.battleReportId) return true;
      const report = findBattleReport(battleReports, item);
      if (!report) return true;
      const mine = (id?: string) => isAsterionLocalPlayerId(profile.playerId) ? isAsterionLocalPlayerId(id) : id === profile.playerId;
      return mine(report.attacker.playerId) || mine(report.defender.playerId);
    }), [battleReports, operations, command, espionage, state.overpopulationReports, state.recyclerArrivalReports, state.gasExtractionArrivalReports, pirateReconReports, pirateFlights, exploration, profile.playerId, planetNames, profile.factionId, retentionCutoff, savedBattleReportIds, npcLetterContext]);
  const counts = useMemo(() => getReportCategoryCounts(items, state), [items, state]);
  const unreadCounts = useMemo(() => getReportUnreadCounts(items, state), [items, state]);
  const activeFolderMeta = MESSAGE_FOLDERS.find((folder) => folder.id === activeFolder) ?? MESSAGE_FOLDERS[0];
  const activeCategory = activeFolderMeta.category;
  const folderItems = useMemo(() => activeCategory ? getVisibleReportItems(items, state).filter((item) => item.category === activeCategory) : [], [activeCategory, items, state]);
  const isRead = useMemo(() => reportReadCheck(state), [state]);
  const visibleItems = useMemo(() => activeCategory ? filterReportItems(items, state, { category: activeCategory, filter, search, keepId: selectedId || undefined }, savedBattleReportIds) : [], [activeCategory, items, state, filter, search, selectedId, savedBattleReportIds]);
  // The last five messages of every folder (owner, 11.11.2026).
  const recentProfileItems = getVisibleReportItems(items, state).slice(0, 5);
  const battleById = useMemo(() => new Map(battleReports.map((report) => [report.id, report] as const)), [battleReports]);
  const isMine = useMemo(() => (id?: string | null) => (isAsterionLocalPlayerId(profile.playerId) ? isAsterionLocalPlayerId(id) : id === profile.playerId), [profile.playerId]);
  const headlineContext = useMemo<HeadlineContext>(() => ({
    isMine,
    playerFactionId: profile.factionId,
    targetBuildings: (planetId) => espionage?.targets?.[planetId]?.buildings,
    ownFleetAttack,
    now: worldNow,
  }), [isMine, profile.factionId, espionage?.targets, ownFleetAttack, worldNow]);
  // One value and one «who / where» per row; the list scrolls, so all rows are built.
  const rows = useMemo(() => visibleItems.map((item) => {
    const battle = item.battleReportId ? battleById.get(item.battleReportId) ?? null : null;
    return { item, battle, value: reportRowValue(item, battle, headlineContext), who: whoWhere(item, battle, isMine) };
  }), [visibleItems, battleById, headlineContext, isMine]);
  const selectedItem = visibleItems.find((item) => item.id === selectedId) ?? null;
  const selectedBattle = findBattleReport(battleReports, selectedItem);
  const selectedBattleSaved = selectedItem?.battleReportId ? savedBattleReportIds.includes(selectedItem.battleReportId) : false;
  const openBattleReport = openBattleReportId ? battleReports.find((report) => report.id === openBattleReportId) ?? null : null;
  const openBattleViewModel = openBattleReport ? createBattleReportViewModel(openBattleReport, {
    awardedBattlePoints: selectRecordedBattlePointAwards(rating, openBattleReport, profile.playerId),
  }) : null;

  useEffect(() => {
    if (pendingInitialReportId.current === null) setSelectedId('');
    if (activeFolderMeta.category) setFilter('all');
  }, [activeFolder, activeFolderMeta.category]);
  useEffect(() => {
    if (!initialSelectedReportId || handledInitialReportId.current === initialSelectedReportId) return;
    handledInitialReportId.current = initialSelectedReportId;
    pendingInitialReportId.current = initialSelectedReportId;
    const target = items.find((item) => item.id === initialSelectedReportId
      || item.pirateReconReport?.id === initialSelectedReportId
      || item.battleReportId === initialSelectedReportId);
    // Pirate recon is a System report; completed pirate raids link to Battle reports.
    const folder = MESSAGE_FOLDERS.find((item) => item.category === (target?.category ?? 'system'));
    setActiveFolder(folder?.id ?? 'system');
    setFilter('all');
    setSearch('');
  }, [initialSelectedReportId, items]);
  useEffect(() => {
    const requestedId = pendingInitialReportId.current;
    if (!requestedId) return;
    const targetIndex = visibleItems.findIndex((item) => item.id === requestedId
      || item.pirateReconReport?.id === requestedId
      || item.battleReportId === requestedId);
    if (targetIndex < 0) return;
    const target = visibleItems[targetIndex]!;
    if (activeCategory !== target.category) return;
    setSelectedId(target.id);
    pendingInitialReportId.current = null;
  }, [activeCategory, initialSelectedReportId, visibleItems]);
  useEffect(() => { if (activeCategory !== 'battle' && filter === 'saved') setFilter('all'); }, [activeCategory, filter]);
  useEffect(() => {
    if (activeFolder === 'profile' || !activeCategory || !visibleItems.length) {
      if (selectedId) setSelectedId('');
      return;
    }
    if (!visibleItems.some((item) => item.id === selectedId)) setSelectedId(visibleItems[0].id);
  }, [activeCategory, activeFolder, selectedId, visibleItems]);
  useEffect(() => {
    const onRuntimeReset = () => {
      setActiveFolder('profile');
      setFilter('all');
      setSearch('');
      setSearchOpen(false);
      setSelectedId('');
      setOpenBattleReportId(null);
    };
    window.addEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
    return () => window.removeEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
  }, []);

  const openFolder = (folder: MessageFolderId) => {
    setActiveFolder(folder);
    setFilter('all');
    setSearch('');
  };

  /** «Последние события» of the profile: the folder of that message, the message open. */
  const openFromProfile = (item: ReportItem) => {
    const folder = MESSAGE_FOLDERS.find((candidate) => candidate.category === item.category);
    if (!folder) return;
    pendingInitialReportId.current = item.id;
    setActiveFolder(folder.id);
    setFilter('all');
    setSearch('');
  };

  const openItem = (item: ReportItem) => {
    setSelectedId(item.id);
    if (!isRead(item)) onStateChange(withOverpopulationReports(markReportRead(state, item.id), state));
  };
  // Owner rule (06.11.2026): what is open in the reading pane is read, the first
  // message opened on entering a section included; no extra click.
  useEffect(() => {
    if (selectedItem && !isRead(selectedItem)) onStateChange(withOverpopulationReports(markReportRead(state, selectedItem.id), state));
  }, [selectedItem, isRead, state, onStateChange]);

  const deleteAll = () => {
    if (!activeCategory || !window.confirm('Вы уверены, что хотите удалить все сообщения в этом разделе?')) return;
    onStateChange(withOverpopulationReports(deleteAllReports(state, items, activeCategory), state));
    setSelectedId('');
  };
  const deleteCurrent = () => {
    if (!activeCategory || !selectedItem || !window.confirm('Удалить это сообщение?')) return;
    onStateChange(withOverpopulationReports(deleteSelectedReports(state, items, activeCategory, [selectedItem.id]), state));
    setSelectedId('');
  };

  const availableFilters: ReportFilter[] = activeCategory === 'battle' ? ['all', 'unread', 'saved'] : ['all', 'unread'];
  const markableItems = getVisibleReportItems(items, state);
  const markAll = () => onStateChange(withOverpopulationReports(markAllReportsRead(state, markableItems), state));

  // One format for every report: the sheet (header, shared blocks, actions).
  const selectedBattleViewModel = useMemo(() => selectedBattle ? createBattleReportViewModel(selectedBattle, {
    awardedBattlePoints: selectRecordedBattlePointAwards(rating, selectedBattle, profile.playerId),
  }) : null, [selectedBattle, rating, profile.playerId]);
  const selectedSheet = useMemo(() => selectedItem ? buildReportSheet(selectedItem, selectedBattleViewModel, { canRepeatFlight: onRepeatFlight ? canRepeatFlight : undefined }) : null, [selectedItem, selectedBattleViewModel, canRepeatFlight, onRepeatFlight]);
  const runAction = (action: ReportSheetAction) => {
    if (!selectedItem) return;
    if (action.kind === 'open_battle' && selectedBattle) setOpenBattleReportId(selectedBattle.id);
    else if (action.kind === 'simulate_battle' && selectedItem.spyReport) onSimulateBattle(selectedItem.spyReport);
    else if (action.kind === 'recall_spy' && action.missionId) onRecallSpy(action.missionId);
    else if (action.kind === 'open_fleets') onOpenFleets();
    else if (action.kind === 'open_command') onOpenCommand();
    else if ((action.kind === 'accept' || action.kind === 'decline') && selectedItem.letter?.ref && onAnswerLetter) setAnswerError(onAnswerLetter(selectedItem.letter.ref, action.kind) ?? '');
    else if (action.kind === 'collect_debris' && action.coordinate) onCollectDebris?.(action.coordinate);
    else if (action.kind === 'attack_target' && selectedItem.spyReport) onAttackSpyTarget?.(selectedItem.spyReport);
    else if (action.kind === 'repeat_flight' && action.flightId) onRepeatFlight?.(action.flightId);
    else if (action.kind === 'show_on_map' && action.coordinate) {
      const place = selectedItem.pirateReconReport;
      if (place) onOpenPirateUniverse(action.coordinate, place.contactCycleKey);
      else onOpenUniverseTarget({ coordinate: action.coordinate });
    }
  };
  const wired: Partial<Record<ReportSheetAction['kind'], boolean>> = {
    collect_debris: Boolean(onCollectDebris), attack_target: Boolean(onAttackSpyTarget), repeat_flight: Boolean(onRepeatFlight),
    // «Принять» / «Отказаться» are drawn only on a bot letter that has something to act on.
    accept: Boolean(onAnswerLetter && selectedItem?.letter?.ref), decline: Boolean(onAnswerLetter && selectedItem?.letter?.ref),
  };
  const offered = (selectedSheet?.actions ?? []).filter((action) => wired[action.kind] !== false);
  // One primary: the first offered primary keeps it.
  const firstPrimary = offered.findIndex((action) => action.primary);
  const sheetActions = offered.map((action, index) => ({ ...action, primary: index === firstPrimary }));

  const previewBody = !activeCategory
    ? <EmptyFolder folder={activeFolderMeta} />
    : !selectedItem || !selectedSheet
      ? <EmptyDossier category={activeCategory} savedOnly={filter === 'saved'} />
      : <ReportSheetView
        key={selectedItem.id}
        item={selectedItem}
        sheet={selectedSheet}
        battle={selectedBattle}
        context={headlineContext}
        exploration={exploration}
        command={command}
        onOpenUniverseTarget={onOpenUniverseTarget}
        onOpenPirateUniverse={onOpenPirateUniverse}
        lead={selectedBattle ? <SunReportStrip report={selectedBattle} /> : undefined}
      />;

  // Sections with mail on top with counters; empty ones below, grey, under «ПУСТО» (owner, 12.11.2026).
  const filledFolders = MESSAGE_FOLDERS.filter((folder) => folder.category && counts[folder.category] > 0);
  const emptyFolders = MESSAGE_FOLDERS.filter((folder) => !folder.category || counts[folder.category] === 0);
  const folderButton = (folder: MessageFolder, empty: boolean) => {
    const unread = folder.category ? unreadCounts[folder.category] : 0;
    const total = folder.category ? counts[folder.category] : 0;
    return <button key={folder.id} type="button" data-message-folder={folder.id} data-folder-empty={empty ? '' : undefined} className={`${activeFolder === folder.id ? 'active' : ''} ${empty ? 'is-empty' : ''}`} onClick={() => openFolder(folder.id)} aria-current={activeFolder === folder.id ? 'page' : undefined} aria-label={`${folder.label}: ${unread} непрочитанных из ${total}`}>
      <span className="reports-nav-art"><ReportGlyph kind={folder.glyph} /></span>
      <strong>{folder.label}</strong>
      {empty ? null : <span className="reports-folder-counter" aria-hidden="true"><b className={`reports-v2-unread-count ${unread > 0 ? 'is-new' : ''}`}>{unread > 0 ? formatUnread(unread) : formatUnread(total)}</b></span>}
    </button>;
  };
  const savedBattle = (item: ReportItem) => Boolean(item.battleReportId && savedBattleReportIds.includes(item.battleReportId));
  const clockNow = worldNow ?? Date.now();
  const groupedRows: { day: string; rows: typeof rows }[] = [];
  for (const row of rows) {
    const day = dayLabel(row.item.timestamp, clockNow);
    const last = groupedRows[groupedRows.length - 1];
    if (last?.day === day) last.rows.push(row);
    else groupedRows.push({ day, rows: [row] });
  }
  const hasMail = Boolean(activeCategory && counts[activeCategory]);

  return (
    <main className={`reports-view reports-view--mail ${activeFolder === 'profile' ? 'reports-view--profile' : 'reports-view--folder'}`} aria-label="Сообщения">
      <aside className="reports-categories">
        <header><h1>Сообщения</h1></header>
        <button type="button" className={`reports-profile-nav ${activeFolder === 'profile' ? 'active' : ''}`} onClick={() => openFolder('profile')} data-message-profile aria-label="Открыть профиль" aria-current={activeFolder === 'profile' ? 'page' : undefined}><span className="reports-nav-art"><ProfileGlyph /></span><strong>Профиль</strong></button>
        <nav className="reports-message-nav" aria-label="Папки сообщений">
          {filledFolders.map((folder) => folderButton(folder, false))}
          {emptyFolders.length ? <span className="reports-nav-empty-label" data-qa-empty-label>Пусто</span> : null}
          {emptyFolders.map((folder) => folderButton(folder, true))}
        </nav>
      </aside>

      {activeFolder === 'profile' ? <PlayerProfile profile={profile} score={score} command={command} mode={mode} recentItems={recentProfileItems} facts={profileFacts ?? {}} onOpenCommand={onOpenCommand} onOpenItem={openFromProfile} /> : <section className="reports-folder-workspace" data-qa-folder-view={activeFolder}>
        <section className="reports-feed" data-qa-message-folder-view={activeFolder}>
          <header className="reports-feed-head">
            <h2>{activeFolderMeta.label}</h2>
            {hasMail ? <button className="reports-mark-all" type="button" data-qa-mark-all-read disabled={!markableItems.some((item) => !isRead(item))} onClick={markAll}>Прочитать все</button> : null}
          </header>
          {hasMail ? <div className="reports-feed-tools">
            <div className="reports-v2-filter-segments" role="group" aria-label="Фильтр сообщений">{availableFilters.map((key) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{FILTER_LABELS[key]}</button>)}</div>
            <button type="button" className={`reports-search-toggle ${searchOpen || search ? 'is-on' : ''}`} aria-pressed={searchOpen || Boolean(search)} aria-label="Поиск в разделе" data-qa-search-toggle onClick={() => { if (searchOpen) setSearch(''); setSearchOpen(!searchOpen); }}><SearchGlyph /></button>
          </div> : null}
          {hasMail && (searchOpen || search) ? <label className="reports-search"><span aria-hidden="true"><SearchGlyph /></span><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск в разделе" aria-label="Поиск в разделе сообщений" /></label> : null}
          <div className="reports-list" data-qa-message-list>
            {!hasMail
              ? <p className="reports-list-empty-status reports-list-empty-status--folder" role="status">Здесь пусто</p>
              : rows.length
                ? groupedRows.map((day, index) => <section className="reports-list-day" key={`${day.day}-${index}`} aria-label={day.day}>
                  <h3 className="reports-list-day__label">{day.day}</h3>
                  {day.rows.map(({ item, battle, value, who }) => <ReportListItem key={item.id} item={item} battle={battle} value={value} who={who} command={command} active={item.id === selectedId} read={isRead(item)} saved={savedBattle(item)} onOpen={() => openItem(item)} />)}
                </section>)
                : <p className="reports-list-empty-status" role="status">{search || filter !== 'all' ? 'Ничего не найдено.' : 'Сообщений в этом разделе пока нет.'}</p>}
          </div>
          {hasMail ? <footer className="reports-feed-foot">
            <span className="reports-folder-count">{messagesLabel(visibleItems.length)}</span>
            <button type="button" className="reports-delete-all" data-qa-delete-all disabled={!folderItems.length} onClick={deleteAll}>Удалить все</button>
          </footer> : null}
        </section>

        <section className="reports-preview" aria-label="Открытое сообщение">
          <div className="reports-preview-scroll">{previewBody}</div>
          {activeCategory && selectedItem ? <footer className="reports-preview-footer">
            {answerError ? <p className="reports-answer-error" role="alert" data-qa-letter-error>{answerError}</p> : null}
            <button type="button" className="reports-delete-current" onClick={deleteCurrent}>Удалить</button>
            <div className="reports-preview-footer-actions">
              {selectedItem.battleReportId ? <button type="button" className={selectedBattleSaved ? 'restore' : ''} aria-pressed={selectedBattleSaved} data-report-action="save_battle" onClick={() => onToggleBattleSaved(selectedItem.battleReportId!, !selectedBattleSaved)}>{selectedBattleSaved ? 'Убрать из сохранённых' : 'Сохранить бой'}</button> : null}
              {[...sheetActions.filter((action) => !action.primary), ...sheetActions.filter((action) => action.primary)].map((action) => <button
                key={action.kind}
                type="button"
                className={action.primary ? 'reports-primary-action' : action.kind === 'recall_spy' ? 'restore' : ''}
                data-report-action={action.kind}
                onClick={() => runAction(action)}
              >{action.label}</button>)}
            </div>
          </footer> : null}
        </section>
        {openBattleReport && openBattleViewModel ? <BattleReportModal report={openBattleReport} viewModel={openBattleViewModel} saved={savedBattleReportIds.includes(openBattleReport.id)} onToggleSaved={() => onToggleBattleSaved(openBattleReport.id, !savedBattleReportIds.includes(openBattleReport.id))} onClose={() => setOpenBattleReportId(null)} /> : null}
      </section>}
    </main>
  );
}
