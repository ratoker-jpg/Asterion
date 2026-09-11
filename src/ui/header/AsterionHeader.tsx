import { useEffect, useRef } from 'react';
import { HeaderGameIcon, HeaderNavigationIcon } from './HeaderAssetIcons';
import { ResourceChip } from './ResourceChip';
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
  planetMenuOpen: boolean;
  campaign: HeaderCampaignModel;
  onRouteChange: (route: AppRoute) => void;
  onZoneChange: (zone: HeaderZoneId) => void;
  onPlanetChange: (planetId: string) => void;
  onPlanetMenuToggle: () => void;
};

export function AsterionHeader({
  factionId,
  currentPlanet,
  planets,
  resources,
  zoneMeta,
  activeRoute,
  activeZone,
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

  useEffect(() => {
    if (wasPlanetMenuOpen.current && !planetMenuOpen && restorePlanetFocusOnClose.current) {
      planetSelectRef.current?.focus();
    }
    if (!planetMenuOpen) restorePlanetFocusOnClose.current = false;
    wasPlanetMenuOpen.current = planetMenuOpen;
  }, [planetMenuOpen]);

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

  return (
    <header className="asterion-header" data-faction={factionId} data-qa-header>
      <section className="asterion-header__planet-module">
        <div className="asterion-header__planet-orbit">
          <button
            className="asterion-header__planet-world"
            type="button"
            onClick={() => {
              dismissPlanetMenuForNavigation();
              onRouteChange('planet');
            }}
            aria-label={`Открыть ${currentPlanet.name}`}
            data-qa-planet-home
          >
            <img src={currentPlanet.art} alt={currentPlanet.name} draggable={false} />
          </button>
          {HEADER_ZONE_IDS.map((zone) => {
            const isActive = activeRoute === 'planet' && activeZone === zone;
            return (
              <button
                key={zone}
                type="button"
                className={`asterion-header__zone asterion-header__zone--${zone} ${isActive ? 'active' : ''}`}
                title={zoneMeta[zone].title}
                aria-label={zoneMeta[zone].title}
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
        </div>

        <div className="asterion-header__planet-control">
          <button
            ref={planetSelectRef}
            className="asterion-header__planet-select"
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
            <img src={currentPlanet.art} alt={currentPlanet.name} draggable={false} />
            <span className="asterion-header__planet-select-copy">
              <small>ВЫБОР ПЛАНЕТЫ</small>
              <span className="asterion-header__planet-name-row">
                <strong>{currentPlanet.name}</strong>
                <b className="asterion-header__planet-selected-mark" aria-hidden="true">✓</b>
              </span>
              <em>{currentPlanet.coords}</em>
            </span>
            <span className={`asterion-header__planet-toggle ${planetMenuOpen ? 'is-open' : ''}`} aria-hidden="true"><span /></span>
          </button>
        </div>

        {planetMenuOpen ? (
          <div
            className="asterion-header__planet-list planet-list-popover"
            id="asterion-header-planet-list"
            role="listbox"
            aria-label="Выбор планеты"
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
        ) : null}
      </section>

      <section className="asterion-header__main">
        <div className="asterion-header__resource-rail" aria-label="Ресурсы планеты" data-qa-resource-rail>
          {resources.map((resource) => <ResourceChip key={resource.kind} {...resource} />)}
        </div>
        <nav className="asterion-header__primary-navigation" aria-label="Основная навигация" data-qa-navigation="primary">
          {PRIMARY_NAVIGATION.map(({ id, label, icon }) => {
            const isActive = activeRoute === id && !(id === 'planet' && activeZone !== null);
            return (
              <button
                key={id}
                type="button"
                className={isActive ? 'active' : ''}
                aria-current={isActive ? 'page' : undefined}
                data-route={id}
                data-qa-route={id}
                onClick={() => {
                  dismissPlanetMenuForNavigation();
                  onRouteChange(id);
                }}
              >
                <HeaderNavigationIcon kind={icon} factionId={factionId} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </section>

      <section className="asterion-header__campaign" data-qa-campaign>
        <span className="asterion-header__campaign-icon">✦</span>
        <div className="asterion-header__campaign-status"><strong>КАМПАНИЯ АКТИВНА</strong></div>
        <time>{new Date(campaign.now).toLocaleTimeString('ru-RU', { hour12: false })}</time>
        {campaign.mode === 'test' ? (
          <div className="asterion-header__test-mode-banner" data-qa-test-mode-banner>
            <strong>ТЕСТОВЫЙ РЕЖИМ</strong>
            {campaign.timeScaleOptions?.length ? (
              <div className="asterion-header__test-mode-speed-picker" role="group" aria-label="Скорость тестового режима">
                {campaign.timeScaleOptions.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    className={speed === campaign.timeScale ? 'active' : ''}
                    aria-pressed={speed === campaign.timeScale}
                    data-qa-test-speed={speed}
                    onClick={() => campaign.onTimeScaleChange?.(speed)}
                  >
                    ×{speed}
                  </button>
                ))}
              </div>
            ) : null}
            <small data-qa-test-time-scale>ускорение ×{campaign.timeScale} · {campaign.saveKey}</small>
          </div>
        ) : null}
        <nav className="asterion-header__utility-navigation" aria-label="Служебная навигация" data-qa-navigation="utility">
          {UTILITY_NAVIGATION.map(({ id, label, icon }) => {
            const isActive = activeRoute === id;
            return (
              <button
                key={id}
                type="button"
                aria-label={label}
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
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </section>
    </header>
  );
}
