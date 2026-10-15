import { useEffect, useMemo, useState } from 'react';

import { OPERATION_MODIFIER_LABELS, OPERATION_SOURCE_LABELS } from './domain/operations/catalog.ts';
import type {
  OperationCategory,
  OperationId,
  OperationInstance,
  OperationLocation,
  OperationState,
  OperationThreatTier,
  OperationsState,
} from './domain/operations/types.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import type { ResourceIconKind } from './ui/resources/resource-assets.ts';
import type { PirateContactPresentation } from './pirate-ui.ts';
import { isPirateOperationId, pirateContactOperation, pirateCycleOperation, pirateOperationId } from './application/pirate-presentation.ts';
import './operations.css';

type OperationsViewProps = {
  state: OperationsState;
  onAccept: (operationId: OperationId) => void;
  onCancel: (operationId: OperationId) => void;
  onReveal: (operationId: OperationId) => void;
  onOpenFleets: () => void;
  pirateContacts?: readonly PirateContactPresentation[];
  quietPirateSystems?: readonly QuietPirateCycle[];
  onPirateAccept?: (contact: PirateContactPresentation) => void;
  onPirateCancel?: (contact: PirateContactPresentation) => void;
  nowMs?: number;
  onPirateRecon?: (contact: PirateContactPresentation) => void;
  onPirateAttack?: (contact: PirateContactPresentation) => void;
  onPirateReport?: (reportId: string) => void;
  onPirateUniverse?: (contact: PirateContactPresentation) => void;
};

type OperationsTab = Extract<OperationState, 'available' | 'active' | 'completed'>;
type QuietPirateCycle = { galaxy: number; system: number; nextEligibleAt: number; contactCycleKey: string; coordinate: PirateContactPresentation['coordinate'] };
type OperationRow = { operation: OperationInstance; contact?: PirateContactPresentation; quiet?: QuietPirateCycle };

const TAB_LABELS: Record<OperationsTab, string> = {
  available: 'ДОСТУПНЫЕ',
  active: 'АКТИВНЫЕ',
  completed: 'ЗАВЕРШЁННЫЕ',
};

const CATEGORY_LABELS: Record<OperationCategory, string> = {
  combat: 'БОЕВАЯ ОПЕРАЦИЯ',
  discovery: 'НЕИЗВЕСТНЫЙ КОНТАКТ',
  exploration: 'ИССЛЕДОВАНИЕ',
  science: 'НАУЧНАЯ ОПЕРАЦИЯ',
};

const ROMAN_THREAT: Record<OperationThreatTier, string> = {
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
  5: 'V',
  6: 'VI',
};

const number = new Intl.NumberFormat('ru-RU');

function formatLocation(location: OperationLocation) {
  if (location.kind === 'system') return `Галактика ${location.galaxy} · Система ${String(location.system).padStart(2, '0')}`;
  if (location.kind === 'coordinates') return location.coordinates;
  return location.label;
}

function formatLocationClass(location: OperationLocation) {
  if (location.kind === 'system') return 'Системный контакт';
  if (location.kind === 'coordinates') return 'Координатный контакт';
  return location.label;
}

function threatText(operation: OperationInstance) {
  const prefix = operation.category === 'combat' ? 'УГРОЗА' : 'РИСК';
  if (operation.threat) return `${prefix} ${ROMAN_THREAT[operation.threat]}`;
  if (operation.threatRange) return `${prefix} ${ROMAN_THREAT[operation.threatRange[0]]}–${ROMAN_THREAT[operation.threatRange[1]]}`;
  return `${prefix} НЕИЗВЕСТЕН`;
}

function threatTier(operation: OperationInstance) {
  if (operation.threat) return ROMAN_THREAT[operation.threat];
  return '?';
}

function IntelPips({ level }: { level: OperationInstance['intel'] }) {
  return (
    <span className="operations-intel-pips-v2" aria-label={`Разведданные ${level} из 3`}>
      {[1, 2, 3].map((step) => <i key={step} className={step <= level ? 'filled' : ''} />)}
    </span>
  );
}

function OperationGlyph({ category }: { category: OperationCategory }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (category === 'combat') return <svg viewBox="0 0 40 40" aria-hidden="true"><circle {...common} cx="20" cy="20" r="12"/><circle {...common} cx="20" cy="20" r="4"/><path {...common} d="M20 4v8M20 28v8M4 20h8M28 20h8"/></svg>;
  if (category === 'science') return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="M16 5h8M17 5v10L9 31c-1 2 .1 4 3 4h16c2.9 0 4-2 3-4l-8-16V5"/><path {...common} d="M13 27h14M16 21h8"/></svg>;
  if (category === 'exploration') return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="m20 5 8 25-8-6-8 6 8-25Z"/><circle {...common} cx="20" cy="19" r="3"/></svg>;
  return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="M7 30c4-8 10-12 18-12M11 34c3-6 7-9 14-9M25 18c4 0 7 3 7 7"/><circle {...common} cx="27" cy="12" r="4"/><path {...common} d="M27 4v4M35 12h-4"/></svg>;
}

function rewardEntries(operation: OperationInstance) {
  return [
    ['МЕТАЛЛ', operation.rewardPreview.metal, 'metal'],
    ['МИНЕРАЛЫ', operation.rewardPreview.minerals, 'minerals'],
    ['ГАЗ', operation.rewardPreview.gas, 'gas'],
  ].filter((entry): entry is [string, number, ResourceIconKind] => typeof entry[1] === 'number');
}

function RewardPreview({ operation, compact = false }: { operation: OperationInstance; compact?: boolean }) {
  const entries = rewardEntries(operation);
  if (!entries.length && !operation.rewardPreview.labels?.length) {
    return <span className="operations-reward-unknown-v2">НАГРАДА НЕИЗВЕСТНА</span>;
  }

  return (
    <div className={compact ? 'operations-reward-compact-v2' : 'operations-reward-v2'}>
      {entries.map(([label, value, glyph]) => (
        <span key={label}>
          <i><ResourceIcon kind={glyph} /></i>
          {!compact ? <small>{label}</small> : null}
          <strong>{number.format(value)}</strong>
        </span>
      ))}
      {!compact ? operation.rewardPreview.labels?.map((label) => <em key={label}>{label}</em>) : null}
    </div>
  );
}

function TacticalScope({ operation, contact }: { operation: OperationInstance; contact?: PirateContactPresentation }) {
  // Diagrammatic orbital-slot projection: coordinates are authoritative, not invented distances.
  const slot = contact?.coordinate.position ?? 1;
  const angle = ((slot - 1) / 24) * Math.PI * 2 - Math.PI / 2;
  const markerX = 240 + Math.cos(angle) * 83;
  const markerY = 120 + Math.sin(angle) * 83;
  const unknown = operation.intel === 0;
  const isCombat = operation.category === 'combat';
  const isScience = operation.category === 'science';
  const isDerelict = operation.category === 'exploration';

  return (
    <div className={`operations-scope-v2 operations-scope-v2--${operation.category} ${unknown ? 'is-unknown' : ''}`}>
      <svg viewBox="0 0 480 240" aria-hidden="true">
        <path className="scope-grid" d="M20 120h440M240 16v208M84 45l312 150M84 195 396 45" />
        <circle className="scope-ring ring-outer" cx="240" cy="120" r="92" />
        <circle className="scope-ring ring-mid" cx="240" cy="120" r="61" />
        <circle className="scope-ring ring-inner" cx="240" cy="120" r="30" />
        <path className="scope-sweep" d="M240 120 392 76A160 160 0 0 1 400 120Z" />

        {contact ? (
          <g className="scope-hostiles" data-qa-pirate-scope-position={slot}>
            <circle cx={markerX} cy={markerY} r="7" />
            <circle cx={markerX} cy={markerY} r="17" fill="none" strokeDasharray="3 4" opacity=".7"/>
            <path d={`M${markerX - 12} ${markerY}h24M${markerX} ${markerY - 12}v24`} />
          </g>
        ) : isCombat ? (
          <g className="scope-hostiles">
            <circle cx="324" cy="82" r="5" />
            <circle cx="350" cy="135" r="4" />
            <circle cx="292" cy="158" r="4" />
            <path d="m324 67 15 15-15 15-15-15 15-15Z" />
          </g>
        ) : null}

        {unknown ? (
          <g className="scope-unknown-contact">
            <circle cx="282" cy="99" r="9" />
            <circle cx="282" cy="99" r="22" />
            <path d="M270 99h24M282 87v24" />
          </g>
        ) : null}

        {isDerelict ? (
          <g className="scope-derelict">
            <path d="m292 92 42 13-19 10 19 11-42 14-29-24 29-24Z" />
            <path d="m306 101-8 30M320 107l-8 17" />
          </g>
        ) : null}

        {isScience ? (
          <g className="scope-anomaly">
            <path d="M279 61c44 13 62 58 40 94s-76 43-109 15-32-76-1-106 68-30 97-10" />
            <path d="M274 85c28 8 39 37 25 60s-48 27-69 9-20-48 0-67 43-19 61-6" />
          </g>
        ) : null}
      </svg>
      <div className="operations-scope-caption-v2">
        <span>{contact ? `ЦЕЛЬ · ПОЗИЦИЯ ${slot}/24` : unknown ? 'СИГНАТУРА НЕ КЛАССИФИЦИРОВАНА' : isCombat ? 'ТАКТИЧЕСКИЙ КОНТАКТ' : isScience ? 'ПОЛЕ ИСКАЖЕНИЯ' : 'ОБЪЕКТ ОБНАРУЖЕН'}</span>
        <small>{contact ? formatLocation(operation.location) : unknown ? 'ОЖИДАНИЕ ГЛУБОКОГО СКАНА' : `INTEL ${operation.intel}/3`}</small>
      </div>
    </div>
  );
}

function OperationCard({ operation, selected, onSelect, contact, quiet, nowMs }: {
  operation: OperationInstance;
  selected: boolean;
  onSelect: () => void;
  contact?: PirateContactPresentation;
  quiet?: QuietPirateCycle;
  nowMs: number;
}) {
  const intelZero = operation.intel === 0;
  const firstReward = rewardEntries(operation)[0];

  return (
    <button
      type="button"
      className={`operation-feed-card-v2 operation-feed-card-v2--${operation.category} ${selected ? 'selected' : ''}`}
      data-threat={operation.threat ?? 'unknown'}
      data-qa-pirate-contact={contact?.contactCycleKey ?? quiet?.contactCycleKey}
      onClick={onSelect}
    >
      <span className="operation-feed-threat-v2"><b>{threatTier(operation)}</b><small>{intelZero ? 'UNKNOWN' : operation.category === 'combat' ? 'THREAT' : 'RISK'}</small></span>
      <span className="operation-feed-copy-v2">
        <small>{CATEGORY_LABELS[operation.category]}</small>
        <strong>{operation.title}</strong>
        <em>{contact ? `Пиратский контакт · осталось ${pirateRemainingLabel(contact.expiresAt, nowMs)}` : quiet ? 'База уничтожена · ожидание нового цикла' : isPirateOperationId(operation.id) ? 'Контакт завершён' : intelZero ? 'Сигнатура требует классификации' : operation.objective.label}</em>
        <span className="operation-feed-meta-v2">
          <i>{isPirateOperationId(operation.id) ? formatLocation(operation.location) : intelZero ? formatLocationClass(operation.location) : formatLocation(operation.location)}</i>
          <IntelPips level={operation.intel} />
          {isPirateOperationId(operation.id) ? <b>ОБЛОМКИ 60%+</b> : firstReward ? <b><ResourceIcon kind={firstReward[2]} /> {number.format(firstReward[1])}</b> : <b>НАГРАДА ?</b>}
        </span>
      </span>
      <span className="operation-feed-arrow-v2">›</span>
    </button>
  );
}

function EmptyState({ tab }: { tab: OperationsTab }) {
  const copy = tab === 'active'
    ? ['АКТИВНЫХ ОПЕРАЦИЙ НЕТ', 'Примите операцию из списка доступных.']
    : tab === 'completed'
      ? ['ИСТОРИЯ ПОКА ПУСТА', 'Завершённые операции появятся после подключения выполнения.']
      : ['КОНТАКТОВ НЕТ', 'Новых операций сейчас не обнаружено.'];

  return <div className="operations-empty-v2"><span>◇</span><strong>{copy[0]}</strong><p>{copy[1]}</p></div>;
}

function pirateCoordinateLabel(contact: PirateContactPresentation) {
  const { galaxy, system, position } = contact.coordinate;
  return `Галактика ${galaxy} · Система ${String(system).padStart(2, '0')} · Позиция ${position}`;
}

function pirateRemainingLabel(expiresAt: number, nowMs: number) {
  const seconds = Math.max(0, Math.ceil((expiresAt - nowMs) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes} мин ${String(remainder).padStart(2, '0')} с` : `${remainder} с`;
}

function OperationDossier({ operation, pirateContact, quiet, nowMs, onAccept, onCancel, onReveal, onOpenFleets, onPirateRecon, onPirateAttack, onPirateReport, onPirateUniverse }: {
  operation: OperationInstance | null;
  pirateContact?: PirateContactPresentation;
  quiet?: QuietPirateCycle;
  nowMs: number;
  onPirateRecon?: (contact: PirateContactPresentation) => void;
  onPirateAttack?: (contact: PirateContactPresentation) => void;
  onPirateReport?: (reportId: string) => void;
  onPirateUniverse?: (contact: PirateContactPresentation) => void;
  onAccept: (id: OperationId) => void;
  onCancel: (id: OperationId) => void;
  onReveal: (id: OperationId) => void;
  onOpenFleets: () => void;
}) {
  if (!operation) {
    return (
      <aside className="operations-dossier-v2 operations-dossier-v2--empty">
        <span>SELECT // OPERATION</span>
        <strong>ВЫБЕРИТЕ КОНТАКТ</strong>
        <p>Операционный брифинг появится здесь.</p>
      </aside>
    );
  }

  const pirate = isPirateOperationId(operation.id);
  const intelZero = operation.intel === 0 && !pirate;
  const modifierLabels = operation.modifiers.map((modifier) => OPERATION_MODIFIER_LABELS[modifier]);
  const reconLabel = pirateContact?.latestReportOutcome === 'success' ? 'Разведданные получены'
    : pirateContact?.latestReportOutcome === 'failure' ? 'Разведка не удалась'
      : pirateContact?.statusLabel === 'Зонд в пути' ? 'Зонд в пути' : 'Нет разведданных';

  return (
    <aside className={`operations-dossier-v2 operations-dossier-v2--${operation.category}`} data-threat={operation.threat ?? 'unknown'}>
      <header className="operations-dossier-head-v2">
        <div className="operations-dossier-title-v2">
          <span className="operations-dossier-glyph-v2"><OperationGlyph category={operation.category} /></span>
          <div>
            <small>{pirate ? `БОЕВАЯ ОПЕРАЦИЯ · ${pirateContact ? 'ДЕЙСТВУЮЩАЯ ЦЕЛЬ' : 'АРХИВ КОНТАКТА'}` : `${CATEGORY_LABELS[operation.category]} · ${operation.id.toUpperCase()}`}</small>
            <h2>{operation.title}</h2>
            <p>{intelZero ? formatLocationClass(operation.location) : formatLocation(operation.location)} <i /> {OPERATION_SOURCE_LABELS[operation.source]}</p>
          </div>
        </div>
        <div className="operations-dossier-threat-v2">
          <small>{pirate ? 'СТАТУС КОНТАКТА' : operation.category === 'combat' ? 'УРОВЕНЬ УГРОЗЫ' : 'УРОВЕНЬ РИСКА'}</small>
          <strong>{pirate ? (pirateContact ? '●' : '—') : threatTier(operation)}</strong>
          <span>{pirate ? (pirateContact ? 'ОБНАРУЖЕН' : quiet ? 'УНИЧТОЖЕН' : 'ИСТЁК') : threatText(operation)}</span>
        </div>
      </header>

      <section className="operations-dossier-hero-v2">
        <TacticalScope operation={operation} contact={pirateContact} />
        <div className="operations-briefing-v2">
          <small>ОПЕРАТИВНАЯ СВОДКА</small>
          <h3>{pirate ? pirateContact ? 'ПИРАТСКАЯ БАЗА ОБНАРУЖЕНА' : quiet ? 'ПИРАТСКАЯ БАЗА УНИЧТОЖЕНА' : 'КОНТАКТ ЗАВЕРШЁН' : intelZero ? 'ДАННЫХ НЕДОСТАТОЧНО' : 'КОНТАКТ КЛАССИФИЦИРОВАН'}</h3>
          <p>{pirate ? pirateContact ? `Действующая база в системе вашей колонии. Координаты: ${pirateCoordinateLabel(pirateContact)}.` : quiet ? 'Пиратская база разгромлена. Начался период до следующего возможного появления контакта.' : 'Цикл закончился или цель исчезла. На прежние координаты рейд не отправляется.' : intelZero ? 'Сенсоры фиксируют нестабильный источник неизвестного происхождения. До глубокого сканирования тип объекта, точная угроза и возможная награда скрыты.' : operation.briefing}</p>
          <div className="operations-intel-line-v2">
            <span>{pirate ? 'РАЗВЕДКА' : 'РАЗВЕДДАННЫЕ'}</span>
            {pirate ? <b>{pirateContact ? reconLabel : 'Контакт завершён'}</b> : <><IntelPips level={operation.intel} /><b>{operation.intel} / 3</b></>}
          </div>
          {pirateContact ? <div className="operations-pirate-live-timer" role="timer">До исчезновения: <strong>{pirateRemainingLabel(pirateContact.expiresAt, nowMs)}</strong></div> : quiet ? <div className="operations-pirate-live-timer" role="timer">Следующий цикл возможен через: <strong>{pirateRemainingLabel(quiet.nextEligibleAt, nowMs)}</strong></div> : null}
        </div>
      </section>

      {intelZero ? (
        <section className="operations-unknown-brief-v2">
          <div><small>КЛАСС КОНТАКТА</small><strong>НЕИЗВЕСТЕН</strong></div>
          <div><small>ВОЗМОЖНЫЙ РИСК</small><strong>{operation.threatRange ? `${ROMAN_THREAT[operation.threatRange[0]]}–${ROMAN_THREAT[operation.threatRange[1]]}` : '?'}</strong></div>
          <p>Сканирование классифицирует сигнал и заменит его конкретной операцией. Результат фиксирован и сохраняется в текущем save.</p>
        </section>
      ) : (
        <>
          <section className="operations-objective-v2">
            <small>ОСНОВНАЯ ЦЕЛЬ</small>
            <strong>{operation.objective.label}</strong>
          </section>

          <div className="operations-dossier-lower-v2">
            {pirate ? <>
              <section className="operations-conditions-v2">
                <small>РАЗВЕДДАННЫЕ</small>
                <strong>{pirateContact ? reconLabel : 'Цикл завершён'}</strong>
                <p>{pirateContact?.latestReportOutcome === 'success' ? 'Состав пиратского флота доступен в разведотчёте.' : pirateContact?.latestReportOutcome === 'failure' ? 'Зонд не получил данные о составе флота.' : pirateContact ? 'Отправь разведзонд, чтобы узнать состав противника.' : 'Для этой базы разведка больше не доступна.'}</p>
              </section>
              <section className="operations-rewards-panel-v2">
                <small>ПОТЕНЦИАЛЬНЫЕ ОБЛОМКИ</small>
                <strong>60% стоимости уничтоженных пиратских кораблей</strong>
                <p>Корсар: +0,5 п.п. за уровень (макс. 80% общей доли), если участвовал и выжил. Обломки остаются на орбите — их нужно собрать отдельно. Фактическое количество зависит от потерь пиратов.</p>
              </section>
            </> : <>
              <section className="operations-conditions-v2">
                <small>УСЛОВИЯ КОНТАКТА</small>
                <div>{modifierLabels.length ? modifierLabels.map((label) => <span key={label}>⚠ {label}</span>) : <span>Без особых условий</span>}</div>
                <p>Показаны только подтверждённые данные текущего уровня разведки.</p>
              </section>
              <section className="operations-rewards-panel-v2">
                <small>НАГРАДА · ПРЕДПРОСМОТР</small>
                <RewardPreview operation={operation} />
                <p>Начисление награды появится вместе с реальным выполнением операций.</p>
              </section>
            </>}
          </div>
        </>
      )}

      <footer className="operations-command-v2">
        <div>
          <small>СТАТУС</small>
          <strong>{pirate ? operation.state === 'completed' ? quiet ? 'БАЗА УНИЧТОЖЕНА' : 'КОНТАКТ ЗАВЕРШЁН' : operation.state === 'active' ? 'ОПЕРАЦИЯ ПРИНЯТА' : 'ДОСТУПНА К ПРИНЯТИЮ' : operation.state === 'active' ? 'ОПЕРАЦИЯ ПРИНЯТА' : operation.state === 'completed' ? 'ОПЕРАЦИЯ ЗАВЕРШЕНА' : intelZero ? 'ТРЕБУЕТСЯ СКАНИРОВАНИЕ' : 'ГОТОВА К ПРИНЯТИЮ'}</strong>
          <span>{pirate ? quiet ? 'Пауза перед возможным новым появлением базы — не таймер атаки на игрока.' : operation.state === 'active' ? 'Выбери действие для этого действующего контакта.' : operation.state === 'available' ? 'Прими операцию, чтобы открыть действия.' : 'Прошлый цикл больше не активен.' : operation.state === 'active' ? 'Подготовьте флот в разделе «Флоты».' : intelZero ? 'Классифицируйте контакт перед принятием решения.' : 'Принятие фиксирует операцию как активную.'}</span>
        </div>
        <div className="operations-command-actions-v2">
          {pirate ? pirateContact && operation.state === 'available'
            ? <button type="button" className="operations-primary-v2" onClick={() => onAccept(operation.id)}>ПРИНЯТЬ ОПЕРАЦИЮ</button>
            : pirateContact && operation.state === 'active' ? <div className="operations-pirate-actions">
              <button type="button" className="operations-primary-v2" disabled={!pirateContact.recon.enabled || !onPirateRecon} title={pirateContact.recon.disabledReason ?? ''} onClick={() => onPirateRecon?.(pirateContact)}>РАЗВЕДАТЬ</button>
              <button type="button" className="operations-secondary-v2" disabled={!pirateContact.elimination.enabled || !onPirateAttack} onClick={() => onPirateAttack?.(pirateContact)}>ПОДГОТОВИТЬ ПИРАТСКИЙ РЕЙД</button>
              <button type="button" className="operations-secondary-v2" disabled={!pirateContact.latestReportId || !onPirateReport} onClick={() => pirateContact.latestReportId && onPirateReport?.(pirateContact.latestReportId)}>ОТКРЫТЬ РАЗВЕДОТЧЁТ</button>
              <button type="button" className="operations-secondary-v2" disabled={!onPirateUniverse} onClick={() => onPirateUniverse?.(pirateContact)}>ПОКАЗАТЬ ВО ВСЕЛЕННОЙ</button>
              <button type="button" className="operations-pirate-cancel" onClick={() => onCancel(operation.id)}>Отменить операцию</button>
            </div> : null
          : <>
            {intelZero ? <button type="button" className="operations-primary-v2" onClick={() => onReveal(operation.id)}>ПРОСКАНИРОВАТЬ</button> : null}
            {!intelZero && operation.state === 'available' ? <button type="button" className="operations-primary-v2" onClick={() => onAccept(operation.id)}>ПРИНЯТЬ ОПЕРАЦИЮ</button> : null}
            {operation.state === 'active' ? <button type="button" className="operations-primary-v2" onClick={onOpenFleets}>К ФЛОТАМ</button> : null}
            {operation.state === 'active' ? <button type="button" className="operations-secondary-v2" onClick={() => onCancel(operation.id)}>ОТМЕНИТЬ</button> : null}
          </>}
        </div>
      </footer>
    </aside>
  );
}

export function OperationsView({ state, onAccept, onCancel, onReveal, onOpenFleets, pirateContacts = [], quietPirateSystems = [], nowMs = Date.now(), onPirateAccept, onPirateCancel, onPirateRecon, onPirateAttack, onPirateReport, onPirateUniverse }: OperationsViewProps) {
  const [tab, setTab] = useState<OperationsTab>('available');
  const [selectedId, setSelectedId] = useState<OperationId | null>(null);

  const operationRows = useMemo((): OperationRow[] => {
    // Demo placeholders are not playable pirate targets. Keep them in Test save for
    // backwards compatibility, but render only authoritative live contacts.
    const demoIds = new Set(['op-pirate-patrol-01', 'op-pirate-outpost-01']);
    const normal: OperationRow[] = state.items
      .filter((item) => !demoIds.has(item.id) && !isPirateOperationId(item.id))
      .map((operation) => ({ operation }));
    const acceptedIds = new Set(state.items.filter((item) => isPirateOperationId(item.id) && item.state === 'active').map((item) => item.id));
    const live: OperationRow[] = pirateContacts.map((contact) => ({
      operation: pirateContactOperation(contact, acceptedIds.has(pirateOperationId(contact.contactCycleKey)) ? 'active' : 'available'),
      contact,
    }));
    const liveIds = new Set(live.map((entry) => entry.operation.id));
    const quiet: OperationRow[] = quietPirateSystems.filter((cycle) => !liveIds.has(pirateOperationId(cycle.contactCycleKey)))
      .map((cycle) => ({
        operation: pirateCycleOperation(cycle.contactCycleKey, cycle.coordinate, 'completed'),
        quiet: cycle,
      }));
    const knownIds = new Set([...live, ...quiet].map((entry) => entry.operation.id));
    const expired: OperationRow[] = state.items
      .filter((item) => isPirateOperationId(item.id) && !knownIds.has(item.id))
      .map((item) => ({
        operation: {
          ...item,
          state: 'completed',
          title: 'ПИРАТСКАЯ БАЗА',
          objective: { label: 'Контакт больше не активен' },
          intel: 1,
          threat: null,
          rewardPreview: {},
        },
      }));
    return [...live, ...quiet, ...expired, ...normal];
  }, [state.items, pirateContacts, quietPirateSystems]);

  const visibleRows = useMemo(() => operationRows.filter(({ operation }) => operation.state === tab), [operationRows, tab]);
  const selectedRow = visibleRows.find(({ operation }) => operation.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedRow) return;
    setSelectedId(visibleRows[0]?.operation.id ?? null);
  }, [selectedRow, visibleRows]);

  const chooseTab = (next: OperationsTab) => {
    setTab(next);
    setSelectedId(null);
  };

  const accept = (operationId: OperationId) => {
    const row = operationRows.find(({ operation }) => operation.id === operationId);
    if (row?.contact) onPirateAccept?.(row.contact);
    else onAccept(operationId);
    setTab('active');
    setSelectedId(operationId);
  };

  const cancel = (operationId: OperationId) => {
    const row = operationRows.find(({ operation }) => operation.id === operationId);
    if (row?.contact) onPirateCancel?.(row.contact);
    else onCancel(operationId);
    setTab('available');
    setSelectedId(operationId);
  };

  return (
    <main className="operations-shell-v2">
      <header className="operations-topbar-v2">
        <div className="operations-heading-v2">
          <small>ОПЕРАЦИОННЫЙ ЦЕНТР</small>
          <h1>ОПЕРАЦИИ</h1>
          <p>Действующие PvE-цели в системах твоих колоний.</p>
        </div>
        <nav className="operations-tabs-v2" role="tablist" aria-label="Состояние операций">
          {(Object.keys(TAB_LABELS) as OperationsTab[]).map((entry) => (
            <button key={entry} type="button" role="tab" aria-selected={tab === entry} className={tab === entry ? 'active' : ''} onClick={() => chooseTab(entry)}>
              <span>{TAB_LABELS[entry]}</span><b>{operationRows.filter(({ operation }) => operation.state === entry).length}</b>
            </button>
          ))}
        </nav>
        <div className="operations-slots-v2"><small>ПИРАТСКИЕ БАЗЫ</small><strong>{pirateContacts.length}</strong><span>активны</span></div>
      </header>
      <div className="operations-layout-v2">
        <section className="operations-feed-v2" aria-label={TAB_LABELS[tab]}>
          <header><div><small>КАНАЛ // {TAB_LABELS[tab]}</small><strong>{tab === 'available' ? 'ВХОДЯЩИЕ КОНТАКТЫ' : tab === 'active' ? 'ТЕКУЩИЕ ЗАДАЧИ' : 'АРХИВ ОПЕРАЦИЙ'}</strong></div><span>{visibleRows.length}</span></header>
          <div className="operations-feed-scroll-v2">
            {visibleRows.length ? <div className="operations-feed-list-v2">
              {visibleRows.map((row) => <OperationCard
                key={row.operation.id}
                operation={row.operation}
                contact={row.contact}
                quiet={row.quiet}
                nowMs={nowMs}
                selected={row.operation.id === selectedRow?.operation.id}
                onSelect={() => setSelectedId(row.operation.id)}
              />)}
            </div> : <EmptyState tab={tab} />}
          </div>
        </section>
        <OperationDossier
          operation={selectedRow?.operation ?? null}
          pirateContact={selectedRow?.contact}
          quiet={selectedRow?.quiet}
          nowMs={nowMs}
          onAccept={accept}
          onCancel={cancel}
          onReveal={onReveal}
          onOpenFleets={onOpenFleets}
          onPirateRecon={onPirateRecon}
          onPirateAttack={onPirateAttack}
          onPirateReport={onPirateReport}
          onPirateUniverse={onPirateUniverse}
        />
      </div>
    </main>
  );
}
