import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { localizeBuildingNames } from './domain/buildings/balance-v1.ts';

import {
  SPACEPORT_UPGRADE_QUEUE_CAPACITY,
  getSpaceportUpgradeCatalog,
  getSpaceportUpgradeEntity,
  getSpaceportUpgradeMaxLevel,
  previewSpaceportUpgrade,
  type SpaceportRequirementState,
  type SpaceportUpgradeState,
  type SpaceportUpgradeTrack,
  type SpaceportUpgradeTask,
  type SpaceportUpgradeWallet,
} from './domain/buildings/spaceport-upgrades.ts';
import { getBuildingDefinition, type BuildingLevels, type ScienceLevels } from './domain/buildings/resource-zone.ts';
import type { CombatFactionId } from './domain/combat/factions.ts';
import { SCIENCE_CATALOG } from './domain/science/catalog.ts';
import { ACTIVE_RUNTIME_MODE, type TestTimeScale } from './domain/runtime/mode.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import './building-card.css';
import './spaceport-upgrades.css';

type SpaceportUpgradeViewProps = {
  planetName: string;
  factionId: CombatFactionId;
  buildingLevel: number;
  buildings: BuildingLevels;
  scienceLevels: ScienceLevels;
  upgrades: SpaceportUpgradeState;
  wallet: SpaceportUpgradeWallet;
  now: number;
  testTimeScale: TestTimeScale;
  onUpgrade: (track: SpaceportUpgradeTrack, shipId: string) => boolean;
  onCancel: (taskId: string) => boolean;
  onBack: () => void;
};

const TRACK_LABELS: Readonly<Record<SpaceportUpgradeTrack, string>> = {
  ships: 'Улучшения кораблей',
  commanders: 'Улучшения командирских кораблей',
};

const RESOURCE_LABELS: Readonly<Record<keyof SpaceportUpgradeWallet, string>> = {
  metal: 'металла',
  minerals: 'минералов',
  gas: 'газа',
};

const RESOURCE_NAMES: Readonly<Record<keyof SpaceportUpgradeWallet, string>> = {
  metal: 'Металл',
  minerals: 'Минералы',
  gas: 'Газ',
};

const SCIENCE_ARTS = import.meta.glob('../assets/source/New assets/technologies/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function queueOf(upgrades: SpaceportUpgradeState, track: SpaceportUpgradeTrack) {
  return track === 'ships' ? upgrades.shipQueue : upgrades.commanderQueue;
}

function requirementCurrentLabel(requirement: SpaceportRequirementState) {
  if (requirement.valueKind === 'quantity') return 'Текущее количество';
  if (requirement.valueKind === 'unknown') return 'Текущее значение';
  return 'Текущий уровень';
}

function requirementRequiredLabel(requirement: SpaceportRequirementState) {
  if (requirement.valueKind === 'quantity') return 'Требуется количество';
  if (requirement.valueKind === 'unknown') return 'Требуется значение';
  return 'Требуется';
}

/** A requirement the ship still misses, in the fewest plain words: «Ионная наука ур. 3». */
function requirementShortLabel(requirement: SpaceportRequirementState, factionId: CombatFactionId) {
  const label = localizeBuildingNames(requirement.label, factionId);
  if (requirement.valueKind === 'level') return `${label} ур. ${requirement.requiredLevel}`;
  if (requirement.valueKind === 'quantity') return `${label}: ${requirement.requiredLevel} шт.`;
  return `${label}: ${requirement.requiredLevel}`;
}

function requirementArt(requirement: SpaceportRequirementState, factionId: CombatFactionId): string | null {
  if (requirement.buildingRole) return getBuildingDefinition(requirement.buildingRole, factionId).art;
  if (requirement.scienceId == null) return null;
  const science = SCIENCE_CATALOG.find((item) => item.id === requirement.scienceId);
  if (!science) return null;
  return SCIENCE_ARTS[`../assets/source/New assets/technologies/${science.artSlug}`] ?? null;
}

function RequirementBadge({ requirement, factionId }: { requirement: SpaceportRequirementState; factionId: CombatFactionId }) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const art = requirementArt(requirement, factionId);
  const status = requirement.met ? 'выполнено' : 'не выполнено';
  const current = requirement.currentLevel == null ? 'неизвестно' : String(requirement.currentLevel);
  const currentLabel = requirementCurrentLabel(requirement);
  const requiredLabel = requirementRequiredLabel(requirement);
  const label = localizeBuildingNames(requirement.label, factionId);
  const tooltip = `${label}\n${currentLabel}: ${current}\n${requiredLabel}: ${requirement.requiredLevel}\nСтатус: ${status}`;

  useEffect(() => {
    const badge = badgeRef.current;
    if (!badge) return;

    const openTooltip = () => setTooltipOpen(true);
    const closeTooltip = () => setTooltipOpen(false);
    const syncKeyboardFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      window.requestAnimationFrame(() => setTooltipOpen(document.activeElement === badge));
    };

    badge.addEventListener('focus', openTooltip);
    badge.addEventListener('blur', closeTooltip);
    badge.addEventListener('mouseenter', openTooltip);
    badge.addEventListener('mouseleave', closeTooltip);
    window.addEventListener('keydown', syncKeyboardFocus, true);
    window.addEventListener('keyup', syncKeyboardFocus, true);

    return () => {
      badge.removeEventListener('focus', openTooltip);
      badge.removeEventListener('blur', closeTooltip);
      badge.removeEventListener('mouseenter', openTooltip);
      badge.removeEventListener('mouseleave', closeTooltip);
      window.removeEventListener('keydown', syncKeyboardFocus, true);
      window.removeEventListener('keyup', syncKeyboardFocus, true);
    };
  }, []);

  if (!art) {
    return (
      <span
        className="spaceport-requirement-fallback-v2"
        data-qa-spaceport-requirement-fallback={requirement.label}
      >
        {requirementShortLabel(requirement, factionId)}
      </span>
    );
  }

  return (
    <span
      ref={badgeRef}
      className={`spaceport-requirement-badge-v2 ${requirement.met ? 'is-met' : 'is-missing'} ${tooltipOpen ? 'is-tooltip-open' : ''}`}
      data-qa-spaceport-requirement-badge={requirement.label}
      data-qa-spaceport-requirement-status={requirement.met ? 'met' : 'missing'}
      data-tooltip={tooltip}
      tabIndex={0}
      aria-label={`${label}. ${currentLabel} ${current}. ${requiredLabel} ${requirement.requiredLevel}. Статус: ${status}.`}
    >
      <img src={art} alt="" draggable={false} />
      <b>{requirement.requiredLevel}</b>
      <span
        className="spaceport-requirement-tooltip-v2"
        data-qa-spaceport-requirement-tooltip={requirement.label}
        role="tooltip"
        aria-hidden={false}
      >
        <strong>{label}</strong>
        <span>{currentLabel}: {current}</span>
        <span>{requiredLabel}: {requirement.requiredLevel}</span>
        <span>Статус: {status}</span>
      </span>
    </span>
  );
}

function LevelProgress({
  track,
  currentLevel,
  projectedLevel,
  queuedPositions,
  nextLevel,
}: {
  track: SpaceportUpgradeTrack;
  currentLevel: number;
  projectedLevel: number;
  queuedPositions: readonly { taskId: string; position: number }[];
  nextLevel: number | null;
}) {
  const maxLevel = getSpaceportUpgradeMaxLevel(track);
  const isMax = currentLevel >= maxLevel;

  return (
    <section
      className={`sp-level ${isMax ? 'is-max' : ''}`}
      data-qa-spaceport-level-progress
      data-qa-current-level={currentLevel}
      data-qa-projected-level={projectedLevel}
      data-qa-max-level={maxLevel}
      aria-label={`Уровень ${currentLevel} из ${maxLevel}. В очереди уровней: ${queuedPositions.length}.`}
    >
      <div className="sp-level__caption">
        {isMax ? (
          <strong>Максимальный уровень {maxLevel}</strong>
        ) : (
          <>
            <span>Уровень <b>{currentLevel}</b> из {maxLevel}</span>
            {queuedPositions.length > 0 ? (
              <span className="sp-level__queued">
                в очереди
                {queuedPositions.map(({ taskId, position }) => (
                  <span key={taskId} data-qa-spaceport-queued-task data-qa-spaceport-queued-position={position}>№{position}</span>
                ))}
              </span>
            ) : null}
            {nextLevel !== null ? <span className="sp-level__next">→ <b>{nextLevel}</b></span> : null}
          </>
        )}
      </div>
      <div className="spaceport-level-segments-v2" aria-hidden="true">
        {Array.from({ length: maxLevel }, (_, index) => {
          const level = index + 1;
          const className = level <= currentLevel
            ? 'is-complete'
            : level <= projectedLevel
              ? 'is-queued'
              : 'is-future';
          return <i key={level} className={className} data-level={level} />;
        })}
      </div>
    </section>
  );
}

function SelectedQueue({
  track,
  factionId,
  upgrades,
  now,
  onCancel,
}: {
  track: SpaceportUpgradeTrack;
  factionId: CombatFactionId;
  upgrades: SpaceportUpgradeState;
  now: number;
  onCancel: (task: SpaceportUpgradeTask) => void;
}) {
  const queue = queueOf(upgrades, track);

  return (
    <section className="sp-queue" data-qa-spaceport-queue={track}>
      <header>
        <span>ОЧЕРЕДЬ</span>
        <strong data-qa-spaceport-queue-count={`${queue.length}/${SPACEPORT_UPGRADE_QUEUE_CAPACITY}`}>
          {queue.length} / {SPACEPORT_UPGRADE_QUEUE_CAPACITY}
        </strong>
      </header>

      {queue.length === 0 ? (
        <p className="sp-queue__empty" data-qa-spaceport-queue-empty>Очередь свободна — выберите улучшение.</p>
      ) : queue.map((task, index) => {
        const entity = getSpaceportUpgradeEntity(track, task.shipId, factionId);
        const active = index === 0;
        const progress = Math.min(100, Math.max(0, ((now - task.startedAt) / Math.max(1, task.finishAt - task.startedAt)) * 100));
        const cancelBlocked = task.refundEligible === false;
        return (
          <article
            key={task.id}
            className={`sp-task ${active ? 'is-active' : 'is-waiting'}`}
            data-qa-spaceport-queue-task={task.shipId}
            data-qa-spaceport-queue-task-id={task.id}
            data-qa-spaceport-queue-position={index + 1}
          >
            {entity ? <img src={entity.art} alt="" draggable={false} /> : <span className="sp-task__art-empty" aria-hidden="true" />}
            <div className="sp-task__copy">
              <strong>{entity?.name ?? task.shipId}</strong>
              <span>Уровень {task.fromLevel} → {task.toLevel}</span>
              {cancelBlocked ? <span>Старый заказ: отменить нельзя</span> : null}
            </div>
            <button
              type="button"
              className="sp-task__cancel"
              data-qa-spaceport-cancel={task.id}
              disabled={cancelBlocked}
              aria-label={cancelBlocked ? `Отмена недоступна: «${entity?.name ?? task.shipId}», стоимость старого заказа не подтверждена` : `Отменить улучшение «${entity?.name ?? task.shipId}»`}
              onClick={() => onCancel(task)}
            >×</button>
            {active ? (
              <>
                <i className="sp-task__bar"><b style={{ width: `${progress}%` }} /></i>
                <time>{now >= task.finishAt ? 'Завершается…' : formatCountdown(task.finishAt - now)}</time>
              </>
            ) : (
              <small className="sp-task__wait">Ждёт очереди · №{index + 1}</small>
            )}
          </article>
        );
      })}
    </section>
  );
}

function pluralShips(count: number) {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return 'кораблей';
  if (ones === 1) return 'корабль';
  if (ones >= 2 && ones <= 4) return 'корабля';
  return 'кораблей';
}

export function SpaceportUpgradeView({
  planetName,
  factionId,
  buildingLevel,
  buildings,
  scienceLevels,
  upgrades,
  wallet,
  now,
  testTimeScale,
  onUpgrade,
  onCancel,
  onBack,
}: SpaceportUpgradeViewProps) {
  const [activeTrack, setActiveTrack] = useState<SpaceportUpgradeTrack>('ships');
  const [pendingCancellation, setPendingCancellation] = useState<SpaceportUpgradeTask | null>(null);
  const confirmYesRef = useRef<HTMLButtonElement>(null);
  const confirmNoRef = useRef<HTMLButtonElement>(null);
  const spaceport = getBuildingDefinition('spaceport', factionId);
  const catalog = useMemo(() => getSpaceportUpgradeCatalog(activeTrack, factionId), [activeTrack, factionId]);
  const selectedQueue = queueOf(upgrades, activeTrack);

  useEffect(() => {
    if (!pendingCancellation) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => confirmYesRef.current?.focus());
    const restoreFocus = () => {
      const fallback = document.querySelector('[data-qa-spaceport-cancel]:not([disabled])');
      const canRestorePrevious = previousActiveElement?.isConnected
        && previousActiveElement !== document.body
        && previousActiveElement !== document.documentElement
        && !(previousActiveElement instanceof HTMLButtonElement && previousActiveElement.disabled);
      const target = canRestorePrevious
        ? previousActiveElement
        : fallback instanceof HTMLElement ? fallback : null;
      target?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPendingCancellation(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [confirmYesRef.current, confirmNoRef.current].filter((control): control is HTMLButtonElement => Boolean(control));
      if (controls.length !== 2) return;
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls[1].focus();
      } else if (!event.shiftKey && document.activeElement === controls[1]) {
        event.preventDefault();
        controls[0].focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKeyDown);
      window.requestAnimationFrame(() => window.requestAnimationFrame(restoreFocus));
    };
  }, [pendingCancellation]);

  return (
    <main className="spaceport-upgrades spaceport-upgrades-v2" data-qa-spaceport-upgrades data-qa-spaceport-track={activeTrack}>
      <aside className="spaceport-sidebar-v2" data-qa-spaceport-sidebar>
        <header className="sp-side-head">
          <img src={spaceport.art} alt={spaceport.name} draggable={false} />
          <div>
            <h1>{spaceport.name.toUpperCase()}</h1>
            <small>{planetName} <span className="sp-side-head__level">УРОВЕНЬ {buildingLevel} / 10</span></small>
            <small className="sp-side-head__speed">−5% времени новых улучшений за уровень</small>
          </div>
        </header>

        <nav className="spaceport-sections-v2" aria-label={`Разделы: ${spaceport.name}`}>
          {(['ships', 'commanders'] as const).map((track) => {
            const queue = queueOf(upgrades, track);
            return (
              <button
                key={track}
                type="button"
                className={activeTrack === track ? 'active' : ''}
                onClick={() => setActiveTrack(track)}
                data-qa-spaceport-tab={track}
                aria-pressed={activeTrack === track}
              >
                <span>{TRACK_LABELS[track]}</span>
                <b>{queue.length}/{SPACEPORT_UPGRADE_QUEUE_CAPACITY}</b>
              </button>
            );
          })}
        </nav>

        <SelectedQueue track={activeTrack} factionId={factionId} upgrades={upgrades} now={now} onCancel={setPendingCancellation} />

        <button type="button" className="spaceport-back-v2" data-qa-building-interior-back onClick={onBack}>
          <span aria-hidden="true">←</span>
          Назад: {spaceport.name}
        </button>
      </aside>

      <section className="spaceport-main-v2">
        <header className="sp-main-head">
          <h2>{TRACK_LABELS[activeTrack].toUpperCase()}</h2>
          <span>{catalog.length} {pluralShips(catalog.length)}</span>
        </header>

        <div className="spaceport-catalog-v2" data-qa-spaceport-catalog={activeTrack}>
          {catalog.map((entity) => {
            const preview = previewSpaceportUpgrade({
              state: upgrades,
              wallet,
              buildings,
              scienceLevels,
              spaceportLevel: buildingLevel,
              factionId,
              mode: ACTIVE_RUNTIME_MODE,
              testTimeScale,
            }, activeTrack, entity.id);
            const queuedPositions = selectedQueue
              .map((task, index) => ({ task, position: index + 1 }))
              .filter(({ task }) => task.shipId === entity.id)
              .map(({ task, position }) => ({ taskId: task.id, position }));
            const isQueued = queuedPositions.length > 0;
            const missingRequirements = preview.requirements.filter((requirement) => !requirement.met);
            const resourceKeys = (Object.keys(preview.cost) as (keyof SpaceportUpgradeWallet)[])
              .filter((key) => key !== 'gas' || preview.gasSpecified);
            const isMax = preview.status === 'max-level';
            const missingResources = isMax ? [] : resourceKeys.filter((key) => wallet[key] < preview.cost[key]);
            const uiCanStart = preview.canStart;
            const queueFull = preview.status === 'queue-full' && missingRequirements.length === 0;

            return (
              <article
                key={entity.id}
                className={`spaceport-row-v2 sp-card ${uiCanStart ? 'is-available' : 'is-blocked'} ${isQueued ? 'is-queued' : ''}`}
                data-qa-spaceport-card={entity.id}
                data-qa-spaceport-row={entity.id}
                data-qa-spaceport-queued-count={queuedPositions.length}
                data-qa-spaceport-duration-ms={preview.effectiveDurationMs}
              >
                <div className="sp-card__art">
                  <img src={entity.art} alt={entity.name} draggable={false} />
                </div>

                <div className="sp-card__ship">
                  <header>
                    <h3>{entity.name}</h3>
                    {entity.role !== entity.name ? <p>{entity.role}</p> : null}
                  </header>
                  <LevelProgress
                    track={activeTrack}
                    currentLevel={preview.currentLevel}
                    projectedLevel={preview.projectedLevel}
                    queuedPositions={queuedPositions}
                    nextLevel={preview.nextLevel}
                  />
                </div>

                <div className="sp-card__price">
                  {isMax ? <span className="sp-card__done">{preview.currentLevel >= preview.projectedLevel ? 'Корабль улучшен полностью' : 'Последний уровень уже в очереди'}</span> : (
                  <>
                  <div className="sp-costs" aria-label="Стоимость улучшения">
                    {resourceKeys.map((key) => (
                      <span
                        className={`sp-cost ${wallet[key] < preview.cost[key] ? 'is-short' : ''} ${preview.cost[key] === 0 ? 'is-free' : ''}`}
                        key={key}
                        data-qa-spaceport-cost
                        data-resource={key}
                        aria-label={`${RESOURCE_NAMES[key]}: нужно ${formatNumber(preview.cost[key])}, есть ${formatNumber(wallet[key])}`}
                      >
                        <span className="sp-cost__icon"><ResourceIcon kind={key} /></span>
                        <strong>{formatNumber(preview.cost[key])}</strong>
                      </span>
                    ))}
                    {!preview.gasSpecified ? <span className="sp-cost__note" data-qa-spaceport-gas-unspecified>Газ не нужен</span> : null}
                    <span className="sp-time" aria-label="Время улучшения">
                      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" /><path d="M8 4.6V8l2.4 1.6" /></svg>
                      <strong>{formatCountdown(preview.effectiveDurationMs)}</strong>
                    </span>
                  </div>
                  {preview.requirements.length > 0 ? (
                    <div className="sp-reqs">
                      <span>Требуется</span>
                      {preview.requirements.map((requirement) => (
                        <RequirementBadge
                          key={`${entity.id}-${requirement.kind}-${requirement.label}`}
                          requirement={requirement}
                          factionId={factionId}
                        />
                      ))}
                    </div>
                  ) : <span className="sp-reqs__none">Без требований</span>}
                  </>
                  )}
                </div>

                <div className="sp-card__action">
                  <button
                    type="button"
                    className="spaceport-upgrade-cta-v2"
                    data-qa-spaceport-upgrade={entity.id}
                    disabled={!uiCanStart}
                    onClick={() => onUpgrade(activeTrack, entity.id)}
                  >
                    {isMax ? 'МАКСИМУМ' : `УЛУЧШИТЬ ДО ${preview.nextLevel ?? preview.currentLevel}`}
                  </button>
                  {/* Why the button is off, in words; nothing here when it is on. */}
                  <div className="sp-why" data-qa-spaceport-status>
                    {missingRequirements.length > 0 ? (
                      <span className="sp-why__line">
                        Нужно:{' '}
                        {missingRequirements.map((requirement, index) => (
                          <span data-qa-spaceport-blocker="requirement" key={`${entity.id}-block-${requirement.kind}-${requirement.label}`}>
                            {index > 0 ? ', ' : ''}{requirementShortLabel(requirement, factionId)}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {missingRequirements.length === 0 && missingResources.length > 0 ? (
                      <span className="sp-why__line">
                        {missingResources.map((key, index) => (
                          <span data-qa-spaceport-blocker="resource" key={`${entity.id}-resource-${key}`}>
                            {index > 0 ? ', ' : 'Не хватает '}{RESOURCE_LABELS[key]}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {queueFull ? <span className="sp-why__line is-muted" data-qa-spaceport-blocker="queue">Очередь улучшений заполнена: {selectedQueue.length} из {SPACEPORT_UPGRADE_QUEUE_CAPACITY}</span> : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      {pendingCancellation ? createPortal(
        <div className="resource-building-action-confirm-backdrop" data-qa-spaceport-cancel-backdrop onMouseDown={() => setPendingCancellation(null)}>
          <section
            className="resource-building-action-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="spaceport-cancel-confirm-title"
            data-qa-spaceport-cancel-confirm
            onMouseDown={(event) => event.stopPropagation()}
          >
            <small>ПОДТВЕРЖДЕНИЕ ДЕЙСТВИЯ</small>
            <h3 id="spaceport-cancel-confirm-title">Отменить улучшение?</h3>
            <p>Задание «{getSpaceportUpgradeEntity(pendingCancellation.track, pendingCancellation.shipId, factionId)?.name ?? pendingCancellation.shipId}» будет удалено. Зависимые следующие уровни этого же корабля отменятся каскадно. Для каждого отменённого задания возвращаются случайные 60–80% сохранённой стоимости.</p>
            <div className="resource-building-action-confirm-actions">
              <button ref={confirmYesRef} type="button" data-qa-spaceport-cancel-yes onClick={() => { onCancel(pendingCancellation.id); setPendingCancellation(null); }}>ДА</button>
              <button ref={confirmNoRef} type="button" data-qa-spaceport-cancel-no onClick={() => setPendingCancellation(null)}>НЕТ</button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </main>
  );
}
