import { useMemo, useState, type CSSProperties } from 'react';

import { SCIENCE_CATALOG, SCIENCE_CATEGORIES } from './domain/science/catalog.ts';
import { getScienceCategory, getScienceNodesByCategory, getScienceNode } from './domain/science/selectors.ts';
import type { ScienceCatalogItem, ScienceCategoryId } from './domain/science/types.ts';
import './science.css';

function ScienceGlyph({ item }: { item: ScienceCatalogItem }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const armor = item.categoryId === 'armor-sciences';
  const maneuver = item.categoryId === 'maneuver-sciences';
  if (armor) return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M16 3 26 8v8c0 7-4.5 11-10 13-5.5-2-10-6-10-13V8l10-5Z"/><path {...common} d="M11 14h10M13 10h6M13 18h6"/></svg>;
  if (maneuver) return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="4"/><ellipse {...common} cx="16" cy="16" rx="13" ry="6" transform="rotate(28 16 16)"/><path {...common} d="M4 25 9 20M23 12l5-5"/></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="4"/><ellipse {...common} cx="16" cy="16" rx="12" ry="5"/><ellipse {...common} cx="16" cy="16" rx="12" ry="5" transform="rotate(60 16 16)"/><ellipse {...common} cx="16" cy="16" rx="12" ry="5" transform="rotate(-60 16 16)"/></svg>;
}

function SourceBadge() {
  return <span className="science-source-badge"><i />CONFIRMED SOURCE ID</span>;
}

export function ScienceView() {
  const [categoryId, setCategoryId] = useState<ScienceCategoryId>('weapon-sciences');
  const initialId = getScienceNodesByCategory('weapon-sciences')[0]?.id ?? SCIENCE_CATALOG[0]?.id ?? '';
  const [selectedId, setSelectedId] = useState(initialId);
  const category = getScienceCategory(categoryId) ?? SCIENCE_CATEGORIES[0];
  const nodes = useMemo(() => getScienceNodesByCategory(categoryId), [categoryId]);
  const selected = getScienceNode(selectedId) ?? nodes[0] ?? SCIENCE_CATALOG[0];

  const chooseCategory = (next: ScienceCategoryId) => {
    setCategoryId(next);
    const first = getScienceNodesByCategory(next)[0];
    if (first) setSelectedId(first.id);
  };

  return <main className="science-view">
    <header className="utility-view-heading science-heading"><div><small>CANONICAL CATALOG FOUNDATION</small><h1>НАУКА</h1><p>10 текущих Asterion Combat technologies · без выдуманных коэффициентов, цен, таймеров и зависимостей</p></div><div className="utility-truth-badge ready"><i />SOURCE-BACKED CATALOG</div></header>

    <div className="science-layout">
      <aside className="science-categories"><header><small>РАЗДЕЛЫ</small><b>{SCIENCE_CATALOG.length} НАУК</b></header>{SCIENCE_CATEGORIES.map((item) => { const count = getScienceNodesByCategory(item.id).length; return <button type="button" key={item.id} className={categoryId === item.id ? 'active' : ''} onClick={() => chooseCategory(item.id)}><span><ScienceGlyph item={getScienceNodesByCategory(item.id)[0] ?? SCIENCE_CATALOG[0]} /></span><div><strong>{item.label}</strong><small>{count} {count === 1 ? 'наука' : 'наук'}</small></div><b>{String(count).padStart(2, '0')}</b></button>; })}<div className="science-category-note"><b>PRESENTATION ONLY</b><p>Разделы и позиции узлов нужны только для читаемой компоновки. Они не являются research prerequisites.</p></div></aside>

      <section className="science-map"><header><div><small>АКТИВНЫЙ РАЗДЕЛ</small><strong>{category.label}</strong><p>{category.description}</p></div><SourceBadge /></header><div className="science-constellation" role="list" aria-label={category.label}><div className="science-axis science-axis--h"/><div className="science-axis science-axis--v"/>{nodes.map((item) => <button type="button" role="listitem" key={item.id} className={`science-node ${selected?.id === item.id ? 'active' : ''}`} style={{ '--node-x': `${item.position.x}%`, '--node-y': `${item.position.y}%` } as CSSProperties} onClick={() => setSelectedId(item.id)}><span className="science-node__orb"><ScienceGlyph item={item} /></span><span className="science-node__copy"><strong>{item.name}</strong><small>ID {item.sourceScienceId} · {item.combatTechnologyId}</small></span></button>)}</div><footer><span>Связи не нарисованы: подтверждённых prerequisite-правил в источнике не найдено.</span><b>{nodes.length} / {SCIENCE_CATALOG.length}</b></footer></section>
    </div>

    <footer className="science-bottom">
      <section className="science-selected">{selected ? <><div className="science-selected-icon"><ScienceGlyph item={selected} /></div><div className="science-selected-copy"><small>ВЫБРАННАЯ НАУКА</small><strong>{selected.name}</strong><p>Source science ID: {selected.sourceScienceId} · CombatTechnologyId: {selected.combatTechnologyId}</p></div><SourceBadge /><dl><div><dt>Макс. уровень</dt><dd>не подтверждён</dd></div><div><dt>Стоимость / время</dt><dd>не подтверждены</dd></div><div><dt>Prerequisites</dt><dd>не подтверждены</dd></div><div><dt>Боевой коэффициент</dt><dd>не выдумывается</dd></div></dl></> : null}</section>
      <section className="science-queue"><header><div><small>ОЧЕРЕДЬ ИССЛЕДОВАНИЙ</small><strong>RUNTIME НЕ ПОДКЛЮЧЁН</strong></div><span>0 / 3</span></header><div className="science-queue-slots">{[1, 2, 3].map((slot) => <div key={slot}><b>{String(slot).padStart(2, '0')}</b><span><strong>Свободный preview-слот</strong><small>Нет startAt / finishAt · таймер не имитируется</small></span></div>)}</div></section>
      <section className="science-legend"><small>ЛЕГЕНДА</small><div><i className="confirmed"/><span><strong>Подтверждено</strong><small>Название + source ID</small></span></div><div><i className="presentation"/><span><strong>Presentation</strong><small>Раздел + позиция</small></span></div><p>Research economy и progression отложены.</p></section>
    </footer>
  </main>;
}
