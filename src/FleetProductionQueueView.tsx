import { useEffect, useState } from 'react';

import {
  getFleetProductionEntity,
  getFleetProductionQueue,
  type FleetProductionQueueKind,
  type FleetProductionState,
} from './domain/fleet/production.ts';
import type { CombatFactionId } from './domain/combat/factions.ts';
import { formatClockDurationMs } from './domain/buildings/balance-v1.ts';
import { FLEET_PRODUCTION_CANCEL_REQUEST_EVENT } from './application/fleet-production.ts';

type FleetProductionQueueViewProps = {
  queueKind: FleetProductionQueueKind;
  state: FleetProductionState;
  factionId: CombatFactionId;
};

const queueLabels: Record<FleetProductionQueueKind, string> = {
  ships: 'Корабли',
  defense: 'Оборона',
  commanders: 'Командиры',
};

function cancelOrder(orderId: string) {
  window.dispatchEvent(new CustomEvent(FLEET_PRODUCTION_CANCEL_REQUEST_EVENT, {
    detail: { orderId, now: Date.now() },
  }));
}

export function FleetProductionQueueView({ queueKind, state, factionId }: FleetProductionQueueViewProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const queue = getFleetProductionQueue(state, queueKind);
  return (
    <section
      className="fleet-production-queue-v1"
      data-qa-fleet-production-queue={queueKind}
      aria-label={`Очередь: ${queueLabels[queueKind]}`}
    >
      <header className="fleet-production-queue-head-v1">
        <span>ОЧЕРЕДЬ</span>
        <strong data-qa-fleet-production-queue-count>{queue.length}</strong>
      </header>
      {queue.length === 0 ? (
        <div className="fleet-production-queue-empty-v1">
          <span aria-hidden="true">◇</span>
          <div>
            <strong>Очередь свободна</strong>
            <small>Можно запустить новое производство.</small>
          </div>
        </div>
      ) : (
        <div className="fleet-production-queue-list-v1">
          {queue.map((order, index) => {
            const entity = getFleetProductionEntity(queueKind, order.itemId, factionId);
            const completed = Math.min(order.quantity, Math.max(0, order.completedQuantity));
            const pending = Math.max(0, order.quantity - completed);
            const active = index === 0;
            const progress = active && order.effectiveDurationMs > 0
              ? Math.max(0, Math.min(1, (now - order.startedAt) / order.effectiveDurationMs / Math.max(1, order.quantity)))
              : 0;
            const remainingMs = Math.max(0, order.finishAt - now);
            return (
              <article
                className={`fleet-production-order-v1 ${active ? 'active' : 'waiting'}`}
                key={order.id}
                data-qa-fleet-production-order={order.id}
                data-qa-fleet-production-status={active ? 'active' : 'waiting'}
              >
                <div className="fleet-production-order-art-v1">
                  {entity ? <img src={entity.art} alt="" draggable={false} /> : <span aria-hidden="true">◇</span>}
                </div>
                <div className="fleet-production-order-main-v1">
                  <strong>{entity?.name ?? order.itemId}</strong>
                  <small>{order.quantity} ед. · готово {completed} · осталось {pending}</small>
                  {active ? (
                    <time>{remainingMs > 0 ? formatClockDurationMs(remainingMs) : 'ЗАВЕРШЕНИЕ…'}</time>
                  ) : (
                    <span>ОЖИДАЕТ · ПОЗИЦИЯ {index + 1}</span>
                  )}
                </div>
                <div className="fleet-production-order-meta-v1">
                  <button type="button" aria-label={`Отменить заказ ${entity?.name ?? order.itemId}`} onClick={() => cancelOrder(order.id)}>×</button>
                </div>
                <div className="fleet-production-order-progress-v1" aria-hidden="true">
                  <i style={{ transform: `scaleX(${active ? progress : 0})` }} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
