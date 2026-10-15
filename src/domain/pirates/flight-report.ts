import type { FlightRecord } from '../flights/types.ts';
import type { ReportItem } from '../reports/types.ts';

/** Historical absence messages derive from the persisted terminal flight outcome. */
export function pirateFlightAbsenceReports(flights: readonly FlightRecord[]): ReportItem[] {
  return flights.filter((flight) => flight.missionId === 'pirate-elimination'
    && flight.completionReason === 'target-unavailable' && flight.arrivedAt !== undefined
    && flight.pirateSnapshot).map((flight) => {
    const coordinate = flight.destinationCoordinate;
    const label = `[${coordinate.galaxy}:${coordinate.system}:${coordinate.position}]`;
    return {
      id: `pirate-no-target:${flight.id}`, source: 'pirate-mission', category: 'flights',
      typeLabel: 'ПИРАТСКИЙ РЕЙД', title: 'Пиратская планета не обнаружена',
      preview: 'По указанным координатам планеты пиратов не обнаружено',
      body: 'По указанным координатам планеты пиратов не обнаружено',
      timestamp: new Date(flight.arrivedAt!).toISOString(), statusLabel: 'ЦЕЛЬ ИСЧЕЗЛА', statusTone: 'neutral',
      participantNames: [], planetNames: ['Пираты'], coordinates: [label],
      details: [{ label: 'Цикл контакта', value: flight.pirateSnapshot!.contactCycleKey },
        { label: 'Результат', value: 'Бой не состоялся. Флот направлен обратно.' }],
    };
  });
}
