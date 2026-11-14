import { useClockNow } from './application/shared-clock';
import { advancePirateThreat, isOwnerProtectedFromPirates, pirateRaidChance, type OwnerPirateThreat } from './domain/pirates/threat.ts';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { REPORT_ICONS } from './ui/ui-icons.ts';

import { OPERATION_MODIFIER_LABELS } from './domain/operations/catalog.ts';
import type {
  OperationCategory,
  OperationId,
  OperationInstance,
  OperationLocation,
  OperationState,
  OperationsState,
} from './domain/operations/types.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import type { ResourceIconKind } from './ui/resources/resource-assets.ts';
import type { PirateContactPresentation } from './pirate-ui.ts';
import { isPirateOperationId, pirateContactOperation, pirateCycleOperation, pirateOperationId } from './application/pirate-presentation.ts';
import { getPirateRaidCheckProgress } from './domain/pirates/contact-schedule.ts';
import { pirateAdaptiveInterval, type PirateOwnerAdaptation } from './domain/pirates/adaptive.ts';
import { getPiratePlanetOperationDetailArt } from './pirate-planet-art.ts';
import { explorationOperationDetailArt } from './exploration-art.ts';
import { explorationProfile, EXPLORATION_RULES } from './domain/exploration/model.ts';
import { reconcileExplorationContact } from './domain/exploration/ledger.ts';
import type { ExplorationOperationPresentation } from './application/exploration.ts';
import type { UniversePlanetNode } from './domain/universe/types.ts';
import operationsHeaderIcon from './assets/ui/header-icons/operations.webp';
import availableIcon from './assets/ui/header-icons/ops-available.webp';
import activeIcon from './assets/ui/header-icons/ops-active.webp';
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
  onOpenFleets: () => void;
  onPirateCollectDebris?: (coordinate: CompletedPirateOperation['coordinate']) => void;
  pirateContacts?: readonly PirateContactPresentation[];
  pirateThreatPercent?: number;
  /** What the threat percent grows from; the screen advances it with its own clock (no per-second prop). */
  pirateThreatSeed?: { resourcePoints: number; battlePoints: number; threat: OwnerPirateThreat };
  /** Diagnostic only; NEVER pass in production runtime. */
  pirateAdaptiveDiagnostics?: PirateOwnerAdaptation;
  onPirateBattleExport?: () => void;
  pirateRaidRolls?: Readonly<Record<string, Readonly<{ checkAt: number; seed: string; flightId?: string }>>>;
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
type RaidRoll = Readonly<{ checkAt: number; seed: string; flightId?: string }>;
type CompletedPirateOperation = { cycleKey: string; coordinate: PirateContactPresentation['coordinate']; reportId: string; defeatedAt: number; rounds: number; debris: number; reward?: { sentCombatPopulation: number; historicalHangarCapacity: number; multiplier: number; basePirateDebris: number; bonusPirateDebris: number; ownDebris: number; threatReductionFraction: number } };
type OperationRow = { operation: OperationInstance; contact?: PirateContactPresentation; exploration?: ExplorationOperationContact; completed?: CompletedPirateOperation; battleReportId?: string };
type Tone = '' | 'ok' | 'bad' | 'am' | 'cy' | 'vi' | 'own';
type Resource = 'metal' | 'minerals' | 'gas' | 'debris';

const TAB_LABELS: Record<OperationsTab, string> = { available: 'Доступные', active: 'В работе', completed: 'Завершённые' };
const TAB_ICONS: Record<OperationsTab, string> = { available: availableIcon, active: activeIcon, completed: REPORT_ICONS.battle };
const LIST_TITLES: Record<OperationsTab, string> = { available: 'Доступные операции', active: 'Операции в работе', completed: 'Завершённые операции' };
const KIND_LABELS: Record<ContactKind, string> = { pirate: 'Пиратская база', unique: 'Уникальный объект', anomaly: 'Аномалия', other: 'Операция' };
const KIND_TONES: Record<ContactKind, Tone> = { pirate: 'bad', unique: 'am', anomaly: 'vi', other: 'cy' };
const FILTERS: readonly [ContactFilter, string][] = [['all', 'Все'], ['pirate', 'Пираты'], ['unique', 'Объекты'], ['anomaly', 'Аномалии']];
const RESOURCES: readonly Resource[] = ['metal', 'minerals', 'gas', 'debris'];
const RESOURCE_LABELS: Record<Resource, string> = { metal: 'Металл', minerals: 'Минералы', gas: 'Газ', debris: 'Обломки' };
const OCCUPANCY_LABELS = { free: 'Свободен', self: 'Ваш флот добывает', occupied: 'Занят чужим флотом' } as const;
const OCCUPANCY_TONES = { free: 'ok', self: 'own', occupied: 'bad' } as const;
/** How a player reads the risk class 1–5 of an object. */
const DANGER_WORDS = ['', 'Низкая', 'Низкая', 'Средняя', 'Высокая', 'Очень высокая'] as const;

const number = new Intl.NumberFormat('ru-RU');
const RISK_SLOT_MINUTES = Math.round(EXPLORATION_RULES.riskSlotMs / 60_000);

function contactKind(operation: OperationInstance, pirateContact?: PirateContactPresentation, exploration?: ExplorationOperationContact): ContactKind {
  if (pirateContact || isPirateOperationId(operation.id)) return 'pirate';
  if (exploration?.node.kind === 'anomaly') return 'anomaly';
  if (exploration?.node.kind === 'unique') return 'unique';
  return 'other';
}

function formatLocation(location: OperationLocation) {
  if (location.kind === 'system') return `Галактика ${location.galaxy}, система ${location.system}`;
  if (location.kind === 'coordinates') return location.coordinates;
  return location.label;
}

function remainingLabel(expiresAt: number, nowMs: number) {
  const seconds = Math.max(0, Math.ceil((expiresAt - nowMs) / 1_000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours} ч ${String(minutes).padStart(2, '0')} мин`;
  return minutes ? `${minutes} мин ${String(remainder).padStart(2, '0')} с` : `${remainder} с`;
}

function compactRemaining(expiresAt: number, nowMs: number) {
  const seconds = Math.max(0, Math.ceil((expiresAt - nowMs) / 1_000));
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} ч`;
  return seconds >= 60 ? `${Math.floor(seconds / 60)} мин` : `${seconds} с`;
}

/** Under five minutes the timer turns amber: decide now or lose the contact. */
function isUrgent(expiresAt: number | undefined, nowMs: number) {
  return typeof expiresAt === 'number' && expiresAt - nowMs < 300_000;
}

function lifetimePercent(startAt: number | undefined, expiresAt: number | undefined, nowMs: number) {
  if (!startAt || !expiresAt || expiresAt <= startAt) return undefined;
  return Math.max(0, Math.min(100, ((expiresAt - nowMs) / (expiresAt - startAt)) * 100));
}

function lowerFirst(text: string) {
  return text ? text[0]!.toLowerCase() + text.slice(1) : text;
}

function formatPercent(value: number) {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatDateTime(at: number) {
  return new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function sumCargo(cargo: Partial<Record<Resource, number>> | undefined) {
  return cargo ? RESOURCES.reduce((sum, key) => sum + (cargo[key] ?? 0), 0) : 0;
}

function pirateCycleParts(contact: PirateContactPresentation | undefined, operation: OperationInstance) {
  return (contact?.contactCycleKey ?? operation.id.replace(/^pirate:/, '')).split(':');
}

function pirateArtOf(parts: readonly string[]) {
  return getPiratePlanetOperationDetailArt(Number(parts[2] ?? 1), Number(parts[3] ?? 0));
}

function raidCheckText(contact: PirateContactPresentation, roll: RaidRoll | undefined, nowMs: number, delayMs: number | undefined, threatPercent: number) {
  if (roll) return roll.flightId ? { text: 'Пираты выслали рейд', tone: 'bad' as const } : { text: 'Рейда не было', tone: 'ok' as const };
  // A zero threat means the player is protected: the check cannot send a raid.
  if (threatPercent <= 0) return { text: 'Пока не нападут', tone: 'ok' as const };
  const check = getPirateRaidCheckProgress(Number(contact.contactCycleKey.split(':')[4]), nowMs, delayMs);
  return check.remainingMs > 0
    ? { text: `Решение о нападении через ${remainingLabel(check.nextAt, nowMs)}`, tone: '' as const, percent: check.percent }
    : { text: 'Пираты решают, напасть ли', tone: 'am' as const, percent: 100 };
}

// ---- shared presentation pieces (the «Командование» style) ---------------------

function Img({ src, className = '' }: { src: string; className?: string }) {
  return <img src={src} alt="" className={className} loading="lazy" draggable={false} />;
}

function Chip({ tone = '', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`op-chip ${tone ? `is-${tone}` : ''}`}>{children}</span>;
}

function KindChip({ kind }: { kind: ContactKind }) {
  return <Chip tone={KIND_TONES[kind]}>{KIND_LABELS[kind]}</Chip>;
}

type TileSpec = { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: ReactNode };

function Tiles({ items }: { items: readonly TileSpec[] }) {
  if (!items.length) return null;
  return (
    <div className="op-tiles" style={{ '--op-cols': Math.min(4, items.length) } as CSSProperties}>
      {items.slice(0, 4).map((item) => (
        <div className="op-tile" key={item.label}>
          {item.icon ? <span className="op-tile-icon">{item.icon}</span> : null}
          <div className="op-tile-copy">
            <small>{item.label}</small>
            <strong className={item.tone ? `is-${item.tone}` : ''}>{item.value}</strong>
            {item.sub ? <span>{item.sub}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, aside, children, qa }: { title: string; aside?: ReactNode; children: ReactNode; qa?: string }) {
  return (
    <section className="op-section" {...(qa ? { [qa]: '' } : {})}>
      <header><h3>{title}</h3>{aside ? <span>{aside}</span> : null}</header>
      {children}
    </section>
  );
}

function ResourceRows({ rows }: { rows: readonly { key: Resource; value: ReactNode; sub?: ReactNode }[] }) {
  return (
    <ul className="op-res">
      {rows.map((row) => (
        <li key={row.key}>
          <ResourceIcon kind={row.key as ResourceIconKind} />
          <span>{RESOURCE_LABELS[row.key]}</span>
          <strong>{row.value}</strong>
          {row.sub ? <small>{row.sub}</small> : null}
        </li>
      ))}
    </ul>
  );
}

function Bar({ percent, label, tone = '' }: { percent: number; label: string; tone?: Tone }) {
  return (
    <div className={`op-bar ${tone ? `is-${tone}` : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
      <i style={{ '--op-fill': `${Math.max(0, Math.min(100, percent))}%` } as CSSProperties} />
    </div>
  );
}

function Lifetime({ expiresAt, startAt, nowMs, note }: { expiresAt: number; startAt?: number; nowMs: number; note: string }) {
  const urgent = isUrgent(expiresAt, nowMs);
  return (
    <div className="op-lifetime">
      <div><small>Исчезнет через</small><b role="timer" className={urgent ? 'is-am' : ''}>{remainingLabel(expiresAt, nowMs)}</b></div>
      <Bar percent={lifetimePercent(startAt, expiresAt, nowMs) ?? 0} label="Оставшееся время контакта" tone={urgent ? 'am' : ''} />
      <small className="op-note">{note}</small>
    </div>
  );
}

function Steps({ labels, current }: { labels: readonly string[]; current: number }) {
  return (
    <ol className="op-steps" aria-label="Этапы операции">
      {labels.map((label, index) => (
        <li key={label} className={index < current ? 'is-done' : index === current ? 'is-current' : ''} aria-current={index === current ? 'step' : undefined}>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** The one line that tells the player what to do next. Kept on `.operations-objective-v2` for the pirate QA. */
function NextStep({ children }: { children: ReactNode }) {
  return <p className="operations-objective-v2 op-next"><small>Что дальше</small><span>{children}</span></p>;
}

function Dossier({ kind, art, chips, title, place, description, children, status, actions, dataAttrs, completed = false }: {
  kind: ContactKind;
  art: ReactNode;
  chips: ReactNode;
  title: string;
  place?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  status: ReactNode;
  actions: ReactNode;
  dataAttrs?: Record<string, string | undefined>;
  completed?: boolean;
}) {
  return (
    <section className={`operations-dossier-variant-a op-panel op-dossier ${completed ? 'is-completed' : ''}`} data-contact-kind={kind} {...dataAttrs}>
      <div className="op-dossier-body">
        <div className="op-hero">
          <div className="op-art">{art}</div>
          <div className="op-hero-copy">
            <div className="op-chips">{chips}</div>
            <h2 className="op-hero-title">{title}</h2>
            {place}
            {description ? <p className="op-desc">{description}</p> : null}
          </div>
        </div>
        {children}
      </div>
      <footer className="op-foot">
        <div className="op-foot-status">{status}</div>
        <div className="op-actions">{actions}</div>
      </footer>
    </section>
  );
}

function FootStatus({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <><small>{label}</small><strong>{value}</strong>{note ? <span>{note}</span> : null}</>;
}

function PlaceLink({ label, onOpen }: { label: string; onOpen?: () => void }) {
  if (!onOpen) return <span className="op-place">{label}</span>;
  return <button type="button" className="op-place op-link" onClick={onOpen} data-tip="Открыть во Вселенной">{label} <span aria-hidden="true">↗</span></button>;
}

// ---- list ----------------------------------------------------------------------

function OperationCard({ row, selected, onSelect, nowMs, threatPercent, pirateRaidRoll, pirateCheckDelayMs }: {
  row: OperationRow;
  threatPercent: number;
  selected: boolean;
  onSelect: () => void;
  nowMs: number;
  pirateRaidRoll?: RaidRoll;
  pirateCheckDelayMs?: number;
}) {
  const { operation, contact, exploration, completed } = row;
  const kind = contactKind(operation, contact, exploration);
  const pirate = kind === 'pirate';
  const done = operation.state === 'completed';
  const art = exploration
    ? explorationOperationDetailArt(exploration.node.kind, exploration.node.art)
    : pirate ? pirateArtOf(pirateCycleParts(contact, operation)) : null;
  const expiresAt = exploration?.node.special?.expiresAt ?? contact?.expiresAt;
  const title = exploration?.node.name ?? (pirate ? 'Пиратская база' : operation.title);
  const lastEvent = [...(exploration?.contact?.events ?? [])].reverse()
    .find((event) => event.ownerId === exploration?.ownerId && (event.kind === 'returned' || event.kind === 'origin-destroyed'));
  const completedResult = pirate ? 'success' : lastEvent?.kind === 'returned' ? 'success' : lastEvent?.kind === 'origin-destroyed' ? 'failure' : 'unknown';

  let status: { text: string; tone: Tone; qa?: string };
  if (done) {
    status = pirate && completed
      ? { text: `Победа · обломков ${number.format(completed.debris)}`, tone: 'ok' }
      : completedResult === 'success'
        ? { text: `Доставлено ${number.format(sumCargo(lastEvent?.creditedCargo ?? lastEvent?.cargo))}`, tone: 'ok', qa: 'completed' }
        : completedResult === 'failure' ? { text: 'Флот потерян', tone: 'bad', qa: 'completed' } : { text: 'Завершено', tone: '', qa: 'completed' };
  } else if (contact) {
    status = raidCheckText(contact, pirateRaidRoll, nowMs, pirateCheckDelayMs, threatPercent);
  } else if (exploration) {
    status = exploration.reconInFlight
      ? { text: exploration.reconInFlight.phase === 'outbound' ? 'Зонд летит к объекту' : 'Зонд возвращается', tone: 'cy', qa: exploration.occupancy }
      : { text: OCCUPANCY_LABELS[exploration.occupancy], tone: OCCUPANCY_TONES[exploration.occupancy], qa: exploration.occupancy };
  } else {
    status = { text: operation.objective.label, tone: '' };
  }
  const doneAt = done ? (completed?.defeatedAt ?? lastEvent?.at) : undefined;

  return (
    <button
      type="button"
      className={`operation-feed-card-v2 op-item ${selected ? 'selected is-selected' : ''}`}
      data-contact-kind={kind}
      data-completion-result={done ? completedResult : undefined}
      data-threat={operation.threat ?? 'unknown'}
      data-qa-pirate-contact={contact?.contactCycleKey}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className={`op-item-art ${pirate ? 'operation-feed-pirate-art-v2' : ''}`}>
        {art ? <Img src={art} /> : <OperationGlyph category={operation.category} />}
      </span>
      <span className="op-item-main">
        <strong>{title}</strong>
        <span className="op-item-tags"><KindChip kind={kind} /><span>{formatLocation(operation.location)}</span></span>
        <span className={`op-item-status ${status.tone ? `is-${status.tone}` : ''}`} data-qa-exploration-feed-status={exploration ? status.qa : undefined}>{status.text}</span>
      </span>
      <span className="op-item-side">
        {done
          ? (doneAt ? <time>{new Date(doneAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time> : null)
          : expiresAt ? <time role="timer" className={isUrgent(expiresAt, nowMs) ? 'is-am' : ''}>{compactRemaining(expiresAt, nowMs)}</time> : null}
      </span>
    </button>
  );
}

function OperationGlyph({ category }: { category: OperationCategory }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (category === 'combat') return <svg viewBox="0 0 40 40" aria-hidden="true"><circle {...common} cx="20" cy="20" r="12" /><circle {...common} cx="20" cy="20" r="4" /><path {...common} d="M20 4v8M20 28v8M4 20h8M28 20h8" /></svg>;
  if (category === 'science') return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="M16 5h8M17 5v10L9 31c-1 2 .1 4 3 4h16c2.9 0 4-2 3-4l-8-16V5" /><path {...common} d="M13 27h14M16 21h8" /></svg>;
  if (category === 'exploration') return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="m20 5 8 25-8-6-8 6 8-25Z" /><circle {...common} cx="20" cy="19" r="3" /></svg>;
  return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="M7 30c4-8 10-12 18-12M11 34c3-6 7-9 14-9M25 18c4 0 7 3 7 7" /><circle {...common} cx="27" cy="12" r="4" /><path {...common} d="M27 4v4M35 12h-4" /></svg>;
}

function EmptyList({ tab, filtered }: { tab: OperationsTab; filtered: boolean }) {
  const text = filtered ? 'Операций этого вида здесь нет.'
    : tab === 'active' ? 'Вы пока не приняли ни одной операции.'
      : tab === 'completed' ? 'Итогов пока нет.'
        : 'Новых операций сейчас нет.';
  return <p className="operations-empty-v2 op-empty">{text}</p>;
}

function EmptyDossier({ tab, onTab }: { tab: OperationsTab; onTab: (tab: OperationsTab) => void }) {
  const copy = tab === 'active'
    ? { title: 'Ничего не в работе', text: 'Примите операцию во вкладке «Доступные»: после этого можно отправить зонд, экспедицию или рейд.', action: <button type="button" onClick={() => onTab('available')}>Открыть доступные</button> }
    : tab === 'completed'
      ? { title: 'Итогов пока нет', text: 'Здесь появятся вернувшиеся экспедиции и победы над пиратскими базами. Полные отчёты о боях и полётах лежат в «Сообщениях».', action: null }
      : { title: 'Операций нет', text: 'Пиратские базы появляются в системах ваших колоний, уникальные объекты и аномалии — на карте Вселенной. Каждый контакт живёт ограниченное время, загляните позже.', action: null };
  return (
    <section className="operations-dossier-variant-a op-panel op-dossier op-dossier--empty" data-contact-kind="other">
      <div className="op-dossier-body">
        <div className="op-placeholder">
          <Img src={operationsHeaderIcon} />
          <strong>{copy.title}</strong>
          <p>{copy.text}</p>
          {copy.action}
        </div>
      </div>
    </section>
  );
}

// ---- dossiers ------------------------------------------------------------------

type DossierProps = {
  row: OperationRow;
  nowMs: number;
  threatPercent: number;
  pirateRaidRoll?: RaidRoll;
  pirateCheckDelayMs?: number;
  onExpedition?: (node: UniversePlanetNode) => void;
  onExplorationAttack?: (node: UniversePlanetNode) => void;
  onBot01Occupy?: (node: UniversePlanetNode) => void;
  onExplorationRecon?: (node: UniversePlanetNode) => void;
  onExplorationUniverse?: (node: UniversePlanetNode) => void;
  onExplorationReport?: (reportId: string) => void;
  onPirateBattleReport?: (reportId: string) => void;
  onPirateRecon?: (contact: PirateContactPresentation) => void;
  onPirateAttack?: (contact: PirateContactPresentation) => void;
  onPirateReport?: (reportId: string) => void;
  onPirateUniverse?: (contact: PirateContactPresentation) => void;
  onAccept: (id: OperationId) => void;
  onCancel: (id: OperationId) => void;
  onOpenFleets: () => void;
  onPirateCollectDebris?: (coordinate: CompletedPirateOperation['coordinate']) => void;
};

function ExplorationDossier({ row, nowMs, onExpedition, onExplorationAttack, onBot01Occupy, onExplorationRecon, onExplorationUniverse, onExplorationReport, onAccept, onCancel, onOpenFleets }: DossierProps) {
  const exploration = row.exploration!;
  const operation = row.operation;
  const node = exploration.node;
  const kind = contactKind(operation, undefined, exploration);
  const known = exploration.recon?.success === true;
  const failed = exploration.recon?.success === false;
  const profile = explorationProfile(node.kind as 'unique' | 'anomaly', node.special?.profileVariant ?? 1);
  const completed = exploration.stage === 'completed';
  const accepted = exploration.stage === 'active';
  const resourceRows = RESOURCES.filter((key) => (profile.weights[key] ?? 0) > 0);
  const lastReturn = [...(exploration.contact?.events ?? [])].reverse().find((event) =>
    (event.kind === 'returned' || event.kind === 'origin-destroyed') && event.ownerId === exploration.ownerId);
  const battleEvent = [...(exploration.contact?.events ?? [])].reverse().find((event) => /:(capture|contest)$/.test(event.id));
  const combatReportId = battleEvent ? 'battle:battle-exploration-' + battleEvent.id.replace(/:(capture|contest)$/, '') : null;
  const cooldownAt = (exploration.recon?.resolvedAt ?? 0) + EXPLORATION_RULES.reconCooldownMs;
  const inCooldown = Boolean(exploration.recon && cooldownAt > nowMs);
  const probeOut = exploration.reconInFlight?.phase === 'outbound';
  const projected = exploration.contact?.claim ? reconcileExplorationContact(exploration.contact, nowMs) : exploration.contact;
  const mine = projected?.claim?.ownerId === exploration.ownerId ? projected.claim : undefined;
  const liveCargoTotal = sumCargo(mine?.cargo);
  const delivered = lastReturn?.creditedCargo ?? lastReturn?.cargo;
  const deliveredTotal = sumCargo(delivered);
  const success = lastReturn?.kind === 'returned';
  const failure = lastReturn?.kind === 'origin-destroyed';
  const reportId = success && lastReturn ? 'exploration-return:' + lastReturn.flightId : null;
  const danger = DANGER_WORDS[profile.risk];
  const tokenChance = formatPercent(profile.tokenP12 * 100);
  const openMap = onExplorationUniverse ? () => onExplorationUniverse(node) : undefined;
  const stage = exploration.reconInFlight?.phase === 'returning' ? 3 : probeOut ? 1 : exploration.occupancy === 'self' ? 2 : 0;
  const stepLabels = ['Принята', 'Флот в пути', 'Добыча', 'Возврат'];

  const tiles: TileSpec[] = completed
    ? [
      { label: 'Итог', value: success ? 'Исследовано' : failure ? 'Флот потерян' : 'Завершено', sub: lastReturn ? formatDateTime(lastReturn.at) : 'время контакта вышло', tone: success ? 'ok' : failure ? 'bad' : '' },
      { label: 'Доставлено', value: deliveredTotal > 0 ? `+${number.format(deliveredTotal)}` : 'Ничего', sub: deliveredTotal > 0 ? 'ресурсов на планету' : 'доставки не было', tone: deliveredTotal > 0 ? 'ok' : '' },
      { label: 'Жетоны ремонта', value: lastReturn?.repairTokens ? `+${lastReturn.repairTokens}` : 'Не найдены', sub: 'для Ремонтной мастерской', tone: lastReturn?.repairTokens ? 'am' : '' },
    ]
    : [
      known
        ? { label: 'Запасы', value: resourceRows.map((key) => RESOURCE_LABELS[key]).join(', '), sub: 'по данным зонда', tone: 'cy' }
        : { label: 'Запасы', value: 'Неизвестны', sub: probeOut ? 'зонд летит к объекту' : failed ? 'зонд не получил данных' : 'отправьте зонд', tone: '' },
      known
        ? { label: 'Опасность', value: danger, sub: `${profile.risk} из 5`, tone: profile.risk >= 4 ? 'bad' : profile.risk === 3 ? 'am' : 'ok' }
        : { label: 'Опасность', value: 'Неизвестна', sub: 'видна после разведки', tone: '' },
      mine
        ? { label: 'В трюме', value: number.format(liveCargoTotal), sub: `из ${number.format(mine.cargoCapacity)}`, tone: 'ok' }
        : { label: 'Объект', value: OCCUPANCY_LABELS[exploration.occupancy], sub: exploration.occupancy === 'occupied' ? 'можно атаковать' : 'можно отправить флот', tone: OCCUPANCY_TONES[exploration.occupancy] },
    ];

  const next = completed
    ? success
      ? deliveredTotal > 0 ? 'Добыча уже на планете отправки, обломки — в запасе переработки. Объект исчерпан для вас в этом цикле.' : 'Экспедиция вернулась пустой. Транспортёры везут металл, минералы и газ, обломки собирают только переработчики.'
      : failure ? 'Планета отправки потеряна, груз не доставлен.' : 'Время контакта вышло, доставки не было.'
    : !accepted ? 'Примите операцию: после этого можно отправить зонд и экспедицию.'
      : exploration.occupancy === 'self' ? 'Ваш флот добывает. Груз попадёт на планету только после возвращения: отзовите флот до исчезновения объекта.'
        : exploration.occupancy === 'occupied' ? 'Объект занят чужим флотом. Атакуйте его, чтобы занять объект самому.'
          : known ? 'Отправьте экспедицию: транспортёры везут ресурсы, переработчики собирают обломки.'
            : 'Отправьте зонд, чтобы узнать запасы и опасность, или сразу экспедицию.';

  const reconDisabledReason = !onExplorationRecon ? 'Зонд сейчас недоступен'
    : exploration.reconInFlight ? 'Зонд уже в пути'
      : inCooldown ? `Следующий зонд через ${Math.ceil((cooldownAt - nowMs) / 1000)} с` : null;

  return (
    <Dossier
      kind={kind}
      completed={completed}
      dataAttrs={{ 'data-qa-exploration-dossier': node.id }}
      art={<Img src={explorationOperationDetailArt(node.kind, node.art)} />}
      chips={<>
        <KindChip kind={kind} />
        <span data-qa-exploration-status={completed ? 'completed' : exploration.occupancy}>
          {completed ? <Chip tone={success ? 'ok' : failure ? 'bad' : ''}>Завершена</Chip> : <Chip tone={OCCUPANCY_TONES[exploration.occupancy]}>{OCCUPANCY_LABELS[exploration.occupancy]}</Chip>}
        </span>
      </>}
      title={node.name}
      place={<PlaceLink label={formatLocation(operation.location)} onOpen={openMap} />}
      description={node.description}
      status={completed
        ? <FootStatus label="Статус" value={success ? 'Завершена, добыча доставлена' : 'Завершена'} />
        : accepted
          ? <FootStatus label="Статус" value="В работе" note={reconDisabledReason ?? undefined} />
          : <FootStatus label="Статус" value={exploration.occupancy === 'occupied' ? 'Объект занят другим флотом' : 'Можно принять'} />}
      actions={<>
        {!completed && exploration.occupancy === 'free' && onBot01Occupy ? (
          <button type="button" className="op-test" data-qa-bot={node.id} data-qa-bot01-exploration={node.id} onClick={() => onBot01Occupy(node)}>Тест: Бот 01 занимает</button>
        ) : null}
        {!completed && !accepted ? (
          <button type="button" className="primary op-lg" data-qa-exploration-accept={node.id} onClick={() => onAccept(operation.id)}>Принять операцию</button>
        ) : null}
        {!completed && accepted ? <>
          <button type="button" className="danger" onClick={() => onCancel(operation.id)}>Отменить</button>
          <button type="button" data-qa-exploration-recon={node.id} disabled={Boolean(reconDisabledReason)} onClick={() => onExplorationRecon?.(node)}>
            {exploration.reconInFlight ? 'Зонд в пути' : 'Отправить зонд'}
          </button>
          {exploration.occupancy === 'free'
            ? <button type="button" className="primary op-lg" disabled={!onExpedition} data-qa-operation-expedition={node.id} onClick={() => onExpedition?.(node)}>Отправить экспедицию</button>
            : exploration.occupancy === 'self'
              ? <button type="button" className="primary op-lg" onClick={onOpenFleets}>Отозвать флот</button>
              : <button type="button" className="primary op-lg" data-qa-exploration-attack={node.id} disabled={!onExplorationAttack} onClick={() => onExplorationAttack?.(node)}>Атаковать объект</button>}
        </> : null}
        {completed && reportId && onExplorationReport ? (
          <button type="button" className="primary op-lg" onClick={() => onExplorationReport(reportId)}>Открыть отчёт</button>
        ) : null}
      </>}
    >
      {!completed && node.special?.expiresAt
        ? <Lifetime expiresAt={node.special.expiresAt} startAt={node.special.startAt} nowMs={nowMs} note="Затем объект пропадёт с карты." />
        : null}
      {accepted ? <Steps labels={stepLabels} current={stage} /> : null}
      <Tiles items={tiles} />
      <NextStep>{next}</NextStep>

      {completed ? (
        <Section title="Что привезли">
          {success
            ? <ResourceRows rows={RESOURCES.map((key) => ({ key, value: number.format(delivered?.[key] ?? 0) }))} />
            : <p className="op-text">{failure ? 'Флот вернулся к уничтоженной планете: ресурсы не доставлены.' : 'Время контакта вышло. Доставки по этому циклу нет.'}</p>}
        </Section>
      ) : null}

      {mine ? (
        <Section title="Добыча вашего флота" aside={`${number.format(liveCargoTotal)} из ${number.format(mine.cargoCapacity)}`} qa="data-qa-exploration-live-cargo">
          <Bar percent={(liveCargoTotal / Math.max(1, mine.cargoCapacity)) * 100} label="Заполнение трюма" tone="ok" />
          <ResourceRows rows={RESOURCES.map((key) => ({ key, value: number.format(mine.cargo[key] ?? 0) }))} />
          <p className="op-note">Обломки собирают только переработчики.</p>
        </Section>
      ) : null}

      {!completed ? (
        <Section title="Разведка" aside={known ? 'Данные получены' : probeOut ? 'Зонд в пути' : failed ? 'Неудача' : 'Нет данных'}>
          <p className="op-text">{probeOut
            ? 'Зонд летит к объекту. Доклад придёт после прибытия.'
            : known
              ? 'Зонд изучил объект: ниже запасы и что вам грозит.'
              : failed
                ? 'Зонд не получил данных. Запасы и опасность пока скрыты, можно отправить ещё один.'
                : `Один шпионский зонд узнаёт запасы и опасность объекта. Получается в ${Math.round(EXPLORATION_RULES.reconSuccess * 100)}% случаев.`}</p>
          {known ? (
            <ResourceRows rows={resourceRows.map((key) => ({
              key,
              value: `${number.format(exploration.contact?.resourceReserve[key] ?? 0)} из ${number.format(exploration.contact?.initialReserve[key] ?? 0)}`,
              sub: `${profile.weights[key]}% добычи`,
            }))} />
          ) : null}
          {known ? (
            <ul className="op-facts">
              <li><small>Соперники</small><span>Пытаются отбить объект: {Math.round(EXPLORATION_RULES.npcAttemptChance[profile.risk] * 100)}% каждые {RISK_SLOT_MINUTES} мин.</span></li>
              {node.kind === 'anomaly' ? <li><small>Всплеск</small><span>Сжигает до 10% груза: {Math.round(EXPLORATION_RULES.anomalyHazardChance[profile.risk] * 100)}% каждые {RISK_SLOT_MINUTES} мин.</span></li> : null}
              <li><small>Редкая находка</small><span>Жетон ремонта: {tokenChance} за каждые 12 мин добычи.</span></li>
            </ul>
          ) : null}
          {exploration.recon && onExplorationReport ? (
            <button type="button" className="op-link" onClick={() => onExplorationReport('exploration-recon:' + exploration.recon!.flightId)}>
              Доклад разведки от {formatDateTime(exploration.recon.resolvedAt)} <span aria-hidden="true">↗</span>
            </button>
          ) : null}
        </Section>
      ) : null}

      {combatReportId && onExplorationReport ? (
        <button type="button" data-qa-exploration-battle-report={combatReportId} className="op-link" onClick={() => onExplorationReport(combatReportId)}>
          Доклад о бое за объект <span aria-hidden="true">↗</span>
        </button>
      ) : null}
    </Dossier>
  );
}

function PirateCompletedDossier({ row, onPirateBattleReport, onPirateCollectDebris }: DossierProps) {
  const completed = row.completed!;
  const reward = completed.reward;
  const tiles: TileSpec[] = [
    { label: 'Итог', value: 'Победа', sub: `бой за ${completed.rounds} р.`, tone: 'ok' },
    { label: 'Обломки на орбите', value: number.format(completed.debris), sub: 'у бывшей базы', tone: 'ok', icon: <ResourceIcon kind="debris" /> },
    ...(reward ? [{ label: 'Угроза снизилась', value: `на ${formatPercent(reward.threatReductionFraction * 100)}`, sub: 'за полную победу', tone: 'ok' as const }] : []),
  ];
  return (
    <Dossier
      kind="pirate"
      completed
      art={<div className="op-art-wrap" data-qa-pirate-hero-art><Img src={pirateArtOf(completed.cycleKey.split(':'))} /></div>}
      chips={<><KindChip kind="pirate" /><Chip tone="ok">Победа</Chip></>}
      title="Пиратская база"
      place={<span className="op-place">{formatLocation(row.operation.location)}</span>}
      description={`Гарнизон уничтожен ${formatDateTime(completed.defeatedAt)}.`}
      status={<FootStatus label="Статус" value="Завершена победой" />}
      actions={onPirateBattleReport || onPirateCollectDebris ? <>
        {onPirateCollectDebris && completed.debris > 0 ? <button type="button" className="primary op-lg" data-qa-pirate-collect-debris onClick={() => onPirateCollectDebris(completed.coordinate)}>Собрать обломки</button> : null}
        {onPirateBattleReport ? <button type="button" className={onPirateCollectDebris && completed.debris > 0 ? 'op-lg' : 'primary op-lg'} onClick={() => onPirateBattleReport(completed.reportId)}>Доклад о бое</button> : null}
      </> : null}
    >
      <Tiles items={tiles} />
      <NextStep>Чтобы забрать обломки, отправьте переработчики к координатам базы: кнопка «Собрать обломки» откроет «Флоты» с этой целью.</NextStep>
      {reward ? (
        <Section title="Как посчитаны обломки">
          <ul className="op-facts">
            <li><small>Отправлено в бой</small><span>{number.format(reward.sentCombatPopulation)} из {number.format(reward.historicalHangarCapacity)} мест флота</span></li>
            <li><small>Обломки пиратов</small><span>{number.format(reward.basePirateDebris)} {reward.bonusPirateDebris >= 0 ? '+' : '−'} {number.format(Math.abs(reward.bonusPirateDebris))} за размер флота (×{reward.multiplier.toLocaleString('ru-RU')})</span></li>
            <li><small>Ваши обломки</small><span>{number.format(reward.ownDebris)}</span></li>
          </ul>
        </Section>
      ) : null}
    </Dossier>
  );
}

function PirateDossier(props: DossierProps) {
  const { row, nowMs, threatPercent, pirateRaidRoll, pirateCheckDelayMs, onAccept, onCancel, onPirateRecon, onPirateAttack, onPirateReport, onPirateUniverse, onPirateBattleReport } = props;
  if (row.completed) return <PirateCompletedDossier {...props} />;
  const { operation, contact } = row;
  const parts = pirateCycleParts(contact, operation);
  const active = operation.state === 'active';
  const done = operation.state === 'completed';
  const recon = contact?.latestReportOutcome === 'success' ? { value: 'Гарнизон известен', tone: 'ok' as Tone }
    : contact?.latestReportOutcome === 'failure' ? { value: 'Неудача', tone: 'bad' as Tone }
      : contact?.statusLabel === 'Зонд в пути' ? { value: 'Зонд в пути', tone: 'cy' as Tone } : { value: 'Нет данных', tone: '' as Tone };
  const raid = contact ? raidCheckText(contact, pirateRaidRoll, nowMs, pirateCheckDelayMs, threatPercent) : null;
  const tiles: TileSpec[] = [
    { label: 'Разведка', value: recon.value, sub: contact?.latestReportId ? 'доклад в «Сообщениях»' : 'отправьте зонд', tone: recon.tone },
    ...(raid ? [{ label: 'Нападение на вас', value: raid.text, sub: threatPercent > 0 ? `шанс ${formatPercent(threatPercent)}` : 'у вас защита от пиратов', tone: raid.tone }] : []),
    { label: 'Награда', value: '125–175%', sub: 'прочности пиратов в обломках', tone: 'ok', icon: <ResourceIcon kind="debris" /> },
  ];
  const next = !contact ? 'База исчезла, рейд на прежние координаты не отправить.'
    : !active ? 'Примите операцию: после этого можно отправить зонд и подготовить рейд.'
      : contact.latestReportOutcome === 'success' ? 'Гарнизон известен. Соберите флот сильнее гарнизона и подготовьте рейд.'
        : contact.latestReportOutcome === 'failure' ? 'Зонд не принёс данных. Отправьте ещё один или атакуйте вслепую.'
          : 'Отправьте зонд: доклад покажет состав гарнизона.';
  const reconBlocked = contact && !contact.recon.enabled ? contact.recon.disabledReason : null;
  const attackBlocked = contact && !contact.elimination.enabled ? contact.elimination.disabledReason : null;

  return (
    <Dossier
      kind="pirate"
      completed={done}
      art={<div className="op-art-wrap" data-qa-pirate-hero-art><Img src={pirateArtOf(parts)} /></div>}
      chips={<><KindChip kind="pirate" /><Chip tone={active ? 'own' : contact ? 'am' : ''}>{!contact ? 'Исчезла' : active ? 'В работе' : 'Обнаружена'}</Chip></>}
      title="Пиратская база"
      place={<PlaceLink label={formatLocation(operation.location)} onOpen={contact && onPirateUniverse ? () => onPirateUniverse(contact) : undefined} />}
      description={contact ? 'База в системе вашей колонии. Через 15 минут после появления пираты решают, напасть ли на ваши планеты в этой системе.' : 'Цикл закончился или база исчезла.'}
      status={<FootStatus label="Статус" value={!contact ? 'Завершена' : active ? 'В работе' : 'Можно принять'} note={active ? (reconBlocked ? `Зонд: ${lowerFirst(reconBlocked)}` : attackBlocked ? `Рейд: ${lowerFirst(attackBlocked)}` : undefined) : undefined} />}
      actions={<>
        {done && row.battleReportId && onPirateBattleReport ? <button type="button" className="primary op-lg" onClick={() => onPirateBattleReport(row.battleReportId!)}>Доклад о бое</button> : null}
        {contact && operation.state === 'available' ? <button type="button" className="primary op-lg" onClick={() => onAccept(operation.id)}>Принять операцию</button> : null}
        {contact && active ? <>
          <button type="button" className="danger" onClick={() => onCancel(operation.id)}>Отменить</button>
          <button type="button" disabled={!contact.recon.enabled || !onPirateRecon} onClick={() => onPirateRecon?.(contact)}>Отправить зонд</button>
          <button type="button" className="primary op-lg" disabled={!contact.elimination.enabled || !onPirateAttack} onClick={() => onPirateAttack?.(contact)}>Подготовить рейд</button>
        </> : null}
      </>}
    >
      {contact ? <Lifetime expiresAt={contact.expiresAt} startAt={Number(parts[4])} nowMs={nowMs} note="Потом 15 минут затишья, и база может появиться снова." /> : null}
      {active ? <Steps labels={['Принята', 'Разведка', 'Рейд', 'Возврат']} current={contact?.latestReportId ? 2 : 1} /> : null}
      <Tiles items={tiles} />
      <NextStep>{next}</NextStep>
      {contact?.latestReportId && onPirateReport ? (
        <button type="button" className="op-link" onClick={() => onPirateReport(contact.latestReportId!)}>Доклад разведки о гарнизоне <span aria-hidden="true">↗</span></button>
      ) : null}
    </Dossier>
  );
}

/** Older non-pirate operations from the save; no live source creates them any more. */
function GenericDossier({ row, onAccept, onCancel, onOpenFleets }: DossierProps) {
  const { operation } = row;
  const active = operation.state === 'active';
  const rewards = RESOURCES.filter((key) => key !== 'debris' && typeof operation.rewardPreview[key as 'metal'] === 'number');
  return (
    <Dossier
      kind="other"
      completed={operation.state === 'completed'}
      dataAttrs={{ 'data-threat': String(operation.threat ?? 'unknown') }}
      art={<span className="op-glyph"><OperationGlyph category={operation.category} /></span>}
      chips={<KindChip kind="other" />}
      title={operation.title}
      place={<span className="op-place">{formatLocation(operation.location)}</span>}
      description={operation.briefing}
      status={<FootStatus label="Статус" value={active ? 'В работе' : operation.state === 'completed' ? 'Завершена' : 'Можно принять'} />}
      actions={<>
        {operation.state === 'available' && operation.intel > 0 ? <button type="button" className="primary op-lg" onClick={() => onAccept(operation.id)}>Принять операцию</button> : null}
        {active ? <button type="button" className="danger" onClick={() => onCancel(operation.id)}>Отменить</button> : null}
        {active ? <button type="button" className="primary op-lg" onClick={onOpenFleets}>К флотам</button> : null}
      </>}
    >
      <NextStep>{operation.objective.label}</NextStep>
      {operation.modifiers.length ? <div className="op-chips">{operation.modifiers.map((modifier) => <Chip key={modifier}>{OPERATION_MODIFIER_LABELS[modifier]}</Chip>)}</div> : null}
      {rewards.length ? <Section title="Награда"><ResourceRows rows={rewards.map((key) => ({ key, value: number.format(operation.rewardPreview[key as 'metal'] ?? 0) }))} /></Section> : null}
    </Dossier>
  );
}

function OperationDossier(props: DossierProps) {
  if (props.row.exploration) return <ExplorationDossier {...props} />;
  if (contactKind(props.row.operation, props.row.contact) === 'pirate') return <PirateDossier {...props} />;
  return <GenericDossier {...props} />;
}

// ---- test mode -----------------------------------------------------------------

function PirateDiagnostics({ diagnostics, onExport }: { diagnostics: PirateOwnerAdaptation; onExport?: () => void }) {
  const band = pirateAdaptiveInterval(diagnostics.q);
  const attempts = diagnostics.wins + diagnostics.draws + diagnostics.losses;
  const pct = (value: number) => `${(value * 100).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return (
    <section className="operations-pirate-adaptive-test-v1 op-test-box" aria-label="Тест: подстройка пиратов" data-qa-pirate-adaptive-test>
      <small>Тест: подстройка пиратов</small>
      <dl>
        <div><dt>Победы</dt><dd><b data-qa-pirate-win-rate>{attempts ? pct(diagnostics.wins / attempts) : '—'}</b> ({diagnostics.wins}/{attempts})</dd></div>
        <div><dt>С учётом веса боёв</dt><dd><b data-qa-pirate-weighted-win>{diagnostics.weightedBattles > 0 ? pct(diagnostics.weightedWins / diagnostics.weightedBattles) : '—'}</b></dd></div>
        <div><dt>Индекс подстройки</dt><dd><b data-qa-pirate-q>{pct(diagnostics.q)}</b></dd></div>
        <div><dt>Следующий гарнизон</dt><dd><b data-qa-pirate-next-band>{pct(band.min)}–{pct(band.max)}</b></dd></div>
        <div><dt>Последний гарнизон</dt><dd><b data-qa-pirate-last-roll>{diagnostics.lastRoll ? pct(diagnostics.lastRoll.coefficient) : '—'}</b>{diagnostics.lastRoll ? ` от ${diagnostics.lastRoll.sentPopulation.toLocaleString('ru-RU')}` : ''}</dd></div>
      </dl>
      <span>Индекс меняет только размер гарнизона, не исход боя.</span>
      {onExport ? <button type="button" data-qa-pirate-export onClick={onExport}>Скачать все бои (JSON)</button> : null}
    </section>
  );
}

// ---- screen --------------------------------------------------------------------

export function OperationsView({ state, onAccept, onCancel, onOpenFleets, explorationContacts = [], onExpedition, onExplorationAttack, onBot01Occupy, onExplorationAccept, onExplorationCancel, onExplorationRecon, onExplorationUniverse, onExplorationReport, pirateContacts = [], pirateThreatPercent: pirateThreatOverride, pirateThreatSeed, pirateAdaptiveDiagnostics, onPirateBattleExport, pirateRaidRolls = {}, pirateOwnerId = '', pirateCheckDelayMs, completedPirateOperations = [], nowMs: nowOverride, onPirateAccept, onPirateCancel, onPirateRecon, onPirateAttack, onPirateReport, onPirateBattleReport, onPirateUniverse, onPirateCollectDebris }: OperationsViewProps) {
  const clockNow = useClockNow();
  const nowMs = nowOverride ?? clockNow;
  const pirateThreatPercent = pirateThreatOverride ?? (pirateThreatSeed
    ? (isOwnerProtectedFromPirates(pirateThreatSeed.resourcePoints, pirateThreatSeed.battlePoints) ? 0
      : 100 * pirateRaidChance(pirateThreatSeed.resourcePoints, pirateThreatSeed.battlePoints, advancePirateThreat(pirateThreatSeed.threat, nowMs).ageHours))
    : 2);
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
      const { node, occupancy } = entry;
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

  const counts = useMemo(() => {
    const result: Record<OperationsTab, number> = { available: 0, active: 0, completed: 0 };
    for (const { operation } of operationRows) if (operation.state in result) result[operation.state as OperationsTab] += 1;
    return result;
  }, [operationRows]);
  const tabRows = useMemo(() => operationRows.filter(({ operation }) => operation.state === tab), [operationRows, tab]);
  const kindCounts = useMemo(() => {
    const result: Record<ContactFilter, number> = { all: tabRows.length, pirate: 0, unique: 0, anomaly: 0 };
    for (const row of tabRows) {
      const kind = contactKind(row.operation, row.contact, row.exploration);
      if (kind !== 'other') result[kind] += 1;
    }
    return result;
  }, [tabRows]);
  const kindsPresent = (['pirate', 'unique', 'anomaly'] as const).filter((kind) => kindCounts[kind] > 0).length;
  const filter = contactFilter !== 'all' && kindCounts[contactFilter] === 0 ? 'all' : contactFilter;
  const visibleRows = useMemo(() => tabRows.filter((row) => filter === 'all'
    || contactKind(row.operation, row.contact, row.exploration) === filter), [tabRows, filter]);
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

  const rollOf = (row: OperationRow) => row.contact ? pirateRaidRolls[JSON.stringify([pirateOwnerId, row.contact.contactCycleKey])] : undefined;
  const threat = Math.max(0, pirateThreatPercent);

  return (
    <main className="operations-shell-v2 operations-shell-v2--variant-a op-view" aria-label="Операции">
      <aside className="op-panel op-rail">
        <h1>Операции</h1>
        <div className="op-rail-status">
          <span className="op-gauge" role="progressbar" aria-label="Пиратская угроза" aria-valuemin={0} aria-valuemax={30} aria-valuenow={threat}
            style={{ '--op-fill': `${Math.min(100, (threat / 30) * 100)}%` } as CSSProperties}>
            <b>{formatPercent(threat)}</b>
          </span>
          <div>
            <strong>Пиратская угроза</strong>
            <span>{threat > 0 ? 'Шанс, что база нападёт на вас. Растёт, если боевых очков мало, падает после побед.' : 'Пока пираты на вас не нападают.'}</span>
          </div>
        </div>
        <nav className="op-tabs" role="tablist" aria-label="Состояние операций">
          {(Object.keys(TAB_LABELS) as OperationsTab[]).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => chooseTab(key)} data-qa-operations-tab={key}>
              <Img src={TAB_ICONS[key]} />
              <span>{TAB_LABELS[key]}</span>
              {key !== 'completed' && counts[key] ? <b className={`op-badge ${key === 'available' ? 'is-hot' : ''}`}>{counts[key]}</b> : null}
            </button>
          ))}
        </nav>
        <p className="op-rail-note">Пиратских баз в ваших системах: <b>{pirateContacts.length}</b></p>
        {pirateAdaptiveDiagnostics ? <PirateDiagnostics diagnostics={pirateAdaptiveDiagnostics} onExport={onPirateBattleExport} /> : null}
      </aside>

      <div className="operations-layout-v2 op-grid">
        <section className="operations-feed-v2 op-panel op-list" aria-label={LIST_TITLES[tab]}>
          <header className="op-list-head"><h3>{LIST_TITLES[tab]}</h3>{tabRows.length ? <span className="op-count">{tabRows.length}</span> : null}</header>
          {kindsPresent > 1 ? (
            <div className="operations-contact-filters-v-a op-list-tools" role="group" aria-label="Вид операции">
              {FILTERS.filter(([value]) => value === 'all' || kindCounts[value] > 0).map(([value, label]) => (
                <button key={value} type="button" data-filter-kind={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => setContactFilter(value)}>
                  {label} <span>{kindCounts[value]}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="operations-feed-scroll-v2 op-list-scroll">
            {visibleRows.length ? (
              <div className="op-items">
                {visibleRows.map((row) => (
                  <OperationCard
                    key={row.operation.id}
                    row={row}
                    nowMs={nowMs}
                    threatPercent={threat}
                    pirateCheckDelayMs={pirateCheckDelayMs}
                    pirateRaidRoll={rollOf(row)}
                    selected={row.operation.id === selectedRow?.operation.id}
                    onSelect={() => setSelectedId(row.operation.id)}
                  />
                ))}
              </div>
            ) : <EmptyList tab={tab} filtered={filter !== 'all'} />}
          </div>
        </section>
        {selectedRow ? (
          <OperationDossier
            key={selectedRow.operation.id}
            row={selectedRow}
            nowMs={nowMs}
            threatPercent={threat}
            pirateRaidRoll={rollOf(selectedRow)}
            pirateCheckDelayMs={pirateCheckDelayMs}
            onExpedition={onExpedition}
            onExplorationAttack={onExplorationAttack}
            onBot01Occupy={onBot01Occupy}
            onExplorationRecon={onExplorationRecon}
            onExplorationUniverse={onExplorationUniverse}
            onExplorationReport={onExplorationReport}
            onPirateBattleReport={onPirateBattleReport}
            onPirateCollectDebris={onPirateCollectDebris}
            onPirateRecon={onPirateRecon}
            onPirateAttack={onPirateAttack}
            onPirateReport={onPirateReport}
            onPirateUniverse={onPirateUniverse}
            onAccept={accept}
            onCancel={cancel}
            onOpenFleets={onOpenFleets}
          />
        ) : <EmptyDossier tab={tab} onTab={chooseTab} />}
      </div>
    </main>
  );
}
