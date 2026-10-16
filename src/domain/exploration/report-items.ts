import type { FlightRecord } from '../flights/types.ts';
import type { ReportItem } from '../reports/types.ts';
import { explorationProfile } from './model.ts';
import type { ExplorationState } from './ledger.ts';

const number = new Intl.NumberFormat('ru-RU');
const KINDS = ['metal', 'minerals', 'gas', 'debris'] as const;
const LABELS = { metal: 'Металл', minerals: 'Минералы', gas: 'Газ', debris: 'Обломки' } as const;
function coords(c: {galaxy: number; system: number; position: number}) {
  return '[' + c.galaxy + ':' + c.system + ':' + c.position + ']';
}
/** Project persisted flight and contact events into the existing real System / Flights mailbox. */
export function explorationMailboxReports(ledger?: ExplorationState, flights: readonly FlightRecord[] = []): ReportItem[] {
  const contacts = ledger?.contacts ?? {};
  const recon: ReportItem[] = (ledger?.reconReports ?? []).map(record => {
    const contact = contacts[record.contactId];
    const profile = contact ? explorationProfile(contact.kind, contact.variant) : null;
    const location = contact ? coords(contact.coordinate) : 'Неизвестные координаты';
    const reserveDetails = record.success && contact
      ? KINDS.filter(key => (contact.initialReserve[key] ?? 0) > 0)
        .map(key => ({ label: LABELS[key] + ' · исходный запас', value: number.format(contact.initialReserve[key]) }))
      : [];
    return {
      id: 'exploration-recon:' + record.flightId,
      source: 'exploration',
      category: 'system',
      typeLabel: 'Исследование объекта',
      title: record.success ? 'Исследование завершено' : 'Разведка не удалась',
      preview: (profile?.name ?? 'Космический объект') + ' · ' + location,
      body: record.success
        ? 'Шпионский зонд получил разведданные. Запасы конечны: другие экспедиции могут уменьшить остаток. Фактическая добыча ограничена скоростью, временем и трюмом.'
        : 'Зонд достиг объекта, но не смог классифицировать его ресурсы. Данные о запасах не раскрыты. Повторная разведка возможна после задержки.',
      timestamp: new Date(record.resolvedAt).toISOString(),
      statusLabel: record.success ? 'УСПЕШНО' : 'НЕУДАЧА',
      statusTone: record.success ? 'success' : 'warning',
      participantNames: [], planetNames: profile ? [profile.name] : [], coordinates: [location],
      details: [
        { label: 'Цель', value: profile?.name ?? record.contactId },
        { label: 'Координаты', value: location },
        { label: 'Вылет зонда', value: record.flightId },
        { label: 'Результат', value: record.success ? 'Достоверный состав найден' : 'Сведения не получены' },
        ...(record.success && profile
          ? [{ label: 'Категория риска (из V)', value: ['I','II','III','IV','V'][profile.risk-1]! },
              ...reserveDetails,
              { label: 'Остатки зависят от уже выполненной добычи', value: 'Да' }]
          : []),
      ],
    };
  });

  // Report the actual landing outcome; do not replace a zero-yield flight with a fictional reward.
  const expedition: ReportItem[] = Object.values(contacts).flatMap(contact =>
    contact.events.filter(event => event.kind === 'returned' || event.kind === 'origin-destroyed').map(event => {
      const profile = explorationProfile(contact.kind, contact.variant);
      const returned = event.kind === 'returned';
      const cargo = event.cargo ?? { metal: 0, minerals: 0, gas: 0, debris: 0 };
      const credited = event.creditedCargo ?? cargo;
      const burned = event.burnedCargo;
      const total = KINDS.reduce((sum,key)=>sum + credited[key],0);
      const pieces = KINDS.map(key => LABELS[key] + ' ' + number.format(credited[key]));
      const location = coords(contact.coordinate);
      return {
        id: 'exploration-return:' + event.flightId,
        source: 'exploration', category: 'flights',
        typeLabel: 'Возвращение экспедиции',
        title: returned ? 'Экспедиция вернулась' : 'Экспедиция потеряла планету назначения',
        preview: profile.name + ' · ' + (returned ? pieces.join(' · ') : 'Груз потерян'),
        body: returned
          ? total > 0
            ? 'Флот вернулся на планету отправления. Металл, минералы и газ поступили на склады с учётом лимитов. Обломки помещены в запас переработки на исходной планете, а не на обычный склад.'
            : 'Флот вернулся БЕЗ ДОБЫЧИ. Проверьте специализацию кораблей: для обломков нужны переработчики, транспортёры их не добывают.'
          : 'Планета отправления уничтожена. Ресурсы экспедиции не доставлены.',
        timestamp: new Date(event.at).toISOString(),
        statusLabel: returned ? (total ? 'ДОСТАВЛЕНО' : '0 РЕСУРСОВ') : 'ПОТЕРЯНО',
        statusTone: returned ? (total ? 'success' : 'warning') : 'danger',
        participantNames: [], planetNames: [profile.name], coordinates: [location],
        details: [
          { label: 'Цель', value: profile.name + ' ' + location },
          { label: 'Планета отправления', value: event.originPlanetId ?? 'Недоступна' },
          ...KINDsDetails(credited),
          ...(burned ? KINDsDetails(burned,'Сгорело при переполнении · ') : []),
          { label: 'Обломки хранятся', value: 'На исходной планете → Переработка (не склад металла)' },
          { label: 'Жетоны ремонта', value: String(event.repairTokens ?? 0) },
        ],
      };
    }));

  // Every landed/returned canonical flight with a completed record gets a flight-mailbox trail.
  // Expedition deliveries have the exact escrow receipt above, avoiding duplicate reporting.
  const generic: ReportItem[] = flights.filter(f => (f.phase === 'completed' || f.phase === 'failed')
    && f.ownerSide !== 'pirate' && f.ownerSide !== 'bot01'
    && f.missionId !== 'expedition' && f.missionId !== 'exploration-recon'
    && f.missionId !== 'espionage').map(flight => {
      const location = coords(flight.destinationCoordinate);
      const success = flight.phase === 'completed' && flight.completionReason !== 'mission-failed';
      const cargo = flight.cargo;
      return {
        id: 'flight-landing:' + flight.id,
        source: 'flights', category: 'flights',
        typeLabel: 'Итог полёта',
        title: success ? 'Рейс завершён' : 'Рейс завершился без результата',
        preview: flight.missionId + ' · ' + location,
        body: 'Итоговый статус сохранён по фактическому рейсу. Если рейс перевозил груз, точные зачисления могут отличаться из-за лимитов складов. Для экспедиции приведён отдельный подтверждённый отчёт.',
        timestamp: new Date(flight.completedAt ?? flight.returnAt ?? flight.arrivalAt).toISOString(),
        statusLabel: success ? 'ЗАВЕРШЕНО' : 'БЕЗ РЕЗУЛЬТАТА',
        statusTone: success ? 'info' : 'warning',
        participantNames: [], planetNames: [], coordinates: [location],
        details: [
          { label: 'Миссия', value: flight.missionId },
          { label: 'Планета отправления', value: flight.originPlanetId },
          { label: 'Цель', value: location },
          { label: 'Причина', value: flight.completionReason ?? 'Штатное завершение' },
          ...(cargo ? KINDsDetails(cargo, 'На борту при отправлении · ') : []),
        ],
      };
    });
  return [...recon,...expedition,...generic];
}
function KINDsDetails(cargo: Record<typeof KINDS[number],number>, prefix = '') {
  return KINDS.map(key => ({ label: prefix + LABELS[key], value: number.format(cargo[key] ?? 0) }));
}
