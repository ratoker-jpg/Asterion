import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { SunReportStrip } from './ui/sun-raid/SunReportStrip.tsx';
import { BattleReportModal } from './BattleReportsView';
import { FactionGeneralPortrait } from './ui/FactionGeneralPortrait.tsx';
import { EMPTY_ART } from './ui/ui-art.ts';
import { EmblemGlyph } from './ui/command/EmblemGlyph.tsx';
import pirateWarlordArt from '../assets/source/characters/pirates/pirate_warlord.png';
import { asterionAssetIntegrationAssets } from './assets/generated/asterionAssetIntegrationManifest.generated.ts';
import { isAsterionLocalPlayerId, type BattleReport } from './domain/combat/report.ts';
import { createBattleReportViewModel, noCombatVerdict } from './domain/combat/battle-report-view-model.ts';
import type { BattleSideViewModel } from './domain/combat/battle-report-view-model.ts';
import type { CommandState } from './domain/command/types.ts';
import { selectOwnerMembership, toAllianceIdentity } from './domain/command/selectors.ts';
import type { OperationsState } from './domain/operations/types.ts';
import {
  buildReportsFeed,
  filterReportItems,
  findBattleReport,
  getReportCategoryCounts,
  getReportUnreadCounts,
  getVisibleReportItems,
  preservePersistentReportCollections,
} from './domain/reports/adapters.ts';
import {
  deleteAllReports,
  deleteSelectedReports,
  markAllReportsRead,
  markReportRead,
} from './domain/reports/repository.ts';
import type { ReportCategory, ReportFilter, ReportItem, ReportsState } from './domain/reports/types.ts';
import type { PlayerProfileState } from './domain/profile/types.ts';
import { selectPlayerProfileMetrics } from './domain/profile/selectors.ts';
import type { PlayerProfileMetricKey } from './domain/profile/selectors.ts';
import type { OwnerScore } from './domain/rating/types.ts';
import type { RatingPrototypeState } from './domain/rating/fixtures.ts';
import { selectRecordedBattlePointAwards } from './domain/rating/scoring.ts';
import { RUNTIME_RESET_EVENT, type RuntimeMode } from './domain/runtime/mode.ts';
import type { SpyReportSnapshot } from './domain/espionage/types.ts';
import { COMMANDER_ABILITIES, getCommanderPresentedAbility, formatCommanderPresentedEffect, type CommanderId } from './domain/combat/commanders.ts';
import { getFactionCombatEntity } from './domain/combat/faction-catalog.ts';
import { getCombatFactionName } from './domain/combat/factions.ts';
import type { CombatEntityId, ShipId } from './domain/combat/ids.ts';
import type { UniverseCoordinate } from './domain/universe/types.ts';
import type { PirateReconReport } from './domain/pirates/recon-report.ts';
import { PIRATE_BASE_SHIPS } from './domain/pirates/catalog.ts';
import { getPiratePlanetArt } from './pirate-planet-art.ts';
import { EXPLORATION_ARTS } from './exploration-art.ts';
import type { ExplorationState } from './domain/exploration/ledger.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon.tsx';
import './reports.css';
import './reports-v2.css';

const PAGE_SIZE = 7;
const numberFormat = new Intl.NumberFormat('ru-RU');
// Historical recon reports store canonical pirate ship names, not asset paths.
// Resolve presentation art from the same catalog used by pirate combat and the ship UI.
const pirateReconArtByName = new Map(PIRATE_BASE_SHIPS.map(({ name, art }) => [name, art] as const));

type MessageFolderId =
  | 'profile'
  | 'system'
  | 'battle'
  | 'command'
  | 'arena'
  | 'flights'
  | 'alliances'
  | 'achievements';

type MessageFolder = {
  id: Exclude<MessageFolderId, 'profile'>;
  label: string;
  glyph: ReportCategory;
  category?: ReportCategory;
  count: boolean;
  emptyTitle?: string;
  emptyBody?: string;
};

const MESSAGE_FOLDERS: readonly MessageFolder[] = [
  { id: 'system', label: 'Система', glyph: 'system', category: 'system', count: true },
  { id: 'battle', label: 'Доклады', glyph: 'battle', category: 'battle', count: true },
  { id: 'command', label: 'Командные доклады', glyph: 'command', category: 'command', count: true },
  { id: 'arena', label: 'Арена', glyph: 'arena', category: 'arena', count: true },
  { id: 'flights', label: 'Полёты', glyph: 'flights', category: 'flights', count: true },
  { id: 'alliances', label: 'Союзы', glyph: 'alliances', category: 'alliances', count: true },
  { id: 'achievements', label: 'Достижения', glyph: 'achievements', category: 'achievements', count: true },
];

const EMPTY_COPY: Record<ReportCategory, { title: string; body: string }> = {
  system: { title: 'Системных данных пока нет', body: 'Сюда попадут шпионские отчёты, уведомления контрразведки и результаты операций, которые дают новую информацию.' },
  battle: { title: 'Боевых докладов пока нет', body: 'Здесь хранятся реальные боевые отчёты и бои из операций. Симуляции и Арена в этот канал не попадают.' },
  command: { title: 'Командных докладов пока нет', body: 'Здесь будут отчёты об атаках на союзников и результаты атак на Солнце, когда эти события появятся в боевом контуре.' },
  arena: { title: 'Арена — пока пусто', body: 'Отчёты и очки Арены появятся здесь вместе с реализацией самой Арены.' },
  flights: { title: 'Завершённых полётов пока нет', body: 'После подключения реальной отправки флотов сюда будут сохраняться завершённые рейсы, прибытия и возвраты флота на ваши планеты.' },
  alliances: { title: 'Союзных приглашений пока нет', body: 'Здесь появляются доступные совместные операции союза. Из приглашения можно сразу перейти к выбору флота.' },
  achievements: { title: 'Достижения — пока пусто', body: 'Этот канал зарезервирован под будущую систему достижений.' },
};

const FILTER_LABELS: Record<ReportFilter, string> = {
  all: 'ВСЕ',
  unread: 'НЕПРОЧИТАННЫЕ',
  saved: 'СОХРАНЁННЫЕ БОИ',
};

function formatDate(timestamp?: string) {
  if (!timestamp) return 'ТЕКУЩЕЕ';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function formatTime(timestamp?: string) {
  if (!timestamp) return 'СЕЙЧАС';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function withOverpopulationReports(next: ReportsState, previous: ReportsState): ReportsState {
  return preservePersistentReportCollections(next, previous);
}

function ReportGlyph({ kind }: { kind: ReportCategory }) {
  const iconKey: Record<ReportCategory, keyof typeof asterionAssetIntegrationAssets.reportIcons> = {
    system: 'system', battle: 'battle', command: 'command', arena: 'arena',
    flights: 'flights', alliances: 'alliances', achievements: 'achievements',
  };
  return <img className="reports-glyph-image" src={asterionAssetIntegrationAssets.reportIcons[iconKey[kind]]} alt="" aria-hidden="true" draggable={false} />;
}

function ProfileGlyph() {
  return <img className="reports-glyph-image" src={asterionAssetIntegrationAssets.reportIcons.profile} alt="" aria-hidden="true" draggable={false} />;
}

function SearchGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m15.5 15.5 5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function ActionGlyph({ kind }: { kind: 'save' | 'prev' | 'next' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'save') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></svg>;
  if (kind === 'prev') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m15 5-7 7 7 7" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m9 5 7 7-7 7" /></svg>;
}

function StatusBadge({ item }: { item: ReportItem }) {
  return <span className={`reports-status reports-status--${item.statusTone}`}>{item.statusLabel}</span>;
}

function ReportArtwork({ item }: { item: ReportItem }) {
  if (item.spyReport) return <img src={getFactionCombatEntity(item.spyReport.targetRaceId, 'spy-probe').art} alt="" aria-hidden="true" draggable={false} />;
  if (item.pirateReconReport) {
    const cycle = item.pirateReconReport.contactCycleKey.split(':');
    return <img src={getPiratePlanetArt(Number(cycle[2]), Number(cycle[3]))} alt="" aria-hidden="true" draggable={false} />;
  }
  return <ReportGlyph kind={item.category} />;
}

function DossierHeading({ item, art }: { item: ReportItem; art?: ReactNode }) {
  return <div className="reports-dossier-heading">
    <div className="reports-dossier-heading__icon reports-v2-art">{art ?? <ReportArtwork item={item} />}</div>
    <div className="reports-dossier-heading__copy"><div className="reports-dossier-badges"><small>{item.typeLabel}</small><StatusBadge item={item} /></div><h2>{item.title}</h2><p>{item.preview}</p></div>
    <div className="reports-dossier-heading__status"><small>ПОЛУЧЕНО</small><time>{formatDate(item.timestamp)}</time></div>
  </div>;
}

function ReportListItem({ item, active, read, saved, selected, onOpen, onSelect }: {
  item: ReportItem;
  active: boolean;
  read: boolean;
  saved: boolean;
  selected: boolean;
  onOpen: () => void;
  onSelect: (checked: boolean) => void;
}) {
  return (
    <article className={`reports-list-item reports-v2-tone-${item.statusTone} ${active ? 'active' : ''} ${read ? 'read' : 'unread'} ${selected ? 'selected' : ''}`} data-report-item-id={item.id} data-report-kind={item.spyReport ? "spy" : item.pirateReconReport ? "pirate-recon" : item.overpopulationReport ? "overpopulation" : item.source} data-pirate-recon-outcome={item.pirateReconReport?.outcome}>
      <label className="reports-list-check">
        <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Выбрать сообщение: ${item.title}`} />
        <span aria-hidden="true" />
      </label>
      <button type="button" className="reports-list-open" onClick={onOpen} aria-current={active ? 'true' : undefined} aria-label={`Открыть сообщение: ${item.title}`}>
        <span className={`reports-list-icon reports-list-icon--${item.category} reports-v2-art`}><ReportArtwork item={item} /></span>
        <span className="reports-list-copy"><small>{item.typeLabel}</small><strong>{item.title}</strong><em>{item.preview}</em></span>
        <span className="reports-list-meta"><time>{formatTime(item.timestamp)}</time>{saved ? <i className="reports-favorite-dot" aria-label="Бой сохранён" /> : null}{!read ? <b className="reports-unread-dot" aria-label="Непрочитано" /> : null}</span>
      </button>
    </article>
  );
}

type ResourceKind = 'metal' | 'minerals' | 'gas' | 'debris' | 'energy';
const RESOURCE_WORDS: readonly [RegExp, ResourceKind][] = [
  [/металл/i, 'metal'], [/минерал/i, 'minerals'], [/газ/i, 'gas'], [/облом/i, 'debris'], [/энерг/i, 'energy'],
];
const COORDINATE_PATTERN = /\[(\d+):(\d+):(\d+)\]|planet-(\d+)-(\d+)-(\d+)/i;
// Internal identifiers (flight ids, contact keys, epoch stamps) are never player-facing.
const TECHNICAL_VALUE = /flight-|recon:|unique:|anomaly:|contact-|\d{9,}/i;
const TECHNICAL_LABEL = /вылет зонда|идентификатор|^id\b|остатки зависят/i;

function parseCoordinate(value: string): UniverseCoordinate | null {
  const match = COORDINATE_PATTERN.exec(value);
  if (!match) return null;
  const [galaxy, system, position] = (match[1] ? match.slice(1, 4) : match.slice(4, 7)).map(Number);
  return { galaxy: galaxy!, system: system!, position: position! };
}

function resourceKindOf(label: string): ResourceKind | null {
  return RESOURCE_WORDS.find(([pattern]) => pattern.test(label))?.[1] ?? null;
}

function numericValue(value: string): number | null {
  const digits = value.replace(/[\s ]/g, '').match(/^[+−-]?\d+([.,]\d+)?$/);
  return digits ? Number(digits[0].replace('−', '-').replace(',', '.')) : null;
}

function romanRisk(value: string): number | null {
  const roman = ['I', 'II', 'III', 'IV', 'V'].indexOf(value.trim().split(/\s|\//)[0]!.toUpperCase());
  if (roman >= 0) return roman + 1;
  const n = Number.parseInt(value, 10);
  return n >= 1 && n <= 5 ? n : null;
}

/** Same deterministic variant→art mapping as the Universe and Operations screens. */
function explorationArtFor(item: ReportItem, exploration?: ExplorationState): string | null {
  if (!exploration || (item.source !== 'exploration' && !/исследован|экспедиц|аномал/i.test(item.typeLabel))) return null;
  const coordinate = item.coordinates.map(parseCoordinate).find(Boolean)
    ?? item.details.map((detail) => parseCoordinate(detail.value)).find(Boolean);
  if (!coordinate) return null;
  const contact = Object.values(exploration.contacts)
    .filter((entry) => entry.coordinate.galaxy === coordinate.galaxy && entry.coordinate.system === coordinate.system && entry.coordinate.position === coordinate.position)
    .sort((a, b) => b.appearedAt - a.appearedAt)[0];
  if (!contact) return null;
  const arts = EXPLORATION_ARTS[contact.kind];
  return arts[contact.kind === 'anomaly' ? contact.variant - 1 : contact.variant + 2] ?? arts[0] ?? null;
}

function CoordinateLink({ value, onOpen }: { value: string; onOpen?: (coordinate: UniverseCoordinate) => void }) {
  const coordinate = parseCoordinate(value);
  if (!coordinate) return <>{value}</>;
  const text = `[${coordinate.galaxy}:${coordinate.system}:${coordinate.position}]`;
  const name = value.replace(COORDINATE_PATTERN, '').trim();
  return <>
    {name ? <span className="reports-v3-route-name">{name}</span> : null}
    <button type="button" className="reports-v3-coord" disabled={!onOpen} title="Открыть во Вселенной" onClick={() => onOpen?.(coordinate)}>{text} ↗</button>
  </>;
}

function GenericDossier({ item, exploration, onOpenUniverseTarget }: {
  item: ReportItem;
  exploration?: ExplorationState;
  onOpenUniverseTarget?: (target: { coordinate: UniverseCoordinate }) => void;
}) {
  const openCoordinate = onOpenUniverseTarget ? (coordinate: UniverseCoordinate) => onOpenUniverseTarget({ coordinate }) : undefined;
  const route: { label: string; value: string }[] = [];
  const resources: { kind: ResourceKind; label: string; value: string }[] = [];
  const losses: { kind: ResourceKind; label: string; value: string }[] = [];
  const facts: { label: string; value: string }[] = [];
  const notes: string[] = [];
  let risk: number | null = null;
  let tokens: string | null = null;

  for (const detail of item.details) {
    const { label, value } = detail;
    if (!value || TECHNICAL_LABEL.test(label) || TECHNICAL_VALUE.test(value)) continue;
    if (/риск/i.test(label)) { risk = romanRisk(value); if (risk) continue; }
    if (/жетон/i.test(label)) { tokens = value; continue; }
    if (parseCoordinate(value) || /^(цель|координаты|локация|планета|источник)/i.test(label)) { route.push(detail); continue; }
    const kind = resourceKindOf(label);
    const amount = numericValue(value);
    if (kind && amount !== null) {
      const caption = label.replace(/^[^·]*·\s*/, '').trim();
      if (/сгорел|потерян|сожжен/i.test(label)) { if (amount !== 0) losses.push({ kind, label: caption, value }); continue; }
      resources.push({ kind, label: caption === label ? label : caption, value });
      continue;
    }
    if (value.length > 34) { notes.push(`${label}: ${value}`); continue; }
    facts.push(detail);
  }

  const art = explorationArtFor(item, exploration);
  return (
    <div className={`reports-dossier reports-dossier--generic reports-v3 reports-v2-tone-${item.statusTone}`}>
      <DossierHeading item={item} art={art ? <img src={art} alt="" aria-hidden="true" draggable={false} /> : undefined} />
      {route.length ? <section className="reports-v3-route" aria-label="Маршрут">
        {route.map((entry, index) => <div className="reports-v3-route-step" key={`${entry.label}-${index}`}>
          <small>{entry.label}</small><strong><CoordinateLink value={entry.value} onOpen={openCoordinate} /></strong>
        </div>)}
      </section> : null}
      {resources.length ? <section className="reports-v3-section">
        <header><strong>РЕСУРСЫ</strong></header>
        <div className="reports-v3-resources">
          {resources.map((entry) => <div className={`reports-v3-res reports-v3-res--${entry.kind}`} key={`${entry.kind}-${entry.label}`}>
            <ResourceIcon kind={entry.kind} /><span><small>{entry.label}</small><b>{entry.value}</b></span>
          </div>)}
        </div>
      </section> : null}
      {losses.length ? <section className="reports-v3-section reports-v3-section--loss">
        <header><strong>ПОТЕРЯНО ПРИ ПЕРЕПОЛНЕНИИ ТРЮМА</strong></header>
        <div className="reports-v3-resources">
          {losses.map((entry) => <div className={`reports-v3-res reports-v3-res--${entry.kind}`} key={`loss-${entry.kind}`}>
            <ResourceIcon kind={entry.kind} /><span><small>{entry.label}</small><b>−{entry.value.replace(/^[+−-]/, '')}</b></span>
          </div>)}
        </div>
      </section> : null}
      {risk || tokens || facts.length ? <section className="reports-v3-facts">
        {risk ? <div className="reports-v3-fact"><small>КАТЕГОРИЯ РИСКА</small>
          <span className="reports-v3-risk" aria-label={`Риск ${risk} из 5`}>{[1, 2, 3, 4, 5].map((level) => <i key={level} className={level <= risk! ? `on lvl-${risk}` : ''}>{['I', 'II', 'III', 'IV', 'V'][level - 1]}</i>)}</span>
        </div> : null}
        {tokens ? <div className="reports-v3-fact reports-v3-fact--token"><small>ЖЕТОНЫ РЕМОНТА</small><b>{tokens === '0' ? 'Не найдены' : `+${tokens.replace(/^\+/, '')}`}</b></div> : null}
        {facts.map((entry) => <div className="reports-v3-fact" key={`${entry.label}-${entry.value}`}><small>{entry.label}</small><b>{entry.value}</b></div>)}
      </section> : null}
      <section className="reports-v3-summary"><p>{item.body}</p>{notes.map((note) => <p className="reports-v3-note" key={note}>{note}</p>)}</section>
    </div>
  );
}

function OverpopulationDossier({ item }: { item: ReportItem }) {
  const report = item.overpopulationReport;
  if (!report) return <GenericDossier item={item} />;
  return (
    <div className={`reports-dossier reports-dossier--overpopulation reports-v2-tone-${item.statusTone}`} data-qa-overpopulation-report={report.id}>
      <DossierHeading item={item} />
      <section className="reports-kpi-grid overpopulation-report-summary" aria-label="Итог перенаселения">
        <div><small>НАСЕЛЕНИЕ ДО</small><strong>{numberFormat.format(report.populationBefore)}</strong></div>
        <div><small>НАСЕЛЕНИЕ ПОСЛЕ</small><strong>{numberFormat.format(report.populationAfter)}</strong></div>
        <div><small>ВМЕСТИМОСТЬ</small><strong>{numberFormat.format(report.capacity)}</strong></div>
        <div className="is-danger"><small>УНИЧТОЖЕНО</small><strong>{numberFormat.format(report.removedShips.reduce((sum, loss) => sum + loss.count, 0))}</strong></div>
      </section>
      <section className="spy-report-card overpopulation-report-losses">
        <header><strong>УНИЧТОЖЕННЫЕ КОРАБЛИ И СПУТНИКИ</strong><span>{numberFormat.format(report.removedShips.reduce((sum, loss) => sum + loss.count, 0))} ед.</span></header>
        {report.removedShips.length ? <div className="spy-report-entity-grid">
          {report.removedShips.map(({ shipId, count }) => {
            const entity = getFactionCombatEntity(report.factionId, shipId as CombatEntityId);
            return <article className="spy-report-entity" key={shipId} data-qa-overpopulation-loss={shipId}><span className="reports-v2-art reports-v2-entity-art"><img src={entity.art} alt="" /></span><div><strong>{entity.name}</strong><span>{shipId}</span></div><b>{numberFormat.format(count)}</b></article>;
          })}
        </div> : <p className="spy-report-empty">Потери кораблей не зафиксированы.</p>}
      </section>
      <section className="reports-generic-body reports-episode-meta"><small>{report.planetName} · {getCombatFactionName(report.factionId)}</small><p>Начало эпизода: {formatDate(new Date(report.episodeStartedAt).toISOString())} · Разблокировка: {formatDate(new Date(report.episodeEndedAt).toISOString())}</p></section>
    </div>
  );
}

function PirateReconDossier({ item, onOpenPirateUniverse }: {
  item: ReportItem;
  onOpenPirateUniverse: (coordinate: UniverseCoordinate, contactCycleKey: string) => void;
}) {
  const report = item.pirateReconReport;
  if (!report) return <GenericDossier item={item} />;
  const coordinate = item.coordinates[0] ?? '';
  const formatTimestamp = (timestamp: number) => formatDate(new Date(timestamp).toISOString());

  return (
    <div className={`reports-dossier reports-dossier--pirate-recon reports-dossier--pirate-recon-${report.outcome} reports-v2-tone-${item.statusTone}`} data-qa-pirate-recon-report={report.id}>
      <DossierHeading item={item} />
      <p className="reports-contact-meta"><button type="button" className="spy-report-link" onClick={() => onOpenPirateUniverse(report.coordinate, report.contactCycleKey)}>{coordinate} ↗</button><span>Контакт {report.contactCycleKey}</span></p>
      <section className="reports-kpi-grid pirate-recon-report-card" aria-label="Сводка разведки">
        {report.outcome === 'success' && report.intel ? <><div><small>УРОВЕНЬ КОРАБЛЕЙ</small><strong>{report.intel.shipLevel}</strong></div><div><small>ТИПОВ КОРАБЛЕЙ</small><strong>{report.intel.ships.length}</strong></div></> : null}
        <div><small>ОТПРАВЛЕНИЕ</small><strong className="reports-kpi-time">{formatTimestamp(report.dispatchedAt)}</strong></div>
        <div><small>ПРИБЫТИЕ</small><strong className="reports-kpi-time">{formatTimestamp(report.arrivedAt)}</strong></div>
      </section>
      {report.outcome === 'success' && report.intel ? <>
        <section className="spy-report-card pirate-recon-report-card">
          <header><strong>СОСТАВ ПО НАСЕЛЕНИЮ</strong><span>Проценты состава</span></header>
          <div className="pirate-recon-report-list">
            {report.intel.ships.map((ship) => {
              const art = pirateReconArtByName.get(ship.name);
              return (
                <div key={ship.name} className="pirate-recon-ship" data-qa-pirate-recon-ship={ship.name}>
                  <span className="pirate-recon-ship-identity">
                    {art ? <span className="reports-v2-art reports-v2-pirate-art"><img className="pirate-recon-ship-art" src={art} alt={`Пиратский корабль «${ship.name}»`} loading="lazy" /></span> : null}
                    <span>{ship.name}</span>
                  </span>
                  <strong>{ship.populationPercent}%</strong>
                </div>
              );
            })}
          </div>
        </section>
      </> : <section className="spy-report-card pirate-recon-report-card">
        <header><strong>{report.outcome === 'failure' ? 'СВЕДЕНИЯ НЕ ПОЛУЧЕНЫ' : report.outcome === 'no-target' ? 'ЦЕЛЬ ОТСУТСТВОВАЛА' : 'ДАННЫЕ ОТЧЁТА ОТСУТСТВУЮТ'}</strong></header>
        <p className="spy-report-empty">{report.outcome === 'success' ? 'В сохранённом успешном отчёте отсутствуют данные разведки.' : item.body}</p>
      </section>}
    </div>
  );
}

function reportCoordinate(coordinate: UniverseCoordinate) {
  return `[${coordinate.galaxy}:${coordinate.system}:${coordinate.position}]`;
}

function sourcePlanetLabel(id: string) {
  return id === 'helion-01' ? 'Helion 01' : 'Планета-источник';
}

function SpyDossier({ item, report, onOpenUniverseTarget }: {
  item: ReportItem;
  report: SpyReportSnapshot;
  onOpenUniverseTarget: (target: { coordinate: UniverseCoordinate; planetId?: string; ownerId?: string }) => void;
}) {
  const fleet = Object.entries(report.fleet ?? {}).filter(([id, count]) => id !== 'spy-probe' && Number(count) > 0);
  const defense = Object.entries(report.defense ?? {}).filter(([, count]) => Number(count) > 0);
  const commanders = Object.entries(report.commanders ?? {}).filter(([, value]) => Boolean(value));
  const factionName = getCombatFactionName(report.targetRaceId);
  const resources = [
    { kind: 'metal' as const, label: 'Металл', value: report.resources.metal },
    { kind: 'minerals' as const, label: 'Минералы', value: report.resources.minerals },
    { kind: 'gas' as const, label: 'Газ', value: report.resources.gas },
    { kind: 'energy' as const, label: 'Энергия', value: report.resources.developmentEnergy },
  ];
  return (
    <div className={`reports-dossier reports-dossier--spy reports-v2-tone-${item.statusTone}`} data-qa-spy-report={report.id}>
      <DossierHeading item={item} />
      <section className="spy-report-card"><header><strong>РЕСУРСЫ</strong><span>Снимок на момент передачи</span></header><div className="spy-report-resource-grid">
        {resources.map((resource) => <div className={`spy-report-resource spy-report-resource--${resource.kind}`} key={resource.kind}><span className="reports-v2-art reports-v2-resource-art"><ResourceIcon kind={resource.kind} className="spy-report-resource__icon" /></span><span>{resource.label}</span><strong>{numberFormat.format(resource.value)}</strong></div>)}
      </div></section>
      {report.quality === 'full' ? <>
        <section className="spy-report-card spy-report-card--fleet"><header><strong>КОРАБЛИ</strong><span>Боевой и транспортный состав</span></header>{fleet.length ? <div className="spy-report-entity-grid">{fleet.map(([id, count]) => { const entity = getFactionCombatEntity(report.targetRaceId, id as CombatEntityId); const level = report.fleetLevels?.[id as ShipId]; return <article className="spy-report-entity" key={id} data-level={level !== undefined ? level : undefined}><span className="reports-v2-art reports-v2-entity-art"><img src={entity.art} alt="" /></span><div><strong>{entity.name}</strong><span>{level !== undefined ? `Уровень ${level}` : entity.role}</span></div><b>{numberFormat.format(Number(count))}</b></article>; })}</div> : <p className="spy-report-empty">Корабли не найдены.</p>}</section>

      </> : null}

      <div className="reports-dossier-split">
        {report.quality !== 'basic' ? <section className="spy-report-card spy-report-card--defense"><header><strong>ОБОРОНА</strong><span>{factionName}</span></header>{defense.length ? <div className="spy-report-entity-grid">{defense.map(([id, count]) => { const entity = getFactionCombatEntity(report.targetRaceId, id as CombatEntityId); return <article className="spy-report-entity" key={id}><span className="reports-v2-art reports-v2-entity-art"><img src={entity.art} alt="" /></span><div><strong>{entity.name}</strong><span>{entity.role}</span></div><b>{numberFormat.format(Number(count))}</b></article>; })}</div> : <p className="spy-report-empty">Оборона не найдена.</p>}</section> : null}
        {report.quality === 'full' ? <section className="spy-report-card spy-report-card--commanders"><header><strong>КОМАНДИРЫ</strong><span>Выявленные командирские корабли</span></header>{commanders.length ? <div className="spy-report-entity-grid">{commanders.map(([id, value]) => { const entity = getFactionCombatEntity(report.targetRaceId, id as CombatEntityId); const commanderLevel = value?.level ?? 0; const commanderName = COMMANDER_ABILITIES[id as CommanderId]?.commanderName ?? entity.name; const ability = COMMANDER_ABILITIES[id as CommanderId] ? getCommanderPresentedAbility(id as CommanderId) : undefined; return <article className="spy-report-entity spy-report-entity--inspected" key={id} data-level={commanderLevel} tabIndex={0}><span className="reports-v2-art reports-v2-entity-art"><img src={entity.art} alt="" /></span><div><strong>{commanderName}</strong><span>Уровень {commanderLevel}</span></div><b>{numberFormat.format(value?.count ?? 0)}</b>{ability ? <span className="spy-entity-tooltip" role="tooltip"><strong>{ability.ability}</strong><span>{ability.description}</span><b>Эффект: {formatCommanderPresentedEffect(id as CommanderId, commanderLevel)}</b>{ability.note ? <small>{ability.note}</small> : null}</span> : null}</article>; })}</div> : <p className="spy-report-empty">Командиры не найдены.</p>}</section> : null}
      </div>
      <section className="spy-report-card spy-report-card--summary"><header><strong>СВОДКА ЦЕЛИ</strong><span>{factionName}</span></header><dl className="spy-report-summary-grid">
        <div><dt>Планета</dt><dd><strong>{report.targetPlanetName}</strong><button type="button" className="spy-report-link" onClick={() => onOpenUniverseTarget({ coordinate: report.targetCoordinate, planetId: report.targetPlanetId })}>{reportCoordinate(report.targetCoordinate)}</button></dd></div>
        <div><dt>Источник</dt><dd>{sourcePlanetLabel(report.sourcePlanetId)}</dd></div>
        {report.resources.debris > 0 ? <div><dt>Обломки на момент передачи</dt><dd>{numberFormat.format(report.resources.debris)}</dd></div> : null}
        <div><dt>Владелец</dt><dd><button type="button" className="spy-report-link" onClick={() => onOpenUniverseTarget({ coordinate: report.targetCoordinate, planetId: report.targetPlanetId, ownerId: report.targetOwnerId })}>{report.targetOwnerName}</button></dd></div>
        <div><dt>Отношение</dt><dd>{report.targetRelation === 'enemy' ? 'Враг' : 'Нейтральный'}</dd></div>
      </dl></section>
      {report.population ? <section className="spy-report-card spy-report-card--population"><header><strong>НАСЕЛЕНИЕ И СОСТАВ</strong><span>Население планеты: экипажи кораблей и гарнизоны обороны</span></header><div className="spy-report-population"><div><span>Население планеты</span><strong>{numberFormat.format(report.population.total)}</strong></div><div><span>Корабли</span><strong>{numberFormat.format(report.population.fleet)}</strong></div><div><span>Оборона</span><strong>{numberFormat.format(report.population.defense)}</strong></div></div></section> : null}
      <section className="reports-generic-body"><small>СВОДКА</small><p>{item.body}</p></section>
    </div>
  );
}

// The combat view model has no pirate faction id and falls back to Aegis;
// detect pirates from the participant record instead.
function isPirateSide(side: BattleSideViewModel) {
  const p = side.participant as { race?: string; playerName?: string; playerId?: string };
  return /pirat|пират/i.test([p.race, p.playerId, p.playerName, String(side.factionId)].join(' '));
}

function BattleSideOverview({ side, outcome }: { side: BattleSideViewModel; outcome: 'winner' | 'loser' | 'draw' }) {
  const sideLabel = side.participant.side === 'attacker' ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК';
  const participantMeta = [isPirateSide(side) ? 'Пираты' : side.participant.race, side.participant.coordinates].filter(Boolean).join(' · ');
  return (
    <article className={`reports-battle-side reports-battle-side--${side.participant.side} reports-battle-side--${outcome}`}>
      <div className="reports-v2-art reports-battle-general-art">{isPirateSide(side) ? <span className="faction-general-portrait" data-faction="pirates"><img src={pirateWarlordArt} alt="" /></span> : <FactionGeneralPortrait factionId={side.factionId} />}</div>
      <div className="reports-battle-side-copy"><small>{sideLabel}</small><strong>{side.participant.playerName || side.participant.planetName || '—'}</strong><span>{participantMeta || side.participant.planetName || 'Данные участника не зафиксированы'}</span></div>
      <div className="reports-battle-population"><small>НАСЕЛЕНИЕ</small><span><b>{side.populationBefore == null ? '—' : numberFormat.format(side.populationBefore)}</b><i aria-hidden="true">→</i><b>{side.populationAfter == null ? '—' : numberFormat.format(side.populationAfter)}</b></span></div>
      {side.populationBefore != null && side.populationBefore > 0 && side.populationAfter != null ? <div className="reports-battle-population-bar" role="meter" aria-label="Оставшееся население" aria-valuemin={0} aria-valuemax={side.populationBefore} aria-valuenow={Math.max(0, Math.min(side.populationBefore, side.populationAfter))}><i style={{ width: `${Math.max(0, Math.min(100, side.populationAfter / side.populationBefore * 100))}%` }} /></div> : null}

    </article>
  );
}

function BattleLosses({ side }: { side: BattleSideViewModel }) {
  const losses = side.ships.filter((ship) => ship.destroyed != null && ship.destroyed > 0);
  return <section className="spy-report-card reports-battle-losses">
    <header><strong>ПОТЕРИ {side.participant.side === 'attacker' ? 'АТАКУЮЩЕГО' : 'ЗАЩИТНИКА'}</strong>{side.losses.ships != null ? <span>{numberFormat.format(side.losses.ships)} кораблей</span> : null}</header>
    {losses.length ? <div className="spy-report-entity-grid">{losses.map((ship) => <article className="spy-report-entity" key={ship.key}><span className="reports-v2-art reports-v2-entity-art"><img src={ship.art} alt="" /></span><div><strong>{ship.name}</strong><span>Уничтожено</span></div><b>{numberFormat.format(ship.destroyed!)}</b></article>)}</div> : <p className="spy-report-empty">{side.losses.ships === 0 ? 'Потери кораблей не зафиксированы.' : 'Состав потерь не зафиксирован.'}</p>}
  </section>;
}

function BattleDossier({ item, report, saved, rating, playerOwnerId, onToggleSaved, onOpen }: { item: ReportItem; report: BattleReport; saved: boolean; rating: RatingPrototypeState; playerOwnerId: string; onToggleSaved: () => void; onOpen: () => void }) {
  const viewModel = createBattleReportViewModel(report, {
    awardedBattlePoints: selectRecordedBattlePointAwards(rating, report, playerOwnerId),
  });
  const result = viewModel.winner === 'draw'
    ? { label: 'НИЧЬЯ', tone: 'draw' }
    : viewModel.winner === 'attacker'
      ? { label: 'ПОБЕДА АТАКУЮЩЕГО', tone: 'attacker' }
      : { label: 'ПОБЕДА ЗАЩИТНИКА', tone: 'defender' };
  return (
    <div className={`reports-dossier reports-dossier--battle reports-v2-tone-${item.statusTone}`}>
      <DossierHeading item={item} />
      <section className={`reports-battle-overview reports-battle-overview--${result.tone}`} aria-label="Сводка боевого отчёта">
        <BattleSideOverview side={viewModel.attacker} outcome={viewModel.winner === 'draw' ? 'draw' : viewModel.winner === 'attacker' ? 'winner' : 'loser'} />
        <div className="reports-battle-versus" aria-label={result.label}><span>VS</span></div>
        <BattleSideOverview side={viewModel.defender} outcome={viewModel.winner === 'draw' ? 'draw' : viewModel.winner === 'defender' ? 'winner' : 'loser'} />
      </section>
      <section className={`reports-v3-verdict reports-v2-tone-${item.statusTone}`} aria-label="Итог боя">
        <div><small>ИТОГ БОЯ</small><strong>{item.statusLabel}</strong><span>{viewModel.roundCount ? `${viewModel.roundCount} ${viewModel.roundCount === 1 ? 'раунд' : viewModel.roundCount < 5 ? 'раунда' : 'раундов'}` : noCombatVerdict(viewModel.roundCount, viewModel.winner, viewModel.missionType, viewModel.resources)!.summary}</span></div>
        <div className="reports-v3-verdict-actions">
          <button type="button" className={`reports-v3-star ${saved ? 'active' : ''}`} aria-pressed={saved} aria-label={saved ? 'Убрать бой из сохранённых' : 'Сохранить бой'} onClick={onToggleSaved}><ActionGlyph kind="save" /></button>
          <button type="button" className="reports-primary-action" onClick={onOpen}>ПОЛНЫЙ БОЕВОЙ ОТЧЁТ</button>
        </div>
      </section>
      <div className="reports-v3-losses">
        <BattleLosses side={viewModel.attacker} />
        <BattleLosses side={viewModel.defender} />
      </div>
      {viewModel.debrisOnOrbit != null || viewModel.resources.length ? <section className="reports-battle-rewards" aria-label="Обломки и ресурсы после боя">
        <header><strong>РЕСУРСЫ И ОБЛОМКИ</strong><span>Зафиксировано в отчёте</span></header>
        <div className="reports-battle-reward-grid">
          {viewModel.resources.map((resource) => <div className="reports-battle-reward" key={resource.kind}><span className="reports-v2-art reports-battle-resource-art"><ResourceIcon kind={resource.kind} /></span><span>{resource.label}</span><strong>{numberFormat.format(resource.value)}</strong></div>)}
          {viewModel.debrisOnOrbit != null ? <div className="reports-battle-reward reports-battle-reward--debris"><span className="reports-v2-art reports-battle-resource-art"><ResourceIcon kind="debris" /></span><span>Обломки на орбите</span><strong>{numberFormat.format(viewModel.debrisOnOrbit)}</strong></div> : null}
        </div>
      </section> : null}
    </div>
  );
}

function EmptyDossier({ category, savedOnly }: { category: ReportCategory; savedOnly: boolean }) {
  const copy = EMPTY_COPY[category];
  return <div className="reports-empty-dossier"><img className="ui-empty-art" src={savedOnly ? EMPTY_ART.battles : EMPTY_ART.reports} alt="" draggable={false} /><strong>{savedOnly ? 'СОХРАНЁННЫХ БОЁВ НЕТ' : copy.title.toUpperCase()}</strong><span>{savedOnly ? 'Сохрани нужный бой звездой в «Докладах» или во вкладке Флоты → Битвы.' : copy.body}</span></div>;
}

function EmptyFolder({ folder }: { folder: MessageFolder }) {
  const title = folder.category ? EMPTY_COPY[folder.category].title : folder.emptyTitle ?? 'Раздел пока пуст';
  const body = folder.category ? EMPTY_COPY[folder.category].body : folder.emptyBody ?? 'Для этого раздела пока нет подключённого источника данных.';
  return <div className="reports-empty-dossier reports-empty-folder" data-qa-empty-folder><img className="ui-empty-art" src={EMPTY_ART.reports} alt="" draggable={false} /><strong>{title.toUpperCase()}</strong><span>{body}</span></div>;
}

function ProfileAvatar({ displayName, factionId }: { displayName: string; factionId: string }) {
  return (
    <div className="reports-profile-avatar">
      <div className="reports-profile-avatar__art"><FactionGeneralPortrait factionId={factionId} className="reports-profile-avatar__portrait faction-general-portrait--large" /></div>
      <div className="reports-profile-avatar__caption"><small>{getCombatFactionName(factionId)} · ГЕНЕРАЛ</small><h3>{displayName}</h3></div>
    </div>
  );
}

function MetricGlyph({ metric }: { metric: PlayerProfileMetricKey }) {
  return <img className="reports-score-glyph" src={asterionAssetIntegrationAssets.scoreIcons[metric]} alt="" aria-hidden="true" draggable={false} />;
}

function ProfileRecentEvents({ items }: { items: readonly ReportItem[] }) {
  return (
    <section className="reports-profile-events" aria-label="Последние события">
      <header>ПОСЛЕДНИЕ СОБЫТИЯ</header>
      {items.length ? <ul>{items.map((item) => <li key={item.id}><span className="reports-v2-art reports-profile-event-art"><ReportGlyph kind={item.category} /></span><span>{item.title}</span><time>{formatTime(item.timestamp)}</time></li>)}</ul> : <p>Недавних сообщений пока нет.</p>}
    </section>
  );
}

function PlayerProfile({ profile, score, command, mode, recentItems, onOpenCommand }: { profile: PlayerProfileState; score: OwnerScore | null; command: CommandState; mode: RuntimeMode; recentItems: readonly ReportItem[]; onOpenCommand: () => void }) {
  const metrics = selectPlayerProfileMetrics(profile, score, mode);
  const membership = selectOwnerMembership(command, profile.playerId);
  const alliance = membership ? toAllianceIdentity(membership.alliance) : null;
  return (
    <section className="reports-profile-view" data-qa-profile aria-labelledby="reports-profile-title">
      <header className="reports-profile-title-plate"><span className="reports-profile-title-plate__side">ЦЕНТР СООБЩЕНИЙ</span><h2 id="reports-profile-title">ПРОФИЛЬ ИГРОКА</h2><span className="reports-profile-title-plate__side reports-profile-title-plate__side--right">ЛИЧНОСТЬ // РЕЙТИНГ</span></header>
      <div className="reports-profile-card">
        <section className="reports-profile-identity" aria-label="Аватар игрока"><ProfileAvatar displayName={profile.displayName} factionId={profile.factionId} /></section>
        <section className="reports-profile-metrics" aria-label="Рейтинг игрока">
          {metrics.map((metric) => <div key={metric.key} className="reports-profile-metric" data-qa-profile-metric={metric.key} tabIndex={0} role="img" title={metric.description} aria-label={`${metric.label}: ${metric.value == null ? 'нет данных' : numberFormat.format(metric.value)}. ${metric.description}`}><span className="reports-profile-metric__glyph"><MetricGlyph metric={metric.key} /></span><span><small>{metric.label}</small><strong>{metric.value == null ? '—' : numberFormat.format(metric.value)}</strong><em>{metric.description}</em></span></div>)}
        </section>
        <section className="reports-profile-alliance" aria-label="Состояние союза">
          <small>СОЮЗ</small>
          {alliance ? <button type="button" className="reports-profile-alliance-link" onClick={onOpenCommand} aria-label={`Открыть Командование союза ${alliance.name}`}><span className="reports-v2-art reports-profile-alliance-art reports-profile-alliance-crest">{membership ? <EmblemGlyph emblem={membership.alliance.emblem} /> : <ReportGlyph kind="alliances" />}</span><span><strong>{alliance.name}</strong><small>[{alliance.tag}] · {numberFormat.format(membership?.alliance.members.length ?? 0)} участников</small></span><b>КОМАНДОВАНИЕ <i>→</i></b></button> : <div className="reports-profile-no-alliance"><span className="reports-profile-diamond" aria-hidden="true">?</span><span><strong>Без Союза</strong><small>Членство не задано в профиле</small></span></div>}
          <ProfileRecentEvents items={recentItems} />
        </section>
      </div>
      {profile.protectionMode ? <div className="reports-profile-protection"><i /> ЗАЩИТНЫЙ РЕЖИМ АКТИВЕН</div> : null}
      {mode === 'test' ? <p className="reports-fixture-note">Профильная идентичность тестовая; очки рассчитаны по текущим активам владельца, достижения не начисляются.</p> : null}
    </section>
  );
}

function FolderActions({ folder, items, selectedIds, onSelectAll, onDeleteAll, onDeleteSelected }: { folder: MessageFolder; items: readonly ReportItem[]; selectedIds: ReadonlySet<string>; onSelectAll: (checked: boolean) => void; onDeleteAll: () => void; onDeleteSelected: () => void }) {
  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));
  return (
    <div className="reports-folder-actions" data-qa-folder-actions>
      <label className="reports-select-all"><input type="checkbox" checked={allSelected} disabled={!items.length} onChange={(event) => onSelectAll(event.target.checked)} aria-label={`Выбрать все сообщения в разделе ${folder.label}`} /><span>ВЫБРАТЬ ВСЕ</span><b>{selectedIds.size}/{items.length}</b></label>
      <div className="reports-delete-actions"><button type="button" data-qa-delete-all disabled={!items.length} onClick={onDeleteAll}>УДАЛИТЬ ВСЕ</button><button type="button" data-qa-delete-selected disabled={!selectedIds.size} onClick={onDeleteSelected}>УДАЛИТЬ ВЫБРАННОЕ</button></div>
    </div>
  );
}

export function ReportsView({ battleReports, planetNames, savedBattleReportIds, operations, command, espionage, pirateReconReports, pirateFlights, exploration, initialSelectedReportId, profile, score, rating, mode, state, onStateChange, onToggleBattleSaved, onOpenFleets, onOpenCommand, onSimulateBattle, onRecallSpy, onOpenUniverseTarget, onOpenPirateUniverse }: {
  battleReports: readonly BattleReport[];
  /** Live names of the player's planets, so flight summaries never show ids. */
  planetNames?: Readonly<Record<string, string>>;
  savedBattleReportIds: readonly string[];
  operations: OperationsState;
  command: CommandState;
  espionage?: import('./domain/espionage/types.ts').EspionageState;
  pirateReconReports?: readonly PirateReconReport[];
  pirateFlights?: readonly import('./domain/flights/types.ts').FlightRecord[];
  exploration?: import('./domain/exploration/ledger.ts').ExplorationState;
  initialSelectedReportId?: string;
  profile: PlayerProfileState;
  score: OwnerScore | null;
  rating: RatingPrototypeState;
  mode: RuntimeMode;
  state: ReportsState;
  onStateChange: (next: ReportsState) => void;
  onToggleBattleSaved: (reportId: string, saved: boolean) => void;
  onOpenFleets: () => void;
  onOpenCommand: () => void;
  onSimulateBattle: (report: SpyReportSnapshot) => void;
  onRecallSpy: (missionId: string) => void;
  onOpenUniverseTarget: (target: { coordinate: UniverseCoordinate; planetId?: string; ownerId?: string }) => void;
  onOpenPirateUniverse: (coordinate: UniverseCoordinate, contactCycleKey: string) => void;
}) {
  const [activeFolder, setActiveFolder] = useState<MessageFolderId>('profile');
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [openBattleReportId, setOpenBattleReportId] = useState<string | null>(null);
  const pendingInitialReportId = useRef<string | null>(null);
  const handledInitialReportId = useRef<string | null>(null);

  const items = useMemo(() => buildReportsFeed(battleReports, operations, command, espionage, state.overpopulationReports, state.recyclerArrivalReports, state.gasExtractionArrivalReports, pirateReconReports, pirateFlights, exploration, profile.playerId, { planetNames, factionId: profile.factionId })
    // Battles between third parties (e.g. pirates raiding Bot 01) are not the player's mail.
    .filter((item) => {
      if (!item.battleReportId) return true;
      const report = findBattleReport(battleReports, item);
      if (!report) return true;
      const mine = (id?: string) => isAsterionLocalPlayerId(profile.playerId) ? isAsterionLocalPlayerId(id) : id === profile.playerId;
      return mine(report.attacker.playerId) || mine(report.defender.playerId);
    }), [battleReports, operations, command, espionage, state.overpopulationReports, state.recyclerArrivalReports, state.gasExtractionArrivalReports, pirateReconReports, pirateFlights, exploration, profile.playerId, planetNames, profile.factionId]);
  const counts = useMemo(() => getReportCategoryCounts(items, state), [items, state]);
  const unreadCounts = useMemo(() => getReportUnreadCounts(items, state), [items, state]);
  const activeFolderMeta = MESSAGE_FOLDERS.find((folder) => folder.id === activeFolder) ?? MESSAGE_FOLDERS[0];
  const activeCategory = activeFolderMeta.category;
  const folderItems = useMemo(() => activeCategory ? getVisibleReportItems(items, state).filter((item) => item.category === activeCategory) : [], [activeCategory, items, state]);
  const visibleItems = useMemo(() => activeCategory ? filterReportItems(items, state, { category: activeCategory, filter, search }, savedBattleReportIds) : [], [activeCategory, items, state, filter, search, savedBattleReportIds]);
  const recentProfileItems = getVisibleReportItems(items, state).slice(0, 3);
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  const pagedItems = visibleItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedItem = visibleItems.find((item) => item.id === selectedId) ?? null;
  const selectedBattle = findBattleReport(battleReports, selectedItem);
  const selectedBattleSaved = selectedItem?.battleReportId ? savedBattleReportIds.includes(selectedItem.battleReportId) : false;
  const openBattleReport = openBattleReportId ? battleReports.find((report) => report.id === openBattleReportId) ?? null : null;
  const openBattleViewModel = openBattleReport ? createBattleReportViewModel(openBattleReport, {
    awardedBattlePoints: selectRecordedBattlePointAwards(rating, openBattleReport, profile.playerId),
  }) : null;

  useEffect(() => {
    setPage(1);
    if (pendingInitialReportId.current === null) setSelectedId('');
    setSelectedIds(new Set());
    if (activeFolderMeta.category) setFilter('all');
  }, [activeFolder, activeFolderMeta.category]);
  useEffect(() => {
    if (!initialSelectedReportId || handledInitialReportId.current === initialSelectedReportId) return;
    handledInitialReportId.current = initialSelectedReportId;
    pendingInitialReportId.current = initialSelectedReportId;
    const target = items.find((item) => item.id === initialSelectedReportId
      || item.pirateReconReport?.id === initialSelectedReportId
      || item.battleReportId === initialSelectedReportId);
    // Pirate recon is a System report; completed pirate raids link to Battle reports.
    const folder = MESSAGE_FOLDERS.find((item) => item.category === (target?.category ?? 'system'));
    setActiveFolder(folder?.id ?? 'system');
    setFilter('all');
    setSearch('');
  }, [initialSelectedReportId, items]);
  useEffect(() => {
    const requestedId = pendingInitialReportId.current;
    if (!requestedId) return;
    const targetIndex = visibleItems.findIndex((item) => item.id === requestedId
      || item.pirateReconReport?.id === requestedId
      || item.battleReportId === requestedId);
    if (targetIndex < 0) return;
    const target = visibleItems[targetIndex]!;
    if (activeCategory !== target.category) return;
    setPage(Math.floor(targetIndex / PAGE_SIZE) + 1);
    setSelectedId(target.id);
    pendingInitialReportId.current = null;
  }, [activeCategory, initialSelectedReportId, visibleItems]);
  useEffect(() => { if (activeCategory !== 'battle' && filter === 'saved') setFilter('all'); }, [activeCategory, filter]);
  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);
  useEffect(() => {
    if (activeFolder === 'profile' || !activeCategory || !visibleItems.length) {
      if (selectedId) setSelectedId('');
      return;
    }
    if (!visibleItems.some((item) => item.id === selectedId)) setSelectedId(visibleItems[0].id);
  }, [activeCategory, activeFolder, selectedId, visibleItems]);
  useEffect(() => {
    const allowed = new Set(folderItems.map((item) => item.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => allowed.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [folderItems]);
  useEffect(() => {
    const onRuntimeReset = () => {
      setActiveFolder('profile');
      setFilter('all');
      setSearch('');
      setPage(1);
      setSelectedId('');
      setSelectedIds(new Set());
      setOpenBattleReportId(null);
    };
    window.addEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
    return () => window.removeEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
  }, []);

  const openFolder = (folder: MessageFolderId) => {
    setActiveFolder(folder);
    setFilter('all');
    setSearch('');
  };

  const openItem = (item: ReportItem) => {
    setSelectedId(item.id);
    const index = visibleItems.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1);
    if (!state.readIds.includes(item.id)) onStateChange(withOverpopulationReports(markReportRead(state, item.id), state));
  };

  const navigateSelected = (direction: -1 | 1) => {
    if (!visibleItems.length) return;
    const currentIndex = Math.max(0, visibleItems.findIndex((item) => item.id === selectedId));
    const nextIndex = Math.min(visibleItems.length - 1, Math.max(0, currentIndex + direction));
    openItem(visibleItems[nextIndex]);
  };

  const selectAll = (checked: boolean) => setSelectedIds(checked ? new Set(folderItems.map((item) => item.id)) : new Set());
  const toggleSelected = (id: string, checked: boolean) => setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  const deleteAll = () => {
    if (!activeCategory || !window.confirm('Вы уверены, что хотите удалить все сообщения в этом разделе?')) return;
    onStateChange(withOverpopulationReports(deleteAllReports(state, items, activeCategory), state));
    setSelectedIds(new Set());
    setSelectedId('');
  };
  const deleteSelected = () => {
    if (!activeCategory || !window.confirm('Вы уверены, что хотите удалить выбранные сообщения в этом разделе?')) return;
    onStateChange(withOverpopulationReports(deleteSelectedReports(state, items, activeCategory, [...selectedIds]), state));
    setSelectedIds(new Set());
    setSelectedId('');
  };

  const deleteCurrent = () => {
    if (!activeCategory || !selectedItem || !window.confirm('Удалить это сообщение?')) return;
    onStateChange(withOverpopulationReports(deleteSelectedReports(state, items, activeCategory, [selectedItem.id]), state));
    setSelectedIds((current) => new Set([...current].filter((id) => id !== selectedItem.id)));
    setSelectedId('');
  };

  const selectedIndex = selectedItem ? visibleItems.findIndex((item) => item.id === selectedItem.id) : -1;
  const availableFilters: ReportFilter[] = activeCategory === 'battle' ? ['all', 'unread', 'saved'] : ['all', 'unread'];
  const markableItems = getVisibleReportItems(items, state);

  return (
    <main className={`reports-view reports-v2 ${activeFolder === 'profile' ? 'reports-view--profile' : 'reports-view--folder'}`} aria-label="Центр сообщений Asterion">
      <aside className="reports-categories reports-v2-panel">
        <header><span>ЦЕНТР СООБЩЕНИЙ</span><h1>СООБЩЕНИЯ</h1></header>
        <button type="button" className={`reports-profile-nav ${activeFolder === 'profile' ? 'active' : ''}`} onClick={() => openFolder('profile')} data-message-profile aria-label="Открыть профиль"><span className="reports-v2-art reports-v2-nav-art"><ProfileGlyph /></span><strong>Профиль</strong><b>ОБЗОР</b></button>
        <nav className="reports-message-nav" aria-label="Папки сообщений">
          {MESSAGE_FOLDERS.map((folder) => {
            const unread = folder.category ? unreadCounts[folder.category] : 0;
            const total = folder.category ? counts[folder.category] : 0;
            return <button key={folder.id} type="button" data-message-folder={folder.id} className={activeFolder === folder.id ? 'active' : ''} onClick={() => openFolder(folder.id)} aria-current={activeFolder === folder.id ? 'page' : undefined} aria-label={`${folder.label}: ${unread} непрочитанных из ${total}`}><span className="reports-v2-art reports-v2-nav-art"><ReportGlyph kind={folder.glyph} /></span><strong>{folder.label}</strong>{folder.count ? <b className={`reports-v2-unread-count ${unread > 0 ? 'is-new' : ''}`} aria-label={`${unread} непрочитанных`}>{unread}</b> : <b className="reports-folder-action-label">+</b>}{unread > 0 ? <i className="reports-category-unread" title={`${unread} непрочитанных`} /> : null}</button>;
          })}
        </nav>
        <button className="reports-mark-all" type="button" disabled={!markableItems.some((item) => !state.readIds.includes(item.id))} onClick={() => onStateChange(withOverpopulationReports(markAllReportsRead(state, markableItems.map((item) => item.id)), state))}><span>✓</span> ОТМЕТИТЬ ВСЕ ПРОЧИТАННЫМИ</button>
      </aside>

      {activeFolder === 'profile' ? <PlayerProfile profile={profile} score={score} command={command} mode={mode} recentItems={recentProfileItems} onOpenCommand={onOpenCommand} /> : <section className="reports-folder-workspace" data-qa-folder-view={activeFolder}>
        <section className="reports-feed reports-v2-panel" data-qa-message-folder-view={activeFolder}>
          <header className="reports-feed-head"><div><small>РАЗДЕЛ СООБЩЕНИЙ</small><h2>{activeFolderMeta.label.toUpperCase()}</h2></div>{activeCategory ? <div className="reports-feed-head-tools"><span className="reports-folder-count">{counts[activeCategory]} СООБЩ.</span><div className="reports-v2-filter-segments" role="group" aria-label="Фильтр сообщений">{availableFilters.map((key) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{FILTER_LABELS[key]}</button>)}</div></div> : null}</header>
          {activeCategory ? <FolderActions folder={activeFolderMeta} items={folderItems} selectedIds={selectedIds} onSelectAll={selectAll} onDeleteAll={deleteAll} onDeleteSelected={deleteSelected} /> : null}
          {activeCategory ? <label className="reports-search"><span aria-hidden="true"><SearchGlyph /></span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск в разделе..." aria-label="Поиск в разделе сообщений" /></label> : null}
          <div className="reports-list" data-qa-message-list>
            {activeCategory ? pagedItems.length ? pagedItems.map((item) => <ReportListItem key={item.id} item={item} active={item.id === selectedId} read={state.readIds.includes(item.id)} selected={selectedIds.has(item.id)} saved={Boolean(item.battleReportId && savedBattleReportIds.includes(item.battleReportId))} onOpen={() => openItem(item)} onSelect={(checked) => toggleSelected(item.id, checked)} />) : <p className="reports-list-empty-status" role="status">Сообщений в этом разделе пока нет.</p> : <EmptyFolder folder={activeFolderMeta} />}
          </div>
          {activeCategory ? <footer className="reports-pagination"><button type="button" aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ActionGlyph kind="prev" /></button><span><b>{page}</b> / {pageCount}<small>{visibleItems.length} сообщений</small></span><button type="button" aria-label="Следующая страница" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><ActionGlyph kind="next" /></button></footer> : null}
        </section>

        <section className="reports-preview reports-v2-panel">
          <header className="reports-preview-head"><div><small>ДОСЬЕ СООБЩЕНИЯ</small><h2>ПРОСМОТР СООБЩЕНИЯ</h2></div>{activeCategory ? <div className="reports-preview-actions"><button type="button" aria-label={selectedBattleSaved ? 'Убрать бой из сохранённых' : 'Сохранить бой'} aria-pressed={selectedBattleSaved} disabled={!selectedItem?.battleReportId} className={selectedBattleSaved ? 'active' : ''} onClick={() => selectedItem?.battleReportId && onToggleBattleSaved(selectedItem.battleReportId, !selectedBattleSaved)}><ActionGlyph kind="save" /></button><span /><button type="button" aria-label="Предыдущее сообщение" disabled={selectedIndex <= 0} onClick={() => navigateSelected(-1)}><ActionGlyph kind="prev" /></button><button type="button" aria-label="Следующее сообщение" disabled={selectedIndex < 0 || selectedIndex >= visibleItems.length - 1} onClick={() => navigateSelected(1)}><ActionGlyph kind="next" /></button></div> : null}</header>
          <div className="reports-preview-scroll">{activeCategory ? selectedItem ? (selectedBattle ? <><SunReportStrip report={selectedBattle} /><BattleDossier item={selectedItem} report={selectedBattle} saved={selectedBattleSaved} rating={rating} playerOwnerId={profile.playerId} onToggleSaved={() => selectedItem.battleReportId && onToggleBattleSaved(selectedItem.battleReportId, !selectedBattleSaved)} onOpen={() => selectedBattle && setOpenBattleReportId(selectedBattle.id)} /></> : selectedItem.overpopulationReport ? <OverpopulationDossier item={selectedItem} /> : selectedItem.pirateReconReport ? <PirateReconDossier item={selectedItem} onOpenPirateUniverse={onOpenPirateUniverse} /> : selectedItem.spyReport ? <SpyDossier item={selectedItem} report={selectedItem.spyReport} onOpenUniverseTarget={onOpenUniverseTarget} /> : <GenericDossier item={selectedItem} exploration={exploration} onOpenUniverseTarget={onOpenUniverseTarget} />) : <EmptyDossier category={activeCategory} savedOnly={filter === 'saved'} /> : <EmptyFolder folder={activeFolderMeta} />}</div>
          {activeCategory && selectedItem ? <footer className="reports-preview-footer">
            <div className="reports-preview-footer-actions">
              {selectedItem.battleReportId ? <button type="button" className={selectedBattleSaved ? 'restore' : ''} onClick={() => onToggleBattleSaved(selectedItem.battleReportId!, !selectedBattleSaved)}>{selectedBattleSaved ? 'УБРАТЬ ИЗ СОХРАНЁННЫХ' : 'СОХРАНИТЬ БОЙ'}</button> : null}
              <button type="button" className="reports-delete-current" onClick={deleteCurrent}>УДАЛИТЬ</button>
            </div>
            <div className="reports-preview-footer-actions">
              {selectedItem.secondaryAction?.kind === 'recall_spy' && selectedItem.secondaryAction.missionId ? <button type="button" className="restore" onClick={() => onRecallSpy(selectedItem.secondaryAction!.missionId!)}>{selectedItem.secondaryAction.label}</button> : null}
              {selectedItem.action?.kind === 'simulate_battle' && selectedItem.spyReport ? <button type="button" className="reports-primary-action" onClick={() => onSimulateBattle(selectedItem.spyReport!)}>{selectedItem.action.label}</button> : null}
              {selectedItem.action?.kind === 'open_fleets' ? <button type="button" className="reports-primary-action" onClick={onOpenFleets}>{selectedItem.action.label}</button> : null}
            </div>
          </footer> : null}
        </section>
        {openBattleReport && openBattleViewModel ? <BattleReportModal report={openBattleReport} viewModel={openBattleViewModel} saved={savedBattleReportIds.includes(openBattleReport.id)} onToggleSaved={() => onToggleBattleSaved(openBattleReport.id, !savedBattleReportIds.includes(openBattleReport.id))} onClose={() => setOpenBattleReportId(null)} /> : null}
      </section>}
    </main>
  );
}
