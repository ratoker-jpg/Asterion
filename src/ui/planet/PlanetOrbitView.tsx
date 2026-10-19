import type { CSSProperties, ReactNode } from 'react';

import { ResourceIcon } from '../resources/ResourceIcon';
import './planet-orbit.css';

export type PlanetOrbitZone = 'resource' | 'industry' | 'military';

export type PlanetOrbitWorld = { id: string; name: string; coords: string; status: string; art: string; active: boolean };
export type PlanetOrbitZoneInfo = { zone: PlanetOrbitZone; title: string; accent: string; art: string; built: number; total: number; building: string | null };
export type PlanetOrbitQueueSlot = { id: string; zoneLabel: string; name: string; art: string; fromLevel: number; toLevel: number; active: boolean; remaining: string | null; progress: number };

const ZONE_POSITION: Record<PlanetOrbitZone, string> = { resource: 'left-top', industry: 'right', military: 'left-bottom' };

const formatRate = (value: number) => `+${Math.round(value).toLocaleString('ru-RU').replace(/ /g, ' ')}/ч`;

/**
 * Planet overview «Орбита»: the planet fills the stage, the three zones sit on
 * its rim as hotspots, vitals on the left, own worlds on the right and the
 * shared build queue with hourly income in the bottom dock.
 */
export function PlanetOrbitView({
  name, kicker, subtitle, skinArt, vitals, worlds, zones, queue, queueCapacity, income, banner,
  onSelectWorld, onEditWorld, onChooseZone, onColonize,
}: {
  name: string;
  kicker: string;
  subtitle: string;
  skinArt: string;
  vitals: readonly { label: string; value: string; tone?: 'ok' }[];
  worlds: readonly PlanetOrbitWorld[];
  zones: readonly PlanetOrbitZoneInfo[];
  queue: readonly PlanetOrbitQueueSlot[];
  queueCapacity: number;
  income: { metal: number; minerals: number; gas: number };
  banner?: ReactNode;
  onSelectWorld: (id: string) => void;
  onEditWorld: (id: string) => void;
  onChooseZone: (zone: PlanetOrbitZone) => void;
  onColonize: () => void;
}) {
  const freeSlots = Math.max(0, queueCapacity - queue.length);
  return (
    <div className="planet-page-v3 planet-orbit" data-qa-planet-orbit>
      <div className="planet-orbit__ring planet-orbit__ring--outer" aria-hidden="true" />
      <div className="planet-orbit__ring" aria-hidden="true" />
      <img className="planet-image-v3 planet-orbit__planet" data-qa-planet-skin-art src={skinArt} alt={name} draggable={false} />

      <header className="planet-orbit__name scene-title">
        <small>{kicker}</small>
        <h1>{name.toUpperCase()}</h1>
        <p>{subtitle}</p>
      </header>

      <dl className="planet-orbit__vitals">
        {vitals.map((item) => (
          <div key={item.label}><dt>{item.label}</dt><dd className={item.tone === 'ok' ? 'is-ok' : ''}>{item.value}</dd></div>
        ))}
      </dl>
      {banner ? <div className="planet-orbit__banner">{banner}</div> : null}

      <aside className="planet-orbit__worlds owned-planets-v4">
        <small className="planet-orbit__kicker">ВАШИ МИРЫ · {worlds.length}</small>
        {worlds.map((world) => (
          <div className={`owned-planet-row-v4 ${world.active ? 'active' : ''}`} key={world.id}>
            <button className="owned-planet-main-v4" type="button" onClick={() => onSelectWorld(world.id)}>
              <img src={world.art} alt="" />
              <span><strong>{world.name}</strong><small>{world.coords} · {world.status}</small></span>
            </button>
            <button className="owned-planet-edit-v4" type="button" title={`Редактировать ${world.name}`} onClick={() => onEditWorld(world.id)}>✎</button>
          </div>
        ))}
        <button type="button" className="planet-orbit__colonize" onClick={onColonize}><span>+</span>Колонизировать</button>
      </aside>

      {zones.map((zone) => (
        <button
          key={zone.zone}
          type="button"
          className={`zone-hotspot zone-hotspot--${zone.zone} planet-orbit__zone planet-orbit__zone--${ZONE_POSITION[zone.zone]}`}
          style={{ '--zone-accent': zone.accent } as CSSProperties}
          onClick={() => onChooseZone(zone.zone)}
          data-qa-zone-hotspot={zone.zone}
        >
          <img src={zone.art} alt="" />
          <span>
            <strong>{zone.title}</strong>
            <small>{zone.built} / {zone.total} · {zone.building ? `строится ${zone.building}` : 'очередь пуста'}</small>
          </span>
        </button>
      ))}

      <section className="planet-orbit__dock" aria-label="Очередь строительства и добыча">
        <div className="planet-orbit__queue">
          <small className="planet-orbit__kicker">ОБЩАЯ ОЧЕРЕДЬ СТРОИТЕЛЬСТВА · {queue.length} / {queueCapacity}</small>
          <div className="planet-orbit__slots" style={{ '--slots': queueCapacity } as CSSProperties}>
            {queue.map((slot) => (
              <div className={`planet-orbit__slot ${slot.active ? 'is-active' : ''}`} key={slot.id}>
                <img src={slot.art} alt="" />
                <span>
                  <small>{slot.zoneLabel} · {slot.active ? 'СТРОИТСЯ' : 'ОЖИДАЕТ'}</small>
                  <strong>{slot.name}</strong>
                  <em>ур. {slot.fromLevel} → {slot.toLevel}{slot.remaining ? ` · осталось ${slot.remaining}` : ''}</em>
                  {slot.active ? <i className="queue-progress-v2"><i style={{ width: `${slot.progress}%` }} /></i> : null}
                </span>
              </div>
            ))}
            {Array.from({ length: freeSlots }, (_, index) => (
              <div className="planet-orbit__slot is-free" key={`free-${index}`}>
                <b>{queue.length + index + 1}</b>
                <span><strong>Свободный слот</strong><em>Выберите здание на территории</em></span>
              </div>
            ))}
          </div>
        </div>
        <div className="planet-orbit__income">
          <small className="planet-orbit__kicker">ДОБЫЧА ЗА ЧАС</small>
          <div>
            <span><ResourceIcon kind="metal" />Металл<b>{formatRate(income.metal)}</b></span>
            <span><ResourceIcon kind="minerals" />Минералы<b>{formatRate(income.minerals)}</b></span>
            <span><ResourceIcon kind="gas" />Газ<b>{formatRate(income.gas)}</b></span>
          </div>
        </div>
      </section>
    </div>
  );
}
