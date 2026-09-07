import { useEffect, useMemo, useState } from 'react';
import laboratoryArt from '../assets/source/New assets/buildings/aegis/building.aegis.research.png';
import astronomyArt from '../assets/source/New assets/technologies/technology.shared.astronomy.png';
import chemistryArt from '../assets/source/New assets/technologies/technology.shared.chemistry.png';
import computerSystemsArt from '../assets/source/New assets/technologies/technology.shared.computer-systems.png';
import criticalHitArt from '../assets/source/New assets/technologies/technology.shared.critical-hit.png';
import ecologyArt from '../assets/source/New assets/technologies/technology.shared.ecology.png';
import espionageArt from '../assets/source/New assets/technologies/technology.shared.espionage.png';
import fuelCellsArt from '../assets/source/New assets/technologies/technology.shared.fuel-cells.png';
import heavyArmorArt from '../assets/source/New assets/technologies/technology.shared.heavy-armor.png';
import hyperspaceArt from '../assets/source/New assets/technologies/technology.shared.hyperspace.png';
import improvedConstructionArt from '../assets/source/New assets/technologies/technology.shared.improved-construction.png';
import ionScienceArt from '../assets/source/New assets/technologies/technology.shared.ion-science.png';
import jetEnginesArt from '../assets/source/New assets/technologies/technology.shared.jet-engines.png';
import laserScienceArt from '../assets/source/New assets/technologies/technology.shared.laser-science.png';
import lightArmorArt from '../assets/source/New assets/technologies/technology.shared.light-armor.png';
import maneuverDefenseArt from '../assets/source/New assets/technologies/technology.shared.maneuver-defense.png';
import mathematicsArt from '../assets/source/New assets/technologies/technology.shared.mathematics.png';
import mediumArmorArt from '../assets/source/New assets/technologies/technology.shared.medium-armor.png';
import parallelUniversesArt from '../assets/source/New assets/technologies/technology.shared.parallel-universes.png';
import physicsArt from '../assets/source/New assets/technologies/technology.shared.physics.png';
import piercingAttackArt from '../assets/source/New assets/technologies/technology.shared.piercing-attack.png';
import plasmaScienceArt from '../assets/source/New assets/technologies/technology.shared.plasma-science.png';
import shipArmorArt from '../assets/source/New assets/technologies/technology.shared.ship-armor.png';
import {
  ADDITIONAL_SCIENCE_HINT,
  SCIENCE_CATALOG,
  SCIENCE_SECTIONS,
} from './domain/science/catalog.ts';
import {
  SCIENCE_CAPTURED_VALUES_NOTE,
  SCIENCE_LABORATORY_MAX_LEVEL,
  SCIENCE_LABORATORY_TIME_REDUCTION_PER_LEVEL,
  SCIENCE_QUEUE_CAPACITY,
  SCIENCE_RUNTIME_CHANGED_EVENT,
  SCIENCE_START_REQUEST_EVENT,
  previewScience,
  readScienceRuntimeSnapshot,
  reconcileScienceState,
  type ScienceId,
  type ScienceRuntimeSnapshot,
  type ScienceState,
} from './domain/science/runtime.ts';
import { sciencesForSection } from './domain/science/selectors.ts';
import type { ScienceCatalogDefinition, ScienceSectionId } from './domain/science/types.ts';

const SCIENCE_ARTS: Record<string, string> = {
  'technology.shared.astronomy.png': astronomyArt,
  'technology.shared.chemistry.png': chemistryArt,
  'technology.shared.computer-systems.png': computerSystemsArt,
  'technology.shared.critical-hit.png': criticalHitArt,
  'technology.shared.ecology.png': ecologyArt,
  'technology.shared.espionage.png': espionageArt,
  'technology.shared.fuel-cells.png': fuelCellsArt,
  'technology.shared.heavy-armor.png': heavyArmorArt,
  'technology.shared.hyperspace.png': hyperspaceArt,
  'technology.shared.improved-construction.png': improvedConstructionArt,
  'technology.shared.ion-science.png': ionScienceArt,
  'technology.shared.jet-engines.png': jetEnginesArt,
  'technology.shared.laser-science.png': laserScienceArt,
  'technology.shared.light-armor.png': lightArmorArt,
  'technology.shared.maneuver-defense.png': maneuverDefenseArt,
  'technology.shared.mathematics.png': mathematicsArt,
  'technology.shared.medium-armor.png': mediumArmorArt,
  'technology.shared.parallel-universes.png': parallelUniversesArt,
  'technology.shared.physics.png': physicsArt,
  'technology.shared.piercing-attack.png': piercingAttackArt,
  'technology.shared.plasma-science.png': plasmaScienceArt,
  'technology.shared.ship-armor.png': shipArmorArt,
};

export function ScienceView() {
  const [section, setSection] = useState<ScienceSectionId>('basic');
  const [runtime, setRuntime] = useState<ScienceRuntimeSnapshot>(() => readScienceRuntimeSnapshot());
  const [now, setNow] = useState(() => Date.now());
  const sciences = useMemo(() => sciencesForSection(section), [section]);
  const heading = SCIENCE_SECTIONS.find((item) => item.id === section)?.label ?? 'Науки';
  const reconciled = reconcileScienceState(runtime.science, now);
  const scienceState = reconciled.state;
  const effectiveRuntime = { ...runtime, science: scienceState, now };

  useEffect(() => {
    const onRuntimeChanged = (event: Event) => {
      const next = (event as CustomEvent<ScienceRuntimeSnapshot>).detail;
      if (next?.science && next.wallet) setRuntime(next);
    };
    const onStorage = () => setRuntime(readScienceRuntimeSnapshot());
    window.addEventListener(SCIENCE_RUNTIME_CHANGED_EVENT, onRuntimeChanged);
    window.addEventListener('storage', onStorage);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.removeEventListener(SCIENCE_RUNTIME_CHANGED_EVENT, onRuntimeChanged);
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
    };
  }, []);

  const startResearch = (scienceId: ScienceId) => {
    window.dispatchEvent(new CustomEvent(SCIENCE_START_REQUEST_EVENT, {
      detail: { scienceId, now: Date.now() },
    }));
  };

  return (
    <div className="utility-view science-view-v2" data-qa-science-root>
      <aside className="science-sidebar-v2">
        <header className="science-title-v2">
          <small className="utility-secondary">ЛАБОРАТОРИЯ</small>
          <h1 className="utility-page-title">НАУКИ</h1>
        </header>

        <div className="science-lab-card-v2">
          <img className="science-lab-art-v2" src={laboratoryArt} alt="Лаборатория" draggable={false} />
          <div>
            <small className="utility-secondary">ЛАБОРАТОРИЯ</small>
            <strong className="utility-section-title" data-qa-science-laboratory-level>УРОВЕНЬ {effectiveRuntime.laboratoryLevel} / {SCIENCE_LABORATORY_MAX_LEVEL}</strong>
            <small className="science-lab-speed-v2" data-qa-science-laboratory-speed>−{Math.round(SCIENCE_LABORATORY_TIME_REDUCTION_PER_LEVEL * 100)}% времени за уровень</small>
          </div>
        </div>

        <nav className="science-sections-v2" aria-label="Разделы наук">
          {SCIENCE_SECTIONS.map((item) => (
            <button type="button" key={item.id} className={`utility-control ${section === item.id ? 'active' : ''}`} onClick={() => setSection(item.id)}>
              <span>{item.label}</span>
              <b>{sciencesForSection(item.id).length}</b>
            </button>
          ))}
        </nav>

        <section className="science-queue-v2" data-qa-science-queue>
          <header>
            <span className="utility-section-title">ОЧЕРЕДЬ</span>
            <small className="utility-secondary" data-qa-science-queue-count>{scienceState.queue.length}/{SCIENCE_QUEUE_CAPACITY}</small>
          </header>
          {scienceState.queue.length > 0 ? scienceState.queue.map((task) => (
            <ScienceQueueCard key={task.id} task={task} now={now} />
          )) : <p className="utility-helper">Очередь свободна.</p>}
        </section>
        <small className="science-captured-note utility-helper" title={SCIENCE_CAPTURED_VALUES_NOTE}>Стоимость и время: сохранённые prototype/captured значения.</small>
      </aside>

      <main className="science-main-v2">
        <header className="science-main-heading-v2">
          <div>
            <small className="utility-secondary">КАТАЛОГ ИССЛЕДОВАНИЙ</small>
            <h2 className="utility-section-title">{heading.toUpperCase()}</h2>
          </div>
          <span className="science-count-v2 utility-data-text">{sciences.length} НАУК</span>
        </header>

        {section === 'additional' ? <div className="science-additional-hint-v2 utility-helper"><b>ВНИМАНИЕ</b>{ADDITIONAL_SCIENCE_HINT}</div> : null}

        <div className="science-catalog-v2" data-qa-scroll="science-catalog">
          {sciences.map((science) => (
            <ScienceRow key={science.id} science={science} runtime={effectiveRuntime} onStart={startResearch} />
          ))}
        </div>
      </main>
    </div>
  );
}

function ScienceQueueCard({ task, now }: { task: ScienceState['queue'][number]; now: number }) {
  const science = SCIENCE_CATALOG.find((item) => item.id === task.scienceId);
  if (!science) return null;
  const duration = Math.max(1, task.finishAt - task.startedAt);
  const progress = Math.min(100, Math.max(0, ((now - task.startedAt) / duration) * 100));
  return (
    <div className="science-queue-card-v2" data-qa-science-queue-task={science.id}>
      <img src={SCIENCE_ARTS[science.artSlug]} alt="" draggable={false} />
      <div>
        <strong className="utility-section-title">{science.name}</strong>
        <span className="utility-secondary">Уровень {task.fromLevel} → {task.toLevel}</span>
        <time className="utility-data-text" data-qa-science-remaining>{formatDuration(Math.max(0, task.finishAt - now))}</time>
      </div>
      <button type="button" className="utility-control" disabled title="Отмена недоступна: правило возврата ресурсов не подтверждено источником">×</button>
      <i><b style={{ width: `${progress}%` }} /></i>
    </div>
  );
}

function ScienceRow({
  science,
  runtime,
  onStart,
}: {
  science: ScienceCatalogDefinition;
  runtime: ScienceRuntimeSnapshot;
  onStart: (scienceId: ScienceId) => void;
}) {
  const preview = previewScience({ state: runtime.science, wallet: runtime.wallet, laboratoryLevel: runtime.laboratoryLevel, now: runtime.now, mode: runtime.mode }, science.id);
  const currentLevel = preview.currentLevel;
  const actionLabel = preview.status === 'max-level'
    ? 'МАКСИМАЛЬНЫЙ УРОВЕНЬ'
    : preview.status === 'queue-full'
      ? 'ОЧЕРЕДЬ ЗАПОЛНЕНА'
      : preview.status === 'insufficient-resource'
        ? 'НЕДОСТАТОЧНО РЕСУРСОВ'
        : preview.status === 'additional-direction-blocked'
          ? 'НАПРАВЛЕНИЕ ЗАБЛОКИРОВАНО'
          : `ПОВЫСИТЬ УРОВЕНЬ (${preview.nextLevel ?? currentLevel + 1})`;
  const note = preview.canStart
    ? `Условия выполнены · очередь ${preview.queuedCount}/${SCIENCE_QUEUE_CAPACITY}`
    : preview.reason ?? 'Исследование недоступно.';

  return (
    <article className={`science-row-v2 ${preview.canStart ? 'is-available' : 'is-blocked'}`} data-qa-science-id={science.id} data-qa-science-status={preview.status}>
      <div className="science-art-v2">
        <img src={SCIENCE_ARTS[science.artSlug]} alt={science.name} draggable={false} />
        <span className="utility-data-text" data-qa-science-level>УР. {currentLevel} / {preview.maxLevel}</span>
      </div>

      <div className="science-info-v2">
        <header>
          <div>
            <small className="utility-secondary">ИССЛЕДОВАНИЕ</small>
            <h3 className="utility-section-title">{science.name}</h3>
          </div>
        </header>
        <p className="utility-body-text">{science.description}</p>

        <ScienceLevelProgress
          currentLevel={currentLevel}
          projectedLevel={preview.projectedLevel}
          queuedCount={preview.queuedCount}
          nextLevel={preview.nextLevel}
          maxLevel={preview.maxLevel}
        />

        {!preview.canStart && preview.status !== 'max-level' ? (
          <div className="science-missing-banner-v2" role="note">{preview.reason}</div>
        ) : null}

        <div className="science-costs-v2" aria-label="Стоимость следующего уровня">
          <ResourceCost kind="M" label="Металл" value={preview.cost.metal} available={runtime.wallet.metal} />
          <ResourceCost kind="K" label="Минералы" value={preview.cost.minerals} available={runtime.wallet.minerals} />
          <ResourceCost kind="G" label="Газ" value={preview.cost.gas} available={runtime.wallet.gas} />
          {preview.cost.energy > 0 ? <ResourceCost kind="E" label="Энергия" value={preview.cost.energy} available={runtime.wallet.energy} /> : null}
          <span className="science-time-v2"><small className="utility-secondary">ВРЕМЯ</small><strong className="utility-data-text">{formatDuration(preview.durationMs)}</strong></span>
        </div>

        <div className="science-requirements-v2">
          {preview.requirements.map((requirement) => (
            <RequirementBadge
              key={`${requirement.kind}-${requirement.scienceId ?? 'laboratory'}`}
              label={requirement.label}
              art={requirement.kind === 'laboratory-level' ? laboratoryArt : SCIENCE_ARTS[SCIENCE_CATALOG.find((item) => item.id === requirement.scienceId)?.artSlug ?? '']}
              requiredLevel={requirement.requiredLevel}
              currentLevel={requirement.currentLevel}
            />
          ))}
        </div>
      </div>

      <div className="science-action-v2">
        <span className="utility-secondary">СЛЕДУЮЩИЙ УРОВЕНЬ</span>
        <strong className="utility-data-text">{preview.nextLevel ?? currentLevel}</strong>
        <button
          type="button"
          className="utility-control science-ready-action-v2"
          data-qa-science-action
          disabled={!preview.canStart}
          title={note}
          onClick={() => onStart(science.id)}
        >
          {actionLabel}
        </button>
        <small className={`${preview.canStart ? 'science-ready-note-v2' : 'science-blocked-note-v2'} utility-helper`}>
          {note}
        </small>
      </div>
    </article>
  );
}

function ScienceLevelProgress({
  currentLevel,
  projectedLevel,
  queuedCount,
  nextLevel,
  maxLevel,
}: {
  currentLevel: number;
  projectedLevel: number;
  queuedCount: number;
  nextLevel: number | null;
  maxLevel: number;
}) {
  const isMax = currentLevel >= maxLevel;

  return (
    <section
      className={`science-level-progress-v2 ${isMax ? 'is-max' : ''}`}
      data-qa-science-level-progress
      data-qa-current-level={currentLevel}
      data-qa-projected-level={projectedLevel}
      data-qa-max-level={maxLevel}
      aria-label={`Текущий уровень ${currentLevel} из ${maxLevel}. Заказано уровней: ${queuedCount}.`}
    >
      <div className="science-level-progress-meta-v2">
        <span>Фактический уровень <b>{currentLevel}</b> / {maxLevel}</span>
        {isMax ? (
          <strong>Максимальный уровень</strong>
        ) : (
          <>
            <span>Заказано <b>+{queuedCount}</b> → {projectedLevel}</span>
            <span>Следующий <b>{nextLevel ?? 'MAX'}</b></span>
          </>
        )}
      </div>
      <div className="science-level-segments-v2" aria-hidden="true">
        {Array.from({ length: maxLevel }, (_, index) => {
          const level = index + 1;
          const className = level <= currentLevel
            ? 'is-complete'
            : level <= projectedLevel
              ? 'is-queued'
              : 'is-future';
          return <i key={level} className={className} data-level={level} />;
        })}
      </div>
    </section>
  );
}

function RequirementBadge({
  label,
  art,
  requiredLevel,
  currentLevel,
}: {
  label: string;
  art: string;
  requiredLevel: number;
  currentLevel: number;
}) {
  const met = currentLevel >= requiredLevel;
  const tooltip = `${label}\nУровень: ${currentLevel}\nТребуется: ${requiredLevel}`;
  return (
    <span
      className={`science-requirement-badge-v2 ${met ? 'is-met' : 'is-missing'}`}
      title={tooltip}
      aria-label={`${label}. Текущий уровень ${currentLevel}. Требуется ${requiredLevel}.`}
    >
      <img src={art} alt="" draggable={false} />
      <b className="utility-data-text">{requiredLevel}</b>
    </span>
  );
}

function ResourceCost({ kind, label, value, available }: { kind: string; label: string; value: number; available: number }) {
  return (
    <span className={`science-cost-v2 ${available < value ? 'is-insufficient' : ''}`} title={`${label}: доступно ${formatNumber(available)}`}>
      <i>{kind}</i>
      <strong className="utility-data-text">{formatNumber(value)}</strong>
    </span>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
