import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { getBuildingDefinition } from './domain/buildings/resource-zone.ts';
import type { BuildingFaction } from './domain/buildings/balance-v1.ts';
import { getRecyclingBalance } from './domain/buildings/balance-v1.ts';
import {
  RECYCLING_MAX_LEVEL,
  RECYCLING_RESOURCES,
  RECYCLING_STORAGE_MS,
  getReadyRecyclingJobIds,
  getRecyclingEfficiencyPercent,
  getRecyclingMaxConcurrentJobs,
  getRecyclingOutput,
  getRecyclingRunDurationMs,
  planRecyclingBatch,
  rebalanceRecyclingAllocation,
  type RecyclingJob,
  type RecyclingResource,
  type RecyclingState,
  type ResourceAllocationPercent,
} from './domain/buildings/recycling.ts';
import { ACTIVE_RUNTIME_MODE, resolveTestTimeScale } from './domain/runtime/mode.ts';
import { getPlanetZoneTerrainUrl } from './assets/planetZoneTerrainAssets.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import './recycling-center.css';

type RecyclingCenterViewProps = {
  factionId: BuildingFaction;
  planetName: string;
  buildingLevel: number;
  recycling: RecyclingState;
  now: number;
  onStart: (totalDebris: number, processCount: number, allocation: ResourceAllocationPercent) => boolean;
  onCollect: (jobId: string) => boolean;
  onCollectAll: () => boolean;
  onBack: () => void;
};

const RESOURCE_LABEL: Readonly<Record<RecyclingResource, string>> = {
  metal: 'Металл',
  minerals: 'Минералы',
  gas: 'Газ',
};

const DEBRIS_PILE_ART = './assets/generated/recycling-debris-pile.webp';
const DEBRIS_SHARES = [25, 50, 75] as const;
const ALLOCATION_STEP = 5;
const ALLOCATION_CELLS = 10;

// The split the player chose last stays for the session: the point of this
// screen is not to set the same thing up again after every batch.
let lastAllocation: ResourceAllocationPercent = { metal: 34, minerals: 33, gas: 33 };

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(Math.max(0, Math.floor(value)));

const formatAmount = (value: number) => {
  const safe = Math.max(0, Math.floor(value));
  if (safe >= 1e9) return `${(safe / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млрд`;
  if (safe >= 1e6) return `${(safe / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн`;
  return formatNumber(safe);
};

const formatClock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const processWord = (count: number) => {
  const tens = count % 100;
  const ones = tens % 10;
  if (tens > 10 && tens < 20) return 'процессов';
  if (ones === 1) return 'процесс';
  if (ones >= 2 && ones <= 4) return 'процесса';
  return 'процессов';
};

const startLabel = (count: number) => {
  if (count <= 0) return 'Запустить';
  return count === 1 ? 'Запустить 1 процесс' : `Запустить ${count} ${processWord(count)}`;
};

const jobOutputTotal = (job: RecyclingJob) => job.output.metal + job.output.minerals + job.output.gas;

export function RecyclingCenterView({
  factionId,
  planetName,
  buildingLevel,
  recycling,
  now,
  onStart,
  onCollect,
  onCollectAll,
  onBack,
}: RecyclingCenterViewProps) {
  const building = getBuildingDefinition('recycling', factionId);
  // null follows what is there: all free debris, all free processes.
  const [pickedDebris, setPickedDebris] = useState<number | null>(null);
  const [pickedCount, setPickedCount] = useState<number | null>(null);
  const [allocation, setAllocationState] = useState<ResourceAllocationPercent>(lastAllocation);

  const available = recycling.availableDebris;
  const maxJobs = getRecyclingMaxConcurrentJobs(buildingLevel);
  const freeSlots = Math.max(0, maxJobs - recycling.jobs.length);
  const totalDebris = Math.min(pickedDebris ?? available, available);
  const processCount = Math.min(pickedCount ?? freeSlots, freeSlots, totalDebris);
  const plan = planRecyclingBatch(recycling, buildingLevel, totalDebris, processCount, allocation);
  const longestAmount = plan.amounts[0] ?? 0;
  const timing = { mode: ACTIVE_RUNTIME_MODE, testTimeScale: resolveTestTimeScale() };
  const durationMs = longestAmount > 0 ? getRecyclingRunDurationMs(longestAmount, buildingLevel, timing) : 0;
  const efficiencyPercent = getRecyclingEfficiencyPercent(buildingLevel);
  const debrisPerSecond = getRecyclingBalance(Math.max(1, buildingLevel)).debrisPerSecond;

  const output = plan.amounts.reduce((sum, amount) => {
    const part = getRecyclingOutput(amount, efficiencyPercent, allocation);
    return { metal: sum.metal + part.metal, minerals: sum.minerals + part.minerals, gas: sum.gas + part.gas };
  }, { metal: 0, minerals: 0, gas: 0 });
  const outputTotal = output.metal + output.minerals + output.gas;

  const readyIds = getReadyRecyclingJobIds(recycling, now);
  const readyOutput = recycling.jobs
    .filter((job) => readyIds.includes(job.id))
    .reduce((sum, job) => sum + jobOutputTotal(job), 0);
  const inJobs = recycling.jobs.reduce((total, job) => total + job.debrisAmount, 0);
  // With nothing to start, the bays show what the running processes will bring.
  const coming = recycling.jobs.reduce((sum, job) => ({
    metal: sum.metal + job.output.metal,
    minerals: sum.minerals + job.output.minerals,
    gas: sum.gas + job.output.gas,
  }), { metal: 0, minerals: 0, gas: 0 });

  useEffect(() => {
    // Back to «everything» once the picked amount is gone.
    setPickedDebris((current) => (current !== null && current > available ? (available > 0 ? available : null) : current));
  }, [available]);

  const setAllocation = (resource: RecyclingResource, percent: number) => {
    setAllocationState((current) => {
      const next = rebalanceRecyclingAllocation(current, resource, percent);
      lastAllocation = next;
      return next;
    });
  };

  const pickDebris = (requested: number) => {
    const safe = Number.isFinite(requested) ? Math.floor(requested) : 0;
    setPickedDebris(Math.min(available, Math.max(0, safe)));
  };

  const start = () => {
    if (!plan.canStart) return;
    if (!onStart(totalDebris, processCount, { ...allocation })) return;
    setPickedDebris(null);
    setPickedCount(null);
  };

  const hint = available <= 0 && recycling.jobs.length === 0
    ? 'Обломков нет. Их привозят переработчики: Флоты → Переработка'
    : available <= 0
      ? 'Все обломки уже в работе'
      : freeSlots <= 0
        ? 'Все процессы заняты. Забирайте готовые, и места освободятся'
        : plan.reason;

  return (
    <main
      className="recycling-center-view"
      data-qa-recycling-center
      data-qa-recycling-level={buildingLevel}
      style={{ '--rc-terrain': `url("${getPlanetZoneTerrainUrl('industry')}")` } as CSSProperties}
    >
      <header className="rc-header">
        <div>
          <h1>{building.name}</h1>
          <p>
            Уровень {buildingLevel} · {planetName} · выход <b data-qa-recycling-efficiency>{efficiencyPercent}%</b>
            {buildingLevel < building.maxLevel ? <> (на след. уровне <b data-qa-recycling-next-efficiency>{Math.min(120, efficiencyPercent + 5)}%</b>)</> : null}
            {' '}· {formatNumber(debrisPerSecond)} обломков в секунду на процесс
          </p>
        </div>
        <button className="rc-back" type="button" data-qa-building-interior-back data-qa-recycling-back onClick={onBack}>
          <span aria-hidden="true">←</span> Назад: {building.name}
        </button>
      </header>

      <section className="rc-flow" aria-label="Переработка">
        <section className={`rc-pile${available > 0 ? '' : ' is-empty'}`} aria-label="Обломки">
          <img className="rc-pile__art" src={DEBRIS_PILE_ART} alt="" draggable={false} />
          <div className="rc-pile__body">
            <span className="rc-pile__label"><ResourceIcon kind="debris" /> Свободные обломки</span>
            <strong className="rc-pile__total" data-qa-recycling-free-debris={available}>{formatNumber(available)}</strong>
            <span className={`rc-pile__busy${inJobs > 0 ? '' : ' is-empty'}`} data-qa-recycling-total-debris={available + inJobs}>
              {inJobs > 0 ? `ещё ${formatAmount(inJobs)} в работе` : ' '}
            </span>
            <label className="rc-pile__field">
              <span>Переработать</span>
              <input
                type="number"
                min={0}
                max={available}
                step={1}
                value={totalDebris}
                inputMode="numeric"
                disabled={available <= 0}
                aria-label="Сколько обломков переработать"
                data-qa-recycling-debris-input
                data-qa-recycling-debris-value={totalDebris}
                onChange={(event) => pickDebris(Number(event.target.value))}
              />
            </label>
            <div className="rc-pile__shares">
              {DEBRIS_SHARES.map((share) => {
                const amount = Math.floor(available * share / 100);
                return (
                  <button
                    type="button"
                    key={share}
                    className={available > 0 && totalDebris === amount ? 'is-on' : ''}
                    disabled={available <= 0}
                    data-qa-recycling-debris-share={share}
                    onClick={() => pickDebris(amount)}
                  >{share}%</button>
                );
              })}
              <button
                type="button"
                className={available > 0 && totalDebris === available ? 'is-on' : ''}
                disabled={available <= 0}
                data-qa-recycling-debris-max
                onClick={() => setPickedDebris(null)}
              >Всё</button>
            </div>
          </div>
        </section>

        <section className="rc-core" aria-label="Запуск">
          <div className="rc-core__art">
            <img src={building.art} alt={building.name} draggable={false} />
          </div>
          <p className="rc-core__summary" aria-live="polite" data-qa-recycling-validation={plan.canStart ? 'ok' : hint ?? ''}>
            {plan.canStart ? (
              <>
                <span><b data-qa-recycling-output-total={outputTotal}>{formatAmount(outputTotal)}</b> ресурсов за <b data-qa-recycling-duration>{formatClock(durationMs)}</b></span>
                <small>
                  {processCount === 1 ? '1 процесс' : `${processCount} ${processWord(processCount)} по ${formatAmount(longestAmount)}`}
                </small>
              </>
            ) : <span className="rc-core__hint">{hint}</span>}
          </p>
          <button
            className={`rc-start${plan.canStart ? ' is-ready' : ''}`}
            type="button"
            data-qa-recycling-start
            data-qa-recycling-start-count={processCount}
            disabled={!plan.canStart}
            onClick={start}
          >{startLabel(plan.canStart ? processCount : 0)}</button>
        </section>

        <section className="rc-bays" aria-label="Что получите">
          {RECYCLING_RESOURCES.map((resource) => (
            <ResourceBay
              key={resource}
              resource={resource}
              percent={allocation[resource]}
              amount={plan.canStart ? output[resource] : coming[resource]}
              caption={plan.canStart ? 'получите' : inJobs > 0 ? 'в работе' : ''}
              onChange={(percent) => setAllocation(resource, percent)}
            />
          ))}
        </section>
      </section>

      <section className="rc-floor" aria-label="Процессы">
        <header className="rc-floor__head">
          <h2>Процессы <b data-qa-recycling-job-count={recycling.jobs.length} data-qa-recycling-max-jobs={maxJobs}>{recycling.jobs.length} из {maxJobs}</b></h2>
          <span className="rc-floor__free" data-qa-recycling-free-slots={freeSlots}>
            {freeSlots <= 0
              ? 'свободных мест нет'
              : totalDebris > 0
                ? `свободно ${freeSlots}. Нажмите на место, чтобы выбрать сколько запустить`
                : `свободно ${freeSlots}`}
          </span>
          {readyIds.length > 0 ? (
            <button type="button" className="rc-collect-all" data-qa-recycling-collect-all={readyIds.length} onClick={() => onCollectAll()}>
              Забрать всё · {formatAmount(readyOutput)}
            </button>
          ) : null}
        </header>
        <div className="rc-slots" data-qa-recycling-job-list>
          {Array.from({ length: RECYCLING_MAX_LEVEL }, (_, index) => {
            const job = recycling.jobs[index];
            if (job) return <JobSlot key={job.id} job={job} now={now} onCollect={onCollect} />;
            if (index >= maxJobs) {
              return (
                <div className="rc-slot is-locked" key={index} data-qa-recycling-locked-slot={index + 1}>
                  <span className="rc-ring" style={{ '--rc-progress': 0 } as CSSProperties}><LockGlyph /></span>
                  <b>уровень {index + 1}</b>
                </div>
              );
            }
            const position = index - recycling.jobs.length;
            const selected = plan.canStart && position < processCount;
            return (
              <button
                type="button"
                className={`rc-slot rc-slot--free${selected ? ' is-selected' : ''}`}
                key={index}
                data-qa-recycling-free-slot={position + 1}
                aria-pressed={selected}
                aria-label={`Запустить процессов: ${position + 1}`}
                disabled={freeSlots <= 0 || totalDebris <= 0}
                onClick={() => setPickedCount(position + 1)}
              >
                <span className="rc-ring" style={{ '--rc-progress': selected ? 100 : 0 } as CSSProperties}>
                  <ResourceIcon kind="debris" />
                </span>
                <b>{selected ? formatAmount(plan.amounts[position] ?? 0) : 'свободно'}</b>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function JobSlot({ job, now, onCollect }: { job: RecyclingJob; now: number; onCollect: (jobId: string) => boolean }) {
  const ready = job.status === 'ready' || now >= job.finishAt;
  const progress = ready ? 100 : Math.min(100, Math.max(0, ((now - job.startedAt) / Math.max(1, job.finishAt - job.startedAt)) * 100));
  const expiresAt = job.collectExpiresAt ?? job.finishAt + RECYCLING_STORAGE_MS;
  return (
    <button
      type="button"
      className={`rc-slot ${ready ? 'is-ready' : 'is-running'}`}
      data-qa-recycling-job={job.id}
      data-qa-recycling-status={ready ? 'ready' : 'processing'}
      data-qa-recycling-collect={job.id}
      disabled={!ready}
      aria-label={ready ? `Забрать ${formatAmount(jobOutputTotal(job))} ресурсов` : `Перерабатывается, осталось ${formatClock(job.finishAt - now)}`}
      onClick={() => onCollect(job.id)}
    >
      <span className="rc-ring" style={{ '--rc-progress': progress } as CSSProperties}>
        <ResourceIcon kind={ready ? dominantResource(job) : 'debris'} />
      </span>
      <b data-qa-recycling-job-output={jobOutputTotal(job)}>{ready ? 'Забрать' : formatClock(job.finishAt - now)}</b>
      <small data-qa-recycling-job-timer={ready ? 'expires' : 'remaining'}>
        {ready ? `авто через ${formatClock(expiresAt - now)}` : `${formatAmount(job.debrisAmount)} обломков`}
      </small>
      <span className="rc-slot__tip" role="tooltip" data-qa-recycling-job-allocation>
        {RECYCLING_RESOURCES.filter((resource) => job.output[resource] > 0).map((resource) => (
          <span key={resource}><ResourceIcon kind={resource} /> {formatAmount(job.output[resource])}</span>
        ))}
      </span>
    </button>
  );
}

const dominantResource = (job: RecyclingJob): RecyclingResource => RECYCLING_RESOURCES
  .reduce((best, resource) => (job.output[resource] > job.output[best] ? resource : best), RECYCLING_RESOURCES[0] as RecyclingResource);

function LockGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" focusable="false">
      <path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="5" y="11" width="14" height="10" rx="2.4" fill="currentColor" />
    </svg>
  );
}

// Ten cells of 10% over a native range input, like the robot places of the
// factory: the input keeps keyboard control and the exact value, a click or a
// drag over the cells sets tens, the steppers move by 5.
function ResourceBay({
  resource,
  percent,
  amount,
  caption,
  onChange,
}: {
  resource: RecyclingResource;
  percent: number;
  amount: number;
  caption: string;
  onChange: (percent: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const label = RESOURCE_LABEL[resource];
  const cellAt = (event: PointerEvent<HTMLDivElement>) => {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-rc-cell]');
    if (!target || !event.currentTarget.contains(target)) return null;
    return Number(target.dataset.rcCell);
  };
  const lit = Math.round(percent / (100 / ALLOCATION_CELLS));

  return (
    <article className={`rc-bay rc-bay--${resource}`} data-qa-recycling-resource={resource}>
      <div className="rc-bay__top">
        <ResourceIcon kind={resource} />
        <h3>{label}</h3>
        <strong className="rc-bay__percent" data-qa-recycling-allocation-value={resource}>{percent}%</strong>
      </div>
      <p className="rc-bay__get"><strong key={amount} data-qa-recycling-resource-output={resource}>{formatAmount(amount)}</strong> <span>{caption}</span></p>
      <div className="rc-bay__controls">
        <button
          type="button"
          className="rc-step"
          aria-label={`Меньше: ${label}`}
          data-qa-recycling-allocation-minus={resource}
          disabled={percent <= 0}
          onClick={() => onChange(percent - ALLOCATION_STEP)}
        >−</button>
        <div
          className="rc-cells"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            inputRef.current?.focus({ preventScroll: true });
            const cell = cellAt(event);
            if (cell === null) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            onChange((cell + 1) * (100 / ALLOCATION_CELLS));
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const cell = cellAt(event);
            if (cell !== null) onChange((cell + 1) * (100 / ALLOCATION_CELLS));
          }}
        >
          <span className="rc-cells__row" aria-hidden="true">
            {Array.from({ length: ALLOCATION_CELLS }, (_, index) => (
              <i key={index} data-rc-cell={index} className={index < lit ? 'is-on' : ''} />
            ))}
          </span>
          <input
            ref={inputRef}
            type="range"
            min={0}
            max={100}
            step={1}
            value={percent}
            aria-label={`Доля: ${label}`}
            data-qa-recycling-allocation-slider={resource}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </div>
        <button
          type="button"
          className="rc-step"
          aria-label={`Больше: ${label}`}
          data-qa-recycling-allocation-plus={resource}
          disabled={percent >= 100}
          onClick={() => onChange(percent + ALLOCATION_STEP)}
        >+</button>
      </div>
    </article>
  );
}
