import { useEffect, useMemo, useState } from 'react';

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
import { getPiratePlanetArt } from './pirate-planet-art.ts';
import { explorationProfile, EXPLORATION_RULES } from './domain/exploration/model.ts';
import { reconcileExplorationContact } from './domain/exploration/ledger.ts';
import type { ExplorationOperationPresentation } from './application/exploration.ts';
import type { UniversePlanetNode } from './domain/universe/types.ts';
import './operations.css';

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
  onReveal: (operationId: OperationId) => void;
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

type DossierMetric = { label: string; value: string; note?: string; tone?: 'good' | 'bad' | 'time' | 'token' };

function DossierMetrics({ items }: { items: readonly DossierMetric[] }) {
  if (!items.length) return null;
  return <section className="operations-metrics-v-a" aria-label="Сводные данные операции">
    {items.slice(0, 4).map((item) => <div className={`operations-metric-v-a ${item.tone ? `is-${item.tone}` : ''}`} key={item.label}>
      <small>{item.label}</small><strong>{item.value}</strong>{item.note ? <span>{item.note}</span> : null}
    </div>)}
  </section>;
}

function OperationStageTimeline({ labels, currentIndex }: { labels: readonly string[]; currentIndex: number }) {
  return <ol className="operations-stage-timeline-v-a" aria-label="Этапы операции">
    {labels.map((label, index) => <li key={label} className={index < currentIndex ? 'is-complete' : index === currentIndex ? 'is-current' : 'is-future'}
      aria-current={index === currentIndex ? 'step' : undefined}>
      <span className="operations-stage-track-v-a" aria-hidden="true" />
      <span className="operations-stage-dot-v-a" aria-hidden="true" />
      <small>{label}</small>
    </li>)}
  </ol>;
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
  const firstReward = rewardEntries(operation)[0];
  const kind = contactKind(operation, contact, exploration);
  const pirate = kind === 'pirate';
  const pirateCycle = pirate ? (contact?.contactCycleKey ?? operation.id.slice('pirate:'.length)).split(':') : [];
  const pirateArt = pirate ? getPiratePlanetArt(Number(pirateCycle[2]), Number(pirateCycle[3])) : null;
  const raidCheck = contact ? getPirateRaidCheckProgress(Number(pirateCycle[4]), nowMs,pirateCheckDelayMs) : null;
  const expiresAt = exploration?.node.special?.expiresAt ?? contact?.expiresAt;
  const progress = operation.state === 'completed' ? 100
    : operation.state === 'active' ? undefined
      : pirate ? lifetimePercent(Number(pirateCycle[4]), expiresAt, nowMs)
        : explorationLifetimePercent(exploration, nowMs);
  const remaining = expiresAt ? compactRemaining(expiresAt, nowMs) : '';
  const lastEvent = [...(exploration?.contact?.events ?? [])].reverse()
    .find((event) => event.ownerId === exploration?.ownerId && (event.kind === 'returned' || event.kind === 'origin-destroyed'));
  const completedResult = pirate ? 'success' : lastEvent?.kind === 'returned' ? 'success' : lastEvent?.kind === 'origin-destroyed' ? 'failure' : 'unknown';
  const completionLabel = completedResult === 'success'
    ? (exploration ? 'Исследовано' : 'Победа')
    : completedResult === 'failure' ? 'Поражение' : 'Завершено';
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

  return (
    <button
      type="button"
      className={`operation-feed-card-v2 operation-feed-card-v2--${operation.category} ${selected ? 'selected' : ''}`}
      data-contact-kind={kind}
      data-completion-result={operation.state === 'completed' ? completedResult : undefined}
      data-threat={operation.threat ?? 'unknown'}
      data-qa-pirate-contact={contact?.contactCycleKey}
      aria-label={`${CONTACT_LABELS[kind]}: ${operation.title}. ${statusText}`}
      onClick={onSelect}
    >
      <span className={`operation-feed-art-v-a ${pirate ? 'operation-feed-pirate-art-v2' : ''}`}>
        {exploration
          ? <img src={exploration.node.art} alt="" loading="lazy" draggable={false} />
          : pirateArt
          ? <img src={pirateArt} alt="" loading="lazy" draggable={false} />
          : <span className="operation-feed-glyph-v-a"><OperationGlyph category={operation.category} /></span>}
      </span>
      <span className="operation-feed-copy-v2">
        <span className="operation-feed-type-line-v-a">
          <small className="operation-feed-kind-chip-v-a">{CONTACT_LABELS[kind]}</small>
          {exploration ? <span className={'exploration-feed-occupancy exploration-feed-occupancy--' + (exploration.stage === 'completed' ? 'ended' : exploration.occupancy)}
            data-qa-exploration-feed-status={exploration.stage === 'completed' ? 'completed' : exploration.occupancy}>
            <span className="exploration-occupancy-indicator" />
            {exploration.stage === 'completed' ? 'ЗАВЕРШЕНО' : exploration.occupancy === 'free' ? 'СВОБОДНО' : exploration.occupancy === 'self' ? 'ВАШ ФЛОТ' : 'ЗАНЯТО'}
          </span> : null}
        </span>
        <strong className="operation-feed-title-v-a" title={operation.title}>{operation.title}</strong>
        <span className="operation-feed-subtitle-v-a">
          <i>{formatLocation(operation.location)}</i><span aria-hidden="true">·</span>
          <em className={operation.state === 'available' ? 'is-time' : operation.state === 'completed' ? `is-${completedResult}` : ''}>
            {operation.state === 'available' && expiresAt ? <>Исчезнет через <b>{pirateRemainingLabel(expiresAt, nowMs)}</b></> : statusText}
          </em>
        </span>
        {exploration && exploration.recon?.success && operation.state !== 'completed'
          ? <b className="exploration-feed-risk" title="Категория риска подтверждена разведданными">РИСК {['I','II','III','IV','V'][(operation.threat ?? 1)-1]} / V</b> : null}
        {!exploration && pirate ? <b className="operations-pirate-debris-label"><ResourceIcon kind="debris" /> ОБЛОМКИ · от 60%</b> : null}
        {!exploration && !pirate ? <span className="operation-feed-meta-v2"><IntelPips level={operation.intel} />{firstReward ? <b><ResourceIcon kind={firstReward[2]} /> {number.format(firstReward[1])}</b> : <b>НАГРАДА ?</b>}</span> : null}
        {raidCheck ? <span className="operation-feed-raid-check-v2" data-qa-raid-check-interval="15m">
          <span className="operation-feed-raid-check-label-v2">
            <span>{pirateRaidRoll ? 'ПРОВЕРКА ЗАВЕРШЕНА' : 'ДО ПРОВЕРКИ НАПАДЕНИЯ'}</span>
            <strong role="timer">{pirateRaidRoll ? (pirateRaidRoll.flightId ? 'РЕЙД ОТПРАВЛЕН' : 'РЕЙДА НЕТ')
              : raidCheck.remainingMs > 0 ? pirateRemainingLabel(raidCheck.nextAt, nowMs) : 'ПРОВЕРЯЕТСЯ'}</strong>
          </span>
          <span className="operations-pirate-cooldown-track" role="progressbar" aria-label="15-минутный интервал проверки возможного нападения"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={raidCheck.percent}>
            <span className="operations-pirate-cooldown-mask" style={{ width: `${100 - raidCheck.percent}%` }} />
          </span>
        </span> : null}
      </span>
      <span className={`operation-feed-ring-v-a ${operation.state === 'completed' ? `is-${completedResult}` : ''} ${operation.state === 'active' ? 'is-indeterminate' : ''}`} aria-hidden="true">
        <span style={progress === undefined ? undefined : { background: `conic-gradient(var(--contact-accent) ${progress}%, rgba(255,255,255,.08) 0)` }}>
          <b>{operation.state === 'completed' ? completedResult === 'success' ? '✓' : completedResult === 'failure' ? '✕' : '·' : operation.state === 'active' ? '…' : remaining}</b>
        </span>
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

  return <div className="operations-empty-v2"><span>◇</span><strong>{copy[0]}</strong><p>{copy[1]}</p></div>;
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

function OperationDossier({ operation, pirateContact, exploration, onExpedition, onExplorationAttack, onBot01Occupy, onExplorationAccept, onExplorationCancel, onExplorationRecon, onExplorationUniverse, onExplorationReport, battleReportId, completed, nowMs, onAccept, onCancel, onReveal, onOpenFleets, onPirateRecon, onPirateAttack, onPirateReport, onPirateBattleReport, onPirateUniverse }: {
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
  onPirateBattleReport?: (reportId: string) => void;
  onPirateRecon?: (contact: PirateContactPresentation) => void;
  onPirateAttack?: (contact: PirateContactPresentation) => void;
  onPirateReport?: (reportId: string) => void;
  onPirateUniverse?: (contact: PirateContactPresentation) => void;
  onAccept: (id: OperationId) => void;
  onCancel: (id: OperationId) => void;
  onReveal: (id: OperationId) => void;
  onOpenFleets: () => void;
}) {
  if (!operation) {
    return (
      <aside className="operations-dossier-v2 operations-dossier-v2--empty operations-dossier-variant-a" data-contact-kind="other">
        <span>SELECT // OPERATION</span>
        <strong>ВЫБЕРИТЕ КОНТАКТ</strong>
        <p>Операционный брифинг появится здесь.</p>
      </aside>
    );
  }

  const kind = contactKind(operation, pirateContact, exploration);
  const kindLabel = CONTACT_LABELS[kind];

  if (exploration) {
    const node = exploration.node;
    const known = exploration.recon?.success === true;
    const failed = exploration.recon?.success === false;
    const profile = explorationProfile(node.kind as 'unique' | 'anomaly', node.special?.profileVariant ?? 1);
    const occupied = exploration.occupancy !== 'free';
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
    const remainingLife = node.special?.expiresAt && node.special?.startAt
      ? Math.max(0, Math.min(100, Math.round((node.special.expiresAt - nowMs) / (node.special.expiresAt - node.special.startAt) * 100)))
      : 0;
    const riskRoman = ['I','II','III','IV','V'][profile.risk - 1]!;
    const delivered = lastReturn?.creditedCargo ?? lastReturn?.cargo;
    const deliveredTotal = delivered ? Object.values(delivered).reduce((sum, value) => sum + value, 0) : 0;
    const currentStage = exploration.reconInFlight?.phase === 'returning' ? 3
      : exploration.reconInFlight?.phase === 'outbound' ? 1
        : exploration.occupancy === 'self' ? 2 : 1;
    const hasObservedStage = Boolean(exploration.reconInFlight) || exploration.occupancy === 'self';
    const stageLabels = hasObservedStage
      ? kind === 'anomaly'
        ? ['Принята', 'Сканирование', 'Сбор', 'Возврат']
        : ['Принята', 'Экспедиция в пути', 'Исследование / добыча', 'Возврат']
      : ['Принята', 'Выполнение', kind === 'anomaly' ? 'Анализ' : 'Исследование', 'Возврат'];
    const explorationMetrics: DossierMetric[] = completed
      ? [
        { label: 'РЕЗУЛЬТАТ', value: lastReturn?.kind === 'returned' ? 'ИССЛЕДОВАНО' : lastReturn?.kind === 'origin-destroyed' ? 'ПОТЕРЯ ФЛОТА' : 'ЗАВЕРШЕНО', note: lastReturn ? new Date(lastReturn.at).toLocaleString('ru-RU') : undefined, tone: lastReturn?.kind === 'returned' ? 'good' : lastReturn?.kind === 'origin-destroyed' ? 'bad' : undefined },
        ...(deliveredTotal > 0 ? [{ label: 'ДОСТАВЛЕНО', value: number.format(deliveredTotal), note: 'единиц по квитанции', tone: 'good' as const }] : []),
        ...(lastReturn?.repairTokens ? [{ label: 'ЖЕТОНЫ РЕМОНТА', value: `+${lastReturn.repairTokens}`, note: 'по квитанции', tone: 'token' as const }] : []),
        ...(liveCargo ? [{ label: 'ГРУЗ В ТРЮМЕ', value: number.format(Object.values(liveCargo).reduce((sum, value) => sum + value, 0)), note: 'фактический остаток' }] : []),
      ]
      : [
        { label: 'ДО ИСЧЕЗНОВЕНИЯ', value: pirateRemainingLabel(node.special?.expiresAt ?? nowMs, nowMs), note: 'срок контакта', tone: 'time' },
        { label: 'ЗАНЯТОСТЬ', value: exploration.occupancy === 'free' ? 'СВОБОДНО' : exploration.occupancy === 'self' ? 'ВАШ ФЛОТ' : 'ЗАНЯТО', note: 'состояние объекта' },
        known ? { label: 'РИСК', value: `${riskRoman} / V`, note: 'данные разведки', tone: profile.risk < 3 ? 'good' : 'bad' }
          : { label: 'РАЗВЕДКА', value: failed ? 'НЕ УДАЛАСЬ' : awaitingProbe ? 'ЗОНД В ПУТИ' : 'НЕТ ДАННЫХ', note: 'состав и риск скрыты' },
        ...(liveCargo ? [{ label: 'ГРУЗ В ТРЮМЕ', value: number.format(Object.values(liveCargo).reduce((sum, value) => sum + value, 0)), note: `из ${number.format(mine?.cargoCapacity ?? 0)}` }] : []),
      ];
    return <aside className="operations-dossier-v2 operations-dossier-v2--exploration operations-dossier-variant-a"
      data-contact-kind={kind} data-qa-exploration-dossier={node.id}>
      <header className="operations-dossier-head-v2">
        <div className="operations-dossier-title-v2">
          <span className="operations-dossier-glyph-v2"><OperationGlyph category="exploration" /></span>
          <div>
            <small>{node.kind === 'anomaly' ? 'НАУЧНАЯ ОПЕРАЦИЯ' : 'ИССЛЕДОВАТЕЛЬСКАЯ ОПЕРАЦИЯ'}</small>
            <h2>{node.name.toUpperCase()}</h2>
            <p><button type="button" className="exploration-coordinates-link" onClick={() => onExplorationUniverse?.(node)} title="Открыть во Вселенной">{formatLocation(operation.location)} ↗</button></p>
          </div>
        </div>
        <span className={'exploration-state-pill exploration-state-pill--' + (completed ? 'ended' : exploration.occupancy)}
          data-qa-exploration-status={completed ? 'completed' : exploration.occupancy}>
          {completed ? 'ЗАВЕРШЕНО' : exploration.occupancy === 'free' ? 'СВОБОДНО' : exploration.occupancy === 'self' ? 'ВАШ ФЛОТ' : 'ЗАНЯТО'}
        </span>
      </header>
      <section className="exploration-dossier-hero">
        <div className="exploration-dossier-art"><img src={node.art} alt="" loading="lazy" draggable={false} /></div>
        <div className="exploration-dossier-intro">
          <small>{node.kind === 'anomaly' ? 'АНОМАЛИЯ' : 'УНИКАЛЬНЫЙ ОБЪЕКТ'}</small>
          <strong>{node.name}</strong>
          <p>{node.description}</p>
          <dl>
            <div><dt>КООРДИНАТЫ</dt><dd><button type="button" className="exploration-coordinates-link" onClick={() => onExplorationUniverse?.(node)}>{formatLocation(operation.location)} ↗</button></dd></div>
            <div><dt>ДО ИСЧЕЗНОВЕНИЯ</dt><dd>{completed ? 'Объект исчез' : pirateRemainingLabel(node.special?.expiresAt ?? nowMs, nowMs)}</dd></div>
            <div><dt>СОСТОЯНИЕ</dt><dd>{completed ? 'Цикл завершён' : exploration.occupancy === 'free' ? 'Никем не занят' : exploration.occupancy === 'self' ? 'Ваш флот добывает' : 'Занят чужим флотом'}</dd></div>
            <div><dt>ОПЕРАЦИЯ</dt><dd>{completed ? 'В архиве' : accepted ? 'Принята' : 'Не принята'}</dd></div>
          </dl>
        </div>
      </section>
      {accepted ? <>
        <OperationStageTimeline labels={stageLabels} currentIndex={currentStage} />
        {currentStage === 1 && !exploration.reconInFlight && exploration.occupancy !== 'self'
          ? <small className="operations-stage-fallback-v-a">Фаза не определена: принятие завершено, следующий этап отмечен текущим.</small> : null}
      </> : null}
      <div className="exploration-lifetime-panel" aria-label="Оставшийся срок существования">
        <div><small>ДО ИСЧЕЗНОВЕНИЯ</small><strong>{completed ? 'Завершено' : pirateRemainingLabel(node.special?.expiresAt ?? nowMs, nowMs)}</strong></div>
        <div className="exploration-lifetime-track" role="progressbar" aria-label="Оставшееся время объекта" aria-valuemin={0} aria-valuemax={100} aria-valuenow={remainingLife}><span style={{width: remainingLife + '%'}} /></div>
      </div>
      <DossierMetrics items={explorationMetrics} />
      <section className="operations-objective-v2 operations-objective-v-a"><small>ОСНОВНАЯ ЦЕЛЬ</small><strong>{operation.objective.label}</strong></section>
      <section className="exploration-dossier-intelligence">
        <div className="exploration-section-heading">
          <strong>ИССЛЕДОВАНИЕ ОБЪЕКТА</strong>
          <span>{known ? 'ДАННЫЕ ПОЛУЧЕНЫ' : awaitingProbe ? 'ЗОНД В ПУТИ' : failed ? 'ЗОНД НЕ ПОЛУЧИЛ ДАННЫЕ' : 'НЕТ РАЗВЕДДАННЫХ'}</span>
        </div>
        <p>{awaitingProbe ? 'Зонд направляется к объекту. Отчёт появится после прибытия.' : known
          ? 'Зонд успешно исследовал объект. Ниже показан подтверждённый профиль добычи.'
          : failed
            ? 'Попытка исследования оказалась неудачной. Сведения о составе ресурсов пока скрыты.'
            : 'Отправьте один шпионский зонд. Результат станет известен после его прибытия; шанс успешного исследования — 70%.'}</p>
        <div className="exploration-reward-grid">
          <div className="exploration-reward-cell">
            <small>РАЗВЕДАННЫЕ ЗАПАСЫ · ОСТАТОК / ИСХОДНОЕ</small>
            {known ? <div className="exploration-resource-chips">
              {resourceRows.map(([key, weight]) =>
                <span key={key} className="exploration-resource-chip">
                  <ResourceIcon kind={key as ResourceIconKind} />
                  <b>{resourceLabels[key as ResourceIconKind]}</b>
                  <em>{number.format(exploration.contact?.resourceReserve[key as 'metal' | 'minerals' | 'gas' | 'debris'] ?? 0)} / {number.format(exploration.contact?.initialReserve[key as 'metal' | 'minerals' | 'gas' | 'debris'] ?? 0)} · {weight}%</em>
                </span>)}
            </div> : <div className="exploration-resource-unknown">
              {(['metal', 'minerals', 'gas', 'debris'] as const).map(kind =>
                <ResourceIcon key={kind} kind={kind} />)}
              <span>Состав скрыт до успешного исследования</span>
            </div>}
          </div>
          <div className="exploration-reward-cell">
            <small>КАТЕГОРИЯ РИСКА</small>
            {known ? <>
              <div className="exploration-risk-meter" aria-label={'Категория риска ' + riskRoman + ' из V'}>
                {([1,2,3,4,5] as const).map(level => <span className={level <= profile.risk ? 'active' : ''} key={level}>{['I','II','III','IV','V'][level-1]}</span>)}
              </div>
              <strong>{riskRoman} / V · {profile.risk < 3 ? 'НИЗКИЙ' : profile.risk < 5 ? 'ПОВЫШЕННЫЙ' : 'ВЫСОКИЙ'}</strong>
            </> : <strong>Неизвестен до разведки</strong>}
            <p>{known ? 'По проектной модели уровень ' + riskRoman + ' предполагает ' + Math.round(EXPLORATION_RULES.npcAttemptChance[profile.risk] * 100) + '% шанса попытки захвата конкурентом каждые 3 минуты. ' : 'До разведки класс опасности неизвестен. '}Аномалии могут сжигать до 10% накопленного груза при всплеске раз в 3 минуты. В обычной игре NPC при успешной проверке риска отправляет настоящий флот только со своей существующей планеты; при отсутствии таких планет рейса не будет. В Test Mode NPC-рейс запускается вручную.</p>
          </div>
        </div>
        {mine && <section className="exploration-mining-status" data-qa-exploration-live-cargo>
          <div><strong>ТЕКУЩАЯ ДОБЫЧА ВАШЕГО ФЛОТА</strong><span>Трюм: {number.format(Object.values(liveCargo ?? {}).reduce((sum, value) => sum + value, 0))} / {number.format(mine.cargoCapacity)}</span></div>
          <div className="exploration-lifetime-track"><span style={{width: Math.min(100, (Object.values(liveCargo ?? {}).reduce((sum, value) => sum + value, 0) / Math.max(1, mine.cargoCapacity)) * 100) + '%'}} /></div>
          <div className="exploration-resource-chips">{(['metal','minerals','gas','debris'] as const).map(key =>
            <span key={key} className="exploration-resource-chip"><ResourceIcon kind={key} /><b>{resourceLabels[key]}</b><em>{number.format(liveCargo?.[key] ?? 0)}</em></span>)}</div>
          <small>Обломки добывают только переработчики. Всё добытое попадёт на исходную планету только после возвращения.</small>
        </section>}
        {combatReportId && onExplorationReport ? <button type="button" data-qa-exploration-battle-report={combatReportId} className="operations-intel-report-button-v2"
          onClick={() => onExplorationReport(combatReportId)}>БОЕВОЙ ДОКЛАД · ОТКРЫТЬ В «СООБЩЕНИЯХ» ↗</button> : null}
        {exploration.recon && onExplorationReport ? <button type="button" className="operations-intel-report-button-v2" onClick={() => onExplorationReport('exploration-recon:' + exploration.recon!.flightId)}>ОТКРЫТЬ РАЗВЕДОТЧЁТ В «СИСТЕМЕ» ↗</button> : null}
        {exploration.recon ? <small className="exploration-recon-timestamp">Последний разведотчёт: {new Date(exploration.recon.resolvedAt).toLocaleString('ru-RU')}
          {inCooldown ? ' · повтор через ' + Math.ceil((cooldownAt - nowMs) / 1000) + ' с' : ''}</small> : null}
      </section>
      {completed ? <section className="exploration-dossier-result">
        <strong>ИТОГ ОПЕРАЦИИ</strong>
        {lastReturn?.kind === 'returned' ? <>
          <p>{deliveredTotal > 0 ? 'Доставка подтверждена на планету ' + lastReturn.originPlanetId + '. Обломки находятся в запасе переработки, не на обычных складах.' : 'Экспедиция вернулась без добычи. Для сбора обломков нужны переработчики, транспортёры их не добывают.'}</p>
          <div className="exploration-resource-chips">
            {(['metal','minerals','gas','debris'] as const).map(key =>
              <span key={key} className="exploration-resource-chip"><ResourceIcon kind={key} /><b>{resourceLabels[key]}</b><em>{number.format(delivered?.[key] ?? 0)}</em></span>)}
          </div>
          {onExplorationReport ? <button type="button" className="operations-intel-report-button-v2" onClick={() => onExplorationReport('exploration-return:' + lastReturn.flightId)}>ОТЧЁТ О ДОСТАВКЕ В «ПОЛЁТАХ» ↗</button> : null}
          {lastReturn.repairTokens ? <p>Редкие жетоны ремонта: +{lastReturn.repairTokens}</p> : null}
        </> : <p>Время контакта истекло. Подтверждённой доставки ресурсов по этому циклу нет.</p>}
      </section> : null}
      <footer className="operations-command-v2 exploration-command-panel">
        <div><strong>{completed ? 'КОНТАКТ ЗАВЕРШЁН' : accepted ? 'ОПЕРАЦИЯ ПРИНЯТА' : 'ДОСТУПНАЯ ОПЕРАЦИЯ'}</strong>
          <span>{completed ? 'Это история прошедшего цикла объекта.' : occupied && exploration.occupancy === 'occupied'
            ? 'Экспедиция заблокирована: объект удерживает другой флот.'
            : accepted ? 'Можно исследовать объект зондом или отправить экспедицию.' : 'Сначала примите операцию, чтобы открыть подготовку.'}</span></div>
        <div className="operations-command-actions-v2 exploration-action-buttons">
          {!completed && exploration.occupancy === 'free' && onBot01Occupy ? <button
            type="button" className="operations-secondary-v2" data-qa-bot={node.id} data-qa-bot01-exploration={node.id}
            onClick={() => onBot01Occupy(node)}>ТЕСТ: BOT 01 · ЗАНЯТЬ ОБЪЕКТ</button> : null}
                    {!completed && !accepted ? <button className="operations-primary-v2" type="button"
            data-qa-exploration-accept={node.id} onClick={() => onExplorationAccept?.(node)}>ПРИНЯТЬ ОПЕРАЦИЮ</button> : null}
          {!completed && accepted ? <>
            <button type="button" className="operations-primary-v2" data-qa-exploration-recon={node.id}
              disabled={!onExplorationRecon || Boolean(inCooldown) || Boolean(exploration.reconInFlight)}
              title={inCooldown ? 'Повторное исследование доступно после паузы' : 'Отправить один шпионский зонд с текущей планеты'}
              onClick={() => onExplorationRecon?.(node)}>{exploration.reconInFlight ? 'ЗОНД В ПУТИ / ВОЗВРАЩАЕТСЯ' : 'ИССЛЕДОВАТЬ ОБЪЕКТ'}</button>
            {exploration.occupancy === 'free'
              ? <button type="button" className="operations-secondary-v2" disabled={!onExpedition}
                  data-qa-operation-expedition={node.id} onClick={() => onExpedition?.(node)}>ПОДГОТОВИТЬ ЭКСПЕДИЦИЮ</button>
              : exploration.occupancy === 'self'
                ? <button type="button" className="operations-secondary-v2" onClick={onOpenFleets}>К ФЛОТАМ · ОТОЗВАТЬ</button>
                : <button type="button" className="operations-primary-v2" data-qa-exploration-attack={node.id} disabled={!onExplorationAttack} onClick={() => onExplorationAttack?.(node)}>АТАКОВАТЬ ЗАНЯТЫЙ ОБЪЕКТ</button>}
            <button type="button" className="operations-pirate-cancel"
              onClick={() => onExplorationCancel?.(node.id)}>Отменить операцию</button>
          </> : null}
        </div>
      </footer>
    </aside>;
  }

  const pirate = kind === 'pirate';
  const intelZero = operation.intel === 0 && !pirate;
  const modifierLabels = operation.modifiers.map((modifier) => OPERATION_MODIFIER_LABELS[modifier]);
  const reconLabel = pirateContact?.latestReportOutcome === 'success' ? 'Разведданные получены'
    : pirateContact?.latestReportOutcome === 'failure' ? 'Разведка не удалась'
      : pirateContact?.statusLabel === 'Зонд в пути' ? 'Зонд в пути' : 'Нет разведданных';

  if (pirate && completed) {
    const cycle = completed.cycleKey.split(':');
    const completedMetrics: DossierMetric[] = [
      { label: 'ИСХОД', value: 'ПОБЕДА', note: 'бой завершён', tone: 'good' },
      { label: 'РАУНДОВ', value: String(completed.rounds), note: 'по боевому расчёту' },
      { label: 'ОБЛОМКИ', value: number.format(completed.debris), note: 'на орбите' },
      ...(completed.reward ? [{ label: 'СНИЖЕНИЕ УГРОЗЫ', value: `${(completed.reward.threatReductionFraction * 100).toFixed(1)}%`, note: 'по результату боя', tone: 'good' as const }] : []),
    ];
    return (
      <aside className="operations-dossier-v2 operations-dossier-v2--pirate operations-completed-report-v2 operations-dossier-variant-a"
        data-contact-kind="pirate" data-threat="unknown">
        <header className="operations-dossier-head-v2">
          <div className="operations-dossier-title-v2">
            <span className="operations-dossier-glyph-v2"><OperationGlyph category="combat" /></span>
            <div><small>РЕЗУЛЬТАТ БОЕВОЙ ОПЕРАЦИИ</small><h2>ПИРАТСКАЯ БАЗА УНИЧТОЖЕНА</h2>
              <p>{formatLocation(operation.location)}</p></div>
          </div>
        </header>
        <section className="operations-dossier-hero-v2 operations-completed-hero-v-a">
          <div className="operations-hero-object-art" data-qa-pirate-hero-art>
            <img src={getPiratePlanetArt(Number(cycle[2] ?? 1), Number(cycle[3] ?? 0))} alt="Пиратская база" loading="lazy" draggable={false} />
          </div>
          <div className="operations-briefing-v2">
            <small>ИТОГ БОЕВОЙ ОПЕРАЦИИ</small>
            <h3>ПОБЕДА</h3>
            <p>Завершено {new Date(completed.defeatedAt).toLocaleString('ru-RU')} · отчёт сохранён в «Сообщениях».</p>
          </div>
        </section>
        <DossierMetrics items={completedMetrics} />
        <section className="operations-objective-v2 operations-objective-v-a"><small>ОСНОВНАЯ ЦЕЛЬ</small><strong>Пиратская база уничтожена.</strong></section>
        <section className="operations-completed-report-body-v2">
          <h3>БОЕВОЙ ОТЧЁТ</h3>
          <p>Победа подтверждена боевым расчётом. Результат сохранён в разделе «Доклады».</p>
          <div className="operations-completed-report-facts-v2">
            <div><small>ИСХОД</small><strong>ПОБЕДА</strong></div>
            <div><small>РАУНДОВ</small><strong>{completed.rounds}</strong></div>
            {completed.reward ? <>
              <div><small>ОТПРАВЛЕНО / АНГАР</small><strong>{number.format(completed.reward.sentCombatPopulation)} / {number.format(completed.reward.historicalHangarCapacity)}</strong></div>
              <div><small>МНОЖИТЕЛЬ ОБЛОМКОВ</small><strong>×{completed.reward.multiplier}</strong></div>
              <div><small>ПИРАТСКИЕ ОБЛОМКИ / БОНУС</small><strong>{number.format(completed.reward.basePirateDebris)} / {completed.reward.bonusPirateDebris>=0?'+':'−'}{number.format(Math.abs(completed.reward.bonusPirateDebris))}</strong></div>
              <div><small>СВОИ ОБЛОМКИ</small><strong>{number.format(completed.reward.ownDebris)}</strong></div>
              <div><small>СНИЖЕНИЕ УГРОЗЫ</small><strong>{(completed.reward.threatReductionFraction*100).toFixed(1)}%</strong></div>
            </> : null}
            <div><small>ОБЛОМКИ НА ОРБИТЕ</small><strong><ResourceIcon kind="debris" /> {number.format(completed.debris)}</strong></div>
            <div><small>ЗАВЕРШЕНО</small><strong>{new Date(completed.defeatedAt).toLocaleString('ru-RU')}</strong></div>
          </div>
        </section>
        <footer className="operations-command-v2">
          <div><small>СТАТУС</small><strong>ПОБЕДА ПОДТВЕРЖДЕНА</strong><span>Завершено {new Date(completed.defeatedAt).toLocaleString('ru-RU')} · доклад готов.</span></div>
          <div className="operations-command-actions-v2"><button type="button" className="operations-primary-v2"
            onClick={() => onPirateBattleReport?.(completed.reportId)}>ОТКРЫТЬ ПОЛНЫЙ БОЕВОЙ ОТЧЁТ</button></div>
        </footer>
      </aside>
    );
  }

  return (
    <aside className={`operations-dossier-v2 operations-dossier-v2--${operation.category} ${pirate ? 'operations-dossier-v2--pirate' : ''} operations-dossier-variant-a`}
      data-contact-kind={kind} data-threat={operation.threat ?? 'unknown'}>
      <header className="operations-dossier-head-v2">
        <div className="operations-dossier-title-v2">
          <span className="operations-dossier-glyph-v2"><OperationGlyph category={operation.category} /></span>
          <div>
            <small>{pirate ? `БОЕВАЯ ОПЕРАЦИЯ · ${pirateContact ? 'ДЕЙСТВУЮЩАЯ ЦЕЛЬ' : 'АРХИВ КОНТАКТА'}` : `${CATEGORY_LABELS[operation.category]} · ${operation.id.toUpperCase()}`}</small>
            <h2>{operation.title}</h2>
            <p>{intelZero ? formatLocationClass(operation.location) : formatLocation(operation.location)} <i /> {OPERATION_SOURCE_LABELS[operation.source]}</p>
          </div>
        </div>
        <div className="operations-dossier-threat-v2">
          <small>{pirate ? 'СТАТУС КОНТАКТА' : operation.category === 'combat' ? 'УРОВЕНЬ УГРОЗЫ' : 'УРОВЕНЬ РИСКА'}</small>
          <strong>{pirate ? (pirateContact ? '●' : '—') : threatTier(operation)}</strong>
          <span>{pirate ? (pirateContact ? 'ОБНАРУЖЕН' : 'ИСТЁК') : threatText(operation)}</span>
        </div>
      </header>

      <section className="operations-dossier-hero-v2">
        {pirate ? <div className="operations-hero-object-art" data-qa-pirate-hero-art>
          <img src={getPiratePlanetArt(...((): [number,number] => {
            const parts = (pirateContact?.contactCycleKey ?? operation.id.replace(/^pirate:/,'')).split(':');
            return [Number(parts[2] ?? 1), Number(parts[3] ?? 0)];
          })())} alt="Пиратская база" loading="lazy" draggable={false} />
        </div> : <TacticalScope operation={operation} contact={pirateContact} />}
        <div className="operations-briefing-v2">
          <div className="operations-briefing-tags-v-a"><span>{kindLabel}</span><span>{formatLocation(operation.location)}</span>
            <span>{pirate ? pirateContact ? 'КОНТАКТ АКТИВЕН' : 'КОНТАКТ ЗАВЕРШЁН' : operation.state === 'active' ? 'ОПЕРАЦИЯ ПРИНЯТА' : operation.state === 'completed' ? 'ЗАВЕРШЕНО' : 'ДОСТУПНО'}</span></div>
          <h3>{operation.title}</h3>
          <p>{pirate ? pirateContact ? `Действующая база в системе вашей колонии. Координаты: ${pirateCoordinateLabel(pirateContact)}.` : 'Цикл закончился или цель исчезла. На прежние координаты рейд не отправляется.' : intelZero ? 'Сенсоры фиксируют нестабильный источник неизвестного происхождения. До глубокого сканирования тип объекта, точная угроза и возможная награда скрыты.' : operation.briefing}</p>
          <div className="operations-intel-line-v2">
            <span>{pirate ? 'РАЗВЕДКА' : 'РАЗВЕДДАННЫЕ'}</span>
            {pirate ? <b>{pirateContact ? reconLabel : 'Контакт завершён'}</b> : <><IntelPips level={operation.intel} /><b>{operation.intel} / 3</b></>}
          </div>
          {pirateContact ? <div className="operations-pirate-lifecycle-v2">
            <div className="operations-pirate-live-timer" role="timer">До исчезновения: <strong>{pirateRemainingLabel(pirateContact.expiresAt, nowMs)}</strong></div>
            <small>Затем — 15-минутная пауза до нового ролла появления базы.</small>
          </div> : null}
        </div>
      </section>

      {operation.state === 'active' ? <>
        <OperationStageTimeline
          labels={pirate ? ['Принята', 'В работе', 'Бой', 'Возврат'] : ['Принята', 'Выполнение', 'Завершение', 'Возврат']}
          currentIndex={1} />
        <small className="operations-stage-fallback-v-a">Фаза не определена: принятие завершено, следующий этап отмечен текущим.</small>
      </> : null}
      <DossierMetrics items={pirate ? [
        ...(pirateContact ? [{ label: 'ДО ИСЧЕЗНОВЕНИЯ', value: pirateRemainingLabel(pirateContact.expiresAt, nowMs), note: 'срок контакта', tone: 'time' as const }] : []),
        { label: 'РАЗВЕДКА', value: reconLabel.toUpperCase(), note: pirateContact?.latestReportId ? 'есть отчёт' : 'отчёт не получен' },
        { label: 'ОБЛОМКИ', value: 'ОТ 60%', note: 'стоимости уничтоженных кораблей' },
      ] : [
        { label: 'РАЗВЕДДАННЫЕ', value: `${operation.intel} / 3`, note: 'подтверждённый уровень' },
        ...(operation.threat ? [{ label: 'РИСК', value: threatText(operation), note: 'текущий источник данных' }] : []),
        ...rewardEntries(operation).slice(0, 2).map(([label, value]) => ({ label, value: number.format(value), note: 'предпросмотр награды' })),
      ]} />
      <section className="operations-objective-v2 operations-objective-v-a"><small>ОСНОВНАЯ ЦЕЛЬ</small><strong>{operation.objective.label}</strong></section>

      {intelZero ? (
        <section className="operations-unknown-brief-v2">
          <div><small>КЛАСС КОНТАКТА</small><strong>НЕИЗВЕСТЕН</strong></div>
          <div><small>ВОЗМОЖНЫЙ РИСК</small><strong>{operation.threatRange ? `${ROMAN_THREAT[operation.threatRange[0]]}–${ROMAN_THREAT[operation.threatRange[1]]}` : '?'}</strong></div>
          <p>Сканирование классифицирует сигнал и заменит его конкретной операцией. Результат фиксирован и сохраняется в текущем save.</p>
        </section>
      ) : (
        <>
          <div className="operations-dossier-lower-v2">
            {pirate ? <>
              <section className="operations-conditions-v2">
                <small>РАЗВЕДДАННЫЕ</small>
                <strong>{pirateContact ? reconLabel : 'Цикл завершён'}</strong>
                <p>{pirateContact?.latestReportOutcome === 'success' ? 'Состав флота доступен в разведотчёте.' : pirateContact?.latestReportOutcome === 'failure' ? 'Зонд не получил данные.' : pirateContact ? 'Отправь разведзонд, чтобы узнать состав противника.' : 'Разведка завершена.'}</p>
                {pirateContact?.latestReportId && onPirateReport
                  ? <button type="button" className="operations-intel-report-button-v2" onClick={() => onPirateReport(pirateContact.latestReportId!)}>ОТКРЫТЬ РАЗВЕДОТЧЁТ <span aria-hidden="true">↗</span></button>
                  : null}
              </section>
              <section className="operations-rewards-panel-v2">
                <small>ПОТЕНЦИАЛЬНЫЕ ОБЛОМКИ</small>
                <div className="operations-pirate-debris-reward"><ResourceIcon kind="debris" label="Обломки" /><strong>От 60% стоимости уничтоженных пиратских кораблей</strong></div>
                <p>Обломки остаются на орбите после боя — для получения отправь переработчиков.</p>
              </section>
            </> : <>
              <section className="operations-conditions-v2">
                <small>УСЛОВИЯ КОНТАКТА</small>
                <div>{modifierLabels.length ? modifierLabels.map((label) => <span key={label}>⚠ {label}</span>) : <span>Без особых условий</span>}</div>
                <p>Показаны только подтверждённые данные текущего уровня разведки.</p>
              </section>
              <section className="operations-rewards-panel-v2">
                <small>НАГРАДА · ПРЕДПРОСМОТР</small>
                <RewardPreview operation={operation} />
                <p>Начисление награды появится вместе с реальным выполнением операций.</p>
              </section>
            </>}
          </div>
        </>
      )}

      <footer className="operations-command-v2">
        <div>
          <small>СТАТУС</small>
          <strong>{pirate ? operation.state === 'completed' ? 'КОНТАКТ ЗАВЕРШЁН' : operation.state === 'active' ? 'ОПЕРАЦИЯ ПРИНЯТА' : 'ДОСТУПНА К ПРИНЯТИЮ' : operation.state === 'active' ? 'ОПЕРАЦИЯ ПРИНЯТА' : operation.state === 'completed' ? 'ОПЕРАЦИЯ ЗАВЕРШЕНА' : intelZero ? 'ТРЕБУЕТСЯ СКАНИРОВАНИЕ' : 'ГОТОВА К ПРИНЯТИЮ'}</strong>
          <span>{pirate ? operation.state === 'active' ? 'Выбери действие для этого действующего контакта.' : operation.state === 'available' ? 'Прими операцию, чтобы открыть действия.' : 'Прошлый цикл больше не активен.' : operation.state === 'active' ? 'Подготовьте флот в разделе «Флоты».' : intelZero ? 'Классифицируйте контакт перед принятием решения.' : 'Принятие фиксирует операцию как активную.'}</span>
        </div>
        <div className="operations-command-actions-v2">
          {pirate && operation.state === 'completed' && battleReportId && onPirateBattleReport ? <button type="button" className="operations-primary-v2" onClick={() => onPirateBattleReport(battleReportId)}>ОТКРЫТЬ БОЕВОЙ ОТЧЁТ</button> : null}
          {pirate ? pirateContact && operation.state === 'available'
            ? <button type="button" className="operations-primary-v2" onClick={() => onAccept(operation.id)}>ПРИНЯТЬ ОПЕРАЦИЮ</button>
            : pirateContact && operation.state === 'active' ? <div className="operations-pirate-actions">
              <button type="button" className="operations-primary-v2" disabled={!pirateContact.recon.enabled || !onPirateRecon} title={pirateContact.recon.disabledReason ?? ''} onClick={() => onPirateRecon?.(pirateContact)}>РАЗВЕДАТЬ</button>
              <button type="button" className="operations-secondary-v2" disabled={!pirateContact.elimination.enabled || !onPirateAttack} onClick={() => onPirateAttack?.(pirateContact)}>ПОДГОТОВИТЬ ПИРАТСКИЙ РЕЙД</button>
              
              <button type="button" className="operations-secondary-v2" disabled={!onPirateUniverse} onClick={() => onPirateUniverse?.(pirateContact)}>ПОКАЗАТЬ ВО ВСЕЛЕННОЙ</button>
              <button type="button" className="operations-pirate-cancel" onClick={() => onCancel(operation.id)}>Отменить операцию</button>
            </div> : null
          : <>
            {intelZero ? <button type="button" className="operations-primary-v2" onClick={() => onReveal(operation.id)}>ПРОСКАНИРОВАТЬ</button> : null}
            {!intelZero && operation.state === 'available' ? <button type="button" className="operations-primary-v2" onClick={() => onAccept(operation.id)}>ПРИНЯТЬ ОПЕРАЦИЮ</button> : null}
            {operation.state === 'active' ? <button type="button" className="operations-primary-v2" onClick={onOpenFleets}>К ФЛОТАМ</button> : null}
            {operation.state === 'active' ? <button type="button" className="operations-secondary-v2" onClick={() => onCancel(operation.id)}>ОТМЕНИТЬ</button> : null}
          </>}
        </div>
      </footer>
    </aside>
  );
}

export function OperationsView({ state, onAccept, onCancel, onReveal, onOpenFleets, explorationContacts = [], onExpedition, onExplorationAttack, onBot01Occupy, onExplorationAccept, onExplorationCancel, onExplorationRecon, onExplorationUniverse, onExplorationReport, pirateContacts = [], pirateThreatPercent = 2, pirateAdaptiveDiagnostics, onPirateBattleExport, pirateRaidRolls = {}, pirateOwnerId = '', pirateCheckDelayMs, completedPirateOperations = [], nowMs = Date.now(), onPirateAccept, onPirateCancel, onPirateRecon, onPirateAttack, onPirateReport, onPirateBattleReport, onPirateUniverse }: OperationsViewProps) {
  const [tab, setTab] = useState<OperationsTab>('available');
  const [selectedId, setSelectedId] = useState<OperationId | null>(null);
  const [contactFilter, setContactFilter] = useState<ContactFilter>('all');

  const operationRows = useMemo((): OperationRow[] => {
    // Demo placeholders are not playable pirate targets. Keep them in Test save for
    // backwards compatibility, but render only authoritative live contacts.
    const demoIds = new Set(['op-pirate-patrol-01', 'op-pirate-outpost-01', 'op-signal-derelict-01', 'op-anomaly-01']);
    const normal: OperationRow[] = state.items
      .filter((item) => !demoIds.has(item.id) && !isPirateOperationId(item.id))
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
    <main className="operations-shell-v2 operations-shell-v2--variant-a">
      <header className="operations-topbar-v2">
        <div className="operations-heading-v2">
          <small>ОПЕРАЦИОННЫЙ ЦЕНТР</small>
          <h1>ОПЕРАЦИИ</h1>
        </div>
        <div className="operations-threat-summary-v-a" aria-label="Пиратская угроза">
          <span className="operations-threat-ring-v-a" role="progressbar" aria-label="Пиратская угроза от 2% до 30%"
            aria-valuemin={2} aria-valuemax={30} aria-valuenow={pirateThreatPercent}
            title="Вероятность отправки рейда при проверке одной пиратской базы в одной системе. Каждая система проверяется отдельно — это не шанс победы пиратов или уничтожения планеты. Чем меньше боевых очков относительно ресурсных, тем быстрее растёт угроза. Полная победа над базой снижает её пропорционально отправленному боевому населению."
            style={{ background: `conic-gradient(#ff7a3d 0 ${Math.max(0, Math.min(100, pirateThreatPercent))}%, rgba(255,255,255,.08) 0)` }}>
            <span><b>{pirateThreatPercent.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</b></span>
          </span>
          <span className="operations-threat-copy-v-a"><b>ПИРАТСКАЯ УГРОЗА</b><small>Рейд при проверке активной базы</small></span>
        </div>
        <nav className="operations-tabs-v2" role="tablist" aria-label="Состояние операций">
          {(Object.keys(TAB_LABELS) as OperationsTab[]).map((entry) => (
            <button key={entry} type="button" role="tab" aria-selected={tab === entry} className={tab === entry ? 'active' : ''} onClick={() => chooseTab(entry)}>
              <span>{TAB_LABELS[entry]}</span><b>{operationRows.filter(({ operation }) => operation.state === entry).length}</b>
            </button>
          ))}
        </nav>
        <div className="operations-slots-v2"><small>ПИРАТСКИЕ БАЗЫ</small><strong>{pirateContacts.length}</strong><span>активны</span></div>
      </header>
      {pirateAdaptiveDiagnostics && (() => {
        const d=pirateAdaptiveDiagnostics;
        const band=pirateAdaptiveInterval(d.q);
        const attempts=d.wins+d.draws+d.losses;
        const pct=(v:number)=>`${(v*100).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
        return <section className="operations-pirate-adaptive-test-v1" aria-label="Диагностика пиратов Test Mode" data-qa-pirate-adaptive-test>
          <div className="operations-pirate-adaptive-header-v1">
            <strong>TEST MODE // СКРЫТАЯ АДАПТАЦИЯ ПИРАТОВ</strong>
            {onPirateBattleExport && <button type="button" className="operations-pirate-export-button-v1"
              data-qa-pirate-export onClick={onPirateBattleExport}
              title="Скачать все бои текущего игрока с пиратскими базами: составы флотов, потери, раунды и коэффициенты">
              <span aria-hidden="true">↓</span> СКАЧАТЬ ВСЕ БОИ (.JSON)
            </button>}
          </div>
          <div className="operations-pirate-adaptive-metrics-v1">
            <span>Победы: <b data-qa-pirate-win-rate>{attempts?pct(d.wins/attempts):'—'}</b> ({d.wins}/{attempts})</span>
            <span>Взвешенный результат: <b data-qa-pirate-weighted-win>{d.weightedBattles>0?pct(d.weightedWins/d.weightedBattles):'—'}</b></span>
            <span>Адаптивный индекс Q: <b data-qa-pirate-q>{pct(d.q)}</b></span>
            <span>Гарнизон следующей атаки: <b data-qa-pirate-next-band>{pct(band.min)}–{pct(band.max)}</b> от отправленного населения</span>
            <span>Последний ролл: <b data-qa-pirate-last-roll>{d.lastRoll ? pct(d.lastRoll.coefficient) : '—'}</b>{d.lastRoll?' от '+d.lastRoll.sentPopulation.toLocaleString('ru-RU')+' населения':''}</span>
          </div>
          <small>Индекс влияет только на случайный размер гарнизона. Не назначает исход боя. Дешёвые незначимые бои не меняют его.</small>
        </section>;
      })()}
      <div className="operations-layout-v2">
        <section className="operations-feed-v2" aria-label={TAB_LABELS[tab]}>
          <header><div><small>{tab === 'completed' ? 'АРХИВ // ЗАВЕРШЁННЫЕ' : tab === 'active' ? 'КАНАЛ // В РАБОТЕ' : 'КАНАЛ // ДОСТУПНЫЕ'}</small>
            <strong>{tab === 'available' ? 'ВХОДЯЩИЕ КОНТАКТЫ' : tab === 'active' ? 'ПРИНЯТЫЕ ОПЕРАЦИИ' : 'ИТОГИ ОПЕРАЦИЙ'}</strong></div>
            <span>{visibleRows.length}</span></header>
          <nav className="operations-contact-filters-v-a" aria-label="Фильтр типа контакта">
            {([
              ['all', 'ВСЕ'], ['pirate', 'ПИРАТЫ'], ['unique', 'ОБЪЕКТЫ'], ['anomaly', 'АНОМАЛИИ'],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" data-filter-kind={value} aria-pressed={contactFilter === value}
                className={contactFilter === value ? 'active' : ''} onClick={() => setContactFilter(value)}>{label}</button>
            ))}
          </nav>
          <div className="operations-feed-scroll-v2">
            {visibleRows.length ? <div className="operations-feed-list-v2">
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
          onAccept={accept}
          onCancel={cancel}
          onReveal={onReveal}
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
