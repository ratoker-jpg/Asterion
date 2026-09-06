import { useMemo, useState } from 'react';
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
import { SCIENCE_PROTOTYPE_DISPLAY_STATE } from './domain/science/prototype-state.ts';
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
  const sciences = useMemo(() => sciencesForSection(section), [section]);
  const heading = SCIENCE_SECTIONS.find((item) => item.id === section)?.label ?? 'Науки';
  const queueItem = SCIENCE_PROTOTYPE_DISPLAY_STATE.queue[0];
  const queueScience = SCIENCE_CATALOG.find((science) => science.id === queueItem?.scienceId) ?? SCIENCE_CATALOG[0];

  return (
    <div className="utility-view science-view-v2">
      <aside className="science-sidebar-v2">
        <header className="science-title-v2">
          <small className="utility-secondary">ЛАБОРАТОРИЯ</small>
          <h1 className="utility-page-title">НАУКИ</h1>
        </header>

        <div className="science-lab-card-v2">
          <img className="science-lab-art-v2" src={laboratoryArt} alt="Лаборатория" draggable={false} />
          <div>
            <small className="utility-secondary">ЛАБОРАТОРИЯ</small>
            <strong className="utility-section-title">УРОВЕНЬ {SCIENCE_PROTOTYPE_DISPLAY_STATE.laboratoryLevel}</strong>
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

        <section className="science-queue-v2">
          <header>
            <span className="utility-section-title">ОЧЕРЕДЬ</span>
            <small className="utility-secondary">{SCIENCE_PROTOTYPE_DISPLAY_STATE.queue.length}/2</small>
          </header>
          {queueItem ? (
            <div className="science-queue-card-v2">
              <img src={SCIENCE_ARTS[queueScience.artSlug]} alt="" draggable={false} />
              <div>
                <strong className="utility-section-title">{queueItem.name}</strong>
                <span className="utility-secondary">{queueItem.capturedLevelLabel}</span>
                <time className="utility-data-text">{queueItem.capturedRemainingTime}</time>
              </div>
              <button type="button" className="utility-control" disabled title="Исследования будут подключены позже">×</button>
              <i><b /></i>
            </div>
          ) : <p className="utility-helper">Очередь свободна.</p>}
        </section>
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
          {sciences.map((science) => <ScienceRow key={science.id} science={science} />)}
        </div>
      </main>
    </div>
  );
}

function ScienceRow({ science }: { science: ScienceCatalogDefinition }) {
  const requirements = getRequirementState(science);

  return (
    <article className={`science-row-v2 ${requirements.available ? 'is-available' : 'is-blocked'}`} data-qa-science-available={requirements.available ? 'true' : 'false'}>
      <div className="science-art-v2">
        <img src={SCIENCE_ARTS[science.artSlug]} alt={science.name} draggable={false} />
        <span className="utility-data-text">УР. {science.capturedLevel}</span>
      </div>

      <div className="science-info-v2">
        <header>
          <div>
            <small className="utility-secondary">ИССЛЕДОВАНИЕ</small>
            <h3 className="utility-section-title">{science.name}</h3>
          </div>
        </header>
        <p className="utility-body-text">{science.description}</p>

        <div className="science-costs-v2" aria-label="Стоимость следующего уровня">
          <ResourceCost kind="M" label="Металл" value={science.capturedCost.metal} />
          <ResourceCost kind="K" label="Минералы" value={science.capturedCost.minerals} />
          <ResourceCost kind="G" label="Газ" value={science.capturedCost.gas} />
          {science.capturedCost.energy > 0 ? <ResourceCost kind="E" label="Энергия" value={science.capturedCost.energy} /> : null}
          <span className="science-time-v2"><small className="utility-secondary">ВРЕМЯ</small><strong className="utility-data-text">{science.capturedTime}</strong></span>
        </div>

        <div className="science-requirements-v2">
          <span className="science-requirements-label-v2 utility-secondary">ТРЕБОВАНИЯ</span>
          <div className="science-requirement-list-v2">
            <RequirementBadge
              label="Лаборатория"
              art={laboratoryArt}
              requiredLevel={science.laboratoryLevel}
              currentLevel={SCIENCE_PROTOTYPE_DISPLAY_STATE.laboratoryLevel}
            />
            {requirements.prerequisites.map((requirement) => (
              <RequirementBadge
                key={requirement.id}
                label={requirement.name}
                art={requirement.art}
                requiredLevel={requirement.requiredLevel}
                currentLevel={requirement.currentLevel}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="science-action-v2">
        <span className="utility-secondary">СЛЕДУЮЩИЙ УРОВЕНЬ</span>
        <strong className="utility-data-text">{science.capturedNextLevel}</strong>
        {requirements.available ? (
          <>
            <button
              type="button"
              className="utility-control science-ready-action-v2"
              disabled
              title="Условия выполнены. Реальное исследование и списание ресурсов пока не подключены."
            >
              ПОВЫСИТЬ УРОВЕНЬ ({science.capturedNextLevel})
            </button>
            <small className="science-ready-note-v2 utility-helper">Условия выполнены · запуск пока не подключён</small>
          </>
        ) : (
          <div className="science-blocked-v2" role="note" aria-label="Причина блокировки">
            <strong>ТРЕБУЕТСЯ</strong>
            {requirements.missing.map((reason) => <span key={reason}>{reason}</span>)}
          </div>
        )}
      </div>
    </article>
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
  return (
    <span
      className={`science-requirement-badge-v2 ${met ? 'is-met' : 'is-missing'}`}
      title={`${label} / Уровень: ${currentLevel} / Требуется: ${requiredLevel}`}
    >
      <img src={art} alt="" draggable={false} />
      <span>
        <b>{label}</b>
        <small>ур. {requiredLevel}</small>
      </span>
    </span>
  );
}

function getRequirementState(science: ScienceCatalogDefinition) {
  const laboratoryMet = SCIENCE_PROTOTYPE_DISPLAY_STATE.laboratoryLevel >= science.laboratoryLevel;
  const prerequisites = science.prerequisites.map((requirement) => {
    const definition = SCIENCE_CATALOG.find((item) => item.id === requirement.scienceId);
    const currentLevel = definition?.capturedLevel ?? 0;
    return {
      id: requirement.scienceId,
      name: definition?.name ?? `Наука ${requirement.scienceId}`,
      art: definition ? SCIENCE_ARTS[definition.artSlug] : '',
      requiredLevel: requirement.level,
      currentLevel,
      met: currentLevel >= requirement.level,
    };
  });

  const missing = [
    ...(!laboratoryMet ? [`Лаборатория — ур. ${science.laboratoryLevel}`] : []),
    ...prerequisites.filter((requirement) => !requirement.met).map((requirement) => `${requirement.name} — ур. ${requirement.requiredLevel}`),
  ];

  return {
    available: laboratoryMet && prerequisites.every((requirement) => requirement.met),
    prerequisites,
    missing,
  };
}

function ResourceCost({ kind, label, value }: { kind: string; label: string; value: number }) {
  return (
    <span className="science-cost-v2" title={label}>
      <i>{kind}</i>
      <strong className="utility-data-text">{new Intl.NumberFormat('ru-RU').format(value)}</strong>
    </span>
  );
}
