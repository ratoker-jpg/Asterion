import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { getBuildingDefinition } from './domain/buildings/resource-zone.ts';
import type { BuildingFaction } from './domain/buildings/balance-v1.ts';
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
import { getPlanetZoneTerrainUrl } from './assets/planetZoneTerrainAssets.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
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

/** «Отдаёте …» / «Получите …»: the object of the sentence in the result card. */
const OBJECT_LABELS: Record<TradeResource, string> = {
  metal: 'металл',
  minerals: 'минералы',
  gas: 'газ',
  debris: 'обломки',
};

/** Quick amounts, as a share of what one deal may carry (balance and limit both counted). */
const QUICK_SHARES = [25, 50, 75] as const;
/** Longer figures than this would not fit the result card at full size. */
const LONG_FIGURE_DIGITS = 13;
/** Longer figures than this would not fit the amount field at full size. */
const LONG_INPUT_DIGITS = 12;
/** More digits than the game can count exactly are ignored while typing. */
const MAX_AMOUNT_DIGITS = 15;

const TRADE_SLOT_REFILL_MINUTES = TRADE_REFILL_INTERVAL_MS / 60_000;

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

/** One press of «−» / «+»: a single unit while amounts are small, a visible step on millions. */
function amountStep(maxAmount: number): number {
  return maxAmount < 100_000 ? 1 : 10 ** (Math.floor(Math.log10(maxAmount)) - 2);
}

function pickFreeTarget(source: TradeResource, target: TradeTargetResource): TradeTargetResource {
  if (source === 'debris' || source !== target) return target;
  return TRADE_TARGET_RESOURCES.find((resource) => resource !== source) ?? target;
}

type TradeCenterViewProps = {
  factionId: BuildingFaction;
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
  factionId,
}: TradeCenterViewProps) {
  const building = getBuildingDefinition('trade-center', factionId);
  const [source, setSource] = useState<TradeResource>('metal');
  const [target, setTarget] = useState<TradeTargetResource>('minerals');
  const [amount, setAmount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [completedTrades, setCompletedTrades] = useState(0);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const caretDigitsRef = useRef<number | null>(null);

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

  // The amount field groups digits as it is typed: keep the caret after the same digit.
  useLayoutEffect(() => {
    const input = amountInputRef.current;
    const digitsBefore = caretDigitsRef.current;
    caretDigitsRef.current = null;
    if (!input || digitsBefore === null) return;
    let position = 0;
    let seen = 0;
    while (position < input.value.length && seen < digitsBefore) {
      if (/\d/.test(input.value[position] ?? '')) seen += 1;
      position += 1;
    }
    input.setSelectionRange(position, position);
  }, [amount]);

  const selectSource = (next: TradeResource) => {
    if (wallet[next] <= 0) return;
    setSource(next);
    setTarget((current) => pickFreeTarget(next, current));
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

  const typeAmount = (input: HTMLInputElement) => {
    const digits = input.value.replace(/\D/g, '').slice(0, MAX_AMOUNT_DIGITS);
    caretDigitsRef.current = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length;
    updateAmount(digits ? Number(digits) : 0);
  };

  const adjustAmount = (direction: 1 | -1) => {
    updateAmount(Math.min(maxAmount, Math.max(0, amount + direction * amountStep(maxAmount))));
  };

  const submit = () => {
    const result = onTrade({ source, target, amount });
    if (!result.ok) {
      setToast(result.reason ?? 'Обмен недоступен');
      return;
    }
    setAmount(0);
    setCompletedTrades((count) => count + 1);
    setToast(`Обмен выполнен · Получено ${formatNumber(result.received)} ${SHORT_LABELS[target]}`);
  };

  const debris = source === 'debris';
  const rate = debris ? '1 : 0,6' : '1 : 1';
  const sliderMax = Math.max(1, maxAmount);
  const sliderValue = Math.min(amount, sliderMax);
  const noDeals = refill.availableSlots <= 0;
  const tooMuch = amount > maxAmount;
  // The rule's own wording stays for every refusal but the empty field, which is not a mistake yet.
  const validationText = validation.canTrade
    ? 'Всё готово к обмену'
    : validation.reason === 'Введите целое положительное количество'
      ? 'Укажите, сколько отдаёте'
      : validation.reason;

  return (
    <main
      className="trade-center-view"
      data-qa-trade-center
      style={{ '--tc-terrain': `url("${getPlanetZoneTerrainUrl('industry')}")` } as CSSProperties}
    >
      <header className="tc-head">
        <div className="tc-head__title">
          <h1>{building.name}</h1>
          <p>Мгновенный обмен ресурсов · уровень <b data-qa-trade-level={buildingLevel}>{buildingLevel}</b> · {planetName}</p>
        </div>

        <section className={`tc-deals ${noDeals ? 'is-empty' : ''}`} data-qa-trade-refill aria-label="Сделки">
          <div className="tc-deals__count" data-qa-trade-slots={`${refill.availableSlots}/${refill.maxSlots}`}>
            <span><b>{refill.availableSlots}</b> из {refill.maxSlots} сделок</span>
            <div className="tc-deals__pips" data-qa-trade-refill-queue={refill.missingSlots} aria-hidden="true">
              {Array.from({ length: refill.availableSlots }, (_, index) => <i key={`free-${index}`} className="is-free" />)}
              {refill.refillAtQueue.map((timestamp, index) => <i key={`${timestamp}-${index}`} data-qa-trade-refill-segment />)}
            </div>
          </div>
          <div className="tc-deals__timer">
            {refill.missingSlots === 0 ? (
              <strong data-qa-trade-all-available>Все сделки доступны</strong>
            ) : (
              <strong data-qa-trade-next-refill>{`+1 через ${formatDuration(refill.nextRefillMs)}`}</strong>
            )}
            {refill.missingSlots > 1 ? (
              <small>все через <span data-qa-trade-full-refill>{formatDuration(refill.fullRefillMs)}</span></small>
            ) : (
              <small>3 сделки за уровень · новая за {TRADE_SLOT_REFILL_MINUTES} мин</small>
            )}
          </div>
        </section>

        <button className="trade-back" type="button" data-qa-trade-back onClick={onBack}><span>←</span> Назад: {building.name}</button>
      </header>

      <div className="tc-exchange" data-qa-trade-flow>
        <section className="tc-side" aria-label="Что отдаёте" data-qa-trade-give>
          <h2>Отдаёте</h2>
          <div className="tc-tiles">
            {TRADE_RESOURCES.map((resource) => {
              const balance = wallet[resource];
              const unavailable = balance <= 0;
              const selected = source === resource && !unavailable;
              const tooltip = unavailable
                ? `${SOURCE_LABELS[resource]}: сейчас нет`
                : resource === 'debris'
                  ? 'Обломки меняются 1 : 0,6, 40% теряется'
                  : `${SOURCE_LABELS[resource]}: обмен 1 : 1, без потерь`;
              return (
                <button
                  key={resource}
                  type="button"
                  className={`tc-tile tc-tile--${resource} ${selected ? 'is-selected' : ''}`}
                  disabled={unavailable}
                  aria-pressed={selected}
                  data-qa-trade-source={resource}
                  data-qa-trade-selected={selected ? 'true' : 'false'}
                  onClick={() => selectSource(resource)}
                >
                  <span className="tc-tile__icon"><ResourceIcon kind={resource} /></span>
                  <span className="tc-tile__name">{SOURCE_LABELS[resource]}</span>
                  <span className="tc-tile__value">{unavailable ? 'Нечего отдать' : formatNumber(balance)}</span>
                  <span className="tc-tile__tip" data-qa-trade-tooltip>{tooltip}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={`tc-result ${validation.canTrade ? 'is-ready' : ''}`} aria-label="Итог обмена" data-qa-trade-result>
          <img className="tc-result__art" src={building.art} alt="" draggable={false} />
          <div className="tc-result__line">
            <ResourceIcon key={source} kind={source} />
            <span>Отдаёте {OBJECT_LABELS[source]}</span>
          </div>
          <strong key={`give-${amount}`} className={`tc-result__give ${String(amount).length > LONG_FIGURE_DIGITS ? 'is-long' : ''} ${tooMuch ? 'is-too-much' : ''}`} data-qa-trade-send={amount}>{formatNumber(amount)}</strong>
          <span className="tc-result__flow" aria-hidden="true"><i /><i /><i /></span>
          <strong key={`get-${received}`} className={`tc-result__get ${String(received).length > LONG_FIGURE_DIGITS ? 'is-long' : ''}`} data-qa-trade-receive={received}>{formatNumber(received)}</strong>
          <div className="tc-result__line">
            <ResourceIcon key={target} kind={target} />
            <span>Получите {OBJECT_LABELS[target]}</span>
          </div>
          {completedTrades > 0 ? <i key={completedTrades} className="tc-result__flash" aria-hidden="true" /> : null}
          <div className={`tc-toast ${toast ? 'visible' : ''}`} aria-live="polite" data-qa-trade-toast>{toast ? <span><b>✓</b>{toast}</span> : null}</div>
        </section>

        <section className="tc-side" aria-label="Что получаете" data-qa-trade-get>
          <h2>Получаете</h2>
          <div className="tc-tiles">
            {TRADE_TARGET_RESOURCES.map((resource) => {
              const disabled = source !== 'debris' && source === resource;
              const selected = target === resource && !disabled;
              return (
                <button
                  key={resource}
                  type="button"
                  className={`tc-tile tc-tile--${resource} ${selected ? 'is-selected' : ''}`}
                  disabled={disabled}
                  aria-pressed={selected}
                  data-qa-trade-target={resource}
                  data-qa-trade-selected={selected ? 'true' : 'false'}
                  onClick={() => selectTarget(resource)}
                >
                  <span className="tc-tile__icon"><ResourceIcon kind={resource} /></span>
                  <span className="tc-tile__name">{TARGET_LABELS[resource]}</span>
                  <span className="tc-tile__value">{disabled ? 'Этот ресурс вы отдаёте' : `сейчас ${formatNumber(wallet[resource])}`}</span>
                  <span className="tc-tile__tip" data-qa-trade-tooltip>{disabled ? 'Нельзя купить тот же ресурс' : `Получить ${OBJECT_LABELS[resource]}`}</span>
                </button>
              );
            })}
            {/* Fills the fourth row, so both columns keep tiles of one size, level with each other. */}
            <p className={`tc-rate ${debris ? 'is-lossy' : ''}`}>
              <span>Курс <b data-qa-trade-rate>{rate}</b></span>
              <small>{debris ? '40% обломков теряется при обмене' : 'Прямой обмен без потерь'}</small>
            </p>
          </div>
        </section>
      </div>

      <section className="tc-dock" aria-label="Сколько отдаёте">
        <div className="tc-amount">
          <label htmlFor="tc-amount-input">Сколько отдаёте</label>
          <input
            ref={amountInputRef}
            id="tc-amount-input"
            className={`tc-amount__input ${String(amount).length > LONG_INPUT_DIGITS ? 'is-long' : ''}`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={formatNumber(amount)}
            data-qa-trade-amount-input
            data-qa-trade-amount={amount}
            onChange={(event) => typeAmount(event.target)}
          />
        </div>

        <div className="tc-picker">
          <input
            className="tc-picker__slider"
            type="range"
            min={0}
            max={sliderMax}
            step={1}
            value={sliderValue}
            disabled={maxAmount <= 0}
            aria-label="Сколько отдаёте"
            style={{ '--tc-fill': `${(sliderValue / sliderMax) * 100}%` } as CSSProperties}
            data-qa-trade-amount-slider
            onChange={(event) => updateAmount(Number(event.target.value))}
          />
          <div className="tc-picker__row">
            <button type="button" className="tc-step" aria-label="Меньше" data-qa-trade-minus onClick={() => adjustAmount(-1)} disabled={amount <= 0}>−</button>
            <button type="button" className="tc-step" aria-label="Больше" data-qa-trade-plus onClick={() => adjustAmount(1)} disabled={maxAmount <= 0 || amount >= maxAmount}>+</button>
            <div className="tc-shares">
              {QUICK_SHARES.map((share) => {
                const value = Math.floor(maxAmount * share / 100);
                return (
                  <button key={share} type="button" className={`tc-share ${amount === value && value > 0 ? 'is-on' : ''}`} data-qa-trade-share={share} disabled={value <= 0} onClick={() => updateAmount(value)}>{share}%</button>
                );
              })}
              <button type="button" className={`tc-share ${amount === maxAmount && maxAmount > 0 ? 'is-on' : ''}`} data-qa-trade-max onClick={() => setAmount(maxAmount)} disabled={maxAmount <= 0}>Макс.</button>
            </div>
            <p className="tc-limit" data-qa-trade-limit={amountLimit} data-qa-trade-rating={resourceRatingPoints}>
              <span>За сделку не больше <b>{formatNumber(amountLimit)}</b></span>
              <span>Предел растёт с рейтингом ресурсов</span>
            </p>
          </div>
        </div>

        <div className="tc-go">
          <button type="button" className="trade-submit tc-go__submit" data-qa-trade-submit disabled={!validation.canTrade} onClick={submit}>ОБМЕНЯТЬ</button>
          <div className={`tc-go__why ${validation.canTrade ? 'is-valid' : ''}`} data-qa-trade-validation>{validationText}</div>
        </div>
      </section>
    </main>
  );
}
