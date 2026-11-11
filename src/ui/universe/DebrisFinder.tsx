/**
 * «Обломки поблизости»: free debris at planet orbits and Suns in the systems
 * around the planet chosen in the header. Old-screens redo, 11.11.2026.
 *
 * Each row: where (a link to the map), how much, how long the recyclers fly
 * (the same plan the right-click menu makes) and one «Собрать» button that
 * opens the recycle panel. Recyclers can fly to any coordinate in advance, so
 * the empty state says so instead of only «nothing here».
 */
import type { RefObject } from 'react';
import type { UniverseCoordinate } from '../../domain/universe/types.ts';
import { formatUniverseCoordinate } from '../../domain/universe/runtime.ts';
import type { QuickTarget } from '../../application/quick-actions.ts';
import { DEBRIS_FINDER_ICON, SUN_DEBRIS_ART } from '../sun-raid/sun-raid-assets.ts';
import { ResourceIcon } from '../resources/ResourceIcon.tsx';
import { flightClock, useAtlasPlans, type AtlasCell } from './atlas-plans.ts';
import { formatAmount, shortRefusal, type DebrisEntry } from './object-card-model.ts';
import './object-card.css';

export type DebrisSearch = {
  origin: { planetName: string; coordinate: UniverseCoordinate };
  from: number;
  to: number;
  results: DebrisEntry[];
};

type DebrisFinderProps = {
  search: DebrisSearch;
  span: number;
  /** The quick-send target of a row (position 0 is the Sun of that system). */
  targetOf: (entry: DebrisEntry) => QuickTarget;
  closeRef?: RefObject<HTMLButtonElement | null>;
  sendEnabled: boolean;
  onClose: () => void;
  onShow: (coordinate: UniverseCoordinate) => void;
  onSend: (entry: DebrisEntry, anchor: HTMLElement) => void;
  /** Test Mode screenshot route only: seeded recycle plans by coordinate («[1:12:3]»). */
  plansOverride?: Readonly<Record<string, AtlasCell>>;
};

const pad2 = (value: number) => String(value).padStart(2, '0');

export function DebrisFinder({ search, span, targetOf, closeRef, sendEnabled, onClose, onShow, onSend, plansOverride }: DebrisFinderProps) {
  const { origin, results } = search;
  const total = results.reduce((sum, entry) => sum + entry.debris, 0);
  const plans = useAtlasPlans(
    sendEnabled && !plansOverride ? results.map((entry) => ({ rowId: formatUniverseCoordinate(entry.coordinate), target: targetOf(entry), actions: ['recycle'] as const })) : [],
    `${sendEnabled}|${results.map((entry) => `${formatUniverseCoordinate(entry.coordinate)}:${entry.debris}`).join(',')}`,
  );

  return (
    <div className="universe-modal-backdrop universe-object-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="universe-debris-finder universe-object-card oc-finder" role="dialog" aria-modal="true" aria-label="Обломки в ближайших системах" data-qa-debris-finder={results.length}>
        <header className="universe-debris-finder__head oc-finder__head">
          <img className="universe-debris-finder__icon" src={DEBRIS_FINDER_ICON} alt="" draggable={false} />
          <div className="oc-title">
            <h2>Обломки рядом с {origin.planetName}</h2>
            <p className="oc-finder__scope">
              <span className="oc-coord">{formatUniverseCoordinate(origin.coordinate)}</span>
              <span>Системы {pad2(search.from)}–{pad2(search.to)}, галактика {origin.coordinate.galaxy}</span>
            </p>
          </div>
          {results.length ? (
            <div className="oc-finder__total" data-qa-debris-finder-total={total}>
              <small>{results.length === 1 ? '1 поле' : `${results.length} ${results.length < 5 ? 'поля' : 'полей'}`}</small>
              <b><ResourceIcon kind="debris" />{formatAmount(total)}</b>
            </div>
          ) : null}
        </header>

        {results.length === 0 ? (
          <div className="universe-debris-finder__empty oc-finder__empty" data-qa-debris-finder-empty>
            <p>В {span} ближайших системах нет свободных обломков.</p>
            <p className="oc-finder__hint">Переработчики могут лететь и к пустой позиции заранее: нажмите правой кнопкой на место на карте и выберите «Собрать обломки». Обломки на астероидах ищите на самой карте.</p>
            <button ref={closeRef} type="button" className="oc-btn primary" onClick={onClose}>ОК</button>
          </div>
        ) : (
          <>
            <div className="oc-finder__cols" aria-hidden="true">
              <span>Где</span><span>Обломки</span><span>Полёт</span><span />
            </div>
            <ul className="universe-debris-finder__list oc-finder__list">
              {results.map((entry) => {
                const key = formatUniverseCoordinate(entry.coordinate);
                const isSun = entry.coordinate.position === 0;
                const plan = plansOverride ? plansOverride[key] : plans[key]?.recycle;
                return (
                  <li key={key} data-qa-debris-row={key}>
                    {isSun
                      ? <img className="universe-debris-finder__thumb" src={SUN_DEBRIS_ART} alt="" draggable={false} />
                      : <span className="universe-debris-finder__thumb is-orbit" aria-hidden="true" />}
                    <button type="button" className="universe-debris-finder__coord" data-tip="Показать на карте" aria-label={`Показать на карте: ${key}`} onClick={() => onShow(entry.coordinate)}>
                      <b>{key}</b>
                      <small>{isSun ? `Солнце системы ${pad2(entry.coordinate.system)}` : `Система ${pad2(entry.coordinate.system)}, позиция ${entry.coordinate.position}`}</small>
                    </button>
                    <span className="universe-debris-finder__amount"><b>{formatAmount(entry.debris)}</b></span>
                    <span className={`oc-finder__eta ${plan?.kind === 'refused' ? 'is-warn' : ''}`} data-qa-debris-eta={key}
                      {...(plan?.kind === 'refused' ? { 'data-tip': plan.reason } : {})}>
                      {!sendEnabled ? '—' : plan?.kind === 'ready' ? flightClock(plan.durationMs) : plan?.kind === 'refused' ? shortRefusal(plan.reason) : '··:··:··'}
                    </span>
                    <button type="button" className="oc-btn primary" disabled={!sendEnabled} data-qa-debris-send={key}
                      onClick={(event) => onSend(entry, event.currentTarget)}>Собрать</button>
                  </li>
                );
              })}
            </ul>
            <p className="universe-debris-finder__note">Только свободные обломки у планет и Солнц. Время полёта: с ближайшей планеты, где есть переработчики.</p>
          </>
        )}

        <button type="button" className="oc-close" data-asterion-close aria-label="Закрыть" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </section>
    </div>
  );
}
