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

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

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
    <section className="fleet-production-queue-v1" data-qa-fleet-production-queue={queueKind}>
      <header className="fleet-production-queue-head-v1">
        <strong>ТЕКУЩИЕ ПРОЦЕССЫ · {queueLabels[queueKind].toUpperCase()}</strong>
        <span>{queue.length > 0 ? `${queue.length} ${queue.length === 1 ? 'пакет' : 'пакета'}` : 'Очередь свободна'}</span>
      </header>
      {queue.length === 0 ? (
        <div className="fleet-production-queue-empty-v1">Очередь свободна</div>
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
                <div className="fleet-production-order-main-v1">
                  <span className="fleet-production-order-index-v1">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{entity?.name ?? order.itemId}</strong>
                    <small>{order.quantity} ед. · готово {completed} · осталось {pending}</small>
                  </div>
                </div>
                <div className="fleet-production-order-meta-v1">
                  <span>{active ? `Осталось ${formatClockDurationMs(remainingMs)}` : 'ОЖИДАЕТ'}</span>
                  <button type="button" aria-label={`Отменить заказ ${entity?.name ?? order.itemId}`} onClick={() => cancelOrder(order.id)}>×</button>
                </div>
                <div className="fleet-production-order-progress-v1" aria-hidden="true">
                  <i style={{ transform: `scaleX(${active ? progress : 0})` }} />
                </div>
                <footer>
                  <span>{active ? 'В ПРОИЗВОДСТВЕ' : 'В ОЧЕРЕДИ'}</span>
                  <span>{formatNumber(order.effectiveDurationMs / 1_000)} сек. / ед.</span>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
