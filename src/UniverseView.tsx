import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { EmblemGlyph } from './CommandView';

import aegisProfileAvatar from '../assets/source/generated-factions-v1/factions/aegis_profile_avatar.png';
import asteroid01 from '../assets/source/universe-navigation/asteroids/asteroid.variant-01.png';
import asteroid02 from '../assets/source/universe-navigation/asteroids/asteroid.variant-02.png';
import asteroid03 from '../assets/source/universe-navigation/asteroids/asteroid.variant-03.png';
import asteroid04 from '../assets/source/universe-navigation/asteroids/asteroid.variant-04.png';
import asteroid05 from '../assets/source/universe-navigation/asteroids/asteroid.variant-05.png';
import asteroid06 from '../assets/source/universe-navigation/asteroids/asteroid.variant-06.png';
import asteroid07 from '../assets/source/universe-navigation/asteroids/asteroid.variant-07.png';
import asteroid08 from '../assets/source/universe-navigation/asteroids/asteroid.variant-08.png';
import anomaly01 from '../assets/source/universe-navigation/stellar-remnants/stellar-remnant.variant-01.png';
import anomaly02 from '../assets/source/universe-navigation/stellar-remnants/stellar-remnant.variant-02.png';
import pirate01 from '../assets/source/planets/pirate/pirate-planet-01-graveyard.png';
import pirate02 from '../assets/source/planets/pirate/pirate-planet-02-corsair-ocean.png';
import pirate03 from '../assets/source/planets/pirate/pirate-planet-03-treasure-vault.png';
import pirateSkull from '../assets/source/planets/pirate/planet-020.png';
import uniqueIslands from '../assets/source/planets/skins/planet-010.png';
import uniqueVortex from '../assets/source/planets/skins/planet-013.png';
import uniqueCrystal from '../assets/source/planets/skins/planet-021.png';
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

import { selectCurrentAlliance } from './domain/command/selectors.ts';
import type { CommandState } from './domain/command/types.ts';
import { playerFactionLabel } from './domain/profile/repository.ts';
import { selectPlayerProfileMetrics } from './domain/profile/selectors.ts';
import type { PlayerProfileState } from './domain/profile/types.ts';
import type { RatingPrototypeState } from './domain/rating/fixtures.ts';
import {
  GALAXY,
  MAX_PLANETS_PER_OWNER,
  SYSTEM_COUNT,
  createUniverseNpcOwnerProfile,
  createUniverseMap,
  formatUniverseCoordinate,
  getUniverseActionState,
  getUniverseNodeCaption,
  getUniverseObjectKindLabel,
  getUniverseSlotPoint,
  getUniverseAsteroidPoint,
  getUniverseOwnerRelation,
  normalizeUniverseOwnerProfile,
} from './domain/universe/runtime.ts';
import type {
  UniverseAction,
  UniverseAssetCatalog,
  UniverseOwnerAlliance,
  UniverseOwnerPoints,
  UniverseOwnerProfile,
  UniversePlanetNode,
} from './domain/universe/types.ts';

const planetArts = [
  planet01, planet02, planet03, planet04, planet05, planet06, planet07, planet08, planet09, planet10, planet11, planet12,
  generated002, generated003, generated005, generated011, generated012, generated015, generated016, generated026, generated027, generated028, generated030, generated032,
];
const starArts = [star01, star02, star03, star04, star05, star06];
const asteroidArts = [asteroid01, asteroid02, asteroid03, asteroid04, asteroid05, asteroid06, asteroid07, asteroid08];
const pirateArts = [pirateSkull, pirate01, pirate02, pirate03];
const anomalyArts = [anomaly01, anomaly02];
const assets: UniverseAssetCatalog = { planetArts, starArts, asteroidArts, pirateArts, anomalyArts, uniqueArts: [uniqueIslands, uniqueVortex, uniqueCrystal] };

type UniverseViewProps = {
  onNotice: (message: string) => void;
  ownedPlanetArt: string;
  ownedPlanetName: string;
  profile: PlayerProfileState;
  rating: RatingPrototypeState;
  command: CommandState;
};

const POINT_LABELS: ReadonlyArray<{ key: keyof UniverseOwnerPoints; label: string }> = [
  { key: 'resource', label: 'Ресурсные очки' },
  { key: 'battle', label: 'Боевые очки' },
  { key: 'total', label: 'Общие очки' },
  { key: 'achievements', label: 'Очки достижений' },
];

const numberFormat = new Intl.NumberFormat('ru-RU');

function pointValue(metrics: ReturnType<typeof selectPlayerProfileMetrics>, key: string) {
  return metrics.find((metric) => metric.key === key)?.value ?? 0;
}

function currentOwnerPoints(profile: PlayerProfileState, rating: RatingPrototypeState): UniverseOwnerPoints {
  const metrics = selectPlayerProfileMetrics(profile, rating);
  return {
    resource: pointValue(metrics, 'resourcePoints'),
    battle: pointValue(metrics, 'battlePoints'),
    total: pointValue(metrics, 'totalPoints'),
    achievements: pointValue(metrics, 'achievementPoints'),
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

function UniverseActionButton({
  action,
  node,
  currentOwnerId,
  onAction,
}: {
  action: UniverseAction;
  node: UniversePlanetNode;
  currentOwnerId: string;
  onAction: (action: UniverseAction, node: UniversePlanetNode) => void;
}) {
  const state = getUniverseActionState(action, node, currentOwnerId);
  const Icon = action === 'spy' ? EyeIcon : FleetIcon;
  const label = action === 'spy' ? 'Отправить шпионский зонд' : 'Отправить флот';
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

function OwnerInspector({
  node,
  owner,
  planets,
  currentOwnerId,
  onAction,
  onVisit,
}: {
  node: UniversePlanetNode;
  owner: UniverseOwnerProfile;
  planets: UniversePlanetNode[];
  currentOwnerId: string;
  onAction: (action: UniverseAction, node: UniversePlanetNode) => void;
  onVisit: (node: UniversePlanetNode) => void;
}) {
  const alliance = owner.alliance;
  return (
    <div className="universe-inspector-owner" data-qa-universe-owner={owner.id} data-qa-universe-owner-profile>
      <div className="universe-profile-summary">
      <div className={`universe-world-hero universe-world-hero--${node.kind}`}><img src={node.art} alt={node.name} /><span>{formatUniverseCoordinate(node.coordinate)}</span></div>
      <section className="universe-owner-card">
        <div className="universe-owner-avatar" data-qa-universe-avatar><OwnerAvatar owner={owner} /></div>
        <div className="universe-owner-identity">
          <small>ВЛАДЕЛЕЦ ОБЪЕКТА</small>
          <h3 data-qa-universe-owner-name>{owner.displayName}</h3>
          <span>{raceLabel(owner.raceId)}</span>
          <strong>{owner.id === currentOwnerId ? 'ВАШ ПРОФИЛЬ' : 'БОТ · ДЕМОНСТРАЦИОННЫЙ ПРОФИЛЬ'}</strong>
        </div>
        <div className="universe-owner-alliance">
          <AllianceMark alliance={alliance} />
          <span>{alliance ? alliance.name : 'Без союза'}</span>
          {alliance ? <small>[{alliance.tag}]</small> : null}
        </div>
      </section>

      <section className="universe-selected-object">
        <small>ВЫБРАННАЯ ПЛАНЕТА</small>
        <strong>{node.name}</strong>
        <span>{node.isHomeworld ? 'Домашняя планета' : getUniverseObjectKindLabel(node.kind)} · {formatUniverseCoordinate(node.coordinate)}</span>
      </section>

      <section className="universe-points-card" data-qa-universe-points>
        <header><small>РЕЙТИНГ ВЛАДЕЛЬЦА</small></header>
        {owner.points ? (
          <dl>
            {POINT_LABELS.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{numberFormat.format(owner.points?.[key] ?? 0)}</dd></div>)}
          </dl>
        ) : <p>Рейтинг не задан. Бот показан только для знакомства с картой.</p>}
      </section>
      </div>

      <section className="universe-planets-card">
        <header><div><small>ВЛАДЕНИЯ В ГАЛАКТИКЕ</small><strong>{planets.length} {planets.length === 1 ? 'планета' : 'планет'}</strong></div><span>01 / ГАЛАКТИКА</span></header>
        <ul>
          {planets.slice(0, MAX_PLANETS_PER_OWNER).map((planet) => (
            <li key={planet.id} className={planet.id === node.id ? 'active' : ''} data-qa-universe-planet-row={planet.id}>
              <img className="universe-row-art" src={planet.art} alt="" />
              <button type="button" className="universe-planet-row-copy" data-qa-universe-visit={planet.id} onClick={() => onVisit(planet)} title={`Показать на карте ${formatUniverseCoordinate(planet.coordinate)}`}>
                <strong>{planet.name}</strong>
                <small>Система {String(planet.coordinate.system).padStart(2, '0')} <span>{formatUniverseCoordinate(planet.coordinate)} ↗</span></small>
              </button>
              <div className="universe-planet-row-actions">
                <UniverseActionButton action="spy" node={planet} currentOwnerId={currentOwnerId} onAction={onAction} />
                <UniverseActionButton action="fleet" node={planet} currentOwnerId={currentOwnerId} onAction={onAction} />
              </div>
            </li>
          ))}
        </ul>
        <p className="universe-data-note">Нажмите на планету, чтобы перейти к её системе. Отправка флота и разведка пока недоступны.</p>
      </section>
    </div>
  );
}

function SpecialInspector({ node, nowMs }: { node: UniversePlanetNode; nowMs: number }) {
  const isEmpty = node.kind === 'empty';
  const isPirate = node.kind === 'pirate';
  const isAnomaly = node.kind === 'anomaly';
  const isUnique = node.kind === 'unique';
  const isAsteroid = node.kind === 'asteroid';
  const title = isEmpty ? 'Свободная позиция' : node.name;
  const timedState = node.pirate ?? node.special;
  const status = isAsteroid
    ? `Следующее перемещение через ${countdownLabel(nowMs, node.asteroid?.nextMoveAt)}`
    : timedState
      ? `Активен · исчезнет через ${countdownLabel(nowMs, timedState.expiresAt)}`
      : node.statusLabel;
  return (
    <div className={`universe-inspector-special universe-inspector-special--${node.kind}`} data-qa-universe-special={node.kind}>
      <section className="universe-special-preview">
        {node.art ? <img src={node.art} alt="" draggable={false} /> : <span className="universe-special-symbol" aria-hidden="true">{isEmpty ? '＋' : '◌'}</span>}
        <div><small>{getUniverseObjectKindLabel(node.kind)}</small><h3>{title}</h3><span>{node.known === false ? 'Неизученный сигнал' : isAsteroid ? 'Траектория наблюдается · содержание неизвестно' : node.kind === 'uninhabited' || isUnique || isAnomaly ? 'Владелец отсутствует' : 'Галактика 01 · Система ' + String(node.coordinate.system).padStart(2, '0')}</span></div>
      </section>

      <dl className="universe-special-details">
        <div><dt>ТИП ПОЗИЦИИ</dt><dd>{getUniverseObjectKindLabel(node.kind)}</dd></div>
        <div><dt>{isAsteroid ? 'ОРБИТА' : 'КООРДИНАТЫ'}</dt><dd>{isAsteroid ? `Кольцо ${Math.ceil(node.coordinate.position / 6)} · позиция ${node.coordinate.position} / 24` : formatUniverseCoordinate(node.coordinate)}</dd></div>
        <div><dt>СТАТУС</dt><dd data-qa-universe-special-status>{status}</dd></div>
        {isAsteroid ? <div><dt>ЗАПАС ГАЗА</dt><dd data-qa-universe-asteroid-gas="hidden">СКРЫТ ДО ПЕРЕРАБОТКИ</dd></div> : null}
      </dl>

      <p className="universe-special-description">{node.description}</p>

      {isEmpty ? (
        <button type="button" className="universe-disabled-operation" disabled title="Колонизация не подключена" data-qa-universe-special-action="colonize">КОЛОНИЗАЦИЯ · СКОРО</button>
      ) : isPirate ? (
        <button type="button" className="universe-disabled-operation" disabled title="Разведка пока недоступна" data-qa-universe-special-action="pirate">РАЗВЕДАТЬ · СКОРО</button>
      ) : isAnomaly ? (
        <button type="button" className="universe-disabled-operation" disabled title="Исследование пока недоступно" data-qa-universe-special-action="anomaly">ИССЛЕДОВАТЬ · СКОРО</button>
      ) : isAsteroid ? (
        <button type="button" className="universe-disabled-operation" disabled title="Миссия добычи газа пока недоступна" data-qa-universe-special-action="asteroid-recycler">ОТПРАВИТЬ ПЕРЕРАБОТЧИКА · НЕ ПОДКЛЮЧЕНО</button>
      ) : (
        <button type="button" className="universe-disabled-operation" disabled data-qa-universe-special-action="disabled">{node.kind === 'uninhabited' ? 'КОЛОНИЗАЦИЯ' : 'ИССЛЕДОВАНИЕ'} · СКОРО</button>
      )}
    </div>
  );
}

// The clock belongs to the map, not to a render or a selected object. Toggling
// the layer and visiting another system must not restart orbital motion.
function MovingAsteroid({ node, nowMs, occupiedNodes, onSelect }: { node: UniversePlanetNode; nowMs: number; occupiedNodes: readonly UniversePlanetNode[]; onSelect: (node: UniversePlanetNode) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const point = getUniverseAsteroidPoint(node, nowMs, occupiedNodes);
    ref.current?.style.setProperty('--x', `${point.x}%`);
    ref.current?.style.setProperty('--y', `${point.y}%`);
    ref.current?.style.setProperty('--asteroid-offset-x', `${point.offsetX ?? 0}px`);
    ref.current?.style.setProperty('--asteroid-offset-y', `${point.offsetY ?? 0}px`);
  }, [node, nowMs, occupiedNodes]);
  const point = getUniverseAsteroidPoint(node, nowMs, occupiedNodes);
  const nextCoordinate = node.asteroid?.nextCoordinate ? formatUniverseCoordinate(node.asteroid.nextCoordinate) : 'маршрут завершён';
  return <button ref={ref} type="button" className="system-asteroid" style={toStyle(point)}
    title={`${node.name} · ${formatUniverseCoordinate(node.coordinate)} · далее ${nextCoordinate}`} aria-label={`${node.name} · ${formatUniverseCoordinate(node.coordinate)}`}
    data-qa-universe-asteroid-position={node.coordinate.position}
    data-qa-universe-asteroid-next-move={node.asteroid?.nextMoveAt ?? ''}
    data-qa-universe-asteroid-next-coordinate={nextCoordinate}
    data-qa-universe-asteroid-gas="hidden"
    data-qa-universe-object={node.id} data-qa-universe-kind="asteroid" onClick={() => onSelect(node)}>
    <img src={node.art} alt="" draggable={false} /><span>АСТЕРОИД · {node.coordinate.position}</span>
  </button>;
}

export function UniverseView({ onNotice, ownedPlanetArt, ownedPlanetName, profile, rating, command }: UniverseViewProps) {
  const [system, setSystem] = useState(1);
  const [focusEmpty, setFocusEmpty] = useState(false);
  const [showSlotLabels, setShowSlotLabels] = useState(true);
  const [showAsteroids, setShowAsteroids] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const alliance = useMemo(() => {
    const selected = selectCurrentAlliance(command);
    return selected.name && selected.tag ? selected : null;
  }, [command]);
  const owner = useMemo(() => normalizeUniverseOwnerProfile({
    id: profile.playerId,
    displayName: profile.displayName,
    avatarArt: aegisProfileAvatar,
    raceId: profile.factionId,
    alliance,
    points: currentOwnerPoints(profile, rating),
    planetIds: ['player-planet-helion-01'],
  }), [alliance, profile, rating]);
  const owners = useMemo(() => {
    const npc = createUniverseNpcOwnerProfile();
    return new Map<string, UniverseOwnerProfile>([[owner.id, owner], [npc.id, npc]]);
  }, [owner]);
  const galaxyData = useMemo(() => createUniverseMap({
    galaxy: GALAXY,
    currentOwnerId: owner.id,
    currentPlanetName: ownedPlanetName,
    currentPlanetArt: ownedPlanetArt,
    assets,
    nowMs,
    galaxyCount: 1,
  }), [nowMs, ownedPlanetArt, ownedPlanetName, owner.id]);
  const systemData = galaxyData.systems[system - 1];
  const asteroidAttachmentNodes = useMemo(() => [...systemData.positions, ...systemData.asteroids], [systemData]);
  const nodesById = useMemo(() => new Map(galaxyData.systems.flatMap((item) => [...item.positions, ...item.asteroids]).map((node) => [node.id, node])), [galaxyData]);
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;

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

  const goSystem = (next: number) => {
    const bounded = Math.min(SYSTEM_COUNT, Math.max(1, next));
    setSystem(bounded);
    setSelectedNodeId(null);
    onNotice(`Галактика ${GALAXY} · Солнечная система ${bounded}.`);
  };

  const selectNode = (node: UniversePlanetNode) => setSelectedNodeId(node.id);

  const handleAction = (action: UniverseAction, node: UniversePlanetNode) => {
    const actionState = getUniverseActionState(action, node, owner.id);
    onNotice(`${actionState.label}: ${actionState.reason} Цель ${formatUniverseCoordinate(node.coordinate)}.`);
  };

  const selectedOwner = selectedNode && (selectedNode.kind === 'player' || selectedNode.kind === 'npc')
    ? owners.get(selectedNode.ownerId ?? '') ?? null
    : null;

  return (
    <main className="universe-view universe-view-v3" data-qa-universe data-qa-universe-system={system}>
      <div className="universe-nav universe-nav-v3">
        <div className="universe-breadcrumb">
          <span>ВСЕЛЕННАЯ</span><b>›</b><strong>Галактика {GALAXY}</strong><b>›</b><strong>Солнечная система {system}</strong>
        </div>

        <div className="universe-jump nav-coordinate nav-coordinate--system">
          <span>ГАЛАКТИКА</span><strong>01</strong>
          <button type="button" className="step" onClick={() => goSystem(system - 1)} disabled={system === 1} aria-label="Предыдущая система">‹</button>
          <label><span>СИСТЕМА</span><select value={system} onChange={(event) => goSystem(Number(event.target.value))} aria-label="Солнечная система">{galaxyData.systems.map((item) => <option key={item.system} value={item.system}>{String(item.system).padStart(2, '0')}</option>)}</select></label>
          <small>/ {SYSTEM_COUNT}</small>
          <button type="button" className="step" onClick={() => goSystem(system + 1)} disabled={system === SYSTEM_COUNT} aria-label="Следующая система">›</button>
        </div>
      </div>

      <div className="system-scene" data-qa-universe-scene>
        <div className="system-caption"><span>ГАЛАКТИКА {String(GALAXY).padStart(2, '0')} / ЗВЁЗДНЫЙ АТЛАС</span><strong>Система {String(system).padStart(2, '0')}</strong><small>24 позиции · 4 орбиты</small></div>
        <div className="universe-map-legend" aria-label="Обозначения карты"><span className="legend-self">Ваш мир</span><span className="legend-ally">Союзная</span><span className="legend-enemy">Вражеская</span><span className="legend-neutral">Нейтральная</span><span className="legend-wild">Необитаемые</span><span className="legend-unique">Уникальные</span><span className="legend-pirate">Отступники</span><span className="legend-anomaly">Аномалии</span></div>

        {[0, 1, 2, 3].map((ring) => <div key={ring} className={`system-orbit ring-${ring + 1}`} />)}

        <div className="system-star-wrap" aria-label={`Звезда солнечной системы ${system}`}>
          <img className="system-star" src={systemData.starArt} alt={`Звезда системы ${system}`} draggable={false} />
        </div>

        {systemData.positions.map((node) => {
          const point = getUniverseSlotPoint(node.coordinate.position);
          const coordinate = formatUniverseCoordinate(node.coordinate);
          const caption = getUniverseNodeCaption(node, profile.displayName, owners.get(node.ownerId ?? '')?.displayName);
          const relation = node.kind === 'player' || node.kind === 'npc'
            ? getUniverseOwnerRelation(node, owner.id, owner.alliance, owners.get(node.ownerId ?? ''))
            : null;
          const ariaLabel = `${caption} · ${getUniverseObjectKindLabel(node.kind)} · ${coordinate}`;
          if (node.kind === 'empty') {
            return (
              <button
                key={node.id}
                type="button"
                className={`empty-slot ${focusEmpty ? 'emphasized' : ''}`}
                style={toStyle(point)}
                title={`${node.statusLabel} ${coordinate}`}
                aria-label={ariaLabel}
                data-qa-universe-object={node.id}
                data-qa-universe-kind={node.kind}
                onClick={() => selectNode(node)}
              >
                {showSlotLabels ? <span>{node.coordinate.position}</span> : null}
              </button>
            );
          }
          return (
            <button
              type="button"
              key={node.id}
              className={`system-planet system-planet--${node.kind} ${relation ? `system-planet--${relation}` : ''} ${node.isHomeworld ? 'owned' : ''}`}
              style={toStyle(point)}
              title={`${node.name} · ${node.statusLabel} · ${coordinate}`}
              aria-label={ariaLabel}
              data-qa-universe-object={node.id}
              data-qa-universe-kind={node.kind}
              data-qa-universe-relation={relation ?? undefined}
              onClick={() => selectNode(node)}
            >
              <img src={node.art} alt="" draggable={false} />
              {showSlotLabels ? <span className="planet-slot">{node.coordinate.position}</span> : null}
              <span className="planet-name" data-qa-map-caption>{caption}</span>
            </button>
          );
        })}

        {showAsteroids ? systemData.asteroids.map((asteroid) => <MovingAsteroid key={asteroid.id} node={asteroid} nowMs={nowMs} occupiedNodes={asteroidAttachmentNodes} onSelect={selectNode} />) : null}
        <div className="universe-map-hint">Выберите мир, чтобы открыть сведения <span>Астероиды стоят 15–30 мин и переходят к следующей позиции</span></div>
      </div>

      <aside className="universe-tools" aria-label="Инструменты карты">
        <button type="button" className={focusEmpty ? 'active' : ''} aria-pressed={focusEmpty} title="Подсветить свободные позиции" onClick={() => setFocusEmpty((value) => !value)}><b>▽</b><span>Фильтры</span><small>{focusEmpty ? 'Позиции выделены' : 'Свободные позиции'}</small></button>
        <button type="button" className={showSlotLabels ? 'active' : ''} aria-pressed={showSlotLabels} title="Показывать номера слотов" onClick={() => setShowSlotLabels((value) => !value)}><b>⌖</b><span>Метки</span><small>{showSlotLabels ? 'Номера слотов' : 'Скрыты'}</small></button>
        <button type="button" className={showAsteroids ? 'active' : ''} aria-pressed={showAsteroids} data-qa-universe-asteroids-toggle title="Показать или скрыть астероиды" onClick={() => setShowAsteroids((value) => !value)}><b>◌</b><span>Астероиды</span><small>{showAsteroids ? 'Слой включён' : 'Скрыты'}</small></button>
      </aside>

      {selectedNode ? createPortal(
        <div className="universe-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSelectedNodeId(null); }}>
        <aside className={`universe-inspector universe-inspector--${selectedNode.kind}`} role="dialog" aria-modal="true" aria-label={`Инспектор: ${selectedNode.name}`} data-qa-universe-inspector data-qa-inspector-kind={selectedNode.kind}>
          <header className="universe-inspector-header">
            <div><small>ЗВЁЗДНЫЙ АТЛАС / {getUniverseObjectKindLabel(selectedNode.kind)}</small><h2>{selectedNode.name}</h2><span>{selectedNode.kind === 'asteroid' ? `${formatUniverseCoordinate(selectedNode.coordinate)} · кольцо ${Math.ceil(selectedNode.coordinate.position / 6)}` : formatUniverseCoordinate(selectedNode.coordinate)}</span></div>
            <button ref={closeButtonRef} type="button" className="universe-inspector-close" aria-label="Закрыть инспектор" title="Закрыть инспектор" onClick={() => setSelectedNodeId(null)}>×</button>
          </header>
          <div className="universe-inspector-body">
            {selectedOwner ? <OwnerInspector node={selectedNode} owner={selectedOwner} planets={ownerPlanets} currentOwnerId={owner.id} onAction={handleAction} onVisit={(planet) => { goSystem(planet.coordinate.system); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-qa-universe-object="${planet.id}"]`)?.focus()); }} /> : <SpecialInspector node={selectedNode} nowMs={nowMs} />}
          </div>
        </aside>
        </div>, document.body) : null}
    </main>
  );
}
