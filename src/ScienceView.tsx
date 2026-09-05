import { useMemo, useState } from 'react';

import { NEMEXIA_SCIENCE_SOURCE, SCIENCE_CATALOG, SCIENCE_CATEGORIES } from './domain/science/catalog.ts';
import { getScienceCategory, getScienceDependents, getScienceNode, searchScienceCatalog } from './domain/science/selectors.ts';
import type { ScienceCatalogItem, ScienceCategoryId } from './domain/science/types.ts';
import './science.css';

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function ScienceGlyph({ category }: { category: ScienceCategoryId }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (category === 'basic') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="4"/><ellipse {...common} cx="16" cy="16" rx="13" ry="6"/><ellipse {...common} cx="16" cy="16" rx="13" ry="6" transform="rotate(60 16 16)"/><ellipse {...common} cx="16" cy="16" rx="13" ry="6" transform="rotate(-60 16 16)"/></svg>;
  if (category === 'advanced') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M6 25V13l6 3v-5l6 3V7h8v18H6Z"/><path {...common} d="M9 21h3m3 0h3m3 0h2M21 7V3h4v4"/></svg>;
  if (category === 'master') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M16 3 27 9l-3 14-8 6-8-6L5 9l11-6Z"/><path {...common} d="m11 16 3 3 7-8"/></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="12"/><path {...common} d="m16 5 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1 3-7Z"/></svg>;
}

function SourceBadge() {
  return <span className="science-source-badge"><i />NEMEXIA · SAVED PAGE</span>;
}

function RequirementChip({ scienceId, level, onSelect }: { scienceId: string; level: number; onSelect: (item: ScienceCatalogItem) => void }) {
  const science = getScienceNode(scienceId);
  if (!science) return null;
  return <button type="button" onClick={() => onSelect(science)}><span><ScienceGlyph category={science.categoryId} /></span><strong>{science.name}</strong><b>LV {level}</b></button>;
}

function ScienceCard({ item, active, onSelect }: { item: ScienceCatalogItem; active: boolean; onSelect: () => void }) {
  return <button type="button" className={`science-card science-tone--${item.categoryId} ${active ? 'active' : ''}`} onClick={onSelect}>
    <span className="science-card-icon"><ScienceGlyph category={item.categoryId} /></span>
    <span className="science-card-main">
      <small>SCIENCE ID {item.sourceScienceId}</small>
      <strong>{item.name}</strong>
      <em>{item.description}</em>
      <span className="science-card-meta"><b>ЛАБ. LV {item.requiredLaboratoryLevel}</b><b>{item.snapshotTime}</b><b>{item.requirements.length} ТРЕБ.</b></span>
    </span>
    {item.combatTechnologyId ? <i className="science-card-combat" title="Связано с Asterion Combat" /> : null}
  </button>;
}

function ScienceDossier({ item, onSelect }: { item: ScienceCatalogItem; onSelect: (item: ScienceCatalogItem) => void }) {
  const category = getScienceCategory(item.categoryId);
  const dependents = getScienceDependents(item.id);
  return <aside className={`science-dossier science-tone--${item.categoryId}`}>
    <header><small>ДОСЬЕ ИССЛЕДОВАНИЯ</small><SourceBadge /></header>
    <div className="science-dossier-hero"><span><ScienceGlyph category={item.categoryId} /></span><div><small>{category?.label}</small><h2>{item.name}</h2><p>{item.description}</p></div></div>
    <div className="science-dossier-facts">
      <div><small>NEMEXIA ID</small><strong>{item.sourceScienceId}</strong></div>
      <div><small>ЛАБОРАТОРИЯ</small><strong>LV {item.requiredLaboratoryLevel}</strong></div>
      <div><small>СНИМОК УРОВНЯ</small><strong>{item.snapshotLevel} → {item.snapshotNextLevel}</strong></div>
      <div><small>ВРЕМЯ В СНИМКЕ</small><strong>{item.snapshotTime}</strong></div>
    </div>
    <section className="science-dossier-cost"><header>СТОИМОСТЬ СЛЕДУЮЩЕГО УРОВНЯ · СОХРАНЁННЫЙ СНИМОК</header><div>
      <span><i>М</i><b>{formatNumber(item.snapshotCost.metal)}</b><small>металл</small></span>
      <span><i>К</i><b>{formatNumber(item.snapshotCost.crystal)}</b><small>минералы</small></span>
      <span><i>Г</i><b>{formatNumber(item.snapshotCost.gas)}</b><small>газ</small></span>
      <span><i>Э</i><b>{formatNumber(item.snapshotCost.energy)}</b><small>энергия</small></span>
    </div></section>
    <section className="science-dossier-requirements"><header>ТРЕБОВАНИЯ</header><div className="science-lab-requirement"><span>ЭКСПЕРИМЕНТАЛЬНЫЙ ЦЕНТР</span><b>LV {item.requiredLaboratoryLevel}</b></div>{item.requirements.length ? <div className="science-requirement-list">{item.requirements.map((requirement) => <RequirementChip key={`${requirement.scienceId}-${requirement.level}`} scienceId={requirement.scienceId} level={requirement.level} onSelect={onSelect} />)}</div> : <p>Дополнительных научных требований нет.</p>}</section>
    <section className="science-dossier-dependents"><header>ОТКРЫВАЕТ / НУЖНО ДЛЯ</header><div>{dependents.length ? dependents.map((dependent) => <button type="button" key={dependent.id} onClick={() => onSelect(dependent)}>{dependent.name}</button>) : <span>В сохранённой странице дальнейших зависимостей нет.</span>}</div></section>
    {item.combatTechnologyId ? <div className="science-combat-link"><small>ASTERION COMBAT LINK</small><strong>{item.combatTechnologyId}</strong><span>sourceScienceId {item.sourceScienceId}</span></div> : null}
    <button type="button" className="science-runtime-button" disabled>ИССЛЕДОВАТЬ · RUNTIME НЕ ПОДКЛЮЧЕН</button>
  </aside>;
}

export function ScienceView() {
  const [categoryId, setCategoryId] = useState<ScienceCategoryId>('basic');
  const [selectedId, setSelectedId] = useState('science-1');
  const [query, setQuery] = useState('');

  const selected = getScienceNode(selectedId) ?? SCIENCE_CATALOG[0];
  const matches = useMemo(() => searchScienceCatalog(query), [query]);
  const visibleItems = useMemo(() => query.trim() ? matches : SCIENCE_CATALOG.filter((item) => item.categoryId === categoryId), [categoryId, matches, query]);
  const activeCategory = getScienceCategory(categoryId);

  const selectItem = (item: ScienceCatalogItem) => {
    setSelectedId(item.id);
    setCategoryId(item.categoryId);
  };

  return <main className="science-view">
    <header className="utility-view-heading science-heading"><div><small>ЛАБОРАТОРИЯ · NEMEXIA SOURCE BACKED</small><h1>НАУКА</h1><p>22 реальные науки из сохранённой страницы laboratory.php · разделы и требования без выдуманных связей</p></div><SourceBadge /></header>

    <section className="science-process-strip">
      <div><span className="science-process-icon"><ScienceGlyph category="basic" /></span><div><small>ЭКСПЕРИМЕНТАЛЬНЫЙ ЦЕНТР</small><strong>КАТАЛОГ ИССЛЕДОВАНИЙ</strong><span>{NEMEXIA_SCIENCE_SOURCE.page}</span></div></div>
      <div><small>ОЧЕРЕДЬ ИССЛЕДОВАНИЙ ASTERION</small><strong>НЕ ПОДКЛЮЧЕНА</strong><span>Нет фиктивного таймера, списания ресурсов или уровней.</span></div>
    </section>

    <nav className="science-tabs" aria-label="Разделы науки">{SCIENCE_CATEGORIES.map((category) => {
      const count = SCIENCE_CATALOG.filter((item) => item.categoryId === category.id).length;
      return <button type="button" key={category.id} className={`science-tab science-tone--${category.id} ${categoryId === category.id && !query.trim() ? 'active' : ''}`} onClick={() => { setQuery(''); setCategoryId(category.id); const first = SCIENCE_CATALOG.find((item) => item.categoryId === category.id); if (first) setSelectedId(first.id); }}><span><ScienceGlyph category={category.id} /></span><strong>{category.shortLabel}</strong><small>{count}</small></button>;
    })}</nav>

    <div className="science-toolbar">
      <div><small>{query.trim() ? 'РЕЗУЛЬТАТЫ ПОИСКА' : activeCategory?.label}</small><strong>{query.trim() ? `${visibleItems.length} найдено` : activeCategory?.description}</strong></div>
      <label><span>ПОИСК</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, эффект, ID…" /><b>{matches.length}</b></label>
    </div>

    {activeCategory?.exclusiveChoice && !query.trim() ? <div className="science-exclusive-warning"><b>ВНИМАНИЕ</b><span>В исходной Nemexia для дополнительных наук можно исследовать только 1 направление из списка. В Asterion правило пока не активируется без research runtime.</span></div> : null}

    <div className="science-lab-layout">
      <section className="science-catalog-panel"><div className="science-card-grid">{visibleItems.map((item) => <ScienceCard key={item.id} item={item} active={selected.id === item.id} onSelect={() => selectItem(item)} />)}</div>{!visibleItems.length ? <div className="science-empty">По запросу ничего не найдено.</div> : null}</section>
      <ScienceDossier item={selected} onSelect={selectItem} />
    </div>

    <footer className="science-source-footer"><span>ИСТОЧНИК: {NEMEXIA_SCIENCE_SOURCE.repository}</span><code>{NEMEXIA_SCIENCE_SOURCE.page}</code><b>22 НАУКИ · 4 РАЗДЕЛА · 10 COMBAT LINKS</b></footer>
  </main>;
}
