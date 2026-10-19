import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { HeaderGameIcon, HeaderNavigationIcon } from './HeaderAssetIcons';
import { ResourceChip } from './ResourceChip';
import { FACTION_EMBLEMS } from './faction-emblems.ts';
import {
  PRIMARY_NAVIGATION,
  UTILITY_NAVIGATION,
  type AppRoute,
} from '../navigation.tsx';
import type { PlayerFactionId } from '../../domain/profile/types.ts';
import type { RuntimeMode, TestTimeScale } from '../../domain/runtime/mode.ts';
import { HEADER_ZONE_IDS, type HeaderPlanetModel, type HeaderResourceModel, type HeaderZoneId, type HeaderZoneMeta } from './types.ts';

export type HeaderCampaignModel = {
  now: number;
  mode: RuntimeMode;
  timeScale: number;
  saveKey: string;
  timeScaleOptions?: readonly TestTimeScale[];
  onTimeScaleChange?: (timeScale: TestTimeScale) => void;
};

export type AsterionHeaderProps = {
  factionId: PlayerFactionId;
  currentPlanet: HeaderPlanetModel;
  planets: readonly HeaderPlanetModel[];
  resources: readonly HeaderResourceModel[];
  zoneMeta: Record<HeaderZoneId, HeaderZoneMeta>;
  activeRoute: AppRoute;
  activeZone: HeaderZoneId | null;
  reportsUnreadCount: number;
  /** Hostile fleets heading to the player; shown as a red badge on «Флоты». */
  incomingAttackCount?: number;
  planetMenuOpen: boolean;
  campaign: HeaderCampaignModel;
  onRouteChange: (route: AppRoute) => void;
  onZoneChange: (zone: HeaderZoneId) => void;
  onPlanetChange: (planetId: string) => void;
  onPlanetMenuToggle: () => void;
};

const STORAGE_KINDS = ['metal', 'mineral', 'gas'] as const;
const GAUGE_START = 150;
const GAUGE_SWEEP = 240;
const GAUGE_RADIUS = 100;

function gaugeArc(from: number, to: number) {
  const point = (angle: number) => [Math.cos((angle * Math.PI) / 180) * GAUGE_RADIUS, Math.sin((angle * Math.PI) / 180) * GAUGE_RADIUS];
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M${x1} ${y1} A${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/**
 * «Ядро» header: resource rail on top, section shelf below, the current planet in a dial at the centre.
 * The dial carries the three zones (military on top, resource left, industry right) and the faction emblem below.
 * Faction colours come from `data-faction` only — see docs/ui/race-accent.md.
 */
export function AsterionHeader({
  factionId,
  currentPlanet,
  planets,
  resources,
  zoneMeta,
  activeRoute,
  activeZone,
  reportsUnreadCount,
  incomingAttackCount = 0,
  planetMenuOpen,
  campaign,
  onRouteChange,
  onZoneChange,
  onPlanetChange,
  onPlanetMenuToggle,
}: AsterionHeaderProps) {
  const planetSelectRef = useRef<HTMLButtonElement>(null);
  const wasPlanetMenuOpen = useRef(planetMenuOpen);
  const restorePlanetFocusOnClose = useRef(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);

  useEffect(() => {
    if (wasPlanetMenuOpen.current && !planetMenuOpen && restorePlanetFocusOnClose.current) {
      planetSelectRef.current?.focus();
    }
    if (!planetMenuOpen) restorePlanetFocusOnClose.current = false;
    wasPlanetMenuOpen.current = planetMenuOpen;
  }, [planetMenuOpen]);

  useEffect(() => {
    if (!speedMenuOpen) return;
    const close = () => setSpeedMenuOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [speedMenuOpen]);

  const closePlanetMenu = () => {
    if (!planetMenuOpen) return;
    restorePlanetFocusOnClose.current = true;
    onPlanetMenuToggle();
  };

  const dismissPlanetMenuForNavigation = () => {
    restorePlanetFocusOnClose.current = false;
  };

  const togglePlanetMenu = () => {
    if (planetMenuOpen) restorePlanetFocusOnClose.current = false;
    onPlanetMenuToggle();
  };

  const selectPlanet = (planetId: string) => {
    restorePlanetFocusOnClose.current = true;
    onPlanetChange(planetId);
  };

  const storageResources = resources.filter((resource) => (STORAGE_KINDS as readonly string[]).includes(resource.kind));
  const planetResources = resources.filter((resource) => !(STORAGE_KINDS as readonly string[]).includes(resource.kind));
  const storageFill = Math.max(0, ...storageResources.map((resource) => (resource.capacity ? Math.min(100, (resource.value / resource.capacity) * 100) : 0)));
  const planetIndex = Math.max(0, planets.findIndex((planet) => planet.id === currentPlanet.id));

  const routeButton = ({ id, label, icon }: (typeof PRIMARY_NAVIGATION)[number]) => {
    const isActive = activeRoute === id && !(id === 'planet' && activeZone !== null);
    const reportsBadge = id === 'reports' && reportsUnreadCount > 0
      ? reportsUnreadCount > 99 ? '99+' : String(reportsUnreadCount)
      : null;
    const fleetsBadge = id === 'fleets' && incomingAttackCount > 0 ? String(incomingAttackCount) : null;
    return (
      <button
        key={id}
        type="button"
        className={`hdr-route${isActive ? ' active' : ''}${fleetsBadge ? ' hdr-route--alert' : ''}`}
        aria-current={isActive ? 'page' : undefined}
        aria-label={id === 'reports' && reportsUnreadCount > 0 ? `${label}, ${reportsUnreadCount} непрочитанных сообщений` : fleetsBadge ? `${label}, входящих атак: ${incomingAttackCount}` : label}
        data-route={id}
        data-qa-route={id}
        onClick={() => {
          dismissPlanetMenuForNavigation();
          onRouteChange(id);
        }}
      >
        <span className="hdr-route__icon">
          <HeaderNavigationIcon kind={icon} factionId={factionId} />
          {reportsBadge ? <b className="asterion-header__nav-badge" aria-hidden="true">{reportsBadge}</b> : null}
          {fleetsBadge ? <b className="asterion-header__nav-badge asterion-header__nav-badge--alert" aria-hidden="true" data-qa-fleets-incoming-badge>{fleetsBadge}</b> : null}
        </span>
        <span className="hdr-route__label">{label}</span>
      </button>
    );
  };

  return (
    <header className="asterion-header" data-faction={factionId} data-qa-header>
      <div className="hdr-shelf" aria-hidden="true" />

      <div className="hdr-rail" data-qa-resource-rail aria-label="Ресурсы планеты">
        <div className="hdr-group hdr-group--storage">
          {storageResources.map((resource) => <ResourceChip key={resource.kind} {...resource} />)}
        </div>
        <div className="hdr-group hdr-group--planet">
          {planetResources.map((resource) => <ResourceChip key={resource.kind} {...resource} />)}
        </div>
      </div>

      <div className="hdr-planet-control">
        <button
          ref={planetSelectRef}
          className="hdr-planet-select"
          type="button"
          onClick={togglePlanetMenu}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closePlanetMenu();
            }
          }}
          aria-label={`Выбор планеты: ${currentPlanet.name}, координаты ${currentPlanet.coords}. Планета выбрана`}
          aria-expanded={planetMenuOpen}
          aria-controls="asterion-header-planet-list"
          data-qa-current-planet
          data-planet-id={currentPlanet.id}
          data-planet-name={currentPlanet.name}
          data-planet-coords={currentPlanet.coords}
        >
          <img src={currentPlanet.art} alt="" draggable={false} />
          <span className="hdr-planet-select__copy">
            <strong>{currentPlanet.name}<b aria-hidden="true">✓</b></strong>
            <small>{currentPlanet.coords} · {planetIndex + 1} из {planets.length}</small>
          </span>
          <i className={planetMenuOpen ? 'is-open' : ''} aria-hidden="true" />
        </button>

        <div
          className="hdr-planet-list"
          id="asterion-header-planet-list"
          role="listbox"
          aria-label="Выбор планеты"
          hidden={!planetMenuOpen}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closePlanetMenu();
            }
          }}
        >
          {planets.map((planet) => (
            <button
              key={planet.id}
              type="button"
              className={planet.id === currentPlanet.id ? 'active' : ''}
              role="option"
              aria-selected={planet.id === currentPlanet.id}
              data-qa-planet-option={planet.id}
              onClick={() => selectPlanet(planet.id)}
            >
              <img src={planet.art} alt="" />
              <span><strong>{planet.name}</strong><small>{planet.coords} · {planet.status}</small></span>
              <b aria-hidden="true">{planet.id === currentPlanet.id ? '✓' : ''}</b>
            </button>
          ))}
          <div>Новые планеты появятся здесь только после реальной колонизации.</div>
        </div>
      </div>

      <section className="hdr-core asterion-header__planet-module" style={{ '--storage-fill': storageFill } as CSSProperties}>
        <svg className="hdr-core__dial" viewBox="-120 -120 240 240" aria-hidden="true">
          <circle r="116" className="hdr-core__bezel" />
          <circle r="108" className="hdr-core__well" />
          <path d={gaugeArc(GAUGE_START, GAUGE_START + GAUGE_SWEEP)} className="hdr-core__track" />
          <path d={gaugeArc(GAUGE_START, GAUGE_START + Math.max(2, (GAUGE_SWEEP * storageFill) / 100))} className="hdr-core__gauge" />
          {Array.from({ length: 25 }, (_, index) => {
            const angle = ((GAUGE_START + (index * GAUGE_SWEEP) / 24) * Math.PI) / 180;
            const outer = 88;
            const inner = index % 6 ? 83 : 78;
            return <line key={index} x1={Math.cos(angle) * outer} y1={Math.sin(angle) * outer} x2={Math.cos(angle) * inner} y2={Math.sin(angle) * inner} className="hdr-core__tick" />;
          })}
        </svg>
        <button
          className="hdr-core__planet asterion-header__planet-orbit"
          type="button"
          onClick={() => {
            dismissPlanetMenuForNavigation();
            onRouteChange('planet');
          }}
          aria-label={`Открыть ${currentPlanet.name}`}
          title={`${currentPlanet.name} · склад заполнен на ${Math.round(storageFill)}%`}
          data-qa-planet-home
        >
          <img src={currentPlanet.art} alt={currentPlanet.name} draggable={false} />
        </button>
        <img className="hdr-core__emblem" src={FACTION_EMBLEMS[factionId]} alt="" aria-hidden="true" draggable={false} data-qa-faction-emblem={factionId} />
        {HEADER_ZONE_IDS.map((zone) => {
          const isActive = activeRoute === 'planet' && activeZone === zone;
          return (
            <button
              key={zone}
              type="button"
              className={`hdr-zone hdr-zone--${zone}${isActive ? ' active' : ''}`}
              title={zoneMeta[zone].title}
              aria-label={zoneMeta[zone].title}
              aria-pressed={isActive}
              data-qa-zone={zone}
              onClick={() => {
                dismissPlanetMenuForNavigation();
                onZoneChange(zone);
              }}
            >
              <HeaderGameIcon kind={zone} />
            </button>
          );
        })}
      </section>

      <nav className="hdr-routes" aria-label="Основная навигация" data-qa-navigation="primary">
        <div className="hdr-routes__side hdr-routes__side--left">{PRIMARY_NAVIGATION.slice(0, 3).map(routeButton)}</div>
        <div className="hdr-routes__side hdr-routes__side--right">{PRIMARY_NAVIGATION.slice(3).map(routeButton)}</div>
      </nav>

      <section className="hdr-campaign" data-qa-campaign>
        {campaign.mode === 'test' ? (
          <div className="hdr-test" data-qa-test-mode-banner onPointerDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="hdr-test__toggle"
              aria-expanded={speedMenuOpen}
              aria-label={`Тестовый режим, ускорение ×${campaign.timeScale}`}
              title={`Тестовый режим · ${campaign.saveKey}`}
              onClick={() => setSpeedMenuOpen((open) => !open)}
            >
              <span data-qa-test-time-scale>ТЕСТ ×{campaign.timeScale}</span><i aria-hidden="true" />
            </button>
            {campaign.timeScaleOptions?.length ? (
              <div className="hdr-test__menu" role="group" aria-label="Скорость тестового режима" hidden={!speedMenuOpen}>
                {campaign.timeScaleOptions.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    className={speed === campaign.timeScale ? 'active' : ''}
                    aria-pressed={speed === campaign.timeScale}
                    data-qa-test-speed={speed}
                    onClick={() => {
                      campaign.onTimeScaleChange?.(speed);
                      setSpeedMenuOpen(false);
                    }}
                  >
                    ×{speed}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="asterion-header__campaign-status"><i aria-hidden="true" />Кампания</div>
        )}
        <time>{new Date(campaign.now).toLocaleTimeString('ru-RU', { hour12: false })}</time>
      </section>

      <nav className="hdr-utility" aria-label="Служебная навигация" data-qa-navigation="utility">
        {UTILITY_NAVIGATION.map(({ id, label, icon }) => {
          const isActive = activeRoute === id;
          return (
            <button
              key={id}
              type="button"
              aria-label={label}
              title={label}
              aria-current={isActive ? 'page' : undefined}
              className={isActive ? 'active' : ''}
              data-route={id}
              data-qa-route={id}
              onClick={() => {
                dismissPlanetMenuForNavigation();
                onRouteChange(id);
              }}
            >
              <HeaderNavigationIcon kind={icon} factionId={factionId} />
            </button>
          );
        })}
      </nav>
    </header>
  );
}
