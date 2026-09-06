import { useEffect, useMemo, useState } from 'react';
import { getBuildingDefinition } from './domain/buildings/resource-zone.ts';
import {
  TRADE_REFILL_INTERVAL_MS,
  TRADE_RESOURCES,
  TRADE_TARGET_RESOURCES,
  getTradeAmountLimit,
  getTradeMaxAmount,
  getTradeReceivedAmount,
  getTradeRefillInfo,
  validateTrade,
  type TradeExecution,
  type TradeRequest,
  type TradeResource,
  type TradeState,
  type TradeTargetResource,
  type TradeWallet,
} from './domain/buildings/trade.ts';
import './trade-center.css';

const SOURCE_LABELS: Record<TradeResource, string> = {
  metal: 'Металл',
  minerals: 'Минералы',
  gas: 'Газ',
  debris: 'Обломки',
};

const TARGET_LABELS: Record<TradeTargetResource, string> = {
  metal: 'Металл',
  minerals: 'Минералы',
  gas: 'Газ',
};

const SHORT_LABELS: Record<TradeTargetResource, string> = {
  metal: 'металла',
  minerals: 'минералов',
  gas: 'газа',
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.max(0, Math.floor(value)));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function ResourceGlyph({ resource }: { resource: TradeResource }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (resource === 'metal') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 7 12 3l8 4-8 4-8-4Z"/><path {...common} d="m4 7 8 4v10l-8-4V7Zm16 0-8 4v10l8-4V7Z"/></svg>;
  if (resource === 'minerals') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 2 7 7-7 13L5 9l7-7Z"/><path {...common} d="M5 9h14M12 2v20"/></svg>;
  if (resource === 'gas') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M12 3c4 4.7 6 7.6 6 11a6 6 0 1 1-12 0c0-3.4 2-6.3 6-11Z"/><circle {...common} cx="10" cy="13" r="1.8"/><circle {...common} cx="14.5" cy="15.5" r="1.2"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m5 6 4-3 3 3 4-2 3 4-2 4 2 4-4 4-4-2-4 2-3-4 2-4-2-3 3-3Z"/><path {...common} d="m8 9 3 2 4-2 2 3-3 4-5-1-1-6Z"/></svg>;
}

type TradeCenterViewProps = {
  planetName: string;
  buildingLevel: number;
  trade: TradeState;
  wallet: TradeWallet;
  resourceRatingPoints: number;
  now: number;
  onTrade: (request: TradeRequest) => TradeExecution;
  onBack: () => void;
};

export function TradeCenterView({
  planetName,
  buildingLevel,
  trade,
  wallet,
  resourceRatingPoints,
  now,
  onTrade,
  onBack,
}: TradeCenterViewProps) {
  const building = getBuildingDefinition('trade-center');
  const [source, setSource] = useState<TradeResource>('metal');
  const [target, setTarget] = useState<TradeTargetResource>('minerals');
  const [amount, setAmount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const refill = useMemo(() => getTradeRefillInfo(trade, buildingLevel, now), [trade, buildingLevel, now]);
  const amountLimit = useMemo(() => getTradeAmountLimit(resourceRatingPoints), [resourceRatingPoints]);
  const maxAmount = useMemo(() => getTradeMaxAmount(wallet, source, resourceRatingPoints), [wallet, source, resourceRatingPoints]);
  const received = useMemo(() => getTradeReceivedAmount(source, amount), [source, amount]);
  const validation = useMemo(() => validateTrade(
    { wallet, trade },
    buildingLevel,
    resourceRatingPoints,
    { source, target, amount },
    now,
  ), [wallet, trade, buildingLevel, resourceRatingPoints, source, target, amount, now]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectSource = (next: TradeResource) => {
    if (wallet[next] <= 0) return;
    setSource(next);
    setAmount(0);
  };

  const selectTarget = (next: TradeTargetResource) => {
    if (source !== 'debris' && next === source) return;
    setTarget(next);
  };

  const updateAmount = (next: number) => {
    if (!Number.isFinite(next)) {
      setAmount(0);
      return;
    }
    setAmount(Math.max(0, Math.floor(next)));
  };

  const adjustAmount = (delta: number) => {
    updateAmount(Math.min(maxAmount, Math.max(0, amount + delta)));
  };

  const submit = () => {
    const result = onTrade({ source, target, amount });
    if (!result.ok) {
      setToast(result.reason ?? 'Обмен недоступен');
      return;
    }
    setAmount(0);
    setToast(`Обмен выполнен · Получено ${formatNumber(result.received)} ${SHORT_LABELS[target]}`);
  };

  return (
    <main className="trade-center-view" data-qa-trade-center>
      <aside className="trade-info-panel">
        <div className="trade-info-art"><img src={building.art} alt="" draggable={false} /></div>
        <div className="trade-info-copy">
          <small>ASTERION // ПРОМЫШЛЕННЫЙ МОДУЛЬ</small>
          <h1>Торговый центр</h1>
          <p>{planetName}</p>
          <span className="trade-level">УРОВЕНЬ <strong data-qa-trade-level={buildingLevel}>{buildingLevel}</strong></span>
        </div>

        <dl className="trade-info-stats">
          <div><dt>Лимит одной сделки</dt><dd data-qa-trade-limit={amountLimit}>{formatNumber(amountLimit)}</dd></div>
          <div><dt>Ресурс. рейтинг</dt><dd data-qa-trade-rating={resourceRatingPoints}>{formatNumber(resourceRatingPoints)}</dd></div>
          <div><dt>Сделки</dt><dd data-qa-trade-slots={`${refill.availableSlots}/${refill.maxSlots}`}>{refill.availableSlots} / {refill.maxSlots}</dd></div>
        </dl>

        <section className={`trade-refill ${refill.missingSlots === 0 ? 'full' : ''}`} data-qa-trade-refill>
          <header><strong>ВОССТАНОВЛЕНИЕ СДЕЛОК</strong><span>{refill.missingSlots} в очереди</span></header>
          {refill.missingSlots === 0 ? (
            <p className="trade-refill-ready" data-qa-trade-all-available>Все сделки доступны</p>
          ) : (
            <>
              <dl>
                <div><dt>Следующая</dt><dd data-qa-trade-next-refill>{`+1 через ${formatDuration(refill.nextRefillMs)}`}</dd></div>
                <div><dt>До полного</dt><dd data-qa-trade-full-refill>{formatDuration(refill.fullRefillMs)}</dd></div>
              </dl>
              <div className="trade-refill-queue" data-qa-trade-refill-queue={refill.missingSlots}>
                {refill.refillAtQueue.map((timestamp, index) => (
                  <span key={`${timestamp}-${index}`} data-qa-trade-refill-segment>{index + 1}<small>15 мин</small></span>
                ))}
              </div>
            </>
          )}
          <p className="trade-refill-note">Каждый уровень даёт 3 сделки. Один слот восстанавливается каждые 15 минут.</p>
        </section>

        <button className="trade-back" type="button" data-qa-trade-back onClick={onBack}><span>←</span> Назад в Торговый центр</button>
      </aside>

      <section className="trade-workspace">
        <header className="trade-workspace-header">
          <div><small>МГНОВЕННЫЙ ОБМЕН РЕСУРСОВ</small><h2>ТОРГОВЫЙ ЦЕНТР</h2></div>
          <strong>{refill.availableSlots} / {refill.maxSlots} СДЕЛОК</strong>
        </header>

        <div className="trade-flow">
          <section className="trade-resource-panel trade-sell-panel">
            <header><small>01</small><div><span>ПРОДАЖА</span><strong>Что отдаём</strong></div></header>
            <div className="trade-resource-grid trade-resource-grid--source">
              {TRADE_RESOURCES.map((resource) => {
                const balance = wallet[resource];
                const unavailable = balance <= 0;
                const selected = source === resource && !unavailable;
                return (
                  <button
                    key={resource}
                    type="button"
                    className={`trade-resource-card ${selected ? 'selected' : ''} ${unavailable ? 'unavailable' : ''}`}
                    disabled={unavailable}
                    data-qa-trade-source={resource}
                    data-qa-trade-selected={selected ? 'true' : 'false'}
                    onClick={() => selectSource(resource)}
                  >
                    <span className="trade-resource-icon"><ResourceGlyph resource={resource} /></span>
                    <span className="trade-resource-name">{SOURCE_LABELS[resource]}</span>
                    <small>{formatNumber(balance)}</small>
                    <span className="trade-resource-tooltip" data-qa-trade-tooltip>{SOURCE_LABELS[resource]} · доступно {formatNumber(balance)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="trade-ratio-panel" aria-label="Текущий курс">
            <small>СООТНОШЕНИЕ</small>
            <div className="trade-ratio-connector"><i /><span>→</span><i /></div>
            <strong data-qa-trade-rate>{source === 'debris' ? '1 : 0,6' : '1 : 1'}</strong>
            <p>{SOURCE_LABELS[source]} → {TARGET_LABELS[target]}</p>
            {source === 'debris' ? <em>40% теряется при срочном обмене</em> : <em>Прямой обмен без потерь</em>}
          </section>

          <section className="trade-resource-panel trade-buy-panel">
            <header><small>02</small><div><span>ПОКУПКА</span><strong>Что получаем</strong></div></header>
            <div className="trade-resource-grid trade-resource-grid--target">
              {TRADE_TARGET_RESOURCES.map((resource) => {
                const disabled = source !== 'debris' && source === resource;
                const selected = target === resource && !disabled;
                return (
                  <button
                    key={resource}
                    type="button"
                    className={`trade-resource-card ${selected ? 'selected' : ''} ${disabled ? 'unavailable same-resource' : ''}`}
                    disabled={disabled}
                    data-qa-trade-target={resource}
                    data-qa-trade-selected={selected ? 'true' : 'false'}
                    onClick={() => selectTarget(resource)}
                  >
                    <span className="trade-resource-icon"><ResourceGlyph resource={resource} /></span>
                    <span className="trade-resource-name">{TARGET_LABELS[resource]}</span>
                    <small>{disabled ? 'НЕДОСТУПНО' : 'ВЫБРАТЬ'}</small>
                    <span className="trade-resource-tooltip" data-qa-trade-tooltip>{disabled ? 'Нельзя купить тот же ресурс' : TARGET_LABELS[resource]}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <section className="trade-amount-panel">
          <header><div><small>03</small><span>КОЛИЧЕСТВО</span></div><strong>МАКС. ПО БАЛАНСУ И РЕЙТИНГУ: {formatNumber(maxAmount)}</strong></header>
          <div className="trade-amount-controls">
            <button type="button" data-qa-trade-minus onClick={() => adjustAmount(-1)} disabled={amount <= 0}>−</button>
            <input
              className="trade-amount-input"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={amount}
              data-qa-trade-amount-input
              data-qa-trade-amount={amount}
              onChange={(event) => updateAmount(Number(event.target.value))}
            />
            <input
              className="trade-amount-slider"
              type="range"
              min={0}
              max={Math.max(1, maxAmount)}
              step={1}
              value={Math.min(amount, Math.max(1, maxAmount))}
              disabled={maxAmount <= 0}
              data-qa-trade-amount-slider
              onChange={(event) => updateAmount(Number(event.target.value))}
            />
            <button type="button" data-qa-trade-plus onClick={() => adjustAmount(1)} disabled={maxAmount <= 0 || amount >= maxAmount}>+</button>
            <button className="trade-max" type="button" data-qa-trade-max onClick={() => setAmount(maxAmount)} disabled={maxAmount <= 0}>МАКС.</button>
          </div>

          <div className="trade-summary-grid">
            <div><small>ОТПРАВИТЬ</small><strong data-qa-trade-send={amount}>{formatNumber(amount)} {SOURCE_LABELS[source]}</strong></div>
            <div><small>ПОЛУЧИТЕ</small><strong data-qa-trade-receive={received}>{formatNumber(received)} {TARGET_LABELS[target]}</strong></div>
            <div><small>БАЛАНС ИСТОЧНИКА</small><strong>{formatNumber(wallet[source])}</strong></div>
            <div><small>ЛИМИТ СДЕЛКИ</small><strong>{formatNumber(amountLimit)}</strong></div>
            <div><small>СДЕЛКИ</small><strong>{refill.availableSlots} / {refill.maxSlots}</strong></div>
          </div>

          <div className="trade-action-row">
            <div className={`trade-validation ${validation.canTrade ? 'valid' : ''}`} data-qa-trade-validation>
              {validation.canTrade ? `Готово к обмену · курс ${source === 'debris' ? '1 : 0,6' : '1 : 1'}` : validation.reason}
            </div>
            <button type="button" className="trade-submit" data-qa-trade-submit disabled={!validation.canTrade} onClick={submit}>ОБМЕНЯТЬ</button>
          </div>
        </section>
      </section>

      <div className={`trade-toast ${toast ? 'visible' : ''}`} aria-live="polite" data-qa-trade-toast>{toast ? <span><b>✓</b>{toast}</span> : null}</div>
    </main>
  );
}

export const TRADE_SLOT_REFILL_LABEL = `${TRADE_REFILL_INTERVAL_MS / 60_000} мин`;
