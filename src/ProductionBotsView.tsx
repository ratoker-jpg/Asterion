import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { getBuildingDefinition, type BuildingRole } from './domain/buildings/resource-zone.ts';
import type { BuildingFaction } from './domain/buildings/balance-v1.ts';
import {
  MAX_PRODUCTION_BOTS_PER_RESOURCE,
  PRODUCTION_BOT_BONUSES,
  getProductionBotAssignmentTotal,
  getProductionBotBonusPercent,
  getProductionBotFreeCount,
  getProductionBotIncomePerHour,
  isProductionBotAssignmentValid,
  productionBotAssignmentsEqual,
  setProductionBotDraftResource,
  type BotAssignment,
  type BotResource,
  type ProductionBotBuildingRole,
  type ProductionResourceIncome,
} from './domain/buildings/production-bots.ts';
import { getPlanetZoneTerrainUrl } from './assets/planetZoneTerrainAssets.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import './production-bots.css';

type ProductionBotsViewProps = {
  buildingRole: ProductionBotBuildingRole;
  factionId: BuildingFaction;
  planetName: string;
  buildingLevel: number;
  availableBots: number;
  appliedAssignment: BotAssignment;
  /** Hourly production before robots, at the rate the header shows. */
  baseIncomePerHour: ProductionResourceIncome;
  onApply: (assignment: BotAssignment) => void;
  onBack: () => void;
};

const MINE_ROLE: Record<BotResource, BuildingRole> = {
  metal: 'metal-production-1',
  minerals: 'mineral-production-1',
  gas: 'gas-production-1',
};

// The free pool shows this many robot figures; the rest is a «+N».
const POOL_FIGURES = 12;

const formatRate = (value: number) => {
  const rounded = Math.round(value);
  if (rounded >= 1e9) return `${(rounded / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млрд`;
  if (rounded >= 1e6) return `${(rounded / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн`;
  return rounded.toLocaleString('ru-RU');
};

const robotsWord = (count: number) => {
  const tens = Math.abs(count) % 100;
  const ones = tens % 10;
  if (tens > 10 && tens < 20) return 'роботов';
  if (ones === 1) return 'робот';
  if (ones >= 2 && ones <= 4) return 'робота';
  return 'роботов';
};

export function ProductionBotsView({
  buildingRole,
  factionId,
  planetName,
  buildingLevel,
  availableBots,
  appliedAssignment,
  baseIncomePerHour,
  onApply,
  onBack,
}: ProductionBotsViewProps) {
  const building = getBuildingDefinition(buildingRole, factionId);
  const [draft, setDraft] = useState<BotAssignment>(() => ({ ...appliedAssignment }));
  const [toastVisible, setToastVisible] = useState(false);
  // Bumped on every apply so the bays replay their «robots at work» pulse.
  const [applyPulse, setApplyPulse] = useState(0);

  useEffect(() => {
    setDraft({ ...appliedAssignment });
  }, [appliedAssignment]);

  useEffect(() => {
    if (!toastVisible) return;
    const timer = window.setTimeout(() => setToastVisible(false), 2400);
    return () => window.clearTimeout(timer);
  }, [toastVisible]);

  const draftTotal = useMemo(() => getProductionBotAssignmentTotal(draft), [draft]);
  const appliedTotal = useMemo(() => getProductionBotAssignmentTotal(appliedAssignment), [appliedAssignment]);
  const draftFree = useMemo(() => getProductionBotFreeCount(draft, availableBots), [draft, availableBots]);
  const draftValid = useMemo(() => isProductionBotAssignmentValid(draft, availableBots), [draft, availableBots]);
  const hasChanges = useMemo(() => !productionBotAssignmentsEqual(draft, appliedAssignment), [draft, appliedAssignment]);
  const appliedIncome = useMemo(() => getProductionBotIncomePerHour(baseIncomePerHour, appliedAssignment), [baseIncomePerHour, appliedAssignment]);
  const draftIncome = useMemo(() => getProductionBotIncomePerHour(baseIncomePerHour, draft), [baseIncomePerHour, draft]);
  const canApply = draftValid && hasChanges;

  const changes = PRODUCTION_BOT_BONUSES
    .map((definition) => ({
      definition,
      robots: draft[definition.resource] - appliedAssignment[definition.resource],
      income: draftIncome[definition.resource] - appliedIncome[definition.resource],
    }))
    .filter((change) => change.robots !== 0);

  const changeDraft = (resource: BotResource, requestedValue: number) => {
    setDraft((current) => setProductionBotDraftResource(current, resource, requestedValue, availableBots));
  };

  const distribute = () => {
    if (!canApply) return;
    onApply({ ...draft });
    setApplyPulse((value) => value + 1);
    setToastVisible(false);
    window.requestAnimationFrame(() => setToastVisible(true));
  };

  return (
    <main
      className="production-bots-view"
      data-qa-production-bots={buildingRole}
      data-qa-production-bots-building={buildingRole}
      style={{ '--pbots-terrain': `url("${getPlanetZoneTerrainUrl('resource')}")` } as CSSProperties}
    >
      <header className="pbots-header">
        <div>
          <h1>Производственные роботы</h1>
          <p>{building.name} · уровень {buildingLevel} · {planetName}</p>
        </div>
        <button
          className="production-bots-back"
          type="button"
          data-qa-building-interior-back
          data-qa-production-bots-back
          onClick={onBack}
        >
          <span aria-hidden="true">←</span>
          Назад: {building.name}
        </button>
      </header>

      <section className="pbots-bays" aria-label="Распределение производственных роботов">
        {PRODUCTION_BOT_BONUSES.map((definition) => {
          const resource = definition.resource;
          const assigned = draft[resource];
          const applied = appliedAssignment[resource];
          const draftBonus = getProductionBotBonusPercent(draft, resource);
          const appliedBonus = getProductionBotBonusPercent(appliedAssignment, resource);
          const changed = assigned !== applied;
          const reachable = Math.min(MAX_PRODUCTION_BOTS_PER_RESOURCE, assigned + draftFree);
          const canDecrease = assigned > 0;
          const canIncrease = assigned < MAX_PRODUCTION_BOTS_PER_RESOURCE && draftTotal < availableBots;
          const incomeDelta = draftIncome[resource] - appliedIncome[resource];

          return (
            <article
              className={`pbots-bay pbots-bay--${resource}${changed ? ' is-changed' : ''}`}
              key={resource}
              data-qa-production-bot-resource={resource}
            >
              <div className="pbots-bay__art" aria-hidden="true">
                <img src={getBuildingDefinition(MINE_ROLE[resource], factionId).art} alt="" draggable={false} />
              </div>

              <div className="pbots-bay__title">
                <ResourceIcon kind={resource} />
                <h2>{definition.label}</h2>
                <div className="pbots-bay__bonus">
                  <strong data-qa-bot-draft-effect={resource}>+{draftBonus}%</strong>
                  <small className={changed ? '' : 'is-same'}>было <b data-qa-bot-current-bonus={resource}>+{appliedBonus}%</b></small>
                </div>
              </div>

              <div className="pbots-bay__yield" aria-live="polite">
                {changed ? (
                  <>
                    <span className="pbots-bay__was">{formatRate(appliedIncome[resource])}/ч</span>
                    <span className="pbots-bay__arrow" aria-hidden="true">→</span>
                    <strong key={`now-${applyPulse}`}>{formatRate(draftIncome[resource])}/ч</strong>
                    <span className={`pbots-bay__delta ${incomeDelta < 0 ? 'is-loss' : ''}`}>
                      {incomeDelta < 0 ? '−' : '+'}{formatRate(Math.abs(incomeDelta))}/ч
                    </span>
                  </>
                ) : (
                  <>
                    <strong key={`now-${applyPulse}`}>{formatRate(appliedIncome[resource])}/ч</strong>
                    <span className="pbots-bay__was">добыча</span>
                  </>
                )}
              </div>

              <div className="pbots-bay__crew">
                <p className="pbots-bay__count">
                  <strong data-qa-bot-draft={resource}>{assigned}</strong>
                  <span>из {MAX_PRODUCTION_BOTS_PER_RESOURCE} {robotsWord(MAX_PRODUCTION_BOTS_PER_RESOURCE)} · +{definition.percentPerBot}% за каждого</span>
                </p>
                <div className="pbots-bay__controls">
                  <button
                    type="button"
                    className="pbots-step"
                    aria-label={`Убрать робота: ${definition.label}`}
                    data-qa-bot-minus={resource}
                    disabled={!canDecrease}
                    onClick={() => changeDraft(resource, assigned - 1)}
                  >−</button>

                  <BotSlots
                    resource={resource}
                    label={definition.label}
                    value={assigned}
                    applied={applied}
                    reachable={reachable}
                    pulse={applyPulse}
                    onChange={(value) => changeDraft(resource, value)}
                  />

                  <button
                    type="button"
                    className="pbots-step"
                    aria-label={`Добавить робота: ${definition.label}`}
                    data-qa-bot-plus={resource}
                    disabled={!canIncrease}
                    onClick={() => changeDraft(resource, assigned + 1)}
                  >+</button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <footer className={`pbots-dock${hasChanges ? ' has-changes' : ''}`} data-qa-bots-draft-total={draftTotal}>
        <div className="pbots-dock__pool">
          <div className="pbots-dock__count">
            <span>Свободные роботы</span>
            <p>
              <strong data-qa-bots-draft-free={draftFree}>{draftFree}</strong>
              <small>из <b data-qa-bots-available={availableBots}>{availableBots}</b></small>
            </p>
          </div>
          <div className="pbots-dock__figures" aria-hidden="true">
            {draftFree === 0 ? (
              <span className="pbots-dock__empty">все на работе</span>
            ) : (
              <>
                {Array.from({ length: Math.min(draftFree, POOL_FIGURES) }, (_, index) => (
                  <RobotFigure key={index} className="pbots-robot is-idle" />
                ))}
                {draftFree > POOL_FIGURES ? <span className="pbots-dock__more">+{draftFree - POOL_FIGURES}</span> : null}
              </>
            )}
          </div>
        </div>

        <div className="pbots-dock__changes" aria-live="polite">
          {changes.length > 0 ? changes.map(({ definition, robots, income }) => (
            <p key={definition.resource}>
              <span>{definition.label}</span>
              <b className={robots < 0 ? 'is-loss' : ''}>{robots > 0 ? '+' : '−'}{Math.abs(robots)} {robotsWord(Math.abs(robots))}</b>
              <em className={income < 0 ? 'is-loss' : ''}>{income < 0 ? '−' : '+'}{formatRate(Math.abs(income))}/ч</em>
            </p>
          )) : (
            <p className="pbots-dock__hint">
              {draftFree > 0 ? 'Нажмите на место в цехе или «+», чтобы отправить робота на добычу' : 'Чтобы перевести робота, сначала уберите его из цеха'}
            </p>
          )}
        </div>

        <div className="pbots-dock__actions">
          {hasChanges ? (
            <button type="button" className="pbots-reset" onClick={() => setDraft({ ...appliedAssignment })}>Отменить</button>
          ) : null}
          <button
            type="button"
            className={`production-bots-distribute${!canApply && appliedTotal === 0 ? ' is-waiting' : ''}`}
            data-qa-production-bots-distribute
            disabled={!canApply}
            onClick={distribute}
          >
            {canApply ? 'Применить' : appliedTotal > 0 ? <><span aria-hidden="true">✓</span> Работают</> : 'Ждут приказа'}
          </button>
        </div>
      </footer>

      <div className={`production-bots-toast ${toastVisible ? 'visible' : ''}`} aria-live="polite" aria-atomic="true" data-qa-production-bots-toast>
        {toastVisible ? <span><b aria-hidden="true">✓</b> Роботы перераспределены</span> : null}
      </div>
    </main>
  );
}

function RobotFigure({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 40 44" aria-hidden="true" focusable="false">
      <path className="pbots-robot__antenna" d="M20 3v6" />
      <circle className="pbots-robot__body" cx="20" cy="3.2" r="2.6" />
      <rect className="pbots-robot__body" x="6" y="8" width="28" height="18" rx="7" />
      <rect className="pbots-robot__visor" x="11" y="13.5" width="18" height="6.6" rx="3.3" />
      <circle className="pbots-robot__eye" cx="16" cy="16.8" r="1.7" />
      <circle className="pbots-robot__eye" cx="24" cy="16.8" r="1.7" />
      <rect className="pbots-robot__body pbots-robot__torso" x="10" y="27.5" width="20" height="9" rx="3.6" />
      <rect className="pbots-robot__body pbots-robot__tread" x="7" y="37.6" width="26" height="5" rx="2.5" />
    </svg>
  );
}

// Ten robot places over a native range input: the input keeps keyboard
// control (arrows, Home/End) and the accessible value; a click on a place
// fills the bay up to it, a click on the last robot sends it back, and a
// drag across the places follows the pointer.
function BotSlots({
  resource,
  label,
  value,
  applied,
  reachable,
  pulse,
  onChange,
}: {
  resource: BotResource;
  label: string;
  value: number;
  applied: number;
  reachable: number;
  pulse: number;
  onChange: (value: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const slotAt = (event: PointerEvent<HTMLDivElement>) => {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-bot-slot]');
    if (!target || !event.currentTarget.contains(target)) return null;
    return Number(target.dataset.botSlot);
  };

  return (
    <div
      className="pbots-slots"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        inputRef.current?.focus({ preventScroll: true });
        const index = slotAt(event);
        if (index === null) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        onChange(index + 1 === value ? index : index + 1);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const index = slotAt(event);
        if (index !== null && index + 1 !== value) onChange(index + 1);
      }}
    >
      <span className="pbots-slots__grid" aria-hidden="true">
        {Array.from({ length: MAX_PRODUCTION_BOTS_PER_RESOURCE }, (_, index) => {
          const state = index < value
            ? (index < applied ? 'is-on' : 'is-new')
            : index < applied ? 'is-leaving' : index < reachable ? 'is-open' : 'is-closed';
          return (
            <span className={`pbots-slot ${state}`} data-bot-slot={index} key={state === 'is-on' ? `${index}-${pulse}` : index}>
              <RobotFigure className="pbots-robot" />
            </span>
          );
        })}
      </span>
      <input
        ref={inputRef}
        type="range"
        min={0}
        max={MAX_PRODUCTION_BOTS_PER_RESOURCE}
        step={1}
        value={value}
        aria-label={`Роботы на добыче: ${label}`}
        aria-valuetext={`${value} из ${MAX_PRODUCTION_BOTS_PER_RESOURCE}`}
        data-qa-bot-slider={resource}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
