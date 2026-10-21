import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import bombardmentIcon from '../../../assets/source/mission-icons-v1/20_bombardment.png';
import sunSupportIcon from '../../../assets/source/mission-icons-v1/08_sun_support.png';
import { getFactionCombatEntity, getFactionShipCatalog } from '../../domain/combat/faction-catalog.ts';
import { COMMANDER_IDS, type CommanderId } from '../../domain/combat/commanders.ts';
import type { ShipId } from '../../domain/combat/ids.ts';
import { getBaseSunEfficiencyPercent } from '../../domain/energy/runtime.ts';
import type { RuntimeMode } from '../../domain/runtime/mode.ts';
import { SOLAR_CRYSTALS, SUN_RAID_CONFIG } from '../../domain/sun-raid/config.ts';
import { getHolderCrystals, incomingRaidsOnSun, projectSun, readSun } from '../../domain/sun-raid/rules.ts';
import type { SunRaidEvent, SunRaidRecord } from '../../domain/sun-raid/types.ts';
import { getActiveGalaxyCount } from '../../domain/universe/runtime.ts';
import type { SaveState } from '../../application/contracts.ts';
import { getAvailableFleetForPlanet } from '../../application/flights.ts';
import {
  currentSunRaidState,
  formatSun,
  getSunDebris,
  isSunCombatHull,
  launchSunRaid,
  previewSunLaunch,
  selectIncomingSunAlerts,
  selectPlayerRaidRole,
  selectRaidSides,
  sunFleetPopulation,
  testBot01DefendSun,
  testBot01RaidSun,
  testGrantCrystal,
  testIraJoinRaid,
  testIraSupportSun,
  type SunActionResult,
} from '../../application/sun-raid.ts';
import { CrystalSet, SunBrightnessBar, SunOrb } from './SunRaidArt.tsx';
import { AmountSlider } from '../AmountSlider.tsx';
import './sun-raid.css';

export type SunSelection = { galaxy: number; system: number };

type SunRaidPanelProps = {
  state: SaveState;
  now: number;
  mode: RuntimeMode;
  testTimeScale: number;
  selected: SunSelection;
  onSelect: (sun: SunSelection) => void;
  onCommit: (result: SunActionResult) => void;
  onOpenReport: (reportId: string) => void;
  onOpenCommand: () => void;
  onOpenGate: () => void;
  /** «Поддержка солнца» is a Fleets mission: opens «Флоты» with the Sun preselected. */
  onSendSupport: (raid: SunRaidRecord) => void;
  /** Opens «Флоты → Переработка» aimed at the Sun's debris. */
  onRecycleDebris: (sun: SunSelection) => void;
  onTestGateAssault?: () => void;
};

function countdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours} ч ${String(minutes).padStart(2, '0')} мин`;
  return minutes ? `${minutes} мин ${String(seconds).padStart(2, '0')} с` : `${seconds} с`;
}

const pad2 = (value: number) => String(value).padStart(2, '0');

export function SunRaidPanel({ state, now, mode, testTimeScale, selected, onSelect, onCommit, onOpenReport, onOpenCommand, onOpenGate, onSendSupport, onRecycleDebris, onTestGateAssault }: SunRaidPanelProps) {
  const sunRaid = currentSunRaidState(state);
  const role = selectPlayerRaidRole(state);
  const crystals = getHolderCrystals(sunRaid, role.holder);
  const alerts = selectIncomingSunAlerts(state, now);
  const ownRaids = role.allianceId ? sunRaid.raids.filter((raid) => raid.allianceId === role.allianceId).slice(-6).reverse() : [];
  const [galaxy, setGalaxy] = useState(selected.galaxy);
  const [launch, setLaunch] = useState<null | { kind: 'attack' }>(null);
  const galaxyCount = getActiveGalaxyCount();
  const options = { now, mode, testTimeScale };

  useEffect(() => { setGalaxy(selected.galaxy); }, [selected.galaxy]);

  const sun = readSun(sunRaid, selected.galaxy, selected.system);
  const projection = projectSun(sun, now);
  const incoming = incomingRaidsOnSun(sunRaid, selected.galaxy, selected.system);
  const raidHere = incoming[0] ?? null;
  const ownIncoming = raidHere && raidHere.allianceId === role.allianceId;
  const homeGalaxies = new Set(Object.values(state.planets).map((planet) => planet.universeGalaxy ?? 1));
  const activeOwnRaid = ownRaids.find((raid) => raid.closedAt === undefined);
  const raidBlock = !role.allianceId
    ? 'Рейд на Солнце — командная операция. Создайте союз или вступите в него (вкладка «Союз»).'
    : role.role !== 'leader' && role.role !== 'deputy'
      ? 'Рейд объявляют лидер или заместитель союза.'
      : sunRaid.campaignResult
        ? 'Кампания завершена.'
        : activeOwnRaid
          ? `Союз уже ведёт рейд на Солнце ${formatSun(activeOwnRaid.galaxy, activeOwnRaid.system)}. Новый — после возвращения флота.`
          : projection.frozen
            ? `Солнце заморожено. Оттает через ${countdown((projection.unfreezesAt ?? now) - now)}.`
            : raidHere
              ? 'К этому Солнцу уже летит рейд.'
              : null;
  const supportBlock = !raidHere
    ? 'Защищать можно только Солнце под атакой.'
    : ownIncoming
      ? 'Это рейд вашего союза.'
      : !homeGalaxies.has(raidHere.galaxy)
        ? 'Защищать могут владельцы планет в этой галактике.'
        : null;
  const sunDebris = getSunDebris(state, selected.galaxy, selected.system);
  const events = sunRaid.history.filter((event) => event.galaxy === undefined || (event.galaxy === selected.galaxy && event.system === selected.system) || event.kind.startsWith('gate')).slice(-8).reverse();
  const latestResult = [...sunRaid.raids].reverse().find((raid) => raid.galaxy === selected.galaxy && raid.system === selected.system && raid.result);

  return (
    <div className="srp" data-qa-sun-raid-panel>
      <aside className="srp-feed">
        <section className="srp-block">
          <header><small>ТРЕВОГИ ГАЛАКТИКИ</small><b>{alerts.length}</b></header>
          {alerts.length ? alerts.map(({ raid, arrivesInMs }) => (
            <button key={raid.id} type="button" className="srp-alert" onClick={() => onSelect({ galaxy: raid.galaxy, system: raid.system })} data-qa-sun-alert={raid.id}>
              <img src={bombardmentIcon} alt="" />
              <span><b>Атака на Солнце {formatSun(raid.galaxy, raid.system)}</b><small>[{raid.allianceTag}] {raid.initiatorName} · прибытие через {countdown(arrivesInMs)}</small></span>
            </button>
          )) : <p className="srp-empty">Входящих атак на Солнца ваших галактик нет.</p>}
        </section>
        <section className="srp-block">
          <header><small>РЕЙДЫ СОЮЗА {role.allianceTag ? `[${role.allianceTag}]` : ''}</small><b>{ownRaids.length}</b></header>
          {!role.allianceId ? (
            <div className="srp-solo">
              <p>Рейды на Солнца ведут союзы: создайте союз или вступите в него на вкладке «Союз». Одиночка может защищать Солнца своей галактики и строить Врата, если добудет 4 кристалла.</p>
              <button type="button" className="opsA-btn" onClick={onOpenCommand}>К ВКЛАДКЕ «СОЮЗ»</button>
            </div>
          ) : ownRaids.length ? ownRaids.map((raid) => <RaidRow key={raid.id} raid={raid} now={now} onSelect={() => onSelect({ galaxy: raid.galaxy, system: raid.system })} onReport={onOpenReport} />)
            : <p className="srp-empty">Союз ещё не водил рейдов. Выберите Солнце справа.</p>}
        </section>
        <section className="srp-block srp-block--grid">
          <header>
            <small>СОЛНЦА ГАЛАКТИКИ</small>
            <label className="srp-galaxy">
              <span className="srp-sr">Галактика</span>
              <select value={galaxy} onChange={(event) => setGalaxy(Number(event.target.value))} aria-label="Галактика">
                {Array.from({ length: galaxyCount }, (_, index) => <option key={index + 1} value={index + 1}>Галактика {pad2(index + 1)}</option>)}
              </select>
            </label>
          </header>
          <div className="srp-suns" role="listbox" aria-label="Солнца галактики">
            {Array.from({ length: 40 }, (_, index) => {
              const system = index + 1;
              const tile = projectSun(readSun(sunRaid, galaxy, system), now);
              const attacked = incomingRaidsOnSun(sunRaid, galaxy, system).length > 0;
              const isSelected = selected.galaxy === galaxy && selected.system === system;
              const home = Object.values(state.planets).some((planet) => (planet.universeGalaxy ?? 1) === galaxy && (planet.universeSystem ?? 1) === system);
              return (
                <button
                  key={system}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`srp-sun-tile ${isSelected ? 'is-selected' : ''} ${tile.frozen ? 'is-frozen' : ''} ${attacked ? 'is-attacked' : ''} ${tile.brightness < tile.baseEfficiency ? 'is-dimmed' : ''}`}
                  style={{ '--tile-glow': tile.brightness / 100 } as CSSProperties}
                  onClick={() => onSelect({ galaxy, system })}
                  title={`Солнце ${formatSun(galaxy, system)} · ${tile.brightness}%${tile.frozen ? ' · заморожено' : ''}${attacked ? ' · под атакой' : ''}`}
                  data-qa-sun-tile={`${galaxy}:${system}`}
                >
                  <i aria-hidden="true" />
                  <b>{pad2(system)}</b>
                  <small>{tile.brightness}%</small>
                  {home ? <em aria-label="ваша система">⌂</em> : null}
                </button>
              );
            })}
          </div>
        </section>
      </aside>

      <section className="srp-dossier" data-qa-sun-dossier={`${selected.galaxy}:${selected.system}`}>
        <div className="srp-hero">
          <div className="srp-hero__orb">
            <SunOrb brightness={projection.brightness} baseEfficiency={projection.baseEfficiency} frozen={projection.frozen} size={260} />
          </div>
          <div className="srp-hero__copy">
            <small>КОМАНДНЫЙ РЕЙД · СОЛНЦЕ</small>
            <h2>Солнце {formatSun(selected.galaxy, selected.system)}</h2>
            <div className="srp-status">
              {projection.frozen ? <span className="srp-chip srp-chip--frozen">ЗАМОРОЖЕНО · ВОССТАНАВЛИВАЕТСЯ</span>
                : projection.recovering ? <span className="srp-chip srp-chip--warm">ВОССТАНАВЛИВАЕТСЯ</span>
                  : <span className="srp-chip srp-chip--ok">АКТИВНО</span>}
              {raidHere ? <span className="srp-chip srp-chip--bad">ПОД АТАКОЙ · {countdown(raidHere.arrivesAt - now)}</span> : null}
              <span className="srp-chip">БАЗА {getBaseSunEfficiencyPercent(selected.system)}%</span>
              <span className="srp-chip">ПОБЕД НАД НИМ {sun.successfulRaids}</span>
            </div>
            <SunBrightnessBar brightness={projection.brightness} baseEfficiency={projection.baseEfficiency} />
            <p className="srp-hint">
              {projection.frozen
                ? `При яркости ${SUN_RAID_CONFIG.frozenThreshold}% Солнце замерзает. +${SUN_RAID_CONFIG.recoverStepPercent}% каждый шаг; следующий через ${countdown((projection.nextStepAt ?? now) - now)}.`
                : projection.recovering
                  ? `Восстановление до ${projection.baseEfficiency}%: следующий шаг через ${countdown((projection.nextStepAt ?? now) - now)}.`
                  : `Победа атакующих: −${SUN_RAID_CONFIG.brightnessLossPerWin}% яркости и шанс ${Math.round(SUN_RAID_CONFIG.crystalChance * 100)}% на кристалл. Энергия солнечных станций системы падает вместе с яркостью.`}
            </p>
          </div>
        </div>

        <div className="srp-cards">
          <article className="srp-card">
            <header><img src={bombardmentIcon} alt="" /><span><b>Командный рейд</b><small>Командование → Операции · союз · 3 ч туда и 3 ч обратно</small></span></header>
            <ul className="srp-rules">
              <li>Лимит стороны — {SUN_RAID_CONFIG.populationCapPerSide.toLocaleString('ru-RU')} населения</li>
              <li>Технологии и уровни кораблей — лучшие среди участников стороны</li>
              <li>Один рейд союза одновременно</li>
            </ul>
            {raidBlock ? <p className="srp-block-reason" role="note">{raidBlock}</p> : null}
            <button type="button" className="opsA-btn opsA-btn--primary srp-cta" disabled={Boolean(raidBlock)} onClick={() => setLaunch({ kind: 'attack' })} data-qa-sun-attack>ОБЪЯВИТЬ РЕЙД</button>
          </article>
          <article className="srp-card">
            <header><img src={sunSupportIcon} alt="" /><span><b>Поддержка солнца</b><small>«Флоты» · любой владелец планеты в галактике, союз не нужен</small></span></header>
            {raidHere ? (
              <p className="srp-raid-line"><b>[{raidHere.allianceTag}] {raidHere.initiatorName}</b> · атакующих {selectRaidSides(state, raidHere.id).attackers.population.toLocaleString('ru-RU')} · защитников {selectRaidSides(state, raidHere.id).defenders.population.toLocaleString('ru-RU')} населения</p>
            ) : <p className="srp-raid-line">Нейтральной стражи нет: Солнце без защитников достаётся атакующим.</p>}
            {supportBlock ? <p className="srp-block-reason" role="note">{supportBlock}</p> : null}
            <button type="button" className="opsA-btn srp-cta" disabled={Boolean(supportBlock)} onClick={() => raidHere && onSendSupport(raidHere)} data-qa-sun-support>ОТПРАВИТЬ ЗАЩИТУ · ФЛОТЫ</button>
            <div className="srp-debris" data-qa-sun-debris={sunDebris}>
              <span><small>ОБЛОМКИ У СОЛНЦА [{selected.galaxy}:{selected.system}:0]</small><b>{sunDebris.toLocaleString('ru-RU')}</b></span>
              <button type="button" className="opsA-btn opsA-btn--small" disabled={sunDebris <= 0} onClick={() => onRecycleDebris(selected)} title="Переработчики летят к Солнцу. Астероид на позиции 1 этой системы тоже собирает эти обломки." data-qa-sun-recycle>ПЕРЕРАБОТАТЬ</button>
            </div>
          </article>
          <article className="srp-card srp-card--crystals">
            <header><span><b>Кристаллы {role.allianceTag ? `союза [${role.allianceTag}]` : 'командира'}</b><small>{crystals.length} из 4 · не ресурс: не грузятся и не торгуются</small></span></header>
            <CrystalSet owned={crystals} size={40} />
            <div className="srp-crystal-names">
              {(Object.keys(SOLAR_CRYSTALS) as Array<keyof typeof SOLAR_CRYSTALS>).map((id) => <span key={id} className={crystals.includes(id) ? 'is-on' : ''}>{SOLAR_CRYSTALS[id].short}</span>)}
            </div>
            <button type="button" className="opsA-btn srp-cta" onClick={onOpenGate} data-qa-open-gate>ВРАТА · ВОЕННАЯ ЗОНА</button>
          </article>
        </div>

        <div className="srp-bottom">
          <section className="srp-log">
            <header><small>ЖУРНАЛ СОЛНЦ</small></header>
            {latestResult?.result ? <ResultLine raid={latestResult} onReport={onOpenReport} /> : null}
            {events.length ? <ul>{events.map((event) => <EventRow key={event.id} event={event} />)}</ul> : <p className="srp-empty">Событий пока нет.</p>}
          </section>
          {mode === 'test' ? (
            <section className="srp-test" data-qa-sun-test-tools>
              <header><small>TEST MODE · СЦЕНАРИИ</small></header>
              <div>
                <button type="button" className="opsA-btn opsA-btn--small" onClick={() => onCommit(testBot01RaidSun(state, selected.galaxy, selected.system, options))} data-qa-test="bot01-raid">Бот 01: рейд на это Солнце</button>
                <button type="button" className="opsA-btn opsA-btn--small" disabled={!raidHere || Boolean(ownIncoming)} onClick={() => raidHere && onCommit(testIraSupportSun(state, raidHere.id, options))} data-qa-test="ira-support">Ира Вель: защита</button>
                <button type="button" className="opsA-btn opsA-btn--small" disabled={!raidHere || !ownIncoming} onClick={() => raidHere && onCommit(testBot01DefendSun(state, raidHere.id, options))} data-qa-test="bot01-defend">Бот 01: защита цели</button>
                <button type="button" className="opsA-btn opsA-btn--small" disabled={!raidHere || !ownIncoming} onClick={() => raidHere && onCommit(testIraJoinRaid(state, raidHere.id, options))} data-qa-test="ira-join">Ира Вель: в рейд</button>
                <button type="button" className="opsA-btn opsA-btn--small" disabled={crystals.length >= 4} onClick={() => onCommit(testGrantCrystal(state, options))} data-qa-test="grant-crystal">Выдать кристалл</button>
                {onTestGateAssault ? <button type="button" className="opsA-btn opsA-btn--small" onClick={onTestGateAssault} data-qa-test="gate-assault">Бот 01: штурм Врат</button> : null}
              </div>
            </section>
          ) : null}
        </div>
      </section>

      {launch ? (
        <SunLaunchDialog
          state={state}
          now={now}
          options={options}
          kind={launch.kind}
          raid={null}
          galaxy={selected.galaxy}
          system={selected.system}
          onClose={() => setLaunch(null)}
          onSubmit={(originPlanetId, ships, commanders) => {
            const result = launchSunRaid(state, { galaxy: selected.galaxy, system: selected.system, originPlanetId, ships, commanders, requestId: `sun-raid-${selected.galaxy}-${selected.system}-${Date.now()}` }, { ...options, now: Date.now() });
            onCommit(result);
            if (result.ok) setLaunch(null);
            return result.ok ? null : result.error;
          }}
        />
      ) : null}
    </div>
  );
}

function RaidRow({ raid, now, onSelect, onReport }: { raid: SunRaidRecord; now: number; onSelect: () => void; onReport: (id: string) => void }) {
  const result = raid.result;
  return (
    <div className={`srp-raid ${raid.status === 'incoming' ? 'is-live' : result?.winner === 'attacker' ? 'is-won' : 'is-lost'}`} data-qa-own-raid={raid.id}>
      <button type="button" onClick={onSelect}>
        <b>Солнце {formatSun(raid.galaxy, raid.system)}</b>
        <small>{raid.status === 'incoming' ? `В пути · бой через ${countdown(raid.arrivesAt - now)}` : result?.winner === 'attacker' ? `Победа · ${result.brightnessBefore}% → ${result.brightnessAfter}%` : 'Рейд отражён'}{raid.closedAt === undefined && raid.status === 'resolved' ? ' · флот возвращается' : ''}</small>
      </button>
      {result?.reportId ? <button type="button" className="opsA-chip opsA-chip--link" onClick={() => onReport(result.reportId!)}>ОТЧЁТ</button> : null}
    </div>
  );
}

function ResultLine({ raid, onReport }: { raid: SunRaidRecord; onReport: (id: string) => void }) {
  const result = raid.result!;
  const roll = result.crystalRoll;
  return (
    <div className={`srp-result ${result.winner === 'attacker' ? 'is-won' : 'is-lost'}`} data-qa-sun-result={raid.id}>
      <b>{result.winner === 'attacker' ? `Рейд [${raid.allianceTag}] успешен` : `Рейд [${raid.allianceTag}] отражён`}</b>
      <span>Яркость {result.brightnessBefore}% → {result.brightnessAfter}%{result.frozen ? ' · заморожено' : ''}</span>
      <span>Кристалл: {roll ? roll.skipped ? 'все собраны' : roll.success && roll.crystal ? `выпал — ${SOLAR_CRYSTALS[roll.crystal].name}` : `не выпал (шанс ${Math.round(roll.chance * 100)}%)` : '—'}</span>
      {result.reportId ? <button type="button" className="opsA-chip opsA-chip--link" onClick={() => onReport(result.reportId!)}>БОЕВОЙ ОТЧЁТ</button> : null}
    </div>
  );
}

function EventRow({ event }: { event: SunRaidEvent }) {
  return (
    <li className={`srp-event srp-event--${event.kind}`}>
      <time>{new Date(event.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
      <span>{event.text}</span>
    </li>
  );
}

type LaunchProps = {
  state: SaveState;
  now: number;
  options: { now: number; mode: RuntimeMode; testTimeScale: number };
  kind: 'attack' | 'support';
  raid: SunRaidRecord | null;
  galaxy: number;
  system: number;
  onClose: () => void;
  onSubmit: (originPlanetId: string, ships: Partial<Record<ShipId, number>>, commanders: Partial<Record<CommanderId, number>>) => string | null;
};

/** Fleet picker with the live population counter X / 225 000 and the blocking reason. */
function SunLaunchDialog({ state, now, options, kind, raid, galaxy, system, onClose, onSubmit }: LaunchProps) {
  const planetIds = Object.keys(state.planets);
  const [originPlanetId, setOriginPlanetId] = useState(state.currentPlanetId);
  const [ships, setShips] = useState<Partial<Record<ShipId, number>>>({});
  const [commanders, setCommanders] = useState<Partial<Record<CommanderId, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const factionId = state.profile.factionId;
  // Only combat hulls fly to a Sun: probes, colonizers, cargo and recyclers stay home.
  const catalog = useMemo(() => getFactionShipCatalog(factionId).filter((entity) => isSunCombatHull(entity.id as ShipId)), [factionId]);
  const fleet = getAvailableFleetForPlanet(state, originPlanetId);
  const available = fleet.ships;
  const commanderIds = COMMANDER_IDS.filter((id) => (fleet.commanders[id] ?? 0) > 0);
  const preview = previewSunLaunch(state, { kind, galaxy, system, raidId: raid?.id, originPlanetId, ships, commanders }, options);
  const used = preview.committed + preview.population;
  const percent = Math.min(100, (used / preview.cap) * 100);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  useEffect(() => { setShips({}); setCommanders({}); }, [originPlanetId]);

  const popOf = (id: ShipId) => Math.max(1, catalog.find((entity) => entity.id === id)?.population ?? 1);
  /** Most of one hull that still fits under the side cap together with the rest of the selection. */
  const maxFor = (id: ShipId) => {
    const others = sunFleetPopulation({ ...ships, [id]: 0 }, factionId, commanders);
    const room = Math.max(0, preview.remaining - others);
    return Math.max(0, Math.min(available[id] ?? 0, Math.floor(room / popOf(id))));
  };
  const setCount = (id: ShipId, value: number) => setShips((current) => ({ ...current, [id]: Math.max(0, Math.min(maxFor(id), Math.floor(value || 0))) }));
  const fillToCap = () => {
    let left = preview.remaining - sunFleetPopulation({}, factionId, commanders);
    const next: Partial<Record<ShipId, number>> = {};
    for (const entity of [...catalog].sort((a, b) => b.population - a.population)) {
      const count = Math.min(available[entity.id as ShipId] ?? 0, Math.floor(left / Math.max(1, entity.population)));
      if (count > 0) { next[entity.id as ShipId] = count; left -= count * entity.population; }
    }
    setShips(next);
  };

  // Portaled to the stage root: above the header, still on the scaled 1920×1080 stage.
  const host = document.querySelector('.stage') ?? document.body;
  return createPortal(
    <div className="opsA srp-portal"><div className="srp-modal" role="presentation" onMouseDown={onClose}>
      <section className="srp-launch" role="dialog" aria-modal="true" aria-label={kind === 'attack' ? 'Объявить рейд' : 'Отправить защиту'} onMouseDown={(event) => event.stopPropagation()} data-qa-sun-launch={kind}>
        <header>
          <img src={kind === 'attack' ? bombardmentIcon : sunSupportIcon} alt="" />
          <div><small>{kind === 'attack' ? 'КОМАНДНЫЙ РЕЙД' : 'ПОДДЕРЖКА СОЛНЦА'}</small><h2>Солнце {formatSun(galaxy, system)}</h2></div>
          <button ref={closeRef} type="button" className="srp-close" data-asterion-close aria-label="Закрыть" onClick={onClose}>×</button>
        </header>
        <div className="srp-launch__origin">
          <label>
            <small>ПЛАНЕТА ОТПРАВЛЕНИЯ</small>
            <select value={originPlanetId} onChange={(event) => setOriginPlanetId(event.target.value)}>
              {planetIds.map((id) => {
                const planet = state.planets[id]!;
                return <option key={id} value={id}>{planet.name} [{planet.universeGalaxy ?? 1}:{planet.universeSystem ?? 1}:{planet.universePosition ?? 1}]</option>;
              })}
            </select>
          </label>
          <button type="button" className="opsA-btn opsA-btn--small" onClick={fillToCap}>ЗАПОЛНИТЬ ДО ЛИМИТА</button>
          <button type="button" className="opsA-btn opsA-btn--small" onClick={() => setShips({})}>СБРОСИТЬ</button>
        </div>
        <ul className="srp-ships">
          {catalog.map((entity) => {
            const id = entity.id as ShipId;
            const have = available[id] ?? 0;
            const count = ships[id] ?? 0;
            return (
              <li key={id} className={have ? '' : 'is-empty'}>
                <img src={entity.art} alt="" />
                <span className="srp-ship-copy">
                  <b>{entity.name}</b><small>есть {have.toLocaleString('ru-RU')} · {entity.population} нас.</small>
                  <AmountSlider compact value={count} max={Math.max(count, maxFor(id))} onChange={(value) => setCount(id, value)} label={`${entity.name}: количество`} qa={`sun-ship-${id}`} />
                </span>
                <input type="number" min={0} max={have} value={count || ''} placeholder="0" disabled={!have} onChange={(event) => setCount(id, Number(event.target.value))} aria-label={`${entity.name}: количество`} />
                <button type="button" className="opsA-btn opsA-btn--small" disabled={!have} onClick={() => setCount(id, have)} title="Максимум, который помещается в лимит стороны">МАКС</button>
              </li>
            );
          })}
        </ul>
        {commanderIds.length ? (
          <div className="srp-commanders" data-qa-sun-commanders>
            <small>КОМАНДИРСКИЕ КОРАБЛИ · бой ведёт командир наивысшего уровня стороны</small>
            <div>
              {commanderIds.map((id) => {
                const entity = getFactionCombatEntity(factionId, id);
                const on = Boolean(commanders[id]);
                return (
                  <button key={id} type="button" className={`srp-commander${on ? ' is-on' : ''}`} aria-pressed={on}
                    onClick={() => setCommanders((current) => { const next = { ...current }; if (next[id]) delete next[id]; else next[id] = 1; return next; })}
                    data-qa-sun-commander={id}>
                    {entity.art ? <img src={entity.art} alt="" /> : null}
                    <span><b>{entity.name}</b><small>{entity.population} нас.</small></span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="srp-cap" data-qa-sun-population={`${used}/${preview.cap}`}>
          <div className="srp-cap__head">
            <small>НАСЕЛЕНИЕ СТОРОНЫ{preview.committed ? ` · уже в пути ${preview.committed.toLocaleString('ru-RU')}` : ''}</small>
            <b className={used > preview.cap ? 'is-over' : ''}>{used.toLocaleString('ru-RU')} / {preview.cap.toLocaleString('ru-RU')}</b>
          </div>
          <i><span style={{ width: `${percent}%` }} className={used > preview.cap ? 'is-over' : ''} /></i>
        </div>
        <dl className="srp-launch__facts">
          <div><dt>В пути</dt><dd>{preview.oneWayMs ? countdown(preview.oneWayMs) : '—'}</dd></div>
          <div><dt>Прибытие</dt><dd>{preview.oneWayMs ? new Date(preview.arrivesAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}</dd></div>
          <div><dt>Газ</dt><dd>{preview.gasCost.toLocaleString('ru-RU')}</dd></div>
          <div><dt>{kind === 'attack' ? 'Бой' : 'Атака прибудет'}</dt><dd>{kind === 'attack' ? 'по прибытию' : raid ? countdown(raid.arrivesAt - now) : '—'}</dd></div>
        </dl>
        {(error ?? preview.error) && preview.population > 0 ? <p className="srp-block-reason" role="alert">{error ?? preview.error}</p> : null}
        <footer>
          <button type="button" className="opsA-btn" onClick={onClose}>ОТМЕНА</button>
          <button type="button" className="opsA-btn opsA-btn--primary" disabled={Boolean(preview.error) || preview.population <= 0} onClick={() => setError(onSubmit(originPlanetId, ships, commanders))} data-qa-sun-launch-confirm>
            {kind === 'attack' ? 'ОБЪЯВИТЬ РЕЙД' : 'ОТПРАВИТЬ ЗАЩИТУ'} · {sunFleetPopulation(ships, factionId, commanders).toLocaleString('ru-RU')}
          </button>
        </footer>
      </section>
    </div></div>,
    host,
  );
}
