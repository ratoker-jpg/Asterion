import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { GameSelect } from '../GameSelect.tsx';
import { ResourceIcon } from '../resources/ResourceIcon.tsx';
import { DEBRIS_FINDER_ICON } from '../sun-raid/sun-raid-assets.ts';
import { formatAmount } from './object-card-model.ts';
import './object-card.css';
import './asteroid-batch-dialog.css';

export type AsteroidBatchScanState = 'idle' | 'pending' | 'ready' | 'partial' | 'empty';
export type AsteroidBatchFlightState = 'ready' | 'active' | 'blocked';

export interface AsteroidBatchSource {
  id: string;
  name: string;
  coordinate: string;
  availableCount: number;
}

export interface AsteroidBatchTarget {
  id: string;
  name: string;
  coordinate: string;
  debrisAvailable: boolean;
  quantity: number;
  maxQuantity: number;
  etaLabel: string | null;
  flightState: AsteroidBatchFlightState;
  flightReason?: string;
  assignedSourceName?: string;
}

export interface AsteroidBatchDialogProps {
  galaxy: number;
  galaxyCount: number;
  range: { from: number; to: number; min: number; max: number };
  availableTotal: number;
  sources: readonly AsteroidBatchSource[];
  targets: readonly AsteroidBatchTarget[];
  equalQuantity: number;
  equalQuantityMax?: number;
  scanState: AsteroidBatchScanState;
  validationMessage?: string;
  statusMessage?: string;
  isSending?: boolean;
  sendDisabledReason?: string;
  onGalaxyChange: (galaxy: number) => void;
  onRangeChange: (range: { from: number; to: number }) => void;
  onEqualQuantityChange: (quantity: number) => void;
  onAutoDistribute: () => void;
  onQuantityChange: (targetId: string, quantity: number) => void;
  onScan: () => void;
  onSend: () => void;
  onClose: () => void;
}

const pad2 = (value: number) => String(value).padStart(2, '0');
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])';

function rangeError(fromText: string, toText: string, min: number, max: number): string | null {
  const from = Number(fromText);
  const to = Number(toText);
  if (!fromText || !toText || !Number.isInteger(from) || !Number.isInteger(to)) return 'Укажите целые номера систем.';
  if (from < min || from > max || to < min || to > max) return `Системы должны быть в диапазоне ${min}–${max}.`;
  if (from > to) return 'Начальная система должна быть не дальше конечной.';
  return null;
}

function visibleFocusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => (
    element.getAttribute('aria-hidden') !== 'true'
    && !element.closest('[hidden]')
    && getComputedStyle(element).visibility !== 'hidden'
  ));
}

export function AsteroidBatchDialog({
  galaxy,
  galaxyCount,
  range,
  availableTotal,
  sources,
  targets,
  equalQuantity,
  equalQuantityMax,
  scanState,
  validationMessage,
  statusMessage,
  isSending = false,
  sendDisabledReason,
  onGalaxyChange,
  onRangeChange,
  onEqualQuantityChange,
  onAutoDistribute,
  onQuantityChange,
  onScan,
  onSend,
  onClose,
}: AsteroidBatchDialogProps) {
  const titleId = useId();
  const rangeHintId = useId();
  const rangeErrorId = useId();
  const distributionHintId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const [fromText, setFromText] = useState(String(range.from));
  const [toText, setToText] = useState(String(range.to));

  onCloseRef.current = onClose;

  useEffect(() => {
    setFromText(String(range.from));
    setToText(String(range.to));
  }, [range.from, range.to]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // GameSelect owns Escape while its portal listbox is open.
        if (document.querySelector('[data-qa-game-select-list]')) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const stops = visibleFocusables(dialogRef.current);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current.focus();
      } else if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const rangeProblem = rangeError(fromText, toText, range.min, range.max);
  const hasResults = scanState === 'ready' || scanState === 'partial';
  const assignableTargets = targets.filter((target) => target.flightState === 'ready');
  const quantityFor = (target: AsteroidBatchTarget) => Math.max(0, Math.floor(target.quantity));
  const selectedTargets = assignableTargets.filter((target) => {
    const quantity = quantityFor(target);
    return quantity > 0 && quantity <= Math.max(0, Math.floor(target.maxQuantity));
  });
  const scanValidation = rangeProblem ?? validationMessage;
  const rangeDescription = scanValidation ? `${rangeHintId} ${rangeErrorId}` : rangeHintId;
  const hasOverCapQuantity = assignableTargets.some((target) => quantityFor(target) > Math.max(0, Math.floor(target.maxQuantity)));
  const quantityValidation = hasOverCapQuantity ? 'Уменьшите количество до доступного лимита или установите 0.' : undefined;
  const validation = scanValidation ?? quantityValidation;
  const hasScanData = hasResults || (scanState === 'empty' && !validationMessage);
  const canSend = hasResults && selectedTargets.length > 0 && !isSending && !sendDisabledReason && !validation;
  const controlsDisabled = scanState === 'pending' || isSending;
  const galaxyOptions = Array.from({ length: Math.max(0, galaxyCount) }, (_, index) => ({
    value: String(index + 1),
    label: `Галактика ${pad2(index + 1)}`,
  }));

  const updateRange = (which: 'from' | 'to', value: string) => {
    if (which === 'from') setFromText(value);
    else setToText(value);

    const parsed = Number(value);
    if (!value || !Number.isInteger(parsed) || parsed < range.min || parsed > range.max) return;
    onRangeChange({ from: which === 'from' ? parsed : range.from, to: which === 'to' ? parsed : range.to });
  };

  const updateQuantity = (target: AsteroidBatchTarget, event: ChangeEvent<HTMLInputElement>) => {
    const entered = event.currentTarget.valueAsNumber;
    if (!Number.isFinite(entered)) return;
    const cap = Math.max(0, Math.floor(target.maxQuantity));
    onQuantityChange(target.id, Math.min(cap, Math.max(0, Math.floor(entered))));
  };

  const submit = () => {
    if (hasResults) {
      if (canSend) onSend();
    } else if (!scanValidation && scanState !== 'pending') onScan();
  };

  return (
    <div className="universe-modal-backdrop universe-object-backdrop abatch-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        ref={dialogRef}
        className={`universe-object-card abatch${hasResults ? ' abatch--results' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-qa-asteroid-batch-dialog={scanState}
      >
        <button ref={closeRef} type="button" className="oc-close" data-asterion-close aria-label="Закрыть" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>

        <header className="abatch__head">
          <span className="abatch__icon"><img src={DEBRIS_FINDER_ICON} alt="" draggable={false} /></span>
          <h2 id={titleId}>Сбор газа с астероидов</h2>
        </header>

        <div className="abatch__body">
          <div className="abatch__config">
            <div className="abatch__controls">
              <div className="abatch__field abatch__field--galaxy">
                <span>Галактика</span>
                <GameSelect
                  className="abatch__galaxy"
                  label="Галактика для поиска астероидов"
                  value={String(galaxy)}
                  options={galaxyOptions}
                  placeholder="Выберите галактику"
                  disabled={controlsDisabled}
                  onChange={(next) => onGalaxyChange(Number(next))}
                  selectProps={{ 'data-qa-asteroid-batch-galaxy': true }}
                />
              </div>
              <fieldset className="abatch__range">
                <legend className="abatch__sr-only">Диапазон систем</legend>
                <label className="abatch__field">
                  <span>Система от</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    required
                    min={range.min}
                    max={range.max}
                    step={1}
                    value={fromText}
                    disabled={controlsDisabled}
                    aria-invalid={Boolean(rangeProblem)}
                    aria-describedby={rangeDescription}
                    data-qa-asteroid-batch-range-from
                    onChange={(event) => updateRange('from', event.currentTarget.value)}
                  />
                </label>
                <label className="abatch__field">
                  <span>Система до</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    required
                    min={range.min}
                    max={range.max}
                    step={1}
                    value={toText}
                    disabled={controlsDisabled}
                    aria-invalid={Boolean(rangeProblem)}
                    aria-describedby={rangeDescription}
                    data-qa-asteroid-batch-range-to
                    onChange={(event) => updateRange('to', event.currentTarget.value)}
                  />
                </label>
              </fieldset>
              {hasResults ? (
                <button type="button" className="oc-btn abatch__rescan" disabled={Boolean(scanValidation) || isSending} data-qa-asteroid-batch-scan onClick={onScan}>
                  Сканировать снова
                </button>
              ) : null}
            </div>
            <p className={hasResults ? 'abatch__sr-only' : 'abatch__range-note'} id={rangeHintId} data-qa-asteroid-batch-idle={scanState === 'idle' ? true : undefined}>Обе границы диапазона включены.</p>
            {scanValidation ? <p id={rangeErrorId} className="abatch__validation" role="alert">{scanValidation}</p> : null}
          </div>

          {hasScanData ? (
            <div className="abatch__fleet">
              <p className="abatch__total" data-qa-asteroid-batch-total={availableTotal}>
                <span>Свободных переработчиков</span>
                <b>{formatAmount(availableTotal)}</b>
              </p>
              {sources.length ? (
                <details className="abatch__sources" data-qa-asteroid-batch-sources>
                  <summary>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
                    Источники рейсов <b>{sources.length}</b>
                  </summary>
                  <ul className="abatch__source-list">
                    {sources.map((source) => (
                      <li key={source.id} data-qa-asteroid-batch-source={source.id}>
                        <span><b>{source.name}</b><small>{source.coordinate}</small></span>
                        <span>{formatAmount(source.availableCount)} переработчиков</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : <p className="abatch__source-empty" data-qa-asteroid-batch-sources>Нет доступных источников рейсов.</p>}
            </div>
          ) : null}

          {hasResults ? (
            <section className="abatch__results" aria-label="Результаты сканирования">
              <div className="abatch__results-head">
                <h3>Астероиды <b>{formatAmount(targets.length)}</b></h3>
                {scanState === 'partial' ? <p className="abatch__status is-partial" role="status">{statusMessage ?? 'Сканирование завершено частично.'}</p> : null}
              </div>
              <div className="abatch__distribution">
                <label className="abatch__field abatch__equal-field">
                  <span>Переработчиков на цель</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={equalQuantityMax}
                    step={1}
                    value={equalQuantity}
                    aria-describedby={distributionHintId}
                    disabled={isSending}
                    data-qa-asteroid-batch-equal
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(value)) onEqualQuantityChange(Math.min(equalQuantityMax ?? Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value))));
                    }}
                  />
                </label>
                <button type="button" className="oc-btn abatch__distribute" disabled={isSending || assignableTargets.length === 0} data-qa-asteroid-batch-distribute onClick={onAutoDistribute}>Распределить</button>
                <small id={distributionHintId}>0 исключает цель.</small>
              </div>
              <div className="abatch__columns" aria-hidden="true">
                <span>Астероид</span><span>Обломки</span><span>Полёт</span><span>Источник</span><span>Переработчики</span>
              </div>
              <ul className="abatch__list" data-qa-asteroid-batch-results>
                {targets.map((target) => {
                  const blocked = target.flightState !== 'ready';
                  const cap = Math.max(0, Math.floor(target.maxQuantity));
                  const quantity = Math.max(0, Math.floor(target.quantity));
                  const quantityOverCap = target.flightState === 'ready' && quantity > cap;
                  const manualRefusal = target.flightState === 'ready' && Boolean(target.flightReason);
                  const flightMessage = target.flightState === 'active'
                    ? 'Рейс уже в пути'
                    : target.flightState === 'blocked'
                      ? target.flightReason ?? 'Рейс недоступен'
                      : manualRefusal
                        ? `Отказ отправки: ${target.flightReason}`
                        : undefined;
                  return (
                    <li
                      key={target.id}
                      className={[quantity > 0 && !blocked && !quantityOverCap ? 'is-included' : '', quantityOverCap ? 'is-over-cap' : ''].filter(Boolean).join(' ')}
                      data-qa-asteroid-batch-row={target.id}
                      data-qa-asteroid-batch-active={target.flightState === 'active' ? target.id : undefined}
                      data-qa-asteroid-batch-flight={target.flightState}
                      data-qa-asteroid-batch-refused={manualRefusal ? target.id : undefined}
                      data-qa-asteroid-batch-selected={quantity > 0 && !blocked && !quantityOverCap ? 'yes' : 'no'}
                      data-qa-asteroid-batch-over-cap={quantityOverCap ? target.id : undefined}
                    >
                      <span className="abatch__target-main">
                        <b>{target.name}</b>
                        <small>{target.coordinate}</small>
                      </span>
                      <span className={`abatch__debris-state${target.debrisAvailable ? ' has-debris' : ' no-debris'}`} data-qa-asteroid-batch-debris={target.debrisAvailable ? 'yes' : 'no'}>
                        {target.debrisAvailable ? <><ResourceIcon kind="debris" />Есть</> : 'Нет'}
                      </span>
                      <span className="abatch__flight">
                        {target.etaLabel || !flightMessage ? <span className="abatch__eta">{target.etaLabel ?? '—'}</span> : null}
                        {flightMessage ? <small id={`abatch-flight-${target.id}`}>{flightMessage}</small> : null}
                      </span>
                      <span className="abatch__source-name" title={target.assignedSourceName}>{target.assignedSourceName ?? '—'}</span>
                      <label className="abatch__quantity-field">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={cap}
                          step={1}
                          value={quantity}
                          aria-label={`Переработчики для астероида ${target.name}, ${target.coordinate}`}
                          aria-invalid={quantityOverCap}
                          aria-describedby={[
                            flightMessage ? `abatch-flight-${target.id}` : null,
                            quantityOverCap ? `abatch-quantity-limit-${target.id}` : null,
                          ].filter(Boolean).join(' ') || undefined}
                          disabled={blocked || isSending}
                          data-qa-asteroid-batch-quantity={target.id}
                          onChange={(event) => updateQuantity(target, event)}
                        />
                        {quantityOverCap ? <small className="abatch__quantity-warning" id={`abatch-quantity-limit-${target.id}`}>Лимит: {formatAmount(cap)}</small> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : scanState === 'pending' ? (
            <div className="abatch__state is-pending" role="status" data-qa-asteroid-batch-pending>
              <span className="abatch__spinner" aria-hidden="true" />
              <p>Сканируем астероиды в выбранном диапазоне…</p>
            </div>
          ) : scanState === 'empty' && !validationMessage ? (
            <div className="abatch__state" data-qa-asteroid-batch-empty>
              <p>В этом диапазоне нет астероидов с доступным газом.</p>
              <small>Измените диапазон или выберите другую галактику.</small>
            </div>
          ) : null}
        </div>

        <footer className="abatch__footer">
          <div className="abatch__footer-context">
            {quantityValidation && !scanValidation ? <p className="abatch__validation" role="alert">{quantityValidation}</p> : null}
            {hasResults && !canSend && !validation && !isSending ? <p className="abatch__status" data-qa-asteroid-batch-send-reason>{sendDisabledReason ?? 'Укажите количество хотя бы для одной доступной цели.'}</p> : null}
            {isSending ? <p className="abatch__status" role="status">Отправляем рейсы…</p> : null}
            {canSend ? <p className="abatch__status">Выбрано рейсов: <b>{formatAmount(selectedTargets.length)}</b></p> : null}
          </div>
          <button
            type="button"
            className="oc-btn primary abatch__primary"
            disabled={hasResults ? !canSend : Boolean(scanValidation) || scanState === 'pending'}
            data-qa-asteroid-batch-scan={hasResults ? undefined : true}
            data-qa-asteroid-batch-send={hasResults ? true : undefined}
            onClick={submit}
          >
            {hasResults ? (isSending ? 'Отправка…' : 'Отправить выбранные рейсы') : scanState === 'empty' ? 'Сканировать снова' : scanState === 'pending' ? 'Сканирование…' : 'Сканировать астероиды'}
          </button>
        </footer>
      </section>
    </div>
  );
}
