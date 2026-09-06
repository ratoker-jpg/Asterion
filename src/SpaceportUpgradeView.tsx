import { useMemo, useState } from 'react';

import {
  PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS,
  PROTOTYPE_SPACEPORT_UPGRADE_COST,
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

const QUEUE_LABELS: Readonly<Record<SpaceportUpgradeTrack, string>> = {
  ships: 'УЛУЧШЕНИЯ КОРАБЛЕЙ',
  commanders: 'УЛУЧШЕНИЯ КОМАНДИРСКИХ КОРАБЛЕЙ',
};

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatPrototypeTime(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function queueOf(upgrades: SpaceportUpgradeState, track: SpaceportUpgradeTrack) {
  return track === 'ships' ? upgrades.shipQueue : upgrades.commanderQueue;
}

function QueueSection({
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
    <section className="spaceport-queue-section" data-qa-spaceport-queue={track}>
      <header>
        <strong>{QUEUE_LABELS[track]}</strong>
        <span>{queue.length}/{SPACEPORT_UPGRADE_QUEUE_CAPACITY}</span>
      </header>
      <div className="spaceport-queue-slots">
        {Array.from({ length: SPACEPORT_UPGRADE_QUEUE_CAPACITY }, (_, index) => {
          const task = queue[index];
          if (!task) {
            return (
              <div className="spaceport-queue-slot empty" key={`${track}-empty-${index}`}>
                <span className="spaceport-slot-index">{index + 1}</span>
                <div><strong>Свободный слот</strong><small>Готов к улучшению</small></div>
              </div>
            );
          }

          const entity = getSpaceportUpgradeEntity(track, task.shipId);
          const active = index === 0;
          return (
            <div className={`spaceport-queue-slot ${active ? 'active' : 'waiting'}`} key={task.id}>
              <span className="spaceport-slot-index">{index + 1}</span>
              {entity ? <img src={entity.art} alt="" draggable={false} /> : null}
              <div className="spaceport-queue-copy">
                <strong>{entity?.name ?? task.shipId}</strong>
                <small>Уровень {task.fromLevel} → {task.toLevel}</small>
                {active ? (
                  <b>{now >= task.finishAt ? 'ЗАВЕРШЕНИЕ…' : formatCountdown(task.finishAt - now)}</b>
                ) : (
                  <span>
                    Ожидает · позиция {index + 1} · старт через {formatCountdown(task.startedAt - now)} · завершение через {formatCountdown(task.finishAt - now)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
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

  return (
    <main className="spaceport-upgrades" data-qa-spaceport-upgrades>
      <header className="spaceport-hero">
        <div className="spaceport-hero-art">
          <img src={spaceport.art} alt="Космодром" draggable={false} />
        </div>
        <div className="spaceport-hero-copy">
          <small>ASTERION // ВОЕННАЯ ЗОНА</small>
          <h1>КОСМОДРОМ</h1>
          <p>{planetName} · уровень {buildingLevel} / 10</p>
          <span>{spaceport.purpose} Каждый уровень ускоряет только новые улучшения на 5%.</span>
        </div>
        <button type="button" className="spaceport-back" data-qa-building-interior-back onClick={onBack}>← Назад в Космодром</button>
      </header>

      <section className="spaceport-queues" aria-label="Очереди улучшений">
        <QueueSection track="ships" upgrades={upgrades} now={now} />
        <QueueSection track="commanders" upgrades={upgrades} now={now} />
      </section>

      <nav className="spaceport-tabs" aria-label="Разделы Космодрома">
        {(['ships', 'commanders'] as const).map((track) => (
          <button
            key={track}
            type="button"
            className={activeTrack === track ? 'active' : ''}
            onClick={() => setActiveTrack(track)}
            data-qa-spaceport-tab={track}
          >
            {TRACK_LABELS[track]}
          </button>
        ))}
      </nav>

      <section className="spaceport-catalog-head">
        <div>
          <small>{activeTrack === 'ships' ? 'ОБЫЧНЫЙ ФЛОТ' : 'КОМАНДНЫЙ ФЛОТ'}</small>
          <h2>{TRACK_LABELS[activeTrack].toUpperCase()}</h2>
        </div>
        <p>{SPACEPORT_UPGRADE_PROTOTYPE_NOTE}</p>
      </section>

      <section className="spaceport-catalog" data-qa-spaceport-catalog={activeTrack}>
        {catalog.map((entity) => {
          const preview = previewSpaceportUpgrade({
            state: upgrades,
            wallet,
            buildings,
            scienceLevels,
            spaceportLevel: buildingLevel,
          }, activeTrack, entity.id);
          const missingRequirements = preview.requirements.filter((requirement) => !requirement.met);
          const statusText = preview.status === 'requirements-unmet'
            ? 'Требования не выполнены'
            : preview.status === 'queue-full'
              ? 'Очередь заполнена'
              : preview.status === 'insufficient-resource'
                ? 'Недостаточно ресурсов'
                : preview.status === 'max-level'
                  ? 'Максимальный уровень'
                  : preview.queuedCount > 0
                    ? `Уже в очереди: ${preview.queuedCount}`
                    : 'Доступно';
          const ctaText = preview.status === 'queue-full'
            ? 'ОЧЕРЕДЬ ЗАПОЛНЕНА'
            : preview.status === 'max-level'
              ? 'МАКСИМАЛЬНЫЙ УРОВЕНЬ'
              : `УЛУЧШИТЬ УРОВЕНЬ ${preview.nextLevel ?? preview.currentLevel}`;

          return (
            <article
              key={entity.id}
              className={`spaceport-card status-${preview.status}`}
              data-qa-spaceport-card={entity.id}
            >
              <header className="spaceport-card-title">
                <div>
                  <strong>{entity.name}</strong>
                  <small>{entity.role} · {entity.category}</small>
                </div>
                <span className={`spaceport-status status-${preview.status}`}>{statusText}</span>
              </header>

              <div className="spaceport-card-main">
                <div className="spaceport-ship-art">
                  <img src={entity.art} alt={entity.name} draggable={false} />
                  <div className="spaceport-level-badge">
                    <small>ТЕКУЩИЙ УРОВЕНЬ</small>
                    <strong>{preview.currentLevel}</strong>
                  </div>
                </div>

                <div className="spaceport-next-level">
                  <small>СЛЕДУЮЩИЙ УРОВЕНЬ</small>
                  <strong>{preview.nextLevel ?? 'MAX'}</strong>
                  {preview.queuedCount > 0 ? <span>После очереди: уровень {preview.projectedLevel}</span> : null}
                </div>
              </div>

              <div className="spaceport-economy">
                <div><small>МЕТАЛЛ · PROTOTYPE</small><strong>{formatNumber(PROTOTYPE_SPACEPORT_UPGRADE_COST.metal)}</strong></div>
                <div><small>МИНЕРАЛЫ · PROTOTYPE</small><strong>{formatNumber(PROTOTYPE_SPACEPORT_UPGRADE_COST.minerals)}</strong></div>
                <div><small>ГАЗ · PROTOTYPE</small><strong>{formatNumber(PROTOTYPE_SPACEPORT_UPGRADE_COST.gas)}</strong></div>
                <div><small>БАЗОВОЕ ВРЕМЯ</small><strong>{formatPrototypeTime(PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS)}</strong></div>
              </div>

              <div className="spaceport-speed-note">
                <span>Космодром ур. {buildingLevel}</span>
                <strong>Новая задача: {formatPrototypeTime(preview.effectiveDurationMs)}</strong>
              </div>

              <section className="spaceport-requirements">
                <header><strong>ТРЕБОВАНИЯ КАТАЛОГА</strong><span>{missingRequirements.length ? `${missingRequirements.length} не выполнено` : 'выполнены'}</span></header>
                <div>
                  {preview.requirements.map((requirement) => (
                    <span className={requirement.met ? 'met' : 'missing'} key={`${entity.id}-${requirement.kind}-${requirement.label}`}>
                      <b>{requirement.met ? '✓' : '!'}</b>
                      <em>{requirement.label} — уровень {requirement.requiredLevel}</em>
                      <small>{requirement.currentLevel == null ? 'уровень не подключён' : `сейчас ${requirement.currentLevel}`}</small>
                    </span>
                  ))}
                </div>
              </section>

              <button
                type="button"
                className="spaceport-upgrade-cta"
                disabled={!preview.canStart}
                title={preview.reason ?? undefined}
                onClick={() => onUpgrade(activeTrack, entity.id)}
              >
                {ctaText}
              </button>

              {!preview.canStart && preview.reason ? <p className="spaceport-block-reason">{preview.reason}</p> : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
