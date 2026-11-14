import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { SCORE_ICONS } from './ui/ui-icons.ts';
import { useClockNow } from './application/shared-clock';
import { describeOwnerPresence, type OwnerPresence } from './application/owner-presence.ts';
import { DEBRIS_FINDER_ICON, SUN_DEBRIS_ART } from './ui/sun-raid/sun-raid-assets.ts';
import { NEARBY_DEBRIS_SYSTEM_SPAN, findDebrisNearSystem, nearbySystemWindow } from './domain/espionage/orbital-debris.ts';
import { createPortal } from 'react-dom';
import { EmblemGlyph } from './CommandView';
import { selectAllianceRelations } from './domain/command/diplomacy.ts';
import { FactionGeneralPortrait } from './ui/FactionGeneralPortrait.tsx';
import { EXPLORATION_ARTS } from './exploration-art.ts';
import { PIRATE_PLANET_ARTS } from './pirate-planet-art.ts';
import { GameSelect } from './ui/GameSelect.tsx';
import { ObjectCard } from './ui/universe/ObjectCard.tsx';
import { DebrisFinder, type DebrisSearch } from './ui/universe/DebrisFinder.tsx';
import type { DebrisEntry, ExplorationIntel } from './ui/universe/object-card-model.ts';
import { createUniverseCardQaFixture, getUniverseCardQaScenario } from './ui/universe/object-card-qa-fixture.ts';
import debrisIcon from './assets/ui/header-icons/debris.webp';
import './ui/universe/universe-radar.css';
import './ui/universe/map-relations.css';
import './ui/shield/shield.css';
import { applyMapShield, classifyMapPlanet, type MapRelationStatus, type MapTone } from './application/map-relation.ts';
import { placeMapTip } from './ui/universe/map-tip-placement.ts';
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
import type { UiSpyTarget } from './application/contracts.ts';
import { planetSkinMapArt } from './planet-skin-art.ts';
import { QuickActions } from './ui/universe/QuickActions.tsx';
import { SunQuickMenu } from './ui/universe/SunQuickMenu.tsx';
import type { GateBeacon } from './application/sun-gate-watch.ts';
import { gateArt } from './ui/sun-raid/sun-raid-assets.ts';
import './ui/universe/gate-beacon.css';
import type { QuickActionId, QuickLegOutcome, QuickTarget } from './application/quick-actions.ts';
import { ACTION_ART, ATLAS_BACKDROPS } from './ui/actions/action-art.ts';
import { FACTION_EMBLEMS } from './ui/header/faction-emblems.ts';
import { flightClock, useAtlasPlans, type AtlasCell, type AtlasRowRequest } from './ui/universe/atlas-plans.ts';
import './ui/universe/star-atlas.css';
import type { DispatchFlightCommand, FlightLaunchContext } from './application/flights.ts';

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
  /** Planet shields by owner id; a shielded planet shows a mark and cannot be attacked. */
  shields?: Readonly<Record<string, import('./domain/shield/shield.ts').ShieldRecord>>;
  command: CommandState;
  playerPlanets: readonly UniversePersistedPlayerPlanet[];
  spyTargets: readonly UiSpyTarget[];
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
  onExplorationAttack?: (node: UniversePlanetNode) => void;
  explorationEligibility?: Readonly<Record<string, 'free' | 'self' | 'occupied'>>;
  /** What the player's own probes learned about unique objects and anomalies, by node id. */
  explorationIntel?: Readonly<Record<string, ExplorationIntel>>;
  onTransport: (target: { planetId: string; coordinate: UniverseCoordinate; relation: TargetRelation }) => void;
  onSpy: (target: { planetId: string; planetName: string; coordinate: UniverseCoordinate; relation: Extract<TargetRelation, 'enemy' | 'neutral'>; owner: UniverseOwnerProfile; targetKind: 'player' | 'npc' }) => void;
  onAttack: (target: { planetId: string; planetName: string; coordinate: UniverseCoordinate; relation: Extract<TargetRelation, 'enemy' | 'neutral'>; owner: UniverseOwnerProfile; targetKind: 'player' | 'npc' }) => void;
  onPirateRecon?: (contact: PirateContactPresentation) => void;
  onPirateAttack?: (contact: PirateContactPresentation) => void;
  onPirateReport?: (reportId: string) => void;
  onPirateSystemChange?: (selection: PirateSystemSelection) => void;
  /** 'quick' opens the planet's quick actions, 'sun' the Sun's (jumps from Gate and raid notices). */
  focusTarget?: { coordinate: UniverseCoordinate; planetId?: string; ownerId?: string; mode?: 'inspect' | 'highlight' | 'quick' | 'sun' } | null;
  /** «Найти обломки» scans the systems around this planet (the one selected in the header). */
  debrisOrigin?: { planetName: string; coordinate: UniverseCoordinate } | null;
  /** «Отправить»: opens «Флоты → Переработка» aimed at the coordinate (position 0 = the Sun). */
  onFocusHandled?: () => void;
  /** Click on the system's Sun: opens «Командование → Операции» for it. */
  onSunSelect?: (galaxy: number, system: number) => void;
  /** Suns of the player's galaxies with an incoming raid. */
  sunAlerts?: readonly { galaxy: number; system: number; allianceTag?: string; arrivesAt?: number }[];
  /** Gates under construction anywhere (public news): a beacon on the host planet. */
  gateBeacons?: readonly GateBeacon[];
  /** Sun quick menu «Защитить»: the defence window for every planet. */
  onSunDefend?: (galaxy: number, system: number) => void;
  /** Sun quick menu «Рейд на Солнце»: whether the alliance operation is open to the player. */
  sunRaidAccess?: { enabled: boolean; reason?: string };
  /** The map opens on the home system (random starts are no longer [1:1]). */
  homeCoordinate?: { galaxy: number; system: number };
  /** Right mouse button: sends quick-panel legs through the fleet screen's dispatch. */
  onQuickSend?: (commands: DispatchFlightCommand[]) => QuickLegOutcome[];
  /** Quick panel «Подробно»: the fleet screen with the launch prefilled from that planet. */
  onQuickDetails?: (context: FlightLaunchContext, originPlanetId: string | null) => void;
};

const POINT_LABELS: ReadonlyArray<{ key: keyof UniverseOwnerPoints; label: string }> = [
  { key: 'resource', label: 'Ресурсные очки' },
  { key: 'battle', label: 'Боевые очки' },
  { key: 'total', label: 'Общие очки' },
  { key: 'achievements', label: 'Очки достижений' },
];

const numberFormat = new Intl.NumberFormat('ru-RU');

/** Map filter keys; the labels are the map legend (Electron QA reads them in this order). */
const LEGEND: readonly (readonly [MapTone, string])[] = [
  ['self', 'Ваш мир'], ['ally', 'Союзная'], ['enemy', 'Вражеская'], ['range', 'В диапазоне атаки'], ['neutral', 'Нейтральная'],
  ['wild', 'Необитаемые'], ['unique', 'Уникальные'], ['pirate', 'Отступники'], ['anomaly', 'Аномалии'],
];
const LISTED_KINDS = new Set<UniversePlanetNode['kind']>(['player', 'npc', 'pirate', 'unique', 'anomaly']);

/** Keep in step with the --map-* colours in ui/universe/map-relations.css. */
const MAP_TONE_COLOR: Record<MapTone, string> = {
  self: 'var(--race-accent-strong)', ally: '#4fe08a', enemy: '#ff2e48', range: '#ff8f8f', neutral: '#8397a3',
  wild: '#8fb6c0', unique: '#f2cc5b', pirate: '#ffa23a', anomaly: '#b58cff',
};

/** Colour is never the only signal: every tone has its own shape, the same on the map, the list and the filters. */
const MAP_MARK_SHAPES: Record<MapTone, ReactNode> = {
  self: <><path d="M3 1.2v9.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M3.4 1.6h6.8L8.4 4l1.8 2.4H3.4z" fill="currentColor" /></>,
  ally: <path d="M6 1l4.2 1.6v3.2c0 2.6-1.8 4.3-4.2 5.2C3.6 10.1 1.8 8.4 1.8 5.8V2.6z" fill="currentColor" />,
  enemy: <path d="M2.2 2.2l7.6 7.6M9.8 2.2L2.2 9.8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  range: <><circle cx="6" cy="6" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M6 .4v2.4M6 9.2v2.4M.4 6h2.4M9.2 6h2.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>,
  neutral: <><rect x="2.2" y="5.2" width="7.6" height="5.6" rx="1.2" fill="currentColor" /><path d="M3.9 5.2V3.8a2.1 2.1 0 0 1 4.2 0v1.4" fill="none" stroke="currentColor" strokeWidth="1.4" /></>,
  wild: <circle cx="6" cy="6" r="3.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.6 1.6" />,
  unique: <path d="M6 .8L11.2 6 6 11.2.8 6z" fill="currentColor" />,
  pirate: <path d="M6 1l5.4 9.8H.6z" fill="currentColor" />,
  anomaly: <path d="M6 .4C6.5 4 8 5.5 11.6 6 8 6.5 6.5 8 6 11.6 5.5 8 4 6.5.4 6 4 5.5 5.5 4 6 .4z" fill="currentColor" />,
};

/**
 * Worlds higher on the screen lie on top: a name chip hangs below its planet, so
 * the planet underneath slides behind the chip instead of covering the name.
 * Even numbers: an asteroid parked on a planet takes the odd one right above it.
 */
function mapStackOrder(y: number): number {
  return 6 + 2 * Math.round((100 - y) / 4);
}

function MapMark({ tone, blocked = false }: { tone: MapTone; blocked?: boolean }) {
  return (
    <span className={`map-mark map-mark--${tone}`} aria-hidden="true">
      <svg viewBox="0 0 12 12">{MAP_MARK_SHAPES[tone]}</svg>
      {/* An enemy out of reach stays strong red, the lock says it cannot be hit now. */}
      {blocked && tone === 'enemy' ? <svg className="map-mark__lock" viewBox="0 0 12 12">{MAP_MARK_SHAPES.neutral}</svg> : null}
    </span>
  );
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

/** «2 ч 14 мин» / «8 мин 05 с»: time left on a Gate. */
function gateClock(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours) return `${hours} ч ${String(minutes).padStart(2, '0')} мин`;
  return `${minutes} мин ${String(seconds % 60).padStart(2, '0')} с`;
}

function gateRace(raceId?: string): 'aegis' | 'synod' | 'veyra' {
  return raceId === 'synod' || raceId === 'veyra' ? raceId : 'aegis';
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

const SCORE_ICON_KEYS: Record<keyof UniverseOwnerPoints, 'resourcePoints' | 'battlePoints' | 'totalPoints' | 'achievementPoints'> = {
  resource: 'resourcePoints', battle: 'battlePoints', total: 'totalPoints', achievements: 'achievementPoints',
};
const SHORT_POINT_LABELS: Record<keyof UniverseOwnerPoints, string> = {
  resource: 'Ресурсные', battle: 'Боевые', total: 'Общие', achievements: 'Достижения',
};
function relationCopy(status: MapRelationStatus): string {
  if (status.tone === 'self') return 'Ваш мир · принимает транспорт';
  if (status.tone === 'ally') return 'Союзник · принимает транспорт';
  return status.attackable ? `${status.title} · доступны шпионаж и атака` : `${status.title} · доступен шпионаж`;
}

/** Score medals stay exact below a billion; beyond that «987,7 млрд» keeps four medals in one row. */
function scoreLabel(value: number) {
  return value >= 1e9 ? compactAmount(value) : numberFormat.format(value);
}

/** Large orbital debris stays readable in a fixed column: 168 801 300 → «168,8 млн». */
function compactAmount(value: number) {
  if (value >= 1e9) return `${(value / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млрд`;
  if (value >= 1e6) return `${(value / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`;
  if (value >= 1e4) return `${Math.round(value / 1e3).toLocaleString('ru-RU')} тыс`;
  return numberFormat.format(value);
}

type AtlasColumn = {
  key: 'spy' | 'attack' | 'transport' | 'recycle';
  label: string;
  quick: QuickActionId;
  /** The old atlas button this circle replaces (Electron QA and the launch path read it). */
  legacy?: UniverseAction;
  art: string;
};

const ATLAS_COLUMNS: readonly AtlasColumn[] = [
  { key: 'spy', label: 'Шпионаж', quick: 'spy', legacy: 'spy', art: ACTION_ART.espionage },
  { key: 'attack', label: 'Атака', quick: 'attack', legacy: 'attack', art: ACTION_ART.attack },
  { key: 'transport', label: 'Транспорт', quick: 'transport', legacy: 'fleet', art: ACTION_ART.transport },
  { key: 'recycle', label: 'Обломки', quick: 'recycle', art: ACTION_ART.recycle },
];

const RELATION_WORD: Record<UniverseOwnerRelation, string> = { self: 'Ваш мир', ally: 'Союзник', enemy: 'Враг', neutral: 'Нейтральный' };

/** A short word under a grey circle; the full reason is in the hint above it. */
function shortRefusal(reason: string): string {
  const text = reason.toLowerCase();
  if (text.includes('ваша планета') || text.includes('своей планет')) return 'своя';
  if (text.includes('союзн')) return 'союзник';
  if (text.includes('диапазон') || text.includes('очк')) return 'вне диапазона';
  if (text.includes('нет свободн') || text.includes('нет корабл') || text.includes('нет зонд') || text.includes('нет переработ') || text.includes('нет транспорт')) return 'нет флота';
  if (text.includes('газ')) return 'мало газа';
  return 'нельзя';
}

function AtlasActionCircle({
  column, planet, enabled, reason, cell, status, onClick,
}: {
  column: AtlasColumn;
  planet: UniversePlanetNode;
  enabled: boolean;
  reason: string;
  cell: AtlasCell | undefined;
  status?: string;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const refused = enabled && cell?.kind === 'refused';
  const hint = !enabled ? reason : cell?.kind === 'refused' ? cell.reason : undefined;
  const caption = !enabled
    ? <small className="star-atlas__why">{shortRefusal(reason)}</small>
    : cell?.kind === 'ready' ? <small className="star-atlas__time">{flightClock(cell.durationMs)}</small>
    : cell?.kind === 'refused' ? <small className="star-atlas__why is-warn">{shortRefusal(cell.reason)}</small>
    : <small className="star-atlas__time is-pending" aria-hidden="true">··:··</small>;
  const qa = column.legacy
    ? { 'data-qa-universe-action': column.legacy, 'data-qa-universe-action-status': status, 'data-qa-universe-action-reason': reason }
    : { 'data-qa-atlas-action': column.key };
  return (
    <div className={`star-atlas__act star-atlas__act--${column.key} ${!enabled ? 'is-off' : refused ? 'is-refused' : ''}`} data-hint={hint}>
      <button
        type="button"
        disabled={!enabled}
        aria-label={`${column.label}: ${planet.name} ${formatUniverseCoordinate(planet.coordinate)}${hint ? `. ${hint}` : ''}`}
        {...qa}
        onClick={onClick}
      >
        <img src={column.art} alt="" draggable={false} />
      </button>
      {caption}
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
  mapStatus,
  onAction,
  onRecycle,
  onVisit,
  presence,
  nowMs,
  gateAt,
}: {
  /** A Gate being built on that planet (public news). */
  gateAt: (planet: UniversePlanetNode) => GateBeacon | undefined;
  node: UniversePlanetNode;
  owner: UniverseOwnerProfile;
  planets: UniversePlanetNode[];
  currentOwnerId: string;
  currentAlliance: UniverseOwnerAlliance | null | undefined;
  diplomacy: CommandState['diplomacy'];
  debrisAt: (coordinate: UniverseCoordinate) => number;
  /** The owner's look on the map; one owner, one answer for all their planets. */
  mapStatus: MapRelationStatus;
  onAction: (action: UniverseAction, node: UniversePlanetNode) => void;
  /** «Обломки»: the right-click send panel for recycling, over the atlas. */
  onRecycle: (target: QuickTarget, anchor: HTMLElement) => void;
  onVisit: (node: UniversePlanetNode) => void;
  presence: OwnerPresence | undefined;
  nowMs: number;
}) {
  const alliance = owner.alliance;
  const relation = getUniverseOwnerRelation(node, currentOwnerId, currentAlliance, owner, diplomacy);
  const presenceLabel = describeOwnerPresence(presence, nowMs, relation === 'self' || relation === 'ally');
  const attackBlockedReason = mapStatus.attackable === false ? mapStatus.detail ?? mapStatus.title : null;
  const shown = planets.slice(0, MAX_PLANETS_PER_OWNER);
  const rows = shown.map((planet) => {
    const rowRelation = getUniverseOwnerRelation(planet, currentOwnerId, currentAlliance, owner, diplomacy);
    const debris = debrisAt(planet.coordinate);
    const target: QuickTarget = {
      node: planet, relation: rowRelation, orbitalDebris: debris,
      owner: { id: owner.id, displayName: owner.displayName, raceId: owner.raceId, alliance: owner.alliance ?? null },
    };
    const stateOf = (action: UniverseAction) => {
      const base = getUniverseActionState(action, planet, currentOwnerId, rowRelation);
      return action === 'attack' && attackBlockedReason && base.enabled
        ? { ...base, enabled: false, status: 'disabled' as const, reason: attackBlockedReason }
        : base;
    };
    const states = { spy: stateOf('spy'), attack: stateOf('attack'), transport: stateOf('fleet') };
    return { planet, debris, target, states };
  });
  const requests: AtlasRowRequest[] = rows.map(({ planet, debris, target, states }) => ({
    rowId: planet.id,
    target,
    actions: ATLAS_COLUMNS.filter((column) => (column.key === 'recycle' ? debris > 0 : states[column.key].enabled)).map((column) => column.quick),
  }));
  const plans = useAtlasPlans(requests, `${owner.id}|${relation}|${attackBlockedReason ?? ''}|${rows.map((row) => `${row.planet.id}:${row.debris}`).join(',')}`);
  const raceId = owner.raceId === 'aegis' || owner.raceId === 'synod' || owner.raceId === 'veyra' ? owner.raceId : null;
  const backdrop = ATLAS_BACKDROPS[relation === 'self' ? 'self' : relation === 'ally' ? 'ally' : mapStatus.tone === 'enemy' || mapStatus.tone === 'range' ? 'enemy' : 'neutral'];
  const statusTail = relationCopy(mapStatus).split(' · ').slice(1).join(' · ');

  return (
    <div className="star-atlas__main" data-qa-universe-owner={owner.id} data-qa-universe-owner-profile data-qa-atlas-relation={relation}>
      <img className="star-atlas__bg" src={backdrop} alt="" aria-hidden="true" draggable={false} />
      <div className="star-atlas__side">
        <div className="star-atlas__planet" aria-hidden="true">
          <span className="star-atlas__planet-glow" />
          {node.art ? <img src={node.art} alt="" draggable={false} /> : null}
        </div>
        <section className="star-atlas__owner">
          <div className="star-atlas__avatar" data-qa-universe-avatar>
            <OwnerAvatar owner={owner} />
            {raceId ? <img className="star-atlas__race" src={FACTION_EMBLEMS[raceId]} alt="" draggable={false} data-qa-atlas-race={raceId} /> : null}
          </div>
          <div className="star-atlas__who">
            <h3 data-qa-universe-owner-name>{owner.displayName}</h3>
            <span className={`star-atlas__race-name is-${raceId ?? 'none'}`}>{raceLabel(owner.raceId)}</span>
            <em className={`star-atlas__presence is-${presenceLabel.tone}`} data-qa-universe-owner-presence={presenceLabel.tone}><i aria-hidden="true" />{presenceLabel.text}</em>
          </div>
        </section>
        <section className={`star-atlas__alliance ${alliance ? '' : 'is-none'}`}>
          <div className="star-atlas__crest"><AllianceMark alliance={alliance} /></div>
          <div>
            <small>Союз</small>
            <b>{alliance ? alliance.name : 'Без союза'}</b>
            {alliance ? <em>[{alliance.tag}]</em> : null}
          </div>
        </section>
        <div className="star-atlas__status" data-qa-universe-map-status={mapStatus.tone}>
          <b><MapMark tone={mapStatus.tone} blocked={mapStatus.attackable === false} />{RELATION_WORD[relation]}{statusTail ? ` · ${statusTail}` : ''}</b>
          {mapStatus.shieldLeft ? <p className="shield-badge" data-qa-atlas-shield><i className="shield-mark" aria-hidden="true" />Под щитом, ещё {mapStatus.shieldLeft}</p>
            : mapStatus.attackable === false && mapStatus.detail ? <p className="uw-foot-why">{mapStatus.detail}</p> : null}
        </div>
      </div>

      <div className="star-atlas__content">
        <dl className={`star-atlas__points ${owner.points ? '' : 'is-empty'}`} data-qa-universe-points>
          {POINT_LABELS.map(({ key }, index) => (
            <div key={key} className="star-atlas__point" style={{ '--i': index } as CSSProperties}>
              <img src={SCORE_ICONS[SCORE_ICON_KEYS[key]]} alt="" aria-hidden="true" draggable={false} />
              <dt>{SHORT_POINT_LABELS[key]}</dt>
              <dd>{owner.points ? scoreLabel(owner.points[key] ?? 0) : '—'}</dd>
            </div>
          ))}
        </dl>

        <div className="star-atlas__list-head">
          <h3>Планеты игрока · {shown.length}</h3>
          {ATLAS_COLUMNS.map((column) => <span key={column.key}>{column.label}</span>)}
        </div>
        <ul className={`star-atlas__planets is-n${shown.length}`}>
          {rows.map(({ planet, debris, target, states }, index) => (
            <li key={planet.id} className={planet.id === node.id ? 'is-current' : ''} style={{ '--i': index } as CSSProperties} data-qa-universe-planet-row={planet.id}>
              <button type="button" className="star-atlas__row-planet" data-qa-universe-visit={planet.id} onClick={() => onVisit(planet)} aria-label={`Показать на карте: ${planet.name} ${formatUniverseCoordinate(planet.coordinate)}`}>
                <img src={planet.art} alt="" draggable={false} />
                <span>
                  <strong>{planet.name}</strong>
                  <small><span>{formatUniverseCoordinate(planet.coordinate)}</span>{gateAt(planet) ? <b className={`star-atlas__gate is-${gateAt(planet)!.side}`} data-qa-atlas-gate={gateAt(planet)!.gateId}> · Врата {gateClock(gateAt(planet)!.completesAt - nowMs)}</b> : null}</small>
                  {debris > 0 ? <em>обломки {numberFormat.format(debris)}</em> : null}
                </span>
              </button>
              {ATLAS_COLUMNS.map((column) => {
                if (column.key === 'recycle') {
                  return debris > 0
                    ? <AtlasActionCircle key={column.key} column={column} planet={planet} enabled reason="" cell={plans[planet.id]?.recycle} onClick={(event) => onRecycle(target, event.currentTarget)} />
                    : <span key={column.key} className="star-atlas__act is-empty" aria-hidden="true" />;
                }
                const state = states[column.key];
                return (
                  <AtlasActionCircle key={column.key} column={column} planet={planet} enabled={state.enabled} reason={state.reason} status={state.status}
                    cell={plans[planet.id]?.[column.quick]} onClick={() => onAction(column.legacy!, planet)} />
                );
              })}
            </li>
          ))}
        </ul>
        <footer className="star-atlas__foot">
          <button type="button" className="star-atlas__map" onClick={() => onVisit(node)}>
            <img src={ACTION_ART['show-on-map']} alt="" draggable={false} />
            <span>Показать на карте</span>
          </button>
        </footer>
      </div>
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
function useStableValue<T>(value: T, keyOf: (value: T) => string): T {
  // The key is built only when the array itself is a new object: App hands the
  // same one over for renders that did not change it.
  const keyed = useRef<{ value: T; key: string } | null>(null);
  if (!keyed.current || keyed.current.value !== value) keyed.current = { value, key: keyOf(value) };
  const key = keyed.current.key;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [key]);
}

// The clock belongs to the map, not to a render or a selected object. Toggling
// the layer and visiting another system must not restart orbital motion.
function MovingAsteroid({ node, underlyingKind, nowMs, hasDebris, occupiedNodes, onSelect, onQuick }: { node: UniversePlanetNode; underlyingKind?: UniversePlanetNode['kind']; nowMs: number; hasDebris: boolean; occupiedNodes: readonly UniversePlanetNode[]; onSelect: (node: UniversePlanetNode) => void; onQuick?: (node: UniversePlanetNode, event: ReactMouseEvent<HTMLElement>) => void }) {
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
  return <button ref={ref} type="button" className={`system-asteroid ${attached ? 'is-attached' : ''} ${hasDebris ? 'has-debris' : ''}`} style={{ ...toStyle(point), ...(attached ? { zIndex: mapStackOrder(point.y) + 1 } : {}) }}
    data-tip={`${node.name} ${formatUniverseCoordinate(node.coordinate)}, дальше ${nextCoordinate}`} aria-label={`${node.name} · ${formatUniverseCoordinate(node.coordinate)}`}
    aria-describedby={hasDebris ? `universe-asteroid-debris-tooltip-${node.asteroid?.spawnIndex}` : undefined}
    data-qa-universe-asteroid-position={node.coordinate.position}
    data-qa-universe-asteroid-spawn-index={node.asteroid?.spawnIndex ?? ''}
    data-qa-universe-asteroid-next-move={node.asteroid?.nextMoveAt ?? ''}
    data-qa-universe-asteroid-next-coordinate={nextCoordinate}
    data-qa-universe-asteroid-gas="hidden"
    data-qa-universe-asteroid-debris={hasDebris ? 'present' : 'absent'}
    data-qa-universe-object={node.id} data-qa-universe-kind="asteroid" data-qa-universe-underlying-kind={underlyingKind ?? ''} onClick={() => onSelect(node)} onContextMenu={onQuick ? (event) => onQuick(node, event) : undefined}>
    <img src={node.art} alt="" draggable={false} /><span className="system-asteroid__label">АСТЕРОИД · {node.coordinate.position}</span>
    {hasDebris ? <span className="universe-asteroid-debris-marker"><DebrisChip label="обломки" ariaLabel="Обломки на астероиде: есть" /><span className="universe-debris-tooltip universe-asteroid-debris-tooltip" id={`universe-asteroid-debris-tooltip-${node.asteroid?.spawnIndex}`} role="tooltip">На астероиде есть обломки</span></span> : null}
  </button>;
}

export function UniverseView({ onNotice, ownerPresence, ownedPlanetArt, ownedPlanetName, profile, ownerScores, shields, command, playerPlanets: playerPlanetsProp, spyTargets: spyTargetsProp, orbitalDebrisByCoordinate, asteroidDebrisPresenceBySpawnIndex, asteroidStates, pirateContactState, pirateContacts = [], pirateFocusTarget, mode, onColonize, onAsteroidRecycler, onExpedition, onExplorationRecon, onExplorationAttack, explorationEligibility = {}, explorationIntel = {}, onTransport, onSpy, onAttack, onPirateRecon, onPirateAttack, onPirateReport, onPirateSystemChange, focusTarget, onFocusHandled, onSunSelect, sunAlerts = [], gateBeacons = [], onSunDefend, sunRaidAccess, homeCoordinate, debrisOrigin, onQuickSend, onQuickDetails }: UniverseViewProps) {
  const galaxyCount = getActiveGalaxyCount();
  const [galaxy, setGalaxy] = useState(homeCoordinate?.galaxy ?? GALAXY);
  const [system, setSystem] = useState(homeCoordinate?.system ?? 1);
  const [listPinned, setListPinned] = useState(false);
  const [focusEmpty, setFocusEmpty] = useState(false);
  const [showSlotLabels, setShowSlotLabels] = useState(true);
  const [showAsteroids, setShowAsteroids] = useState(true);
  const [showDebris, setShowDebris] = useState(true);
  const [hiddenLegend, setHiddenLegend] = useState<ReadonlySet<MapTone>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [debrisSearch, setDebrisSearch] = useState<DebrisSearch | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ nodeId: string; anchor: HTMLElement } | null>(null);
  const [debrisQuick, setDebrisQuick] = useState<{ target: QuickTarget; anchor: HTMLElement } | null>(null);
  /** «Обломки» in the atlas: the recycle send panel over the atlas window. */
  const [atlasQuick, setAtlasQuick] = useState<{ target: QuickTarget; anchor: HTMLElement } | null>(null);
  /** Right mouse button on the Sun: its quick menu beside the star. */
  const [sunQuick, setSunQuick] = useState<HTMLElement | null>(null);
  /** A jump from a notice opens quick actions once the target system is drawn. */
  const [pendingQuick, setPendingQuick] = useState<{ kind: 'node'; planetId?: string; coordinate: UniverseCoordinate } | { kind: 'sun' } | null>(null);
  const starRef = useRef<HTMLButtonElement>(null);
  const highlightTimerRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onPirateSystemChangeRef = useRef(onPirateSystemChange);
  const nowMs = useClockNow();
  // Test Mode screenshot route `#universe-card-<scenario>`: a seeded object card or debris list, frozen clock.
  const qaScenario = useMemo(() => getUniverseCardQaScenario(mode), [mode]);
  const qaFixture = useMemo(() => (qaScenario ? createUniverseCardQaFixture(qaScenario, Date.now(), {
    planet: planetArts[3], asteroid: asteroidArts[2], pirate: pirateArts[1] ?? pirateArts[0], unique: assets.uniqueArts?.[0] ?? '', anomaly: anomalyArts[0] ?? '',
  }) : null), [qaScenario]);
  const [qaCardOpen, setQaCardOpen] = useState(true);

  useEffect(() => {
    onPirateSystemChangeRef.current = onPirateSystemChange;
  }, [onPirateSystemChange]);

  // The app re-renders every second and hands over fresh arrays; keep the
  // map inputs stable so the galaxy is not rebuilt on every tick.
  const spyTargets = useStableValue(spyTargetsProp, (targets) => JSON.stringify(targets.map((target) => [target.id, target.ownerId, target.ownerName, target.raceId, target.kind, target.name, target.coordinate])));
  const playerPlanets = useStableValue(playerPlanetsProp, (planets) => JSON.stringify(planets));

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
      // The look its owner picked (NPC colonies choose one, as a player does in the editor).
      ...(planetSkinMapArt(target.skin) ? { art: planetSkinMapArt(target.skin) } : {}),
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
    if (focusTarget.mode === 'sun') {
      setGalaxy(focusTarget.coordinate.galaxy);
      setSystem(focusTarget.coordinate.system);
      setSelectedNodeId(null);
      setQuick(null);
      setPendingQuick({ kind: 'sun' });
      onFocusHandled?.();
      return;
    }
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
      // A Gate in another galaxy: its node exists once that galaxy is drawn.
      if (focusTarget.mode === 'quick') setPendingQuick({ kind: 'node', planetId: focusTarget.planetId, coordinate: focusTarget.coordinate });
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
    if (focusTarget.mode === 'quick') {
      setSelectedNodeId(null);
      setSunQuick(null);
      setPendingQuick({ kind: 'node', planetId: target.id, coordinate: target.coordinate });
      onFocusHandled?.();
      return;
    }
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

  useEffect(() => {
    if (!pendingQuick) return undefined;
    const frame = requestAnimationFrame(() => {
      if (pendingQuick.kind === 'sun') {
        if (starRef.current) setSunQuick(starRef.current);
      } else if (onQuickSend) {
        const { galaxy: g, system: s, position } = pendingQuick.coordinate;
        const element = (pendingQuick.planetId ? document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(pendingQuick.planetId)}"]`) : null)
          ?? document.querySelector<HTMLElement>(`[data-node-pos="${g}:${s}:${position}"]`);
        const nodeId = element?.dataset.nodeId;
        if (element && nodeId) setQuick({ nodeId, anchor: element });
      }
      setPendingQuick(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingQuick, systemData, onQuickSend]);

  const ownerPlanets = useMemo(() => {
    if (!selectedNode || (selectedNode.kind !== 'player' && selectedNode.kind !== 'npc')) return [];
    const selectedOwner = owners.get(selectedNode.ownerId ?? '');
    if (!selectedOwner) return [];
    const listed = selectedOwner.planetIds
      .map((planetId) => nodesById.get(planetId))
      .filter((planet): planet is UniversePlanetNode => Boolean(planet && (planet.kind === 'player' || planet.kind === 'npc')));
    return listed.length ? listed.slice(0, MAX_PLANETS_PER_OWNER) : [selectedNode];
  }, [nodesById, owners, selectedNode]);

  const qaCard = qaFixture?.card && qaCardOpen ? qaFixture.card : null;
  /** The open card: a clicked object, or the seeded one of the screenshot route. */
  const cardKey = selectedNodeId ?? (qaCard ? qaCard.node.id : null);
  const closeCard = () => { setSelectedNodeId(null); setQaCardOpen(false); };
  useEffect(() => {
    if (!qaFixture?.debris) return;
    const { origin, results } = qaFixture.debris;
    setDebrisSearch({ origin, results, ...nearbySystemWindow(origin.coordinate.system, SYSTEM_COUNT) });
  }, [qaFixture]);

  useEffect(() => {
    if (!cardKey) return undefined;
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
      // The recycle panel over the atlas closes first.
      if (document.querySelector('[data-qa-quick-menu]')) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedNodeId(null);
      setQaCardOpen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (stage) stage.inert = wasInert;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [cardKey]);

  useEffect(() => {
    if (cardKey) closeButtonRef.current?.focus();
  }, [cardKey]);
  useEffect(() => { if (!cardKey) setAtlasQuick(null); }, [cardKey]);

  const goSystem = (next: number, nextGalaxy = galaxy) => {
    const boundedGalaxy = Math.min(galaxyCount, Math.max(1, nextGalaxy));
    const bounded = Math.min(SYSTEM_COUNT, Math.max(1, next));
    setGalaxy(boundedGalaxy);
    setSystem(bounded);
    setSelectedNodeId(null);
    setQuick(null);
    setSunQuick(null);
    onNotice(`Галактика ${boundedGalaxy} · Солнечная система ${bounded}.`);
  };
  const openDebrisSearch = () => {
    if (!debrisOrigin) return;
    const range = nearbySystemWindow(debrisOrigin.coordinate.system, SYSTEM_COUNT);
    setDebrisSearch({ origin: debrisOrigin, ...range, results: findDebrisNearSystem(orbitalDebrisByCoordinate, debrisOrigin.coordinate, SYSTEM_COUNT) });
  };
  /** The quick-send target of a debris entry; position 0 is the Sun. */
  const debrisTargetOf = (entry: DebrisEntry): QuickTarget => {
    const { coordinate, debris } = entry;
    const isSun = coordinate.position === 0;
    const atPosition = isSun ? undefined : [...nodesById.values()].find((node) => node.kind !== 'asteroid' && node.coordinate.galaxy === coordinate.galaxy && node.coordinate.system === coordinate.system && node.coordinate.position === coordinate.position);
    // Flights to a Sun are routed to its system's first position; position 0 only labels its debris.
    const node: UniversePlanetNode = atPosition ?? {
      id: `debris:${formatUniverseCoordinate(coordinate)}`, kind: 'empty', art: isSun ? SUN_DEBRIS_ART : '', statusLabel: '', description: '',
      name: isSun ? `Обломки Солнца ${coordinate.galaxy}:${coordinate.system}` : 'Свободная позиция', coordinate: isSun ? { ...coordinate, position: 1 } : coordinate,
    };
    return { node, orbitalDebris: debris, ...(isSun ? { sun: { galaxy: coordinate.galaxy, system: coordinate.system } } : {}) };
  };
  /** «Собрать» in the list: the same send panel as «Собрать обломки» on the map. */
  const openDebrisQuick = (entry: DebrisEntry, anchor: HTMLElement) => setDebrisQuick({ anchor, target: debrisTargetOf(entry) });
  /** Opens the coordinate's system and pulses whatever sits there (position 0 is the Sun itself). */
  const pinpointCoordinate = (coordinate: UniverseCoordinate) => {
    setDebrisQuick(null);
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
  const mapStatusOf = (node: UniversePlanetNode): MapRelationStatus => applyMapShield(classifyMapPlanet(
    node,
    node.kind === 'player' || node.kind === 'npc' ? getUniverseOwnerRelation(node, owner.id, owner.alliance, owners.get(node.ownerId ?? ''), allianceDiplomacy) : null,
    owner.id,
    (ownerId) => ownerScores[ownerId],
  ), node, owner.id, shields, nowMs);
  const listedNodes = systemData.positions.filter((node) => LISTED_KINDS.has(node.kind)).map((node) => ({ node, status: mapStatusOf(node) }));
  const homeWorld = playerPlanets.find((planet) => planet.isHomeworld)?.coordinate ?? playerPlanets[0]?.coordinate;
  const sunUnderAttack = sunAlerts.some((alert) => alert.galaxy === galaxy && alert.system === system);
  const sunRaidsHere = sunAlerts.filter((alert) => alert.galaxy === galaxy && alert.system === system && alert.arrivesAt !== undefined)
    .map((alert) => ({ allianceTag: alert.allianceTag ?? '', arrivesAt: alert.arrivesAt! }));
  const gateAtPosition = new Map(gateBeacons.filter((beacon) => beacon.coordinate?.galaxy === galaxy && beacon.coordinate.system === system)
    .map((beacon) => [beacon.coordinate!.position, beacon]));
  const gateAt = (planet: UniversePlanetNode) => gateBeacons.find((beacon) => beacon.hostPlanetId === planet.id
    || (beacon.coordinate && formatUniverseCoordinate(beacon.coordinate) === formatUniverseCoordinate(planet.coordinate)));
  const gateSystems = new Set(gateBeacons.filter((beacon) => beacon.coordinate?.galaxy === galaxy).map((beacon) => beacon.coordinate!.system));
  /** «Врата» chip: open the host's system and its quick actions (spy / attack). */
  const jumpToGate = (beacon: GateBeacon) => {
    if (!beacon.coordinate) return;
    setGalaxy(beacon.coordinate.galaxy);
    setSystem(beacon.coordinate.system);
    setSelectedNodeId(null);
    setSunQuick(null);
    setQuick(null);
    setPendingQuick({ kind: 'node', planetId: beacon.hostPlanetId, coordinate: beacon.coordinate });
  };
  const pad2 = (value: number) => String(value).padStart(2, '0');

  const selectNode = (node: UniversePlanetNode) => setSelectedNodeId(node.id);
  // Right mouse button (or the context-menu key) opens quick actions beside the object; left click keeps the card.
  const openQuick = (node: UniversePlanetNode, event: ReactMouseEvent<HTMLElement>) => {
    if (!onQuickSend) return;
    event.preventDefault();
    setQuick({ nodeId: node.id, anchor: event.currentTarget });
  };
  const quickNode = quick ? systemNodesById.get(quick.nodeId) ?? null : null;
  const quickNodeStatus = quickNode ? mapStatusOf(quickNode) : null;
  const quickAttackBlockedReason = quickNodeStatus?.attackable === false ? quickNodeStatus.detail ?? quickNodeStatus.title : null;
  const quickTarget = useMemo<QuickTarget | null>(() => {
    if (!quickNode) return null;
    const key = `${quickNode.coordinate.galaxy}:${quickNode.coordinate.system}:${quickNode.coordinate.position}`;
    const targetOwner = quickNode.kind === 'player' || quickNode.kind === 'npc' ? owners.get(quickNode.ownerId ?? '') : undefined;
    return {
      node: quickNode,
      ...(quickNode.kind === 'player' || quickNode.kind === 'npc' ? { relation: getUniverseOwnerRelation(quickNode, owner.id, owner.alliance, targetOwner, allianceDiplomacy) } : {}),
      ...(targetOwner ? { owner: { id: targetOwner.id, displayName: targetOwner.displayName, raceId: targetOwner.raceId, alliance: targetOwner.alliance ?? null } } : {}),
      ...(quickNode.kind === 'asteroid' ? { underlyingKind: systemData.positions.find((node) => node.coordinate.position === quickNode.coordinate.position)?.kind } : {}),
      attackBlockedReason: quickAttackBlockedReason,
      orbitalDebris: quickNode.kind === 'asteroid' ? 0 : orbitalDebrisByKey.get(key) ?? 0,
      explorationStatus: explorationEligibility[quickNode.id],
      ...(quickNode.kind === 'pirate' ? { pirate: pirateContacts.find((contact) => contact.contactCycleKey === quickNode.pirate?.contactCycleKey) } : {}),
    };
    // Rebuilt when the object or what is known about it changes, not on every clock tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickNode?.id, quickNode?.coordinate.position, quickAttackBlockedReason, owners, allianceDiplomacy, orbitalDebrisByKey, explorationEligibility[quickNode?.id ?? ''], pirateContacts]);

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
  const selectedMapStatus = selectedNode && selectedOwner ? mapStatusOf(selectedNode) : null;
  const inspectorRelationTone = selectedMapStatus ? MAP_TONE_COLOR[selectedMapStatus.tone] : undefined;
  const cardModel = qaCard ?? (selectedNode && !selectedOwner ? {
    node: selectedNode,
    underlyingNode: selectedUnderlyingNode,
    orbitalDebris: selectedNode.kind === 'asteroid' ? 0 : orbitalDebrisByKey.get(`${selectedNode.coordinate.galaxy}:${selectedNode.coordinate.system}:${selectedNode.coordinate.position}`) ?? 0,
    asteroidHasDebris: Boolean(selectedNode.kind === 'asteroid' && selectedNode.asteroid && asteroidDebrisPresenceBySpawnIndex?.[String(selectedNode.asteroid.spawnIndex)]),
    pirateContact: selectedNode.kind === 'pirate' ? pirateContacts.find((contact) => contact.contactCycleKey === selectedNode.pirate?.contactCycleKey) : undefined,
    explorationStatus: explorationEligibility[selectedNode.id],
    intel: explorationIntel[selectedNode.id],
  } : null);

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
            ref={starRef}
            className={`system-star-button ${sunUnderAttack ? 'is-under-attack' : ''}`}
            aria-label={`Солнце системы ${system}. Эффективность: ${systemData.sunEfficiencyPercent}%. Открыть командный рейд`}
            aria-describedby="universe-star-efficiency"
            aria-haspopup="menu"
            data-qa-universe-sun-efficiency={systemData.sunEfficiencyPercent}
            onClick={() => onSunSelect?.(galaxy, system)}
            onContextMenu={(event) => {
              if (!onSunDefend && !onSunSelect) return;
              event.preventDefault();
              setQuick(null);
              setSunQuick(event.currentTarget);
            }}
          >
            <img className="system-star" src={systemData.starArt} alt="" draggable={false} />
            <span className="system-star-tooltip" id="universe-star-efficiency" role="tooltip">
              <strong>СИСТЕМА {String(system).padStart(2, '0')}</strong>
              <small>Эффективность солнца: {systemData.sunEfficiencyPercent}%</small>
              {sunUnderAttack ? <small className="system-star-alert">Входящий рейд на Солнце</small> : null}
              {onSunSelect ? <small>Нажмите: рейд или защита Солнца</small> : null}
              {onSunDefend ? <small>Правая кнопка: быстрые действия</small> : null}
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
          const mapStatus = mapStatusOf(node);
          if (node.kind === 'empty') {
            return (
              <button
                key={node.id}
                type="button"
                className={`empty-slot ${focusEmpty ? 'emphasized' : ''} ${orbitalDebris > 0 ? 'empty-slot--with-debris' : ''}`}
                style={toStyle(point)}
                data-tip={orbitalDebris > 0 ? undefined : `Свободная позиция ${coordinate}`}
                aria-label={`${ariaLabel}${debrisDescription}`}
                aria-describedby={orbitalDebris > 0 ? `universe-debris-tooltip-${node.id}` : undefined}
                data-qa-universe-object={node.id}
                data-qa-universe-kind={node.kind}
                onClick={() => selectNode(node)}
                onContextMenu={(event) => openQuick(node, event)}
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
              className={`system-planet system-planet--${node.kind} ${claim ? `has-claim has-claim--${claim}` : ''} ${relation ? `system-planet--${relation}` : ''} ${node.isHomeworld ? 'owned' : ''} ${highlightedNodeId === node.id ? 'system-planet--highlight' : ''} ${orbitalDebris > 0 ? 'system-planet--with-debris' : ''} map-tone--${mapStatus.tone} ${mapStatus.attackable === true ? 'is-attackable' : ''} ${mapStatus.attackable === false ? 'is-blocked' : ''} ${hiddenLegend.has(mapStatus.tone) ? 'is-filtered' : ''}`}
              style={{ ...toStyle(point), zIndex: mapStackOrder(point.y) }}
              aria-label={`${ariaLabel} · ${mapStatus.title}${debrisDescription}`}
              aria-describedby={orbitalDebris > 0 ? `universe-debris-tooltip-${node.id}` : undefined}
              data-qa-universe-object={node.isHomeworld ? 'player-planet-helion-01' : node.id}
              data-node-id={node.id}
              data-node-pos={`${node.coordinate.galaxy}:${node.coordinate.system}:${node.coordinate.position}`}
              data-qa-universe-kind={node.kind}
              data-qa-universe-relation={relation ?? undefined}
              data-qa-map-tone={mapStatus.tone}
              data-qa-map-attackable={mapStatus.attackable === null ? undefined : String(mapStatus.attackable)}
              onPointerEnter={(event) => placeMapTip(event.currentTarget)}
              onFocus={(event) => placeMapTip(event.currentTarget)}
              onClick={() => selectNode(node)}
              onContextMenu={(event) => openQuick(node, event)}
            >
              {claim ? <span className={`uv-claim-ring uv-claim-ring--${claim}`} aria-hidden="true" /> : null}
              {mapStatus.shieldLeft ? <span className="shield-aura" aria-hidden="true" data-qa-map-shield-aura /> : null}
              <img src={node.art} alt="" draggable={false} />
              {/* Perf PR 6: the spinning rim is a sibling of the dome, not its child: Chromium only keeps the two
                  loops on the GPU when they are not nested (nested, the UI thread ran every frame on «Вселенная»).
                  After the picture so the picture's sibling-index() entrance delay stays as it was; both layers
                  sit at z-index 2 above it, as the dome and its old ::before did. */}
              {mapStatus.shieldLeft ? <span className="shield-aura__rim" aria-hidden="true" /> : null}
              {gateAtPosition.get(node.coordinate.position) ? (() => {
                const beacon = gateAtPosition.get(node.coordinate.position)!;
                return (
                  <span className={`gate-beacon gate-beacon--${beacon.side}`} data-qa-gate-beacon={beacon.gateId}>
                    <i className="gate-beacon__pulse" aria-hidden="true" />
                    <img src={gateArt(gateRace(owners.get(node.ownerId ?? '')?.raceId), 'construction')} alt="" draggable={false} />
                    <b>Врата · {gateClock(beacon.completesAt - nowMs)}</b>
                  </span>
                );
              })() : null}
              {claim
                ? <span className={'universe-map-occupancy universe-map-occupancy--' + claim}
                    data-qa-universe-map-occupancy={explorationEligibility[node.id] ?? undefined}>
                    <i aria-hidden="true" />{CLAIM_COPY[claim]}
                  </span> : null}
              {showSlotLabels ? <span className="planet-slot">{node.coordinate.position}</span> : null}
              <span className="planet-name" data-qa-map-caption><MapMark tone={mapStatus.tone} blocked={mapStatus.attackable === false} />{caption}{mapStatus.shieldLeft ? <i className="shield-mark" aria-label={`Щит, ещё ${mapStatus.shieldLeft}`} data-qa-map-shield /> : null}</span>
              <span className="map-status-tip" data-map-status-tip data-qa-map-status-tip>
                <strong>{node.name} <span>{coordinate}</span></strong>
                <em><MapMark tone={mapStatus.tone} blocked={mapStatus.attackable === false} />{mapStatus.title}</em>
                {mapStatus.shieldLeft ? <span className="shield-badge" data-qa-map-shield-badge><i className="shield-mark" aria-hidden="true" />Под щитом, ещё {mapStatus.shieldLeft}</span> : null}
                {mapStatus.detail && !mapStatus.shieldLeft ? <span className="map-status-tip__why">{mapStatus.detail}</span> : null}
              </span>
              {orbitalDebris > 0 && showDebris ? <span className="universe-debris-marker"><DebrisChip label={compactAmount(orbitalDebris)} /><span className="universe-debris-tooltip" id={`universe-debris-tooltip-${node.id}`} role="tooltip">Обломки на орбите: {numberFormat.format(orbitalDebris)}</span></span> : null}
            </button>
          );
        })}

        {showAsteroids ? systemData.asteroids.map((asteroid) => <MovingAsteroid key={asteroid.id} node={asteroid} underlyingKind={systemData.positions.find((node) => node.coordinate.position === asteroid.coordinate.position)?.kind} nowMs={nowMs} hasDebris={Boolean(asteroid.asteroid && asteroidDebrisPresenceBySpawnIndex?.[String(asteroid.asteroid.spawnIndex)])} occupiedNodes={asteroidAttachmentNodes} onSelect={selectNode} onQuick={openQuick} />) : null}
      </div>

      <div className="universe-radar__crumb">
        <small>ВСЕЛЕННАЯ · ГАЛАКТИКА {pad2(galaxy)}</small>
        <strong>Солнечная система {pad2(system)}</strong>
        <span>Эффективность солнца {systemData.sunEfficiencyPercent}% · 24 позиции</span>
      </div>

      {gateBeacons.some((beacon) => beacon.coordinate) ? (
        <div className="universe-gates" aria-label="Строящиеся Врата" data-qa-universe-gates={gateBeacons.length}>
          {gateBeacons.filter((beacon) => beacon.coordinate).map((beacon, index) => (
            <button type="button" key={beacon.gateId} className={`universe-gates__item is-${beacon.side}`} style={{ '--i': index } as CSSProperties}
              onClick={() => jumpToGate(beacon)} data-qa-gate-jump={beacon.gateId}
              aria-label={`Врата ${beacon.holderName} на ${beacon.hostPlanetName} ${formatUniverseCoordinate(beacon.coordinate!)}, готовы через ${gateClock(beacon.completesAt - nowMs)}. Показать`}>
              <img src={gateArt(gateRace(owners.get(beacon.hostOwnerId)?.raceId), 'construction')} alt="" draggable={false} />
              <span>
                <b>{beacon.side === 'rival' ? 'Строят Врата' : 'Ваши Врата'} · {beacon.holderName}</b>
                <small>{beacon.hostPlanetName} <em>{formatUniverseCoordinate(beacon.coordinate!)}</em> · {gateClock(beacon.completesAt - nowMs)}</small>
                <i className="universe-gates__bar" aria-hidden="true"><i style={{ width: `${beacon.progress}%` }} /></i>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <aside className={`universe-radar__list ${listPinned ? 'is-pinned' : ''}`} aria-label="Объекты системы">
        <button type="button" className="universe-radar__list-toggle" aria-expanded={listPinned} onClick={() => setListPinned((value) => !value)}
          data-tip={listPinned ? 'Открепить список' : 'Закрепить список открытым'}>
          <small>В СИСТЕМЕ</small>
          <span className="universe-radar__list-dots" aria-hidden="true">
            {listedNodes.map(({ node, status }) => <i key={node.id} className={`legend-${status.tone}`}><MapMark tone={status.tone} /></i>)}
          </span>
          <b>{listedNodes.length}</b>
          <em aria-hidden="true">{listPinned ? '−' : '+'}</em>
        </button>
        <div className="universe-radar__list-body">
          {listedNodes.map(({ node, status }) => (
            <button type="button" key={node.id} className={`universe-radar__row legend-${status.tone} ${selectedNodeId === node.id ? 'is-selected' : ''} ${status.shieldLeft ? 'is-shielded' : ''}`} onClick={() => selectNode(node)} onContextMenu={(event) => openQuick(node, event)}>
              <span className="universe-radar__pos">{node.coordinate.position}</span>
              <img src={node.art} alt="" draggable={false} />
              <strong>{getUniverseNodeCaption(node, profile.displayName, owners.get(node.ownerId ?? '')?.displayName, owner.id)}{status.shieldLeft ? <i className="shield-mark" aria-label={`Под щитом, ещё ${status.shieldLeft}`} data-qa-list-shield /> : null}</strong>
              <i aria-hidden="true"><MapMark tone={status.tone} blocked={status.attackable === false} /></i>
            </button>
          ))}
          <p>+ {systemData.positions.filter((node) => node.kind === 'uninhabited').length} необитаемых · {systemData.asteroids.length} астероидов · {systemData.positions.filter((node) => node.kind === 'empty').length} свободных</p>
        </div>
      </aside>

      <div className="universe-radar__nav">
        <div className="universe-radar__galaxy">
          <small aria-hidden="true">ГАЛАКТИКА</small>
          <GameSelect className="universe-radar__pick" label="Галактика" value={String(galaxy)} onChange={(value) => goSystem(1, Number(value))}
            options={Array.from({ length: galaxyCount }, (_, index) => ({ value: String(index + 1), label: pad2(index + 1), ariaLabel: `Галактика ${index + 1}` }))} />
        </div>
        {homeWorld ? (
          <button type="button" className="universe-radar__home" disabled={homeWorld.galaxy === galaxy && homeWorld.system === system}
            data-tip={`К родной системе ${formatUniverseCoordinate(homeWorld)}`}
            onClick={() => goSystem(homeWorld.system, homeWorld.galaxy)}>⌂ Домой</button>
        ) : null}
        {debrisOrigin ? (
          <button type="button" className="universe-radar__home universe-radar__debris" data-qa-universe-find-debris
            data-tip={`Свободные обломки в ${NEARBY_DEBRIS_SYSTEM_SPAN} системах вокруг ${debrisOrigin.planetName} ${formatUniverseCoordinate(debrisOrigin.coordinate)}`}
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
              <button type="button" key={delta} className={`universe-radar__rail-item is-d${Math.abs(delta)} ${gateSystems.has(value) ? 'has-gate' : ''}`} aria-current={delta === 0 ? 'true' : undefined}
                aria-label={`Солнечная система ${value}${gateSystems.has(value) ? ', строятся Врата' : ''}`} onClick={() => { if (delta) goSystem(value); }}>{pad2(value)}</button>
            );
          })}
        </div>
        <button type="button" className="step" onClick={() => goSystem(system + 1)} disabled={system === SYSTEM_COUNT} aria-label="Следующая система"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 5.5 8 10l4.5-4.5" /></svg></button>
        <GameSelect className="universe-radar__pick universe-radar__rail-pick" label="Солнечная система" value={String(system)} onChange={(value) => goSystem(Number(value))}
          options={galaxyData.systems.map((item) => ({ value: String(item.system), label: pad2(item.system), ariaLabel: `Солнечная система ${item.system}` }))} />
        <small className="universe-radar__rail-total">/ {SYSTEM_COUNT}</small>
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
              ><MapMark tone={key} /><span>{label}</span></button>
            ))}
          </div>
        </div>
        <i className="universe-radar__sep" aria-hidden="true" />
        <small>СЛОИ</small>
        <div className="universe-radar__seg">
          <button type="button" className={showSlotLabels ? 'is-on' : ''} aria-pressed={showSlotLabels} data-tip="Номера позиций на орбитах" onClick={() => setShowSlotLabels((value) => !value)}>⌖ Метки</button>
          <button type="button" className={showAsteroids ? 'is-on' : ''} aria-pressed={showAsteroids} data-qa-universe-asteroids-toggle data-tip="Показать или скрыть астероиды" onClick={() => setShowAsteroids((value) => !value)}>◌ Астероиды</button>
          <button type="button" className={showDebris ? 'is-on' : ''} aria-pressed={showDebris} data-tip="Показать или скрыть обломки" onClick={() => setShowDebris((value) => !value)}>✦ Обломки</button>
          <button type="button" className={focusEmpty ? 'is-on' : ''} aria-pressed={focusEmpty} data-tip="Подсветить свободные позиции" onClick={() => setFocusEmpty((value) => !value)}>▽ Свободные</button>
        </div>
      </div>

      {debrisSearch ? createPortal(
        <DebrisFinder search={debrisSearch} span={NEARBY_DEBRIS_SYSTEM_SPAN} targetOf={debrisTargetOf} sendEnabled={Boolean(onQuickSend)}
          onClose={() => { setDebrisQuick(null); setDebrisSearch(null); }} onShow={pinpointCoordinate} onSend={openDebrisQuick}
          plansOverride={qaFixture?.debris?.plansOverride} />,
        document.body,
      ) : null}

      {debrisQuick && debrisSearch && onQuickSend ? (
        <QuickActions key={debrisQuick.target.node.id} initialAction="recycle" target={debrisQuick.target} anchor={debrisQuick.anchor} onClose={() => setDebrisQuick(null)} onSend={onQuickSend}
          onDetails={(context, originPlanetId) => { setDebrisQuick(null); setDebrisSearch(null); onQuickDetails?.(context, originPlanetId); }} onOpenCard={() => undefined} />
      ) : null}

      {quick && quickTarget && !selectedNode && onQuickSend ? (
        <QuickActions target={quickTarget} anchor={quick.anchor} onClose={() => setQuick(null)} onSend={onQuickSend}
          onDetails={(context, originPlanetId) => onQuickDetails?.(context, originPlanetId)}
          onOpenCard={() => setSelectedNodeId(quickTarget.node.id)} onPirateReport={onPirateReport} />
      ) : null}

      {sunQuick && !selectedNode ? (
        <SunQuickMenu galaxy={galaxy} system={system} efficiency={systemData.sunEfficiencyPercent} raids={sunRaidsHere} now={nowMs} anchor={sunQuick}
          raidAccess={sunRaidAccess ?? { enabled: Boolean(onSunSelect) }}
          onClose={() => setSunQuick(null)}
          onDefend={() => onSunDefend?.(galaxy, system)}
          onRaid={() => onSunSelect?.(galaxy, system)}
          onDetails={() => onSunSelect?.(galaxy, system)} />
      ) : null}

      {selectedNode && selectedOwner ? createPortal(
        <div className="universe-modal-backdrop star-atlas-backdrop">
        <aside className={`universe-inspector universe-inspector--${selectedNode.kind} star-atlas`} role="dialog" aria-modal="true" aria-label={`Звёздный атлас: ${selectedNode.name}`} data-qa-universe-inspector data-qa-inspector-kind={selectedNode.kind}
          style={{ '--atlas-k': inspectorRelationTone } as CSSProperties}>
          <header className="star-atlas__head">
            <small>Звёздный атлас</small>
            <h2><span>{selectedNode.name}</span> <b data-qa-atlas-coordinate>{formatUniverseCoordinate(selectedNode.coordinate)}</b></h2>
          </header>
          <button ref={closeButtonRef} type="button" className="universe-inspector-close star-atlas__close" data-asterion-close aria-label="Закрыть атлас" onClick={() => setSelectedNodeId(null)}>✕</button>
          <OwnerInspector node={selectedNode} owner={selectedOwner} presence={ownerPresence?.[selectedOwner.id]} nowMs={nowMs} gateAt={gateAt} planets={ownerPlanets} currentOwnerId={owner.id} currentAlliance={owner.alliance} diplomacy={allianceDiplomacy} debrisAt={(coordinate) => orbitalDebrisByKey.get(`${coordinate.galaxy}:${coordinate.system}:${coordinate.position}`) ?? 0} mapStatus={selectedMapStatus ?? mapStatusOf(selectedNode)} onAction={handleAction}
            onRecycle={(target, anchor) => { if (onQuickSend) setAtlasQuick({ target, anchor }); }}
            onVisit={(planet) => { goSystem(planet.coordinate.system); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-qa-universe-object="${planet.id}"]`)?.focus()); }} />
        </aside>
        </div>, document.body) : null}

      {atlasQuick && cardKey && onQuickSend ? (
        <QuickActions key={atlasQuick.target.node.id} initialAction="recycle" target={atlasQuick.target} anchor={atlasQuick.anchor} onClose={() => setAtlasQuick(null)} onSend={onQuickSend}
          onDetails={(context, originPlanetId) => { setAtlasQuick(null); closeCard(); onQuickDetails?.(context, originPlanetId); }} onOpenCard={() => undefined} />
      ) : null}

      {cardModel ? createPortal(
        <ObjectCard {...cardModel} nowMs={qaCard ? qaFixture!.nowMs : nowMs} intel={cardModel.intel} closeRef={closeButtonRef} onClose={closeCard}
          onColonize={onColonize} onAsteroidRecycler={onAsteroidRecycler} onExpedition={onExpedition} onExplorationRecon={onExplorationRecon} onExplorationAttack={onExplorationAttack}
          onPirateRecon={onPirateRecon} onPirateAttack={onPirateAttack} onPirateReport={onPirateReport}
          onRecycle={onQuickSend ? (target, anchor) => setAtlasQuick({ target, anchor }) : undefined} />,
        document.body) : null}
    </main>
  );
}
