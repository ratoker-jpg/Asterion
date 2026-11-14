import type { ReactNode } from 'react';
import { REPORT_ICONS } from '../ui-icons.ts';

import { FactionGeneralPortrait } from '../FactionGeneralPortrait.tsx';
import { EmblemGlyph } from '../command/EmblemGlyph.tsx';
import { ResourceIcon } from '../resources/ResourceIcon.tsx';
import pirateWarlordArt from '../../../assets/source/characters/pirates/pirate_warlord.png';
import { getFactionCombatEntity } from '../../domain/combat/faction-catalog.ts';
import type { CommandState } from '../../domain/command/types.ts';
import type { ExplorationState } from '../../domain/exploration/ledger.ts';
import { formatReportCoordinate, letterSenderPortrait, roundsLabel, type ReportSheet } from '../../domain/reports/sheet.ts';
import type {
  ReportCategory,
  ReportFact,
  ReportItem,
  ReportPlace,
  ReportPortrait,
  ReportResourceGroup,
  ReportSide,
  ReportUnit,
  ReportUnitGroup,
} from '../../domain/reports/types.ts';
import type { UniverseCoordinate } from '../../domain/universe/types.ts';
import type { BattleReport } from '../../domain/combat/report.ts';
import {
  battleBalance,
  formatClock,
  formatShortAmount,
  formatSignedAmount,
  extractionYield,
  RISK_RATIO_CAP,
  durationLabel,
  spyRaid,
  timesLabel,
  transportsLabel,
  toneOf,
  type HeadlineContext,
} from '../../domain/reports/headline.ts';
import { captionFact } from '../../domain/reports/caption.ts';
import type { ReportStatusTone } from '../../domain/reports/types.ts';
import { getPiratePlanetArt } from '../../pirate-planet-art.ts';
import { EXPLORATION_ARTS } from '../../exploration-art.ts';
import { MISSION_BANNERS } from '../ui-art.ts';
import { ACTION_ART, type ActionArtId } from '../actions/action-art.ts';

const numberFormat = new Intl.NumberFormat('ru-RU');
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export type UniverseTarget = { coordinate: UniverseCoordinate; planetId?: string; ownerId?: string };

type OpenPlace = (place: ReportPlace) => void;

const GLYPH_KEY: Record<ReportCategory, keyof typeof REPORT_ICONS> = {
  personal: 'profile', system: 'system', battle: 'battle', command: 'command', arena: 'arena',
  flights: 'flights', alliances: 'alliances', achievements: 'achievements',
};

export function ReportGlyph({ kind }: { kind: ReportCategory }) {
  return <img className="reports-glyph-image" src={REPORT_ICONS[GLYPH_KEY[kind]]} alt="" aria-hidden="true" draggable={false} />;
}

export function formatReportDate(timestamp?: string) {
  return timestamp ? dateTimeFormat.format(new Date(timestamp)) : 'Сейчас';
}

/** Same deterministic variant→art mapping as the Universe and Operations screens. */
function explorationArt(sheet: ReportSheet, exploration?: ExplorationState): string | null {
  const coordinate = sheet.place?.coordinate;
  if (!exploration || !coordinate || (sheet.kind !== 'exploration-recon' && sheet.kind !== 'expedition')) return null;
  const contact = Object.values(exploration.contacts)
    .filter((entry) => entry.coordinate.galaxy === coordinate.galaxy && entry.coordinate.system === coordinate.system && entry.coordinate.position === coordinate.position)
    .sort((a, b) => b.appearedAt - a.appearedAt)[0];
  if (!contact) return null;
  const arts = EXPLORATION_ARTS[contact.kind];
  return arts[contact.kind === 'anomaly' ? contact.variant - 1 : contact.variant + 2] ?? arts[0] ?? null;
}

/** The picture of the report in the list and in the header. */
export function ReportArtwork({ item, command }: { item: ReportItem; command?: CommandState }) {
  if (item.letter) return <Portrait portrait={letterSenderPortrait(item.letter.sender)} command={command} />;
  if (item.spyReport) return <img src={getFactionCombatEntity(item.spyReport.targetRaceId, 'spy-probe').art} alt="" aria-hidden="true" draggable={false} />;
  if (item.pirateReconReport) {
    const cycle = item.pirateReconReport.contactCycleKey.split(':');
    return <img src={getPiratePlanetArt(Number(cycle[2]), Number(cycle[3]))} alt="" aria-hidden="true" draggable={false} />;
  }
  const action = actionArtOf(item);
  if (action) return <img className="reports-action-art" src={ACTION_ART[action]} alt="" aria-hidden="true" draggable={false} />;
  return <ReportGlyph kind={item.category} />;
}

/** The round mission picture of a report in the list (owner's action art set). */
function actionArtOf(item: ReportItem): ActionArtId | null {
  if (item.id.startsWith('exploration-recon:')) return 'probe-explore';
  if (item.id.startsWith('exploration-return:')) return 'expedition';
  if (item.spyHunterNotice) return 'espionage';
  switch (item.source) {
    case 'recycling': return 'recycle';
    case 'gas-extraction': return 'gas';
    case 'combat': case 'operations': case 'command': return 'attack';
    case 'pirate-mission': return 'pirate-scout';
    case 'overpopulation': return 'colonize';
    case 'flights': return 'transport';
    case 'exploration': return 'expedition';
    default: return null;
  }
}

function PlaceLink({ place, onOpen }: { place: ReportPlace; onOpen?: OpenPlace }) {
  if (!place.coordinate) return place.name ? <span className="reports-sheet-place__name">{place.name}</span> : null;
  const text = formatReportCoordinate(place.coordinate);
  return <>
    {place.name ? <span className="reports-sheet-place__name">{place.name}</span> : null}
    <button type="button" className="reports-v3-coord" disabled={!onOpen} aria-label={`${place.name ? `${place.name} ` : ''}${text}: открыть на карте`} onClick={() => onOpen?.(place)}>{text}{onOpen ? <span aria-hidden="true"> ↗</span> : null}</button>
  </>;
}

function Portrait({ portrait, command }: { portrait?: ReportPortrait; command?: CommandState }) {
  if (!portrait) return <span className="reports-sheet-portrait reports-sheet-portrait--empty" aria-hidden="true" />;
  if (portrait.kind === 'pirate') return <span className="reports-sheet-portrait"><span className="faction-general-portrait" data-faction="pirates"><img src={pirateWarlordArt} alt="" /></span></span>;
  if (portrait.kind === 'faction') return <span className="reports-sheet-portrait"><FactionGeneralPortrait factionId={portrait.factionId} /></span>;
  if (portrait.kind === 'art') return <span className="reports-sheet-portrait"><img src={portrait.src} alt="" /></span>;
  if (portrait.kind === 'crest') {
    const alliance = command?.alliances.find((candidate) => candidate.id === portrait.allianceId);
    return <span className="reports-sheet-portrait reports-sheet-portrait--crest">{alliance ? <EmblemGlyph emblem={alliance.emblem} /> : <ReportGlyph kind="alliances" />}</span>;
  }
  return <span className="reports-sheet-portrait reports-sheet-portrait--initial" aria-hidden="true">{portrait.text.toLocaleUpperCase('ru-RU')}</span>;
}

function Block({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return <section className={`reports-sheet-block reports-sheet-block--${id}`} data-report-block={id} aria-label={title}>
    <header className="reports-sheet-block__head"><h3>{title}</h3>{aside ? <span>{aside}</span> : null}</header>
    {children}
  </section>;
}

function FactList({ facts, className = '' }: { facts: readonly ReportFact[]; className?: string }) {
  return <dl className={`reports-sheet-facts ${className}`}>{facts.map((fact, index) => <div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
}

function SideCard({ side, command, onOpen }: { side: ReportSide; command?: CommandState; onOpen?: OpenPlace }) {
  const before = side.population?.before;
  const after = side.population?.after;
  return <article className={`reports-battle-side reports-battle-side--${side.key} ${side.outcome ? `reports-battle-side--${side.outcome}` : ''}`}>
    <div className="reports-battle-general-art"><Portrait portrait={side.portrait} command={command} /></div>
    <div className="reports-battle-side-copy">
      <small>{side.role}</small>
      <strong>{side.name}</strong>
      {side.meta ? <span>{side.meta}</span> : null}
      {side.place?.coordinate ? <span className="reports-sheet-side-place"><PlaceLink place={{ ...side.place, name: undefined }} onOpen={onOpen} /></span> : null}
    </div>
    {side.population ? <div className="reports-battle-population"><small>Население</small><span><b>{before == null ? '—' : numberFormat.format(before)}</b><i aria-hidden="true">→</i><b>{after == null ? '—' : numberFormat.format(after)}</b></span></div> : null}
    {before != null && before > 0 && after != null ? <div className="reports-battle-population-bar" role="meter" aria-label="Оставшееся население" aria-valuemin={0} aria-valuemax={before} aria-valuenow={Math.max(0, Math.min(before, after))}><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, after / before))})` }} /></div> : null}
    {side.facts?.length ? <FactList facts={side.facts} className="reports-sheet-facts--side" /> : null}
  </article>;
}

/** Cards are narrow: from a million on the short form («19,7 млн», «1 млрд»), the exact number stays in the label. */
function cardAmount(value: number) {
  // The unit may go to the next line; the digits stay glued by non-breaking spaces.
  return Math.abs(value) >= 1e6 ? formatShortAmount(value).replace(/\u00a0(?=[а-яё])/u, ' ') : numberFormat.format(value);
}

function UnitRow({ unit, qa }: { unit: ReportUnit; qa?: Record<string, string> }) {
  const inspected = Boolean(unit.ability);
  return <article className={`spy-report-entity ${inspected ? 'spy-report-entity--inspected' : ''} ${unit.lost ? 'has-loss' : ''}`} tabIndex={inspected ? 0 : undefined} {...qa}>
    <span className="reports-v2-art reports-v2-entity-art">{unit.art ? <img src={unit.art} alt="" /> : null}</span>
    <div><strong>{unit.name}</strong>{unit.note ? <span>{unit.note}</span> : null}</div>
    {unit.percent != null
      ? <strong className="reports-sheet-unit-share">{unit.percent}%</strong>
      : <span className="reports-sheet-unit-count">
        <b aria-label={unit.count == null ? undefined : numberFormat.format(unit.count)}>{unit.count == null ? '—' : cardAmount(unit.count)}</b>
        {unit.lost ? <em aria-label={`Потеряно ${numberFormat.format(unit.lost)}`}>−{numberFormat.format(unit.lost)}</em> : null}
      </span>}
    {unit.ability ? <span className="spy-entity-tooltip" role="tooltip"><strong>{unit.ability.title}</strong><span>{unit.ability.body}</span><b>Эффект: {unit.ability.effect}</b>{unit.ability.note ? <small>{unit.ability.note}</small> : null}</span> : null}
  </article>;
}

function UnitGroups({ groups, item }: { groups: readonly ReportUnitGroup[]; item: ReportItem }) {
  return <div className="reports-sheet-groups">{groups.map((group) => {
    const occupant = group.key === 'occupant-fleet' && item.occupantRecon;
    const pirate = group.key === 'pirate-composition';
    const groupQa: Record<string, string> = occupant ? { 'data-qa-occupant-report': item.occupantRecon!.ownerId, 'data-quality': item.occupantRecon!.quality } : {};
    return <div className={`reports-sheet-group ${group.tone === 'loss' ? 'reports-sheet-group--loss' : ''} ${occupant ? 'reports-occupant' : ''}`} key={group.key} data-report-group={group.key} {...groupQa}>
      <header><strong>{group.title}</strong>{group.total ? <span>{group.total}</span> : null}</header>
      {group.units.length
        ? <div className={`spy-report-entity-grid ${pirate ? 'pirate-recon-report-list' : ''}`}>{group.units.map((unit) => <UnitRow key={unit.key} unit={unit} qa={
          group.key === 'overpopulation-loss' ? { 'data-qa-overpopulation-loss': unit.key } : pirate ? { 'data-qa-pirate-recon-ship': unit.name } : undefined
        } />)}</div>
        : <p className={`spy-report-empty ${group.hidden ? 'is-hidden' : ''}`} {...(occupant && group.hidden ? { 'data-qa-occupant-fleet-hidden': '' } : {})}>{group.empty ?? 'Нет данных.'}</p>}
    </div>;
  })}</div>;
}

function ResourceGroups({ groups }: { groups: readonly ReportResourceGroup[] }) {
  return <div className="reports-sheet-groups reports-sheet-groups--resources">{groups.map((group) => <div className={`reports-sheet-group reports-sheet-group--${group.tone ?? 'neutral'}`} key={group.key} data-report-group={group.key}>
    <header><strong>{group.title}</strong></header>
    {group.items.length
      ? <div className="reports-sheet-resources">{group.items.map((resource) => <div className={`reports-v3-res reports-v3-res--${resource.kind}`} key={`${resource.kind}-${resource.label}`}>
        <ResourceIcon kind={resource.kind} /><span><small>{resource.label}</small><b aria-label={`${group.tone === 'loss' ? '−' : ''}${numberFormat.format(resource.value)}`}>{group.tone === 'loss' ? '−' : ''}{cardAmount(resource.value)}</b></span>
      </div>)}</div>
      : <p className="spy-report-empty">{group.empty ?? 'Ничего.'}</p>}
  </div>)}</div>;
}

// ------------------------------------------------------------- the art header
// «Сообщения» v3 (owner, 12.11.2026): an art header with the kind and time,
// the title, one line of who / where and one big number with what it means.
// Text over art always sits on the dark left gradient with a shadow.

const BANNER_BY_KIND: Partial<Record<ReportSheet['kind'], string>> = {
  battle: 'attack', spy: 'espionage', 'spy-lost': 'espionage', overpopulation: 'colonize',
  'pirate-recon': 'pirate-recon', 'pirate-absence': 'pirate-elimination', recycling: 'recycle', gas: 'gas',
  'exploration-recon': 'exploration-recon', expedition: 'expedition', flight: 'transport',
};

const BANNER_BY_CATEGORY: Record<ReportCategory, string> = {
  personal: 'aid', system: 'space-flight', battle: 'attack', command: 'sun-support', arena: 'attack',
  flights: 'space-flight', alliances: 'sun-support', achievements: 'space-flight',
};

function letterBanner(kind: string) {
  if (kind === 'bot-joint-strike') return 'attack';
  if (kind === 'bot-help-request') return 'aid';
  if (kind === 'bot-ally-offer' || kind.startsWith('application')) return 'sun-support';
  return 'deployment';
}

export function reportBanner(item: ReportItem, sheet: ReportSheet) {
  const key = item.letter ? letterBanner(item.letter.kind) : BANNER_BY_KIND[sheet.kind] ?? BANNER_BY_CATEGORY[item.category];
  return MISSION_BANNERS[key] ?? MISSION_BANNERS.attack!;
}

/** «23:41» today, «11.11 · 23:41» before. */
export function kickerTime(timestamp?: string, now = Date.now()) {
  if (!timestamp) return 'сейчас';
  const at = new Date(timestamp);
  const today = new Date(now);
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate();
  const day = `${String(at.getDate()).padStart(2, '0')}.${String(at.getMonth() + 1).padStart(2, '0')}`;
  return sameDay ? formatClock(at.getTime()) : `${day} · ${formatClock(at.getTime())}`;
}

export function ReportHero({ banner, kicker, tone, title, subline, value, valueTone, caption, qa }: {
  banner: string;
  kicker: ReactNode;
  tone: ReportStatusTone;
  title: ReactNode;
  subline?: ReactNode;
  value?: ReactNode;
  valueTone?: ReportStatusTone;
  caption?: ReactNode;
  qa?: Record<string, string>;
}) {
  return <header className={`reports-hero reports-hero--${tone}`} data-report-hero {...qa}>
    <img className="reports-hero__art" src={banner} alt="" aria-hidden="true" draggable={false} />
    <div className="reports-hero__copy">
      <small className="reports-hero__kicker">{kicker}</small>
      <h2 data-report-title>{title}</h2>
      {subline ? <p className="reports-hero__subline">{subline}</p> : null}
      {value != null ? <div className="reports-hero__big">
        <b className={`reports-tone--${valueTone ?? tone}`} data-report-value>{value}</b>
        {caption ? <span data-report-caption>{caption}</span> : null}
      </div> : null}
    </div>
  </header>;
}

function minutesLeft(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes < 60) return `осталось ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  return `осталось ${hours} ч ${minutes % 60} мин`;
}

type HeroNumbers = { value?: string; tone?: ReportStatusTone; caption?: ReactNode; subline?: ReactNode };

function gainCaption(groups: readonly ReportResourceGroup[]) {
  const items = groups.filter((group) => group.tone === 'gain').flatMap((group) => group.items).filter((resource) => resource.kind !== 'energy');
  return items.map((resource) => captionFact(resource.label.toLocaleLowerCase('ru-RU'), formatShortAmount(resource.value))).join(' · ');
}

function heroNumbers(item: ReportItem, sheet: ReportSheet, battle: BattleReport | null | undefined, context: HeadlineContext): HeroNumbers {
  if (battle && sheet.kind === 'battle') {
    const balance = battleBalance(battle, context.isMine);
    const lossWord = balance.side === 'attacker' ? 'кораблей' : 'кораблей и обороны';
    const caption = balance.side === 'attacker'
      ? `выгода: унесли ${formatShortAmount(balance.loot)}, потеряли ${lossWord} на ${formatShortAmount(balance.ownLoss)}`
      : `итог: у вас унесли ${formatShortAmount(balance.loot)}, потеряно ${lossWord} на ${formatShortAmount(balance.ownLoss)}`;
    const subline = battle.roundCount
      ? `${roundsLabel(battle.roundCount)}${balance.enemyWiped ? ' · флот противника уничтожен' : ''}`
      : sheet.summary || undefined;
    return { value: formatSignedAmount(balance.profit), tone: toneOf(balance.profit), caption, subline };
  }
  if (item.spyReport) {
    const raid = spyRaid(item.spyReport, context);
    const transports = raid.transports ? ` · ${transportsLabel(raid.transports.count, raid.transports.shipName)}` : '';
    return {
      value: formatShortAmount(raid.lootable),
      tone: 'info',
      caption: raid.lootable > 0 ? `можно унести за один налёт${transports}` : 'забрать за налёт нечего',
    };
  }
  const deadline = item.letter?.deadlineAt;
  if (deadline !== undefined && (context.now === undefined || context.now < deadline)) {
    return { value: `до ${formatClock(deadline)}`, tone: 'warning', caption: context.now !== undefined ? minutesLeft(deadline - context.now) : undefined };
  }
  if (item.overpopulationReport) {
    const removed = item.overpopulationReport.removedShips.reduce((total, loss) => total + loss.count, 0);
    return { value: removed ? formatSignedAmount(-removed) : '0', tone: removed ? 'danger' : 'success', caption: removed ? 'кораблей и спутников потеряно' : 'потерь нет' };
  }
  const gas = sheet.kind === 'gas' ? extractionYield(item) : null;
  if (gas) return { value: gas.gas > 0 ? formatSignedAmount(gas.gas) : '0', tone: gas.gas > 0 ? 'success' : 'neutral', caption: gas.scrap > 0 ? `газа, и ещё ${formatShortAmount(gas.scrap)} обломков` : 'газа' };
  const gain = sheet.resources.filter((group) => group.tone === 'gain');
  if (gain.length) {
    const total = gain.flatMap((group) => group.items).filter((resource) => resource.kind !== 'energy').reduce((sum, resource) => sum + resource.value, 0);
    return { value: total > 0 ? formatSignedAmount(total) : '0', tone: total > 0 ? 'success' : 'neutral', caption: gainCaption(gain) || undefined };
  }
  return { value: sheet.result.label, tone: sheet.result.tone };
}

// ------------------------------------------------------------- body cards

type LossRow = { key: string; name: string; art?: string; before: number | null; lost: number; left: number | null };

function lossRows(groups: readonly ReportUnitGroup[]): LossRow[] {
  return groups.flatMap((group) => group.units).map((unit) => ({
    key: unit.key,
    name: unit.name,
    art: unit.art,
    before: unit.count ?? null,
    lost: unit.lost ?? 0,
    left: unit.count == null ? null : Math.max(0, unit.count - (unit.lost ?? 0)),
  }));
}

function LossTable({ title, rows, qa }: { title: string; rows: readonly LossRow[]; qa: string }) {
  return <div className="reports-loss-table" role="table" aria-label={title} data-report-losses={qa}>
    <div className="reports-loss-table__head" role="row">
      <span role="columnheader">{title}</span><span role="columnheader">было</span><span role="columnheader">потеряно</span><span role="columnheader">осталось</span>
    </div>
    {rows.length ? rows.map((row) => <div className="reports-loss-table__row" role="row" key={row.key}>
      <span role="cell" className="reports-loss-table__name">{row.art ? <img src={row.art} alt="" aria-hidden="true" draggable={false} /> : <i aria-hidden="true" />}<b>{row.name}</b></span>
      <span role="cell">{row.before == null ? '—' : numberFormat.format(row.before)}</span>
      <span role="cell" className={row.lost ? 'is-loss' : ''}>{row.lost ? `−${numberFormat.format(row.lost)}` : '0'}</span>
      <span role="cell">{row.left == null ? '—' : numberFormat.format(row.left)}</span>
    </div>) : <p className="reports-loss-table__empty">Кораблей и обороны не было.</p>}
  </div>;
}

function RiskPlaque({ item, context }: { item: ReportItem; context: HeadlineContext }) {
  const report = item.spyReport!;
  const raid = spyRaid(report, context);
  if (raid.targetAttack == null) return <p className="reports-risk reports-risk--warning" data-report-risk="unknown">Флот и оборона не раскрыты: зонду не хватило уровня шпионажа.</p>;
  if (raid.targetAttack <= 0) return <p className="reports-risk reports-risk--success" data-report-risk="none">Безопасно: на орбите нет боевого флота и обороны.</p>;
  const power = formatShortAmount(raid.targetAttack);
  if (context.ownFleetAttack === 0) return <p className="reports-risk reports-risk--danger" data-report-risk="no-fleet">Опасно: <b>у вас нет боевого флота</b> · огневая мощь цели {power}</p>;
  if (raid.ratio == null) return <p className="reports-risk reports-risk--warning" data-report-risk="unknown">Огневая мощь флота и обороны цели: <b>{power}</b>.</p>;
  if (raid.ratio > RISK_RATIO_CAP) return <p className="reports-risk reports-risk--danger" data-report-risk="danger">Опасно: <b>их флот и оборона во много раз сильнее вашего (×100+)</b> · огневая мощь {power}</p>;
  if (raid.ratio > 1) return <p className="reports-risk reports-risk--danger" data-report-risk="danger">Опасно: <b>их флот и оборона сильнее вашего флота в {timesLabel(raid.ratio)}</b> · огневая мощь {power}</p>;
  if (raid.ratio < 1 / RISK_RATIO_CAP) return <p className="reports-risk reports-risk--success" data-report-risk="safe">Ваш флот <b>во много раз сильнее (×100+)</b> · огневая мощь цели {power}</p>;
  return <p className="reports-risk reports-risk--success" data-report-risk="safe">Ваш флот сильнее в <b>{timesLabel(1 / Math.max(raid.ratio, 1e-9))}</b> · огневая мощь цели {power}</p>;
}

/** «Ваш ближайший флот успеет / не успеет» under a help request (spec r5/mail.html, letters). */
function NearestFleetPlaque({ item, context }: { item: ReportItem; context: HeadlineContext }) {
  const letter = item.letter;
  const coordinate = letter?.place?.coordinate;
  const until = letter?.arriveBy ?? letter?.deadlineAt;
  if (!letter || letter.kind !== 'bot-help-request' || letter.deadlineAt === undefined || !coordinate || until === undefined || !context.nearestFleet || context.now === undefined || context.now >= until) return null;
  const fleet = context.nearestFleet(coordinate);
  const target = letter.place?.name ?? formatReportCoordinate(coordinate);
  if (!fleet) return <p className="reports-risk reports-risk--warning" data-report-nearest="none">У вас нет боевого флота, который может долететь до {target}.</p>;
  const arrival = context.now + fleet.durationMs;
  const inTime = arrival <= until;
  return <p className={`reports-risk reports-risk--${inTime ? 'success' : 'danger'}`} data-report-nearest={inTime ? 'in-time' : 'late'}>
    Ваш ближайший флот {inTime ? 'успеет' : 'не успеет'}: <b>{fleet.planetName} → {target} за {durationLabel(fleet.durationMs)}</b> · будет в {formatClock(arrival)}, нападающие в {formatClock(until)}
  </p>;
}

export function ReportSheetView({ item, sheet, battle, context = {}, exploration, command, onOpenUniverseTarget, onOpenPirateUniverse, lead }: {
  item: ReportItem;
  sheet: ReportSheet;
  /** The raw battle behind a battle report (profit, losses). */
  battle?: BattleReport | null;
  context?: HeadlineContext;
  exploration?: ExplorationState;
  command?: CommandState;
  onOpenUniverseTarget?: (target: UniverseTarget) => void;
  onOpenPirateUniverse?: (coordinate: UniverseCoordinate, contactCycleKey: string) => void;
  /** Extra strip above the header (the Sun raid strip of a Sun battle). */
  lead?: ReactNode;
}) {
  const openPlace: OpenPlace | undefined = onOpenUniverseTarget || onOpenPirateUniverse ? (place) => {
    if (!place.coordinate) return;
    if (place.pirateContactKey && onOpenPirateUniverse) onOpenPirateUniverse(place.coordinate, place.pirateContactKey);
    else onOpenUniverseTarget?.({ coordinate: place.coordinate, planetId: place.planetId, ownerId: place.ownerId });
  } : undefined;
  const legacy = sheet.kind === 'battle' || sheet.kind === 'spy' || sheet.kind === 'overpopulation' || sheet.kind === 'pirate-recon' ? sheet.kind : 'generic';
  const qa: Record<string, string> = {};
  if (item.spyReport) qa['data-qa-spy-report'] = item.spyReport.id;
  if (item.overpopulationReport) qa['data-qa-overpopulation-report'] = item.overpopulationReport.id;
  if (item.pirateReconReport) qa['data-qa-pirate-recon-report'] = item.pirateReconReport.id;
  if (item.letter) qa['data-qa-letter'] = item.letter.kind;
  const art = explorationArt(sheet, exploration);
  const numbers = heroNumbers(item, sheet, battle, context);
  const details = sheet.details.length || sheet.rounds.length || sheet.sections?.length;
  const isBattle = sheet.kind === 'battle';
  const isLetter = sheet.kind === 'letter';
  const mineDefender = isBattle && battle ? battleBalance(battle, context.isMine).side === 'defender' : false;
  const ownKey = mineDefender ? 'defender' : 'attacker';
  const enemyKey = mineDefender ? 'attacker' : 'defender';
  const unitsOf = (side: string) => [...sheet.ships, ...sheet.assets].filter((group) => group.key.endsWith(`-${side}`));
  const spyOwner = item.spyReport ? sheet.sides[0] : undefined;
  const placeLine = sheet.place ? <PlaceLink place={sheet.place} onOpen={openPlace} /> : null;
  const subline = numbers.subline
    ?? (spyOwner ? <>{placeLine}<span className="reports-hero__meta">{spyOwner.name}{spyOwner.meta ? ` · ${spyOwner.meta}` : ''}</span></> : null)
    ?? (isLetter ? <>{sheet.sides[0]?.name}</> : placeLine);
  const sides = isBattle || isLetter ? sheet.sides : sheet.sides.filter((side) => side !== spyOwner);
  const assetsTitle = sheet.assets.length && sheet.assets.every((group) => group.key.startsWith('defense')) ? 'Оборона' : 'Постройки, оборона, науки';
  return (
    <article className={`reports-dossier reports-sheet reports-dossier--${legacy} reports-v2-tone-${sheet.result.tone}`} data-report-sheet={sheet.kind} {...qa}>
      {lead}
      <ReportHero
        banner={art ?? reportBanner(item, sheet)}
        kicker={<>{sheet.typeLabel} · <time data-report-time dateTime={sheet.time}>{kickerTime(sheet.time, context.now)}</time></>}
        tone={sheet.result.tone}
        title={sheet.title}
        subline={subline}
        value={numbers.value}
        valueTone={numbers.tone}
        caption={numbers.caption}
      />
      <span className="reports-sheet-result-hidden" data-report-result hidden>{sheet.result.label}</span>
      <div className="reports-sheet-body">
        {item.spyReport ? <RiskPlaque item={item} context={context} /> : null}
        {sheet.summary && !(isBattle && numbers.subline === sheet.summary) ? <p className={`reports-sheet-summary ${isLetter ? 'reports-sheet-summary--letter' : ''}`}>{sheet.summary}</p> : null}
        {sides.length ? <Block id="sides" title={isLetter ? 'Отправитель' : 'Участники'}>
          <div className={`reports-sheet-sides reports-sheet-sides--${sides.length}`}>
            {sides.map((side, index) => <SideCard key={side.key + index} side={side} command={command} onOpen={openPlace} />)}
          </div>
        </Block> : null}
        {isLetter ? <NearestFleetPlaque item={item} context={context} /> : null}
        {sheet.resources.length ? <Block id="resources" title={isBattle ? 'Добыча и обломки' : 'Ресурсы'}><ResourceGroups groups={sheet.resources} /></Block> : null}
        {isBattle ? <Block id="ships" title="Потери">
          <div className="reports-loss-tables">
            <LossTable title="Ваши потери" rows={lossRows(unitsOf(ownKey))} qa="own" />
            <LossTable title="Потери противника" rows={lossRows(unitsOf(enemyKey))} qa="enemy" />
          </div>
        </Block> : <>
          {sheet.ships.length ? <Block id="ships" title="Корабли"><UnitGroups groups={sheet.ships} item={item} /></Block> : null}
          {sheet.assets.length ? <Block id="assets" title={assetsTitle}><UnitGroups groups={sheet.assets} item={item} /></Block> : null}
        </>}
        {details ? <details className="reports-sheet-details" data-report-block="details">
          <summary><span>Подробности</span>{sheet.rounds.length ? <small>{roundsLabel(sheet.rounds.length)}</small> : null}</summary>
          <div className="reports-sheet-details__body">
            {sheet.details.length ? <FactList facts={sheet.details} /> : null}
            {sheet.sections?.length ? <div className="reports-sheet-sections">{sheet.sections.map((section) => <section key={section.title} className="reports-sheet-section">
              <strong>{section.title}</strong>
              <FactList facts={section.facts} className="reports-sheet-facts--round" />
            </section>)}</div> : null}
            {sheet.rounds.length ? <ol className="reports-sheet-rounds">{sheet.rounds.map((round) => <li key={round.index}>
              <strong>Раунд {round.index}</strong>
              <FactList facts={round.facts} className="reports-sheet-facts--round" />
            </li>)}</ol> : null}
          </div>
        </details> : null}
      </div>
    </article>
  );
}
