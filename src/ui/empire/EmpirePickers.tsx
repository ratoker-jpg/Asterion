import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { localizeBuildingNames, type BuildingRole, type BuildingZone } from '../../domain/buildings/balance-v1.ts';
import { getBuildingsForZone } from '../../domain/buildings/resource-zone.ts';
import type { RuntimeMode, TestTimeScale } from '../../domain/runtime/mode.ts';
import { previewBuilding } from '../../application/buildings.ts';
import { getPlanetResources, type SaveState } from '../../application/contracts.ts';
import { EMPIRE_RESOURCES, buildProductionItems, type EmpireProductionItem, type EmpireProductionKind } from '../../application/empire.ts';
import { getFleetBuildBudget } from '../../application/fleet.ts';
import { AmountSlider } from '../AmountSlider.tsx';
import { ResourceIcon } from '../resources/ResourceIcon.tsx';
import { compactAmount, countdown, formatNumber } from './empire-format.ts';

export const BUILD_ZONES: { id: BuildingZone; label: string }[] = [
  { id: 'resource', label: 'Ресурсная' },
  { id: 'industry', label: 'Промышленная' },
  { id: 'military', label: 'Военная' },
];

export type BuildPickerState = { planetId: string; left: number; top: number; zone: BuildingZone };
export type ProductionPickerState = { planetId: string; left: number; top: number; kind: EmpireProductionKind; focus?: string };

/** Close on Escape or a press outside; triggers carry `data-empire-pick-trigger` and toggle by themselves. */
function usePopoverDismiss(ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!ref.current?.contains(target as Node) && !target?.closest('[data-empire-pick-trigger]')) onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [onClose, ref]);
}

/** Beside the anchor, vertically centred on it and kept on screen. */
function placePopover(anchorLeft: number, anchorTop: number, width: number, wantedHeight: number) {
  const height = Math.min(wantedHeight, window.innerHeight - 24);
  return {
    left: Math.max(12, Math.min(anchorLeft, window.innerWidth - width - 12)),
    top: Math.min(Math.max(12, anchorTop - height / 2), window.innerHeight - height - 12),
    maxHeight: height,
  };
}

export function BuildPicker({ state, picker, now, mode, testTimeScale, onZone, onClose, onBuild }: {
  state: SaveState; picker: BuildPickerState; now: number; mode: RuntimeMode; testTimeScale: TestTimeScale;
  onZone: (zone: BuildingZone) => void; onClose: () => void; onBuild: (role: BuildingRole) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const factionId = state.profile.factionId;
  const planet = state.planets[picker.planetId];
  const queue = state.queues[picker.planetId] ?? [];
  const [justQueued, setJustQueued] = useState<BuildingRole | null>(null);
  usePopoverDismiss(ref, onClose);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[data-qa-empire-build]:not([aria-disabled="true"])')?.focus({ preventScroll: true }); }, [picker.zone]);
  useEffect(() => {
    if (!justQueued) return;
    const timer = window.setTimeout(() => setJustQueued(null), 700);
    return () => window.clearTimeout(timer);
  }, [justQueued]);
  if (!planet) return null;
  const context = { planetId: picker.planetId, now, mode, testTimeScale };
  const all = getBuildingsForZone(picker.zone, factionId).map((def) => ({ def, availability: previewBuilding(state, context, def.assetRole).availability }));
  // Buildable first, then the ones waiting for resources; locked and maxed ones are only counted.
  const items = all.filter(({ availability }) => availability.canBuild || availability.status === 'insufficient-resource' || availability.status === 'queue-full')
    .sort((a, b) => Number(b.availability.canBuild) - Number(a.availability.canBuild));
  const locked = all.length - items.length;
  return createPortal(
    <div ref={ref} className="empire-pick" style={placePopover(picker.left, picker.top, 380, 420)} role="dialog" aria-label={`Стройка на планете ${planet.name}`} data-qa-empire-picker={picker.planetId}>
      <header>
        <b>{planet.name}</b>
        <span>очередь {queue.length} / 3</span>
        <button type="button" onClick={onClose} aria-label="Закрыть">✕</button>
      </header>
      <nav role="tablist" aria-label="Зона">
        {BUILD_ZONES.map((zone) => (
          <button key={zone.id} type="button" role="tab" aria-selected={picker.zone === zone.id} className={picker.zone === zone.id ? 'is-on' : ''} onClick={() => onZone(zone.id)}>{zone.label}</button>
        ))}
      </nav>
      <ul>
        {items.map(({ def, availability }) => {
          const reason = availability.reason ? localizeBuildingNames(availability.reason, factionId) : null;
          const level = availability.nextLevel;
          return (
            <li key={def.assetRole}>
              <button type="button" aria-disabled={!availability.canBuild} className={`${availability.canBuild ? '' : 'is-off'} ${justQueued === def.assetRole ? 'is-done' : ''}`}
                onClick={() => { if (availability.canBuild && onBuild(def.assetRole)) setJustQueued(def.assetRole); }} data-qa-empire-build={def.assetRole}>
                <img src={def.art} alt="" draggable={false} />
                <span>
                  <b>{def.name}</b>
                  <small>{level == null ? 'максимальный уровень' : availability.currentLevel > 0 || availability.projectedLevel > 0 ? `ур. ${level - 1} → ${level}` : 'построить'}</small>
                </span>
                <span className="empire-pick__cost">
                  {availability.canBuild || availability.status === 'insufficient-resource'
                    ? EMPIRE_RESOURCES.filter((key) => (availability.cost?.[key] ?? 0) > 0).map((key) => (
                      <em key={key} className={availability.missing[key] ? 'is-short' : ''}><ResourceIcon kind={key} />{compactAmount(availability.cost![key])}</em>
                    ))
                    : <em className="is-reason">{reason}</em>}
                </span>
              </button>
            </li>
          );
        })}
        {items.length === 0 ? <li className="empire-pick__empty">Здесь пока нечего строить.</li> : null}
        {locked > 0 ? <li className="empire-pick__locked">Ещё {locked} — откроются после других зданий и наук</li> : null}
      </ul>
    </div>,
    document.body,
  );
}

/** Orderable first, then those short of resources, then locked; catalogue order inside each group. */
function productionOrder(item: EmpireProductionItem) {
  if (!item.unlocked) return 2;
  return item.max > 0 ? 0 : 1;
}

export function ProductionPicker({ state, picker, mode, testTimeScale, now, onKind, onClose, onProduce }: {
  state: SaveState; picker: ProductionPickerState; now: number; mode: RuntimeMode; testTimeScale: TestTimeScale;
  onKind: (kind: EmpireProductionKind) => void; onClose: () => void;
  onProduce: (kind: EmpireProductionKind, itemId: string, quantity: number) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const planet = state.planets[picker.planetId];
  const items = useMemo(() => buildProductionItems(state, picker.planetId, picker.kind, { now, mode, testTimeScale })
    .map((item, index) => ({ item, index }))
    .sort((a, b) => productionOrder(a.item) - productionOrder(b.item) || a.index - b.index)
    .map(({ item }) => item), [state, picker.planetId, picker.kind, now, mode, testTimeScale]);
  const [chosen, setChosen] = useState<string | null>(picker.focus ?? null);
  const [quantity, setQuantity] = useState(1);
  const [justOrdered, setJustOrdered] = useState<string | null>(null);
  usePopoverDismiss(ref, onClose);
  useEffect(() => { setChosen(picker.focus ?? null); setQuantity(1); }, [picker.kind, picker.planetId, picker.focus]);
  useEffect(() => {
    if (!justOrdered) return;
    const timer = window.setTimeout(() => setJustOrdered(null), 700);
    return () => window.clearTimeout(timer);
  }, [justOrdered]);
  useEffect(() => {
    if (!picker.focus) return;
    ref.current?.querySelector(`[data-qa-empire-produce-item="${picker.focus}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [picker.focus]);
  if (!planet) return null;
  const budget = getFleetBuildBudget(state, picker.planetId);
  const pool = picker.kind === 'defense' ? budget.defenseSummary : budget.summary;
  const wallet = getPlanetResources(state, picker.planetId);
  const open = items.filter((item) => item.unlocked).length;
  return createPortal(
    <div ref={ref} className="empire-pick empire-pick--yard" style={placePopover(picker.left, picker.top, 450, 600)} role="dialog" aria-label={`Производство на планете ${planet.name}`} data-qa-empire-yard={picker.planetId} data-qa-empire-yard-kind={picker.kind}>
      <header>
        <b>{planet.name}</b>
        <span>верфь ур. {budget.shipyardLevel}</span>
        <button type="button" onClick={onClose} aria-label="Закрыть">✕</button>
      </header>
      <nav role="tablist" aria-label="Что заказать">
        <button type="button" role="tab" aria-selected={picker.kind === 'ships'} className={picker.kind === 'ships' ? 'is-on' : ''} onClick={() => onKind('ships')} data-qa-empire-yard-tab="ships">Корабли</button>
        <button type="button" role="tab" aria-selected={picker.kind === 'defense'} className={picker.kind === 'defense' ? 'is-on' : ''} onClick={() => onKind('defense')} data-qa-empire-yard-tab="defense">Оборона</button>
      </nav>
      <p className="empire-pick__note">
        {budget.shipyardLevel <= 0 ? 'На этой планете нет верфи. Постройте её в промышленной зоне, и здесь можно будет заказывать.'
          : `Население ${picker.kind === 'defense' ? 'обороны' : 'флота'}: ${formatNumber(pool.population)} из ${formatNumber(pool.capacity)}${open === 0 ? '. Пока ничего не открыто.' : ''}`}
      </p>
      <ul>
        {items.map((item) => {
          const selected = chosen === item.id && item.max > 0;
          const amount = Math.min(item.max, Math.max(1, quantity));
          return (
            <li key={item.id} className={selected ? 'is-chosen' : ''} data-qa-empire-produce-row={item.id}>
              <button type="button" aria-disabled={item.max <= 0} aria-expanded={selected} className={`${item.max > 0 ? '' : 'is-off'} ${justOrdered === item.id ? 'is-done' : ''}`}
                onClick={() => { if (item.max > 0) { setChosen(selected ? null : item.id); setQuantity(1); } }} data-qa-empire-produce-item={item.id}>
                <img src={item.art} alt="" draggable={false} />
                <span>
                  <b>{item.name}</b>
                  <small>{item.unlocked
                    ? `есть ${formatNumber(item.owned)}${item.pending ? ` · в очереди ${formatNumber(item.pending)}` : ''} · ${countdown(item.unitMs)} за шт.`
                    : item.reason ? localizeBuildingNames(item.reason, budget.factionId) : 'Пока недоступно'}</small>
                </span>
                {item.unlocked ? (
                  <span className="empire-pick__cost">
                    {EMPIRE_RESOURCES.filter((key) => item.unitCost[key] > 0).map((key) => (
                      <em key={key} className={wallet[key] < item.unitCost[key] ? 'is-short' : ''}><ResourceIcon kind={key} />{compactAmount(item.unitCost[key])}</em>
                    ))}
                  </span>
                ) : null}
              </button>
              {selected ? (
                <div className="empire-pick__order">
                  <div className="empire-pick__qty">
                    <input type="number" min={1} max={item.max} value={amount} inputMode="numeric" aria-label={`Количество: ${item.name}`}
                      onChange={(event) => setQuantity(Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : 1)} data-qa-empire-produce-qty />
                    <AmountSlider compact value={amount} min={1} max={item.max} onChange={setQuantity} label={`Количество: ${item.name}`} />
                    <button type="button" className="empire-pick__max" onClick={() => setQuantity(item.max)} data-qa-empire-produce-max>Макс. {formatNumber(item.max)}</button>
                  </div>
                  <div className="empire-pick__total">
                    <span>
                      {EMPIRE_RESOURCES.filter((key) => item.unitCost[key] > 0).map((key) => (
                        <em key={key}><ResourceIcon kind={key} />{compactAmount(item.unitCost[key] * amount)}</em>
                      ))}
                      <em className="is-time">{countdown(item.unitMs * amount)}</em>
                    </span>
                    <button type="button" className="empire__btn empire__btn--pri" data-qa-empire-produce-go={item.id}
                      onClick={() => { if (onProduce(picker.kind, item.id, amount)) { setJustOrdered(item.id); setChosen(null); setQuantity(1); } }}>В производство</button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>,
    document.body,
  );
}
