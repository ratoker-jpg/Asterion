import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import {
  ALLIANCE_DESCRIPTION_MAX,
  ALLIANCE_MOTTO_MAX,
  ALLIANCE_NAME_MAX,
  ALLIANCE_TAG_MAX,
  MAX_ALLIANCE_MEMBERS,
} from './domain/command/catalog.ts';
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
import { selectAllianceJournal, type JournalEntry } from './domain/command/journal.ts';
import type { AidOverview, AidRequestRow } from './application/alliance-aid.ts';
import type {
  AidResource,
  AllianceAccent,
  AllianceApplication,
  AllianceEmblem,
  AllianceEmblemGlyph,
  AllianceRole,
  AllianceSettingsInput,
  CommandState,
} from './domain/command/types.ts';
import type { RuntimeMode } from './domain/runtime/mode.ts';
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
  /** Test Mode only: a controlled NPC applies to the player's alliance. */
  testBotApply?: () => CommandActionResult;
  /** Test Mode only: a controlled NPC founds an alliance of its own. */
  testBotCreateAlliance?: () => CommandActionResult;
};

export type CommandHallInfo = { level: number; name: string; art: string };

type CommandViewProps = {
  mode: RuntimeMode;
  command: CommandState;
  ownerId: string;
  hall: CommandHallInfo;
  ownerScores: Readonly<Record<string, MemberScore | undefined>>;
  aid: AidOverview;
  /** Wall-clock milliseconds; drives the re-application countdowns. */
  now: number;
  actions: CommandActions;
};

type CommandTab = 'overview' | 'members' | 'applications' | 'alliances' | 'requests' | 'diplomacy' | 'operations';

const TAB_LABELS: Record<CommandTab, string> = {
  overview: 'ОБЗОР СОЮЗА',
  members: 'УЧАСТНИКИ',
  applications: 'ЗАЯВКИ',
  alliances: 'СОЮЗЫ',
  requests: 'ЗАПРОСЫ РЕСУРСОВ',
  diplomacy: 'ДИПЛОМАТИЯ',
  operations: 'СОВМЕСТНЫЕ ОПЕРАЦИИ',
};

const ROLE_LABELS: Record<AllianceRole, string> = {
  leader: 'ЛИДЕР',
  deputy: 'ЗАМЕСТИТЕЛЬ',
  member: 'УЧАСТНИК',
};

const ACCENT_COLORS: Record<AllianceAccent, string> = {
  cyan: '#56d9f2',
  amber: '#e6ad50',
  violet: '#a98cff',
};

const GLYPHS: readonly AllianceEmblemGlyph[] = ['starforge', 'orbit', 'vanguard'];
const ACCENTS: readonly AllianceAccent[] = ['cyan', 'amber', 'violet'];
const ACCENT_LABELS: Record<AllianceAccent, string> = { cyan: 'Голубой', amber: 'Янтарный', violet: 'Фиолетовый' };

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

export function EmblemGlyph({ emblem, compact = false }: { emblem: AllianceEmblem; compact?: boolean }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.55, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const style = { '--command-emblem': ACCENT_COLORS[emblem.accent] } as CSSProperties;
  return (
    <span className={`command-emblem command-emblem--${emblem.glyph} ${compact ? 'command-emblem--compact' : ''}`} style={style}>
      <svg viewBox="0 0 80 96" aria-hidden="true">
        <path className="command-emblem-shield" d="M40 4 70 16v29c0 22-12 36-30 47C22 81 10 67 10 45V16L40 4Z" />
        {emblem.glyph === 'starforge' ? (
          <g><path {...common} d="m40 22 7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2 7-14Z" /><circle {...common} cx="40" cy="45" r="8" /></g>
        ) : emblem.glyph === 'orbit' ? (
          <g><circle {...common} cx="40" cy="45" r="10" /><ellipse {...common} cx="40" cy="45" rx="25" ry="11" transform="rotate(24 40 45)" /><ellipse {...common} cx="40" cy="45" rx="25" ry="11" transform="rotate(-32 40 45)" /></g>
        ) : (
          <g><path {...common} d="m40 18 10 23-10 9-10-9 10-23Z" /><path {...common} d="M18 58 40 46l22 12M23 68l17-10 17 10" /></g>
        )}
      </svg>
    </span>
  );
}

function Panel({ title, kicker, aside, children, className = '' }: { title: string; kicker?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`command-panel ${className}`}>
      <header className="command-panel-heading">
        <div>{kicker ? <small>{kicker}</small> : null}<h3>{title}</h3></div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Stub({ title, children }: { title: string; children: string }) {
  return (
    <div className="command-stub" data-qa-command-stub role="status">
      <small>НЕ ПОДКЛЮЧЕНО</small>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

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

function JournalPanel({ command, ownerId, now }: { command: CommandState; ownerId: string; now: number }) {
  // The view is filtered in the domain layer; a locked journal never receives any event data.
  const view = useMemo(() => selectAllianceJournal(command, ownerId, now), [command, ownerId, now]);
  if (view.state === 'no_membership') return null;
  return (
    <Panel title="Журнал союза" kicker="ИСТОРИЯ СОБЫТИЙ" className="command-journal">
      {view.state === 'locked' ? (
        <div className="command-journal__locked" data-qa-journal-state="locked">
          <div className="command-journal__skeleton" aria-hidden="true"><i /><i /><i /><i /></div>
          <p role="status">История станет доступна через <strong data-qa-journal-countdown>{formatCountdown(view.unlocksAt - now)}</strong>. Новый участник читает журнал не раньше чем через 2 часа после вступления.</p>
        </div>
      ) : view.entries.length === 0 ? (
        <p className="command-empty" data-qa-journal-state="empty">С момента вступления событий пока нет.</p>
      ) : (
        <ol className="command-journal__list" data-qa-journal-state="open" data-qa-journal-count={view.entries.length}>
          {view.entries.map((entry) => (
            <li key={entry.id} data-qa-journal-entry={entry.kind}>
              <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</time>
              <strong>{journalTitle(entry)}</strong>
              {journalDetail(entry) ? <span>{journalDetail(entry)}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function SunRaidCard() {
  return (
    <div className="command-stub command-sun-raid" data-qa-command-stub data-qa-sun-raid role="status">
      <small>СОВМЕСТНАЯ ОПЕРАЦИЯ</small>
      <h2>Рейд на Солнце</h2>
      <p>Появится в будущей версии.</p>
    </div>
  );
}

function OperationsTab({ command, ownerId, now }: { command: CommandState; ownerId: string; now: number }) {
  return (
    <div className="command-operations" data-qa-operations>
      <JournalPanel command={command} ownerId={ownerId} now={now} />
      <SunRaidCard />
    </div>
  );
}

function ScoreGrid({ score }: { score: MemberScore }) {
  return (
    <dl className="command-score-grid">
      <div><dt>Общие</dt><dd>{number.format(score.totalPoints)}</dd></div>
      <div><dt>Ресурсные</dt><dd>{number.format(score.resourcePoints)}</dd></div>
      <div><dt>Боевые</dt><dd>{number.format(score.battlePoints)}</dd></div>
      <div><dt>Достижения</dt><dd>{number.format(score.achievementPoints)}</dd></div>
    </dl>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="command-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="command-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header><h3>{title}</h3><button type="button" className="command-close" aria-label="Закрыть" title="Закрыть" onClick={onClose}>✕</button></header>
        {children}
      </div>
    </div>
  );
}

/** The single editor used both to found an alliance and to edit it from the overview. */
function AllianceEditor({ title, submitLabel, initial, onSubmit, onClose }: {
  title: string;
  submitLabel: string;
  initial: AllianceSettingsInput;
  onSubmit: (settings: AllianceSettingsInput) => CommandActionResult;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AllianceSettingsInput>({ ...initial, emblem: { ...initial.emblem } });
  const [error, setError] = useState('');
  const submit = () => {
    const result = onSubmit(draft);
    if (result.ok) onClose();
    else setError(result.message);
  };
  const set = (patch: Partial<AllianceSettingsInput>) => { setDraft((current) => ({ ...current, ...patch })); setError(''); };

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="command-editor">
        <div className="command-editor-preview">
          <EmblemGlyph emblem={draft.emblem} />
          <strong>{draft.name.trim() || 'Название союза'}</strong>
          <span>[{draft.tag.trim().toUpperCase() || 'TAG'}]</span>
          <p>{draft.motto.trim() || 'Девиз союза'}</p>
        </div>
        <div className="command-editor-form">
          <label><span>НАЗВАНИЕ</span><input value={draft.name} maxLength={ALLIANCE_NAME_MAX} onChange={(event) => set({ name: event.target.value })} data-qa-alliance-name /></label>
          <label><span>ТЕГ</span><input value={draft.tag} maxLength={ALLIANCE_TAG_MAX} onChange={(event) => set({ tag: event.target.value })} data-qa-alliance-tag /></label>
          <label className="wide"><span>ДЕВИЗ</span><input value={draft.motto} maxLength={ALLIANCE_MOTTO_MAX} onChange={(event) => set({ motto: event.target.value })} /></label>
          <label className="wide"><span>ОПИСАНИЕ</span><textarea value={draft.description} maxLength={ALLIANCE_DESCRIPTION_MAX} rows={3} onChange={(event) => set({ description: event.target.value })} /></label>
          <div className="command-emblem-row">
            <div><small>ЗНАК</small><div className="command-chip-row">
              {GLYPHS.map((glyph) => (
                <button key={glyph} type="button" aria-label={`Знак ${glyph}`} className={draft.emblem.glyph === glyph ? 'selected' : ''} onClick={() => set({ emblem: { ...draft.emblem, glyph } })}><EmblemGlyph compact emblem={{ ...draft.emblem, glyph }} /></button>
              ))}
            </div></div>
            <div><small>АКЦЕНТ</small><div className="command-chip-row">
              {ACCENTS.map((accent) => (
                <button key={accent} type="button" aria-label={ACCENT_LABELS[accent]} title={ACCENT_LABELS[accent]} className={`command-accent-dot ${draft.emblem.accent === accent ? 'selected' : ''}`} style={{ '--command-accent-dot': ACCENT_COLORS[accent] } as CSSProperties} onClick={() => set({ emblem: { ...draft.emblem, accent } })} />
              ))}
            </div></div>
          </div>
          {error ? <div className="command-error" role="alert" data-qa-command-error>{error}</div> : null}
          <div className="command-actions">
            <button type="button" className="primary" onClick={submit} data-qa-alliance-submit>{submitLabel}</button>
            <button type="button" className="danger" onClick={onClose}>ОТМЕНА</button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose }: { title: string; body: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="command-dialog-body">{body}</p>
      <div className="command-actions">
        <button type="button" className="danger" onClick={() => { onConfirm(); onClose(); }} data-qa-confirm>{confirmLabel}</button>
        <button type="button" onClick={onClose}>ОТМЕНА</button>
      </div>
    </Dialog>
  );
}

function LockedHall({ hall, onBuild }: { hall: CommandHallInfo; onBuild: () => void }) {
  return (
    <div className="command-locked" data-qa-command-locked role="status">
      <div className="command-locked-art"><img src={hall.art} alt="" draggable={false} /></div>
      <div className="command-locked-copy">
        <small>ДОСТУП ЗАКРЫТ</small>
        <h2>Нужно здание «{hall.name}»</h2>
        <p>«Командование» открывается, когда на любой вашей планете построено здание «{hall.name}» (уровень 1 и выше). Достаточно одной планеты, а уровни разных планет не суммируются.</p>
        <p>Ваш союз, заявки и состав не потеряны: после постройки доступ вернётся автоматически.</p>
        <button type="button" className="primary" onClick={onBuild} data-qa-command-build>ПЕРЕЙТИ К СТРОИТЕЛЬСТВУ</button>
      </div>
    </div>
  );
}

type CatalogProps = {
  command: CommandState;
  ownerId: string;
  ownerScores: Readonly<Record<string, MemberScore | undefined>>;
  now: number;
  actions: CommandActions;
  onFeedback: (result: CommandActionResult) => void;
  testControls: boolean;
};

function CatalogList({ command, ownerId, ownerScores, now, actions, onFeedback, testControls }: CatalogProps) {
  const [query, setQuery] = useState('');
  const entries = useMemo(
    () => filterAllianceCatalog(selectAllianceCatalog(command, ownerScores), query),
    [command, ownerScores, query],
  );
  const membership = selectOwnerMembership(command, ownerId);
  const pending = selectPendingApplication(command, ownerId);

  const actionFor = (entry: AllianceCatalogEntry) => {
    if (membership?.alliance.id === entry.alliance.id) return <span className="command-chip is-own">ВАШ СОЮЗ</span>;
    if (membership) return null;
    if (pending?.allianceId === entry.alliance.id) {
      return <button type="button" onClick={() => onFeedback(actions.withdraw())} data-qa-withdraw>ОТОЗВАТЬ ЗАЯВКУ</button>;
    }
    if (pending) return <button type="button" disabled title="Сначала отзовите текущую заявку">ЗАЯВКА ПОДАНА</button>;
    const block = selectReapplyBlock(command, ownerId, entry.alliance.id, now);
    if (block) return <button type="button" disabled>ЧЕРЕЗ {formatCountdown(block.until - now)}</button>;
    if (entry.isFull) return <button type="button" disabled>НЕТ МЕСТ</button>;
    return <button type="button" className="primary" onClick={() => onFeedback(actions.apply(entry.alliance.id))} data-qa-apply={entry.alliance.id}>ПОДАТЬ ЗАЯВКУ</button>;
  };

  return (
    <Panel
      title="КАТАЛОГ СОЮЗОВ"
      kicker="ВСЕ СУЩЕСТВУЮЩИЕ СОЮЗЫ"
      aside={<span className="command-count">{entries.length}</span>}
      className="command-catalog"
    >
      <div className="command-catalog-tools">
        <input type="search" value={query} placeholder="Название или тег" aria-label="Поиск союза" onChange={(event) => setQuery(event.target.value)} data-qa-catalog-search />
        {testControls && actions.testBotCreateAlliance ? (
          <button type="button" onClick={() => onFeedback(actions.testBotCreateAlliance!())} data-qa-test-bot-create>ТЕСТ: СОЮЗ БОТА 01</button>
        ) : null}
      </div>
      {entries.length ? (
        <ul className="command-catalog-list" data-qa-catalog-list>
          {entries.map((entry) => (
            <li key={entry.alliance.id} className={membership?.alliance.id === entry.alliance.id ? 'is-own' : ''} data-qa-catalog-item={entry.alliance.id}>
              <EmblemGlyph compact emblem={entry.alliance.emblem} />
              <div className="command-catalog-main">
                <strong title={entry.alliance.name}>{entry.alliance.name} <em>[{entry.alliance.tag}]</em></strong>
                <small>Лидер: {entry.leaderName}</small>
                {entry.alliance.description ? <p>{entry.alliance.description}</p> : null}
              </div>
              <dl className="command-catalog-stats">
                <div><dt>Место</dt><dd>#{entry.rank}</dd></div>
                <div><dt>Рейтинг</dt><dd>{number.format(entry.rating.averageTotalPoints)}</dd></div>
                <div><dt>Участники</dt><dd>{entry.rating.memberCount}/{MAX_ALLIANCE_MEMBERS}</dd></div>
              </dl>
              <div className="command-catalog-action">{actionFor(entry)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="command-empty" data-qa-catalog-empty role="status">
          {command.alliances.length ? 'Ничего не найдено.' : 'Союзов пока нет. Создайте первый.'}
        </div>
      )}
    </Panel>
  );
}

function ApplicationRow({ application, score, actions, onFeedback, canDecide }: {
  application: AllianceApplication;
  score: MemberScore;
  actions: CommandActions;
  onFeedback: (result: CommandActionResult) => void;
  canDecide: boolean;
}) {
  return (
    <li className="command-application" data-qa-application={application.id}>
      <span className="command-avatar">{initials(application.displayName)}</span>
      <div className="command-application-main"><strong>{application.displayName}</strong><ScoreGrid score={score} /></div>
      {canDecide ? (
        <div className="command-actions">
          <button type="button" className="primary" onClick={() => onFeedback(actions.accept(application.id))} data-qa-accept>ПРИНЯТЬ</button>
          <button type="button" className="danger" onClick={() => onFeedback(actions.reject(application.id))} data-qa-reject>ОТКЛОНИТЬ</button>
        </div>
      ) : null}
    </li>
  );
}

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

function ApplicationsTab({ command, allianceId, role, ownerScores, actions, onFeedback, testControls }: {
  command: CommandState;
  allianceId: string;
  role: AllianceRole;
  ownerScores: Readonly<Record<string, MemberScore | undefined>>;
  actions: CommandActions;
  onFeedback: (result: CommandActionResult) => void;
  testControls: boolean;
}) {
  const canDecide = canManageAlliance(role);
  const pending = selectPendingApplicationsFor(command, allianceId);
  const history = command.applications
    .filter((application) => application.allianceId === allianceId && application.status !== 'pending')
    .sort((left, right) => (right.resolvedAt ?? 0) - (left.resolvedAt ?? 0))
    .slice(0, 12);
  return (
    <div className="command-two-column">
      <Panel title="ВХОДЯЩИЕ ЗАЯВКИ" kicker="ОЖИДАЮТ РЕШЕНИЯ" aside={<span className="command-count">{pending.length}</span>}>
        {!canDecide ? <p className="command-note">Заявки рассматривают лидер и заместитель.</p> : null}
        {pending.length ? (
          <ul className="command-application-list" data-qa-application-list>
            {pending.map((application) => (
              <ApplicationRow key={application.id} application={application} score={memberScore(ownerScores, application.ownerId)} actions={actions} onFeedback={onFeedback} canDecide={canDecide} />
            ))}
          </ul>
        ) : <div className="command-empty" role="status">Новых заявок нет.</div>}
        {testControls && canDecide && actions.testBotApply ? (
          <div className="command-test-box"><small>TEST MODE</small><button type="button" onClick={() => onFeedback(actions.testBotApply!())} data-qa-test-bot-apply>ТЕСТ: ЗАЯВКА ОТ БОТА 01</button></div>
        ) : null}
      </Panel>
      <Panel title="РЕШЕНИЯ ПО ЗАЯВКАМ" kicker="ИСТОРИЯ">
        {history.length ? (
          <ul className="command-history">
            {history.map((application) => (
              <li key={application.id}>
                <strong>{application.displayName}</strong>
                <span className={`command-chip is-${application.status}`}>{APPLICATION_OUTCOME[application.status]}</span>
                {application.reason && APPLICATION_REASON[application.reason] ? <small>{APPLICATION_REASON[application.reason]}</small> : null}
                <time>{formatDate(application.resolvedAt ?? application.createdAt)}</time>
              </li>
            ))}
          </ul>
        ) : <div className="command-empty" role="status">Решений пока нет.</div>}
      </Panel>
    </div>
  );
}

function MembersTab({ command, allianceId, ownerId, role, ownerScores, actions, onFeedback }: {
  command: CommandState;
  allianceId: string;
  ownerId: string;
  role: AllianceRole;
  ownerScores: Readonly<Record<string, MemberScore | undefined>>;
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

  return (
    <div className="command-two-column command-two-column--members">
      <Panel title="СОСТАВ СОЮЗА" kicker="УЧАСТНИКИ" aside={<span className="command-count">{members.length}/{MAX_ALLIANCE_MEMBERS}</span>}>
        <ul className="command-member-list" data-qa-member-list>
          {members.map((member) => (
            <li key={member.ownerId}>
              <button type="button" className={selected?.ownerId === member.ownerId ? 'selected' : ''} onClick={() => setSelectedId(member.ownerId)}>
                <span className={`command-avatar is-${member.role}`}>{initials(member.displayName)}</span>
                <span className="command-member-name"><strong>{member.displayName}</strong><small>{ROLE_LABELS[member.role]}</small></span>
                <b>{number.format(memberScore(ownerScores, member.ownerId).totalPoints)}</b>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title={selected?.displayName ?? 'УЧАСТНИК'} kicker={selected ? ROLE_LABELS[selected.role] : 'ПРОФИЛЬ'}>
        {selected && selectedScore ? (
          <div className="command-detail">
            <ScoreGrid score={selectedScore} />
            <dl className="command-facts"><div><dt>В союзе с</dt><dd>{formatDate(selected.joinedAt)}</dd></div></dl>
            <p className="command-note">Планеты, флоты и активность участников скрыты от всех участников союза.</p>
            <div className="command-actions">
              {isLeader && selected.role === 'member' ? (
                <button type="button" onClick={() => onFeedback(actions.setDeputy(selected.ownerId))} data-qa-set-deputy>НАЗНАЧИТЬ ЗАМЕСТИТЕЛЕМ</button>
              ) : null}
              {isLeader && selected.role === 'deputy' ? (
                <button type="button" onClick={() => onFeedback(actions.setDeputy(null))} data-qa-clear-deputy>СНЯТЬ С ДОЛЖНОСТИ</button>
              ) : null}
              {isLeader && selected.ownerId !== ownerId ? (
                <button type="button" onClick={() => setConfirm({ kind: 'transfer', ownerId: selected.ownerId, name: selected.displayName })} data-qa-transfer>ПЕРЕДАТЬ ЛИДЕРСТВО</button>
              ) : null}
              {canKick ? (
                <button type="button" className="danger" onClick={() => setConfirm({ kind: 'kick', ownerId: selected.ownerId, name: selected.displayName })} data-qa-kick>ИСКЛЮЧИТЬ</button>
              ) : null}
            </div>
          </div>
        ) : <div className="command-empty" role="status">Выберите участника.</div>}
      </Panel>
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

function Overview({ command, allianceId, ownerId, role, ownerScores, actions, onFeedback, setTab }: {
  command: CommandState;
  allianceId: string;
  ownerId: string;
  role: AllianceRole;
  ownerScores: Readonly<Record<string, MemberScore | undefined>>;
  actions: CommandActions;
  onFeedback: (result: CommandActionResult) => void;
  setTab: (tab: CommandTab) => void;
}) {
  const alliance = command.alliances.find((candidate) => candidate.id === allianceId);
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  if (!alliance) return null;
  const rating = selectAllianceRating(alliance, ownerScores);
  const leader = alliance.members.find((member) => member.ownerId === alliance.leaderOwnerId);
  const deputy = alliance.members.find((member) => member.ownerId === alliance.deputyOwnerId);
  const pendingCount = selectPendingApplicationsFor(command, alliance.id).length;
  const others = alliance.members.filter((member) => member.ownerId !== ownerId);
  const manage = canManageAlliance(role);

  return (
    <div className="command-overview">
      <section className="command-panel command-summary">
        <div className="command-summary-crest"><EmblemGlyph emblem={alliance.emblem} /></div>
        <div className="command-summary-copy">
          <small>{ROLE_LABELS[role]}</small>
          <h2 title={alliance.name}>{alliance.name}</h2>
          <span className="command-tag">[{alliance.tag}]</span>
          {alliance.motto ? <p className="command-motto">{alliance.motto}</p> : null}
          {alliance.description ? <p>{alliance.description}</p> : null}
        </div>
        {manage ? (
          <button type="button" className="command-icon-button" aria-label="Редактировать союз" title="Редактировать союз" onClick={() => setEditing(true)} data-qa-edit-alliance>✎</button>
        ) : null}
      </section>

      <Panel title="РЕЙТИНГ СОЮЗА" kicker="СРЕДНЕЕ ПО УЧАСТНИКАМ">
        <div className="command-rating-hero"><strong>{number.format(rating.averageTotalPoints)}</strong><small>средние общие очки</small></div>
        <dl className="command-facts">
          <div><dt>Ресурсные (среднее)</dt><dd>{number.format(rating.averageResourcePoints)}</dd></div>
          <div><dt>Боевые (среднее)</dt><dd>{number.format(rating.averageBattlePoints)}</dd></div>
        </dl>
      </Panel>

      <Panel title="СОСТАВ" kicker="РУКОВОДСТВО">
        <dl className="command-facts">
          <div><dt>Участники</dt><dd>{alliance.members.length}/{MAX_ALLIANCE_MEMBERS}{isAllianceFull(alliance) ? ' · союз полон' : ''}</dd></div>
          <div><dt>Лидер</dt><dd>{leader?.displayName ?? '—'}</dd></div>
          <div><dt>Заместитель</dt><dd>{deputy?.displayName ?? 'не назначен'}</dd></div>
          <div><dt>Основан</dt><dd>{formatDate(alliance.createdAt)}</dd></div>
        </dl>
        <div className="command-actions">
          <button type="button" onClick={() => setTab('members')}>ОТКРЫТЬ СОСТАВ</button>
          {manage ? <button type="button" onClick={() => setTab('applications')}>ЗАЯВКИ{pendingCount ? ` · ${pendingCount}` : ''}</button> : null}
          <button type="button" className="danger" onClick={() => setLeaving(true)} data-qa-leave>ПОКИНУТЬ СОЮЗ</button>
        </div>
      </Panel>

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
        <button type="button" className="danger" onClick={() => { onLeave(needsSuccessor ? successor : undefined); onClose(); }} data-qa-confirm>{soleMember ? 'РАСФОРМИРОВАТЬ' : 'ПОКИНУТЬ'}</button>
        <button type="button" onClick={onClose}>ОТМЕНА</button>
      </div>
    </Dialog>
  );
}

function NoAlliance({ command, ownerId, ownerScores, now, actions, onFeedback, testControls }: CatalogProps) {
  const [creating, setCreating] = useState(false);
  const pending = selectPendingApplication(command, ownerId);
  const pendingAlliance = pending ? command.alliances.find((alliance) => alliance.id === pending.allianceId) : null;
  const lastResult = selectLastResolvedApplication(command, ownerId);
  const lastAlliance = lastResult ? command.alliances.find((alliance) => alliance.id === lastResult.allianceId) : null;
  const globalBlock = selectReapplyBlock(command, ownerId, null, now);
  const showLastResult = lastResult && !pending && lastResult.status !== 'withdrawn';

  return (
    <div className="command-no-alliance">
      <section className="command-panel command-cta" data-qa-command-empty>
        <small>БЕЗ СОЮЗА</small>
        <h2>Вы пока не состоите в союзе</h2>
        <p>Создайте свой союз бесплатно или подайте заявку в существующий. Вступление происходит только после решения руководства союза.</p>
        <button type="button" className="primary" disabled={Boolean(globalBlock)} title={globalBlock ? 'После выхода из союза создавать и вступать в союзы пока нельзя' : undefined} onClick={() => setCreating(true)} data-qa-create-alliance>
          {globalBlock ? `СОЗДАТЬ СОЮЗ · ЧЕРЕЗ ${formatCountdown(globalBlock.until - now)}` : 'СОЗДАТЬ СОЮЗ'}
        </button>
        {pending ? (
          <div className="command-banner is-pending" role="status" data-qa-pending>
            Заявка в «{pendingAlliance?.name ?? 'союз'}» ожидает решения.
            <button type="button" onClick={() => onFeedback(actions.withdraw())}>ОТОЗВАТЬ</button>
          </div>
        ) : null}
        {showLastResult ? (
          <div className={`command-banner is-${lastResult.status}`} role="status">
            Заявка в «{lastAlliance?.name ?? lastResult.allianceName ?? 'союз'}»: {APPLICATION_OUTCOME[lastResult.status].toLowerCase()}
            {lastResult.reason && APPLICATION_REASON[lastResult.reason] ? ` — ${APPLICATION_REASON[lastResult.reason].toLowerCase()}` : ''}.
          </div>
        ) : null}
        {globalBlock ? (
          <div className="command-banner is-cooldown" role="status" data-qa-cooldown>
            Заявки и создание союза закрыты ещё {formatCountdown(globalBlock.until - now)}.
          </div>
        ) : null}
      </section>
      <CatalogList command={command} ownerId={ownerId} ownerScores={ownerScores} now={now} actions={actions} onFeedback={onFeedback} testControls={testControls} />
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

function RequestsTab({ aid, now, actions, onFeedback, testControls }: {
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

  const chargeLine = !charges
    ? 'Заряды появятся после вступления в союз.'
    : charges.charges >= aid.maxCharges
      ? 'Запас полон.'
      : charges.paused
        ? 'Восстановление приостановлено: прогресс сохранён.'
        : charges.nextChargeAt !== null
          ? `${charges.intro ? 'Первый заряд союза' : 'Следующий заряд'} через ${formatCountdown(charges.nextChargeAt - now)}`
          : '';

  const submit = () => {
    if (!selectedPlanet || blocker) return;
    const result = actions.createRequest(selectedPlanet.id, resource, amount);
    onFeedback(result);
  };

  return (
    <div className="command-requests" data-qa-requests>
      <Panel title="МОИ ЗАПРОСЫ" kicker="РЕСУРСЫ ДЛЯ СВОЕЙ ПЛАНЕТЫ" aside={<span className="command-count" data-qa-request-charges>{charges ? `${charges.charges}/${aid.maxCharges}` : '—'} ЗАРЯДА</span>}>
        <p className="command-note" data-qa-charge-line>{chargeLine}</p>
        <div className="command-request-form" data-qa-request-form>
          <label className="command-select"><span>ПЛАНЕТА НАЗНАЧЕНИЯ</span>
            <select value={selectedPlanet?.id ?? ''} onChange={(event) => setPlanetId(event.target.value)} data-qa-request-planet>
              {aid.planets.map((planet) => <option key={planet.id} value={planet.id}>{planet.name} [{planet.coordinate.galaxy}:{planet.coordinate.system}:{planet.coordinate.position}]</option>)}
            </select>
          </label>
          <label className="command-select"><span>РЕСУРС</span>
            <select value={resource} onChange={(event) => setResource(event.target.value as AidResource)} data-qa-request-resource>
              {AID_RESOURCES.map((key) => <option key={key} value={key}>{AID_RESOURCE_LABELS[key]}</option>)}
            </select>
          </label>
          <label className="command-select"><span>КОЛИЧЕСТВО · {number.format(aid.minAmount)}–{number.format(aid.maxAmount)}</span>
            <input type="number" inputMode="numeric" min={aid.minAmount} max={aid.maxAmount} step={1} value={amountText} onChange={(event) => setAmountText(event.target.value)} data-qa-request-amount />
          </label>
          <button type="button" className="primary" disabled={Boolean(blocker)} onClick={submit} data-qa-request-create>СОЗДАТЬ ЗАПРОС</button>
        </div>
        <p className="command-note" data-qa-request-limit>Максимум зависит от ресурсных очков ({number.format(aid.resourcePoints)}), а не от уровня Палаты. Открыто запросов: {aid.openCount} из {aid.maxOpen}. Запрос нельзя изменить; отмена возможна, пока никто не отправил помощь.</p>
        {blocker ? <p className="command-note is-warning" role="status" data-qa-request-blocker>{blocker}</p> : null}
        {overflow && overflow.lost > 0 ? (
          <p className="command-note is-warning" role="alert" data-qa-request-overflow>
            Склад планеты вмещает ещё {number.format(overflow.free)}. Если доставить {number.format(amount)}, {number.format(overflow.lost)} сгорит и не будет засчитано — запрос останется открытым на недостающее.
          </p>
        ) : null}
        {aid.mine.length === 0 ? <div className="command-empty" data-qa-requests-empty>У вас нет открытых запросов.</div> : (
          <ul className="command-request-list" data-qa-my-requests>
            {aid.mine.map((row) => (
              <li key={row.request.id} data-qa-request-id={row.request.id} data-qa-request-status={row.request.status}>
                <div className="command-request-head">
                  <strong>{AID_RESOURCE_LABELS[row.request.resource]} → {row.request.planetName}</strong>
                  <small>[{row.request.coordinate.galaxy}:{row.request.coordinate.system}:{row.request.coordinate.position}]</small>
                </div>
                <RequestProgressBar row={row} />
                <RequestFigures row={row} />
                <div className="command-request-actions">
                  <button type="button" className="danger" disabled={!row.canCancel} title={row.canCancel ? 'Вернёт заряд' : 'Помощь уже отправлена — отменить нельзя'} onClick={() => onFeedback(actions.cancelRequest(row.request.id))} data-qa-request-cancel>ОТМЕНИТЬ</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {aid.closed.length ? (
          <ul className="command-history" aria-label="Недавно закрытые запросы" data-qa-closed-requests>
            {aid.closed.map((request) => (
              <li key={request.id}><strong>{AID_RESOURCE_LABELS[request.resource]} → {request.planetName}</strong><small>{CLOSE_REASON_LABELS[request.closeReason ?? 'cancelled'] ?? 'Закрыт'} · {number.format(request.delivered)} из {number.format(request.requested)}</small></li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel title="ЗАПРОСЫ СОЮЗНИКОВ" kicker="ОТПРАВИТЬ ПОМОЩЬ" aside={<span className="command-count">{aid.incoming.length}</span>}>
        {aid.incoming.length === 0 ? <div className="command-empty" data-qa-incoming-empty>Союзники пока ничего не просили.</div> : (
          <ul className="command-request-list" data-qa-incoming-requests>
            {aid.incoming.map((row) => {
              const full = row.progress.remainder <= 0;
              const reason = full ? 'Весь остаток уже в пути или доставлен' : !aid.hasFreeTransporters ? 'Нужен свободный транспортёр или мега-транспортёр' : '';
              return (
                <li key={row.request.id} data-qa-request-id={row.request.id}>
                  <div className="command-request-head">
                    <strong>{row.request.authorName}</strong>
                    <small>{AID_RESOURCE_LABELS[row.request.resource]} → {row.request.planetName} [{row.request.coordinate.galaxy}:{row.request.coordinate.system}:{row.request.coordinate.position}]</small>
                  </div>
                  <RequestProgressBar row={row} />
                  <RequestFigures row={row} />
                  <div className="command-request-actions">
                    <small>Можно отправить: {number.format(row.progress.remainder)}</small>
                    <button type="button" className="primary" disabled={Boolean(reason)} title={reason || undefined} onClick={() => onFeedback(actions.startHelp(row.request.id))} data-qa-request-help>ПОМОЧЬ</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {testControls && actions.testIraPrepare ? (
        <div className="command-test-box command-test-box--wide" data-qa-aid-test-box>
          <small>ТЕСТ · ИРА ВЕЛЬ</small>
          <span>Ручной сценарий проверки помощи в обе стороны тем же полётным движком. Ира сама ничего не решает.</span>
          <button type="button" onClick={() => onFeedback(actions.testIraPrepare!())} data-qa-test-ira-prepare>ПОДГОТОВИТЬ ФЛОТ ИРЫ</button>
          <button type="button" onClick={() => onFeedback(actions.testIraRequest!('metal', 60_000))} data-qa-test-ira-request>ЗАПРОС ИРЫ: 60 000 МЕТАЛЛА</button>
          <button type="button" onClick={() => onFeedback(actions.testIraHelp!())} data-qa-test-ira-help>ИРА ПОМОГАЕТ ИГРОКУ</button>
        </div>
      ) : null}
    </div>
  );
}

export function CommandView({ mode, command, ownerId, hall, ownerScores, aid, now, actions }: CommandViewProps) {
  const [tab, setTab] = useState<CommandTab>('overview');
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

  const visibleTabs = (Object.keys(TAB_LABELS) as CommandTab[]).filter((key) => key !== 'applications' || membership);
  const activeTab = visibleTabs.includes(tab) ? tab : 'overview';
  const pendingCount = membership ? selectPendingApplicationsFor(command, membership.alliance.id).length : 0;

  return (
    <main className="command-view" aria-label="Командование союза" data-qa-command-state={status.key}>
      <header className="command-view__header">
        <div><small>ALLIANCE COMMAND</small><h1>КОМАНДОВАНИЕ</h1></div>
        <div className="command-view__status">
          <span className={`command-status-chip is-${status.key}`} data-qa-command-status>{status.label}</span>
          <strong>{membership ? `${membership.alliance.name} [${membership.alliance.tag}]` : locked ? hall.name : 'СОЮЗ НЕ ВЫБРАН'}</strong>
        </div>
      </header>

      {locked ? (
        <LockedHall hall={hall} onBuild={actions.openHallConstruction} />
      ) : (
        <>
          {membership ? (
            <nav className="command-tabs" aria-label="Разделы Командования">
              {visibleTabs.map((key) => (
                <button key={key} type="button" className={activeTab === key ? 'active' : ''} aria-current={activeTab === key ? 'page' : undefined} onClick={() => setTab(key)} data-qa-command-tab={key}>
                  {TAB_LABELS[key]}{key === 'applications' && pendingCount ? <b className="command-badge">{pendingCount}</b> : null}
                </button>
              ))}
            </nav>
          ) : null}
          {feedback ? (
            <div className={`command-feedback ${feedback.ok ? 'is-ok' : 'is-error'}`} role={feedback.ok ? 'status' : 'alert'} data-qa-command-feedback>
              <span>{feedback.message}</span>
              <button type="button" aria-label="Скрыть сообщение" onClick={() => setFeedback(null)}>✕</button>
            </div>
          ) : null}

          <section className="command-content">
            {!membership ? (
              <NoAlliance command={command} ownerId={ownerId} ownerScores={ownerScores} now={now} actions={actions} onFeedback={onFeedback} testControls={testControls} />
            ) : activeTab === 'overview' ? (
              <Overview command={command} allianceId={membership.alliance.id} ownerId={ownerId} role={membership.role} ownerScores={ownerScores} actions={actions} onFeedback={onFeedback} setTab={setTab} />
            ) : activeTab === 'members' ? (
              <MembersTab command={command} allianceId={membership.alliance.id} ownerId={ownerId} role={membership.role} ownerScores={ownerScores} actions={actions} onFeedback={onFeedback} />
            ) : activeTab === 'applications' ? (
              <ApplicationsTab command={command} allianceId={membership.alliance.id} role={membership.role} ownerScores={ownerScores} actions={actions} onFeedback={onFeedback} testControls={testControls} />
            ) : activeTab === 'alliances' ? (
              <CatalogList command={command} ownerId={ownerId} ownerScores={ownerScores} now={now} actions={actions} onFeedback={onFeedback} testControls={testControls} />
            ) : activeTab === 'requests' ? (
              <RequestsTab aid={aid} now={now} actions={actions} onFeedback={onFeedback} testControls={testControls} />
            ) : activeTab === 'diplomacy' ? (
              <Stub title="Дипломатия">Объявление войны и перемирие появятся в будущей версии. Сейчас отношения между союзами не меняются.</Stub>
            ) : (
              <OperationsTab command={command} ownerId={ownerId} now={now} />
            )}
          </section>
        </>
      )}
    </main>
  );
}
