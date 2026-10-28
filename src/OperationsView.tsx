import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { OPERATION_MODIFIER_LABELS, OPERATION_SOURCE_LABELS } from './domain/operations/catalog.ts';
import type {
  OperationCategory,
  OperationId,
  OperationInstance,
  OperationLocation,
  OperationState,
  OperationThreatTier,
  OperationsState,
} from './domain/operations/types.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import type { ResourceIconKind } from './ui/resources/resource-assets.ts';
import type { PirateContactPresentation } from './pirate-ui.ts';
import { isPirateOperationId, pirateContactOperation, pirateCycleOperation, pirateOperationId } from './application/pirate-presentation.ts';
import { getUniverseSlotPoint } from './domain/universe/runtime.ts';
import { getPirateRaidCheckProgress } from './domain/pirates/contact-schedule.ts';
import { pirateAdaptiveInterval, type PirateOwnerAdaptation } from './domain/pirates/adaptive.ts';
import { getPiratePlanetArt, getPiratePlanetOperationDetailArt } from './pirate-planet-art.ts';
import { explorationOperationDetailArt } from './exploration-art.ts';
import { explorationProfile, EXPLORATION_RULES } from './domain/exploration/model.ts';
import { reconcileExplorationContact } from './domain/exploration/ledger.ts';
import type { ExplorationOperationPresentation } from './application/exploration.ts';
import type { UniversePlanetNode } from './domain/universe/types.ts';
import './operations.css';
import './operations-a.css';

export type ExplorationOperationContact = ExplorationOperationPresentation;
type OperationsViewProps = {
  explorationContacts?: readonly ExplorationOperationContact[];
  onExpedition?: (node: UniversePlanetNode) => void;
  onExplorationAttack?: (node: UniversePlanetNode) => void;
  onBot01Occupy?: (node: UniversePlanetNode) => void;
  onExplorationAccept?: (node: UniversePlanetNode) => void;
  onExplorationCancel?: (contactId: string) => void;
  onExplorationRecon?: (node: UniversePlanetNode) => void;
  onExplorationUniverse?: (node: UniversePlanetNode) => void;
  onExplorationReport?: (reportId: string) => void;
  state: OperationsState;
  onAccept: (operationId: OperationId) => void;
  onCancel: (operationId: OperationId) => void;
  onOpenFleets: () => void;
  pirateContacts?: readonly PirateContactPresentation[];
  pirateThreatPercent?: number;
  /** Diagnostic only; NEVER pass in production runtime. */
  pirateAdaptiveDiagnostics?:PirateOwnerAdaptation;
  onPirateBattleExport?: () => void;
  pirateRaidRolls?: Readonly<Record<string, Readonly<{checkAt:number;seed:string;flightId?:string}>>>;
  pirateOwnerId?: string;
  pirateCheckDelayMs?: number;
  completedPirateOperations?: readonly CompletedPirateOperation[];
  onPirateBattleReport?: (reportId: string) => void;
  onPirateAccept?: (contact: PirateContactPresentation) => void;
  onPirateCancel?: (contact: PirateContactPresentation) => void;
  nowMs?: number;
  onPirateRecon?: (contact: PirateContactPresentation) => void;
  onPirateAttack?: (contact: PirateContactPresentation) => void;
  onPirateReport?: (reportId: string) => void;
  onPirateUniverse?: (contact: PirateContactPresentation) => void;
};

type OperationsTab = Extract<OperationState, 'available' | 'active' | 'completed'>;
type ContactKind = 'pirate' | 'unique' | 'anomaly' | 'other';
type ContactFilter = 'all' | Exclude<ContactKind, 'other'>;
type CompletedPirateOperation = { cycleKey: string; coordinate: PirateContactPresentation['coordinate']; reportId: string; defeatedAt: number; rounds: number; debris: number; reward?: {sentCombatPopulation:number;historicalHangarCapacity:number;multiplier:number;basePirateDebris:number;bonusPirateDebris:number;ownDebris:number;threatReductionFraction:number} };
type OperationRow = { operation: OperationInstance; contact?: PirateContactPresentation; exploration?: ExplorationOperationContact; completed?: CompletedPirateOperation; battleReportId?: string };

const CONTACT_LABELS: Record<ContactKind, string> = {
  pirate: 'БОЕВАЯ ОПЕРАЦИЯ',
  unique: 'УНИКАЛЬНЫЙ ОБЪЕКТ',
  anomaly: 'АНОМАЛИЯ',
  other: 'ОПЕРАЦИЯ',
};

function contactKind(operation: OperationInstance, pirateContact?: PirateContactPresentation, exploration?: ExplorationOperationContact): ContactKind {
  if (pirateContact || isPirateOperationId(operation.id)) return 'pirate';
  if (exploration?.node.kind === 'anomaly') return 'anomaly';
  if (exploration?.node.kind === 'unique') return 'unique';
  return 'other';
}

function compactRemaining(expiresAt: number, nowMs: number) {
  const seconds = Math.max(0, Math.ceil((expiresAt - nowMs) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}м` : `${seconds}с`;
}

function lifetimePercent(startAt: number | undefined, expiresAt: number | undefined, nowMs: number) {
  if (!startAt || !expiresAt || expiresAt <= startAt) return undefined;
  return Math.max(0, Math.min(100, ((expiresAt - nowMs) / (expiresAt - startAt)) * 100));
}

function explorationLifetimePercent(exploration: ExplorationOperationContact | undefined, nowMs: number) {
  const startedAt = exploration?.node.special?.startAt;
  const expiresAt = exploration?.node.special?.expiresAt;
  return lifetimePercent(startedAt, expiresAt, nowMs);
}

const TAB_LABELS: Record<OperationsTab, string> = {
  available: 'ДОСТУПНЫЕ',
  active: 'АКТИВНЫЕ',
  completed: 'ЗАВЕРШЁННЫЕ',
};

const CATEGORY_LABELS: Record<OperationCategory, string> = {
  combat: 'БОЕВАЯ ОПЕРАЦИЯ',
  discovery: 'НЕИЗВЕСТНЫЙ КОНТАКТ',
  exploration: 'ИССЛЕДОВАНИЕ',
  science: 'НАУЧНАЯ ОПЕРАЦИЯ',
};

const ROMAN_THREAT: Record<OperationThreatTier, string> = {
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
  5: 'V',
  6: 'VI',
};

const number = new Intl.NumberFormat('ru-RU');

function formatLocation(location: OperationLocation) {
  if (location.kind === 'system') return `Галактика ${location.galaxy} · Система ${String(location.system).padStart(2, '0')}`;
  if (location.kind === 'coordinates') return location.coordinates;
  return location.label;
}

function formatLocationClass(location: OperationLocation) {
  if (location.kind === 'system') return 'Системный контакт';
  if (location.kind === 'coordinates') return 'Координатный контакт';
  return location.label;
}

function threatText(operation: OperationInstance) {
  const prefix = operation.category === 'combat' ? 'УГРОЗА' : 'РИСК';
  if (operation.threat) return `${prefix} ${ROMAN_THREAT[operation.threat]}`;
  if (operation.threatRange) return `${prefix} ${ROMAN_THREAT[operation.threatRange[0]]}–${ROMAN_THREAT[operation.threatRange[1]]}`;
  return `${prefix} НЕИЗВЕСТЕН`;
}

function threatTier(operation: OperationInstance) {
  if (operation.threat) return ROMAN_THREAT[operation.threat];
  return '?';
}

function IntelPips({ level }: { level: OperationInstance['intel'] }) {
  return (
    <span className="operations-intel-pips-v2" aria-label={`Разведданные ${level} из 3`}>
      {[1, 2, 3].map((step) => <i key={step} className={step <= level ? 'filled' : ''} />)}
    </span>
  );
}

function OperationGlyph({ category }: { category: OperationCategory }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (category === 'combat') return <svg viewBox="0 0 40 40" aria-hidden="true"><circle {...common} cx="20" cy="20" r="12"/><circle {...common} cx="20" cy="20" r="4"/><path {...common} d="M20 4v8M20 28v8M4 20h8M28 20h8"/></svg>;
  if (category === 'science') return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="M16 5h8M17 5v10L9 31c-1 2 .1 4 3 4h16c2.9 0 4-2 3-4l-8-16V5"/><path {...common} d="M13 27h14M16 21h8"/></svg>;
  if (category === 'exploration') return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="m20 5 8 25-8-6-8 6 8-25Z"/><circle {...common} cx="20" cy="19" r="3"/></svg>;
  return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="M7 30c4-8 10-12 18-12M11 34c3-6 7-9 14-9M25 18c4 0 7 3 7 7"/><circle {...common} cx="27" cy="12" r="4"/><path {...common} d="M27 4v4M35 12h-4"/></svg>;
}

function rewardEntries(operation: OperationInstance) {
  return [
    ['МЕТАЛЛ', operation.rewardPreview.metal, 'metal'],
    ['МИНЕРАЛЫ', operation.rewardPreview.minerals, 'minerals'],
    ['ГАЗ', operation.rewardPreview.gas, 'gas'],
  ].filter((entry): entry is [string, number, ResourceIconKind] => typeof entry[1] === 'number');
}

function RewardPreview({ operation, compact = false }: { operation: OperationInstance; compact?: boolean }) {
  const entries = rewardEntries(operation);
  if (!entries.length && !operation.rewardPreview.labels?.length) {
    return <span className="operations-reward-unknown-v2">НАГРАДА НЕИЗВЕСТНА</span>;
  }

  return (
    <div className={compact ? 'operations-reward-compact-v2' : 'operations-reward-v2'}>
      {entries.map(([label, value, glyph]) => (
        <span key={label}>
          <i><ResourceIcon kind={glyph} /></i>
          {!compact ? <small>{label}</small> : null}
          <strong>{number.format(value)}</strong>
        </span>
      ))}
      {!compact ? operation.rewardPreview.labels?.map((label) => <em key={label}>{label}</em>) : null}
    </div>
  );
}


function TacticalScope({ operation, contact }: { operation: OperationInstance; contact?: PirateContactPresentation }) {
  // Project the exact same orbital slot as UniverseView into the sensor SVG.
  // Both screens share getUniverseSlotPoint; no independent slot-angle formula.
  const slot = contact?.coordinate.position ?? 1;
  const universePoint = getUniverseSlotPoint(slot);
  const markerX = 240 + (universePoint.x - 50) * 4.8;
  const markerY = 120 + (universePoint.y - 52) * 2.4;
  const unknown = operation.intel === 0;
  const isCombat = operation.category === 'combat' && !isPirateOperationId(operation.id);
  const isScience = operation.category === 'science';
  const isDerelict = operation.category === 'exploration';

  return (
    <div className={`operations-scope-v2 operations-scope-v2--${operation.category} ${unknown ? 'is-unknown' : ''}`}>
      <svg viewBox="0 0 480 240" aria-hidden="true">
        <path className="scope-grid" d="M20 120h440M240 16v208M84 45l312 150M84 195 396 45" />
        {contact ? (
          <>
            <ellipse className="scope-ring ring-inner" cx="240" cy="120" rx="91.2" ry="52.8" />
            <ellipse className="scope-ring ring-mid" cx="240" cy="120" rx="134.4" ry="64.8" />
            <ellipse className="scope-ring ring-outer" cx="240" cy="120" rx="172.8" ry="76.8" />
            <ellipse className="scope-ring ring-outer" cx="240" cy="120" rx="211.2" ry="88.8" />
          </>
        ) : (
          <>
            <circle className="scope-ring ring-outer" cx="240" cy="120" r="92" />
            <circle className="scope-ring ring-mid" cx="240" cy="120" r="61" />
            <circle className="scope-ring ring-inner" cx="240" cy="120" r="30" />
          </>
        )}
        <path className="scope-sweep" d="M240 120 392 76A160 160 0 0 1 400 120Z" />

        {contact ? (
          <g className="scope-hostiles" data-qa-pirate-scope-position={slot} data-qa-pirate-scope-x={markerX.toFixed(2)} data-qa-pirate-scope-y={markerY.toFixed(2)}>
            <circle cx={markerX} cy={markerY} r="7" />
            <circle cx={markerX} cy={markerY} r="17" fill="none" strokeDasharray="3 4" opacity=".7"/>
            <path d={`M${markerX - 12} ${markerY}h24M${markerX} ${markerY - 12}v24`} />
          </g>
        ) : isCombat ? (
          <g className="scope-hostiles">
            <circle cx="324" cy="82" r="5" />
            <circle cx="350" cy="135" r="4" />
            <circle cx="292" cy="158" r="4" />
            <path d="m324 67 15 15-15 15-15-15 15-15Z" />
          </g>
        ) : null}

        {unknown ? (
          <g className="scope-unknown-contact">
            <circle cx="282" cy="99" r="9" />
            <circle cx="282" cy="99" r="22" />
            <path d="M270 99h24M282 87v24" />
          </g>
        ) : null}

        {isDerelict ? (
          <g className="scope-derelict">
            <path d="m292 92 42 13-19 10 19 11-42 14-29-24 29-24Z" />
            <path d="m306 101-8 30M320 107l-8 17" />
          </g>
        ) : null}

        {isScience ? (
          <g className="scope-anomaly">
            <path d="M279 61c44 13 62 58 40 94s-76 43-109 15-32-76-1-106 68-30 97-10" />
            <path d="M274 85c28 8 39 37 25 60s-48 27-69 9-20-48 0-67 43-19 61-6" />
          </g>
        ) : null}
      </svg>
      <div className="operations-scope-caption-v2">
        <span>{contact ? `ЦЕЛЬ · ПОЗИЦИЯ ${slot}/24` : isPirateOperationId(operation.id) ? 'ПИРАТСКАЯ БАЗА · ИСТОРИЯ ЦИКЛА' : unknown ? 'СИГНАТУРА НЕ КЛАССИФИЦИРОВАНА' : isCombat ? 'ТАКТИЧЕСКИЙ КОНТАКТ' : isScience ? 'ПОЛЕ ИСКАЖЕНИЯ' : 'ОБЪЕКТ ОБНАРУЖЕН'}</span>
        <small>{contact ? formatLocation(operation.location) : unknown ? 'ОЖИДАНИЕ ГЛУБОКОГО СКАНА' : `INTEL ${operation.intel}/3`}</small>
      </div>
    </div>
  );
}

type DossierTone = 'good' | 'bad' | 'time' | 'token';
type DossierMetric = { label: string; value: string; note?: string; tone?: DossierTone };

function DossierMetrics({ items }: { items: readonly DossierMetric[] }) {
  if (!items.length) return null;
  return <section className="opsA-tiles" aria-label="Сводные данные операции" style={{ ['--tiles' as string]: Math.min(4, items.length) }}>
    {items.slice(0, 4).map((item) => <div className={`opsA-tile ${item.tone ? `is-${item.tone}` : ''}`} key={item.label}>
      <small>{item.label}</small><strong title={item.value}>{item.value}</strong>{item.note ? <span>{item.note}</span> : null}
    </div>)}
  </section>;
}

function OperationStageTimeline({ labels, currentIndex, progress }: { labels: readonly string[]; currentIndex: number; progress?: number }) {
  return <ol className="opsA-steps" aria-label="Этапы операции">
    {labels.map((label, index) => <li key={label} className={index < currentIndex ? 'is-complete' : index === currentIndex ? 'is-current' : 'is-future'}
      style={index === currentIndex && progress !== undefined ? { ['--step' as string]: `${Math.round(progress)}%` } : undefined}
      aria-current={index === currentIndex ? 'step' : undefined}>
      <small>{label}</small>
    </li>)}
  </ol>;
}

function LifetimeBar({ expiresAt, startAt, nowMs, note }: { expiresAt: number; startAt?: number; nowMs: number; note?: string }) {
  const percent = lifetimePercent(startAt, expiresAt, nowMs) ?? 0;
  return <div className="opsA-lifetime">
    <div className="opsA-lifetime-head"><span>ДО ИСЧЕЗНОВЕНИЯ</span><b role="timer">{pirateRemainingLabel(expiresAt, nowMs)}</b></div>
    <div className="opsA-bar" role="progressbar" aria-label="Оставшееся время контакта" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
      <i style={{ width: `${percent}%` }} />
    </div>
    {note ? <small>{note}</small> : null}
  </div>;
}

function DossierFrame({ kind, className = '', dataAttrs, art, completed = false, chips, title, description, middle, metrics, objective, children, status, actions }: {
  kind: ContactKind;
  className?: string;
  dataAttrs?: Record<string, string | undefined>;
  art: ReactNode;
  completed?: boolean;
  chips: ReactNode;
  title: string;
  description?: ReactNode;
  middle?: ReactNode;
  metrics: readonly DossierMetric[];
  objective: string;
  children?: ReactNode;
  status: { label: string; text?: string };
  actions: ReactNode;
}) {
  return (
    <aside className={`operations-dossier-variant-a opsA-dossier ${completed ? 'is-completed' : ''} ${className}`} data-contact-kind={kind} {...dataAttrs}>
      <div className="opsA-dossier-scroll">
        <section className="opsA-hero">
          <div className="opsA-hero-art">{art}</div>
          <div className="opsA-hero-meta">
            <div className="opsA-chips">{chips}</div>
            <h2 className="opsA-hero-title" title={title}>{title}</h2>
            {description ? <p className="opsA-hero-desc">{description}</p> : null}
            {middle}
          </div>
        </section>
        <DossierMetrics items={metrics} />
        <section className="operations-objective-v2 opsA-objective"><small>ОСНОВНАЯ ЦЕЛЬ</small><strong>{objective}</strong></section>
        {children ? <div className="opsA-extra">{children}</div> : null}
      </div>
      <footer className="opsA-footer">
        <div className="opsA-footer-status"><small>{status.label}</small><strong>{status.text}</strong></div>
        <div className="opsA-footer-actions">{actions}</div>
      </footer>
    </aside>
  );
}

function KindChip({ kind }: { kind: ContactKind }) {
  return <span className={`opsA-chip opsA-chip--${kind}`}>{CONTACT_LABELS[kind]}</span>;
}

function OperationCard({ operation, selected, onSelect, contact, exploration, nowMs, pirateRaidRoll, pirateCheckDelayMs }: {
  operation: OperationInstance;
  selected: boolean;
  onSelect: () => void;
  contact?: PirateContactPresentation;
  exploration?: ExplorationOperationContact;
  nowMs: number;
  pirateRaidRoll?: Readonly<{checkAt:number;seed:string;flightId?:string}>;
  pirateCheckDelayMs?: number;
}) {
  const intelZero = operation.intel === 0;
  const kind = contactKind(operation, contact, exploration);
  const pirate = kind === 'pirate';
  const pirateCycle = pirate ? (contact?.contactCycleKey ?? operation.id.slice('pirate:'.length)).split(':') : [];
  const pirateArt = pirate ? getPiratePlanetArt(Number(pirateCycle[2]), Number(pirateCycle[3])) : null;
  const raidCheck = contact ? getPirateRaidCheckProgress(Number(pirateCycle[4]), nowMs,pirateCheckDelayMs) : null;
  const expiresAt = exploration?.node.special?.expiresAt ?? contact?.expiresAt;
  const progress = operation.state === 'completed' ? 100
    : pirate ? lifetimePercent(Number(pirateCycle[4]), expiresAt, nowMs)
      : explorationLifetimePercent(exploration, nowMs);
  const remaining = expiresAt ? compactRemaining(expiresAt, nowMs) : '';
  const lastEvent = [...(exploration?.contact?.events ?? [])].reverse()
    .find((event) => event.ownerId === exploration?.ownerId && (event.kind === 'returned' || event.kind === 'origin-destroyed'));
  const completedResult = pirate ? 'success' : lastEvent?.kind === 'returned' ? 'success' : lastEvent?.kind === 'origin-destroyed' ? 'failure' : 'unknown';
  const completionLabel = completedResult === 'success'
    ? (exploration ? 'Исследовано' : 'Победа')
    : completedResult === 'failure' ? 'Провал' : 'Завершено';
  const completedAt = operation.state === 'completed' && lastEvent ? new Date(lastEvent.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
  const activeStage = exploration?.reconInFlight
    ? exploration.reconInFlight.phase === 'outbound' ? 'Зонд в пути' : 'Зонд возвращается'
    : exploration?.occupancy === 'self' ? 'Сбор ресурсов флотом'
      : exploration ? 'Выполнение'
        : pirate ? 'В работе' : 'Выполнение';
  const statusText = operation.state === 'available'
    ? expiresAt ? `Исчезнет через ${pirateRemainingLabel(expiresAt, nowMs)}` : intelZero ? 'Сигнатура требует классификации' : operation.objective.label
    : operation.state === 'active'
      ? activeStage
      : completionLabel;
  const occupancy = exploration ? (exploration.stage === 'completed' ? 'completed' : exploration.occupancy) : null;

  return (
    <button
      type="button"
      className={`operation-feed-card-v2 opsA-card ${selected ? 'selected' : ''} ${operation.state === 'completed' ? 'is-done' : ''}`}
      data-contact-kind={kind}
      data-completion-result={operation.state === 'completed' ? completedResult : undefined}
      data-threat={operation.threat ?? 'unknown'}
      data-qa-pirate-contact={contact?.contactCycleKey}
      aria-label={`${CONTACT_LABELS[kind]}: ${operation.title}. ${statusText}`}
      onClick={onSelect}
    >
      <span className={`opsA-card-art ${pirate ? 'operation-feed-pirate-art-v2' : ''}`}>
        {exploration
          ? <img src={explorationOperationDetailArt(exploration.node.kind, exploration.node.art)} alt="" loading="lazy" draggable={false} />
          : pirateArt
          ? <img src={getPiratePlanetOperationDetailArt(Number(pirateCycle[2]), Number(pirateCycle[3]))} alt="" loading="lazy" draggable={false} />
          : <span className="opsA-card-glyph"><OperationGlyph category={operation.category} /></span>}
      </span>
      <span className="opsA-card-copy">
        <span className="opsA-card-chips">
          <KindChip kind={kind} />
        </span>
        <strong className="opsA-card-title" title={operation.title}>{operation.title}</strong>
        <span className="opsA-card-status">
          <i>{formatLocation(operation.location)}</i><span aria-hidden="true"> · </span>
          {operation.state === 'available' && expiresAt
            ? <em>исчезнет через <b>{pirateRemainingLabel(expiresAt, nowMs)}</b></em>
            : operation.state === 'active'
              ? <em>{activeStage}{expiresAt ? <> · <b>{pirateRemainingLabel(expiresAt, nowMs)}</b></> : null}</em>
              : operation.state === 'completed'
                ? <em className={`is-${completedResult}`} data-qa-exploration-feed-status={exploration ? 'completed' : undefined}>{completionLabel}{completedAt ? ` · ${completedAt}` : ''}</em>
                : <em>{statusText}</em>}
        </span>
        {exploration && occupancy && operation.state !== 'completed' ? <span className="opsA-card-meta">
          <span className={`opsA-card-occ is-${occupancy}`} data-qa-exploration-feed-status={occupancy}>
            {occupancy === 'free' ? 'СВОБОДНО' : occupancy === 'self' ? 'ВАШ ФЛОТ' : 'ЗАНЯТО'}
          </span>
          {exploration.recon?.success
            ? <b title="Категория риска подтверждена разведданными">· РИСК {['I','II','III','IV','V'][(operation.threat ?? 1)-1]}/V</b> : null}
        </span> : null}
        {!exploration && pirate && operation.state !== 'completed' ? <span className="opsA-card-debris"><ResourceIcon kind="debris" /> ОБЛОМКИ · 125–175%</span> : null}
        {raidCheck ? <span className="opsA-card-raid" data-qa-raid-check-interval="15m">
          <span className="opsA-card-raid-label">
            <span>{pirateRaidRoll ? 'Проверка завершена' : 'Проверка нападения'}</span>
            <strong role="timer">{pirateRaidRoll ? (pirateRaidRoll.flightId ? 'РЕЙД ОТПРАВЛЕН' : 'РЕЙДА НЕТ')
              : raidCheck.remainingMs > 0 ? pirateRemainingLabel(raidCheck.nextAt, nowMs) : 'ПРОВЕРЯЕТСЯ'}</strong>
          </span>
          <span className="opsA-card-raid-track" role="progressbar" aria-label="15-минутный интервал проверки возможного нападения"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={raidCheck.percent}>
            <i style={{ width: `${raidCheck.percent}%` }} />
          </span>
        </span> : null}
      </span>
      <span className={`opsA-ring ${operation.state === 'completed' ? `is-${completedResult}` : ''}`} aria-hidden="true"
        style={{ ['--p' as string]: `${progress ?? 0}%` }}>
        <span><b>{operation.state === 'completed' ? completedResult === 'success' ? '✓' : completedResult === 'failure' ? '✕' : '·' : remaining || '—'}</b></span>
      </span>
    </button>
  );
}

function EmptyState({ tab }: { tab: OperationsTab }) {
  const copy = tab === 'active'
    ? ['АКТИВНЫХ ОПЕРАЦИЙ НЕТ', 'Примите операцию из списка доступных.']
    : tab === 'completed'
      ? ['ЗАВЕРШЁННЫХ ОПЕРАЦИЙ НЕТ', 'Здесь появляются операции с реальным результатом: вернувшиеся экспедиции и завершённые бои.']
      : ['КОНТАКТОВ НЕТ', 'Новых операций сейчас не обнаружено.'];

  return <div className="operations-empty-v2 opsA-empty"><span className="opsA-empty-ring" aria-hidden="true" /><strong>{copy[0]}</strong><p>{copy[1]}</p></div>;
}

function pirateCoordinateLabel(contact: PirateContactPresentation) {
  const { galaxy, system, position } = contact.coordinate;
  return `Галактика ${galaxy} · Система ${String(system).padStart(2, '0')} · Позиция ${position}`;
}

function pirateRemainingLabel(expiresAt: number, nowMs: number) {
  const seconds = Math.max(0, Math.ceil((expiresAt - nowMs) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes} мин ${String(remainder).padStart(2, '0')} с` : `${remainder} с`;
}

function formatPercent(value: number) {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function OperationDossier({ operation, pirateContact, exploration, onExpedition, onExplorationAttack, onBot01Occupy, onExplorationAccept, onExplorationCancel, onExplorationRecon, onExplorationUniverse, onExplorationReport, battleReportId, completed, nowMs, threatPercent, onAccept, onCancel, onOpenFleets, onPirateRecon, onPirateAttack, onPirateReport, onPirateBattleReport, onPirateUniverse }: {
  operation: OperationInstance | null;
  pirateContact?: PirateContactPresentation;
  exploration?: ExplorationOperationContact;
  onExpedition?: (node: UniversePlanetNode) => void;
  onExplorationAttack?: (node: UniversePlanetNode) => void;
  onBot01Occupy?: (node: UniversePlanetNode) => void;
  onExplorationAccept?: (node: UniversePlanetNode) => void;
  onExplorationCancel?: (contactId: string) => void;
  onExplorationRecon?: (node: UniversePlanetNode) => void;
  onExplorationUniverse?: (node: UniversePlanetNode) => void;
  onExplorationReport?: (reportId: string) => void;
  battleReportId?: string;
  completed?: CompletedPirateOperation;
  nowMs: number;
  threatPercent?: number;
  onPirateBattleReport?: (reportId: string) => void;
  onPirateRecon?: (contact: PirateContactPresentation) => void;
  onPirateAttack?: (contact: PirateContactPresentation) => void;
  onPirateReport?: (reportId: string) => void;
  onPirateUniverse?: (contact: PirateContactPresentation) => void;
  onAccept: (id: OperationId) => void;
  onCancel: (id: OperationId) => void;
  onOpenFleets: () => void;
}) {
  if (!operation) {
    return (
      <aside className="operations-dossier-variant-a opsA-dossier opsA-dossier--empty" data-contact-kind="other">
        <span className="opsA-empty-ring" aria-hidden="true" />
        <strong>ВЫБЕРИТЕ КОНТАКТ</strong>
        <p>Операционный брифинг появится здесь.</p>
      </aside>
    );
  }

  const kind = contactKind(operation, pirateContact, exploration);

  if (exploration) {
    const node = exploration.node;
    const known = exploration.recon?.success === true;
    const failed = exploration.recon?.success === false;
    const profile = explorationProfile(node.kind as 'unique' | 'anomaly', node.special?.profileVariant ?? 1);
    const completed = exploration.stage === 'completed';
    const accepted = exploration.stage === 'active';
    const resourceLabels: Record<ResourceIconKind, string> = {
      metal: 'Металл', minerals: 'Минералы', gas: 'Газ', debris: 'Обломки',
      energy: 'Энергия', population: 'Население',
    };
    const resourceRows = Object.entries(profile.weights).filter((entry) => (entry[1] ?? 0) > 0);
    const lastReturn = [...(exploration.contact?.events ?? [])].reverse().find(e =>
      (e.kind === 'returned' || e.kind === 'origin-destroyed') && e.ownerId === exploration.ownerId);
    const battleEvent=[...(exploration.contact?.events ?? [])].reverse()
      .find(event=>/:(capture|contest)$/.test(event.id));
    const combatReportId=battleEvent ? 'battle:battle-exploration-'+battleEvent.id.replace(/:(capture|contest)$/,'') : null;
    const cooldownAt = (exploration.recon?.resolvedAt ?? 0) + 120_000;
    const inCooldown = exploration.recon && cooldownAt > nowMs;
    const awaitingProbe = exploration.reconInFlight?.phase === 'outbound';
    const projected = exploration.contact?.claim ? reconcileExplorationContact(exploration.contact, nowMs) : exploration.contact;
    const mine = projected?.claim?.ownerId === exploration.ownerId ? projected.claim : undefined;
    const liveCargo = mine?.cargo;
    const liveCargoTotal = liveCargo ? Object.values(liveCargo).reduce((sum, value) => sum + value, 0) : 0;
    const riskRoman = ['I','II','III','IV','V'][profile.risk - 1]!;
    const delivered = lastReturn?.creditedCargo ?? lastReturn?.cargo;
    const deliveredTotal = delivered ? Object.values(delivered).reduce((sum, value) => sum + value, 0) : 0;
    const currentStage = exploration.reconInFlight?.phase === 'returning' ? 3
      : exploration.reconInFlight?.phase === 'outbound' ? 1
        : exploration.occupancy === 'self' ? 2 : 1;
    const hasObservedStage = Boolean(exploration.reconInFlight) || exploration.occupancy === 'self';
    const stageLabels = kind === 'anomaly'
      ? ['Принята', 'Сканирование', 'Сбор', 'Возврат']
      : ['Принята', 'Экспедиция в пути', 'Исследование / добыча', 'Возврат'];
    const success = lastReturn?.kind === 'returned';
    const failure = lastReturn?.kind === 'origin-destroyed';
    const occupancyLabel = exploration.occupancy === 'free' ? 'СВОБОДНО' : exploration.occupancy === 'self' ? 'ВАШ ФЛОТ' : 'ЗАНЯТО';
    const resourceTile: DossierMetric = known
      ? { label: 'РЕСУРС', value: resourceRows.map(([key]) => resourceLabels[key as ResourceIconKind]).join(' · '), note: resourceRows.map(([, weight]) => `${weight}%`).join(' / ') + ' выхода' }
      : { label: 'РАЗВЕДКА', value: failed ? 'Не удалась' : awaitingProbe ? 'Зонд в пути' : 'Нет данных', note: 'состав и риск скрыты', tone: 'bad' };
    const riskTile: DossierMetric = known
      ? { label: 'РИСК', value: `${profile.risk} / 5`, note: profile.risk < 3 ? 'низкий' : profile.risk < 5 ? 'повышенный' : 'высокий', tone: profile.risk < 3 ? 'good' : 'time' }
      : { label: 'РИСК', value: 'Неизвестен', note: 'до успешной разведки', tone: 'bad' };
    const metrics: DossierMetric[] = completed
      ? [
        { label: 'РЕЗУЛЬТАТ', value: success ? 'Исследовано' : failure ? 'Потеря флота' : 'Завершено', note: lastReturn ? new Date(lastReturn.at).toLocaleString('ru-RU') : 'время контакта истекло', tone: success ? 'good' : failure ? 'bad' : undefined },
        { label: 'ДОБЫТО', value: deliveredTotal > 0 ? `+${number.format(deliveredTotal)}` : 'Нет', note: deliveredTotal > 0 ? 'единиц по квитанции' : 'доставки не было', tone: deliveredTotal > 0 ? 'good' : undefined },
        { label: 'ЖЕТОН', value: lastReturn?.repairTokens ? `+${lastReturn.repairTokens}` : 'Не найден', note: known ? `шанс был ${formatPercent(profile.tokenP12 * 100)}` : 'жетон ремонта', tone: lastReturn?.repairTokens ? 'token' : undefined },
        riskTile,
      ]
      : accepted
        ? [
          { label: 'ЭТАП', value: exploration.reconInFlight ? (awaitingProbe ? 'Зонд в пути' : 'Зонд возвращается') : exploration.occupancy === 'self' ? 'Сбор ресурсов' : 'Подготовка', note: exploration.occupancy === 'self' ? 'ваш флот на объекте' : 'флот не отправлен' },
          { label: 'ДО ИСЧЕЗНОВЕНИЯ', value: pirateRemainingLabel(node.special?.expiresAt ?? nowMs, nowMs), note: 'срок контакта', tone: 'time' },
          liveCargo ? { label: 'ГРУЗ В ТРЮМЕ', value: number.format(liveCargoTotal), note: `из ${number.format(mine?.cargoCapacity ?? 0)}`, tone: 'good' } : resourceTile,
          riskTile,
        ]
        : [
          resourceTile,
          riskTile,
          ...(known ? [{ label: 'ЖЕТОН', value: formatPercent(profile.tokenP12 * 100), note: 'шанс за 12 мин работы', tone: 'token' as const }] : []),
          { label: 'ЗАНЯТОСТЬ', value: occupancyLabel, note: exploration.occupancy === 'free' ? 'никем не занят' : exploration.occupancy === 'self' ? 'ваш флот добывает' : 'занят чужим флотом', tone: exploration.occupancy === 'occupied' ? 'bad' : 'good' },
        ];
    const middle = completed
      ? <div className="opsA-result">
          <strong className={success ? 'is-good' : failure ? 'is-bad' : ''}>{success ? 'ИССЛЕДОВАНО' : failure ? 'ПРОВАЛ' : 'ЗАВЕРШЕНО'}</strong>
          <span>{lastReturn ? `Завершено ${new Date(lastReturn.at).toLocaleString('ru-RU')} · отчёт в «Сообщениях»` : 'Время контакта истекло.'}</span>
        </div>
      : accepted
        ? <>
            <OperationStageTimeline labels={stageLabels} currentIndex={currentStage} />
            {!hasObservedStage ? <small className="opsA-note">Фаза не определена: принятие завершено, следующий этап отмечен текущим.</small> : null}
          </>
        : node.special?.expiresAt
          ? <LifetimeBar expiresAt={node.special.expiresAt} startAt={node.special.startAt} nowMs={nowMs} note="Затем объект исчезнет с карты." />
          : null;
    const reportId = success && lastReturn ? 'exploration-return:' + lastReturn.flightId : null;
    return <DossierFrame
      kind={kind}
      completed={completed}
      dataAttrs={{ 'data-qa-exploration-dossier': node.id }}
      art={<img src={explorationOperationDetailArt(node.kind, node.art)} alt="" loading="lazy" draggable={false} />}
      chips={<>
        <KindChip kind={kind} />
        <button type="button" className="opsA-chip opsA-chip--link" onClick={() => onExplorationUniverse?.(node)} title="Открыть во Вселенной">{formatLocation(operation.location)} · {node.kind === 'anomaly' ? 'Сигнал аномалии' : 'Дальнее сканирование'} ↗</button>
        <span className={`opsA-chip opsA-chip--state is-${completed ? 'ended' : exploration.occupancy}`} data-qa-exploration-status={completed ? 'completed' : exploration.occupancy}>
          ● {completed ? 'ЗАВЕРШЕНО' : occupancyLabel}
        </span>
      </>}
      title={node.name}
      description={node.description}
      middle={middle}
      metrics={metrics}
      objective={operation.objective.label}
      status={{ label: 'СТАТУС', text: completed ? (success ? 'Завершена · ресурсы доставлены' : 'Завершена') : accepted ? 'В работе' : exploration.occupancy === 'occupied' ? 'Объект занят другим флотом' : 'Доступна к принятию' }}
      actions={<>
        {!completed && exploration.occupancy === 'free' && onBot01Occupy ? <button
          type="button" className="opsA-btn" data-qa-bot={node.id} data-qa-bot01-exploration={node.id}
          onClick={() => onBot01Occupy(node)}>ТЕСТ: BOT 01 · ЗАНЯТЬ</button> : null}
        {!completed && !accepted ? <>
          <button type="button" className="opsA-btn" disabled={!onExplorationUniverse} onClick={() => onExplorationUniverse?.(node)}>ПОКАЗАТЬ НА КАРТЕ</button>
          <button className="opsA-btn opsA-btn--primary" type="button"
            data-qa-exploration-accept={node.id} onClick={() => onExplorationAccept?.(node)}>ПРИНЯТЬ ОПЕРАЦИЮ</button>
        </> : null}
        {!completed && accepted ? <>
          <button type="button" className="opsA-btn" data-qa-exploration-recon={node.id}
            disabled={!onExplorationRecon || Boolean(inCooldown) || Boolean(exploration.reconInFlight)}
            title={inCooldown ? 'Повторное исследование доступно после паузы' : 'Отправить один шпионский зонд с текущей планеты'}
            onClick={() => onExplorationRecon?.(node)}>{exploration.reconInFlight ? 'ЗОНД В ПУТИ' : 'ИССЛЕДОВАТЬ ЗОНДОМ'}</button>
          {exploration.occupancy === 'free'
            ? <button type="button" className="opsA-btn opsA-btn--primary" disabled={!onExpedition}
                data-qa-operation-expedition={node.id} onClick={() => onExpedition?.(node)}>ПОДГОТОВИТЬ ЭКСПЕДИЦИЮ</button>
            : exploration.occupancy === 'self'
              ? <button type="button" className="opsA-btn opsA-btn--primary" onClick={onOpenFleets}>К ФЛОТАМ · ОТОЗВАТЬ</button>
              : <button type="button" className="opsA-btn opsA-btn--primary" data-qa-exploration-attack={node.id} disabled={!onExplorationAttack} onClick={() => onExplorationAttack?.(node)}>АТАКОВАТЬ ОБЪЕКТ</button>}
          <button type="button" className="opsA-btn opsA-btn--danger"
            onClick={() => onExplorationCancel?.(node.id)}>ОТМЕНИТЬ</button>
        </> : null}
        {completed && reportId && onExplorationReport ? <button type="button" className="opsA-btn opsA-btn--primary" onClick={() => onExplorationReport(reportId)}>ОТКРЫТЬ ОТЧЁТ</button> : null}
      </>}
    >
      <section className="opsA-section">
        <header><strong>ИССЛЕДОВАНИЕ ОБЪЕКТА</strong><span>{known ? 'ДАННЫЕ ПОЛУЧЕНЫ' : awaitingProbe ? 'ЗОНД В ПУТИ' : failed ? 'ЗОНД НЕ ПОЛУЧИЛ ДАННЫЕ' : 'НЕТ РАЗВЕДДАННЫХ'}</span></header>
        <p>{awaitingProbe ? 'Зонд направляется к объекту. Отчёт появится после прибытия.' : known
          ? 'Зонд успешно исследовал объект. Ниже показан подтверждённый профиль добычи.'
          : failed
            ? 'Попытка исследования оказалась неудачной. Сведения о составе ресурсов пока скрыты.'
            : 'Отправьте один шпионский зонд. Результат станет известен после его прибытия; шанс успешного исследования — 70%.'}</p>
        <div className="opsA-section-grid">
          <div className="opsA-subcard">
            <small>РАЗВЕДАННЫЕ ЗАПАСЫ · ОСТАТОК / ИСХОДНОЕ</small>
            {known ? <div className="opsA-res-chips">
              {resourceRows.map(([key, weight]) =>
                <span key={key} className="opsA-res-chip">
                  <ResourceIcon kind={key as ResourceIconKind} />
                  <b>{resourceLabels[key as ResourceIconKind]}</b>
                  <em>{number.format(exploration.contact?.resourceReserve[key as 'metal' | 'minerals' | 'gas' | 'debris'] ?? 0)} / {number.format(exploration.contact?.initialReserve[key as 'metal' | 'minerals' | 'gas' | 'debris'] ?? 0)} · {weight}%</em>
                </span>)}
            </div> : <div className="opsA-res-unknown">
              {(['metal', 'minerals', 'gas', 'debris'] as const).map(entry =>
                <ResourceIcon key={entry} kind={entry} />)}
              <span>Состав скрыт до успешного исследования</span>
            </div>}
          </div>
          <div className="opsA-subcard">
            <small>КАТЕГОРИЯ РИСКА</small>
            {known ? <>
              <div className="opsA-risk" aria-label={'Категория риска ' + riskRoman + ' из V'}>
                {([1,2,3,4,5] as const).map(level => <span className={level <= profile.risk ? 'active' : ''} key={level}>{['I','II','III','IV','V'][level-1]}</span>)}
              </div>
              <strong>{riskRoman} / V · {profile.risk < 3 ? 'НИЗКИЙ' : profile.risk < 5 ? 'ПОВЫШЕННЫЙ' : 'ВЫСОКИЙ'}</strong>
            </> : <strong>Неизвестен до разведки</strong>}
            <p>{known ? 'По проектной модели уровень ' + riskRoman + ' предполагает ' + Math.round(EXPLORATION_RULES.npcAttemptChance[profile.risk] * 100) + '% шанса попытки захвата конкурентом каждые 3 минуты. ' : 'До разведки класс опасности неизвестен. '}Аномалии могут сжигать до 10% накопленного груза при всплеске раз в 3 минуты. В обычной игре NPC при успешной проверке риска отправляет настоящий флот только со своей существующей планеты; при отсутствии таких планет рейса не будет. В Test Mode NPC-рейс запускается вручную.</p>
          </div>
        </div>
        {(combatReportId && onExplorationReport) || (exploration.recon && onExplorationReport) ? <div className="opsA-links">
          {combatReportId && onExplorationReport ? <button type="button" data-qa-exploration-battle-report={combatReportId} className="opsA-link"
            onClick={() => onExplorationReport(combatReportId)}>БОЕВОЙ ДОКЛАД · ОТКРЫТЬ В «СООБЩЕНИЯХ» ↗</button> : null}
          {exploration.recon && onExplorationReport ? <button type="button" className="opsA-link" onClick={() => onExplorationReport('exploration-recon:' + exploration.recon!.flightId)}>ОТКРЫТЬ РАЗВЕДОТЧЁТ В «СИСТЕМЕ» ↗</button> : null}
        </div> : null}
        {exploration.recon ? <small className="opsA-note">Последний разведотчёт: {new Date(exploration.recon.resolvedAt).toLocaleString('ru-RU')}
          {inCooldown ? ' · повтор через ' + Math.ceil((cooldownAt - nowMs) / 1000) + ' с' : ''}</small> : null}
      </section>
      {mine && <section className="opsA-section" data-qa-exploration-live-cargo>
        <header><strong>ТЕКУЩАЯ ДОБЫЧА ВАШЕГО ФЛОТА</strong><span>Трюм: {number.format(liveCargoTotal)} / {number.format(mine.cargoCapacity)}</span></header>
        <div className="opsA-bar"><i style={{width: Math.min(100, (liveCargoTotal / Math.max(1, mine.cargoCapacity)) * 100) + '%'}} /></div>
        <div className="opsA-res-chips">{(['metal','minerals','gas','debris'] as const).map(key =>
          <span key={key} className="opsA-res-chip"><ResourceIcon kind={key} /><b>{resourceLabels[key]}</b><em>{number.format(liveCargo?.[key] ?? 0)}</em></span>)}</div>
        <small className="opsA-note">Обломки добывают только переработчики. Всё добытое попадёт на исходную планету только после возвращения.</small>
      </section>}
      {completed ? <section className="opsA-section">
        <header><strong>ИТОГ ОПЕРАЦИИ</strong></header>
        {success && lastReturn ? <>
          <p>{deliveredTotal > 0 ? 'Доставка подтверждена на планету ' + lastReturn.originPlanetId + '. Обломки находятся в запасе переработки, не на обычных складах.' : 'Экспедиция вернулась без добычи. Для сбора обломков нужны переработчики, транспортёры их не добывают.'}</p>
          <div className="opsA-res-chips">
            {(['metal','minerals','gas','debris'] as const).map(key =>
              <span key={key} className="opsA-res-chip"><ResourceIcon kind={key} /><b>{resourceLabels[key]}</b><em>{number.format(delivered?.[key] ?? 0)}</em></span>)}
          </div>
          {lastReturn.repairTokens ? <p>Редкие жетоны ремонта: +{lastReturn.repairTokens}</p> : null}
        </> : <p>Время контакта истекло. Подтверждённой доставки ресурсов по этому циклу нет.</p>}
      </section> : null}
    </DossierFrame>;
  }

  const pirate = kind === 'pirate';
  const intelZero = operation.intel === 0 && !pirate;
  const modifierLabels = operation.modifiers.map((modifier) => OPERATION_MODIFIER_LABELS[modifier]);
  const reconLabel = pirateContact?.latestReportOutcome === 'success' ? 'Разведданные получены'
    : pirateContact?.latestReportOutcome === 'failure' ? 'Разведка не удалась'
      : pirateContact?.statusLabel === 'Зонд в пути' ? 'Зонд в пути' : 'Нет данных';
  const threatTile: DossierMetric | null = typeof threatPercent === 'number'
    ? { label: 'УГРОЗА СИСТЕМЕ', value: formatPercent(threatPercent), note: 'снизится при полной победе', tone: 'time' } : null;

  if (pirate && completed) {
    const cycle = completed.cycleKey.split(':');
    const metrics: DossierMetric[] = [
      { label: 'РЕЗУЛЬТАТ', value: 'Победа', note: `бой завершён за ${completed.rounds} р.`, tone: 'good' },
      { label: 'ОБЛОМКИ', value: `+${number.format(completed.debris)}`, note: 'на орбите базы', tone: 'good' },
      ...(completed.reward ? [
        { label: 'ОТПРАВЛЕНО', value: number.format(completed.reward.sentCombatPopulation), note: `из ангара ${number.format(completed.reward.historicalHangarCapacity)}` },
        { label: 'УГРОЗА СИСТЕМЕ', value: `−${(completed.reward.threatReductionFraction * 100).toFixed(1)}%`, note: 'снижена победой', tone: 'good' as const },
      ] : [{ label: 'РАУНДОВ', value: String(completed.rounds), note: 'по боевому расчёту' }]),
    ];
    return (
      <DossierFrame
        kind="pirate"
        completed
        className="operations-completed-report-v2"
        art={<div className="opsA-art-wrap" data-qa-pirate-hero-art>
          <img src={getPiratePlanetOperationDetailArt(Number(cycle[2] ?? 1), Number(cycle[3] ?? 0))} alt="Пиратская база" loading="lazy" draggable={false} />
        </div>}
        chips={<><KindChip kind="pirate" /><span className="opsA-chip">{formatLocation(operation.location)}</span><span className="opsA-chip opsA-chip--state is-good">● УСПЕХ</span></>}
        title="Пиратская база"
        description="Гарнизон базы уничтожен. Обломки остались на орбите — для сбора отправьте переработчиков."
        middle={<div className="opsA-result">
          <strong className="is-good">ПОБЕДА</strong>
          <span>Завершено {new Date(completed.defeatedAt).toLocaleString('ru-RU')} · отчёт сохранён в «Сообщениях»</span>
        </div>}
        metrics={metrics}
        objective="Пиратская база уничтожена."
        status={{ label: 'СТАТУС', text: 'Завершена · победа подтверждена' }}
        actions={<button type="button" className="opsA-btn opsA-btn--primary"
          onClick={() => onPirateBattleReport?.(completed.reportId)}>ОТКРЫТЬ БОЕВОЙ ОТЧЁТ</button>}
      >
        <section className="opsA-section">
          <header><strong>БОЕВОЙ ОТЧЁТ</strong><span>РЕЗУЛЬТАТ СОХРАНЁН В «ДОКЛАДАХ»</span></header>
          <div className="opsA-facts">
            <div><small>ИСХОД</small><strong>ПОБЕДА</strong></div>
            <div><small>РАУНДОВ</small><strong>{completed.rounds}</strong></div>
            {completed.reward ? <>
              <div><small>ОТПРАВЛЕНО / ВМЕСТИМОСТЬ ФЛОТА</small><strong>{number.format(completed.reward.sentCombatPopulation)} / {number.format(completed.reward.historicalHangarCapacity)}</strong></div>
              <div><small>МНОЖИТЕЛЬ ОБЛОМКОВ</small><strong>×{completed.reward.multiplier}</strong></div>
              <div><small>ПИРАТСКИЕ ОБЛОМКИ / БОНУС</small><strong>{number.format(completed.reward.basePirateDebris)} / {completed.reward.bonusPirateDebris>=0?'+':'−'}{number.format(Math.abs(completed.reward.bonusPirateDebris))}</strong></div>
              <div><small>СВОИ ОБЛОМКИ</small><strong>{number.format(completed.reward.ownDebris)}</strong></div>
              <div><small>СНИЖЕНИЕ УГРОЗЫ</small><strong>{(completed.reward.threatReductionFraction*100).toFixed(1)}%</strong></div>
            </> : null}
            <div><small>ОБЛОМКИ НА ОРБИТЕ</small><strong><ResourceIcon kind="debris" /> {number.format(completed.debris)}</strong></div>
            <div><small>ЗАВЕРШЕНО</small><strong>{new Date(completed.defeatedAt).toLocaleString('ru-RU')}</strong></div>
          </div>
        </section>
      </DossierFrame>
    );
  }

  const pirateArtCoordinates = (() : [number, number] => {
    const parts = (pirateContact?.contactCycleKey ?? operation.id.replace(/^pirate:/,'')).split(':');
    return [Number(parts[2] ?? 1), Number(parts[3] ?? 0)];
  })();
  const pirateArt = pirate ? getPiratePlanetArt(...pirateArtCoordinates) : null;
  const pirateHeroArt = pirate ? getPiratePlanetOperationDetailArt(...pirateArtCoordinates) : null;
  const pirateStartAt = pirateContact ? Number(pirateContact.contactCycleKey.split(':')[4]) : undefined;
  const isActive = operation.state === 'active';
  const isCompleted = operation.state === 'completed';

  const metrics: DossierMetric[] = pirate ? [
    { label: 'РАЗВЕДКА', value: reconLabel, note: pirateContact?.latestReportId ? 'отчёт в «Системе»' : 'Отправь зонд, чтобы узнать состав', tone: pirateContact?.latestReportOutcome === 'success' ? 'good' : 'bad' },
    { label: 'ОБЛОМКИ', value: '125–175%', note: 'жизни уничтоженных пиратов', tone: 'good' },
    ...(isActive && pirateContact ? [{ label: 'ДО ИСЧЕЗНОВЕНИЯ', value: pirateRemainingLabel(pirateContact.expiresAt, nowMs), note: 'успейте провести рейд', tone: 'time' as const }] : []),
    ...(threatTile ? [threatTile] : []),
  ] : [
    { label: 'РАЗВЕДДАННЫЕ', value: `${operation.intel} / 3`, note: 'подтверждённый уровень' },
    ...(operation.threat ? [{ label: 'РИСК', value: threatText(operation), note: 'текущий источник данных' }] : []),
    ...rewardEntries(operation).slice(0, 2).map(([label, value]) => ({ label, value: number.format(value), note: 'предпросмотр награды' })),
  ];

  const middle = isActive
    ? <>
        <OperationStageTimeline labels={pirate ? ['Принята', 'Флот в пути', 'Бой', 'Возврат'] : ['Принята', 'Выполнение', 'Завершение', 'Возврат']} currentIndex={1} />
        <small className="opsA-note">Фаза не определена: принятие завершено, следующий этап отмечен текущим.</small>
      </>
    : pirateContact
      ? <LifetimeBar expiresAt={pirateContact.expiresAt} startAt={pirateStartAt} nowMs={nowMs} note="Затем — 15-минутная пауза до нового ролла появления базы." />
      : null;

  return (
    <DossierFrame
      kind={kind}
      completed={isCompleted}
      dataAttrs={{ 'data-threat': String(operation.threat ?? 'unknown') }}
      art={pirateArt
        ? <div className="opsA-art-wrap" data-qa-pirate-hero-art><img src={pirateHeroArt ?? pirateArt} alt="Пиратская база" loading="lazy" draggable={false} /></div>
        : <TacticalScope operation={operation} contact={pirateContact} />}
      chips={<>
        <KindChip kind={kind} />
        <span className="opsA-chip">{intelZero ? formatLocationClass(operation.location) : formatLocation(operation.location)} · {OPERATION_SOURCE_LABELS[operation.source]}</span>
        <span className={`opsA-chip opsA-chip--state ${isActive ? 'is-active' : isCompleted ? 'is-ended' : 'is-alert'}`}>● {pirate ? pirateContact ? isActive ? 'В РАБОТЕ' : 'ОБНАРУЖЕН' : 'ИСТЁК' : isActive ? 'В РАБОТЕ' : isCompleted ? 'ЗАВЕРШЕНО' : 'ДОСТУПНО'}</span>
      </>}
      title={operation.title}
      description={pirate ? pirateContact ? `Действующая база в системе вашей колонии. ${pirateCoordinateLabel(pirateContact)}.` : 'Цикл закончился или цель исчезла. На прежние координаты рейд не отправляется.' : intelZero ? 'Сенсоры фиксируют нестабильный источник неизвестного происхождения. До глубокого сканирования тип объекта, точная угроза и возможная награда скрыты.' : operation.briefing}
      middle={middle}
      metrics={metrics}
      objective={operation.objective.label}
      status={{ label: 'СТАТУС', text: isActive ? 'В работе' : isCompleted ? 'Завершена' : intelZero ? 'Требуется сканирование' : 'Доступна к принятию' }}
      actions={<>
        {pirate && isCompleted && battleReportId && onPirateBattleReport ? <button type="button" className="opsA-btn opsA-btn--primary" onClick={() => onPirateBattleReport(battleReportId)}>ОТКРЫТЬ БОЕВОЙ ОТЧЁТ</button> : null}
        {pirate ? pirateContact && operation.state === 'available'
          ? <>
              <button type="button" className="opsA-btn" disabled={!onPirateUniverse} onClick={() => onPirateUniverse?.(pirateContact)}>ПОКАЗАТЬ НА КАРТЕ</button>
              <button type="button" className="opsA-btn opsA-btn--primary" onClick={() => onAccept(operation.id)}>ПРИНЯТЬ ОПЕРАЦИЮ</button>
            </>
          : pirateContact && isActive ? <>
              {pirateContact.latestReportId && onPirateReport ? <button type="button" className="opsA-btn" onClick={() => onPirateReport(pirateContact.latestReportId!)}>РАЗВЕДОТЧЁТ ↗</button> : null}
              <button type="button" className="opsA-btn" disabled={!onPirateUniverse} onClick={() => onPirateUniverse?.(pirateContact)}>НА КАРТЕ</button>
              <button type="button" className="opsA-btn" disabled={!pirateContact.recon.enabled || !onPirateRecon} title={pirateContact.recon.disabledReason ?? ''} onClick={() => onPirateRecon?.(pirateContact)}>ОТПРАВИТЬ ЗОНД</button>
              <button type="button" className="opsA-btn opsA-btn--primary" disabled={!pirateContact.elimination.enabled || !onPirateAttack} onClick={() => onPirateAttack?.(pirateContact)}>ПОДГОТОВИТЬ РЕЙД</button>
              <button type="button" className="opsA-btn opsA-btn--danger" onClick={() => onCancel(operation.id)}>ОТМЕНИТЬ</button>
            </> : null
        : <>
          {!intelZero && operation.state === 'available' ? <button type="button" className="opsA-btn opsA-btn--primary" onClick={() => onAccept(operation.id)}>ПРИНЯТЬ ОПЕРАЦИЮ</button> : null}
          {isActive ? <button type="button" className="opsA-btn opsA-btn--primary" onClick={onOpenFleets}>К ФЛОТАМ</button> : null}
          {isActive ? <button type="button" className="opsA-btn opsA-btn--danger" onClick={() => onCancel(operation.id)}>ОТМЕНИТЬ</button> : null}
        </>}
      </>}
    >
      {pirate ? null : intelZero ? (
        <section className="opsA-section">
          <header><strong>КЛАСС КОНТАКТА · НЕИЗВЕСТЕН</strong><span>ВОЗМОЖНЫЙ РИСК {operation.threatRange ? `${ROMAN_THREAT[operation.threatRange[0]]}–${ROMAN_THREAT[operation.threatRange[1]]}` : '?'}</span></header>
          <p>Сканирование классифицирует сигнал и заменит его конкретной операцией. Результат фиксирован и сохраняется в текущем save.</p>
        </section>
      ) : (
        <div className="opsA-section-grid">
          <section className="opsA-subcard">
            <small>УСЛОВИЯ КОНТАКТА</small>
            <div className="opsA-res-chips">{modifierLabels.length ? modifierLabels.map((label) => <span className="opsA-res-chip" key={label}>{label}</span>) : <span className="opsA-res-chip">Без особых условий</span>}</div>
          </section>
          <section className="opsA-subcard">
            <small>НАГРАДА · ПРЕДПРОСМОТР</small>
            <RewardPreview operation={operation} />
          </section>
        </div>
      )}
    </DossierFrame>
  );
}

export function OperationsView({ state, onAccept, onCancel, onOpenFleets, explorationContacts = [], onExpedition, onExplorationAttack, onBot01Occupy, onExplorationAccept, onExplorationCancel, onExplorationRecon, onExplorationUniverse, onExplorationReport, pirateContacts = [], pirateThreatPercent = 2, pirateAdaptiveDiagnostics, onPirateBattleExport, pirateRaidRolls = {}, pirateOwnerId = '', pirateCheckDelayMs, completedPirateOperations = [], nowMs = Date.now(), onPirateAccept, onPirateCancel, onPirateRecon, onPirateAttack, onPirateReport, onPirateBattleReport, onPirateUniverse }: OperationsViewProps) {
  const [tab, setTab] = useState<OperationsTab>('available');
  const [selectedId, setSelectedId] = useState<OperationId | null>(null);
  const [contactFilter, setContactFilter] = useState<ContactFilter>('all');

  const operationRows = useMemo((): OperationRow[] => {
    // Stored items are only accepted pirate cycles (migration drops old demo records).
    const normal: OperationRow[] = state.items
      .filter((item) => !isPirateOperationId(item.id))
      .map((operation) => ({ operation }));
    const acceptedIds = new Set(state.items.filter((item) => isPirateOperationId(item.id) && item.state === 'active').map((item) => item.id));
    const live: OperationRow[] = pirateContacts.map((contact) => ({
      operation: pirateContactOperation(contact, acceptedIds.has(pirateOperationId(contact.contactCycleKey)) ? 'active' : 'available'),
      contact,
    }));
    const completed: OperationRow[] = completedPirateOperations.map((entry) => ({
      operation: pirateCycleOperation(entry.cycleKey, entry.coordinate, 'completed'),
      battleReportId: entry.reportId,
      completed: entry,
    }));
    const exploration: OperationRow[] = explorationContacts.map((entry) => {
      const {node, occupancy} = entry;
      return {
      exploration: entry,
      operation: {
        id: 'explore:' + node.id,
        archetype: node.kind === 'anomaly' ? 'anomaly_scan' : 'derelict_recovery',
        category: node.kind === 'anomaly' ? 'science' : 'exploration',
        title: node.name.toUpperCase(),
        briefing: node.description,
        state: entry.stage,
        threat: explorationProfile(node.kind as 'unique' | 'anomaly', node.special?.profileVariant ?? 1).risk,
        intel: entry.recon?.success ? 3 : 0, source: 'deep_scan',
        location: { kind: 'coordinates', coordinates: '[' + node.coordinate.galaxy + ':' + node.coordinate.system + ':' + node.coordinate.position + ']' },
        objective: { label: occupancy === 'free' ? 'Отправить экспедицию' : 'Объект уже занят' },
        modifiers: [], rewardPreview: {},
      },
      };
    });
    return [...live, ...exploration, ...completed, ...normal];
  }, [state.items, pirateContacts, explorationContacts, completedPirateOperations]);

  const tabRows = useMemo(() => operationRows.filter(({ operation }) => operation.state === tab), [operationRows, tab]);
  const visibleRows = useMemo(() => tabRows.filter((row) => contactFilter === 'all'
    || contactKind(row.operation, row.contact, row.exploration) === contactFilter), [tabRows, contactFilter]);
  const selectedRow = visibleRows.find(({ operation }) => operation.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedRow) return;
    setSelectedId(visibleRows[0]?.operation.id ?? null);
  }, [selectedRow, visibleRows]);

  const chooseTab = (next: OperationsTab) => {
    setTab(next);
    setSelectedId(null);
  };

  const accept = (operationId: OperationId) => {
    const row = operationRows.find(({ operation }) => operation.id === operationId);
    if (row?.exploration) onExplorationAccept?.(row.exploration.node);
    else if (row?.contact) onPirateAccept?.(row.contact);
    else onAccept(operationId);
    setTab('active');
    setSelectedId(operationId);
  };

  const cancel = (operationId: OperationId) => {
    const row = operationRows.find(({ operation }) => operation.id === operationId);
    if (row?.exploration) onExplorationCancel?.(row.exploration.node.id);
    else if (row?.contact) onPirateCancel?.(row.contact);
    else onCancel(operationId);
    setTab('available');
    setSelectedId(operationId);
  };

  return (
    <main className="operations-shell-v2 operations-shell-v2--variant-a opsA">
      <header className="opsA-top">
        <div className="opsA-top-title">
          <small>ОПЕРАЦИОННЫЙ ЦЕНТР</small>
          <h1>ОПЕРАЦИИ</h1>
        </div>
        <div className="opsA-threat" aria-label="Пиратская угроза">
          <span className="opsA-gauge" role="progressbar" aria-label="Пиратская угроза от 2% до 30%"
            aria-valuemin={2} aria-valuemax={30} aria-valuenow={pirateThreatPercent}
            title="Вероятность отправки рейда при проверке одной пиратской базы в одной системе. Каждая система проверяется отдельно — это не шанс победы пиратов или уничтожения планеты. Чем меньше боевых очков относительно ресурсных, тем быстрее растёт угроза. Полная победа над базой снижает её пропорционально отправленному боевому населению."
            style={{ ['--p' as string]: `${Math.max(0, Math.min(100, pirateThreatPercent))}%` }}>
            <span>{formatPercent(pirateThreatPercent)}</span>
          </span>
          <span className="opsA-threat-copy"><b>ПИРАТСКАЯ УГРОЗА</b><small>Шанс рейда при проверке одной базы. Растёт, если боевых очков мало.</small></span>
        </div>
        <nav className="operations-tabs-v2 opsA-tabs" role="tablist" aria-label="Состояние операций">
          {(Object.keys(TAB_LABELS) as OperationsTab[]).map((entry) => (
            <button key={entry} type="button" role="tab" aria-selected={tab === entry} className={tab === entry ? 'active' : ''} onClick={() => chooseTab(entry)}>
              <span>{TAB_LABELS[entry]}</span><b>{operationRows.filter(({ operation }) => operation.state === entry).length}</b>
            </button>
          ))}
        </nav>
        <div className="opsA-bases"><small>ПИРАТСКИЕ БАЗЫ</small><strong>{pirateContacts.length} <span>активны</span></strong></div>
      </header>
      {pirateAdaptiveDiagnostics && (() => {
        const d=pirateAdaptiveDiagnostics;
        const band=pirateAdaptiveInterval(d.q);
        const attempts=d.wins+d.draws+d.losses;
        const pct=(v:number)=>`${(v*100).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
        return <section className="operations-pirate-adaptive-test-v1 opsA-test" aria-label="Диагностика пиратов Test Mode" data-qa-pirate-adaptive-test
          title="Индекс влияет только на случайный размер гарнизона. Не назначает исход боя. Дешёвые незначимые бои не меняют его.">
          <strong>TEST MODE</strong>
          <span>Победы <b data-qa-pirate-win-rate>{attempts?pct(d.wins/attempts):'—'}</b> ({d.wins}/{attempts})</span>
          <span>Взвеш. <b data-qa-pirate-weighted-win>{d.weightedBattles>0?pct(d.weightedWins/d.weightedBattles):'—'}</b></span>
          <span>Q <b data-qa-pirate-q>{pct(d.q)}</b></span>
          <span>Гарнизон <b data-qa-pirate-next-band>{pct(band.min)}–{pct(band.max)}</b></span>
          <span>Последний ролл <b data-qa-pirate-last-roll>{d.lastRoll ? pct(d.lastRoll.coefficient) : '—'}</b>{d.lastRoll?' от '+d.lastRoll.sentPopulation.toLocaleString('ru-RU'):''}</span>
          {onPirateBattleExport && <button type="button" className="opsA-btn opsA-btn--small"
            data-qa-pirate-export onClick={onPirateBattleExport}
            title="Скачать все бои текущего игрока с пиратскими базами: составы флотов, потери, раунды и коэффициенты">
            СКАЧАТЬ ВСЕ БОИ (JSON)
          </button>}
        </section>;
      })()}
      <div className="operations-layout-v2 opsA-grid">
        <section className="operations-feed-v2 opsA-list" aria-label={TAB_LABELS[tab]}>
          <header className="opsA-list-head"><div><small>{tab === 'completed' ? 'АРХИВ // ЗАВЕРШЁННЫЕ' : tab === 'active' ? 'КАНАЛ // В РАБОТЕ' : 'КАНАЛ // ДОСТУПНЫЕ'}</small>
            <strong>{tab === 'available' ? 'ВХОДЯЩИЕ КОНТАКТЫ' : tab === 'active' ? 'ПРИНЯТЫЕ ОПЕРАЦИИ' : 'ИТОГИ ОПЕРАЦИЙ'}</strong></div>
            <span className="opsA-chip">{visibleRows.length}</span></header>
          <nav className="operations-contact-filters-v-a opsA-filters" aria-label="Фильтр типа контакта">
            {([
              ['all', 'ВСЕ'], ['pirate', 'ПИРАТЫ'], ['unique', 'ОБЪЕКТЫ'], ['anomaly', 'АНОМАЛИИ'],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" data-filter-kind={value} aria-pressed={contactFilter === value}
                className={`opsA-chip opsA-chip--${value === 'all' ? 'other' : value} ${contactFilter === value ? 'active' : ''}`} onClick={() => setContactFilter(value)}>{label}</button>
            ))}
          </nav>
          <div className="operations-feed-scroll-v2 opsA-list-scroll">
            {visibleRows.length ? <div className="opsA-list-items">
              {visibleRows.map((row) => <OperationCard
                key={row.operation.id}
                operation={row.operation}
                contact={row.contact}
                exploration={row.exploration}
                nowMs={nowMs}
                pirateCheckDelayMs={pirateCheckDelayMs}
                pirateRaidRoll={row.contact ? pirateRaidRolls[JSON.stringify([pirateOwnerId,row.contact.contactCycleKey])] : undefined}
                selected={row.operation.id === selectedRow?.operation.id}
                onSelect={() => setSelectedId(row.operation.id)}
              />)}
            </div> : <EmptyState tab={tab} />}
          </div>
        </section>
        <OperationDossier
          key={selectedRow?.operation.id ?? 'empty'}
          operation={selectedRow?.operation ?? null}
          pirateContact={selectedRow?.contact}
          exploration={selectedRow?.exploration}
          onExpedition={onExpedition}
          onExplorationAttack={onExplorationAttack}
          onBot01Occupy={onBot01Occupy}
          onExplorationAccept={(node) => accept('explore:' + node.id)}
          onExplorationCancel={(id) => cancel('explore:' + id)}
          onExplorationRecon={onExplorationRecon}
          onExplorationUniverse={onExplorationUniverse}
          onExplorationReport={onExplorationReport}
          battleReportId={selectedRow?.battleReportId}
          completed={selectedRow?.completed}
          nowMs={nowMs}
          threatPercent={pirateThreatPercent}
          onAccept={accept}
          onCancel={cancel}
          onOpenFleets={onOpenFleets}
          onPirateRecon={onPirateRecon}
          onPirateAttack={onPirateAttack}
          onPirateReport={onPirateReport}
          onPirateBattleReport={onPirateBattleReport}
          onPirateUniverse={onPirateUniverse}
        />
      </div>
    </main>
  );
}
