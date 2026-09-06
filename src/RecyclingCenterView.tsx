import { useEffect, useMemo, useState } from 'react';
import { getBuildingDefinition } from './domain/buildings/resource-zone.ts';
import {
  RECYCLING_RESOURCES,
  getRecyclingAllocationTotal,
  getRecyclingDurationMs,
  getRecyclingEfficiencyPercent,
  getRecyclingMaxConcurrentJobs,
  getRecyclingOutput,
  getRecyclingPreviewResourceOutput,
  getRecyclingStartValidation,
  getRecyclingTotalOutput,
  type RecyclingResource,
  type RecyclingState,
  type ResourceAllocationPercent,
} from './domain/buildings/recycling.ts';
import './recycling-center.css';

type RecyclingCenterViewProps = {
  planetName: string;
  buildingLevel: number;
  recycling: RecyclingState;
  now: number;
  onStart: (debrisAmount: number, allocation: ResourceAllocationPercent) => boolean;
  onCollect: (jobId: string) => boolean;
  onBack: () => void;
};

const RESOURCE_META: Readonly<Record<RecyclingResource, { label: string; short: string }>> = {
  metal: { label: 'Металл', short: 'М' },
  minerals: { label: 'Минералы', short: 'Мин' },
  gas: { label: 'Газ', short: 'Газ' },
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.max(0, Math.floor(value)));
}

function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatAllocation(allocation: ResourceAllocationPercent) {
  return RECYCLING_RESOURCES
    .map((resource) => `${allocation[resource]}% ${RESOURCE_META[resource].label.toLocaleLowerCase('ru-RU')}`)
    .join(' · ');
}

function formatOutput(output: { metal: number; minerals: number; gas: number }) {
  return RECYCLING_RESOURCES
    .map((resource) => `${RESOURCE_META[resource].short} ${formatNumber(output[resource])}`)
    .join(' · ');
}

function ResourceIcon({ resource }: { resource: RecyclingResource }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (resource === 'metal') {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m7 8 9-4 9 4-9 5-9-5Z"/><path {...common} d="m7 8 9 5v14l-9-5V8Zm18 0-9 5v14l9-5V8Z"/></svg>;
  }
  if (resource === 'minerals') {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m16 3 10 10-10 16L6 13 16 3Z"/><path {...common} d="M6 13h20M16 3v26"/></svg>;
  }
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M16 4c5.6 6.8 8 11 8 15a8 8 0 1 1-16 0c0-4 2.4-8.2 8-15Z"/><circle {...common} cx="13" cy="18" r="2.2"/><circle {...common} cx="19.5" cy="21" r="1.6"/></svg>;
}

export function RecyclingCenterView({
  planetName,
  buildingLevel,
  recycling,
  now,
  onStart,
  onCollect,
  onBack,
}: RecyclingCenterViewProps) {
  const building = getBuildingDefinition('recycling');
  const [debrisAmount, setDebrisAmount] = useState(0);
  const [allocation, setAllocation] = useState<ResourceAllocationPercent>({ metal: 0, minerals: 0, gas: 0 });
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setDebrisAmount((current) => Math.min(current, recycling.availableDebris));
  }, [recycling.availableDebris]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const efficiencyPercent = getRecyclingEfficiencyPercent(buildingLevel);
  const maxJobs = getRecyclingMaxConcurrentJobs(buildingLevel);
  const allocationTotal = getRecyclingAllocationTotal(allocation);
  const totalDebris = recycling.availableDebris + recycling.jobs.reduce((total, job) => total + job.debrisAmount, 0);
  const totalOutput = getRecyclingTotalOutput(debrisAmount, efficiencyPercent);
  const durationMs = getRecyclingDurationMs(debrisAmount);
  const validation = getRecyclingStartValidation(recycling, buildingLevel, debrisAmount, allocation);
  const exactPreview = allocationTotal === 100 ? getRecyclingOutput(debrisAmount, efficiencyPercent, allocation) : null;

  const resourcePreview = useMemo(() => Object.fromEntries(RECYCLING_RESOURCES.map((resource) => [
    resource,
    exactPreview
      ? exactPreview[resource]
      : getRecyclingPreviewResourceOutput(debrisAmount, efficiencyPercent, allocation[resource]),
  ])) as Record<RecyclingResource, number>, [debrisAmount, efficiencyPercent, allocation, exactPreview]);

  const changeDebris = (requested: number) => {
    setDebrisAmount(Math.min(recycling.availableDebris, Math.max(0, Math.floor(requested))));
  };

  const changeAllocation = (resource: RecyclingResource, requested: number) => {
    setAllocation((current) => ({
      ...current,
      [resource]: Math.min(100, Math.max(0, Math.floor(requested))),
    }));
  };

  const startProcess = () => {
    if (!validation.canStart) return;
    const started = onStart(debrisAmount, { ...allocation });
    if (!started) return;
    setDebrisAmount(0);
    setToast('Переработка запущена');
  };

  const collect = (jobId: string) => {
    if (!onCollect(jobId)) return;
    setToast('Ресурсы получены');
  };

  return (
    <main className="recycling-center-view" data-qa-recycling-center>
      <aside className="recycling-info-panel">
        <div className="recycling-info-art">
          <img src={building.art} alt={building.name} draggable={false} />
        </div>
        <div className="recycling-info-copy">
          <small>ASTERION // ПРОМЫШЛЕННЫЙ МОДУЛЬ</small>
          <h1>{building.name}</h1>
          <p>{planetName}</p>
          <div className="recycling-level">УРОВЕНЬ <strong data-qa-recycling-level>{buildingLevel}</strong></div>
        </div>

        <dl className="recycling-info-stats">
          <div><dt>Выход после переработки</dt><dd data-qa-recycling-efficiency>{efficiencyPercent}%</dd></div>
          {buildingLevel < building.maxLevel ? <div><dt>Следующий уровень</dt><dd data-qa-recycling-next-efficiency>{Math.min(120, efficiencyPercent + 5)}%</dd></div> : null}
          <div><dt>Максимум процессов</dt><dd data-qa-recycling-max-jobs>{maxJobs}</dd></div>
          <div><dt>Всего обломков</dt><dd data-qa-recycling-total-debris={totalDebris}>{formatNumber(totalDebris)}</dd></div>
          <div><dt>Свободный остаток</dt><dd data-qa-recycling-free-debris={recycling.availableDebris}>{formatNumber(recycling.availableDebris)}</dd></div>
          <div><dt>Занято процессов</dt><dd data-qa-recycling-job-count={recycling.jobs.length}>{recycling.jobs.length} / {maxJobs}</dd></div>
        </dl>

        <button className="recycling-back" type="button" data-qa-building-interior-back data-qa-recycling-back onClick={onBack}>
          <span aria-hidden="true">←</span> Назад в Перерабатывающий центр
        </button>
      </aside>

      <section className="recycling-workspace">
        <section className="recycling-section recycling-jobs-section" aria-label="Переработка">
          <header className="recycling-section-header">
            <div><small>АКТИВНЫЕ И ГОТОВЫЕ</small><h2>ПЕРЕРАБОТКА</h2></div>
            <strong>{recycling.jobs.length} / {maxJobs}</strong>
          </header>

          {recycling.jobs.length === 0 ? (
            <div className="recycling-jobs-empty" data-qa-recycling-empty>
              <span>◇</span><div><strong>Нет активных процессов</strong><small>Выбери обломки и распределение ресурсов ниже.</small></div>
            </div>
          ) : (
            <div className="recycling-job-scroll" data-qa-recycling-job-list>
              <div className="recycling-job-table">
                <div className="recycling-job-table__header" data-qa-recycling-job-table-header>
                  <span>ВРЕМЯ</span>
                  <span>ОБЛОМКИ</span>
                  <span>ПЕРЕРАБОТКА / ВЫХОД</span>
                  <span>СТАТУС</span>
                  <span>ДЕЙСТВИЕ</span>
                </div>
                <div className="recycling-job-rows">
                  {recycling.jobs.map((job) => {
                    const ready = job.status === 'ready' || now >= job.finishAt;
                    const progress = ready
                      ? 100
                      : Math.min(100, Math.max(0, ((now - job.startedAt) / Math.max(1, job.finishAt - job.startedAt)) * 100));
                    const expiresAt = job.collectExpiresAt ?? job.finishAt + 24 * 60 * 60 * 1000;
                    const timerLabel = ready ? 'Получить до:' : 'Осталось:';
                    const timerValue = ready ? formatClock(expiresAt - now) : formatClock(job.finishAt - now);

                    return (
                      <article className={`recycling-job-row ${ready ? 'ready' : 'processing'}`} key={job.id} data-qa-recycling-job={job.id} data-qa-recycling-status={ready ? 'ready' : 'processing'}>
                        <div className="recycling-job-cell recycling-job-time" data-qa-recycling-job-timer>
                          <small>{timerLabel}</small>
                          <strong>{timerValue}</strong>
                        </div>
                        <div className="recycling-job-cell recycling-job-debris">
                          <strong>{formatNumber(job.debrisAmount)}</strong>
                          <small>обломков</small>
                        </div>
                        <div className="recycling-job-cell recycling-job-conversion">
                          <span className="recycling-job-allocation" data-qa-recycling-job-allocation>{formatAllocation(job.allocationPercent)}</span>
                          <strong className="recycling-job-output" data-qa-recycling-job-output>{formatOutput(job.output)}</strong>
                        </div>
                        <div className="recycling-job-cell recycling-job-status">
                          <span className="recycling-job-state">{ready ? 'ГОТОВО' : 'В ПРОЦЕССЕ'}</span>
                          <div className="recycling-job-progress" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
                        </div>
                        <div className="recycling-job-cell recycling-job-action">
                          <button type="button" data-qa-recycling-collect={job.id} disabled={!ready} onClick={() => collect(job.id)}>ВЗЯТЬ РЕСУРС</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="recycling-section recycling-distillation" aria-label="Дистилляция">
          <header className="recycling-section-header">
            <div><small>ВЫБОР ОБЪЁМА</small><h2>ДИСТИЛЛЯЦИЯ</h2></div>
            <strong data-qa-recycling-free-slots>{Math.max(0, maxJobs - recycling.jobs.length)} СВОБ. СЛОТОВ</strong>
          </header>
          <div className="recycling-debris-control">
            <div className="recycling-debris-label"><small>ОБЛОМКИ</small><strong data-qa-recycling-debris-value={debrisAmount}>{formatNumber(debrisAmount)}</strong></div>
            <button type="button" data-qa-recycling-debris-minus disabled={debrisAmount <= 0} onClick={() => changeDebris(debrisAmount - 1000)}>−</button>
            <input
              type="range"
              min={0}
              max={recycling.availableDebris}
              step={1}
              value={debrisAmount}
              aria-label="Количество обломков"
              data-qa-recycling-debris-slider
              onChange={(event) => changeDebris(Number(event.target.value))}
            />
            <button type="button" data-qa-recycling-debris-plus disabled={debrisAmount >= recycling.availableDebris} onClick={() => changeDebris(debrisAmount + 1000)}>+</button>
            <button type="button" className="recycling-max-button" data-qa-recycling-debris-max disabled={recycling.availableDebris <= 0} onClick={() => changeDebris(recycling.availableDebris)}>МАКС.</button>
          </div>
          <div className="recycling-preview-strip">
            <div><small>ВРЕМЯ</small><strong data-qa-recycling-duration>{debrisAmount > 0 ? formatClock(durationMs) : '00:00:00'}</strong></div>
            <div><small>ЭФФЕКТИВНОСТЬ</small><strong>{efficiencyPercent}%</strong></div>
            <div><small>ОБЩИЙ ВЫХОД</small><strong data-qa-recycling-total-output={totalOutput}>{formatNumber(totalOutput)}</strong></div>
          </div>
        </section>

        <section className="recycling-section recycling-targets" aria-label="Целевые ресурсы">
          <header className="recycling-section-header">
            <div><small>РАСПРЕДЕЛЕНИЕ ВЫХОДА</small><h2>ЦЕЛЕВЫЕ РЕСУРСЫ</h2></div>
            <strong data-qa-recycling-allocation-total={allocationTotal}>РАСПРЕДЕЛЕНО: {allocationTotal} / 100%</strong>
          </header>

          <div className="recycling-target-list">
            {RECYCLING_RESOURCES.map((resource) => {
              const meta = RESOURCE_META[resource];
              const percent = allocation[resource];
              return (
                <div className="recycling-target-row" key={resource} data-qa-recycling-resource={resource}>
                  <div className="recycling-target-resource"><span><ResourceIcon resource={resource} /></span><div><small>РЕСУРС</small><strong>{meta.label}</strong></div></div>
                  <button type="button" data-qa-recycling-allocation-minus={resource} disabled={percent <= 0} onClick={() => changeAllocation(resource, percent - 1)}>−</button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={percent}
                    aria-label={`Доля: ${meta.label}`}
                    data-qa-recycling-allocation-slider={resource}
                    onChange={(event) => changeAllocation(resource, Number(event.target.value))}
                  />
                  <button type="button" data-qa-recycling-allocation-plus={resource} disabled={percent >= 100} onClick={() => changeAllocation(resource, percent + 1)}>+</button>
                  <strong className="recycling-target-percent" data-qa-recycling-allocation-value={resource}>{percent}%</strong>
                  <div className="recycling-target-preview"><small>ПОЛУЧИТЕ</small><strong data-qa-recycling-resource-output={resource}>{formatNumber(resourcePreview[resource])}</strong></div>
                </div>
              );
            })}
          </div>

          <footer className="recycling-target-footer">
            <div className={`recycling-validation ${validation.canStart ? 'valid' : ''}`} data-qa-recycling-validation>
              {validation.canStart ? 'Распределение готово' : validation.reason}
            </div>
            <button className="recycling-start" type="button" data-qa-recycling-start disabled={!validation.canStart} onClick={startProcess}>НАЧАТЬ ПЕРЕРАБОТКУ</button>
          </footer>
        </section>
      </section>

      <div className={`recycling-toast ${toast ? 'visible' : ''}`} aria-live="polite" aria-atomic="true" data-qa-recycling-toast>
        {toast ? <span><b aria-hidden="true">✓</b>{toast}</span> : null}
      </div>
    </main>
  );
}
