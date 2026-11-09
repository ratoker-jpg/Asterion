import { useMemo, useState } from 'react';
import { COMMANDER_IDS } from '../../domain/combat/commanders.ts';
import { getFactionCombatEntity } from '../../domain/combat/faction-catalog.ts';
import { getCombatFactionName, type CombatFactionId } from '../../domain/combat/factions.ts';
import { SUN_RAID_CONFIG } from '../../domain/sun-raid/config.ts';
import {
  BALANCED_SUN_MIX,
  buildSunOrderFromMix,
  entityPopulation,
  orderCatalog,
  orderPopulation,
  padSunOrder,
  slotKey,
  slotPopulation,
  SUN_ORDER_MAX_SLOTS,
  typeShares,
  validateSunRaidOrder,
  type SunOrderEntityId,
  type SunOrderPreset,
  type SunOrderSupply,
  type SunRaidOrder,
  type SunRaidOrderSlot,
} from '../../domain/sun-raid/order.ts';
import type { SunBattleLogEntry } from '../../domain/sun-raid/battle-log.ts';
import type { SunOrderMember } from '../../application/sun-raid.ts';
import './sun-order.css';

function withLevel<T extends SunRaidOrderSlot>(slot: T, level: number): T {
  const next = { ...slot };
  if (level > 0) next.minLevel = level;
  else delete next.minLevel;
  return next;
}

const fmt = (value: number) => Math.max(0, Math.round(value)).toLocaleString('ru-RU');

export function orderSupply(members: readonly SunOrderMember[]): SunOrderSupply[] {
  return members.flatMap((member) => Object.entries(member.ships).map(([id, count]) => ({
    factionId: member.factionId, entityId: id as SunOrderEntityId, count: count ?? 0, level: member.levels[id] ?? 0,
  }))).filter((item) => item.count > 0);
}

/** The editor's three starting points. */
export function presetOrder(preset: SunOrderPreset, races: readonly CombatFactionId[], perSide: number, members: readonly SunOrderMember[], lastDefence: SunBattleLogEntry | null): SunRaidOrder | null {
  const supply = orderSupply(members);
  if (preset === 'last-defence' && lastDefence) return buildSunOrderFromMix(typeShares(lastDefence.defence.rows), races, perSide, supply, 'last-defence');
  if (preset === 'custom') return { version: 1, preset: 'custom', slots: [] };
  return buildSunOrderFromMix(BALANCED_SUN_MIX, races, perSide, supply, 'balanced');
}

/** Who of the alliance could fill a slot now, and how much of it in all (each member within its own cap). */
export function slotSuppliers(slot: SunRaidOrderSlot, members: readonly SunOrderMember[], participantCap: number): { list: { name: string; count: number; isPlayer: boolean }[]; total: number } {
  if (slot.kind === 'any') {
    const list = members.map((member) => {
      const population = Object.entries(member.ships).reduce((sum, [id, count]) => (member.levels[id] ?? 0) >= (slot.minLevel ?? 0)
        ? sum + (count ?? 0) * entityPopulation(member.factionId, id as SunOrderEntityId) : sum, 0);
      return { name: member.name, count: Math.min(population, participantCap), isPlayer: member.isPlayer };
    }).filter((item) => item.count > 0).sort((left, right) => right.count - left.count);
    return { list, total: Math.min(slot.population, list.reduce((sum, item) => sum + item.count, 0)) };
  }
  const unit = entityPopulation(slot.factionId, slot.entityId);
  const list = members.filter((member) => member.factionId === slot.factionId && (member.levels[slot.entityId] ?? 0) >= (slot.minLevel ?? 0))
    .map((member) => ({ name: member.name, count: Math.min(member.ships[slot.entityId] ?? 0, Math.floor(participantCap / unit)), isPlayer: member.isPlayer }))
    .filter((item) => item.count > 0).sort((left, right) => right.count - left.count);
  return { list, total: Math.min(slot.count, list.reduce((sum, item) => sum + item.count, 0)) };
}

type EditorProps = {
  order: SunRaidOrder;
  onChange: (order: SunRaidOrder) => void;
  races: readonly CombatFactionId[];
  members: readonly SunOrderMember[];
  perSide: number;
  participantCap: number;
  lastDefence: { here: boolean; entry: SunBattleLogEntry } | null;
};

const PRESETS: { id: SunOrderPreset; label: string }[] = [
  { id: 'last-defence', label: 'Как у защиты в прошлый раз' },
  { id: 'balanced', label: 'Сбалансированный' },
  { id: 'custom', label: 'Свой' },
];

/** Raid order editor (owner rule 09.11.2026): slots «race + hull + count» within the side cap, races of the alliance only. */
export function SunOrderEditor({ order, onChange, races, members, perSide, participantCap, lastDefence }: EditorProps) {
  const [addRace, setAddRace] = useState<CombatFactionId>(races[0] ?? 'aegis');
  const [addEntity, setAddEntity] = useState<string>('battleship');
  const total = orderPopulation(order);
  const error = validateSunRaidOrder(order, { perSide, races });
  const percent = Math.min(100, (total / perSide) * 100);
  const hasAny = order.slots.some((slot) => slot.kind === 'any');
  const maxLevel = useMemo(() => Math.max(10, ...members.flatMap((member) => Object.values(member.levels).map((value) => value ?? 0))), [members]);
  const addOptions = useMemo(() => [...orderCatalog(addRace), ...COMMANDER_IDS], [addRace]);
  const entityOk = addOptions.includes(addEntity as SunOrderEntityId) ? addEntity as SunOrderEntityId : addOptions[0]!;
  const taken = new Set(order.slots.map(slotKey));

  const update = (index: number, slot: SunRaidOrderSlot) => onChange({ ...order, preset: 'custom', slots: order.slots.map((item, at) => (at === index ? slot : item)) });
  const remove = (index: number) => onChange({ ...order, preset: 'custom', slots: order.slots.filter((_, at) => at !== index) });
  const room = Math.max(0, perSide - total);
  const add = () => {
    if (taken.has(`${addRace}:${entityOk}`) || order.slots.length >= SUN_ORDER_MAX_SLOTS) return;
    const unit = entityPopulation(addRace, entityOk);
    const count = Math.max(1, Math.floor(Math.min(room || unit, perSide * 0.1) / unit));
    onChange({ ...order, preset: 'custom', slots: [...order.slots, { kind: 'ship', factionId: addRace, entityId: entityOk, count }] });
  };
  const addAny = () => { if (!hasAny && room > 0 && order.slots.length < SUN_ORDER_MAX_SLOTS) onChange({ ...order, preset: 'custom', slots: [...order.slots, { kind: 'any', population: room }] }); };
  const applyPreset = (preset: SunOrderPreset) => {
    const built = presetOrder(preset, races, perSide, members, lastDefence?.entry ?? null);
    if (built) onChange(built);
  };

  return (
    <section className="sro" aria-label="Заказ состава рейда" data-qa-sun-order>
      <header className="sro__head">
        <div>
          <small>ЗАКАЗ СОСТАВА · РАСЫ СОЮЗА: {races.map((race) => getCombatFactionName(race)).join(', ') || '—'}</small>
          <p>Участники вступают только кораблями из заказа. Остальное не примут — кроме позиции «любые», если вы её добавите.</p>
        </div>
        <div className="sro__presets" role="group" aria-label="Готовые составы">
          {PRESETS.map((preset) => (
            <button key={preset.id} type="button" className={`opsA-chip${order.preset === preset.id ? ' is-on' : ''}`} aria-pressed={order.preset === preset.id}
              disabled={preset.id === 'last-defence' && !lastDefence}
              title={preset.id === 'last-defence' ? (lastDefence ? (lastDefence.here ? 'Доли типов кораблей защиты последнего боя у этого Солнца' : 'У этого Солнца боёв не было: доли защиты последнего боя за Солнце') : 'Боёв за Солнца ещё не было') : undefined}
              onClick={() => applyPreset(preset.id)} data-qa-sun-order-preset={preset.id}>{preset.label}</button>
          ))}
        </div>
      </header>

      <ol className="sro__slots">
        {order.slots.length ? order.slots.map((slot, index) => {
          const suppliers = slotSuppliers(slot, members, participantCap);
          const need = slot.kind === 'any' ? slot.population : slot.count;
          const short = suppliers.total < need;
          if (slot.kind === 'any') {
            return (
              <li key="any" className={`sro__slot sro__slot--any${short ? ' is-short' : ''}`} data-qa-sun-order-slot="any">
                <span className="sro__art sro__art--any" aria-hidden="true">∗</span>
                <span className="sro__name"><b>Любые боевые</b><small>любая раса союза · население</small></span>
                <input type="number" min={1} max={perSide} value={slot.population} aria-label="Любые: население"
                  onChange={(event) => update(index, { ...slot, population: Math.max(1, Math.floor(Number(event.target.value) || 0)) })} />
                <span className="sro__pop">{fmt(slot.population)}</span>
                <LevelSelect value={slot.minLevel ?? 0} max={maxLevel} onChange={(value) => update(index, withLevel(slot, value))} />
                <Suppliers suppliers={suppliers} need={need} unit="нас." />
                <button type="button" className="sro__remove" aria-label="Убрать позицию «любые»" onClick={() => remove(index)}>×</button>
              </li>
            );
          }
          const entity = getFactionCombatEntity(slot.factionId, slot.entityId);
          return (
            <li key={slotKey(slot)} className={`sro__slot${short ? ' is-short' : ''}`} data-race={slot.factionId} data-qa-sun-order-slot={slotKey(slot)}>
              {entity.art ? <img className="sro__art" src={entity.art} alt="" /> : <span className="sro__art" aria-hidden="true" />}
              <span className="sro__name"><b title={entity.name}>{entity.name}</b><small><i className="sro__race" />{getCombatFactionName(slot.factionId)} · {entityPopulation(slot.factionId, slot.entityId)} нас.</small></span>
              <input type="number" min={1} value={slot.count} aria-label={`${entity.name}: количество`}
                onChange={(event) => update(index, { ...slot, count: Math.max(1, Math.floor(Number(event.target.value) || 0)) })} />
              <span className="sro__pop">{fmt(slotPopulation(slot))}</span>
              <LevelSelect value={slot.minLevel ?? 0} max={maxLevel} onChange={(value) => update(index, withLevel(slot, value))} />
              <Suppliers suppliers={suppliers} need={need} unit="шт." />
              <button type="button" className="sro__remove" aria-label={`Убрать ${entity.name}`} onClick={() => remove(index)}>×</button>
            </li>
          );
        }) : <li className="sro__empty">Заказ пуст. Выберите готовый состав или добавьте позиции ниже.</li>}
      </ol>

      <div className="sro__add">
        <label><span className="srp-sr">Раса</span>
          <select value={addRace} onChange={(event) => setAddRace(event.target.value as CombatFactionId)} aria-label="Раса позиции">
            {races.map((race) => <option key={race} value={race}>{getCombatFactionName(race)}</option>)}
          </select>
        </label>
        <label><span className="srp-sr">Корабль</span>
          <select value={entityOk} onChange={(event) => setAddEntity(event.target.value)} aria-label="Корабль позиции">
            {addOptions.map((id) => <option key={id} value={id} disabled={taken.has(`${addRace}:${id}`)}>{getFactionCombatEntity(addRace, id).name}</option>)}
          </select>
        </label>
        <button type="button" className="opsA-btn opsA-btn--small" onClick={add} disabled={taken.has(`${addRace}:${entityOk}`) || order.slots.length >= SUN_ORDER_MAX_SLOTS} data-qa-sun-order-add>+ ПОЗИЦИЯ</button>
        <button type="button" className="opsA-btn opsA-btn--small" onClick={addAny} disabled={hasAny || room <= 0 || order.slots.length >= SUN_ORDER_MAX_SLOTS} title="Место для любых боевых кораблей союза">+ ЛЮБЫЕ</button>
        <button type="button" className="opsA-btn opsA-btn--small" onClick={() => onChange(padSunOrder(order, races, perSide))} disabled={room <= SUN_RAID_CONFIG.raidLaunchTolerance || !races.length} title="Добавить самые малые корабли, чтобы заказ стал ровно лимитом стороны" data-qa-sun-order-pad>ДОБИТЬ ОСТАТОК</button>
      </div>

      <div className="srp-cap sro__cap" data-qa-sun-order-total={`${total}/${perSide}`}>
        <div className="srp-cap__head">
          <small>ЗАКАЗ · {order.slots.length} из {SUN_ORDER_MAX_SLOTS} позиций · {total > perSide ? `перебор ${fmt(total - perSide)}` : total < perSide - SUN_RAID_CONFIG.raidLaunchTolerance ? `не хватает ${fmt(perSide - total)}` : 'ровно лимит стороны'}</small>
          <b className={total > perSide ? 'is-over' : ''}>{fmt(total)} / {fmt(perSide)}</b>
        </div>
        <i><span style={{ width: `${percent}%` }} className={total > perSide ? 'is-over' : ''} /></i>
      </div>
      {error && order.slots.length ? <p className="srp-block-reason" role="note">{error}</p> : null}
    </section>
  );
}

function LevelSelect({ value, max, onChange }: { value: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="sro__level" title="Минимальный уровень корабля у участника">
      <span className="srp-sr">Минимальный уровень</span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label="Минимальный уровень">
        {Array.from({ length: max + 1 }, (_, level) => <option key={level} value={level}>{level ? `от ур. ${level}` : 'любой ур.'}</option>)}
      </select>
    </label>
  );
}

function Suppliers({ suppliers, need, unit }: { suppliers: ReturnType<typeof slotSuppliers>; need: number; unit: string }) {
  const shown = suppliers.list.slice(0, 2);
  const more = suppliers.list.length - shown.length;
  const title = suppliers.list.map((item) => `${item.name}: ${fmt(item.count)} ${unit}`).join('\n');
  return (
    <span className={`sro__who${suppliers.total < need ? ' is-short' : ''}`} title={title || 'Никто в союзе сейчас не может закрыть эту позицию'}>
      <b>{suppliers.total >= need ? 'хватает' : suppliers.total > 0 ? `есть ${fmt(suppliers.total)} из ${fmt(need)}` : 'некому закрыть'}</b>
      <small>{shown.length ? shown.map((item) => `${item.isPlayer ? 'Вы' : item.name} ${fmt(item.count)}`).join(' · ') + (more > 0 ? ` · +${more}` : '') : '—'}</small>
    </span>
  );
}

/** Compact slot fill of a gathering raid (raid card and join dialog). */
export function SunOrderFillList({ order, fill, limit, highlightRace }: { order: SunRaidOrder; fill: ReadonlyMap<string, number>; limit?: number; highlightRace?: CombatFactionId }) {
  const slots = limit ? order.slots.slice(0, limit) : order.slots;
  const hidden = order.slots.length - slots.length;
  return (
    <ul className="sro-fill" data-qa-sun-order-fill>
      {slots.map((slot) => {
        const key = slotKey(slot);
        const used = fill.get(key) ?? 0;
        const need = slot.kind === 'any' ? slot.population : slot.count;
        const name = slot.kind === 'any' ? 'Любые' : getFactionCombatEntity(slot.factionId, slot.entityId).name;
        const mine = slot.kind === 'any' || slot.factionId === highlightRace;
        return (
          <li key={key} className={`${used >= need ? 'is-full' : ''}${mine && highlightRace ? ' is-mine' : ''}`} data-race={slot.kind === 'any' ? undefined : slot.factionId} title={`${name}${slot.kind === 'ship' ? ` · ${getCombatFactionName(slot.factionId)}` : ''}${slot.minLevel ? ` · от ур. ${slot.minLevel}` : ''}: ${fmt(used)} / ${fmt(need)}`}>
            <span><i className="sro__race" />{name}{slot.minLevel ? <em> ур.{slot.minLevel}+</em> : null}</span>
            <b>{fmt(used)}/{fmt(need)}</b>
            <i className="sro-fill__bar"><span style={{ width: `${Math.min(100, need ? (used / need) * 100 : 0)}%` }} /></i>
          </li>
        );
      })}
      {hidden > 0 ? <li className="sro-fill__more">+{hidden} поз.</li> : null}
    </ul>
  );
}
