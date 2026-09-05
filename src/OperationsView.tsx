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
  combat: 'БОЕВАЯ',
  discovery: 'СИГНАЛ',
  exploration: 'ИССЛЕДОВАНИЕ',
  science: 'НАУКА',
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

function OperationGlyph({ category }: { category: OperationCategory }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.55, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  if (category === 'combat') {
    return <svg viewBox="0 0 40 40" aria-hidden="true"><circle {...common} cx="20" cy="20" r="13"/><circle {...common} cx="20" cy="20" r="5"/><path {...common} d="M20 3v8M20 29v8M3 20h8M29 20h8"/></svg>;
  }
  if (category === 'science') {
    return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="M16 5h8M17 5v10L8 32c-1 2 .2 3 3 3h18c2.8 0 4-1 3-3l-9-17V5"/><path {...common} d="M12 27h16M15 22h10"/></svg>;
  }
  if (category === 'exploration') {
    return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="m20 5 8 25-8-6-8 6 8-25Z"/><circle {...common} cx="20" cy="19" r="3"/><path {...common} d="M8 10 4 6M32 10l4-4"/></svg>;
  }
  return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="M7 30c4-8 10-12 18-12M11 34c3-6 7-9 14-9M25 18c4 0 7 3 7 7"/><circle {...common} cx="27" cy="12" r="4"/><path {...common} d="M27 4v4M35 12h-4"/></svg>;
}

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

function threatLabel(operation: OperationInstance) {
  if (operation.threat) return `УГРОЗА ${ROMAN_THREAT[operation.threat]}`;
  if (operation.threatRange) {
    return `УГРОЗА НЕИЗВЕСТНА · ${ROMAN_THREAT[operation.threatRange[0]]}–${ROMAN_THREAT[operation.threatRange[1]]}`;
  }
  return 'УГРОЗА НЕИЗВЕСТНА';
}

function RewardPreview({ operation }: { operation: OperationInstance }) {
  const entries = [
    ['МЕТАЛЛ', operation.rewardPreview.metal],
    ['МИНЕРАЛЫ', operation.rewardPreview.minerals],
    ['ГАЗ', operation.rewardPreview.gas],
  ].filter((entry): entry is [string, number] => typeof entry[1] === 'number');

  if (!entries.length && !operation.rewardPreview.labels?.length) {
    return <span className="operations-unknown-value">НЕИЗВЕСТНО</span>;
  }

  return (
    <div className="operations-reward-list-v1">
      {entries.map(([label, value]) => <span key={label}><small>{label}</small><strong>{number.format(value)}</strong></span>)}
      {operation.rewardPreview.labels?.map((label) => <span key={label} className="operations-reward-note-v1"><small>ДОПОЛНИТЕЛЬНО</small><strong>{label}</strong></span>)}
    </div>
  );
}

function OperationCard({ operation, selected, onSelect, onReveal }: {
  operation: OperationInstance;
  selected: boolean;
  onSelect: () => void;
  onReveal: () => void;
}) {
  const canShowIntel = operation.intel >= 2;
  return (
    <article className={`operation-card-v1 operation-card-v1--${operation.category} ${selected ? 'selected' : ''}`} data-threat={operation.threat ?? 'unknown'}>
      <div className="operation-card-scanline-v1" />
      <header>
        <span className="operation-card-icon-v1"><OperationGlyph category={operation.category} /></span>
        <div>
          <small>{CATEGORY_LABELS[operation.category]}</small>
          <h3>{operation.title}</h3>
        </div>
        <b>{threatLabel(operation)}</b>
      </header>

      <div className="operation-card-location-v1">{operation.intel === 0 ? formatLocationClass(operation.location) : formatLocation(operation.location)}</div>
      <div className="operation-card-meta-v1">
        <span><small>РАЗВЕДДАННЫЕ</small><strong>{operation.intel} / 3</strong></span>
        <span><small>СОСТОЯНИЕ</small><strong>{operation.state === 'available' ? 'ДОСТУПНА' : operation.state === 'active' ? 'АКТИВНА' : 'ЗАВЕРШЕНА'}</strong></span>
      </div>

      {canShowIntel ? (
        <div className="operation-card-summary-v1">
          <span><small>ЦЕЛЬ</small><strong>{operation.objective.label}</strong></span>
          <span><small>УСЛОВИЕ</small><strong>{operation.modifiers[0] ? OPERATION_MODIFIER_LABELS[operation.modifiers[0]] : 'Нет'}</strong></span>
        </div>
      ) : (
        <div className="operation-card-summary-v1 operation-card-summary-v1--unknown">
          <span><small>КОНТАКТ</small><strong>Требуется дополнительное сканирование</strong></span>
        </div>
      )}

      <footer>
        {operation.archetype === 'unknown_signal' && operation.intel === 0 ? (
          <button type="button" className="operation-card-action-v1 operation-card-action-v1--primary" onClick={onReveal}>ПРОСКАНИРОВАТЬ</button>
        ) : null}
        <button type="button" className="operation-card-action-v1" onClick={onSelect}>ПОДРОБНЕЕ</button>
      </footer>
    </article>
  );
}

function EmptyState({ tab }: { tab: OperationsTab }) {
  const copy = tab === 'active'
    ? ['АКТИВНЫХ ОПЕРАЦИЙ НЕТ', 'Примите одну из доступных операций.']
    : tab === 'completed'
      ? ['ЗАВЕРШЁННЫХ ОПЕРАЦИЙ ПОКА НЕТ', 'История появится после подключения выполнения операций.']
      : ['ДОСТУПНЫХ ОПЕРАЦИЙ НЕТ', 'Новых операций сейчас нет.'];

  return (
    <div className="operations-empty-v1">
      <span>◇</span>
      <strong>{copy[0]}</strong>
      <p>{copy[1]}</p>
    </div>
  );
}

function OperationDetail({ operation, onAccept, onCancel, onReveal, onOpenFleets }: {
  operation: OperationInstance | null;
  onAccept: (id: OperationId) => void;
  onCancel: (id: OperationId) => void;
  onReveal: (id: OperationId) => void;
  onOpenFleets: () => void;
}) {
  if (!operation) {
    return (
      <aside className="operations-detail-v1 operations-detail-v1--empty">
        <span>SELECT // OPERATION</span>
        <strong>ВЫБЕРИТЕ ОПЕРАЦИЮ</strong>
        <p>Откройте карточку, чтобы увидеть доступные разведданные и действия.</p>
      </aside>
    );
  }

  const intelZero = operation.intel === 0;
  return (
    <aside className={`operations-detail-v1 operations-detail-v1--${operation.category}`} data-threat={operation.threat ?? 'unknown'}>
      <header className="operations-detail-head-v1">
        <span className="operations-detail-icon-v1"><OperationGlyph category={operation.category} /></span>
        <div>
          <small>{CATEGORY_LABELS[operation.category]} · {operation.id.toUpperCase()}</small>
          <h2>{operation.title}</h2>
          <p>{threatLabel(operation)}</p>
        </div>
      </header>

      {intelZero ? (
        <div className="operations-intel-zero-v1">
          <section><small>ИСТОЧНИК</small><strong>{OPERATION_SOURCE_LABELS[operation.source]}</strong></section>
          <section><small>КЛАСС ЛОКАЦИИ</small><strong>{formatLocationClass(operation.location)}</strong></section>
          <section><small>РАЗВЕДДАННЫЕ</small><strong>0 / 3</strong></section>
          <section><small>УГРОЗА</small><strong>{operation.threatRange ? `НЕИЗВЕСТНО · ДИАПАЗОН ${ROMAN_THREAT[operation.threatRange[0]]}–${ROMAN_THREAT[operation.threatRange[1]]}` : 'НЕИЗВЕСТНО'}</strong></section>
          <button type="button" className="operations-primary-v1" onClick={() => onReveal(operation.id)}>ПРОСКАНИРОВАТЬ</button>
        </div>
      ) : (
        <>
          <div className="operations-detail-grid-v1">
            <section><small>ИСТОЧНИК</small><strong>{OPERATION_SOURCE_LABELS[operation.source]}</strong></section>
            <section><small>ЛОКАЦИЯ</small><strong>{formatLocation(operation.location)}</strong></section>
            <section><small>РАЗВЕДДАННЫЕ</small><strong>{operation.intel} / 3</strong></section>
            <section><small>КАТЕГОРИЯ</small><strong>{CATEGORY_LABELS[operation.category]}</strong></section>
          </div>

          <section className="operations-detail-section-v1">
            <small>СВОДКА</small>
            <p>{operation.briefing}</p>
          </section>
          <section className="operations-detail-section-v1">
            <small>ОСНОВНАЯ ЦЕЛЬ</small>
            <strong>{operation.objective.label}</strong>
          </section>
          <section className="operations-detail-section-v1">
            <small>ОСОБЫЕ УСЛОВИЯ</small>
            <div className="operations-modifiers-v1">
              {operation.modifiers.length ? operation.modifiers.map((modifier) => <span key={modifier}>{OPERATION_MODIFIER_LABELS[modifier]}</span>) : <span>Нет</span>}
            </div>
          </section>
          <section className="operations-detail-section-v1 operations-detail-reward-v1">
            <small>НАГРАДА · ПРЕДПРОСМОТР</small>
            <RewardPreview operation={operation} />
            <p>Награда не начисляется до подключения выполнения операций.</p>
          </section>

          {operation.state === 'active' ? (
            <div className="operations-active-callout-v1">
              <strong>ОПЕРАЦИЯ ПРИНЯТА</strong>
              <p>Подготовьте флот для выполнения.</p>
            </div>
          ) : null}

          <div className="operations-detail-actions-v1">
            {operation.state === 'available' ? <button type="button" className="operations-primary-v1" onClick={() => onAccept(operation.id)}>ПРИНЯТЬ ОПЕРАЦИЮ</button> : null}
            {operation.state === 'active' ? <button type="button" className="operations-primary-v1" onClick={onOpenFleets}>К ФЛОТАМ</button> : null}
            {operation.state === 'active' ? <button type="button" className="operations-secondary-v1 operations-secondary-v1--danger" onClick={() => onCancel(operation.id)}>ОТМЕНИТЬ ОПЕРАЦИЮ</button> : null}
          </div>
        </>
      )}
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
    <main className="operations-shell-v1">
      <header className="operations-page-head-v1">
        <div>
          <small>ASTERION // PVE OPERATIONS</small>
          <h1>ОПЕРАЦИИ</h1>
          <p>Обнаружение, разведка и подготовка временных PvE-сценариев.</p>
        </div>
        <div className="operations-slot-readout-v1"><small>СЛОТЫ ОПЕРАЦИЙ</small><strong>{state.items.filter((item) => item.state !== 'completed').length} / 4</strong></div>
      </header>

      <nav className="operations-tabs-v1" role="tablist" aria-label="Состояние операций">
        {(Object.keys(TAB_LABELS) as OperationsTab[]).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className={tab === entry ? 'active' : ''}
            onClick={() => chooseTab(entry)}
          >
            <span>{TAB_LABELS[entry]}</span>
            <b>{state.items.filter((item) => item.state === entry).length}</b>
          </button>
        ))}
      </nav>

      <div className="operations-layout-v1">
        <section className="operations-board-v1" aria-label={TAB_LABELS[tab]}>
          <div className="operations-board-title-v1"><strong>{TAB_LABELS[tab]}</strong><small>{visibleItems.length} ОБЪЕКТА</small></div>
          {visibleItems.length ? (
            <div className="operations-card-grid-v1">
              {visibleItems.map((operation) => (
                <OperationCard
                  key={operation.id}
                  operation={operation}
                  selected={operation.id === selected?.id}
                  onSelect={() => setSelectedId(operation.id)}
                  onReveal={() => { onReveal(operation.id); setSelectedId(operation.id); }}
                />
              ))}
            </div>
          ) : <EmptyState tab={tab} />}
        </section>

        <OperationDetail operation={selected} onAccept={accept} onCancel={cancel} onReveal={onReveal} onOpenFleets={onOpenFleets} />
      </div>
    </main>
  );
}
