import { useMemo, useState } from 'react';

import { SCIENCE_CATALOG, SCIENCE_CATEGORIES, STELLAR_RESEARCH_SOURCE } from './domain/science/catalog.ts';
import { getScienceNode, searchScienceCatalog } from './domain/science/selectors.ts';
import type { ScienceCatalogItem, ScienceCategoryId } from './domain/science/types.ts';
import './science.css';

type LaboratorySectionId = 'basic' | 'advanced' | 'master' | 'additional';

type LaboratorySection = {
  id: LaboratorySectionId;
  label: string;
  shortLabel: string;
  description: string;
  range: readonly [number, number];
};

const NEMEXIA_LAB_SOURCE = Object.freeze({
  repository: 'ratoker-jpg/Nemexia_auto_v2',
  commit: '61a361e7067e532df69fa314242fb0da1d121d75',
  path: 'saved_pages/наука',
});

const LABORATORY_SECTIONS: readonly LaboratorySection[] = Object.freeze([
  { id: 'basic', label: 'ОСНОВНЫЕ НАУКИ', shortLabel: 'ОСНОВНЫЕ', description: 'Фундаментальная научная база империи.', range: [0, 4] },
  { id: 'advanced', label: 'ВЫСОКОТЕХНОЛОГИЧНЫЕ НАУКИ', shortLabel: 'ВЫСОКИЕ', description: 'Разведка, вычисления, двигатели, броня и оружие.', range: [4, 13] },
  { id: 'master', label: 'ЭКСПЕРТНЫЕ НАУКИ', shortLabel: 'ЭКСПЕРТНЫЕ', description: 'Поздние пространственные и инженерные исследования.', range: [13, 17] },
  { id: 'additional', label: 'ДОПОЛНИТЕЛЬНЫЕ НАУКИ', shortLabel: 'ДОПОЛНИТЕЛЬНЫЕ', description: 'Специализированные боевые направления.', range: [17, 22] },
]);

function ScienceGlyph({ category }: { category: ScienceCategoryId }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.55, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (category === 'energy') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m18 3-9 14h7l-2 12 9-15h-7l2-11Z"/><circle {...common} cx="16" cy="16" r="13"/></svg>;
  if (category === 'infrastructure') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M5 27V14l7 4v-5l7 4V7h7v20H5Z"/><path {...common} d="M9 23h3m3 0h3m3 0h2M21 7V3h4v4"/></svg>;
  if (category === 'navigation') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="4"/><ellipse {...common} cx="16" cy="16" rx="13" ry="6" transform="rotate(28 16 16)"/></svg>;
  if (category === 'intelligence') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M3 16s5-9 13-9 13 9 13 9-5 9-13 9S3 16 3 16Z"/><circle {...common} cx="16" cy="16" r="4"/></svg>;
  if (category === 'defense') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M16 3 27 8v8c0 7-4.5 11-11 14C9.5 27 5 23 5 16V8l11-5Z"/><path {...common} d="M10 14h12M12 10h8M12 19h8"/></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="4"/><ellipse {...common} cx="16" cy="16" rx="12" ry="5"/><ellipse {...common} cx="16" cy="16" rx="12" ry="5" transform="rotate(60 16 16)"/><ellipse {...common} cx="16" cy="16" rx="12" ry="5" transform="rotate(-60 16 16)"/></svg>;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}м ${rest}с` : `${minutes}м`;
}

function getCategoryLabel(id: ScienceCategoryId) {
  return SCIENCE_CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

function sectionItems(section: LaboratorySection) {
  return SCIENCE_CATALOG.slice(section.range[0], section.range[1]);
}

function RequirementPill({ scienceId, level }: { scienceId: string; level: number }) {
  const science = getScienceNode(scienceId);
  return <span className="science-requirement-pill"><b>{science?.name ?? scienceId}</b><em>LV {level}</em></span>;
}

function ResearchCard({ item, index }: { item: ScienceCatalogItem; index: number }) {
  return <article className={`science-research-card science-tone--${item.categoryId}`}>
    <div className="science-card-thumb">
      <div className="science-card-number">{String(index + 1).padStart(2, '0')}</div>
      <div className="science-card-orb"><ScienceGlyph category={item.categoryId} /></div>
      <div className="science-card-level"><span>КАТАЛОГ</span><b>MAX {item.maxLevel}</b></div>
    </div>
    <div className="science-card-body">
      <header><div><small>{getCategoryLabel(item.categoryId)}</small><h3>{item.name}</h3></div>{item.combatTechnologyId ? <span className="science-combat-tag">COMBAT</span> : null}</header>
      <p>{item.description}</p>
      <div className="science-card-costs">
        <span><i>M</i><b>{item.baseCost.metal.toLocaleString('ru-RU')}</b><small>металл</small></span>
        <span><i>C</i><b>{item.baseCost.crystal.toLocaleString('ru-RU')}</b><small>минералы</small></span>
        <span><i>G</i><b>{item.baseCost.gas.toLocaleString('ru-RU')}</b><small>газ</small></span>
      </div>
      <div className="science-card-meta"><span><small>ВРЕМЯ</small><b>{formatDuration(item.baseSeconds)}</b></span><span><small>ЛАБОРАТОРИЯ</small><b>LV {item.requiredLaboratoryLevel}</b></span><span><small>ЭФФЕКТ</small><b>{item.effects[0]?.valueLabel ?? '—'}</b></span></div>
      <div className="science-card-requirements"><small>ТРЕБОВАНИЯ</small><div>{item.requirements.length ? item.requirements.map((requirement) => <RequirementPill key={`${requirement.scienceId}-${requirement.level}`} scienceId={requirement.scienceId} level={requirement.level} />) : <span className="science-requirement-empty">Базовая наука</span>}</div></div>
    </div>
  </article>;
}

export function ScienceView() {
  const [sectionId, setSectionId] = useState<LaboratorySectionId>('basic');
  const [query, setQuery] = useState('');
  const activeSection = LABORATORY_SECTIONS.find((section) => section.id === sectionId) ?? LABORATORY_SECTIONS[0];
  const allMatches = useMemo(() => new Set(searchScienceCatalog(query).map((item) => item.id)), [query]);
  const activeItems = useMemo(() => sectionItems(activeSection).filter((item) => !query.trim() || allMatches.has(item.id)), [activeSection, allMatches, query]);

  const selectSection = (next: LaboratorySectionId) => {
    setSectionId(next);
    setQuery('');
  };

  return <main className="science-view">
    <header className="utility-view-heading science-heading">
      <div><small>ЛАБОРАТОРИЯ · NEMEXIA STRUCTURE / STELLAR DATA</small><h1>НАУКА</h1><p>22 реальные науки текущего каталога, собранные по лабораторным разделам вместо абстрактной матрицы.</p></div>
      <div className="science-source-stack"><span><i />STELLAR DATA · {STELLAR_RESEARCH_SOURCE.commit.slice(0, 7)}</span><span><i />NEMEXIA UI · {NEMEXIA_LAB_SOURCE.commit.slice(0, 7)}</span></div>
    </header>

    <section className="science-lab-head">
      <div className="science-lab-facility"><div className="science-facility-icon"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="5"/><ellipse cx="24" cy="24" rx="18" ry="8"/><ellipse cx="24" cy="24" rx="18" ry="8" transform="rotate(60 24 24)"/><ellipse cx="24" cy="24" rx="18" ry="8" transform="rotate(-60 24 24)"/></svg></div><div><small>ИССЛЕДОВАТЕЛЬСКИЙ КОМПЛЕКС</small><strong>ЭКСПЕРИМЕНТАЛЬНЫЙ ЦЕНТР</strong><span>Каталог наук · runtime исследований пока не подключён</span></div></div>
      <div className="science-lab-summary"><span><small>НАУК</small><b>22</b></span><span><small>РАЗДЕЛОВ</small><b>4</b></span><span><small>АКТИВНЫЙ РАЗДЕЛ</small><b>{activeSection.shortLabel}</b></span><span><small>COMBAT LINK</small><b>{SCIENCE_CATALOG.filter((item) => item.combatTechnologyId).length}</b></span></div>
    </section>

    <nav className="science-lab-tabs" aria-label="Разделы лаборатории">
      {LABORATORY_SECTIONS.map((section) => <button type="button" key={section.id} className={sectionId === section.id ? 'active' : ''} onClick={() => selectSection(section.id)}><span className="science-tab-index">{String(LABORATORY_SECTIONS.indexOf(section) + 1).padStart(2, '0')}</span><span><strong>{section.label}</strong><small>{section.description}</small></span><b>{section.range[1] - section.range[0]}</b></button>)}
    </nav>

    <section className="science-lab-toolbar">
      <div><small>ТЕКУЩИЙ РАЗДЕЛ</small><strong>{activeSection.label}</strong><span>{sectionItems(activeSection).length} технологий</span></div>
      <label><span>ПОИСК В РАЗДЕЛЕ</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, описание или slug…"/><b>{activeItems.length}</b></label>
      <div className="science-lab-truth"><i />Структура разделов повторяет сохранённую Laboratory Nemexia; числовые данные берутся из текущего Stellar-каталога.</div>
    </section>

    <section className="science-research-grid">
      {activeItems.map((item) => <ResearchCard key={item.id} item={item} index={SCIENCE_CATALOG.indexOf(item)} />)}
      {!activeItems.length ? <div className="science-empty">В этом разделе по текущему запросу ничего не найдено.</div> : null}
    </section>

    <footer className="science-queue-band"><div><small>ОЧЕРЕДЬ ИССЛЕДОВАНИЙ</small><strong>НЕТ АКТИВНЫХ ИССЛЕДОВАНИЙ</strong><span>Foundation: списание ресурсов, таймер, уровни и применение эффектов будут подключены отдельным runtime.</span></div><div className="science-source-path"><small>UI REFERENCE</small><code>{NEMEXIA_LAB_SOURCE.repository}/{NEMEXIA_LAB_SOURCE.path}</code></div></footer>
  </main>;
}
