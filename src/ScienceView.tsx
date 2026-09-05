import { useMemo, useState, type CSSProperties } from 'react';

import { SCIENCE_CATALOG, SCIENCE_CATEGORIES, SCIENCE_VISUAL_LINKS, STELLAR_RESEARCH_SOURCE } from './domain/science/catalog.ts';
import { getScienceDependents, getScienceNode, searchScienceCatalog } from './domain/science/selectors.ts';
import type { ScienceCatalogItem, ScienceCategoryId } from './domain/science/types.ts';
import './science.css';

type ScienceFocus = 'all' | ScienceCategoryId;

type NodePosition = { x: number; y: number };

const NODE_POSITIONS: Record<string, NodePosition> = {
  'science-physics': { x: 8, y: 8 },
  'science-chemistry': { x: 30, y: 8 },
  'science-fuel-cells': { x: 53, y: 8 },
  'science-mathematics': { x: 22, y: 23 },
  'science-computer-systems': { x: 44, y: 20 },
  'science-ecology': { x: 44, y: 29 },
  'science-improved-construction': { x: 66, y: 23 },
  'science-astronomy': { x: 36, y: 41 },
  'science-jet-engines': { x: 58, y: 38 },
  'science-hyperspace': { x: 76, y: 41 },
  'science-parallel-universes': { x: 91, y: 41 },
  'science-espionage': { x: 58, y: 54 },
  'science-ship-armor': { x: 30, y: 68 },
  'science-light-armor': { x: 48, y: 63 },
  'science-medium-armor': { x: 64, y: 63 },
  'science-heavy-armor': { x: 82, y: 63 },
  'science-maneuver-defense': { x: 57, y: 72 },
  'science-laser-science': { x: 36, y: 86 },
  'science-ion-science': { x: 57, y: 84 },
  'science-plasma-science': { x: 78, y: 84 },
  'science-piercing-attack': { x: 58, y: 93 },
  'science-critical-hit': { x: 79, y: 93 },
};

const CATEGORY_ORDER: readonly ScienceCategoryId[] = ['energy', 'infrastructure', 'navigation', 'intelligence', 'defense', 'weapons'];

function ScienceGlyph({ category }: { category: ScienceCategoryId }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.55, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (category === 'energy') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m18 3-9 14h7l-2 12 9-15h-7l2-11Z"/><circle {...common} cx="16" cy="16" r="13"/></svg>;
  if (category === 'infrastructure') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M5 27V14l7 4v-5l7 4V7h7v20H5Z"/><path {...common} d="M9 23h3m3 0h3m3 0h2M21 7V3h4v4"/></svg>;
  if (category === 'navigation') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="4"/><ellipse {...common} cx="16" cy="16" rx="13" ry="6" transform="rotate(28 16 16)"/><path {...common} d="m23 7 5-4-2 7M7 25l-4 4 2-7"/></svg>;
  if (category === 'intelligence') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M3 16s5-9 13-9 13 9 13 9-5 9-13 9S3 16 3 16Z"/><circle {...common} cx="16" cy="16" r="4"/><path {...common} d="M16 2v3M16 27v3M2 16h3M27 16h3"/></svg>;
  if (category === 'defense') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M16 3 27 8v8c0 7-4.5 11-11 14C9.5 27 5 23 5 16V8l11-5Z"/><path {...common} d="M10 14h12M12 10h8M12 19h8"/></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="4"/><ellipse {...common} cx="16" cy="16" rx="12" ry="5"/><ellipse {...common} cx="16" cy="16" rx="12" ry="5" transform="rotate(60 16 16)"/><ellipse {...common} cx="16" cy="16" rx="12" ry="5" transform="rotate(-60 16 16)"/></svg>;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}м ${rest}с` : `${minutes}м`;
}

function SourceBadge() {
  return <span className="science-source-badge"><i />STELLAR CURRENT · {STELLAR_RESEARCH_SOURCE.commit.slice(0, 7)}</span>;
}

function RequirementChip({ id, level, onSelect }: { id: string; level: number; onSelect: (id: string) => void }) {
  const science = getScienceNode(id);
  return <button type="button" onClick={() => onSelect(id)}><span>{science ? <ScienceGlyph category={science.categoryId} /> : null}</span><strong>{science?.name ?? id}</strong><b>LV {level}</b></button>;
}

function ScienceDossier({ item, onSelect }: { item: ScienceCatalogItem; onSelect: (id: string) => void }) {
  const dependents = getScienceDependents(item.id);
  return <aside className={`science-dossier science-tone--${item.categoryId}`}>
    <header><small>ТЕХНОЛОГИЧЕСКОЕ ДОСЬЕ</small><SourceBadge /></header>
    <div className="science-dossier-hero"><span><ScienceGlyph category={item.categoryId} /></span><div><small>{SCIENCE_CATEGORIES.find((category) => category.id === item.categoryId)?.label}</small><h2>{item.name}</h2><p>{item.description}</p></div></div>
    <div className="science-dossier-grid"><div><small>МАКС. УРОВЕНЬ</small><strong>{item.maxLevel}</strong></div><div><small>ЛАБОРАТОРИЯ</small><strong>LV {item.requiredLaboratoryLevel}</strong></div><div><small>БАЗОВОЕ ВРЕМЯ</small><strong>{formatDuration(item.baseSeconds)}</strong></div><div><small>ЗАВИСИМОСТЕЙ</small><strong>{item.requirements.length}</strong></div></div>
    <section className="science-dossier-cost"><header>БАЗОВАЯ СТОИМОСТЬ · STELLAR SOURCE</header><div><span><i>M</i><b>{item.baseCost.metal.toLocaleString('ru-RU')}</b><small>металл</small></span><span><i>C</i><b>{item.baseCost.crystal.toLocaleString('ru-RU')}</b><small>кристалл</small></span><span><i>G</i><b>{item.baseCost.gas.toLocaleString('ru-RU')}</b><small>газ</small></span></div></section>
    <section className="science-dossier-effects"><header>ЭФФЕКТ</header>{item.effects.length ? item.effects.map((effect) => <div key={`${effect.type}-${effect.valueLabel}`}><span>{effect.type.replaceAll('_', ' ')}</span><strong>{effect.valueLabel}</strong></div>) : <p>В текущем Stellar-каталоге отдельный effect не заявлен.</p>}</section>
    <section className="science-dossier-requirements"><header>ТРЕБОВАНИЯ</header>{item.requirements.length ? <div>{item.requirements.map((requirement) => <RequirementChip key={`${requirement.scienceId}-${requirement.level}`} id={requirement.scienceId} level={requirement.level} onSelect={onSelect} />)}</div> : <p>Базовая технология — prerequisite отсутствует.</p>}</section>
    <section className="science-dossier-next"><header>ОТКРЫВАЕТ ВЕТКИ</header><div>{dependents.length ? dependents.map((dependent) => <button type="button" key={dependent.id} onClick={() => onSelect(dependent.id)}>{dependent.name}</button>) : <span>Конечный узел текущего дерева</span>}</div></section>
    {item.combatTechnologyId ? <div className="science-combat-link"><small>ASTERION COMBAT LINK</small><strong>{item.combatTechnologyId}</strong><span>sourceScienceId {item.sourceScienceId}</span></div> : null}
  </aside>;
}

export function ScienceView() {
  const [focus, setFocus] = useState<ScienceFocus>('all');
  const [selectedId, setSelectedId] = useState('science-physics');
  const [query, setQuery] = useState('');
  const selected = getScienceNode(selectedId) ?? SCIENCE_CATALOG[0];
  const searchMatches = useMemo(() => new Set(searchScienceCatalog(query).map((item) => item.id)), [query]);
  const visibleLinks = useMemo(() => SCIENCE_VISUAL_LINKS.filter((link) => NODE_POSITIONS[link.from] && NODE_POSITIONS[link.to]), []);

  const selectNode = (id: string) => {
    const node = getScienceNode(id);
    if (!node) return;
    setSelectedId(id);
    if (focus !== 'all' && focus !== node.categoryId) setFocus(node.categoryId);
  };

  return <main className="science-view">
    <header className="utility-view-heading science-heading"><div><small>ТЕХНОЛОГИЧЕСКАЯ МАТРИЦА · STELLAR CANON SNAPSHOT</small><h1>НАУКА</h1><p>Полные 22 текущие технологии из Stellar · 6 реальных разделов · зависимости из исходного каталога</p></div><SourceBadge /></header>

    <section className="science-overview"><div><small>ТЕХНОЛОГИЙ</small><strong>22</strong><span>полный текущий каталог</span></div><div><small>РАЗДЕЛОВ</small><strong>6</strong><span>source-backed categories</span></div><div><small>СВЯЗЕЙ</small><strong>{SCIENCE_VISUAL_LINKS.length}</strong><span>реальные prerequisites</span></div><div><small>COMBAT LINKS</small><strong>{SCIENCE_CATALOG.filter((item) => item.combatTechnologyId).length}</strong><span>связаны с Asterion Combat</span></div></section>

    <div className="science-command-grid">
      <aside className="science-branches">
        <header><div><small>РАЗДЕЛЫ НАУКИ</small><strong>ФОКУС МАТРИЦЫ</strong></div><b>{focus === 'all' ? 'ALL' : focus.toUpperCase()}</b></header>
        <button type="button" className={`science-branch science-branch--all ${focus === 'all' ? 'active' : ''}`} onClick={() => setFocus('all')}><span>✦</span><div><strong>ВСЯ МАТРИЦА</strong><small>22 технологии · 6 веток</small></div><b>22</b></button>
        {SCIENCE_CATEGORIES.map((category) => { const count = SCIENCE_CATALOG.filter((item) => item.categoryId === category.id).length; return <button type="button" key={category.id} className={`science-branch science-tone--${category.id} ${focus === category.id ? 'active' : ''}`} onClick={() => setFocus(category.id)}><span><ScienceGlyph category={category.id} /></span><div><strong>{category.label}</strong><small>{category.description}</small></div><b>{String(count).padStart(2, '0')}</b></button>; })}
        <label className="science-search"><small>ПОИСК ПО КАТАЛОГУ</small><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или slug…" /><span>{searchMatches.size}</span></label>
        <div className="science-source-note"><small>ИСТОЧНИК</small><strong>{STELLAR_RESEARCH_SOURCE.repository}</strong><code>{STELLAR_RESEARCH_SOURCE.commit}</code><p>Каталог, стоимости, уровни лаборатории и prerequisite-связи взяты из текущего Stellar main snapshot. Исследовательский runtime Asterion здесь не симулируется.</p></div>
      </aside>

      <section className="science-matrix">
        <header><div><small>RESEARCH CONSTELLATION</small><strong>{focus === 'all' ? 'ПОЛНАЯ ТЕХНОЛОГИЧЕСКАЯ СЕТЬ' : SCIENCE_CATEGORIES.find((category) => category.id === focus)?.label}</strong></div><div className="science-matrix-legend"><span><i className="selected"/>выбрано</span><span><i className="linked"/>зависимость</span><span><i className="dimmed"/>вне фокуса</span></div></header>
        <div className="science-matrix-canvas">
          {CATEGORY_ORDER.map((categoryId, index) => <div key={categoryId} className={`science-lane science-lane--${categoryId}`} style={{ '--lane-index': index } as CSSProperties}><span>{SCIENCE_CATEGORIES.find((category) => category.id === categoryId)?.shortLabel}</span></div>)}
          <svg className="science-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{visibleLinks.map((link) => { const from = NODE_POSITIONS[link.from]; const to = NODE_POSITIONS[link.to]; const highlighted = link.from === selectedId || link.to === selectedId; return <line key={`${link.from}-${link.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={highlighted ? 'active' : ''} />; })}</svg>
          {SCIENCE_CATALOG.map((item) => { const position = NODE_POSITIONS[item.id]; const focused = focus === 'all' || focus === item.categoryId; const matched = !query.trim() || searchMatches.has(item.id); const linked = item.requirements.some((requirement) => requirement.scienceId === selectedId) || selected.requirements.some((requirement) => requirement.scienceId === item.id); return <button type="button" key={item.id} className={`science-tech-node science-tone--${item.categoryId} ${selectedId === item.id ? 'active' : ''} ${linked ? 'linked' : ''} ${!focused || !matched ? 'dimmed' : ''}`} style={{ '--node-x': `${position.x}%`, '--node-y': `${position.y}%` } as CSSProperties} onClick={() => selectNode(item.id)}><span className="science-tech-orb"><ScienceGlyph category={item.categoryId} /></span><span className="science-tech-copy"><strong>{item.name}</strong><small>LAB {item.requiredLaboratoryLevel} · MAX {item.maxLevel}</small></span>{item.combatTechnologyId ? <i className="science-combat-dot" title="Связано с Asterion Combat" /> : null}</button>; })}
        </div>
        <footer><span>Линии = реальные requirements из Stellar, а не декоративные связи.</span><b>{selected.name}</b></footer>
      </section>

      <ScienceDossier item={selected} onSelect={selectNode} />
    </div>

    <section className="science-queue-band"><header><div><small>ОЧЕРЕДЬ ИССЛЕДОВАНИЙ</small><strong>ASTERION RESEARCH RUNTIME ЕЩЁ НЕ ПОДКЛЮЧЁН</strong></div><span>0 / 3</span></header><div>{[1, 2, 3].map((slot) => <article key={slot}><b>{String(slot).padStart(2, '0')}</b><span><strong>Свободный исследовательский контур</strong><small>Без fake timer · без списания ресурсов</small></span><i>STANDBY</i></article>)}</div></section>
  </main>;
}
