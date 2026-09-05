import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import type {
  AllianceAccent,
  AllianceEmblem,
  AllianceEmblemGlyph,
  AllianceMember,
  AllianceSettingsInput,
  CommandState,
  DiplomaticRelation,
  JointOperation,
  RelationStatus,
  ResourceRequest,
  ResourceType,
} from './domain/command/types.ts';
import './command.css';

type CommandViewProps = {
  state: CommandState;
  onJoinOperation: (operationId: string) => void;
  onReviewRequest: (requestId: string) => void;
  onSaveSettings: (input: AllianceSettingsInput) => void;
  onOpenFleets: () => void;
};

type CommandTab = 'overview' | 'members' | 'requests' | 'diplomacy' | 'operations' | 'settings';

const TAB_LABELS: Record<CommandTab, string> = {
  overview: 'ОБЗОР СОЮЗА',
  members: 'УЧАСТНИКИ',
  requests: 'ЗАПРОСЫ РЕСУРСОВ',
  diplomacy: 'ДИПЛОМАТИЯ',
  operations: 'СОВМЕСТНЫЕ ОПЕРАЦИИ',
  settings: 'НАСТРОЙКИ СОЮЗА',
};

const ROLE_LABELS: Record<AllianceMember['role'], string> = {
  leader: 'ГЛАВА СОЮЗА',
  officer: 'ОФИЦЕР',
  veteran: 'ВЕТЕРАН',
  member: 'УЧАСТНИК',
};

const ACTIVITY_LABELS: Record<AllianceMember['activity'], string> = {
  online: 'ONLINE',
  active: 'АКТИВЕН',
  away: 'НЕ В СЕТИ',
};

const RESOURCE_LABELS: Record<ResourceType, string> = {
  metal: 'МЕТАЛЛ',
  minerals: 'МИНЕРАЛЫ',
  gas: 'ГАЗ',
  energy: 'ЭНЕРГИЯ',
};

const RELATION_LABELS: Record<RelationStatus, string> = {
  ally: 'СОЮЗНИК',
  trade_pact: 'ТОРГОВЫЙ ПАКТ',
  neutral: 'НЕЙТРАЛИТЕТ',
  tense: 'НАПРЯЖЁННОСТЬ',
  hostile: 'ВРАЖДЕБНОСТЬ',
};

const OPERATION_STATE_LABELS: Record<JointOperation['state'], string> = {
  preparing: 'ПОДГОТОВКА',
  mustering: 'СБОР СИЛ',
  active: 'АКТИВНАЯ ФАЗА',
  awaiting: 'ОЖИДАЕТ УЧАСТНИКОВ',
};

const OPERATION_KIND_LABELS: Record<JointOperation['kind'], string> = {
  sun_raid: 'ФЛАГМАНСКАЯ ОПЕРАЦИЯ',
  assault: 'СОВМЕСТНАЯ ОПЕРАЦИЯ',
  defense: 'ОБОРОНИТЕЛЬНАЯ ОПЕРАЦИЯ',
  logistics: 'КООПЕРАТИВНАЯ ЛОГИСТИКА',
};

const ACCENT_COLORS: Record<AllianceAccent, string> = {
  cyan: '#26d9ff',
  amber: '#f5b84e',
  violet: '#a98cff',
};

const number = new Intl.NumberFormat('ru-RU');

function memberById(state: CommandState, memberId: string) {
  return state.members.find((member) => member.id === memberId) ?? null;
}

function operationById(state: CommandState, operationId: string | null) {
  if (!operationId) return null;
  return state.jointOperations.find((operation) => operation.id === operationId) ?? null;
}

function EmblemGlyph({ emblem, compact = false }: { emblem: AllianceEmblem; compact?: boolean }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.55, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const style = { '--command-emblem': ACCENT_COLORS[emblem.accent] } as CSSProperties;
  return (
    <span className={`command-emblem command-emblem--${emblem.glyph} ${compact ? 'command-emblem--compact' : ''}`} style={style}>
      <svg viewBox="0 0 80 96" aria-hidden="true">
        <path className="command-emblem-shield" d="M40 4 70 16v29c0 22-12 36-30 47C22 81 10 67 10 45V16L40 4Z" />
        {emblem.glyph === 'starforge' ? (
          <g><path {...common} d="m40 22 7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2 7-14Z"/><circle {...common} cx="40" cy="45" r="8"/></g>
        ) : emblem.glyph === 'orbit' ? (
          <g><circle {...common} cx="40" cy="45" r="10"/><ellipse {...common} cx="40" cy="45" rx="25" ry="11" transform="rotate(24 40 45)"/><ellipse {...common} cx="40" cy="45" rx="25" ry="11" transform="rotate(-32 40 45)"/></g>
        ) : (
          <g><path {...common} d="m40 18 10 23-10 9-10-9 10-23Z"/><path {...common} d="M18 58 40 46l22 12M23 68l17-10 17 10"/></g>
        )}
      </svg>
    </span>
  );
}

function OperationGlyph({ operation }: { operation: JointOperation }) {
  if (operation.kind === 'sun_raid') return <span className="command-operation-glyph command-operation-glyph--sun">☼</span>;
  if (operation.kind === 'assault') return <span className="command-operation-glyph">⌖</span>;
  if (operation.kind === 'defense') return <span className="command-operation-glyph">⬡</span>;
  return <span className="command-operation-glyph">⇄</span>;
}

function ResourceGlyph({ resource }: { resource: ResourceType }) {
  return <span className={`command-resource-glyph command-resource-glyph--${resource}`}>{resource === 'metal' ? '◆' : resource === 'minerals' ? '◇' : resource === 'gas' ? '◈' : 'ϟ'}</span>;
}

function RelationBadge({ relation }: { relation: DiplomaticRelation }) {
  return <span className={`command-relation-badge command-relation-badge--${relation.status}`}>{RELATION_LABELS[relation.status]}</span>;
}

function OperationCard({ operation, onOpen, onJoin, compact = false }: {
  operation: JointOperation;
  onOpen: () => void;
  onJoin: () => void;
  compact?: boolean;
}) {
  const fill = Math.min(100, Math.round((operation.participants / Math.max(1, operation.recommendedParticipants)) * 100));
  return (
    <article className={`command-operation-card command-operation-card--${operation.kind} ${compact ? 'command-operation-card--compact' : ''}`}>
      <div className="command-operation-card__head">
        <OperationGlyph operation={operation} />
        <div><small>{OPERATION_KIND_LABELS[operation.kind]}</small><strong>{operation.title}</strong></div>
        <span className={`command-state command-state--${operation.state}`}>{OPERATION_STATE_LABELS[operation.state]}</span>
      </div>
      <p>{operation.objective}</p>
      <div className="command-operation-card__progress"><i style={{ width: `${fill}%` }} /></div>
      <div className="command-operation-card__meta">
        <span>Участники <b>{operation.participants} / {operation.recommendedParticipants}</b></span>
        <span>{operation.windowLabel}</span>
      </div>
      <div className="command-card-actions">
        <button type="button" onClick={onOpen}>ПОДРОБНЕЕ</button>
        <button type="button" className="primary" disabled={operation.joinedByPlayer} onClick={onJoin}>
          {operation.joinedByPlayer ? 'ВЫ УЧАСТВУЕТЕ' : 'ПРИСОЕДИНИТЬСЯ'}
        </button>
      </div>
    </article>
  );
}

function RequestRow({ state, request, onOpen }: { state: CommandState; request: ResourceRequest; onOpen: () => void }) {
  const member = memberById(state, request.memberId);
  const progress = Math.min(100, Math.round((request.fulfilledAmount / Math.max(1, request.amount)) * 100));
  return (
    <button type="button" className={`command-request-row command-request-row--${request.priority}`} onClick={onOpen}>
      <ResourceGlyph resource={request.resource} />
      <span><strong>{member?.callsign ?? 'Неизвестный участник'}</strong><small>{request.purpose}</small></span>
      <span className="command-request-amount"><b>{number.format(request.amount)}</b><small>{RESOURCE_LABELS[request.resource]}</small></span>
      <span className="command-request-progress"><i style={{ width: `${progress}%` }} /></span>
      <em>{request.state === 'reviewing' ? 'НА РАССМОТРЕНИИ' : 'ОТКРЫТЬ'}</em>
    </button>
  );
}

function Overview({ state, setTab, openRequest, openOperation, onJoinOperation }: {
  state: CommandState;
  setTab: (tab: CommandTab) => void;
  openRequest: (requestId: string) => void;
  openOperation: (operationId: string) => void;
  onJoinOperation: (operationId: string) => void;
}) {
  const leader = memberById(state, state.alliance.leaderMemberId);
  const sunRaid = state.jointOperations.find((operation) => operation.kind === 'sun_raid') ?? state.jointOperations[0];
  const secondaryOperations = state.jointOperations.filter((operation) => operation.id !== sunRaid?.id).slice(0, 2);
  const openRequests = state.resourceRequests.slice(0, 3);

  return (
    <div className="command-overview">
      <section className="command-panel command-alliance-summary">
        <div className="command-alliance-summary__crest"><EmblemGlyph emblem={state.alliance.emblem} /></div>
        <div className="command-alliance-summary__copy">
          <small>СОЮЗ // АКТИВЕН</small>
          <h2>{state.alliance.name}</h2>
          <span>[{state.alliance.tag}]</span>
          <p>{state.alliance.motto}</p>
        </div>
        <dl>
          <div><dt>Лидер</dt><dd>{leader?.callsign ?? '—'}</dd></div>
          <div><dt>Участники</dt><dd>{state.members.length}</dd></div>
          <div><dt>Основан</dt><dd>{state.alliance.foundedLabel}</dd></div>
          <div><dt>Активность</dt><dd className="positive">СТАБИЛЬНАЯ</dd></div>
        </dl>
        <button type="button" className="command-link-button" onClick={() => setTab('members')}>ОТКРЫТЬ СОСТАВ →</button>
      </section>

      <section className="command-panel command-overview-operations">
        <header className="command-panel-heading"><div><small>КОМАНДНЫЙ КОНТУР</small><h3>АКТИВНЫЕ СОВМЕСТНЫЕ ОПЕРАЦИИ</h3></div><button type="button" onClick={() => setTab('operations')}>ВСЕ ОПЕРАЦИИ</button></header>
        {sunRaid ? <OperationCard operation={sunRaid} onOpen={() => openOperation(sunRaid.id)} onJoin={() => onJoinOperation(sunRaid.id)} /> : null}
        <div className="command-operation-mini-grid">
          {secondaryOperations.map((operation) => (
            <OperationCard key={operation.id} operation={operation} compact onOpen={() => openOperation(operation.id)} onJoin={() => onJoinOperation(operation.id)} />
          ))}
        </div>
      </section>

      <section className="command-panel command-diplomacy-summary">
        <header className="command-panel-heading"><div><small>ВНЕШНИЙ КОНТУР</small><h3>ДИПЛОМАТИЧЕСКАЯ СВОДКА</h3></div><button type="button" onClick={() => setTab('diplomacy')}>ПОДРОБНЕЕ</button></header>
        <div className="command-diplomacy-stack">
          {state.diplomacy.slice(0, 5).map((relation) => (
            <div key={relation.id} className={`command-diplomacy-row command-diplomacy-row--${relation.status}`}>
              <span className="command-diplomacy-mark">{relation.tag.slice(0, 2)}</span>
              <span><strong>{relation.allianceName}</strong><small>[{relation.tag}]</small></span>
              <RelationBadge relation={relation} />
            </div>
          ))}
        </div>
      </section>

      <section className="command-panel command-overview-requests">
        <header className="command-panel-heading"><div><small>СНАБЖЕНИЕ</small><h3>ЗАПРОСЫ УЧАСТНИКОВ</h3></div><button type="button" onClick={() => setTab('requests')}>ВСЕ ЗАПРОСЫ</button></header>
        <div className="command-request-stack">
          {openRequests.length ? openRequests.map((request) => <RequestRow key={request.id} state={state} request={request} onOpen={() => openRequest(request.id)} />) : <div className="command-empty">Нет активных запросов ресурсов.</div>}
        </div>
      </section>

      <section className="command-panel command-news-feed">
        <header className="command-panel-heading"><div><small>ЖУРНАЛ СОЮЗА</small><h3>ПОСЛЕДНИЕ СОБЫТИЯ</h3></div></header>
        <div className="command-news-list">
          {state.events.length ? state.events.slice(0, 5).map((event) => (
            <div key={event.id} className={`command-news-item command-news-item--${event.kind}`}><time>{event.timestampLabel}</time><span>{event.text}</span></div>
          )) : <div className="command-empty">Событий пока нет.</div>}
        </div>
      </section>
    </div>
  );
}

function MembersTab({ state, selectedId, onSelect, openRequest }: {
  state: CommandState;
  selectedId: string;
  onSelect: (id: string) => void;
  openRequest: (requestId: string) => void;
}) {
  const selected = memberById(state, selectedId) ?? state.members[0] ?? null;
  const selectedOperation = selected ? operationById(state, selected.currentOperationId) : null;
  const selectedRequests = selected ? state.resourceRequests.filter((request) => request.memberId === selected.id) : [];
  return (
    <div className="command-list-detail">
      <section className="command-panel command-list-panel">
        <header className="command-panel-heading"><div><small>СОСТАВ СОЮЗА</small><h3>УЧАСТНИКИ</h3></div><span>{state.members.length} АКТИВНЫХ ПРОФИЛЕЙ</span></header>
        <div className="command-member-list">
          {state.members.map((member) => (
            <button key={member.id} type="button" className={selected?.id === member.id ? 'selected' : ''} onClick={() => onSelect(member.id)}>
              <span className={`command-member-avatar command-member-avatar--${member.role}`}>{member.callsign.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
              <span><strong>{member.callsign}</strong><small>{ROLE_LABELS[member.role]} · {member.specialization}</small></span>
              <span className={`command-activity command-activity--${member.activity}`}>{ACTIVITY_LABELS[member.activity]}</span>
              <b>{number.format(member.contribution)}</b>
            </button>
          ))}
        </div>
      </section>
      <aside className="command-panel command-detail-panel">
        {selected ? (
          <>
            <div className="command-profile-head">
              <span className={`command-member-avatar command-member-avatar--${selected.role}`}>{selected.callsign.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
              <div><small>{ROLE_LABELS[selected.role]}</small><h2>{selected.callsign}</h2><p>{selected.homeSector}</p></div>
              <span className={`command-activity command-activity--${selected.activity}`}>{ACTIVITY_LABELS[selected.activity]}</span>
            </div>
            <dl className="command-detail-grid">
              <div><dt>Специализация</dt><dd>{selected.specialization}</dd></div>
              <div><dt>Вклад в союз</dt><dd>{number.format(selected.contribution)}</dd></div>
              <div><dt>Текущая операция</dt><dd>{selectedOperation?.title ?? 'Нет активной операции'}</dd></div>
              <div><dt>Домашний сектор</dt><dd>{selected.homeSector}</dd></div>
            </dl>
            <section className="command-detail-note"><small>ПРОФИЛЬ</small><p>{selected.note}</p></section>
            <section className="command-member-requests">
              <small>ЗАПРОСЫ УЧАСТНИКА</small>
              {selectedRequests.length ? selectedRequests.map((request) => (
                <button key={request.id} type="button" onClick={() => openRequest(request.id)}><ResourceGlyph resource={request.resource} /><span>{RESOURCE_LABELS[request.resource]} · {number.format(request.amount)}</span><b>ОТКРЫТЬ →</b></button>
              )) : <p>Открытых запросов нет.</p>}
            </section>
          </>
        ) : <div className="command-empty command-empty--large">Выбери участника, чтобы открыть профиль.</div>}
      </aside>
    </div>
  );
}

function RequestsTab({ state, selectedId, onSelect, onReviewRequest, onOpenFleets }: {
  state: CommandState;
  selectedId: string;
  onSelect: (id: string) => void;
  onReviewRequest: (id: string) => void;
  onOpenFleets: () => void;
}) {
  const selected = state.resourceRequests.find((request) => request.id === selectedId) ?? state.resourceRequests[0] ?? null;
  const member = selected ? memberById(state, selected.memberId) : null;
  const progress = selected ? Math.min(100, Math.round((selected.fulfilledAmount / Math.max(1, selected.amount)) * 100)) : 0;
  return (
    <div className="command-list-detail">
      <section className="command-panel command-list-panel">
        <header className="command-panel-heading"><div><small>КООПЕРАТИВНОЕ СНАБЖЕНИЕ</small><h3>ЗАПРОСЫ РЕСУРСОВ</h3></div><span>{state.resourceRequests.filter((request) => request.state === 'open').length} ОТКРЫТО</span></header>
        <div className="command-request-stack command-request-stack--full">
          {state.resourceRequests.length ? state.resourceRequests.map((request) => <RequestRow key={request.id} state={state} request={request} onOpen={() => onSelect(request.id)} />) : <div className="command-empty">Запросов ресурсов нет.</div>}
        </div>
      </section>
      <aside className="command-panel command-detail-panel">
        {selected ? (
          <>
            <div className="command-request-detail-head"><ResourceGlyph resource={selected.resource} /><div><small>{RESOURCE_LABELS[selected.resource]} · {selected.priority.toUpperCase()}</small><h2>{number.format(selected.amount)}</h2><p>Запрос: {member?.callsign ?? 'Неизвестный участник'}</p></div></div>
            <section className="command-request-purpose"><small>НАЗНАЧЕНИЕ</small><p>{selected.purpose}</p></section>
            <div className="command-request-meter"><span><b>{number.format(selected.fulfilledAmount)}</b> подтверждено из {number.format(selected.amount)}</span><em>{progress}%</em><div><i style={{ width: `${progress}%` }} /></div></div>
            <dl className="command-detail-grid">
              <div><dt>Статус</dt><dd>{selected.state === 'reviewing' ? 'НА РАССМОТРЕНИИ' : 'ОТКРЫТ'}</dd></div>
              <div><dt>Приоритет</dt><dd>{selected.priority === 'critical' ? 'КРИТИЧЕСКИЙ' : selected.priority === 'high' ? 'ВЫСОКИЙ' : 'СТАНДАРТНЫЙ'}</dd></div>
            </dl>
            <div className="command-detail-actions">
              <button type="button" className="primary" disabled={selected.state === 'reviewing'} onClick={() => onReviewRequest(selected.id)}>{selected.state === 'reviewing' ? 'ПРИНЯТО К РАССМОТРЕНИЮ' : 'ПОМОЧЬ'}</button>
              <button type="button" onClick={onOpenFleets}>ПОДГОТОВИТЬ ОТПРАВКУ</button>
            </div>
            <p className="command-foundation-note">Фактическое списание ресурсов и транспортировка не выполняются здесь. Подготовка отправки переносит в раздел «Флоты».</p>
          </>
        ) : <div className="command-empty command-empty--large">Нет выбранного запроса.</div>}
      </aside>
    </div>
  );
}

function DiplomacyTab({ state, selectedId, onSelect }: { state: CommandState; selectedId: string; onSelect: (id: string) => void }) {
  const selected = state.diplomacy.find((relation) => relation.id === selectedId) ?? state.diplomacy[0] ?? null;
  return (
    <div className="command-list-detail">
      <section className="command-panel command-list-panel">
        <header className="command-panel-heading"><div><small>ВНЕШНИЕ СОЮЗЫ</small><h3>ДИПЛОМАТИЯ</h3></div><span>FOUNDATION V1</span></header>
        <div className="command-diplomacy-list">
          {state.diplomacy.map((relation) => (
            <button key={relation.id} type="button" className={`${selected?.id === relation.id ? 'selected' : ''} command-diplomacy-list__item--${relation.status}`} onClick={() => onSelect(relation.id)}>
              <span className="command-diplomacy-mark">{relation.tag.slice(0, 2)}</span>
              <span><strong>{relation.allianceName}</strong><small>[{relation.tag}] · {relation.note}</small></span>
              <RelationBadge relation={relation} />
              <b>›</b>
            </button>
          ))}
        </div>
      </section>
      <aside className="command-panel command-detail-panel">
        {selected ? (
          <>
            <div className="command-relation-head"><span className="command-diplomacy-mark command-diplomacy-mark--large">{selected.tag.slice(0, 2)}</span><div><small>ВНЕШНИЙ СОЮЗ [{selected.tag}]</small><h2>{selected.allianceName}</h2><RelationBadge relation={selected} /></div></div>
            <section className="command-detail-note"><small>ТЕКУЩАЯ ОЦЕНКА</small><p>{selected.note}</p></section>
            <section className="command-detail-note command-detail-note--accent"><small>СМЫСЛ СТАТУСА</small><p>{selected.meaning}</p></section>
            <section className="command-relation-history"><small>ПОСЛЕДНИЕ СОБЫТИЯ</small>{selected.history.map((item, index) => <div key={`${selected.id}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{item}</p></div>)}</section>
            <p className="command-foundation-note">Реальные дипломатические бафы, войны, права доступа и сетевые соглашения отложены.</p>
          </>
        ) : <div className="command-empty command-empty--large">Выбери союз для просмотра досье.</div>}
      </aside>
    </div>
  );
}

function SunScope({ operation }: { operation: JointOperation }) {
  const fill = Math.min(100, Math.round((operation.participants / Math.max(1, operation.recommendedParticipants)) * 100));
  return (
    <div className="command-sun-scope">
      <div className="command-sun-scope__rings"><i /><i /><i /><span /></div>
      <div className="command-sun-scope__caption"><small>ТЕКУЩАЯ ЦЕЛЬ</small><strong>КОРОНАЛЬНЫЙ УЗЕЛ КОРОН-7</strong><span>Готовность союзной группы: {fill}%</span></div>
    </div>
  );
}

function OperationsTab({ state, selectedId, onSelect, onJoinOperation, onOpenFleets }: {
  state: CommandState;
  selectedId: string;
  onSelect: (id: string) => void;
  onJoinOperation: (id: string) => void;
  onOpenFleets: () => void;
}) {
  const selected = state.jointOperations.find((operation) => operation.id === selectedId) ?? state.jointOperations[0] ?? null;
  const fill = selected ? Math.min(100, Math.round((selected.participants / Math.max(1, selected.recommendedParticipants)) * 100)) : 0;
  return (
    <div className="command-operations-layout">
      <section className="command-panel command-operations-catalog">
        <header className="command-panel-heading"><div><small>СОЮЗНЫЙ КОНТУР</small><h3>СОВМЕСТНЫЕ ОПЕРАЦИИ</h3></div><span>{state.jointOperations.filter((operation) => operation.joinedByPlayer).length} В ВАШЕМ КОНТУРЕ</span></header>
        <div className="command-operation-catalog-grid">
          {state.jointOperations.length ? state.jointOperations.map((operation) => (
            <button key={operation.id} type="button" className={`${selected?.id === operation.id ? 'selected' : ''} command-operation-catalog-card--${operation.kind}`} onClick={() => onSelect(operation.id)}>
              <OperationGlyph operation={operation} /><span><small>{OPERATION_KIND_LABELS[operation.kind]}</small><strong>{operation.title}</strong><em>{OPERATION_STATE_LABELS[operation.state]}</em></span><b>{operation.participants}/{operation.recommendedParticipants}</b>
            </button>
          )) : <div className="command-empty">Совместных операций сейчас нет.</div>}
        </div>
      </section>
      <aside className={`command-panel command-operation-dossier ${selected?.kind === 'sun_raid' ? 'command-operation-dossier--sun' : ''}`}>
        {selected ? (
          <>
            <div className="command-operation-dossier__head"><OperationGlyph operation={selected} /><div><small>{OPERATION_KIND_LABELS[selected.kind]}</small><h2>{selected.title}</h2><span className={`command-state command-state--${selected.state}`}>{OPERATION_STATE_LABELS[selected.state]}</span></div></div>
            {selected.kind === 'sun_raid' ? <SunScope operation={selected} /> : <div className="command-tactical-grid"><span>TACTICAL LINK</span><i /><i /><i /></div>}
            <section className="command-detail-note"><small>ЦЕЛЬ</small><p>{selected.objective}</p></section>
            <section className="command-detail-note"><small>БРИФИНГ</small><p>{selected.description}</p></section>
            <div className="command-operation-readiness"><span><b>{selected.participants}</b> участников из рекомендуемых {selected.recommendedParticipants}</span><em>{fill}%</em><div><i style={{ width: `${fill}%` }} /></div><small>{selected.windowLabel}</small></div>
            <div className="command-detail-actions">
              <button type="button" className="primary" disabled={selected.joinedByPlayer} onClick={() => onJoinOperation(selected.id)}>{selected.joinedByPlayer ? 'ВЫ УЧАСТВУЕТЕ' : 'ПРИСОЕДИНИТЬСЯ'}</button>
              <button type="button" onClick={onOpenFleets}>ПОДГОТОВИТЬ ФЛОТ</button>
            </div>
            <p className="command-foundation-note">Присоединение сохраняется локально. Реальный совместный бой и dispatch флота не запускаются в этом vertical slice.</p>
          </>
        ) : <div className="command-empty command-empty--large">Выбери совместную операцию.</div>}
      </aside>
    </div>
  );
}

function SettingsTab({ state, onSaveSettings }: { state: CommandState; onSaveSettings: (input: AllianceSettingsInput) => void }) {
  const [draft, setDraft] = useState<AllianceSettingsInput>({
    name: state.alliance.name,
    tag: state.alliance.tag,
    motto: state.alliance.motto,
    description: state.alliance.description,
    emblem: { ...state.alliance.emblem },
  });
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft({
      name: state.alliance.name,
      tag: state.alliance.tag,
      motto: state.alliance.motto,
      description: state.alliance.description,
      emblem: { ...state.alliance.emblem },
    });
    setError('');
  }, [state.alliance.name, state.alliance.tag, state.alliance.motto, state.alliance.description, state.alliance.emblem.glyph, state.alliance.emblem.accent]);

  const resetDraft = () => {
    setDraft({ name: state.alliance.name, tag: state.alliance.tag, motto: state.alliance.motto, description: state.alliance.description, emblem: { ...state.alliance.emblem } });
    setError('');
  };

  const submit = () => {
    const name = draft.name.trim().replace(/\s+/g, ' ');
    const tag = draft.tag.trim().replace(/\s+/g, '').toUpperCase();
    const motto = draft.motto.trim().replace(/\s+/g, ' ');
    const description = draft.description.trim().replace(/\s+/g, ' ');
    if (!name || !tag || !motto || !description) return setError('Заполни название, тег, девиз и описание.');
    if (name.length > 42) return setError('Название — максимум 42 символа.');
    if (tag.length > 8) return setError('Тег — максимум 8 символов.');
    if (motto.length > 72) return setError('Девиз — максимум 72 символа.');
    if (description.length > 220) return setError('Описание — максимум 220 символов.');
    onSaveSettings({ name, tag, motto, description, emblem: { ...draft.emblem } });
    setError('');
  };

  const glyphs: AllianceEmblemGlyph[] = ['starforge', 'orbit', 'vanguard'];
  const accents: AllianceAccent[] = ['cyan', 'amber', 'violet'];

  return (
    <div className="command-settings-layout">
      <section className="command-panel command-settings-preview">
        <small>ПРЕДПРОСМОТР СОЮЗА</small>
        <EmblemGlyph emblem={draft.emblem} />
        <h2>{draft.name || 'Название союза'}</h2>
        <span>[{draft.tag || 'TAG'}]</span>
        <p>{draft.motto || 'Девиз союза'}</p>
        <div className="command-settings-preview__status">● АКТИВНЫЙ СОЮЗ</div>
      </section>
      <section className="command-panel command-settings-form">
        <header className="command-panel-heading"><div><small>ЛОКАЛЬНАЯ КОНФИГУРАЦИЯ</small><h3>НАСТРОЙКИ СОЮЗА</h3></div></header>
        <div className="command-form-grid">
          <label><span>НАЗВАНИЕ СОЮЗА</span><input value={draft.name} maxLength={42} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <label><span>ТЕГ</span><input value={draft.tag} maxLength={8} onChange={(event) => setDraft((current) => ({ ...current, tag: event.target.value }))} /></label>
          <label className="command-form-wide"><span>ДЕВИЗ</span><input value={draft.motto} maxLength={72} onChange={(event) => setDraft((current) => ({ ...current, motto: event.target.value }))} /></label>
          <label className="command-form-wide"><span>КРАТКОЕ ОПИСАНИЕ</span><textarea value={draft.description} maxLength={220} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
        </div>
        <div className="command-emblem-editor">
          <div><small>ЗНАК СОЮЗА</small><div className="command-emblem-options">{glyphs.map((glyph) => <button key={glyph} type="button" className={draft.emblem.glyph === glyph ? 'selected' : ''} onClick={() => setDraft((current) => ({ ...current, emblem: { ...current.emblem, glyph } }))}><EmblemGlyph compact emblem={{ ...draft.emblem, glyph }} /></button>)}</div></div>
          <div><small>АКЦЕНТ</small><div className="command-accent-options">{accents.map((accent) => <button key={accent} type="button" aria-label={accent} className={draft.emblem.accent === accent ? 'selected' : ''} style={{ '--command-accent-dot': ACCENT_COLORS[accent] } as CSSProperties} onClick={() => setDraft((current) => ({ ...current, emblem: { ...current.emblem, accent } }))} />)}</div></div>
        </div>
        {error ? <div className="command-form-error">{error}</div> : null}
        <div className="command-detail-actions"><button type="button" className="primary" onClick={submit}>СОХРАНИТЬ</button><button type="button" onClick={resetDraft}>ОТМЕНИТЬ</button></div>
        <p className="command-foundation-note">Настройки сохраняются внутри существующего save `asterion.vertical-slice.v1` и сбрасываются общим Prototype Reset.</p>
      </section>
    </div>
  );
}

export function CommandView({ state, onJoinOperation, onReviewRequest, onSaveSettings, onOpenFleets }: CommandViewProps) {
  const [tab, setTab] = useState<CommandTab>('overview');
  const [selectedMemberId, setSelectedMemberId] = useState(state.members[0]?.id ?? '');
  const [selectedRequestId, setSelectedRequestId] = useState(state.resourceRequests[0]?.id ?? '');
  const [selectedRelationId, setSelectedRelationId] = useState(state.diplomacy[0]?.id ?? '');
  const [selectedOperationId, setSelectedOperationId] = useState(state.jointOperations.find((operation) => operation.kind === 'sun_raid')?.id ?? state.jointOperations[0]?.id ?? '');

  const joinedCount = useMemo(() => state.jointOperations.filter((operation) => operation.joinedByPlayer).length, [state.jointOperations]);

  const openRequest = (requestId: string) => { setSelectedRequestId(requestId); setTab('requests'); };
  const openOperation = (operationId: string) => { setSelectedOperationId(operationId); setTab('operations'); };

  return (
    <main className="command-view" aria-label="Командование союза">
      <header className="command-view__header">
        <div><small>ALLIANCE COMMAND // FOUNDATION V1</small><h1>КОМАНДОВАНИЕ</h1></div>
        <div className="command-view__status"><span>● СВЯЗЬ С СОЮЗОМ</span><strong>{state.alliance.name} [{state.alliance.tag}]</strong><small>{joinedCount} совместн. задач в вашем контуре</small></div>
      </header>

      <nav className="command-tabs" aria-label="Разделы Командования">
        {(Object.keys(TAB_LABELS) as CommandTab[]).map((key) => <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{TAB_LABELS[key]}</button>)}
      </nav>

      <section className="command-content">
        {tab === 'overview' ? <Overview state={state} setTab={setTab} openRequest={openRequest} openOperation={openOperation} onJoinOperation={onJoinOperation} /> : null}
        {tab === 'members' ? <MembersTab state={state} selectedId={selectedMemberId} onSelect={setSelectedMemberId} openRequest={openRequest} /> : null}
        {tab === 'requests' ? <RequestsTab state={state} selectedId={selectedRequestId} onSelect={setSelectedRequestId} onReviewRequest={onReviewRequest} onOpenFleets={onOpenFleets} /> : null}
        {tab === 'diplomacy' ? <DiplomacyTab state={state} selectedId={selectedRelationId} onSelect={setSelectedRelationId} /> : null}
        {tab === 'operations' ? <OperationsTab state={state} selectedId={selectedOperationId} onSelect={setSelectedOperationId} onJoinOperation={onJoinOperation} onOpenFleets={onOpenFleets} /> : null}
        {tab === 'settings' ? <SettingsTab state={state} onSaveSettings={onSaveSettings} /> : null}
      </section>
    </main>
  );
}
