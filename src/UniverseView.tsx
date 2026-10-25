import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { describeOwnerPresence, type OwnerPresence } from './application/owner-presence.ts';
import { DEBRIS_FINDER_ICON, SUN_DEBRIS_ART } from './ui/sun-raid/sun-raid-assets.ts';
import { NEARBY_DEBRIS_SYSTEM_SPAN, findDebrisNearSystem, nearbySystemWindow } from './domain/espionage/orbital-debris.ts';
import { createPortal } from 'react-dom';
import { EmblemGlyph } from './CommandView';
import { selectAllianceRelations } from './domain/command/diplomacy.ts';
import { FactionGeneralPortrait } from './ui/FactionGeneralPortrait.tsx';
import { EXPLORATION_ARTS } from './exploration-art.ts';
import { PIRATE_PLANET_ARTS } from './pirate-planet-art.ts';
import { asterionAssetIntegrationAssets } from './assets/generated/asterionAssetIntegrationManifest.generated.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon.tsx';
import pirateWarlordArt from '../assets/source/characters/pirates/pirate_warlord.png';
import debrisIcon from './assets/ui/header-icons/debris.png';
import './ui/universe/universe-radar.css';
import './ui/sun-raid/universe-sun.css';
import asteroid01 from '../assets/source/universe-navigation/asteroids/asteroid.variant-01.png';
import asteroid02 from '../assets/source/universe-navigation/asteroids/asteroid.variant-02.png';
import asteroid03 from '../assets/source/universe-navigation/asteroids/asteroid.variant-03.png';
import asteroid04 from '../assets/source/universe-navigation/asteroids/asteroid.variant-04.png';
import asteroid05 from '../assets/source/universe-navigation/asteroids/asteroid.variant-05.png';
import asteroid06 from '../assets/source/universe-navigation/asteroids/asteroid.variant-06.png';
import asteroid07 from '../assets/source/universe-navigation/asteroids/asteroid.variant-07.png';
import asteroid08 from '../assets/source/universe-navigation/asteroids/asteroid.variant-08.png';
import planet01 from '../assets/source/universe-navigation/planets/planet.variant-01.png';
import planet02 from '../assets/source/universe-navigation/planets/planet.variant-02.png';
import planet03 from '../assets/source/universe-navigation/planets/planet.variant-03.png';
import planet04 from '../assets/source/universe-navigation/planets/planet.variant-04.png';
import planet05 from '../assets/source/universe-navigation/planets/planet.variant-05.png';
import planet06 from '../assets/source/universe-navigation/planets/planet.variant-06.png';
import planet07 from '../assets/source/universe-navigation/planets/planet.variant-07.png';
import planet08 from '../assets/source/universe-navigation/planets/planet.variant-08.png';
import planet09 from '../assets/source/universe-navigation/planets/planet.variant-09.png';
import planet10 from '../assets/source/universe-navigation/planets/planet.variant-10.png';
import planet11 from '../assets/source/universe-navigation/planets/planet.variant-11.png';
import planet12 from '../assets/source/universe-navigation/planets/planet.variant-12.png';
import generated002 from '../assets/source/planets/skins/planet-002.png';
import generated003 from '../assets/source/planets/skins/planet-003.png';
import generated005 from '../assets/source/planets/skins/planet-005.png';
import generated011 from '../assets/source/planets/skins/planet-011.png';
import generated012 from '../assets/source/planets/skins/planet-012.png';
import generated015 from '../assets/source/planets/skins/planet-015.png';
import generated016 from '../assets/source/planets/skins/planet-016.png';
import generated026 from '../assets/source/planets/skins/planet-026.png';
import generated027 from '../assets/source/planets/skins/planet-027.png';
import generated028 from '../assets/source/planets/skins/planet-028.png';
import generated030 from '../assets/source/planets/skins/planet-030.png';
import generated032 from '../assets/source/planets/skins/planet-032.png';
import star01 from '../assets/source/universe-navigation/system-stars/system-star.variant-01.png';
import star02 from '../assets/source/universe-navigation/system-stars/system-star.variant-02.png';
import star03 from '../assets/source/universe-navigation/system-stars/system-star.variant-03.png';
import star04 from '../assets/source/universe-navigation/system-stars/system-star.variant-04.png';
import star05 from '../assets/source/universe-navigation/system-stars/system-star.variant-05.png';
import star06 from '../assets/source/universe-navigation/system-stars/system-star.variant-06.png';

import { selectOwnerAlliance } from './domain/command/selectors.ts';
import type { CommandState } from './domain/command/types.ts';
import { playerFactionLabel } from './domain/profile/repository.ts';
import type { PlayerProfileState } from './domain/profile/types.ts';
import type { OwnerScore } from './domain/rating/types.ts';
import type { RuntimeMode } from './domain/runtime/mode.ts';
import {
  GALAXY,
  getActiveGalaxyCount,
  MAX_PLANETS_PER_OWNER,
  SYSTEM_COUNT,
  UNIVERSE_NPC_OWNER_ID,
  createUniverseNpcOwnerProfile,
  TEST_MODE_ALLY_PLANET_FIXTURE,
  createUniverseMap,
  createUniverseSystem,
  formatUniverseCoordinate,
  getUniverseActionState,
  getUniverseNodeCaption,
  getUniverseObjectKindLabel,
  getUniverseSlotPoint,
  getUniverseAsteroidPoint,
  getUniverseOwnerRelation,
  getUniverseTransportLaunchTarget,
  type UniverseOwnerRelation,
  normalizeUniverseOwnerProfile,
} from './domain/universe/runtime.ts';
import type {
  UniverseAction,
  UniverseAssetCatalog,
  UniverseOwnerAlliance,
  UniverseOwnerPoints,
  UniverseOwnerProfile,
  UniversePersistedPlayerPlanet,
  UniverseRegisteredPlanet,
  UniversePlanetNode,
  UniverseCoordinate,
  UniverseAsteroidRuntimeState,
} from './domain/universe/types.ts';
import type { PirateContactState } from './domain/pirates/contact.ts';
import type { PirateContactPresentation, PirateSystemSelection } from './pirate-ui.ts';
import type { TargetRelation } from './domain/flights/types.ts';
import type { SpyTargetState } from './domain/espionage/types.ts';

const planetArts = [
  planet01, planet02, planet03, planet04, planet05, planet06, planet07, planet08, planet09, planet10, planet11, planet12,
  generated002, generated003, generated005, generated011, generated012, generated015, generated016, generated026, generated027, generated028, generated030, generated032,
];
const starArts = [star01, star02, star03, star04, star05, star06];
const asteroidArts = [asteroid01, asteroid02, asteroid03, asteroid04, asteroid05, asteroid06, asteroid07, asteroid08];
const pirateArts = PIRATE_PLANET_ARTS;
const anomalyArts = EXPLORATION_ARTS.anomaly;
const assets: UniverseAssetCatalog = {
  planetArts, starArts, asteroidArts, pirateArts, anomalyArts,
  uniqueArts: EXPLORATION_ARTS.unique,
};

type UniverseViewProps = {
  onNotice: (message: string) => void;
  /** Who is at the game: exact for allies, coarse for everyone else. */
  ownerPresence?: Readonly<Record<string, OwnerPresence>>;
  ownedPlanetArt: string;
  ownedPlanetName: string;
  profile: PlayerProfileState;
  ownerScores: Readonly<Record<string, OwnerScore>>;
  command: CommandState;
  playerPlanets: readonly UniversePersistedPlayerPlanet[];
  spyTargets: readonly SpyTargetState[];
  orbitalDebrisByCoordinate: readonly { coordinate: UniverseCoordinate; debris: number }[];
  asteroidDebrisPresenceBySpawnIndex?: Readonly<Record<string, boolean>>;
  asteroidStates?: readonly UniverseAsteroidRuntimeState[];
  pirateContactState?: PirateContactState | null;
  pirateContacts?: readonly PirateContactPresentation[];
  pirateFocusTarget?: Pick<PirateContactPresentation, 'coordinate' | 'contactCycleKey'> | null;
  mode: RuntimeMode;
  onColonize: (coordinate: UniverseCoordinate) => void;
  onAsteroidRecycler: (target: { spawnIndex: number; coordinate: UniverseCoordinate }) => void;
  onExpedition?: (node: UniversePlanetNode) => void;
  onExplorationRecon?: (node: UniversePlanetNode) => void;
  explorationEligibility?: Readonly<Record<string, 'free' | 'self' | 'occupied'>>;
  onTransport: (target: { planetId: string; coordinate: UniverseCoordinate; relation: TargetRelation }) => void;
  onSpy: (target: { planetId: string; planetName: string; coordinate: UniverseCoordinate; relation: Extract<TargetRelation, 'enemy' | 'neutral'>; owner: UniverseOwnerProfile; targetKind: 'player' | 'npc' }) => void;
  onAttack: (target: { planetId: string; planetName: string; coordinate: UniverseCoordinate; relation: Extract<TargetRelation, 'enemy' | 'neutral'>; owner: UniverseOwnerProfile; targetKind: 'player' | 'npc' }) => void;
  onPirateRecon?: (contact: PirateContactPresentation) => void;
  onPirateAttack?: (contact: PirateContactPresentation) => void;
  onPirateReport?: (reportId: string) => void;
  onPirateSystemChange?: (selection: PirateSystemSelection) => void;
  focusTarget?: { coordinate: UniverseCoordinate; planetId?: string; ownerId?: string; mode?: 'inspect' | 'highlight' } | null;
  /** «Найти обломки» scans the systems around this planet (the one selected in the header). */
  debrisOrigin?: { planetName: string; coordinate: UniverseCoordinate } | null;
  /** «Отправить»: opens «Флоты → Переработка» aimed at the coordinate (position 0 = the Sun). */
  onRecycleDebris?: (coordinate: UniverseCoordinate) => void;
  onFocusHandled?: () => void;
  /** Click on the system's Sun: opens «Командование → Операции» for it. */
  onSunSelect?: (galaxy: number, system: number) => void;
  /** Suns of the player's galaxies with an incoming raid. */
  sunAlerts?: readonly { galaxy: number; system: number }[];
  /** The map opens on the home system (random starts are no longer [1:1]). */
  homeCoordinate?: { galaxy: number; system: number };
};

const POINT_LABELS: ReadonlyArray<{ key: keyof UniverseOwnerPoints; label: string }> = [
  { key: 'resource', label: 'Ресурсные очки' },
  { key: 'battle', label: 'Боевые очки' },
  { key: 'total', label: 'Общие очки' },
  { key: 'achievements', label: 'Очки достижений' },
];

const numberFormat = new Intl.NumberFormat('ru-RU');

/** Map filter keys; the labels are the map legend (Electron QA reads them in this order). */
type LegendKey = 'self' | 'ally' | 'enemy' | 'neutral' | 'wild' | 'unique' | 'pirate' | 'anomaly';
const LEGEND: readonly (readonly [LegendKey, string])[] = [
  ['self', 'Ваш мир'], ['ally', 'Союзная'], ['enemy', 'Вражеская'], ['neutral', 'Нейтральная'],
  ['wild', 'Необитаемые'], ['unique', 'Уникальные'], ['pirate', 'Отступники'], ['anomaly', 'Аномалии'],
];
const LISTED_KINDS = new Set<UniversePlanetNode['kind']>(['player', 'npc', 'pirate', 'unique', 'anomaly']);

function legendKeyOf(node: UniversePlanetNode, relation: UniverseOwnerRelation | null): LegendKey {
  if (relation) return relation;
  if (node.kind === 'unique') return 'unique';
  if (node.kind === 'pirate') return 'pirate';
  if (node.kind === 'anomaly') return 'anomaly';
  return 'wild';
}

function ownerPoints(score: OwnerScore | undefined): UniverseOwnerPoints {
  return {
    resource: score?.resourcePoints ?? 0,
    battle: score?.battlePoints ?? 0,
    total: score?.totalPoints ?? 0,
    achievements: score?.achievementPoints ?? 0,
  };
}

function toStyle(point: { x: number; y: number; offsetX?: number; offsetY?: number }): CSSProperties {
  return {
    '--x': `${point.x}%`,
    '--y': `${point.y}%`,
    '--asteroid-offset-x': `${point.offsetX ?? 0}px`,
    '--asteroid-offset-y': `${point.offsetY ?? 0}px`,
  } as CSSProperties;
}

function countdownLabel(nowMs: number, targetMs?: number) {
  if (!Number.isFinite(targetMs)) return '—';
  const seconds = Math.max(0, Math.ceil((Number(targetMs) - nowMs) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes} мин ${String(remainder).padStart(2, '0')} с` : `${remainder} с`;
}

function raceLabel(raceId?: string) {
  if (!raceId) return 'Раса не указана';
  if (raceId === 'aegis' || raceId === 'synod' || raceId === 'veyra') return playerFactionLabel(raceId);
  return raceId;
}

function OwnerAvatar({ owner }: { owner: UniverseOwnerProfile }) {
  if (owner.raceId) return <FactionGeneralPortrait factionId={owner.raceId} className="universe-owner-avatar__image" />;
  if (owner.avatarArt) return <img className="universe-owner-avatar__image" src={owner.avatarArt} alt="" draggable={false} />;
  return <span className="universe-owner-avatar__fallback" aria-hidden="true">{owner.displayName.slice(0, 2).toUpperCase()}</span>;
}

function AllianceMark({ alliance }: { alliance?: UniverseOwnerAlliance | null }) {
  if (alliance) return <span aria-label={`${alliance.name} [${alliance.tag}]`}><EmblemGlyph emblem={alliance.emblem} compact /></span>;
  return (
    <span
      className="universe-alliance-mark"
      aria-label="Без союза"
    >
      —
    </span>
  );
}

function EyeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-5.2 9.5-5.2 9.5 5.2 9.5 5.2-3.4 5.2-9.5 5.2S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.6" /></svg>;
}

function FleetIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 4.1 12.3-4.1-2.5-4.1 2.5L12 2.5Z" /><path d="M8.5 12H4l3.4-3.4M15.5 12H20l-3.4-3.4M12 7v8" /></svg>;
}

function AttackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 19 5.4-5.4M13.6 10.4 19 5" /><path d="m14.5 4.5 5 0 0 5M4.5 14.5l0 5 5 0" /><circle cx="12" cy="12" r="2.3" /></svg>;
}

function UniverseActionButton({
  action,
  node,
  currentOwnerId,
  relation,
  onAction,
}: {
  action: UniverseAction;
  node: UniversePlanetNode;
  currentOwnerId: string;
  relation: ReturnType<typeof getUniverseOwnerRelation>;
  onAction: (action: UniverseAction, node: UniversePlanetNode) => void;
}) {
  const state = getUniverseActionState(action, node, currentOwnerId, relation);
  const Icon = action === 'spy' ? EyeIcon : action === 'attack' ? AttackIcon : FleetIcon;
  const label = action === 'spy' ? 'Отправить шпионский зонд' : action === 'attack' ? 'Начать атаку' : 'Отправить флот';
  const title = `${label}: ${state.reason}`;

  return (
    <button
      type="button"
      className={`universe-action-button universe-action-button--${action}`}
      aria-label={`${label} к ${node.name} ${formatUniverseCoordinate(node.coordinate)}`}
      title={title}
      disabled={!state.enabled}
      data-qa-universe-action={action}
      data-qa-universe-action-status={state.status}
      onClick={() => onAction(action, node)}
    >
      <Icon />
    </button>
  );
}

const SCORE_ICON_KEYS: Record<keyof UniverseOwnerPoints, 'resourcePoints' | 'battlePoints' | 'totalPoints' | 'achievementPoints'> = {
  resource: 'resourcePoints', battle: 'battlePoints', total: 'totalPoints', achievements: 'achievementPoints',
};
const SHORT_POINT_LABELS: Record<keyof UniverseOwnerPoints, string> = {
  resource: 'Ресурсные', battle: 'Боевые', total: 'Общие', achievements: 'Достижения',
};
const RELATION_TONE: Record<ReturnType<typeof getUniverseOwnerRelation>, string> = {
  // The player's own world uses the race accent (docs/ui/race-accent.md); ally/enemy keep their meaning.
  self: 'var(--race-accent-strong)', ally: '#35e58a', enemy: '#f0445e', neutral: '#f0445e',
};
const RELATION_COPY: Record<ReturnType<typeof getUniverseOwnerRelation>, string> = {
  self: 'Ваш мир · принимает транспорт',
  ally: 'Союзник · принимает транспорт',
  enemy: 'Враг · доступны шпионаж и атака',
  neutral: 'Чужой мир · доступны шпионаж и атака',
};
export const SPECIAL_TONE: Partial<Record<UniversePlanetNode['kind'], string>> = {
  empty: '#8fb6c0', uninhabited: '#8fb6c0', asteroid: '#c9b48a', pirate: '#ff7a62', unique: '#e6ad50', anomaly: '#a98bff',
};

/** Large orbital debris stays readable in a fixed column: 168 801 300 → «168,8 млн». */
function compactAmount(value: number) {
  if (value >= 1e9) return `${(value / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млрд`;
  if (value >= 1e6) return `${(value / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`;
  if (value >= 1e4) return `${Math.round(value / 1e3).toLocaleString('ru-RU')} тыс`;
  return numberFormat.format(value);
}

function InspectorHero({ art, children }: { art?: string; children?: ReactNode }) {
  return (
    <div className="uw-hero">
      <span className="uw-hero-ring" aria-hidden="true" />
      {art ? <img src={art} alt="" draggable={false} /> : <span className="uw-hero-empty" aria-hidden="true">＋</span>}
      {children}
    </div>
  );
}

type InspectorTile = { label: string; value: ReactNode; note?: ReactNode; tone?: 'good' | 'bad' | 'time' | 'off'; progress?: number; attrs?: Record<string, string> };

function InspectorTiles({ items }: { items: readonly InspectorTile[] }) {
  return (
    <div className="uw-tiles">
      {items.map((item) => (
        <div key={item.label} className={`uw-tile ${item.tone ? `is-${item.tone}` : ''}`} {...item.attrs}>
          <small>{item.label}</small>
          <b>{item.value}</b>
          {item.note ? <span>{item.note}</span> : null}
          {item.progress !== undefined ? <i className="uw-tile-bar"><i style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} /></i> : null}
        </div>
      ))}
    </div>
  );
}

function OwnerInspector({
  node,
  owner,
  planets,
  currentOwnerId,
  currentAlliance,
  diplomacy,
  debrisAt,
  onAction,
  onVisit,
  presence,
  nowMs,
}: {
  node: UniversePlanetNode;
  owner: UniverseOwnerProfile;
  planets: UniversePlanetNode[];
  currentOwnerId: string;
  currentAlliance: UniverseOwnerAlliance | null | undefined;
  diplomacy: CommandState['diplomacy'];
  debrisAt: (coordinate: UniverseCoordinate) => number;
  onAction: (action: UniverseAction, node: UniversePlanetNode) => void;
  onVisit: (node: UniversePlanetNode) => void;
  presence: OwnerPresence | undefined;
  nowMs: number;
}) {
  const alliance = owner.alliance;
  const relation = getUniverseOwnerRelation(node, currentOwnerId, currentAlliance, owner, diplomacy);
  const presenceLabel = describeOwnerPresence(presence, nowMs, relation === 'self' || relation === 'ally');
  return (
    <div className="uw-main uw-main--owner" data-qa-universe-owner={owner.id} data-qa-universe-owner-profile style={{ '--uw-k': RELATION_TONE[relation] } as CSSProperties}>
      <div className="uw-side">
        <InspectorHero art={node.art} />
        <section className="uw-card uw-owner">
          <div className="uw-owner-avatar" data-qa-universe-avatar><OwnerAvatar owner={owner} /></div>
          <div className="uw-owner-copy">
            <small>ВЛАДЕЛЕЦ ОБЪЕКТА</small>
            <h3 data-qa-universe-owner-name>{owner.displayName}</h3>
            <span>{raceLabel(owner.raceId)}</span>
            <em className={`uw-owner-presence is-${presenceLabel.tone}`} data-qa-universe-owner-presence={presenceLabel.tone}><i aria-hidden="true" />{presenceLabel.text}</em>
            <strong>{owner.id === currentOwnerId ? 'ВАШ ПРОФИЛЬ' : 'ПРОФИЛЬ ВЛАДЕЛЬЦА'}</strong>
          </div>
        </section>
        <section className={`uw-card uw-alliance ${alliance ? '' : 'is-none'}`}>
          <div className="uw-alliance-crest"><AllianceMark alliance={alliance} /></div>
          <div className="uw-alliance-copy">
            <small>СОЮЗ</small>
            <b>{alliance ? alliance.name : 'Без союза'}</b>
            {alliance ? <em>[{alliance.tag}]</em> : <span>игрок не состоит в союзе</span>}
          </div>
        </section>
      </div>
      <div className="uw-content">
        {owner.points ? (
          <dl className="uw-tiles uw-points" data-qa-universe-points>
            {POINT_LABELS.map(({ key, label }) => (
              <div key={key} className="uw-tile uw-point" title={label}>
                <img src={asterionAssetIntegrationAssets.scoreIcons[SCORE_ICON_KEYS[key]]} alt="" aria-hidden="true" draggable={false} />
                <dt>{SHORT_POINT_LABELS[key]}</dt>
                <dd>{numberFormat.format(owner.points?.[key] ?? 0)}</dd>
                <span>очков</span>
              </div>
            ))}
          </dl>
        ) : (
          <div className="uw-tiles uw-points is-empty" data-qa-universe-points>
            {POINT_LABELS.map(({ key, label }) => (
              <div key={key} className="uw-tile uw-point is-off" title={label}>
                <img src={asterionAssetIntegrationAssets.scoreIcons[SCORE_ICON_KEYS[key]]} alt="" aria-hidden="true" draggable={false} />
                <small>{SHORT_POINT_LABELS[key]}</small><b>—</b><span>рейтинг не задан</span>
              </div>
            ))}
          </div>
        )}
        <section className="uw-block">
          <header><b>ВЛАДЕНИЯ В ГАЛАКТИКЕ · {planets.length} {planets.length === 1 ? 'ПЛАНЕТА' : 'ПЛАНЕТ'}</b><span>обломки на орбите · шпионаж · флот · атака</span></header>
          <ul className="uw-planets">
            {planets.slice(0, MAX_PLANETS_PER_OWNER).map((planet) => {
              const debris = debrisAt(planet.coordinate);
              const rowRelation = getUniverseOwnerRelation(planet, currentOwnerId, currentAlliance, owner, diplomacy);
              return (
                <li key={planet.id} className={planet.id === node.id ? 'active' : ''} data-qa-universe-planet-row={planet.id}>
                  <img className="uw-planet-art" src={planet.art} alt="" />
                  <button type="button" className="uw-planet-copy" data-qa-universe-visit={planet.id} onClick={() => onVisit(planet)} title={`Показать на карте ${formatUniverseCoordinate(planet.coordinate)}`}>
                    <strong>{planet.name}</strong>
                    <small>Система {String(planet.coordinate.system).padStart(2, '0')} <span>{formatUniverseCoordinate(planet.coordinate)} ↗</span></small>
                  </button>
                  <span className="uw-planet-debris" title={debris > 0 ? `Обломки на орбите: ${numberFormat.format(debris)}` : undefined}>
                    {debris > 0 ? <><ResourceIcon kind="debris" />{compactAmount(debris)}</> : null}
                  </span>
                  <div className="uw-planet-actions">
                    <UniverseActionButton action="spy" node={planet} currentOwnerId={currentOwnerId} relation={rowRelation} onAction={onAction} />
                    <UniverseActionButton action="fleet" node={planet} currentOwnerId={currentOwnerId} relation={rowRelation} onAction={onAction} />
                    <UniverseActionButton action="attack" node={planet} currentOwnerId={currentOwnerId} relation={rowRelation} onAction={onAction} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="uw-note">Нажмите на планету, чтобы перейти к её системе. Свои и союзные миры принимают транспорт, вражеские и нейтральные доступны для шпионажа и атаки.</p>
        </section>
      </div>
      <footer className="uw-foot">
        <div className="uw-foot-status"><small>ОТНОШЕНИЕ</small><b>{RELATION_COPY[relation]}</b></div>
        <div className="uw-foot-actions">
          <button type="button" className="uw-btn" onClick={() => onVisit(node)}>ПОКАЗАТЬ НА КАРТЕ</button>
        </div>
      </footer>
    </div>
  );
}

type ActionInfo = { label: string; description: string; enabled: boolean };

function SpecialInspector({ node, underlyingNode, nowMs, asteroidHasDebris, pirateContact, onColonize, onAsteroidRecycler, onExpedition, onExplorationRecon, explorationStatus, onPirateRecon, onPirateAttack, onPirateReport }: { node: UniversePlanetNode; underlyingNode?: UniversePlanetNode; nowMs: number; asteroidHasDebris: boolean; pirateContact?: PirateContactPresentation; onColonize: (coordinate: UniverseCoordinate) => void; onAsteroidRecycler: (target: { spawnIndex: number; coordinate: UniverseCoordinate }) => void; onExpedition?: (node: UniversePlanetNode) => void; onExplorationRecon?: (node: UniversePlanetNode) => void; explorationStatus?: 'free' | 'self' | 'occupied'; onPirateRecon?: (contact: PirateContactPresentation) => void; onPirateAttack?: (contact: PirateContactPresentation) => void; onPirateReport?: (reportId: string) => void }) {
  const isEmpty = node.kind === 'empty';
  const isPirate = node.kind === 'pirate';
  const isAnomaly = node.kind === 'anomaly';
  const isUnique = node.kind === 'unique';
  const isAsteroid = node.kind === 'asteroid';
  const isExploration = isAnomaly || isUnique;
  const canColonize = isEmpty || (isAsteroid && underlyingNode?.kind === 'empty');
  const timedState = node.pirate ?? node.special;
  const reconEnabled = Boolean(pirateContact?.recon.enabled && onPirateRecon);
  const eliminationEnabled = Boolean(pirateContact?.elimination.enabled && onPirateAttack);
  const reportEnabled = Boolean(pirateContact?.latestReportId && onPirateReport);
  const reconReason = pirateContact?.recon.disabledReason || (!onPirateRecon ? 'Действие временно недоступно.' : 'Разведка сейчас недоступна.');
  const eliminationReason = pirateContact?.elimination.disabledReason || (!onPirateAttack ? 'Подготовка флота временно недоступна.' : 'Атака сейчас недоступна.');
  const reportReason = !pirateContact?.latestReportId ? 'Разведотчёт ещё не сформирован.' : !onPirateReport ? 'Открытие отчёта временно недоступно.' : '';
  const status = isPirate && pirateContact
    ? `${pirateContact.statusLabel} · исчезнет через ${countdownLabel(nowMs, pirateContact.expiresAt)}`
    : isAsteroid
    ? `Следующее перемещение через ${countdownLabel(nowMs, node.asteroid?.nextMoveAt)}`
    : timedState
      ? `Активен · исчезнет через ${countdownLabel(nowMs, timedState.expiresAt)}`
      : node.statusLabel;
  const explorationLabel = explorationStatus === 'occupied' ? 'ЗАНЯТО · необходима атака' : explorationStatus === 'self' ? 'ЗАНЯТО · ваш флот' : explorationStatus === 'free' ? 'СВОБОДНО · доступно исследование' : 'Вне зоны видимости колоний';
  const subtitle = node.known === false ? 'Неизученный сигнал' : isAsteroid ? 'Траектория наблюдается · содержание неизвестно' : node.kind === 'uninhabited' ? 'Владелец отсутствует' : isExploration ? explorationStatus === 'occupied' ? 'Объект занят чужим флотом' : explorationStatus === 'self' ? 'Ваш флот добывает ресурсы' : 'Объект свободен' : 'Галактика ' + String(node.coordinate.galaxy).padStart(2, '0') + ' · Система ' + String(node.coordinate.system).padStart(2, '0');
  const timedTotal = timedState?.expiresAt && timedState?.startAt ? timedState.expiresAt - timedState.startAt : 0;
  const timedProgress = timedTotal > 0 && timedState?.expiresAt ? ((timedState.expiresAt - nowMs) / timedTotal) * 100 : undefined;
  const reconOutcome = pirateContact?.latestReportOutcome;

  const tiles: InspectorTile[] = isAsteroid ? [
    { label: 'ПЕРЕМЕЩЕНИЕ', value: countdownLabel(nowMs, node.asteroid?.nextMoveAt), note: 'до следующей позиции', tone: 'time' },
    { label: 'ЗАПАС ГАЗА', value: <><ResourceIcon kind="gas" />Скрыт</>, note: 'до переработки', tone: 'bad' },
    { label: 'ОБЛОМКИ', value: <><ResourceIcon kind="debris" />{asteroidHasDebris ? 'Есть' : 'Нет'}</>, note: 'на астероиде', tone: asteroidHasDebris ? 'good' : 'off' },
    { label: 'ОРБИТА', value: `${node.coordinate.position} / 24`, note: `кольцо ${Math.ceil(node.coordinate.position / 6)}` },
  ] : isPirate ? [
    { label: 'ИСЧЕЗНЕТ', value: pirateContact ? countdownLabel(nowMs, pirateContact.expiresAt) : countdownLabel(nowMs, timedState?.expiresAt), note: 'затем пауза 15 мин', tone: 'time', progress: timedProgress },
    { label: 'РАЗВЕДКА', value: reconOutcome === 'success' ? 'Успешна' : reconOutcome === 'failure' ? 'Не удалась' : pirateContact?.statusLabel === 'Зонд в пути' ? 'Зонд в пути' : 'Нет данных', note: reportEnabled ? 'отчёт в «Системе»' : 'разведотчёт не сформирован', tone: reconOutcome === 'success' ? 'good' : 'bad' },
    { label: 'ОБЛОМКИ', value: <><ResourceIcon kind="debris" />125–175%</>, note: 'жизни пиратских кораблей', tone: 'good' },
    { label: 'ЦИКЛ', value: pirateContact ? String(pirateContact.cycleIndex) : '—', note: <span data-qa-universe-pirate-cycle={pirateContact?.contactCycleKey ?? node.pirate?.contactCycleKey ?? ''}>{pirateContact ? formatUniverseCoordinate(pirateContact.coordinate) : 'СИНХРОНИЗАЦИЯ КОНТАКТА'}</span> },
  ] : isExploration ? [
    { label: 'ИСЧЕЗНЕТ', value: countdownLabel(nowMs, timedState?.expiresAt), note: 'активен', tone: 'time', progress: timedProgress },
    { label: 'ЗАНЯТОСТЬ', value: explorationStatus === 'free' ? 'Свободно' : explorationStatus === 'self' ? 'Ваш флот' : explorationStatus === 'occupied' ? 'Занято' : 'Свободно', note: explorationStatus === 'occupied' ? 'нужна атака' : explorationStatus === 'self' ? 'добывает ресурсы' : 'никем не занят', tone: explorationStatus === 'occupied' ? 'bad' : 'good' },
    { label: 'ЭКСПЕДИЦИЯ', value: explorationStatus ? 'В радиусе' : 'Вне радиуса', note: 'до 5 систем от колоний', tone: explorationStatus ? 'good' : 'bad', attrs: { 'data-qa-universe-exploration-status': explorationStatus ?? 'out' } },
    { label: 'СИСТЕМА', value: String(node.coordinate.system).padStart(2, '0'), note: `Галактика ${String(node.coordinate.galaxy).padStart(2, '0')}` },
  ] : node.kind === 'uninhabited' ? [
    { label: 'ВЛАДЕЛЕЦ', value: 'Нет', note: 'владелец отсутствует', tone: 'off' },
    { label: 'СИСТЕМА', value: String(node.coordinate.system).padStart(2, '0'), note: `Галактика ${String(node.coordinate.galaxy).padStart(2, '0')}` },
    { label: 'ПОЗИЦИЯ', value: `${node.coordinate.position} / 24`, note: `кольцо ${Math.ceil(node.coordinate.position / 6)}` },
    { label: 'КОЛОНИЗАЦИЯ', value: 'Скоро', note: 'механика в разработке', tone: 'time' },
  ] : [
    { label: 'СТАТУС', value: 'Свободно', note: 'орбита пуста', tone: 'good' },
    { label: 'СИСТЕМА', value: String(node.coordinate.system).padStart(2, '0'), note: `Галактика ${String(node.coordinate.galaxy).padStart(2, '0')}` },
    { label: 'ПОЗИЦИЯ', value: `${node.coordinate.position} / 24`, note: `кольцо ${Math.ceil(node.coordinate.position / 6)}` },
    { label: 'ВЛАДЕЛЕЦ', value: 'Нет', note: 'можно основать колонию', tone: 'off' },
  ];

  const actionInfo: ActionInfo[] = [
    ...(canColonize ? [{ label: 'КОЛОНИЗИРОВАТЬ', description: 'Открыть подготовку колонизации', enabled: true }] : []),
    ...(isAsteroid && node.asteroid ? [{ label: 'ОТПРАВИТЬ ПЕРЕРАБОТЧИКА', description: 'Сначала собрать газ, затем обломки', enabled: true }] : []),
    ...(isPirate ? [
      { label: 'РАЗВЕДАТЬ', description: reconEnabled ? 'Отправить разведывательный зонд к этому циклу контакта' : reconReason, enabled: reconEnabled },
      { label: 'ПИРАТСКИЙ РЕЙД', description: eliminationEnabled ? 'Подготовить пиратский рейд' : eliminationReason, enabled: eliminationEnabled },
      { label: 'ОТКРЫТЬ РАЗВЕДОТЧЁТ', description: reportEnabled ? 'Открыть разведотчёт этого цикла' : reportReason, enabled: reportEnabled },
    ] : []),
    ...(isExploration ? [
      { label: 'ИССЛЕДОВАТЬ ЗОНДОМ', description: 'Принять исследовательскую операцию и отправить один шпионский зонд', enabled: Boolean(onExplorationRecon && explorationStatus) },
      { label: 'ЭКСПЕДИЦИЯ', description: explorationStatus === 'occupied' ? 'Объект занят. Для захвата нужна миссия «Атака».' : explorationStatus === 'self' ? 'Ваш флот уже добывает здесь.' : explorationStatus !== 'free' ? 'Экспедиция доступна в пределах пяти систем от ваших колоний.' : 'Подготовить экспедицию', enabled: Boolean(onExpedition && explorationStatus === 'free') },
    ] : []),
    ...(!canColonize && !isAsteroid && !isPirate && !isExploration ? [{ label: node.kind === 'uninhabited' ? 'КОЛОНИЗАЦИЯ' : 'ИССЛЕДОВАНИЕ', description: 'Механика появится позже', enabled: false }] : []),
  ];

  return (
    <div className={`uw-main uw-main--special uw-main--${node.kind}`} data-qa-universe-special={node.kind} data-qa-universe-underlying-kind={underlyingNode?.kind ?? (isEmpty ? 'empty' : '')}
      style={{ '--uw-k': SPECIAL_TONE[node.kind] ?? '#8fb6c0' } as CSSProperties}>
      <div className="uw-side">
        <InspectorHero art={node.art}>
          <div className="uw-hero-caption"><b>{getUniverseObjectKindLabel(node.kind)}</b><span>{subtitle}</span></div>
        </InspectorHero>
        {isPirate ? <section className="uw-card uw-owner">
          <div className="uw-owner-avatar"><img src={pirateWarlordArt} alt="" draggable={false} /></div>
          <div className="uw-owner-copy"><small>КОМАНДИР БАЗЫ</small><h3>Пираты</h3><span>Отступник</span><strong>{reconOutcome === 'success' ? 'ГАРНИЗОН РАЗВЕДАН' : 'СОСТАВ ГАРНИЗОНА НЕИЗВЕСТЕН'}</strong></div>
        </section> : null}
        <dl className="uw-card uw-facts">
          <div><dt>ТИП ПОЗИЦИИ</dt><dd>{getUniverseObjectKindLabel(node.kind)}</dd></div>
          <div><dt>{isAsteroid ? 'ОРБИТА' : 'КООРДИНАТЫ'}</dt><dd>{isAsteroid ? `Кольцо ${Math.ceil(node.coordinate.position / 6)} · позиция ${node.coordinate.position} / 24` : formatUniverseCoordinate(node.coordinate)}</dd></div>
          <div><dt>СТАТУС</dt><dd data-qa-universe-special-status>{isExploration ? `${explorationLabel} · ` : ''}{status}</dd></div>
          {isAsteroid ? <div><dt>ЗАПАС ГАЗА</dt><dd data-qa-universe-asteroid-gas="hidden">СКРЫТ ДО ПЕРЕРАБОТКИ</dd></div> : null}
          {isAsteroid ? <div data-qa-universe-asteroid-debris={asteroidHasDebris ? 'present' : 'absent'}><dt>Обломки на астероиде</dt><dd>{asteroidHasDebris ? 'есть' : 'нет'}</dd></div> : null}
        </dl>
      </div>
      <div className="uw-content">
        <InspectorTiles items={tiles} />
        <section className="uw-block">
          <header><b>СВЕДЕНИЯ</b><span>{getUniverseObjectKindLabel(node.kind)}</span></header>
          <p className="uw-desc">{node.description}</p>
          {isExploration ? <div className={'uw-occupancy uw-occupancy--' + (explorationStatus ?? 'out')}>
            {explorationStatus === 'free' ? '● СВОБОДНО' : explorationStatus === 'self' ? '● ВАШ ФЛОТ ДОБЫВАЕТ' : explorationStatus === 'occupied' ? '● ЗАНЯТО ЧУЖИМ ФЛОТОМ' : '● ВНЕ РАДИУСА ЭКСПЕДИЦИИ'}
          </div> : null}
          <header className="uw-subhead"><b>ДОСТУПНЫЕ ДЕЙСТВИЯ</b><span>{actionInfo.filter((item) => item.enabled).length} из {actionInfo.length}</span></header>
          <ul className="uw-howto">
            {actionInfo.map((item) => (
              <li key={item.label} className={item.enabled ? '' : 'is-off'}>
                <i aria-hidden="true" /><div><b>{item.label}</b><span>{item.description}</span></div><em>{item.enabled ? 'ДОСТУПНО' : 'НЕДОСТУПНО'}</em>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <footer className="uw-foot">
        <div className="uw-foot-status"><small>СТАТУС</small><b>{isExploration ? explorationLabel : status}</b></div>
        <div className="uw-foot-actions">
          {canColonize ? (
            <button type="button" className={`uw-btn ${isAsteroid ? '' : 'uw-btn--primary'}`} title="Открыть подготовку колонизации" data-qa-universe-special-action="colonize" data-qa-universe-target-coordinate={formatUniverseCoordinate(node.coordinate)} onClick={() => onColonize(node.coordinate)}>КОЛОНИЗИРОВАТЬ</button>
          ) : null}
          {isAsteroid && node.asteroid ? <button type="button" className="uw-btn uw-btn--primary" title="Отправить переработчика: сначала собрать газ, затем обломки" data-qa-universe-special-action="asteroid-recycler" data-qa-universe-target-coordinate={formatUniverseCoordinate(node.coordinate)} data-qa-universe-asteroid-spawn-index={node.asteroid.spawnIndex} onClick={() => onAsteroidRecycler({ spawnIndex: node.asteroid!.spawnIndex, coordinate: node.coordinate })}>ОТПРАВИТЬ ПЕРЕРАБОТЧИКА</button> : null}
          {isPirate ? <>
            <button type="button" className="uw-btn" disabled={!reportEnabled} title={reportEnabled ? 'Открыть разведотчёт этого цикла' : reportReason} data-qa-universe-special-action="pirate-report" data-qa-universe-contact-cycle={pirateContact?.contactCycleKey ?? ''} onClick={() => pirateContact?.latestReportId && onPirateReport?.(pirateContact.latestReportId)}>ОТКРЫТЬ РАЗВЕДОТЧЁТ</button>
            <button type="button" className="uw-btn" disabled={!reconEnabled} title={reconEnabled ? 'Отправить разведывательный зонд к этому циклу контакта' : reconReason} data-qa-universe-special-action="pirate-recon" data-qa-universe-contact-cycle={pirateContact?.contactCycleKey ?? ''} onClick={() => pirateContact && onPirateRecon?.(pirateContact)}>{reconOutcome === 'success' ? 'РАЗВЕДАТЬ СНОВА' : 'РАЗВЕДАТЬ'}</button>
            <button type="button" className="uw-btn uw-btn--pirate" disabled={!eliminationEnabled} title={eliminationEnabled ? 'Подготовить пиратский рейд' : eliminationReason} data-qa-universe-special-action="pirate-elimination" data-qa-universe-contact-cycle={pirateContact?.contactCycleKey ?? ''} onClick={() => pirateContact && onPirateAttack?.(pirateContact)}>ПИРАТСКИЙ РЕЙД</button>
          </> : null}
          {isExploration ? <>
            <button type="button" className="uw-btn" disabled={!onExplorationRecon || !explorationStatus} data-qa-universe-special-action="exploration-recon"
              title="Принять исследовательскую операцию и отправить один шпионский зонд" onClick={() => onExplorationRecon?.(node)}>ИССЛЕДОВАТЬ ЗОНДОМ</button>
            <button type="button" className="uw-btn uw-btn--primary" disabled={!onExpedition || explorationStatus !== 'free'}
              title={explorationStatus === 'occupied' ? 'Объект занят. Для захвата нужна миссия «Атака».'
                : explorationStatus === 'self' ? 'Ваш флот уже добывает здесь.'
                : explorationStatus !== 'free' ? 'Экспедиция доступна в пределах пяти систем от ваших колоний.' : 'Подготовить экспедицию'}
              data-qa-universe-special-action="expedition" onClick={() => onExpedition?.(node)}
            >{explorationStatus === 'free' ? 'ПОДГОТОВИТЬ ЭКСПЕДИЦИЮ'
              : explorationStatus === 'occupied' ? 'ЗАНЯТО · НУЖНА АТАКА'
              : explorationStatus === 'self' ? 'ВАШ ФЛОТ ДОБЫВАЕТ' : 'ВНЕ РАДИУСА ЭКСПЕДИЦИИ'}</button>
          </> : null}
          {!canColonize && !isAsteroid && !isPirate && !isExploration ? (
            <button type="button" className="uw-btn" disabled data-qa-universe-special-action="disabled">{node.kind === 'uninhabited' ? 'КОЛОНИЗАЦИЯ' : 'ИССЛЕДОВАНИЕ'} · СКОРО</button>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

/** Debris reads as a chip with the debris icon and amount, never as a second object. */
function DebrisChip({ label, ariaLabel }: { label: string; ariaLabel?: string }) {
  return (
    <span className="universe-debris-marker__badge uv-debris-chip" role={ariaLabel ? 'img' : undefined} aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true}>
      <img src={debrisIcon} alt="" draggable={false} /><b>{label}</b>
    </span>
  );
}

const CLAIM_COPY: Record<'free' | 'self' | 'occupied' | 'out', string> = {
  free: 'СВОБОДНО', self: 'ВАШ ФЛОТ', occupied: 'ЗАНЯТО', out: 'ВНЕ РАДИУСА',
};

/** Stable reference for a value whose identity changes on every parent render. */
function useStableValue<T>(value: T, key: string): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [key]);
}

// The clock belongs to the map, not to a render or a selected object. Toggling
// the layer and visiting another system must not restart orbital motion.
function MovingAsteroid({ node, underlyingKind, nowMs, hasDebris, occupiedNodes, onSelect }: { node: UniversePlanetNode; underlyingKind?: UniversePlanetNode['kind']; nowMs: number; hasDebris: boolean; occupiedNodes: readonly UniversePlanetNode[]; onSelect: (node: UniversePlanetNode) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const point = getUniverseAsteroidPoint(node, nowMs, occupiedNodes);
    ref.current?.style.setProperty('--x', `${point.x}%`);
    ref.current?.style.setProperty('--y', `${point.y}%`);
    ref.current?.style.setProperty('--asteroid-offset-x', `${point.offsetX ?? 0}px`);
    ref.current?.style.setProperty('--asteroid-offset-y', `${point.offsetY ?? 0}px`);
  }, [node, nowMs, occupiedNodes]);
  const point = getUniverseAsteroidPoint(node, nowMs, occupiedNodes);
  // An asteroid parked on a planet sits on its corner; its own caption would
  // collide with the planet's, so only the debris chip stays visible.
  const attached = Boolean(point.offsetX || point.offsetY);
  const nextCoordinate = node.asteroid?.nextCoordinate ? formatUniverseCoordinate(node.asteroid.nextCoordinate) : 'маршрут завершён';
  return <button ref={ref} type="button" className={`system-asteroid ${attached ? 'is-attached' : ''} ${hasDebris ? 'has-debris' : ''}`} style={toStyle(point)}
    title={`${node.name} · ${formatUniverseCoordinate(node.coordinate)} · далее ${nextCoordinate}`} aria-label={`${node.name} · ${formatUniverseCoordinate(node.coordinate)}`}
    aria-describedby={hasDebris ? `universe-asteroid-debris-tooltip-${node.asteroid?.spawnIndex}` : undefined}
    data-qa-universe-asteroid-position={node.coordinate.position}
    data-qa-universe-asteroid-spawn-index={node.asteroid?.spawnIndex ?? ''}
    data-qa-universe-asteroid-next-move={node.asteroid?.nextMoveAt ?? ''}
    data-qa-universe-asteroid-next-coordinate={nextCoordinate}
    data-qa-universe-asteroid-gas="hidden"
    data-qa-universe-asteroid-debris={hasDebris ? 'present' : 'absent'}
    data-qa-universe-object={node.id} data-qa-universe-kind="asteroid" data-qa-universe-underlying-kind={underlyingKind ?? ''} onClick={() => onSelect(node)}>
    <img src={node.art} alt="" draggable={false} /><span className="system-asteroid__label">АСТЕРОИД · {node.coordinate.position}</span>
    {hasDebris ? <span className="universe-asteroid-debris-marker"><DebrisChip label="обломки" ariaLabel="Обломки на астероиде: есть" /><span className="universe-debris-tooltip universe-asteroid-debris-tooltip" id={`universe-asteroid-debris-tooltip-${node.asteroid?.spawnIndex}`} role="tooltip">На астероиде есть обломки</span></span> : null}
  </button>;
}

export function UniverseView({ onNotice, ownerPresence, ownedPlanetArt, ownedPlanetName, profile, ownerScores, command, playerPlanets: playerPlanetsProp, spyTargets: spyTargetsProp, orbitalDebrisByCoordinate, asteroidDebrisPresenceBySpawnIndex, asteroidStates, pirateContactState, pirateContacts = [], pirateFocusTarget, mode, onColonize, onAsteroidRecycler, onExpedition, onExplorationRecon, explorationEligibility = {}, onTransport, onSpy, onAttack, onPirateRecon, onPirateAttack, onPirateReport, onPirateSystemChange, focusTarget, onFocusHandled, onSunSelect, sunAlerts = [], homeCoordinate, debrisOrigin, onRecycleDebris }: UniverseViewProps) {
  const galaxyCount = getActiveGalaxyCount();
  const [galaxy, setGalaxy] = useState(homeCoordinate?.galaxy ?? GALAXY);
  const [system, setSystem] = useState(homeCoordinate?.system ?? 1);
  const [listPinned, setListPinned] = useState(false);
  const [focusEmpty, setFocusEmpty] = useState(false);
  const [showSlotLabels, setShowSlotLabels] = useState(true);
  const [showAsteroids, setShowAsteroids] = useState(true);
  const [showDebris, setShowDebris] = useState(true);
  const [hiddenLegend, setHiddenLegend] = useState<ReadonlySet<LegendKey>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [debrisSearch, setDebrisSearch] = useState<null | { origin: { planetName: string; coordinate: UniverseCoordinate }; from: number; to: number; results: Array<{ coordinate: UniverseCoordinate; debris: number }> }>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const highlightTimerRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onPirateSystemChangeRef = useRef(onPirateSystemChange);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    onPirateSystemChangeRef.current = onPirateSystemChange;
  }, [onPirateSystemChange]);

  // The app re-renders every second and hands over fresh arrays; keep the
  // map inputs stable so the galaxy is not rebuilt on every tick.
  const spyTargets = useStableValue(spyTargetsProp, JSON.stringify(spyTargetsProp.map((target) => [target.id, target.ownerId, target.ownerName, target.raceId, target.kind, target.name, target.coordinate])));
  const playerPlanets = useStableValue(playerPlanetsProp, JSON.stringify(playerPlanetsProp));

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const alliance = useMemo(() => selectOwnerAlliance(command, profile.playerId), [command, profile.playerId]);
  // Only the player's own alliance's wars mark other owners as enemies.
  const allianceDiplomacy = useMemo(() => (alliance ? selectAllianceRelations(command, alliance.id) : []), [alliance, command]);
  const owner = useMemo(() => normalizeUniverseOwnerProfile({
    id: profile.playerId,
    displayName: profile.displayName,
    raceId: profile.factionId,
    alliance,
    points: ownerPoints(ownerScores[profile.playerId]),
    planetIds: playerPlanets.map((planet) => planet.id),
  }), [alliance, ownerScores, playerPlanets, profile]);
  const owners = useMemo(() => {
    const next = new Map<string, UniverseOwnerProfile>([[owner.id, owner]]);
    if (mode === 'test') {
      const registeredBotPlanetIds = spyTargets
        .filter((target) => target.ownerId === UNIVERSE_NPC_OWNER_ID)
        .map((target) => target.id);
      const npc = createUniverseNpcOwnerProfile(ownerPoints(ownerScores[UNIVERSE_NPC_OWNER_ID]), registeredBotPlanetIds);
      next.set(npc.id, npc);
      next.set(TEST_MODE_ALLY_PLANET_FIXTURE.owner.id, normalizeUniverseOwnerProfile({
        ...TEST_MODE_ALLY_PLANET_FIXTURE.owner,
        alliance: selectOwnerAlliance(command, TEST_MODE_ALLY_PLANET_FIXTURE.owner.id),
        ...(ownerScores[TEST_MODE_ALLY_PLANET_FIXTURE.owner.id] ? { points: ownerPoints(ownerScores[TEST_MODE_ALLY_PLANET_FIXTURE.owner.id]) } : {}),
      }));
    }
    for (const target of spyTargets) {
      const previous = next.get(target.ownerId);
      next.set(target.ownerId, normalizeUniverseOwnerProfile({
        ...(previous ?? {}),
        id: target.ownerId,
        displayName: target.ownerName,
        raceId: target.raceId,
        alliance: selectOwnerAlliance(command, target.ownerId),
        points: ownerScores[target.ownerId] ? ownerPoints(ownerScores[target.ownerId]) : previous?.points,
        planetIds: [...new Set([...(previous?.planetIds ?? []), target.id])],
      }));
    }
    return next;
  }, [command, mode, owner, ownerScores, spyTargets]);
  const mapOptions = useMemo(() => ({
    currentOwnerId: owner.id,
    currentPlanetName: ownedPlanetName,
    currentPlanetArt: ownedPlanetArt,
    assets,
    mode,
    galaxyCount,
    asteroidStates,
    pirateContactDefeats: Object.values(pirateContactState?.defeatedCycles ?? {}),
    playerPlanets,
    registeredPlanets: spyTargets.map<UniverseRegisteredPlanet>((target) => ({
      id: target.id,
      coordinate: target.coordinate,
      name: target.name,
      kind: target.kind ?? 'npc',
      ownerId: target.ownerId,
    })),
  }), [asteroidStates, galaxyCount, mode, ownedPlanetArt, ownedPlanetName, owner.id, pirateContactState?.defeatedCycles, playerPlanets, spyTargets]);
  // Only the open system follows the 1 s clock. The whole galaxy (40 systems)
  // is rebuilt once a minute: it only resolves focus targets and owner lists.
  const galaxyClock = Math.floor(nowMs / 60_000) * 60_000;
  const galaxyData = useMemo(() => createUniverseMap({ ...mapOptions, galaxy, nowMs: galaxyClock }), [galaxy, galaxyClock, mapOptions]);
  const systemData = useMemo(() => createUniverseSystem({ ...mapOptions, galaxy, system, nowMs }), [galaxy, mapOptions, nowMs, system]);
  const orbitalDebrisByKey = useMemo(() => new Map(
    orbitalDebrisByCoordinate.map(({ coordinate, debris }): [string, number] => [
      `${coordinate.galaxy}:${coordinate.system}:${coordinate.position}`,
      debris,
    ]),
  ), [orbitalDebrisByCoordinate]);
  const asteroidAttachmentNodes = useMemo(() => [...systemData.positions, ...systemData.asteroids], [systemData]);
  const nodesById = useMemo(() => new Map(galaxyData.systems.flatMap((item) => [...item.positions, ...item.asteroids]).map((node) => [node.id, node])), [galaxyData]);
  const systemNodesById = useMemo(() => new Map(asteroidAttachmentNodes.map((node) => [node.id, node])), [asteroidAttachmentNodes]);
  const selectedNode = selectedNodeId ? systemNodesById.get(selectedNodeId) ?? nodesById.get(selectedNodeId) ?? null : null;
  const selectedUnderlyingNode = selectedNode?.kind === 'asteroid'
    ? (selectedNode.coordinate.system === system ? systemData : galaxyData.systems[selectedNode.coordinate.system - 1])?.positions.find((node) => node.coordinate.position === selectedNode.coordinate.position)
    : undefined;

  useEffect(() => {
    onPirateSystemChangeRef.current?.({ galaxy, system });
  }, [galaxy, system]);

  const lastPirateFocusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pirateFocusTarget) {
      lastPirateFocusKeyRef.current = null;
      return;
    }
    if (lastPirateFocusKeyRef.current === pirateFocusTarget.contactCycleKey) return;
    const target = [...nodesById.values()].find((node) => node.kind === 'pirate'
      && node.pirate?.contactCycleKey === pirateFocusTarget.contactCycleKey);
    if (!target) {
      // Historical reports navigate to the old system, never focus a new pirate cycle.
      setSelectedNodeId(null);
      setGalaxy(pirateFocusTarget.coordinate.galaxy);
      setSystem(pirateFocusTarget.coordinate.system);
      onFocusHandled?.();
      return;
    }
    lastPirateFocusKeyRef.current = pirateFocusTarget.contactCycleKey;
    setGalaxy(target.coordinate.galaxy);
    setSystem(target.coordinate.system);
    setSelectedNodeId(target.id);
    onFocusHandled?.();
  }, [nodesById, onFocusHandled, pirateFocusTarget]);

  useEffect(() => {
    if (!focusTarget) return;
    const planetNodes = [...nodesById.values()].filter((node): node is UniversePlanetNode => node.kind === 'player' || node.kind === 'npc');
    const target = (focusTarget.planetId ? nodesById.get(focusTarget.planetId) : undefined)
      ?? planetNodes.find((node) => node.ownerId === focusTarget.ownerId)
      ?? planetNodes.find((node) => node.coordinate.galaxy === focusTarget.coordinate.galaxy
        && node.coordinate.system === focusTarget.coordinate.system
        && node.coordinate.position === focusTarget.coordinate.position);
    if (!target || (target.kind !== 'player' && target.kind !== 'npc')) {
      // Any other coordinate (a fleet route, an empty slot, an object): open its
      // system and pulse whatever sits at that position.
      const { galaxy: targetGalaxy, system: targetSystem, position } = focusTarget.coordinate;
      setGalaxy(targetGalaxy);
      setSystem(targetSystem);
      const atPosition = [...nodesById.values()].find((node) => node.coordinate.galaxy === targetGalaxy && node.coordinate.system === targetSystem && node.coordinate.position === position);
      setSelectedNodeId(null);
      if (atPosition) {
        setHighlightedNodeId(atPosition.id);
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = window.setTimeout(() => setHighlightedNodeId(null), 3_000);
      }
      onFocusHandled?.();
      return;
    }
    setGalaxy(target.coordinate.galaxy);
    setSystem(target.coordinate.system);
    if (focusTarget.mode === 'highlight') {
      // Coordinate links from spy reports only pinpoint the planet: pulse it
      // for ~3s instead of opening the owner inspector.
      setSelectedNodeId(null);
      setHighlightedNodeId(target.id);
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => setHighlightedNodeId(null), 3_000);
      onFocusHandled?.();
      return;
    }
    setSelectedNodeId(target.id);
    onFocusHandled?.();
  }, [focusTarget, nodesById, onFocusHandled]);

  const ownerPlanets = useMemo(() => {
    if (!selectedNode || (selectedNode.kind !== 'player' && selectedNode.kind !== 'npc')) return [];
    const selectedOwner = owners.get(selectedNode.ownerId ?? '');
    if (!selectedOwner) return [];
    const listed = selectedOwner.planetIds
      .map((planetId) => nodesById.get(planetId))
      .filter((planet): planet is UniversePlanetNode => Boolean(planet && (planet.kind === 'player' || planet.kind === 'npc')));
    return listed.length ? listed.slice(0, MAX_PLANETS_PER_OWNER) : [selectedNode];
  }, [nodesById, owners, selectedNode]);

  useEffect(() => {
    if (!selectedNodeId) return undefined;
    const previousFocus = document.activeElement as HTMLElement | null;
    const stage = document.querySelector<HTMLElement>('.stage');
    const wasInert = stage?.inert ?? false;
    if (stage) stage.inert = true;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const controls = Array.from(document.querySelectorAll<HTMLElement>('[data-qa-universe-inspector] button:not(:disabled), [data-qa-universe-inspector] [tabindex="0"]'));
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedNodeId(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (stage) stage.inert = wasInert;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [selectedNodeId]);

  useEffect(() => {
    if (selectedNodeId) closeButtonRef.current?.focus();
  }, [selectedNodeId]);

  const goSystem = (next: number, nextGalaxy = galaxy) => {
    const boundedGalaxy = Math.min(galaxyCount, Math.max(1, nextGalaxy));
    const bounded = Math.min(SYSTEM_COUNT, Math.max(1, next));
    setGalaxy(boundedGalaxy);
    setSystem(bounded);
    setSelectedNodeId(null);
    onNotice(`Галактика ${boundedGalaxy} · Солнечная система ${bounded}.`);
  };
  const openDebrisSearch = () => {
    if (!debrisOrigin) return;
    const range = nearbySystemWindow(debrisOrigin.coordinate.system, SYSTEM_COUNT);
    setDebrisSearch({ origin: debrisOrigin, ...range, results: findDebrisNearSystem(orbitalDebrisByCoordinate, debrisOrigin.coordinate, SYSTEM_COUNT) });
  };
  /** Opens the coordinate's system and pulses whatever sits there (position 0 is the Sun itself). */
  const pinpointCoordinate = (coordinate: UniverseCoordinate) => {
    setDebrisSearch(null);
    setGalaxy(coordinate.galaxy);
    setSystem(coordinate.system);
    setSelectedNodeId(null);
    const atPosition = [...nodesById.values()].find((node) => node.coordinate.galaxy === coordinate.galaxy && node.coordinate.system === coordinate.system && node.coordinate.position === coordinate.position);
    if (atPosition) {
      setHighlightedNodeId(atPosition.id);
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => setHighlightedNodeId(null), 3_000);
    }
  };
  const listedNodes = systemData.positions.filter((node) => LISTED_KINDS.has(node.kind)).map((node) => ({
    node,
    legend: legendKeyOf(node, node.kind === 'player' || node.kind === 'npc'
      ? getUniverseOwnerRelation(node, owner.id, owner.alliance, owners.get(node.ownerId ?? ''), allianceDiplomacy)
      : null),
  }));
  const homeWorld = playerPlanets.find((planet) => planet.isHomeworld)?.coordinate ?? playerPlanets[0]?.coordinate;
  const sunUnderAttack = sunAlerts.some((alert) => alert.galaxy === galaxy && alert.system === system);
  const pad2 = (value: number) => String(value).padStart(2, '0');

  const selectNode = (node: UniversePlanetNode) => setSelectedNodeId(node.id);

  const handleAction = (action: UniverseAction, node: UniversePlanetNode) => {
    const targetOwner = owners.get(node.ownerId ?? '');
    const relation = getUniverseOwnerRelation(node, owner.id, owner.alliance, targetOwner, allianceDiplomacy);
    const actionState = getUniverseActionState(action, node, owner.id, relation);
    if (action === 'fleet' && actionState.enabled) {
      onTransport(getUniverseTransportLaunchTarget(node, relation));
      return;
    }
    if ((action === 'spy' || action === 'attack') && actionState.enabled && targetOwner && (relation === 'enemy' || relation === 'neutral')) {
      const target = { planetId: node.id, planetName: node.name, coordinate: node.coordinate, relation, owner: targetOwner, targetKind: node.kind as 'player' | 'npc' };
      if (action === 'attack') onAttack(target);
      else onSpy(target);
      return;
    }
    onNotice(`${actionState.label}: ${actionState.reason} Цель ${formatUniverseCoordinate(node.coordinate)}.`);
  };

  const selectedOwner = selectedNode && (selectedNode.kind === 'player' || selectedNode.kind === 'npc')
    ? owners.get(selectedNode.ownerId ?? '') ?? null
    : null;
  const inspectorRelationTone = selectedNode && selectedOwner
    ? RELATION_TONE[getUniverseOwnerRelation(selectedNode, owner.id, owner.alliance, selectedOwner, allianceDiplomacy)]
    : undefined;

  return (
    <main
      className="universe-view universe-view-v3 universe-radar"
      data-qa-universe
      data-qa-universe-system={system}
      data-qa-universe-npc-count={galaxyData.systems.reduce((total, item) => total + item.positions.filter((node) => node.kind === 'npc').length, 0)}
    >
      <div className="system-scene" data-qa-universe-scene>

        {[0, 1, 2, 3].map((ring) => <div key={ring} className={`system-orbit ring-${ring + 1}`} />)}

        <div className="system-star-wrap">
          <button
            type="button"
            className={`system-star-button ${sunUnderAttack ? 'is-under-attack' : ''}`}
            aria-label={`Солнце системы ${system}. Эффективность: ${systemData.sunEfficiencyPercent}%. Открыть командный рейд`}
            aria-describedby="universe-star-efficiency"
            data-qa-universe-sun-efficiency={systemData.sunEfficiencyPercent}
            onClick={() => onSunSelect?.(galaxy, system)}
          >
            <img className="system-star" src={systemData.starArt} alt="" draggable={false} />
            <span className="system-star-tooltip" id="universe-star-efficiency" role="tooltip">
              <strong>СИСТЕМА {String(system).padStart(2, '0')}</strong>
              <small>Эффективность солнца: {systemData.sunEfficiencyPercent}%</small>
              {sunUnderAttack ? <small className="system-star-alert">Входящий рейд на Солнце</small> : null}
              {onSunSelect ? <small>Нажмите: рейд или защита Солнца</small> : null}
            </span>
          </button>
        </div>

        {systemData.positions.map((node) => {
          const point = getUniverseSlotPoint(node.coordinate.position);
          const coordinate = formatUniverseCoordinate(node.coordinate);
          const orbitalDebris = orbitalDebrisByKey.get(`${node.coordinate.galaxy}:${node.coordinate.system}:${node.coordinate.position}`) ?? 0;
          const debrisDescription = orbitalDebris > 0 ? ` · Обломки на орбите: ${numberFormat.format(orbitalDebris)}` : '';
          const caption = getUniverseNodeCaption(node, profile.displayName, owners.get(node.ownerId ?? '')?.displayName, owner.id);
          const relation = node.kind === 'player' || node.kind === 'npc'
            ? getUniverseOwnerRelation(node, owner.id, owner.alliance, owners.get(node.ownerId ?? ''), allianceDiplomacy)
            : null;
          const ariaLabel = `${caption} · ${getUniverseObjectKindLabel(node.kind)} · ${coordinate}`;
          const claim = node.kind === 'anomaly' || node.kind === 'unique' ? explorationEligibility[node.id] ?? 'out' : null;
          if (node.kind === 'empty') {
            return (
              <button
                key={node.id}
                type="button"
                className={`empty-slot ${focusEmpty ? 'emphasized' : ''} ${orbitalDebris > 0 ? 'empty-slot--with-debris' : ''}`}
                style={toStyle(point)}
                title={`${node.statusLabel} ${coordinate}`}
                aria-label={`${ariaLabel}${debrisDescription}`}
                aria-describedby={orbitalDebris > 0 ? `universe-debris-tooltip-${node.id}` : undefined}
                data-qa-universe-object={node.id}
                data-qa-universe-kind={node.kind}
                onClick={() => selectNode(node)}
              >
                {showSlotLabels ? <span>{node.coordinate.position}</span> : null}
                {orbitalDebris > 0 && showDebris ? <span className="universe-debris-marker"><DebrisChip label={compactAmount(orbitalDebris)} /><span className="universe-debris-tooltip" id={`universe-debris-tooltip-${node.id}`} role="tooltip">Обломки на орбите: {numberFormat.format(orbitalDebris)}</span></span> : null}
              </button>
            );
          }
          return (
            <button
              type="button"
              key={node.id}
              className={`system-planet system-planet--${node.kind} ${claim ? `has-claim has-claim--${claim}` : ''} ${relation ? `system-planet--${relation}` : ''} ${node.isHomeworld ? 'owned' : ''} ${highlightedNodeId === node.id ? 'system-planet--highlight' : ''} ${orbitalDebris > 0 ? 'system-planet--with-debris' : ''} ${hiddenLegend.has(legendKeyOf(node, relation)) ? 'is-filtered' : ''}`}
              style={toStyle(point)}
              title={`${node.name} · ${node.statusLabel} · ${coordinate}`}
              aria-label={`${ariaLabel}${debrisDescription}`}
              aria-describedby={orbitalDebris > 0 ? `universe-debris-tooltip-${node.id}` : undefined}
              data-qa-universe-object={node.isHomeworld ? 'player-planet-helion-01' : node.id}
              data-qa-universe-kind={node.kind}
              data-qa-universe-relation={relation ?? undefined}
              onClick={() => selectNode(node)}
            >
              {claim ? <span className={`uv-claim-ring uv-claim-ring--${claim}`} aria-hidden="true" /> : null}
              <img src={node.art} alt="" draggable={false} />
              {claim
                ? <span className={'universe-map-occupancy universe-map-occupancy--' + claim}
                    data-qa-universe-map-occupancy={explorationEligibility[node.id] ?? undefined}>
                    <i aria-hidden="true" />{CLAIM_COPY[claim]}
                  </span> : null}
              {showSlotLabels ? <span className="planet-slot">{node.coordinate.position}</span> : null}
              <span className="planet-name" data-qa-map-caption>{caption}</span>
              {orbitalDebris > 0 && showDebris ? <span className="universe-debris-marker"><DebrisChip label={compactAmount(orbitalDebris)} /><span className="universe-debris-tooltip" id={`universe-debris-tooltip-${node.id}`} role="tooltip">Обломки на орбите: {numberFormat.format(orbitalDebris)}</span></span> : null}
            </button>
          );
        })}

        {showAsteroids ? systemData.asteroids.map((asteroid) => <MovingAsteroid key={asteroid.id} node={asteroid} underlyingKind={systemData.positions.find((node) => node.coordinate.position === asteroid.coordinate.position)?.kind} nowMs={nowMs} hasDebris={Boolean(asteroid.asteroid && asteroidDebrisPresenceBySpawnIndex?.[String(asteroid.asteroid.spawnIndex)])} occupiedNodes={asteroidAttachmentNodes} onSelect={selectNode} />) : null}
      </div>

      <div className="universe-radar__crumb">
        <small>ВСЕЛЕННАЯ · ГАЛАКТИКА {pad2(galaxy)}</small>
        <strong>Солнечная система {pad2(system)}</strong>
        <span>Эффективность солнца {systemData.sunEfficiencyPercent}% · 24 позиции</span>
      </div>

      <aside className={`universe-radar__list ${listPinned ? 'is-pinned' : ''}`} aria-label="Объекты системы">
        <button type="button" className="universe-radar__list-toggle" aria-expanded={listPinned} onClick={() => setListPinned((value) => !value)}
          title={listPinned ? 'Открепить список' : 'Закрепить список открытым'}>
          <small>В СИСТЕМЕ</small>
          <span className="universe-radar__list-dots" aria-hidden="true">
            {listedNodes.map(({ node, legend }) => <i key={node.id} className={`legend-${legend}`} />)}
          </span>
          <b>{listedNodes.length}</b>
          <em aria-hidden="true">{listPinned ? '−' : '+'}</em>
        </button>
        <div className="universe-radar__list-body">
          {listedNodes.map(({ node, legend }) => (
            <button type="button" key={node.id} className={`universe-radar__row legend-${legend} ${selectedNodeId === node.id ? 'is-selected' : ''}`} onClick={() => selectNode(node)}>
              <span className="universe-radar__pos">{node.coordinate.position}</span>
              <img src={node.art} alt="" draggable={false} />
              <strong>{getUniverseNodeCaption(node, profile.displayName, owners.get(node.ownerId ?? '')?.displayName, owner.id)}</strong>
              <i aria-hidden="true" />
            </button>
          ))}
          <p>+ {systemData.positions.filter((node) => node.kind === 'uninhabited').length} необитаемых · {systemData.asteroids.length} астероидов · {systemData.positions.filter((node) => node.kind === 'empty').length} свободных</p>
        </div>
      </aside>

      <div className="universe-radar__nav">
        <label className="universe-radar__galaxy">
          <small>ГАЛАКТИКА</small>
          <select value={galaxy} onChange={(event) => goSystem(1, Number(event.target.value))} aria-label="Галактика">
            {Array.from({ length: galaxyCount }, (_, index) => <option key={index + 1} value={index + 1}>{pad2(index + 1)}</option>)}
          </select>
        </label>
        {homeWorld ? (
          <button type="button" className="universe-radar__home" disabled={homeWorld.galaxy === galaxy && homeWorld.system === system}
            title={`К родной системе ${formatUniverseCoordinate(homeWorld)}`}
            onClick={() => goSystem(homeWorld.system, homeWorld.galaxy)}>⌂ Домой</button>
        ) : null}
        {debrisOrigin ? (
          <button type="button" className="universe-radar__home universe-radar__debris" data-qa-universe-find-debris
            title={`Свободные обломки в ${NEARBY_DEBRIS_SYSTEM_SPAN} солнечных системах вокруг ${debrisOrigin.planetName} ${formatUniverseCoordinate(debrisOrigin.coordinate)}`}
            onClick={openDebrisSearch}><img className="universe-radar__debris-icon" src={DEBRIS_FINDER_ICON} alt="" draggable={false} />Найти обломки</button>
        ) : null}
      </div>

      <nav className="universe-radar__rail universe-jump" aria-label="Солнечные системы"
        onWheel={(event) => { if (event.deltaY) goSystem(system + (event.deltaY > 0 ? 1 : -1)); }}>
        <button type="button" className="step" onClick={() => goSystem(system - 1)} disabled={system === 1} aria-label="Предыдущая система"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 10.5 8 6l4.5 4.5" /></svg></button>
        <div className="universe-radar__rail-list">
          {[-2, -1, 0, 1, 2].map((delta) => {
            const value = system + delta;
            if (value < 1 || value > SYSTEM_COUNT) return <span key={delta} className="universe-radar__rail-gap" aria-hidden="true" />;
            return (
              <button type="button" key={delta} className={`universe-radar__rail-item is-d${Math.abs(delta)}`} aria-current={delta === 0 ? 'true' : undefined}
                aria-label={`Солнечная система ${value}`} onClick={() => { if (delta) goSystem(value); }}>{pad2(value)}</button>
            );
          })}
        </div>
        <button type="button" className="step" onClick={() => goSystem(system + 1)} disabled={system === SYSTEM_COUNT} aria-label="Следующая система"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 5.5 8 10l4.5-4.5" /></svg></button>
        <small className="universe-radar__rail-total">/ {SYSTEM_COUNT}</small>
        <select className="universe-radar__rail-select" value={system} onChange={(event) => goSystem(Number(event.target.value))} aria-label="Солнечная система">
          {galaxyData.systems.map((item) => <option key={item.system} value={item.system}>{pad2(item.system)}</option>)}
        </select>
      </nav>

      <div className="universe-radar__dock" aria-label="Фильтры и слои карты">
        <small>ФИЛЬТР</small>
        <div className="universe-radar__seg">
          <button type="button" className={hiddenLegend.size === 0 ? 'is-on' : ''} onClick={() => setHiddenLegend(new Set())}>Все</button>
          <div className="universe-map-legend" aria-label="Обозначения карты">
            {LEGEND.map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={`legend-${key} ${hiddenLegend.has(key) ? '' : 'is-on'}`}
                aria-pressed={!hiddenLegend.has(key)}
                onClick={() => setHiddenLegend((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
              ><i aria-hidden="true" /><span>{label}</span></button>
            ))}
          </div>
        </div>
        <i className="universe-radar__sep" aria-hidden="true" />
        <small>СЛОИ</small>
        <div className="universe-radar__seg">
          <button type="button" className={showSlotLabels ? 'is-on' : ''} aria-pressed={showSlotLabels} title="Показывать номера позиций" onClick={() => setShowSlotLabels((value) => !value)}>⌖ Метки</button>
          <button type="button" className={showAsteroids ? 'is-on' : ''} aria-pressed={showAsteroids} data-qa-universe-asteroids-toggle title="Показать или скрыть астероиды" onClick={() => setShowAsteroids((value) => !value)}>◌ Астероиды</button>
          <button type="button" className={showDebris ? 'is-on' : ''} aria-pressed={showDebris} title="Показать или скрыть обломки" onClick={() => setShowDebris((value) => !value)}>✦ Обломки</button>
          <button type="button" className={focusEmpty ? 'is-on' : ''} aria-pressed={focusEmpty} title="Подсветить свободные позиции" onClick={() => setFocusEmpty((value) => !value)}>▽ Свободные</button>
        </div>
      </div>

      {debrisSearch ? createPortal(
        <div className="universe-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setDebrisSearch(null); }}>
          <section className="universe-debris-finder uw" role="dialog" aria-modal="true" aria-label="Обломки в ближайших системах" data-qa-debris-finder={debrisSearch.results.length}>
            <header className="universe-debris-finder__head">
              <img className="universe-debris-finder__icon" src={DEBRIS_FINDER_ICON} alt="" draggable={false} />
              <div>
                <small>ОБЛОМКИ · СИСТЕМЫ {pad2(debrisSearch.from)}–{pad2(debrisSearch.to)} · ГАЛАКТИКА {pad2(debrisSearch.origin.coordinate.galaxy)}</small>
                <h2>Рядом с {debrisSearch.origin.planetName} {formatUniverseCoordinate(debrisSearch.origin.coordinate)}</h2>
              </div>
              <button type="button" className="uw-close" data-asterion-close aria-label="Закрыть" onClick={() => setDebrisSearch(null)}>✕</button>
            </header>
            {debrisSearch.results.length === 0 ? (
              <div className="universe-debris-finder__empty" data-qa-debris-finder-empty>
                <p>В ближайших {NEARBY_DEBRIS_SYSTEM_SPAN} солнечных системах нет планет с обломками.</p>
                <button type="button" className="uw-btn uw-btn--primary" autoFocus onClick={() => setDebrisSearch(null)}>ОК</button>
              </div>
            ) : (
              <>
                <ul className="universe-debris-finder__list">
                  {debrisSearch.results.map((entry) => {
                    const key = formatUniverseCoordinate(entry.coordinate);
                    const isSun = entry.coordinate.position === 0;
                    return (
                      <li key={key} data-qa-debris-row={key}>
                        {isSun ? <img className="universe-debris-finder__thumb" src={SUN_DEBRIS_ART} alt="" draggable={false} /> : <span className="universe-debris-finder__thumb is-orbit" aria-hidden="true" />}
                        <button type="button" className="universe-debris-finder__coord" title="Показать на карте" onClick={() => pinpointCoordinate(entry.coordinate)}>
                          <b>{key}</b><small>{isSun ? 'Солнце системы' : `Система ${pad2(entry.coordinate.system)} · позиция ${entry.coordinate.position}`}</small>
                        </button>
                        <span className="universe-debris-finder__amount"><small>ОБЛОМКИ</small><b>{entry.debris.toLocaleString('ru-RU')}</b></span>
                        <button type="button" className="uw-btn uw-btn--primary" disabled={!onRecycleDebris} data-qa-debris-send={key}
                          onClick={() => { setDebrisSearch(null); onRecycleDebris?.(entry.coordinate); }}>ОТПРАВИТЬ</button>
                      </li>
                    );
                  })}
                </ul>
                <p className="universe-debris-finder__note">Только свободные обломки у планет и Солнц. Обломки на астероидах здесь не показываются — ищите астероиды на карте.</p>
              </>
            )}
          </section>
        </div>,
        document.body,
      ) : null}

      {selectedNode ? createPortal(
        <div className="universe-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSelectedNodeId(null); }}>
        <aside className={`universe-inspector universe-inspector--${selectedNode.kind} uw`} role="dialog" aria-modal="true" aria-label={`Инспектор: ${selectedNode.name}`} data-qa-universe-inspector data-qa-inspector-kind={selectedNode.kind}
          style={{ '--uw-k': selectedOwner ? inspectorRelationTone : SPECIAL_TONE[selectedNode.kind] ?? '#8fb6c0' } as CSSProperties}>
          <header className="universe-inspector-header uw-head">
            <div className="uw-title"><small>ЗВЁЗДНЫЙ АТЛАС · {getUniverseObjectKindLabel(selectedNode.kind)}</small><h2>{selectedNode.name}</h2></div>
            <div className="uw-tags">
              <span className="uw-coord">{formatUniverseCoordinate(selectedNode.coordinate)}</span>
              {selectedNode.kind === 'asteroid' ? <em className="uw-chip">кольцо {Math.ceil(selectedNode.coordinate.position / 6)}</em> : null}
              {selectedOwner ? <em className="uw-chip">{selectedNode.isHomeworld ? 'ДОМАШНЯЯ ПЛАНЕТА' : 'ПЛАНЕТА ВЛАДЕЛЬЦА'}</em> : null}
            </div>
            <button ref={closeButtonRef} type="button" className="universe-inspector-close uw-close" data-asterion-close aria-label="Закрыть инспектор" title="Закрыть инспектор" onClick={() => setSelectedNodeId(null)}>✕</button>
          </header>
          <div className="universe-inspector-body uw-body">
          {selectedOwner ? <OwnerInspector node={selectedNode} owner={selectedOwner} presence={ownerPresence?.[selectedOwner.id]} nowMs={nowMs} planets={ownerPlanets} currentOwnerId={owner.id} currentAlliance={owner.alliance} diplomacy={allianceDiplomacy} debrisAt={(coordinate) => orbitalDebrisByKey.get(`${coordinate.galaxy}:${coordinate.system}:${coordinate.position}`) ?? 0} onAction={handleAction} onVisit={(planet) => { goSystem(planet.coordinate.system); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-qa-universe-object="${planet.id}"]`)?.focus()); }} /> : <SpecialInspector node={selectedNode} underlyingNode={selectedUnderlyingNode} nowMs={nowMs} asteroidHasDebris={Boolean(selectedNode.kind === 'asteroid' && selectedNode.asteroid && asteroidDebrisPresenceBySpawnIndex?.[String(selectedNode.asteroid.spawnIndex)])} pirateContact={selectedNode.kind === 'pirate' ? pirateContacts.find((contact) => contact.contactCycleKey === selectedNode.pirate?.contactCycleKey) : undefined} onColonize={onColonize} onAsteroidRecycler={onAsteroidRecycler} onExpedition={onExpedition} onExplorationRecon={onExplorationRecon} explorationStatus={explorationEligibility[selectedNode.id]} onPirateRecon={onPirateRecon} onPirateAttack={onPirateAttack} onPirateReport={onPirateReport} />}
          </div>
        </aside>
        </div>, document.body) : null}
    </main>
  );
}
