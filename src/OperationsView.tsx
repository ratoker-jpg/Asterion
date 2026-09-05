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
import './operations.css';

type OperationsViewProps = {
  state: OperationsState;
  onAccept: (operationId: OperationId) => void;
  onCancel: (operationId: OperationId) => void;
  onReveal: (operationId: OperationId) => void;
  onOpenFleets: () => void;
};

type OperationsTab = Extract<OperationState, 'available' | 'active' | 'completed'>;

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
    ['МЕТАЛЛ', operation.rewardPreview.metal, '◆'],
    ['МИНЕРАЛЫ', operation.rewardPreview.minerals, '◇'],
    ['ГАЗ', operation.rewardPreview.gas, '◈'],
  ].filter((entry): entry is [string, number, string] => typeof entry[1] === 'number');
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
          <i>{glyph}</i>
          {!compact ? <small>{label}</small> : null}
          <strong>{number.format(value)}</strong>
        </span>
      ))}
      {!compact ? operation.rewardPreview.labels?.map((label) => <em key={label}>{label}</em>) : null}
    </div>
  );
}

function TacticalScope({ operation }: { operation: OperationInstance }) {
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

        {isCombat ? (
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
        <span>{unknown ? 'СИГНАТУРА НЕ КЛАССИФИЦИРОВАНА' : isCombat ? 'ТАКТИЧЕСКИЙ КОНТАКТ' : isScience ? 'ПОЛЕ ИСКАЖЕНИЯ' : 'ОБЪЕКТ ОБНАРУЖЕН'}</span>
        <small>{unknown ? 'ОЖИДАНИЕ ГЛУБОКОГО СКАНА' : `INTEL ${operation.intel}/3`}</small>
      </div>
    </div>
  );
}

function OperationCard({ operation, selected, onSelect }: {
  operation: OperationInstance;
  selected: boolean;
  onSelect: () => void;
}) {
  const intelZero = operation.intel === 0;
  const firstReward = rewardEntries(operation)[0];

  return (
    <button
      type="button"
      className={`operation-feed-card-v2 operation-feed-card-v2--${operation.category} ${selected ? 'selected' : ''}`}
      data-threat={operation.threat ?? 'unknown'}
      onClick={onSelect}
    >
      <span className="operation-feed-threat-v2"><b>{threatTier(operation)}</b><small>{intelZero ? 'UNKNOWN' : operation.category === 'combat' ? 'THREAT' : 'RISK'}</small></span>
      <span className="operation-feed-copy-v2">
        <small>{CATEGORY_LABELS[operation.category]}</small>
        <strong>{operation.title}</strong>
        <em>{intelZero ? 'Сигнатура требует классификации' : operation.objective.label}</em>
        <span className="operation-feed-meta-v2">
          <i>{intelZero ? formatLocationClass(operation.location) : formatLocation(operation.location)}</i>
          <IntelPips level={operation.intel} />
          {firstReward ? <b>{firstReward[2]} {number.format(firstReward[1])}</b> : <b>НАГРАДА ?</b>}
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

function OperationDossier({ operation, onAccept, onCancel, onReveal, onOpenFleets }: {
  operation: OperationInstance | null;
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

  const intelZero = operation.intel === 0;
  const modifierLabels = operation.modifiers.map((modifier) => OPERATION_MODIFIER_LABELS[modifier]);

  return (
    <aside className={`operations-dossier-v2 operations-dossier-v2--${operation.category}`} data-threat={operation.threat ?? 'unknown'}>
      <header className="operations-dossier-head-v2">
        <div className="operations-dossier-title-v2">
          <span className="operations-dossier-glyph-v2"><OperationGlyph category={operation.category} /></span>
          <div>
            <small>{CATEGORY_LABELS[operation.category]} · {operation.id.toUpperCase()}</small>
            <h2>{operation.title}</h2>
            <p>{intelZero ? formatLocationClass(operation.location) : formatLocation(operation.location)} <i /> {OPERATION_SOURCE_LABELS[operation.source]}</p>
          </div>
        </div>
        <div className="operations-dossier-threat-v2">
          <small>{operation.category === 'combat' ? 'УРОВЕНЬ УГРОЗЫ' : 'УРОВЕНЬ РИСКА'}</small>
          <strong>{threatTier(operation)}</strong>
          <span>{threatText(operation)}</span>
        </div>
      </header>

      <section className="operations-dossier-hero-v2">
        <TacticalScope operation={operation} />
        <div className="operations-briefing-v2">
          <small>ОПЕРАТИВНАЯ СВОДКА</small>
          <h3>{intelZero ? 'ДАННЫХ НЕДОСТАТОЧНО' : 'КОНТАКТ КЛАССИФИЦИРОВАН'}</h3>
          <p>{intelZero ? 'Сенсоры фиксируют нестабильный источник неизвестного происхождения. До глубокого сканирования тип объекта, точная угроза и возможная награда скрыты.' : operation.briefing}</p>
          <div className="operations-intel-line-v2">
            <span>РАЗВЕДДАННЫЕ</span>
            <IntelPips level={operation.intel} />
            <b>{operation.intel} / 3</b>
          </div>
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
            <section className="operations-conditions-v2">
              <small>УСЛОВИЯ КОНТАКТА</small>
              <div>
                {modifierLabels.length ? modifierLabels.map((label) => <span key={label}>⚠ {label}</span>) : <span>Без особых условий</span>}
              </div>
              <p>Показаны только подтверждённые данные текущего уровня разведки.</p>
            </section>

            <section className="operations-rewards-panel-v2">
              <small>НАГРАДА · ПРЕДПРОСМОТР</small>
              <RewardPreview operation={operation} />
              <p>Начисление награды появится вместе с реальным выполнением операций.</p>
            </section>
          </div>
        </>
      )}

      <footer className="operations-command-v2">
        <div>
          <small>СТАТУС</small>
          <strong>{operation.state === 'active' ? 'ОПЕРАЦИЯ ПРИНЯТА' : operation.state === 'completed' ? 'ОПЕРАЦИЯ ЗАВЕРШЕНА' : intelZero ? 'ТРЕБУЕТСЯ СКАНИРОВАНИЕ' : 'ГОТОВА К ПРИНЯТИЮ'}</strong>
          <span>{operation.state === 'active' ? 'Подготовьте флот в разделе «Флоты».' : intelZero ? 'Классифицируйте контакт перед принятием решения.' : 'Принятие фиксирует операцию как активную.'}</span>
        </div>
        <div className="operations-command-actions-v2">
          {intelZero ? <button type="button" className="operations-primary-v2" onClick={() => onReveal(operation.id)}>ПРОСКАНИРОВАТЬ</button> : null}
          {!intelZero && operation.state === 'available' ? <button type="button" className="operations-primary-v2" onClick={() => onAccept(operation.id)}>ПРИНЯТЬ ОПЕРАЦИЮ</button> : null}
          {operation.state === 'active' ? <button type="button" className="operations-primary-v2" onClick={onOpenFleets}>К ФЛОТАМ</button> : null}
          {operation.state === 'active' ? <button type="button" className="operations-secondary-v2" onClick={() => onCancel(operation.id)}>ОТМЕНИТЬ</button> : null}
        </div>
      </footer>
    </aside>
  );
}

export function OperationsView({ state, onAccept, onCancel, onReveal, onOpenFleets }: OperationsViewProps) {
  const [tab, setTab] = useState<OperationsTab>('available');
  const [selectedId, setSelectedId] = useState<OperationId | null>(() => state.items.find((item) => item.state === 'available')?.id ?? null);

  const visibleItems = useMemo(() => state.items.filter((item) => item.state === tab), [state.items, tab]);
  const selected = state.items.find((item) => item.id === selectedId && item.state === tab) ?? null;

  useEffect(() => {
    if (selected) return;
    setSelectedId(visibleItems[0]?.id ?? null);
  }, [selected, visibleItems]);

  const chooseTab = (next: OperationsTab) => {
    setTab(next);
    setSelectedId(state.items.find((item) => item.state === next)?.id ?? null);
  };

  const accept = (operationId: OperationId) => {
    onAccept(operationId);
    setTab('active');
    setSelectedId(operationId);
  };

  const cancel = (operationId: OperationId) => {
    onCancel(operationId);
    setTab('available');
    setSelectedId(operationId);
  };

  return (
    <main className="operations-shell-v2">
      <header className="operations-topbar-v2">
        <div className="operations-heading-v2">
          <small>ОПЕРАЦИОННЫЙ ЦЕНТР</small>
          <h1>ОПЕРАЦИИ</h1>
          <p>Временные PvE-контакты, сигналы и разведанные цели.</p>
        </div>

        <nav className="operations-tabs-v2" role="tablist" aria-label="Состояние операций">
          {(Object.keys(TAB_LABELS) as OperationsTab[]).map((entry) => (
            <button key={entry} type="button" role="tab" aria-selected={tab === entry} className={tab === entry ? 'active' : ''} onClick={() => chooseTab(entry)}>
              <span>{TAB_LABELS[entry]}</span><b>{state.items.filter((item) => item.state === entry).length}</b>
            </button>
          ))}
        </nav>

        <div className="operations-slots-v2"><small>КОНТАКТЫ</small><strong>{state.items.filter((item) => item.state !== 'completed').length}</strong><span>/ 4</span></div>
      </header>

      <div className="operations-layout-v2">
        <section className="operations-feed-v2" aria-label={TAB_LABELS[tab]}>
          <header><div><small>КАНАЛ // {TAB_LABELS[tab]}</small><strong>{tab === 'available' ? 'ВХОДЯЩИЕ КОНТАКТЫ' : tab === 'active' ? 'ТЕКУЩИЕ ЗАДАЧИ' : 'АРХИВ ОПЕРАЦИЙ'}</strong></div><span>{visibleItems.length}</span></header>
          {visibleItems.length ? (
            <div className="operations-feed-list-v2">
              {visibleItems.map((operation) => <OperationCard key={operation.id} operation={operation} selected={operation.id === selected?.id} onSelect={() => setSelectedId(operation.id)} />)}
            </div>
          ) : <EmptyState tab={tab} />}
        </section>

        <OperationDossier operation={selected} onAccept={accept} onCancel={cancel} onReveal={onReveal} onOpenFleets={onOpenFleets} />
      </div>
    </main>
  );
}
