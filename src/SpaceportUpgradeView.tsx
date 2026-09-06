import { useMemo, useState } from 'react';

import {
  SPACEPORT_UPGRADE_PROTOTYPE_NOTE,
  SPACEPORT_UPGRADE_QUEUE_CAPACITY,
  getSpaceportUpgradeCatalog,
  getSpaceportUpgradeEntity,
  previewSpaceportUpgrade,
  type SpaceportUpgradeState,
  type SpaceportUpgradeTrack,
  type SpaceportUpgradeWallet,
} from './domain/buildings/spaceport-upgrades.ts';
import { getBuildingDefinition, type BuildingLevels, type ScienceLevels } from './domain/buildings/resource-zone.ts';
import './spaceport-upgrades.css';

type SpaceportUpgradeViewProps = {
  planetName: string;
  buildingLevel: number;
  buildings: BuildingLevels;
  scienceLevels: ScienceLevels;
  upgrades: SpaceportUpgradeState;
  wallet: SpaceportUpgradeWallet;
  now: number;
  onUpgrade: (track: SpaceportUpgradeTrack, shipId: string) => boolean;
  onBack: () => void;
};

const TRACK_LABELS: Readonly<Record<SpaceportUpgradeTrack, string>> = {
  ships: 'Улучшения кораблей',
  commanders: 'Улучшения командирских кораблей',
};

const TYPE_LABELS: Readonly<Record<SpaceportUpgradeTrack, string>> = {
  ships: 'КОРАБЛЬ',
  commanders: 'КОМАНДИРСКИЙ КОРАБЛЬ',
};

const RESOURCE_LABELS: Readonly<Record<keyof SpaceportUpgradeWallet, string>> = {
  metal: 'металла',
  minerals: 'минералов',
  gas: 'газа',
};

const RESOURCE_SHORT_LABELS: Readonly<Record<keyof SpaceportUpgradeWallet, string>> = {
  metal: 'МЕТАЛЛ',
  minerals: 'МИНЕРАЛЫ',
  gas: 'ГАЗ',
};

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatTaskTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function queueOf(upgrades: SpaceportUpgradeState, track: SpaceportUpgradeTrack) {
  return track === 'ships' ? upgrades.shipQueue : upgrades.commanderQueue;
}

function requirementBlocker(label: string, requiredLevel: number, currentLevel: number | null) {
  if (currentLevel == null) return `Нужна ${label} ур. ${requiredLevel} · текущий уровень не подключён`;
  return `Нужна ${label} ур. ${requiredLevel} · сейчас ${currentLevel}`;
}

function SelectedQueue({
  track,
  upgrades,
  now,
}: {
  track: SpaceportUpgradeTrack;
  upgrades: SpaceportUpgradeState;
  now: number;
}) {
  const queue = queueOf(upgrades, track);

  return (
    <section className="spaceport-side-queue" data-qa-spaceport-queue={track}>
      <header>
        <span>ОЧЕРЕДЬ</span>
        <strong data-qa-spaceport-queue-count={`${queue.length}/${SPACEPORT_UPGRADE_QUEUE_CAPACITY}`}>
          {queue.length} / {SPACEPORT_UPGRADE_QUEUE_CAPACITY}
        </strong>
      </header>

      {queue.length === 0 ? (
        <div className="spaceport-queue-empty" data-qa-spaceport-queue-empty>
          <span aria-hidden="true">◇</span>
          <div>
            <strong>Очередь свободна</strong>
            <small>Можно запустить новое улучшение.</small>
          </div>
        </div>
      ) : (
        <div className="spaceport-queue-list">
          {queue.map((task, index) => {
            const entity = getSpaceportUpgradeEntity(track, task.shipId);
            const active = index === 0;
            return (
              <article
                key={task.id}
                className={`spaceport-queue-task ${active ? 'is-active' : 'is-waiting'}`}
                data-qa-spaceport-queue-task={task.shipId}
                data-qa-spaceport-queue-position={index + 1}
              >
                {entity ? <img src={entity.art} alt="" draggable={false} /> : <span className="spaceport-queue-fallback">◇</span>}
                <div>
                  <strong>{entity?.name ?? task.shipId}</strong>
                  <small>ур. {task.fromLevel} → {task.toLevel}</small>
                  {active ? (
                    <time>{now >= task.finishAt ? 'ЗАВЕРШЕНИЕ…' : formatCountdown(task.finishAt - now)}</time>
                  ) : (
                    <span>ОЖИДАЕТ · ПОЗИЦИЯ {index + 1}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function SpaceportUpgradeView({
  planetName,
  buildingLevel,
  buildings,
  scienceLevels,
  upgrades,
  wallet,
  now,
  onUpgrade,
  onBack,
}: SpaceportUpgradeViewProps) {
  const [activeTrack, setActiveTrack] = useState<SpaceportUpgradeTrack>('ships');
  const spaceport = getBuildingDefinition('spaceport');
  const catalog = useMemo(() => getSpaceportUpgradeCatalog(activeTrack), [activeTrack]);
  const selectedQueue = queueOf(upgrades, activeTrack);

  return (
    <main className="spaceport-upgrades spaceport-upgrades-v2" data-qa-spaceport-upgrades data-qa-spaceport-track={activeTrack}>
      <aside className="spaceport-sidebar-v2" data-qa-spaceport-sidebar>
        <header className="spaceport-sidebar-title-v2">
          <small>ASTERION // ВОЕННАЯ ЗОНА</small>
          <h1>КОСМОДРОМ</h1>
        </header>

        <section className="spaceport-building-card-v2">
          <img src={spaceport.art} alt="Космодром" draggable={false} />
          <div>
            <small>{planetName}</small>
            <strong>УРОВЕНЬ {buildingLevel} / 10</strong>
            <p>Каждый уровень ускоряет только новые улучшения на 5%.</p>
          </div>
        </section>

        <nav className="spaceport-sections-v2" aria-label="Разделы Космодрома">
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

        <SelectedQueue track={activeTrack} upgrades={upgrades} now={now} />

        <button type="button" className="spaceport-back-v2" data-qa-building-interior-back onClick={onBack}>
          <span aria-hidden="true">←</span>
          Назад в Космодром
        </button>
      </aside>

      <section className="spaceport-main-v2">
        <header className="spaceport-main-heading-v2">
          <div>
            <small>{activeTrack === 'ships' ? 'КАТАЛОГ КОРАБЛЕЙ' : 'КАТАЛОГ КОМАНДИРСКИХ КОРАБЛЕЙ'}</small>
            <h2>{TRACK_LABELS[activeTrack].toUpperCase()}</h2>
          </div>
          <div className="spaceport-heading-meta-v2">
            <span>{catalog.length} ПОЗИЦИЙ</span>
            <span>{selectedQueue.length} / {SPACEPORT_UPGRADE_QUEUE_CAPACITY} В ОЧЕРЕДИ</span>
          </div>
        </header>

        <p className="spaceport-prototype-note-v2">{SPACEPORT_UPGRADE_PROTOTYPE_NOTE}</p>

        <div className="spaceport-catalog-v2" data-qa-spaceport-catalog={activeTrack}>
          {catalog.map((entity) => {
            const preview = previewSpaceportUpgrade({
              state: upgrades,
              wallet,
              buildings,
              scienceLevels,
              spaceportLevel: buildingLevel,
            }, activeTrack, entity.id);
            const queueIndex = selectedQueue.findIndex((task) => task.shipId === entity.id);
            const queuedTask = queueIndex >= 0 ? selectedQueue[queueIndex] : null;
            const isQueued = queuedTask != null;
            const missingRequirements = preview.requirements.filter((requirement) => !requirement.met);
            const missingResources = (Object.keys(preview.cost) as (keyof SpaceportUpgradeWallet)[])
              .filter((key) => wallet[key] < preview.cost[key]);
            const uiCanStart = !isQueued && preview.canStart;
            const targetLevel = queuedTask?.toLevel ?? preview.nextLevel;
            const ctaText = preview.status === 'max-level'
              ? 'МАКСИМАЛЬНЫЙ УРОВЕНЬ'
              : isQueued
                ? `В ОЧЕРЕДИ · ПОЗИЦИЯ ${queueIndex + 1}`
                : preview.status === 'queue-full'
                  ? 'ОЧЕРЕДЬ ЗАПОЛНЕНА'
                  : `УЛУЧШИТЬ УРОВЕНЬ ${preview.nextLevel ?? preview.currentLevel}`;
            const actionReason = isQueued
              ? `Корабль уже находится в очереди, позиция ${queueIndex + 1}.`
              : missingRequirements.length > 0
                ? missingRequirements.map((requirement) => requirementBlocker(requirement.label, requirement.requiredLevel, requirement.currentLevel)).join('. ')
                : missingResources.length > 0
                  ? missingResources.map((key) => `Недостаточно ${RESOURCE_LABELS[key]}`).join('. ')
                  : preview.reason ?? undefined;

            return (
              <article
                key={entity.id}
                className={`spaceport-row-v2 ${uiCanStart ? 'is-available' : 'is-blocked'} ${isQueued ? 'is-queued' : ''}`}
                data-qa-spaceport-card={entity.id}
                data-qa-spaceport-row={entity.id}
                data-qa-spaceport-queued={isQueued ? 'true' : 'false'}
              >
                <div className="spaceport-row-art-v2">
                  <img src={entity.art} alt={entity.name} draggable={false} />
                  <span>УР. {preview.currentLevel}</span>
                </div>

                <div className="spaceport-row-info-v2">
                  <header>
                    <small>{TYPE_LABELS[activeTrack]}</small>
                    <h3>{entity.name}</h3>
                    <p>{entity.role} · {entity.category}</p>
                  </header>

                  <div className="spaceport-level-line-v2">
                    <span>Текущий уровень <b>{preview.currentLevel}</b></span>
                    <i aria-hidden="true">→</i>
                    <span>Следующий уровень <b>{targetLevel ?? 'MAX'}</b></span>
                  </div>

                  <div className="spaceport-cost-line-v2" aria-label="Стоимость улучшения">
                    <span className="spaceport-line-label-v2">СТОИМОСТЬ</span>
                    {(Object.keys(preview.cost) as (keyof SpaceportUpgradeWallet)[]).map((key) => (
                      <span className="spaceport-cost-chip-v2" key={key} data-resource={key}>
                        <i>{RESOURCE_SHORT_LABELS[key].slice(0, 1)}</i>
                        <small>{RESOURCE_SHORT_LABELS[key]}</small>
                        <strong>{formatNumber(preview.cost[key])}</strong>
                      </span>
                    ))}
                  </div>

                  <div className="spaceport-requirement-line-v2">
                    <span className="spaceport-line-label-v2">ТРЕБОВАНИЯ</span>
                    <div>
                      {preview.requirements.length === 0 ? <span className="is-met">Нет дополнительных требований</span> : null}
                      {preview.requirements.map((requirement) => (
                        <span
                          key={`${entity.id}-${requirement.kind}-${requirement.label}`}
                          className={requirement.met ? 'is-met' : 'is-missing'}
                        >
                          {requirement.label} ур. {requirement.requiredLevel}
                          <small>{requirement.currentLevel == null ? ' · уровень не подключён' : ` · сейчас ${requirement.currentLevel}`}</small>
                        </span>
                      ))}
                    </div>
                  </div>

                  {isQueued ? (
                    <div className="spaceport-state-strip-v2 queued" data-qa-spaceport-blocker="queued">
                      В очереди · позиция {queueIndex + 1} · ур. {queuedTask.fromLevel} → {queuedTask.toLevel}
                      {queueIndex === 0 ? ` · осталось ${formatCountdown(queuedTask.finishAt - now)}` : ' · ожидает'}
                    </div>
                  ) : null}

                  {!isQueued && missingRequirements.map((requirement) => (
                    <div
                      className="spaceport-state-strip-v2 blocked"
                      data-qa-spaceport-blocker="requirement"
                      key={`${entity.id}-block-${requirement.kind}-${requirement.label}`}
                    >
                      {requirementBlocker(requirement.label, requirement.requiredLevel, requirement.currentLevel)}
                    </div>
                  ))}

                  {!isQueued && missingResources.map((key) => (
                    <div className="spaceport-state-strip-v2 blocked" data-qa-spaceport-blocker="resource" key={`${entity.id}-resource-${key}`}>
                      Недостаточно {RESOURCE_LABELS[key]} · нужно {formatNumber(preview.cost[key])}, есть {formatNumber(wallet[key])}
                    </div>
                  ))}

                  {!isQueued && preview.status === 'queue-full' && missingRequirements.length === 0 ? (
                    <div className="spaceport-state-strip-v2 muted" data-qa-spaceport-blocker="queue">Очередь заполнена · 3 / 3</div>
                  ) : null}

                  {!isQueued && preview.status === 'max-level' ? (
                    <div className="spaceport-state-strip-v2 muted" data-qa-spaceport-blocker="max">Достигнут максимальный уровень корабля</div>
                  ) : null}
                </div>

                <aside className="spaceport-row-action-v2">
                  <span>СЛЕДУЮЩИЙ УРОВЕНЬ</span>
                  <strong>{targetLevel ?? 'MAX'}</strong>
                  <div className="spaceport-row-time-v2">
                    <small>ВРЕМЯ НОВОЙ ЗАДАЧИ</small>
                    <time>{formatTaskTime(preview.effectiveDurationMs)}</time>
                    <em>Космодром ур. {buildingLevel}</em>
                  </div>
                  <button
                    type="button"
                    className="spaceport-upgrade-cta-v2"
                    data-qa-spaceport-upgrade={entity.id}
                    disabled={!uiCanStart}
                    title={actionReason}
                    onClick={() => {
                      if (isQueued) return;
                      onUpgrade(activeTrack, entity.id);
                    }}
                  >
                    {ctaText}
                  </button>
                  {!uiCanStart && actionReason ? <small className="spaceport-action-reason-v2">{actionReason}</small> : null}
                </aside>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
