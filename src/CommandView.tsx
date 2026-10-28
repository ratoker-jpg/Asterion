import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { MAX_ALLIANCE_MEMBERS, TEST_BOT_ALLIANCE_ID } from './domain/command/catalog.ts';
import {
  canManageAlliance,
  filterAllianceCatalog,
  isAllianceFull,
  memberScore,
  selectAllianceCatalog,
  selectLastResolvedApplication,
  selectOrderedMembers,
  selectOwnerMembership,
  selectPendingApplication,
  selectPendingApplicationsFor,
  selectReapplyBlock,
  selectAllianceRating,
  type AllianceCatalogEntry,
  type MemberScore,
} from './domain/command/selectors.ts';
import { AID_RESOURCES, AID_RESOURCE_LABELS } from './domain/command/aid.ts';
import { selectAllianceJournal, type JournalEntry, type JournalView } from './domain/command/journal.ts';
import { getCombatEntity } from './domain/combat/catalog.ts';
import { getFactionShipCatalog } from './domain/combat/faction-catalog.ts';
import { selectAllianceRelations, selectTruceAvailability } from './domain/command/diplomacy.ts';
import { getFactionGeneralAsset } from './domain/profile/faction-assets.ts';
import type { AidOverview, AidRequestRow } from './application/alliance-aid.ts';
import type {
  AidResource,
  AllianceApplication,
  AllianceMember,
  AllianceRole,
  AllianceSettingsInput,
  CommandState,
} from './domain/command/types.ts';
import type { RuntimeMode } from './domain/runtime/mode.ts';
import { asterionAssetIntegrationAssets } from './assets/generated/asterionAssetIntegrationManifest.generated.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import { ACCENT_COLORS, EmblemGlyph } from './ui/command/EmblemGlyph';
import { AllianceEditor } from './ui/command/AllianceEditor';
import { Dialog } from './ui/command/Dialog';
import { renderRichText } from './ui/command/rich-text';
import commandHeaderIcon from './assets/ui/header-icons/command.png';
import aidMissionIcon from '../assets/source/mission-icons-v1/33_trade_convoy.png';
import sunMissionIcon from '../assets/source/mission-icons-v1/08_sun_support.png';
import sunArt from '../assets/source/battle-report-v2/battle-sun-transparent-v1.png';
import './command.css';

export type CommandActionResult = { ok: true; message?: string } | { ok: false; message: string };

export type CommandActions = {
  createAlliance: (settings: AllianceSettingsInput) => CommandActionResult;
  updateSettings: (settings: AllianceSettingsInput) => CommandActionResult;
  apply: (allianceId: string) => CommandActionResult;
  withdraw: () => CommandActionResult;
  accept: (applicationId: string) => CommandActionResult;
  reject: (applicationId: string) => CommandActionResult;
  leave: (successorOwnerId?: string) => CommandActionResult;
  kick: (ownerId: string) => CommandActionResult;
  setDeputy: (ownerId: string | null) => CommandActionResult;
  transferLeadership: (ownerId: string) => CommandActionResult;
  openHallConstruction: () => void;
  /** One resource, one of the player's own planets, an amount within the limit. */
  createRequest: (planetId: string, resource: AidResource, amount: number) => CommandActionResult;
  cancelRequest: (requestId: string) => CommandActionResult;
  /** Opens the real fleet window prepared for the "Помощь союзу" mission of this request. */
  startHelp: (requestId: string) => CommandActionResult;
  /** How much of the requested amount a full warehouse would burn on arrival. */
  previewOverflow: (planetId: string, resource: AidResource, amount: number) => { lost: number; free: number };
  /** Test Mode only: puts real transporters and stock on Ira Vel's planet. */
  testIraPrepare?: () => CommandActionResult;
  /** Test Mode only: Ira Vel files a request through the normal rules. */
  testIraRequest?: (resource: AidResource, amount: number) => CommandActionResult;
  /** Test Mode only: Ira Vel serves the player's request with a real flight. */
  testIraHelp?: () => CommandActionResult;
  /** Leader or deputy: war is declared at once, without the other side's consent. */
  declareWar: (targetAllianceId: string) => CommandActionResult;
  /** Offer a truce (3 h after the war began / after a rejection). */
  proposeTruce: (targetAllianceId: string) => CommandActionResult;
  /** Answer the other side's truce offer. */
  respondTruce: (fromAllianceId: string, accept: boolean) => CommandActionResult;
  /** Opens the fleet window with a transport to a member's known planet (the planet is never shown here). */
  sendFleetToMember: (ownerId: string) => CommandActionResult;
  canSendFleetToMember: (ownerId: string) => boolean;
  /** Test Mode only: a controlled NPC applies to the player's alliance. */
  testBotApply?: () => CommandActionResult;
  /** Test Mode only: Bot 01 answers the player's truce offer. */
  testBotRespondTruce?: (accept: boolean) => CommandActionResult;
  /** Test Mode only: Bot 01 offers the player's alliance a truce. */
  testBotProposeTruce?: () => CommandActionResult;
  /** Test Mode only: Bot 01 declares war on the player's alliance. */
  testBotDeclareWar?: () => CommandActionResult;
};

export type CommandHallInfo = { level: number; name: string; art: string };

type CommandViewProps = {
  mode: RuntimeMode;
  command: CommandState;
  ownerId: string;
  hall: CommandHallInfo;
  ownerScores: Readonly<Record<string, MemberScore | undefined>>;
  /** Known factions by owner id. Only real data: an unknown owner gets initials, never an invented race. */
  ownerFactions?: Readonly<Record<string, string | undefined>>;
  /** The player's race: ship art (transporters, the Sun raid fleet) follows it. */
  playerFactionId?: string;
  /** Test Mode clock acceleration for the 3-hour diplomacy timers; 1 in production. */
  testTimeScale?: number;
  /** Set when Command was opened from the Палата управления interior: the way back to the building. */
  returnToBuilding?: { label: string; onBack: () => void };
  aid: AidOverview;
  /** Wall-clock milliseconds; drives the re-application countdowns. */
  now: number;
  actions: CommandActions;
  /** «Операции → Рейд на Солнце» panel (App renders it with the live save). */
  operationsPanel?: ReactNode;
  /** Incoming Sun raids in the player's galaxies: a hot badge on «Операции». */
  operationsAlertCount?: number;
  /** Jump request from the map, alerts or the Fleet tile; `nonce` makes repeats work. */
  focusTab?: { tab: 'operations' | 'overview'; nonce: number } | null;
};

type CommandTab = 'overview' | 'members' | 'applications' | 'requests' | 'alliances' | 'diplomacy' | 'operations';

const TAB_LABELS: Record<CommandTab, string> = {
  overview: 'ШТАБ',
  members: 'СОСТАВ',
  applications: 'ЗАЯВКИ',
  requests: 'ПОМОЩЬ',
  alliances: 'СОЮЗЫ',
  diplomacy: 'ДИПЛОМАТИЯ',
  operations: 'ОПЕРАЦИИ',
};

const ROLE_LABELS: Record<AllianceRole, string> = {
  leader: 'ЛИДЕР',
  deputy: 'ЗАМЕСТИТЕЛЬ',
  member: 'УЧАСТНИК',
};

const ROLE_COLORS: Record<AllianceRole, string> = {
  leader: '#e6ad50',
  deputy: '#56d9f2',
  member: '#8fb6c0',
};

const FACTION_LABELS: Record<string, string> = { aegis: 'Астеры', synod: 'Илары', veyra: 'Рой' };

const SCORE_ICONS = asterionAssetIntegrationAssets.scoreIcons;
const REPORT_ICONS = asterionAssetIntegrationAssets.reportIcons;
const FACTION_FACES: Readonly<Record<string, string>> = asterionAssetIntegrationAssets.battleFactionIcons;
const SUN_RAID_SHIP_IDS = ['death-star', 'battleship', 'destroyer', 'cruiser'] as const;

/** Ship art of the player's race (Астеры / Илары / Рой); falls back to the base catalog. */
function shipArtOf(factionId: string | undefined, shipId: Parameters<typeof getCombatEntity>[0]): string {
  const catalog = factionId === 'aegis' || factionId === 'synod' || factionId === 'veyra' ? getFactionShipCatalog(factionId) : null;
  return catalog?.find((ship) => ship.id === shipId)?.art ?? getCombatEntity(shipId).art;
}

function shipNameOf(factionId: string | undefined, shipId: Parameters<typeof getCombatEntity>[0]): string {
  const catalog = factionId === 'aegis' || factionId === 'synod' || factionId === 'veyra' ? getFactionShipCatalog(factionId) : null;
  return catalog?.find((ship) => ship.id === shipId)?.name ?? getCombatEntity(shipId).name;
}

const number = new Intl.NumberFormat('ru-RU');

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDate(timestamp: number) {
  return timestamp > 0 ? new Date(timestamp).toLocaleDateString('ru-RU') : '—';
}

function initials(name: string) {
  return name.split(' ').map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
}

function formatCoordinate(coordinate: { galaxy: number; system: number; position: number }) {
  return `${coordinate.galaxy}:${coordinate.system}:${coordinate.position}`;
}

export { EmblemGlyph };

// ---- shared presentation pieces ------------------------------------------------

function Img({ src, className = '' }: { src: string; className?: string }) {
  return <img src={src} alt="" className={className} draggable={false} />;
}

function Medal({ kind, className = '' }: { kind: 'total' | 'resource' | 'battle' | 'achievement'; className?: string }) {
  const src = kind === 'total' ? SCORE_ICONS.totalPoints : kind === 'resource' ? SCORE_ICONS.resourcePoints : kind === 'battle' ? SCORE_ICONS.battlePoints : SCORE_ICONS.achievementPoints;
  return <Img src={src} className={`cmdA-medal ${className}`} />;
}

function MissionTile({ src, className = '' }: { src: string; className?: string }) {
  return <span className={`cmdA-mtile ${className}`}><Img src={src} /></span>;
}

/** `own` marks the player's own things (you, your alliance) and takes the race colour. */
function Chip({ tone = '', children }: { tone?: '' | 'cy' | 'am' | 'ok' | 'bad' | 'vi' | 'solid' | 'own'; children: ReactNode }) {
  return <span className={`cmdA-chip ${tone ? `is-${tone}` : ''}`}>{children}</span>;
}

function Avatar({ name, role, factionId, size = 'md' }: { name: string; role?: AllianceRole; factionId?: string; size?: 'sm' | 'md' | 'lg' }) {
  const face = factionId ? FACTION_FACES[factionId] : undefined;
  const style = role ? ({ '--k': ROLE_COLORS[role] } as CSSProperties) : undefined;
  return (
    <span className={`command-avatar cmdA-avatar cmdA-avatar--${size} ${role ? `is-${role}` : ''}`} style={style}>
      {face ? <Img src={face} /> : initials(name)}
    </span>
  );
}

/** Large hero art for a person: the race general when the race is really known, otherwise an honest monogram. */
function PersonArt({ name, factionId }: { name: string; factionId?: string }) {
  const general = getFactionGeneralAsset(factionId);
  if (general) return <div className="cmdA-art cmdA-art--general"><Img src={general} /></div>;
  return (
    <div className="cmdA-art cmdA-art--monogram">
      <Img src={REPORT_ICONS.profile} className="cmdA-monogram-icon" />
      <span className="cmdA-monogram">{initials(name)}</span>
    </div>
  );
}

function ListPanel({ kicker, title, count, tools, children, footer, className = '' }: {
  kicker: string;
  title: string;
  count?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`cmdA-panel cmdA-list ${className}`}>
      <header className="cmdA-list-head">
        <div><small>{kicker}</small><h3>{title}</h3></div>
        {count !== undefined ? <span className="cmdA-count">{count}</span> : null}
      </header>
      {tools ? <div className="cmdA-list-tools">{tools}</div> : null}
      <div className="cmdA-list-scroll">{children}</div>
      {footer}
    </section>
  );
}

function Dossier({ children, footer, className = '' }: { children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={`cmdA-panel cmdA-dossier ${className}`}>
      <div className="cmdA-dossier-body">{children}</div>
      {footer ? <footer className="cmdA-foot">{footer}</footer> : null}
    </section>
  );
}

function FootStatus({ label, value }: { label: string; value: ReactNode }) {
  return <div className="cmdA-foot-status"><small>{label}</small><strong>{value}</strong></div>;
}

type TileSpec = { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'cy' | 'am' };

function Tiles({ items }: { items: TileSpec[] }) {
  return (
    <div className="cmdA-tiles" style={{ '--cmdA-cols': items.length } as CSSProperties}>
      {items.map((item) => (
        <div className="cmdA-tile" key={item.label}>
          <span className="cmdA-tile-icon">{item.icon}</span>
          <div className="cmdA-tile-copy">
            <small>{item.label}</small>
            <strong className={item.tone ? `is-${item.tone}` : ''}>{item.value}</strong>
            {item.sub ? <span>{item.sub}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function Hero({ art, children, className = '' }: { art: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`cmdA-hero ${className}`}>
      {art}
      <div className="cmdA-hero-copy">{children}</div>
    </div>
  );
}

function HeroTitle({ chips, title, children }: { chips?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <>
      {chips ? <div className="cmdA-chips">{chips}</div> : null}
      <h2 className="cmdA-hero-title" title={title}>{title}</h2>
      {children}
    </>
  );
}

function ScoreGrid({ score }: { score: MemberScore }) {
  return (
    <dl className="command-score-grid cmdA-score-grid">
      <div><Medal kind="total" /><dt>Общие</dt><dd>{number.format(score.totalPoints)}</dd></div>
      <div><Medal kind="resource" /><dt>Ресурсные</dt><dd>{number.format(score.resourcePoints)}</dd></div>
      <div><Medal kind="battle" /><dt>Боевые</dt><dd>{number.format(score.battlePoints)}</dd></div>
      <div><Medal kind="achievement" /><dt>Достижения</dt><dd>{number.format(score.achievementPoints)}</dd></div>
    </dl>
  );
}

function Stub({ title, children, qa, icon }: { title: string; children: string; qa: 'sun'; icon: ReactNode }) {
  return (
    <div className={`command-stub cmdA-stub cmdA-stub--${qa}`} data-qa-command-stub data-qa-sun-raid="" role="status">
      {icon}
      <div>
        <small>СОВМЕСТНАЯ ОПЕРАЦИЯ</small>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </div>
  );
}

// ---- journal (now the first thing a member sees, on «Штаб») --------------------

const JOURNAL_KIND_LABELS: Record<JournalEntry['kind'], string> = {
  request_created: 'Создан запрос ресурсов',
  request_cancelled: 'Запрос отменён автором',
  request_closed: 'Запрос закрыт',
  aid_launched: 'Отправлена помощь',
  aid_delivered: 'Помощь доставлена',
  aid_returned: 'Помощь вернулась',
};

const JOURNAL_CLOSE_LABELS: Record<NonNullable<JournalEntry['closeReason']>, string> = {
  completed: 'Запрос выполнен',
  cancelled: 'Запрос отменён автором',
  author_left: 'Запрос закрыт: автор покинул союз',
  alliance_disbanded: 'Запрос закрыт: союз расформирован',
  planet_destroyed: 'Запрос закрыт: планета назначения утрачена',
};

const JOURNAL_TONES: Record<JournalEntry['kind'], string> = {
  request_created: '#e6ad50',
  request_cancelled: '#ff8c9c',
  request_closed: '#35e58a',
  aid_launched: '#56d9f2',
  aid_delivered: '#35e58a',
  aid_returned: '#8fb6c0',
};

function journalTitle(entry: JournalEntry) {
  if (entry.kind === 'request_closed' && entry.closeReason) return JOURNAL_CLOSE_LABELS[entry.closeReason];
  if (entry.kind === 'aid_delivered' && entry.units === 0) return 'Груз не принят планетой';
  return JOURNAL_KIND_LABELS[entry.kind];
}

function journalDetail(entry: JournalEntry) {
  const parts: string[] = [];
  if (entry.actorName) parts.push(entry.actorName);
  if (entry.units && entry.kind !== 'request_closed' && entry.kind !== 'request_created') {
    parts.push(`${number.format(entry.units)}${entry.resource ? ` · ${AID_RESOURCE_LABELS[entry.resource]}` : ' ед.'}`);
  } else if (entry.resource && entry.kind === 'request_created') {
    parts.push(AID_RESOURCE_LABELS[entry.resource]);
  }
  return parts.join(' · ');
}

function JournalIcon({ entry }: { entry: JournalEntry }) {
  if (entry.kind.startsWith('aid_')) return <MissionTile src={aidMissionIcon} className="cmdA-item-icon" />;
  if (entry.resource) return <span className="cmdA-res-box cmdA-item-icon"><ResourceIcon kind={entry.resource} /></span>;
  return <span className="cmdA-res-box cmdA-item-icon"><Img src={REPORT_ICONS.alliances} /></span>;
}

function JournalPanel({ view, now }: { view: JournalView; now: number }) {
  // The panel only ever receives the already filtered view; a locked journal carries no event data.
  if (view.state === 'no_membership') return null;
  return (
    <ListPanel kicker="ИСТОРИЯ СОБЫТИЙ" title="Журнал союза" count={view.state === 'open' ? view.entries.length : undefined} className="command-journal">
      {view.state === 'locked' ? (
        <div className="command-journal__locked" data-qa-journal-state="locked">
          <div className="command-journal__skeleton" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <p role="status">История станет доступна через <strong data-qa-journal-countdown>{formatCountdown(view.unlocksAt - now)}</strong>. Новый участник читает журнал не раньше чем через 2 часа после вступления.</p>
        </div>
      ) : view.entries.length === 0 ? (
        <p className="cmdA-empty" data-qa-journal-state="empty">С момента вступления событий пока нет.</p>
      ) : (
        <ol className="command-journal__list cmdA-items" data-qa-journal-state="open" data-qa-journal-count={view.entries.length}>
          {view.entries.map((entry) => (
            <li key={entry.id} className="cmdA-item" style={{ '--k': JOURNAL_TONES[entry.kind] } as CSSProperties} data-qa-journal-entry={entry.kind}>
              <JournalIcon entry={entry} />
              <div className="cmdA-item-main">
                <strong>{journalTitle(entry)}</strong>
                {journalDetail(entry) ? <span>{journalDetail(entry)}</span> : null}
              </div>
              <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</time>
            </li>
          ))}
        </ol>
      )}
    </ListPanel>
  );
}

// ---- dialogs -------------------------------------------------------------------

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose }: { title: string; body: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="command-dialog-body">{body}</p>
      <div className="command-actions">
        <button type="button" onClick={onClose}>ОТМЕНА</button>
        <button type="button" className="danger" onClick={() => { onConfirm(); onClose(); }} data-qa-confirm>{confirmLabel}</button>
      </div>
    </Dialog>
  );
}

function LeaveDialog({ isLeader, defaultSuccessorId, others, onLeave, onClose }: {
  isLeader: boolean;
  defaultSuccessorId: string | null;
  others: Array<{ ownerId: string; name: string }>;
  onLeave: (successorId?: string) => void;
  onClose: () => void;
}) {
  const needsSuccessor = isLeader && others.length > 0;
  const [successor, setSuccessor] = useState<string>(defaultSuccessorId ?? others[0]?.ownerId ?? '');
  const soleMember = others.length === 0;
  return (
    <Dialog title="Покинуть союз?" onClose={onClose}>
      <div className="command-dialog-body">
        <p>{soleMember
          ? 'Вы единственный участник: союз будет расформирован и удалён.'
          : 'После выхода 2 часа нельзя подавать заявки в любые союзы.'}</p>
        {needsSuccessor ? (
          <label className="command-select">
            <span>НОВЫЙ ЛИДЕР</span>
            <select value={successor} onChange={(event) => setSuccessor(event.target.value)} data-qa-successor>
              {others.map((member) => <option key={member.ownerId} value={member.ownerId}>{member.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <div className="command-actions">
        <button type="button" onClick={onClose}>ОТМЕНА</button>
        <button type="button" className="danger" onClick={() => { onLeave(needsSuccessor ? successor : undefined); onClose(); }} data-qa-confirm>{soleMember ? 'РАСФОРМИРОВАТЬ' : 'ПОКИНУТЬ'}</button>
      </div>
    </Dialog>
  );
}

// ---- locked --------------------------------------------------------------------

function LockedHall({ hall, onBuild }: { hall: CommandHallInfo; onBuild: () => void }) {
  return (
    <div className="command-locked cmdA-panel cmdA-locked" data-qa-command-locked role="status">
      <div className="command-locked-art cmdA-locked-art"><img src={hall.art} alt="" draggable={false} /></div>
      <div className="command-locked-copy cmdA-locked-copy">
        <Chip tone="bad">ДОСТУП ЗАКРЫТ</Chip>
        <h2>Нужно здание «{hall.name}»</h2>
        <p>«Командование» открывается, когда на любой вашей планете построено здание «{hall.name}» (уровень 1 и выше). Достаточно одной планеты, а уровни разных планет не суммируются.</p>
        <Tiles items={[
          { icon: <Img src={REPORT_ICONS.alliances} />, label: 'Союз', value: `до ${MAX_ALLIANCE_MEMBERS}`, sub: 'командиров' },
          { icon: <MissionTile src={aidMissionIcon} />, label: 'Помощь', value: 'Запросы', sub: 'ресурсов союзникам' },
          { icon: <MissionTile src={sunMissionIcon} />, label: 'Операции', value: 'Скоро', sub: 'рейд на Солнце' },
        ]} />
        <p className="cmdA-note">Ваш союз, заявки и состав не потеряны: после постройки доступ вернётся автоматически.</p>
        <button type="button" className="primary cmdA-lg" onClick={onBuild} data-qa-command-build>ПЕРЕЙТИ К СТРОИТЕЛЬСТВУ</button>
      </div>
    </div>
  );
}

// ---- alliance catalog (list + dossier) -----------------------------------------

type CatalogProps = {
  command: CommandState;
  ownerId: string;
  ownerScores: Readonly<Record<string, MemberScore | undefined>>;
  now: number;
  actions: CommandActions;
  onFeedback: (result: CommandActionResult) => void;
  testControls: boolean;
  ownerFactions?: Readonly<Record<string, string | undefined>>;
};

function useCatalog(command: CommandState, ownerScores: CatalogProps['ownerScores'], query: string) {
  return useMemo(() => filterAllianceCatalog(selectAllianceCatalog(command, ownerScores), query), [command, ownerScores, query]);
}

function CatalogList({ command, ownerId, now, actions, onFeedback, entries, query, setQuery, selectedId, onSelect }: CatalogProps & {
  entries: AllianceCatalogEntry[];
  query: string;
  setQuery: (value: string) => void;
  selectedId?: string | null;
  onSelect?: (allianceId: string) => void;
}) {
  const membership = selectOwnerMembership(command, ownerId);
  const pending = selectPendingApplication(command, ownerId);

  const actionFor = (entry: AllianceCatalogEntry) => {
    if (membership?.alliance.id === entry.alliance.id) return <Chip tone="own">ВАШ СОЮЗ</Chip>;
    if (membership) return entry.isFull ? <Chip tone="bad">ПОЛОН</Chip> : null;
    if (pending?.allianceId === entry.alliance.id) {
      return <button type="button" className="danger" onClick={() => onFeedback(actions.withdraw())} data-qa-withdraw>ОТОЗВАТЬ</button>;
    }
    if (pending) return <button type="button" disabled title="Сначала отзовите текущую заявку">ЗАЯВКА ПОДАНА</button>;
    const block = selectReapplyBlock(command, ownerId, entry.alliance.id, now);
    if (block) return <button type="button" disabled>{formatCountdown(block.until - now)}</button>;
    if (entry.isFull) return <button type="button" disabled>НЕТ МЕСТ</button>;
    return <button type="button" className="primary" onClick={() => onFeedback(actions.apply(entry.alliance.id))} data-qa-apply={entry.alliance.id}>ЗАЯВКА</button>;
  };

  return (
    <ListPanel
      kicker="ВСЕ СУЩЕСТВУЮЩИЕ СОЮЗЫ"
      title="Каталог союзов"
      count={entries.length}
      className="command-catalog"
      tools={<input type="search" className="cmdA-search" value={query} placeholder="Название или тег" aria-label="Поиск союза" onChange={(event) => setQuery(event.target.value)} data-qa-catalog-search />}
    >
      {entries.length ? (
        <ul className="command-catalog-list cmdA-items" data-qa-catalog-list>
          {entries.map((entry) => {
            const own = membership?.alliance.id === entry.alliance.id;
            return (
              <li
                key={entry.alliance.id}
                className={`cmdA-item ${own ? 'is-own' : ''} ${selectedId === entry.alliance.id ? 'is-selected' : ''} ${onSelect ? 'is-clickable' : ''}`}
                style={{ '--k': ACCENT_COLORS[entry.alliance.emblem.accent] } as CSSProperties}
                onClick={onSelect ? () => onSelect(entry.alliance.id) : undefined}
                data-qa-catalog-item={entry.alliance.id}
              >
                <b className="cmdA-rank">#{entry.rank}</b>
                <EmblemGlyph compact emblem={entry.alliance.emblem} />
                <div className="cmdA-item-main">
                  <strong title={entry.alliance.name}>{entry.alliance.name} <em>[{entry.alliance.tag}]</em></strong>
                  <span>{entry.rating.memberCount}/{MAX_ALLIANCE_MEMBERS} · {number.format(entry.rating.averageTotalPoints)} · {entry.leaderName}</span>
                </div>
                <div className="cmdA-item-action" onClick={(event) => event.stopPropagation()}>{actionFor(entry)}</div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="cmdA-empty" data-qa-catalog-empty role="status">
          {command.alliances.length ? 'Ничего не найдено.' : 'Союзов пока нет. Создайте первый.'}
        </div>
      )}
    </ListPanel>
  );
}

function CatalogDossier({ entry, ownerFactions = {} }: { entry: AllianceCatalogEntry | null; ownerFactions?: Readonly<Record<string, string | undefined>> }) {
  if (!entry) {
    return <Dossier className="cmdA-dossier--empty"><div className="cmdA-placeholder"><Img src={REPORT_ICONS.alliances} /><p>Выберите союз в каталоге.</p></div></Dossier>;
  }
  const { alliance, rating } = entry;
  const free = MAX_ALLIANCE_MEMBERS - rating.memberCount;
  return (
    <Dossier footer={<FootStatus label="Вы состоите в союзе" value="Подать заявку можно только без союза" />}>
      <Hero art={<div className="cmdA-art cmdA-art--emblem"><EmblemGlyph emblem={alliance.emblem} /></div>}>
        <HeroTitle
          title={alliance.name}
          chips={<><Chip tone="am">МЕСТО #{entry.rank}</Chip><Chip tone="cy">[{alliance.tag}]</Chip>{free > 0 ? <Chip tone="ok">СВОБОДНО МЕСТ: {free}</Chip> : <Chip tone="bad">СОЮЗ ПОЛОН</Chip>}</>}
        >
          {alliance.motto ? <p className="cmdA-motto">«{alliance.motto}»</p> : null}
          {alliance.description ? <p className="cmdA-desc">{renderRichText(alliance.description)}</p> : null}
          <div className="cmdA-people"><div className="cmdA-person"><Avatar name={entry.leaderName} role="leader" factionId={ownerFactions[alliance.leaderOwnerId]} /><div><small>ЛИДЕР</small><strong>{entry.leaderName}</strong></div></div></div>
          <MembersBar count={rating.memberCount} />
        </HeroTitle>
      </Hero>
      <Tiles items={[
        { icon: <Medal kind="total" />, label: 'Средние общие', value: number.format(rating.averageTotalPoints), sub: 'рейтинг союза' },
        { icon: <Medal kind="resource" />, label: 'Ресурсные', value: number.format(rating.averageResourcePoints), sub: 'среднее' },
        { icon: <Medal kind="battle" />, label: 'Боевые', value: number.format(rating.averageBattlePoints), sub: 'среднее' },
        { icon: <Img src={REPORT_ICONS.alliances} />, label: 'Участники', value: `${rating.memberCount} / ${MAX_ALLIANCE_MEMBERS}`, sub: `основан ${formatDate(alliance.createdAt)}` },
      ]} />
    </Dossier>
  );
}

function MembersBar({ count }: { count: number }) {
  return (
    <div className="cmdA-members-bar">
      <div><small>СОСТАВ</small><b>{count} / {MAX_ALLIANCE_MEMBERS}</b></div>
      <i><span style={{ width: `${Math.min(100, (count / MAX_ALLIANCE_MEMBERS) * 100)}%` }} /></i>
    </div>
  );
}

function AlliancesTab(props: CatalogProps) {
  const [query, setQuery] = useState('');
  const entries = useCatalog(props.command, props.ownerScores, query);
  const membership = selectOwnerMembership(props.command, props.ownerId);
  const [selectedId, setSelectedId] = useState<string | null>(membership?.alliance.id ?? null);
  const selected = entries.find((entry) => entry.alliance.id === selectedId) ?? entries[0] ?? null;
  return (
    <div className="cmdA-grid">
      <CatalogList {...props} entries={entries} query={query} setQuery={setQuery} selectedId={selected?.alliance.id ?? null} onSelect={setSelectedId} />
      <CatalogDossier entry={selected} ownerFactions={props.ownerFactions} />
    </div>
  );
}

// ---- applications --------------------------------------------------------------

const APPLICATION_OUTCOME: Record<string, string> = {
  accepted: 'ПРИНЯТА',
  rejected: 'ОТКЛОНЕНА',
  withdrawn: 'ОТОЗВАНА',
  auto_rejected: 'ОТКЛОНЕНА АВТОМАТИЧЕСКИ',
};
const APPLICATION_REASON: Record<string, string> = {
  full: 'Нет мест',
  already_member: 'Уже состоит в союзе',
  disbanded: 'Союз расформирован',
};
const OUTCOME_TONE: Record<string, 'ok' | 'bad' | ''> = { accepted: 'ok', rejected: 'bad', withdrawn: '', auto_rejected: 'bad' };

function ApplicationsTab({ command, allianceId, role, ownerScores, ownerFactions, actions, onFeedback, testControls }: {
  command: CommandState;
  allianceId: string;
  role: AllianceRole;
  ownerScores: Readonly<Record<string, MemberScore | undefined>>;
  ownerFactions: Readonly<Record<string, string | undefined>>;
  actions: CommandActions;
  onFeedback: (result: CommandActionResult) => void;
  testControls: boolean;
}) {
  const canDecide = canManageAlliance(role);
  const pending = selectPendingApplicationsFor(command, allianceId);
  const alliance = command.alliances.find((candidate) => candidate.id === allianceId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = pending.find((application) => application.id === selectedId) ?? pending[0] ?? null;
  const history = command.applications
    .filter((application) => application.allianceId === allianceId && application.status !== 'pending')
    .sort((left, right) => (right.resolvedAt ?? 0) - (left.resolvedAt ?? 0))
    .slice(0, 12);
  const rating = alliance ? selectAllianceRating(alliance, ownerScores) : null;
  const memberCount = alliance?.members.length ?? 0;

  return (
    <div className="cmdA-grid">
      <ListPanel
        kicker="ОЖИДАЮТ РЕШЕНИЯ"
        title="Входящие заявки"
        count={pending.length}
        footer={testControls && canDecide && actions.testBotApply ? (
          <div className="command-test-box"><small>TEST MODE</small><button type="button" onClick={() => onFeedback(actions.testBotApply!())} data-qa-test-bot-apply>ТЕСТ: ЗАЯВКА ОТ БОТА 01</button></div>
        ) : undefined}
      >
        {!canDecide ? <p className="cmdA-note">Заявки рассматривают лидер и заместитель.</p> : null}
        {pending.length ? (
          <ul className="command-application-list cmdA-items" data-qa-application-list>
            {pending.map((application) => {
              const score = memberScore(ownerScores, application.ownerId);
              return (
                <li key={application.id} className={`cmdA-item is-clickable ${selected?.id === application.id ? 'is-selected' : ''}`} style={{ '--k': '#e6ad50' } as CSSProperties} onClick={() => setSelectedId(application.id)} data-qa-application={application.id}>
                  <Avatar name={application.displayName} factionId={ownerFactions[application.ownerId]} />
                  <div className="cmdA-item-main"><strong>{application.displayName}</strong><span>подана {formatDate(application.createdAt)}</span></div>
                  <div className="cmdA-item-score"><Medal kind="total" /><b>{number.format(score.totalPoints)}</b></div>
                </li>
              );
            })}
          </ul>
        ) : <div className="cmdA-empty" role="status">Новых заявок нет.</div>}
        <h4 className="cmdA-subhead">РЕШЕНИЯ ПО ЗАЯВКАМ</h4>
        {history.length ? (
          <ul className="command-history cmdA-history">
            {history.map((application) => (
              <li key={application.id}>
                <strong>{application.displayName}</strong>
                <Chip tone={OUTCOME_TONE[application.status]}>{APPLICATION_OUTCOME[application.status]}</Chip>
                <time>{formatDate(application.resolvedAt ?? application.createdAt)}</time>
                {application.reason && APPLICATION_REASON[application.reason] ? <small>{APPLICATION_REASON[application.reason]}</small> : null}
              </li>
            ))}
          </ul>
        ) : <div className="cmdA-empty" role="status">Решений пока нет.</div>}
      </ListPanel>
      {selected ? (
        <ApplicationDossier
          application={selected}
          score={memberScore(ownerScores, selected.ownerId)}
          factionId={ownerFactions[selected.ownerId]}
          allianceName={alliance?.name ?? ''}
          rating={rating}
          memberCount={memberCount}
          pendingCount={pending.length}
          canDecide={canDecide}
          actions={actions}
          onFeedback={onFeedback}
        />
      ) : (
        <Dossier className="cmdA-dossier--empty"><div className="cmdA-placeholder"><Img src={REPORT_ICONS.alliances} /><p>Новых заявок нет. Здесь появится досье кандидата: очки и сравнение со средним по союзу.</p></div></Dossier>
      )}
    </div>
  );
}

function ApplicationDossier({ application, score, factionId, allianceName, rating, memberCount, pendingCount, canDecide, actions, onFeedback }: {
  application: AllianceApplication;
  score: MemberScore;
  factionId?: string;
  allianceName: string;
  rating: ReturnType<typeof selectAllianceRating> | null;
  memberCount: number;
  pendingCount: number;
  canDecide: boolean;
  actions: CommandActions;
  onFeedback: (result: CommandActionResult) => void;
}) {
  const rows: Array<[string, 'total' | 'resource' | 'battle', number, number]> = rating ? [
    ['Общие', 'total', score.totalPoints, rating.averageTotalPoints],
    ['Ресурсные', 'resource', score.resourcePoints, rating.averageResourcePoints],
    ['Боевые', 'battle', score.battlePoints, rating.averageBattlePoints],
  ] : [];
  return (
    <Dossier
      footer={<>
        <FootStatus label="После принятия" value={`Состав станет ${Math.min(MAX_ALLIANCE_MEMBERS, memberCount + 1)} / ${MAX_ALLIANCE_MEMBERS}`} />
        {canDecide ? (
          <div className="command-actions">
            <button type="button" className="danger" onClick={() => onFeedback(actions.reject(application.id))} data-qa-reject>ОТКЛОНИТЬ</button>
            <button type="button" className="primary" onClick={() => onFeedback(actions.accept(application.id))} data-qa-accept>ПРИНЯТЬ В СОЮЗ</button>
          </div>
        ) : null}
      </>}
    >
      <Hero art={<PersonArt name={application.displayName} factionId={factionId} />}>
        <HeroTitle title={application.displayName} chips={<><Chip tone="am">ЗАЯВКА НА ВСТУПЛЕНИЕ</Chip>{factionId && FACTION_LABELS[factionId] ? <Chip tone="cy">РАСА · {FACTION_LABELS[factionId].toUpperCase()}</Chip> : null}</>}>
          <p className="cmdA-sub">Подана {formatDate(application.createdAt)} · хочет вступить в «{allianceName}»</p>
          {rows.length ? (
            <>
              <h4 className="cmdA-subhead">СРАВНЕНИЕ СО СРЕДНИМ ПО СОЮЗУ</h4>
              <div className="cmdA-compare">
                {rows.map(([label, kind, value, average]) => {
                  const max = Math.max(value, average, 1) * 1.15;
                  return (
                    <div className="cmdA-compare-row" key={label}>
                      <Medal kind={kind} />
                      <b>{label}</b>
                      <i className="cmdA-compare-track"><span className={value >= average ? 'is-up' : 'is-down'} style={{ width: `${(value / max) * 100}%` }} /><em style={{ left: `${(average / max) * 100}%` }} /></i>
                      <div><strong>{number.format(value)}</strong><small>ср. {number.format(average)}</small></div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </HeroTitle>
      </Hero>
      <Tiles items={[
        { icon: <Medal kind="achievement" />, label: 'Достижения', value: number.format(score.achievementPoints) },
        { icon: <Img src={REPORT_ICONS.alliances} />, label: 'Состав после', value: `${Math.min(MAX_ALLIANCE_MEMBERS, memberCount + 1)} / ${MAX_ALLIANCE_MEMBERS}` },
        { icon: <Img src={REPORT_ICONS.profile} />, label: 'Всего заявок', value: String(pendingCount), sub: 'ожидают решения' },
      ]} />
    </Dossier>
  );
}

// ---- members -------------------------------------------------------------------

function MembersTab({ command, allianceId, ownerId, role, ownerScores, ownerFactions, actions, onFeedback }: {
  command: CommandState;
  allianceId: string;
  ownerId: string;
  role: AllianceRole;
  ownerScores: Readonly<Record<string, MemberScore | undefined>>;
  ownerFactions: Readonly<Record<string, string | undefined>>;
  actions: CommandActions;
  onFeedback: (result: CommandActionResult) => void;
}) {
  const alliance = command.alliances.find((candidate) => candidate.id === allianceId);
  const members = useMemo(() => alliance ? selectOrderedMembers(alliance) : [], [alliance]);
  const [selectedId, setSelectedId] = useState<string>(ownerId);
  const [confirm, setConfirm] = useState<null | { kind: 'kick' | 'transfer'; ownerId: string; name: string }>(null);
  if (!alliance) return null;
  const selected = members.find((member) => member.ownerId === selectedId) ?? members[0] ?? null;
  const selectedScore = selected ? memberScore(ownerScores, selected.ownerId) : null;
  const isLeader = role === 'leader';
  const canKick = Boolean(selected && selected.ownerId !== ownerId && selected.role !== 'leader' && (isLeader || (role === 'deputy' && selected.role === 'member')));
  const byTotal = [...members].sort((left, right) => memberScore(ownerScores, right.ownerId).totalPoints - memberScore(ownerScores, left.ownerId).totalPoints);
  const record = selected ? alliance.members.find((member) => member.ownerId === selected.ownerId) : undefined;

  return (
    <div className="cmdA-grid">
      <ListPanel kicker="УЧАСТНИКИ" title="Состав союза" count={`${members.length} / ${MAX_ALLIANCE_MEMBERS}`}>
        <ul className="command-member-list cmdA-items" data-qa-member-list>
          {members.map((member) => (
            <li key={member.ownerId}>
              <button type="button" className={`cmdA-item ${selected?.ownerId === member.ownerId ? 'is-selected' : ''}`} style={{ '--k': ROLE_COLORS[member.role] } as CSSProperties} onClick={() => setSelectedId(member.ownerId)}>
                <Avatar name={member.displayName} role={member.role} factionId={ownerFactions[member.ownerId]} />
                <span className="cmdA-item-main"><strong>{member.displayName}{member.ownerId === ownerId ? <Chip tone="own">ВЫ</Chip> : null}</strong><small className="cmdA-role" style={{ color: ROLE_COLORS[member.role] }}>{ROLE_LABELS[member.role]}</small></span>
                <span className="cmdA-item-score"><Medal kind="total" /><b>{number.format(memberScore(ownerScores, member.ownerId).totalPoints)}</b></span>
              </button>
            </li>
          ))}
        </ul>
        {members.length < MAX_ALLIANCE_MEMBERS ? (
          <div className="cmdA-free-slot" aria-hidden="true"><span>+</span>Свободных мест: {MAX_ALLIANCE_MEMBERS - members.length}</div>
        ) : null}
      </ListPanel>
      {selected && selectedScore ? (
        <Dossier
          footer={<>
            <FootStatus label="Выбран участник" value={`${selected.displayName} · ${ROLE_LABELS[selected.role].toLowerCase()}`} />
            <div className="command-actions">
              {canKick ? (
                <button type="button" className="danger" onClick={() => setConfirm({ kind: 'kick', ownerId: selected.ownerId, name: selected.displayName })} data-qa-kick>ИСКЛЮЧИТЬ</button>
              ) : null}
              {isLeader && selected.role === 'member' ? (
                <button type="button" onClick={() => onFeedback(actions.setDeputy(selected.ownerId))} data-qa-set-deputy>НАЗНАЧИТЬ ЗАМЕСТИТЕЛЕМ</button>
              ) : null}
              {isLeader && selected.role === 'deputy' ? (
                <button type="button" onClick={() => onFeedback(actions.setDeputy(null))} data-qa-clear-deputy>СНЯТЬ С ДОЛЖНОСТИ</button>
              ) : null}
              {selected.ownerId !== ownerId ? (
                <button
                  type="button"
                  disabled={!actions.canSendFleetToMember(selected.ownerId)}
                  title={actions.canSendFleetToMember(selected.ownerId) ? 'Откроется окно «Флоты» с транспортом к планете участника' : 'Планета участника неизвестна — найдите её во «Вселенной»'}
                  onClick={() => onFeedback(actions.sendFleetToMember(selected.ownerId))}
                  data-qa-member-send-fleet
                >ОТПРАВИТЬ ФЛОТ</button>
              ) : null}
              {isLeader && selected.ownerId !== ownerId ? (
                <button type="button" className="amber" onClick={() => setConfirm({ kind: 'transfer', ownerId: selected.ownerId, name: selected.displayName })} data-qa-transfer>ПЕРЕДАТЬ ЛИДЕРСТВО</button>
              ) : null}
            </div>
          </>}
        >
          <Hero art={<PersonArt name={selected.displayName} factionId={ownerFactions[selected.ownerId]} />}>
            <HeroTitle
              title={selected.displayName}
              chips={<><Chip tone={selected.role === 'leader' ? 'am' : selected.role === 'deputy' ? 'cy' : ''}>{ROLE_LABELS[selected.role]}</Chip>{selected.ownerId === ownerId ? <Chip tone="own">ЭТО ВЫ</Chip> : null}{ownerFactions[selected.ownerId] && FACTION_LABELS[ownerFactions[selected.ownerId]!] ? <Chip>РАСА · {FACTION_LABELS[ownerFactions[selected.ownerId]!].toUpperCase()}</Chip> : null}</>}
            >
              <p className="cmdA-sub">В союзе с {formatDate(selected.joinedAt)}</p>
              <ScoreGrid score={selectedScore} />
              <p className="cmdA-note">Планеты, флоты и активность участников скрыты от всех участников союза.</p>
            </HeroTitle>
          </Hero>
          <Tiles items={memberTiles(record, byTotal.findIndex((member) => member.ownerId === selected.ownerId) + 1, members.length)} />
        </Dossier>
      ) : <Dossier className="cmdA-dossier--empty"><div className="cmdA-placeholder"><p>Выберите участника.</p></div></Dossier>}
      {confirm ? (
        <ConfirmDialog
          title={confirm.kind === 'kick' ? 'Исключить участника?' : 'Передать лидерство?'}
          body={confirm.kind === 'kick'
            ? `${confirm.name} будет исключён. Ему на 2 часа закроется подача заявок в любые союзы.`
            : `${confirm.name} станет лидером союза, а вы — обычным участником.`}
          confirmLabel={confirm.kind === 'kick' ? 'ИСКЛЮЧИТЬ' : 'ПЕРЕДАТЬ'}
          onConfirm={() => onFeedback(confirm.kind === 'kick' ? actions.kick(confirm.ownerId) : actions.transferLeadership(confirm.ownerId))}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

function memberTiles(record: AllianceMember | undefined, place: number, total: number): TileSpec[] {
  return [
    { icon: <MissionTile src={aidMissionIcon} />, label: 'Помощь союзникам', value: number.format(record?.deliveredUnits ?? 0), sub: 'доставлено ресурсов', tone: (record?.deliveredUnits ?? 0) > 0 ? 'ok' : undefined },
    { icon: <MissionTile src={sunMissionIcon} />, label: 'Совместные операции', value: String(record?.jointOperationCount ?? 0), sub: 'с момента вступления' },
    { icon: <Medal kind="total" />, label: 'Место в союзе', value: `#${place} из ${total}`, sub: 'по общим очкам' },
  ];
}

// ---- overview («Штаб») ---------------------------------------------------------

function Overview({ command, allianceId, ownerId, role, ownerScores, ownerFactions, hall, aid, now, actions, onFeedback, setTab }: {
  command: CommandState;
  allianceId: string;
  ownerId: string;
  role: AllianceRole;
  ownerScores: Readonly<Record<string, MemberScore | undefined>>;
  ownerFactions: Readonly<Record<string, string | undefined>>;
  hall: CommandHallInfo;
  aid: AidOverview;
  now: number;
  actions: CommandActions;
  onFeedback: (result: CommandActionResult) => void;
  setTab: (tab: CommandTab) => void;
}) {
  const alliance = command.alliances.find((candidate) => candidate.id === allianceId);
  const journal = useMemo(() => selectAllianceJournal(command, ownerId, now), [command, ownerId, now]);
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  if (!alliance) return null;
  const rating = selectAllianceRating(alliance, ownerScores);
  const rank = selectAllianceCatalog(command, ownerScores).find((entry) => entry.alliance.id === alliance.id)?.rank ?? null;
  const leader = alliance.members.find((member) => member.ownerId === alliance.leaderOwnerId);
  const deputy = alliance.members.find((member) => member.ownerId === alliance.deputyOwnerId);
  const pendingCount = selectPendingApplicationsFor(command, alliance.id).length;
  const others = alliance.members.filter((member) => member.ownerId !== ownerId);
  const manage = canManageAlliance(role);
  const charges = aid.charges;
  const awaiting = [manage && pendingCount ? `${pendingCount} заяв${pendingCount === 1 ? 'ка' : pendingCount < 5 ? 'ки' : 'ок'} на вступление` : '', aid.incoming.length ? `${aid.incoming.length} запрос${aid.incoming.length === 1 ? '' : aid.incoming.length < 5 ? 'а' : 'ов'} союзников` : ''].filter(Boolean);

  return (
    <div className="cmdA-grid cmdA-grid--aside-right command-overview">
      <Dossier
        footer={<>
          <FootStatus label="Ваша роль" value={`${ROLE_LABELS[role].charAt(0)}${ROLE_LABELS[role].slice(1).toLowerCase()}${manage ? ' · можно управлять союзом' : ''}`} />
          <div className="command-actions">
            <button type="button" className="danger" onClick={() => setLeaving(true)} data-qa-leave>ПОКИНУТЬ СОЮЗ</button>
            {manage ? <button type="button" aria-label="Редактировать союз" title="Редактировать союз" onClick={() => setEditing(true)} data-qa-edit-alliance>РЕДАКТИРОВАТЬ</button> : null}
            <button type="button" className="primary" onClick={() => setTab('members')}>ОТКРЫТЬ СОСТАВ</button>
          </div>
        </>}
      >
        <Hero art={<div className="cmdA-art cmdA-art--hall"><Img src={hall.art} /><span className="cmdA-art-emblem"><EmblemGlyph emblem={alliance.emblem} /></span></div>} className="command-summary">
          <HeroTitle
            title={alliance.name}
            chips={<>{rank ? <Chip tone="am">МЕСТО #{rank}</Chip> : null}<Chip tone="cy">[{alliance.tag}]</Chip><Chip>ОСНОВАН {formatDate(alliance.createdAt)}</Chip>{isAllianceFull(alliance) ? <Chip tone="bad">СОЮЗ ПОЛОН</Chip> : null}</>}
          >
            {alliance.motto ? <p className="cmdA-motto command-motto">«{alliance.motto}»</p> : null}
            {alliance.description ? <p className="cmdA-desc">{renderRichText(alliance.description)}</p> : null}
            <div className="cmdA-people">
              <div className="cmdA-person"><Avatar name={leader?.displayName ?? '—'} role="leader" factionId={leader ? ownerFactions[leader.ownerId] : undefined} /><div><small>ЛИДЕР</small><strong>{leader?.displayName ?? '—'}</strong></div></div>
              <div className="cmdA-person"><Avatar name={deputy?.displayName ?? '—'} role="deputy" factionId={deputy ? ownerFactions[deputy.ownerId] : undefined} /><div><small>ЗАМЕСТИТЕЛЬ</small><strong>{deputy?.displayName ?? 'не назначен'}</strong></div></div>
            </div>
            <MembersBar count={alliance.members.length} />
          </HeroTitle>
        </Hero>
        <Tiles items={[
          { icon: <Medal kind="total" />, label: 'Средние общие', value: number.format(rating.averageTotalPoints), sub: 'рейтинг союза' },
          { icon: <Medal kind="resource" />, label: 'Ресурсные', value: number.format(rating.averageResourcePoints), sub: 'среднее' },
          { icon: <Medal kind="battle" />, label: 'Боевые', value: number.format(rating.averageBattlePoints), sub: 'среднее' },
          { icon: <MissionTile src={aidMissionIcon} />, label: 'Заряды помощи', value: charges ? `${charges.charges} / ${aid.maxCharges}` : '—', sub: charges ? chargeLineFor(aid, now) : 'нет данных', tone: 'ok' },
        ]} />
        {awaiting.length ? (
          <div className="cmdA-goal">
            <div><small>ЖДУТ РЕШЕНИЯ</small><strong>{awaiting.join(' · ')}</strong></div>
            <div className="command-actions">
              {manage && pendingCount ? <button type="button" onClick={() => setTab('applications')}>ЗАЯВКИ · {pendingCount}</button> : null}
              {aid.incoming.length ? <button type="button" onClick={() => setTab('requests')}>ПОМОЩЬ · {aid.incoming.length}</button> : null}
            </div>
          </div>
        ) : null}
      </Dossier>
      <JournalPanel view={journal} now={now} />

      {editing ? (
        <AllianceEditor
          title="Настройки союза"
          submitLabel="СОХРАНИТЬ"
          initial={{ name: alliance.name, tag: alliance.tag, motto: alliance.motto, description: alliance.description, emblem: alliance.emblem }}
          onSubmit={actions.updateSettings}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {leaving ? (
        <LeaveDialog
          isLeader={role === 'leader'}
          defaultSuccessorId={alliance.deputyOwnerId}
          others={others.map((member) => ({ ownerId: member.ownerId, name: member.displayName }))}
          onLeave={(successorId) => onFeedback(actions.leave(successorId))}
          onClose={() => setLeaving(false)}
        />
      ) : null}
    </div>
  );
}

// ---- no alliance ---------------------------------------------------------------

function NoAlliance(props: CatalogProps & { hall: CommandHallInfo }) {
  const { command, ownerId, ownerScores, now, actions, onFeedback, hall } = props;
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const entries = useCatalog(command, ownerScores, query);
  const pending = selectPendingApplication(command, ownerId);
  const pendingAlliance = pending ? command.alliances.find((alliance) => alliance.id === pending.allianceId) : null;
  const lastResult = selectLastResolvedApplication(command, ownerId);
  const lastAlliance = lastResult ? command.alliances.find((alliance) => alliance.id === lastResult.allianceId) : null;
  const globalBlock = selectReapplyBlock(command, ownerId, null, now);
  const showLastResult = lastResult && !pending && lastResult.status !== 'withdrawn';
  const score = memberScore(ownerScores, ownerId);

  return (
    <div className="cmdA-grid command-no-alliance">
      <CatalogList {...props} entries={entries} query={query} setQuery={setQuery} />
      <Dossier
        footer={<>
          <FootStatus label={hall.name} value={`Уровень ${hall.level}`} />
          <button type="button" className="primary cmdA-lg" disabled={Boolean(globalBlock)} title={globalBlock ? 'После выхода из союза создавать и вступать в союзы пока нельзя' : undefined} onClick={() => setCreating(true)} data-qa-create-alliance>
            {globalBlock ? `СОЗДАТЬ СОЮЗ · ЧЕРЕЗ ${formatCountdown(globalBlock.until - now)}` : 'СОЗДАТЬ СОЮЗ'}
          </button>
        </>}
      >
        <Hero art={<div className="cmdA-art cmdA-art--hall"><Img src={hall.art} /></div>} className="command-cta">
          <div data-qa-command-empty>
            <HeroTitle title="Вы пока не в союзе" chips={<Chip>БЕЗ СОЮЗА</Chip>}>
              <p className="cmdA-desc">Создайте свой союз бесплатно или подайте заявку в существующий. Вступление происходит только после решения руководства союза.</p>
            </HeroTitle>
          </div>
          {pending ? (
            <div className="command-banner cmdA-banner is-pending" role="status" data-qa-pending>
              <Img src={REPORT_ICONS.alliances} />
              <span>Заявка в «{pendingAlliance?.name ?? 'союз'}» ожидает решения.</span>
              <button type="button" className="danger" onClick={() => onFeedback(actions.withdraw())}>ОТОЗВАТЬ</button>
            </div>
          ) : null}
          {showLastResult ? (
            <div className={`command-banner cmdA-banner is-${lastResult.status}`} role="status">
              <Img src={REPORT_ICONS.alliances} />
              <span>Заявка в «{lastAlliance?.name ?? lastResult.allianceName ?? 'союз'}»: {APPLICATION_OUTCOME[lastResult.status].toLowerCase()}
              {lastResult.reason && APPLICATION_REASON[lastResult.reason] ? ` — ${APPLICATION_REASON[lastResult.reason].toLowerCase()}` : ''}.</span>
            </div>
          ) : null}
          {globalBlock ? (
            <div className="command-banner cmdA-banner is-cooldown" role="status" data-qa-cooldown>
              Заявки и создание союза закрыты ещё {formatCountdown(globalBlock.until - now)}.
            </div>
          ) : null}
        </Hero>
        <Tiles items={[
          { icon: <Medal kind="total" />, label: 'Ваши общие очки', value: number.format(score.totalPoints) },
          { icon: <Medal kind="resource" />, label: 'Ресурсные', value: number.format(score.resourcePoints), sub: 'определяют лимит запросов' },
          { icon: <Img src={REPORT_ICONS.alliances} />, label: 'Союзов в каталоге', value: String(command.alliances.length) },
          { icon: <MissionTile src={aidMissionIcon} />, label: 'Помощь союза', value: 'После вступления' },
        ]} />
      </Dossier>
      {creating ? (
        <AllianceEditor
          title="Создание союза"
          submitLabel="СОЗДАТЬ"
          initial={{ name: '', tag: '', motto: '', description: '', emblem: { glyph: 'starforge', accent: 'cyan' } }}
          onSubmit={actions.createAlliance}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

// ---- requests («Помощь») -------------------------------------------------------

function RequestProgressBar({ row }: { row: AidRequestRow }) {
  const { requested, delivered, inFlight } = row.progress;
  const deliveredPct = requested > 0 ? Math.min(100, (delivered / requested) * 100) : 0;
  const flightPct = requested > 0 ? Math.min(100 - deliveredPct, (inFlight / requested) * 100) : 0;
  return (
    <div className="command-request-bar" role="progressbar" aria-valuemin={0} aria-valuemax={requested} aria-valuenow={delivered} aria-label="Доставлено по запросу" data-qa-request-bar>
      <i className="is-delivered" style={{ width: `${deliveredPct}%` }} />
      <i className="is-flight" style={{ width: `${flightPct}%` }} />
    </div>
  );
}

function RequestFigures({ row }: { row: AidRequestRow }) {
  return (
    <dl className="command-request-figures">
      <div><dt>Запрошено</dt><dd data-qa-request-requested>{number.format(row.progress.requested)}</dd></div>
      <div><dt>В пути</dt><dd data-qa-request-inflight>{number.format(row.progress.inFlight)}</dd></div>
      <div><dt>Доставлено</dt><dd data-qa-request-delivered>{number.format(row.progress.delivered)}</dd></div>
    </dl>
  );
}

const CLOSE_REASON_LABELS: Record<string, string> = {
  completed: 'Выполнен',
  cancelled: 'Отменён',
  author_left: 'Закрыт: автор покинул союз',
  alliance_disbanded: 'Закрыт: союз расформирован',
  planet_destroyed: 'Закрыт: планета назначения уничтожена',
};

function chargeLineFor(aid: AidOverview, now: number) {
  const charges = aid.charges;
  if (!charges) return 'Заряды появятся после вступления в союз.';
  if (charges.charges >= aid.maxCharges) return 'Запас полон.';
  if (charges.paused) return 'Восстановление приостановлено: прогресс сохранён.';
  if (charges.nextChargeAt !== null) return `${charges.intro ? 'Первый заряд союза' : 'Следующий заряд'} через ${formatCountdown(charges.nextChargeAt - now)}`;
  return '';
}

function RequestsTab({ aid, now, actions, onFeedback, testControls, playerFactionId }: {
  playerFactionId?: string;
  aid: AidOverview;
  now: number;
  actions: CommandActions;
  onFeedback: (result: CommandActionResult) => void;
  testControls: boolean;
}) {
  const [planetId, setPlanetId] = useState('');
  const [resource, setResource] = useState<AidResource>('metal');
  const [amountText, setAmountText] = useState(String(aid.minAmount));
  const selectedPlanet = aid.planets.find((planet) => planet.id === planetId) ?? aid.planets[0] ?? null;
  const amount = Number(amountText);
  const amountValid = Number.isSafeInteger(amount) && amount >= aid.minAmount && amount <= aid.maxAmount;
  // The slider moves in 1 000-unit steps; the field accepts any exact amount.
  const sliderStep = aid.maxAmount - aid.minAmount >= 100_000 ? 1_000 : 1;
  const sliderValue = Math.min(aid.maxAmount, Math.max(aid.minAmount, Number.isFinite(amount) ? amount : aid.minAmount));
  const sliderPct = aid.maxAmount > aid.minAmount ? ((sliderValue - aid.minAmount) / (aid.maxAmount - aid.minAmount)) * 100 : 100;
  const transporterArt = shipArtOf(playerFactionId, 'transporter');
  const megaTransporterArt = shipArtOf(playerFactionId, 'mega-transporter');
  const transporterCount = aid.freeTransporters.transporter ?? 0;
  const megaCount = aid.freeTransporters['mega-transporter'] ?? 0;
  const charges = aid.charges;
  const noCharge = !charges || charges.charges < 1;
  const atLimit = aid.openCount >= aid.maxOpen;
  const overflow = selectedPlanet && amountValid ? actions.previewOverflow(selectedPlanet.id, resource, amount) : null;
  const blocker = atLimit
    ? `Открыто ${aid.openCount} из ${aid.maxOpen} запросов — закройте один, чтобы создать новый.`
    : noCharge
      ? charges?.paused ? 'Восстановление зарядов остановлено: нет здания Палаты.' : 'Нет свободных зарядов — дождитесь восстановления.'
      : !selectedPlanet ? 'Выберите планету назначения.'
        : !amountValid ? `Допустимое количество — от ${number.format(aid.minAmount)} до ${number.format(aid.maxAmount)}.` : '';
  const chargeLine = chargeLineFor(aid, now);

  const submit = () => {
    if (!selectedPlanet || blocker) return;
    onFeedback(actions.createRequest(selectedPlanet.id, resource, amount));
  };

  return (
    <div className="cmdA-grid command-requests" data-qa-requests>
      <ListPanel kicker="РЕСУРСЫ СОЮЗНИКОВ" title="Запросы помощи" count={aid.incoming.length + aid.mine.length}>
        <h4 className="cmdA-subhead">ЗАПРОСЫ СОЮЗНИКОВ · {aid.incoming.length}</h4>
        {aid.incoming.length === 0 ? <div className="cmdA-empty" data-qa-incoming-empty>Союзники пока ничего не просили.</div> : (
          <ul className="command-request-list cmdA-items" data-qa-incoming-requests>
            {aid.incoming.map((row) => {
              const full = row.progress.remainder <= 0;
              const reason = full ? 'Весь остаток уже в пути или доставлен' : !aid.hasFreeTransporters ? `На планете ${aid.sourcePlanetName || 'выбранной'} нет свободного транспорта — выберите другую планету в шапке` : '';
              return (
                <li key={row.request.id} className="cmdA-item cmdA-request" style={{ '--k': RESOURCE_TONES[row.request.resource] } as CSSProperties} data-qa-request-id={row.request.id}>
                  <div className="cmdA-request-head">
                    <ResourceIcon kind={row.request.resource} className="cmdA-request-icon" />
                    <div className="cmdA-item-main"><strong>{row.request.authorName}</strong><span>{AID_RESOURCE_LABELS[row.request.resource]} → {row.request.planetName} [{formatCoordinate(row.request.coordinate)}]</span></div>
                  </div>
                  <RequestProgressBar row={row} />
                  <RequestFigures row={row} />
                  <div className="command-request-actions">
                    <small>{aid.hasFreeTransporters || full ? `Можно отправить: ${number.format(row.progress.remainder)}` : `Нет транспорта на ${aid.sourcePlanetName || 'планете'}`}</small>
                    <button type="button" className="primary" disabled={Boolean(reason)} title={reason || undefined} onClick={() => onFeedback(actions.startHelp(row.request.id))} data-qa-request-help>ПОМОЧЬ</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <h4 className="cmdA-subhead">МОИ ЗАПРОСЫ · {aid.mine.length} / {aid.maxOpen}</h4>
        {aid.mine.length === 0 ? <div className="cmdA-empty" data-qa-requests-empty>У вас нет открытых запросов.</div> : (
          <ul className="command-request-list cmdA-items" data-qa-my-requests>
            {aid.mine.map((row) => (
              <li key={row.request.id} className="cmdA-item cmdA-request" style={{ '--k': RESOURCE_TONES[row.request.resource] } as CSSProperties} data-qa-request-id={row.request.id} data-qa-request-status={row.request.status}>
                <div className="cmdA-request-head">
                  <ResourceIcon kind={row.request.resource} className="cmdA-request-icon" />
                  <div className="cmdA-item-main"><strong>{AID_RESOURCE_LABELS[row.request.resource]} → {row.request.planetName}</strong><span>[{formatCoordinate(row.request.coordinate)}]</span></div>
                </div>
                <RequestProgressBar row={row} />
                <RequestFigures row={row} />
                <div className="command-request-actions">
                  <small>{row.canCancel ? 'Отмена вернёт заряд' : 'Помощь уже отправлена'}</small>
                  <button type="button" className="danger" disabled={!row.canCancel} title={row.canCancel ? 'Вернёт заряд' : 'Помощь уже отправлена — отменить нельзя'} onClick={() => onFeedback(actions.cancelRequest(row.request.id))} data-qa-request-cancel>ОТМЕНИТЬ</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {aid.closed.length ? (
          <>
            <h4 className="cmdA-subhead">НЕДАВНО ЗАКРЫТЫЕ</h4>
            <ul className="command-history cmdA-history" aria-label="Недавно закрытые запросы" data-qa-closed-requests>
              {aid.closed.map((request) => (
                <li key={request.id}><strong>{AID_RESOURCE_LABELS[request.resource]} → {request.planetName}</strong><small>{CLOSE_REASON_LABELS[request.closeReason ?? 'cancelled'] ?? 'Закрыт'} · {number.format(request.delivered)} из {number.format(request.requested)}</small></li>
              ))}
            </ul>
          </>
        ) : null}
      </ListPanel>

      <Dossier
        className="cmdA-request-dossier"
        footer={<>
          <FootStatus label={blocker ? 'Нельзя создать запрос' : 'Готово к отправке'} value={blocker || `${AID_RESOURCE_LABELS[resource]} · ${number.format(amount)} → ${selectedPlanet?.name ?? '—'}`} />
          <button type="button" className="primary cmdA-lg" disabled={Boolean(blocker)} onClick={submit} data-qa-request-create>СОЗДАТЬ ЗАПРОС</button>
        </>}
      >
        <Hero art={<div className="cmdA-art cmdA-art--resource"><ResourceIcon kind={resource} className="cmdA-art-resource" /><Img src={megaTransporterArt} className="cmdA-art-ship" /></div>}>
          <HeroTitle title="Новый запрос ресурсов" chips={<><Chip tone="ok"><span data-qa-request-charges>{charges ? `${charges.charges}/${aid.maxCharges}` : '—'} ЗАРЯДА</span></Chip><Chip>ОТКРЫТО {aid.openCount} / {aid.maxOpen}</Chip></>}>
            <p className="cmdA-sub" data-qa-charge-line>{chargeLine}</p>
            <div className="command-request-form cmdA-form" data-qa-request-form>
              <label className="command-select wide"><span>ПЛАНЕТА НАЗНАЧЕНИЯ</span>
                <select value={selectedPlanet?.id ?? ''} onChange={(event) => setPlanetId(event.target.value)} data-qa-request-planet>
                  {aid.planets.map((planet) => <option key={planet.id} value={planet.id}>{planet.name} [{formatCoordinate(planet.coordinate)}]</option>)}
                </select>
              </label>
              <label className="command-select"><span>РЕСУРС</span>
                <select value={resource} onChange={(event) => setResource(event.target.value as AidResource)} data-qa-request-resource>
                  {AID_RESOURCES.map((key) => <option key={key} value={key}>{AID_RESOURCE_LABELS[key]}</option>)}
                </select>
              </label>
              <label className="command-select"><span>КОЛИЧЕСТВО</span>
                <input type="number" inputMode="numeric" min={aid.minAmount} max={aid.maxAmount} step={1} value={amountText} onChange={(event) => setAmountText(event.target.value)} data-qa-request-amount />
              </label>
              <div className="cmdA-amount wide">
                <button type="button" aria-label="Минимум" onClick={() => setAmountText(String(aid.minAmount))}>МИН.</button>
                <button type="button" aria-label="Уменьшить" onClick={() => setAmountText(String(Math.max(aid.minAmount, sliderValue - Math.max(sliderStep, 10_000))))}>−</button>
                <input
                  type="range"
                  className="cmdA-range"
                  min={aid.minAmount}
                  max={aid.maxAmount}
                  step={sliderStep}
                  value={sliderValue}
                  style={{ '--cmdA-range': `${sliderPct}%` } as CSSProperties}
                  aria-label="Количество ресурса"
                  onChange={(event) => setAmountText(event.target.value)}
                  data-qa-request-slider
                />
                <button type="button" aria-label="Увеличить" onClick={() => setAmountText(String(Math.min(aid.maxAmount, sliderValue + Math.max(sliderStep, 10_000))))}>+</button>
                <button type="button" aria-label="Максимум" onClick={() => setAmountText(String(aid.maxAmount))}>МАКС.</button>
                <div className="cmdA-amount-scale"><span>{number.format(aid.minAmount)}</span><b>{amountValid ? number.format(amount) : '—'}</b><span>{number.format(aid.maxAmount)}</span></div>
              </div>
            </div>
            {blocker ? <p className="cmdA-note is-warning" role="status" data-qa-request-blocker>{blocker}</p> : null}
            {overflow && overflow.lost > 0 ? (
              <p className="cmdA-note is-warning" role="alert" data-qa-request-overflow>
                Склад планеты вмещает ещё {number.format(overflow.free)}. Если доставить {number.format(amount)}, {number.format(overflow.lost)} сгорит и не будет засчитано — запрос останется открытым на недостающее.
              </p>
            ) : null}
            <p className="cmdA-note" data-qa-request-limit>Максимум зависит от ресурсных очков ({number.format(aid.resourcePoints)}), а не от уровня Палаты. Запрос нельзя изменить; отмена возможна, пока никто не отправил помощь.</p>
          </HeroTitle>
        </Hero>
        <Tiles items={[
          { icon: <MissionTile src={aidMissionIcon} />, label: 'Заряды', value: charges ? `${charges.charges} / ${aid.maxCharges}` : '—', tone: 'ok' },
          { icon: <Img src={REPORT_ICONS.flights} />, label: 'Открыто запросов', value: `${aid.openCount} / ${aid.maxOpen}` },
          { icon: <Medal kind="resource" />, label: 'Лимит запроса', value: number.format(aid.maxAmount), sub: `от ${number.format(aid.minAmount)}` },
          { icon: <Img src={transporterArt} className="cmdA-tile-ship" />, label: `Транспорт · ${aid.sourcePlanetName || 'планета'}`, value: aid.hasFreeTransporters ? `${number.format(transporterCount)} + ${number.format(megaCount)}` : 'Нет транспорта', sub: aid.hasFreeTransporters ? `${shipNameOf(playerFactionId, 'transporter')} / ${shipNameOf(playerFactionId, 'mega-transporter')}` : 'на выбранной планете', tone: aid.hasFreeTransporters ? 'cy' : 'am' },
        ]} />
        {testControls && actions.testIraPrepare ? (
          <div className="command-test-box command-test-box--wide" data-qa-aid-test-box>
            <small>ТЕСТ · ИРА ВЕЛЬ</small>
            <span>Ручной сценарий проверки помощи в обе стороны тем же полётным движком. Ира сама ничего не решает.</span>
            <button type="button" onClick={() => onFeedback(actions.testIraPrepare!())} data-qa-test-ira-prepare>ПОДГОТОВИТЬ ФЛОТ ИРЫ</button>
            <button type="button" onClick={() => onFeedback(actions.testIraRequest!('metal', 60_000))} data-qa-test-ira-request>ЗАПРОС ИРЫ: 60 000 МЕТАЛЛА</button>
            <button type="button" onClick={() => onFeedback(actions.testIraHelp!())} data-qa-test-ira-help>ИРА ПОМОГАЕТ ИГРОКУ</button>
          </div>
        ) : null}
      </Dossier>
    </div>
  );
}

const RESOURCE_TONES: Record<AidResource, string> = { metal: '#c9d6de', minerals: '#7f8cff', gas: '#35e58a', debris: '#e6ad50' };

// ---- operations ----------------------------------------------------------------


function OperationsTab({ playerFactionId }: { playerFactionId?: string }) {
  return (
    <div className="cmdA-grid command-operations" data-qa-operations>
      <ListPanel kicker="СОВМЕСТНЫЕ ДЕЙСТВИЯ" title="Операции союза" count={1}>
        <ul className="cmdA-items">
          <li className="cmdA-item is-selected" style={{ '--k': '#e6ad50' } as CSSProperties}>
            <MissionTile src={sunMissionIcon} className="cmdA-item-icon" />
            <div className="cmdA-item-main"><strong>Рейд на Солнце</strong><span>Совместная операция</span></div>
            <Chip tone="am">СКОРО</Chip>
          </li>
        </ul>
        <p className="cmdA-note">Журнал союза — во вкладке «Штаб», война и перемирие — в «Дипломатии».</p>
      </ListPanel>
      <Dossier className="cmdA-operations-dossier" footer={<FootStatus label="Статус" value="Появится в будущей версии" />}>
        <Hero art={<div className="cmdA-art cmdA-art--sun"><Img src={sunArt} /></div>}>
          <Stub qa="sun" title="Рейд на Солнце" icon={<MissionTile src={sunMissionIcon} className="cmdA-stub-icon" />}>Появится в будущей версии. Сейчас союз не может собрать совместный флот — механика не меняется.</Stub>
          <div className="cmdA-ghost-fleet" aria-hidden="true">
            {SUN_RAID_SHIP_IDS.map((shipId) => <span key={shipId} title={shipNameOf(playerFactionId, shipId)}><Img src={shipArtOf(playerFactionId, shipId)} /></span>)}
          </div>
        </Hero>
      </Dossier>
    </div>
  );
}

// ---- diplomacy -----------------------------------------------------------------

function DiplomacyTab({ command, allianceId, role, ownerScores, now, timeScale, actions, onFeedback, testControls }: {
  command: CommandState;
  allianceId: string;
  role: AllianceRole;
  ownerScores: Readonly<Record<string, MemberScore | undefined>>;
  now: number;
  timeScale: number;
  actions: CommandActions;
  onFeedback: (result: CommandActionResult) => void;
  testControls: boolean;
}) {
  const manage = canManageAlliance(role);
  const others = useMemo(() => selectAllianceCatalog(command, ownerScores).filter((entry) => entry.alliance.id !== allianceId), [allianceId, command, ownerScores]);
  const relations = useMemo(() => selectAllianceRelations(command, allianceId), [allianceId, command]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmWar, setConfirmWar] = useState(false);
  const selected = others.find((entry) => entry.alliance.id === selectedId) ?? others.find((entry) => relations.some((relation) => relation.id === entry.alliance.id)) ?? others[0] ?? null;
  const relation = selected ? relations.find((item) => item.id === selected.alliance.id) ?? null : null;
  const atWar = relation?.status === 'war';
  const truce = selected ? selectTruceAvailability(command, allianceId, selected.alliance.id, { now, elapsedScale: timeScale }) : { state: 'none' as const };
  const isBot = selected?.alliance.id === TEST_BOT_ALLIANCE_ID;
  const wars = relations.filter((item) => item.status === 'war').length;

  const footer = selected ? (
    <>
      <FootStatus
        label={atWar ? 'Война' : 'Отношения'}
        value={atWar
          ? truce.state === 'wait' ? `Перемирие можно предложить через ${formatCountdown(truce.until - now)}`
            : truce.state === 'sent' ? 'Перемирие предложено — ждём ответа'
              : truce.state === 'received' ? `«${selected.alliance.name}» предлагает перемирие`
                : 'Можно предложить перемирие'
          : manage ? 'Нейтралитет · можно объявить войну' : 'Нейтралитет · решения принимает руководство'}
      />
      {manage ? (
        <div className="command-actions">
          {!atWar ? <button type="button" className="danger" onClick={() => setConfirmWar(true)} data-qa-declare-war>ОБЪЯВИТЬ ВОЙНУ</button> : null}
          {atWar && truce.state === 'received' ? (
            <>
              <button type="button" className="danger" onClick={() => onFeedback(actions.respondTruce(selected.alliance.id, false))} data-qa-truce-reject>ОТКЛОНИТЬ</button>
              <button type="button" className="primary" onClick={() => onFeedback(actions.respondTruce(selected.alliance.id, true))} data-qa-truce-accept>ПРИНЯТЬ ПЕРЕМИРИЕ</button>
            </>
          ) : null}
          {atWar && truce.state !== 'received' ? (
            <button type="button" className="primary" disabled={truce.state !== 'ready'} onClick={() => onFeedback(actions.proposeTruce(selected.alliance.id))} data-qa-truce-propose>ПРЕДЛОЖИТЬ ПЕРЕМИРИЕ</button>
          ) : null}
        </div>
      ) : null}
    </>
  ) : undefined;

  return (
    <div className="cmdA-grid command-diplomacy" data-qa-diplomacy>
      <ListPanel kicker="ОТНОШЕНИЯ СОЮЗОВ" title="Дипломатия" count={wars ? `${wars} · ВОЙНА` : others.length}>
        {others.length ? (
          <ul className="cmdA-items" data-qa-diplomacy-list>
            {others.map((entry) => {
              const item = relations.find((candidate) => candidate.id === entry.alliance.id);
              const war = item?.status === 'war';
              return (
                <li
                  key={entry.alliance.id}
                  className={`cmdA-item is-clickable ${selected?.alliance.id === entry.alliance.id ? 'is-selected' : ''}`}
                  style={{ '--k': war ? '#ff5f6f' : ACCENT_COLORS[entry.alliance.emblem.accent] } as CSSProperties}
                  onClick={() => setSelectedId(entry.alliance.id)}
                  data-qa-diplomacy-item={entry.alliance.id}
                  data-qa-relation-status={war ? 'war' : 'neutral'}
                >
                  <EmblemGlyph compact emblem={entry.alliance.emblem} />
                  <div className="cmdA-item-main"><strong>{entry.alliance.name} <em>[{entry.alliance.tag}]</em></strong><span>Лидер: {entry.leaderName} · {entry.rating.memberCount}/{MAX_ALLIANCE_MEMBERS}</span></div>
                  {war ? <Chip tone="bad">ВОЙНА</Chip> : <Chip>НЕЙТРАЛИТЕТ</Chip>}
                </li>
              );
            })}
          </ul>
        ) : <div className="cmdA-empty" role="status">Других союзов пока нет — объявить войну некому.</div>}
        <p className="cmdA-note">Война не даёт боевых бонусов: планеты противника во «Вселенной» помечаются как вражеские. Перемирие — через 3 часа после начала войны, повторное предложение — через 3 часа после отказа.</p>
      </ListPanel>

      {selected ? (
        <Dossier className={atWar ? 'cmdA-dossier--war' : ''} footer={footer}>
          <Hero art={<div className="cmdA-art cmdA-art--emblem cmdA-art--versus"><EmblemGlyph emblem={selected.alliance.emblem} />{atWar ? <span className="cmdA-war-mark" aria-hidden="true">⚔</span> : null}</div>}>
            <HeroTitle
              title={selected.alliance.name}
              chips={<>{atWar ? <Chip tone="bad">ВОЙНА</Chip> : <Chip>НЕЙТРАЛИТЕТ</Chip>}<Chip tone="cy">[{selected.alliance.tag}]</Chip><Chip tone="am">МЕСТО #{selected.rank}</Chip>{isBot && testControls ? <Chip tone="vi">ТЕСТ · БОТ 01</Chip> : null}</>}
            >
              {selected.alliance.description ? <p className="cmdA-desc">{renderRichText(selected.alliance.description)}</p> : null}
              <div className="cmdA-people"><div className="cmdA-person"><Avatar name={selected.leaderName} role="leader" /><div><small>ЛИДЕР</small><strong>{selected.leaderName}</strong></div></div></div>
              {atWar && relation ? (
                <div className="cmdA-war-line" data-qa-war-since>
                  <Img src={REPORT_ICONS.arena} />
                  <span>Война идёт с {new Date(relation.since ?? 0).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })} · объявил «{relation.declaredByAllianceId === allianceId ? 'ваш союз' : selected.alliance.name}»</span>
                </div>
              ) : null}
            </HeroTitle>
          </Hero>
          <Tiles items={[
            { icon: <Medal kind="total" />, label: 'Средние общие', value: number.format(selected.rating.averageTotalPoints) },
            { icon: <Medal kind="battle" />, label: 'Боевые', value: number.format(selected.rating.averageBattlePoints), sub: 'среднее' },
            { icon: <Img src={REPORT_ICONS.alliances} />, label: 'Участники', value: `${selected.rating.memberCount} / ${MAX_ALLIANCE_MEMBERS}` },
            { icon: <Img src={REPORT_ICONS.arena} />, label: 'Статус', value: atWar ? 'Война' : 'Нейтралитет', tone: atWar ? 'am' : undefined },
          ]} />
          {!manage ? <p className="cmdA-note">Объявлять войну и заключать перемирие могут лидер и заместитель.</p> : null}
          {testControls && isBot && actions.testBotRespondTruce ? (
            <div className="command-test-box command-test-box--wide" data-qa-diplomacy-test-box>
              <small>ТЕСТ · БОТ 01</small>
              <span>Бот 01 сам не принимает решений — эти кнопки отвечают за него по тем же правилам.</span>
              <button type="button" onClick={() => onFeedback(actions.testBotDeclareWar!())} data-qa-test-bot-war>БОТ 01 ОБЪЯВЛЯЕТ ВОЙНУ</button>
              <button type="button" onClick={() => onFeedback(actions.testBotProposeTruce!())} data-qa-test-bot-truce>БОТ 01 ПРЕДЛАГАЕТ ПЕРЕМИРИЕ</button>
              <button type="button" onClick={() => onFeedback(actions.testBotRespondTruce!(true))} data-qa-test-bot-accept>БОТ 01 ПРИНИМАЕТ</button>
              <button type="button" onClick={() => onFeedback(actions.testBotRespondTruce!(false))} data-qa-test-bot-reject>БОТ 01 ОТКЛОНЯЕТ</button>
            </div>
          ) : null}
        </Dossier>
      ) : (
        <Dossier className="cmdA-dossier--empty"><div className="cmdA-placeholder"><Img src={REPORT_ICONS.arena} /><p>Других союзов пока нет.</p></div></Dossier>
      )}
      {confirmWar && selected ? (
        <ConfirmDialog
          title="Объявить войну?"
          body={`«${selected.alliance.name}» станет противником сразу, согласие не требуется. Перемирие можно будет предложить через 3 часа.`}
          confirmLabel="ОБЪЯВИТЬ ВОЙНУ"
          onConfirm={() => onFeedback(actions.declareWar(selected.alliance.id))}
          onClose={() => setConfirmWar(false)}
        />
      ) : null}
    </div>
  );
}

// ---- root ----------------------------------------------------------------------

export function CommandView({ mode, command, ownerId, hall, ownerScores, ownerFactions = {}, playerFactionId, testTimeScale = 1, returnToBuilding, aid, now, actions, operationsPanel, operationsAlertCount = 0, focusTab = null }: CommandViewProps) {
  const [tab, setTab] = useState<CommandTab>(focusTab?.tab ?? 'overview');
  useEffect(() => { if (focusTab) setTab(focusTab.tab); }, [focusTab?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const [feedback, setFeedback] = useState<CommandActionResult | null>(null);
  const testControls = mode === 'test';

  const membership = selectOwnerMembership(command, ownerId);
  const pending = selectPendingApplication(command, ownerId);
  const locked = hall.level <= 0;
  const onFeedback = (result: CommandActionResult) => setFeedback(result.ok ? null : result);

  const status = locked
    ? { key: 'locked', label: 'НЕТ ЗДАНИЯ' }
    : membership
      ? { key: membership.role, label: isAllianceFull(membership.alliance) ? `${ROLE_LABELS[membership.role]} · СОЮЗ ПОЛОН` : ROLE_LABELS[membership.role] }
      : pending
        ? { key: 'pending', label: 'ЗАЯВКА ОЖИДАЕТ' }
        : { key: 'none', label: 'БЕЗ СОЮЗА' };

  // «Операции» (Sun raids) belong to an alliance with a built Hall. Sun support and Sun
  // debris live in «Флоты» and need neither.
  const visibleTabs = membership && !locked
    ? (Object.keys(TAB_LABELS) as CommandTab[])
    : (['overview'] as CommandTab[]);
  const activeTab = visibleTabs.includes(tab) ? tab : 'overview';
  const pendingCount = membership ? selectPendingApplicationsFor(command, membership.alliance.id).length : 0;
  const badges: Partial<Record<CommandTab, { value: string; hot?: boolean }>> = membership ? {
    members: { value: `${membership.alliance.members.length}/${MAX_ALLIANCE_MEMBERS}` },
    applications: pendingCount ? { value: String(pendingCount), hot: canManageAlliance(membership.role) } : undefined,
    requests: aid.incoming.length ? { value: String(aid.incoming.length) } : undefined,
    alliances: { value: String(command.alliances.length) },
    diplomacy: (() => {
      const wars = selectAllianceRelations(command, membership.alliance.id).filter((relation) => relation.status === 'war').length;
      return wars ? { value: `⚔ ${wars}`, hot: true } : undefined;
    })(),
    ...(operationsAlertCount ? { operations: { value: String(operationsAlertCount), hot: true } } : {}),
  } : operationsAlertCount ? { operations: { value: String(operationsAlertCount), hot: true } } : {};
  const catalogProps: CatalogProps = { command, ownerId, ownerScores, now, actions, onFeedback, testControls, ownerFactions };

  return (
    <main className="command-view cmdA" aria-label="Командование союза" data-qa-command-state={status.key}>
      <header className="cmdA-panel cmdA-top">
        <div className="cmdA-top-title">
          {membership ? <EmblemGlyph emblem={membership.alliance.emblem} /> : <Img src={commandHeaderIcon} className="cmdA-top-icon" />}
          <div><small>КОМАНДОВАНИЕ СОЮЗА</small><h1>КОМАНДОВАНИЕ</h1></div>
        </div>
        <div className="command-view__status cmdA-top-status">
          <small>{membership ? 'ВАШ СОЮЗ' : 'СТАТУС'}</small>
          <div>
            <strong>{membership ? <>{membership.alliance.name} <em>[{membership.alliance.tag}]</em></> : locked ? hall.name : 'СОЮЗ НЕ ВЫБРАН'}</strong>
            <span className={`command-status-chip cmdA-chip is-status-${status.key}`} data-qa-command-status>{status.label}</span>
          </div>
        </div>
        {returnToBuilding ? (
          <button type="button" className="cmdA-back" onClick={returnToBuilding.onBack} data-qa-building-interior-back>
            <span aria-hidden="true">←</span>{returnToBuilding.label}
          </button>
        ) : null}
        {!locked && membership ? (
          <nav className="command-tabs cmdA-tabs" aria-label="Разделы Командования">
            {visibleTabs.map((key) => (
              <button key={key} type="button" className={activeTab === key ? 'active' : ''} aria-current={activeTab === key ? 'page' : undefined} onClick={() => setTab(key)} data-qa-command-tab={key}>
                {TAB_LABELS[key]}{badges[key] ? <b className={`command-badge ${badges[key]!.hot ? 'is-hot' : ''}`}>{badges[key]!.value}</b> : null}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      {feedback ? (
        <div className={`command-feedback ${feedback.ok ? 'is-ok' : 'is-error'}`} role={feedback.ok ? 'status' : 'alert'} data-qa-command-feedback>
          <span>{feedback.message}</span>
          <button type="button" aria-label="Скрыть сообщение" onClick={() => setFeedback(null)}>✕</button>
        </div>
      ) : null}

      <section className="command-content cmdA-content">
        {locked ? (
          <LockedHall hall={hall} onBuild={actions.openHallConstruction} />
        ) : !membership ? (
          <NoAlliance {...catalogProps} hall={hall} />
        ) : activeTab === 'overview' ? (
          <Overview command={command} allianceId={membership.alliance.id} ownerId={ownerId} role={membership.role} ownerScores={ownerScores} ownerFactions={ownerFactions} hall={hall} aid={aid} now={now} actions={actions} onFeedback={onFeedback} setTab={setTab} />
        ) : activeTab === 'members' ? (
          <MembersTab command={command} allianceId={membership.alliance.id} ownerId={ownerId} role={membership.role} ownerScores={ownerScores} ownerFactions={ownerFactions} actions={actions} onFeedback={onFeedback} />
        ) : activeTab === 'applications' ? (
          <ApplicationsTab command={command} allianceId={membership.alliance.id} role={membership.role} ownerScores={ownerScores} ownerFactions={ownerFactions} actions={actions} onFeedback={onFeedback} testControls={testControls} />
        ) : activeTab === 'alliances' ? (
          <AlliancesTab {...catalogProps} />
        ) : activeTab === 'requests' ? (
          <RequestsTab aid={aid} now={now} actions={actions} onFeedback={onFeedback} testControls={testControls} playerFactionId={playerFactionId} />
        ) : activeTab === 'diplomacy' ? (
          <DiplomacyTab command={command} allianceId={membership.alliance.id} role={membership.role} ownerScores={ownerScores} now={now} timeScale={testTimeScale} actions={actions} onFeedback={onFeedback} testControls={testControls} />
        ) : operationsPanel ? (
          <div className="opsA srp-host" data-qa-command-operations>{operationsPanel}</div>
        ) : (
          <OperationsTab playerFactionId={playerFactionId} />
        )}
      </section>
    </main>
  );
}

