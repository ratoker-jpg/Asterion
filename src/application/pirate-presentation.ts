import type { SaveState } from './contracts.ts';
import { getCurrentPirateContact, ensurePirateOwnerProfile } from './pirates.ts';
import { previewFlight } from './flights.ts';
import { canDispatchPirateRecon, pirateReconCooldownKey } from '../domain/pirates/recon.ts';
import type { PirateContactPresentation, PirateSystemSelection } from '../pirate-ui.ts';

const PIRATE_ATLAS_SYSTEMS = Array.from({ length: 40 }, (_, index) => index + 1);

/** The Operations atlas and Universe inspector project the same world schedule. */
export function selectPirateContacts(
  state: SaveState,
  now: number,
  selection: PirateSystemSelection,
  systems: readonly number[] = PIRATE_ATLAS_SYSTEMS,
): PirateContactPresentation[] {
  const ownerId = state.profile.playerId;
  const contacts: PirateContactPresentation[] = [];
  for (const system of systems) {
    const contact = getCurrentPirateContact(state, { galaxy: selection.galaxy, system, position: 1 }, now);
    if (!contact) continue;
    const flights = state.flights.records.filter((flight) => flight.pirateSnapshot?.ownerId === ownerId
      && flight.pirateSnapshot.contactCycleKey === contact.contactCycleKey
      && ['outbound', 'arrived', 'returning'].includes(flight.phase));
    const availability = canDispatchPirateRecon({ ownerId, contactCycleKey: contact.contactCycleKey, now,
      lastDispatchAt: state.pirate?.reconLastDispatchAt[pirateReconCooldownKey(ownerId, contact.contactCycleKey)],
      inFlight: flights.some((flight) => flight.missionId === 'pirate-recon'),
    });
    const report = state.pirate?.reconReports.filter((item) => item.ownerId === ownerId && item.contactCycleKey === contact.contactCycleKey)
      .sort((left, right) => right.arrivedAt - left.arrivedAt)[0];
    const reconReason = availability.reason === 'in-flight' ? 'Зонд в пути. Дождитесь завершения миссии.'
      : availability.reason === 'cooldown' ? `Повторная разведка через ${Math.max(0, Math.ceil(((availability.availableAt ?? now) - now) / 1_000))} с.` : null;
    const launchPreview = availability.allowed ? previewFlight(state, {
      requestId: `pirate-preview-${contact.contactCycleKey}`, missionId: 'pirate-recon',
      contactCycleKey: contact.contactCycleKey, selectedShips: { 'spy-probe': 1 },
      destination: { kind: 'coordinate', coordinate: contact.coordinate }, targetKind: 'pirate', targetRelation: 'neutral',
    }, { now }) : null;
    const launchReason = launchPreview && !launchPreview.ok ? launchPreview.error.message : null;
    contacts.push({ ...contact, remainingMs: Math.max(0, contact.expiresAt - now),
      statusLabel: flights.some((flight) => flight.missionId === 'pirate-elimination') ? 'Флот в пути'
        : availability.reason === 'in-flight' ? 'Зонд в пути' : availability.reason === 'cooldown' ? 'Ожидание повторной разведки'
          : report?.outcome === 'success' ? 'Разведка готова' : 'Доступен',
      statusTone: 'active', recon: { enabled: availability.allowed && !launchReason, disabledReason: reconReason ?? launchReason },
      elimination: { enabled: true, disabledReason: null }, latestReportId: report?.id ?? null,
    });
  }
  return contacts;
}

/** Event/runtime boundary: profile creation is persisted, never a render side effect. */
export function materializePirateProfiles(state: SaveState, contacts: readonly Pick<PirateContactPresentation, 'contactCycleKey'>[]): SaveState {
  let next = state;
  for (const contact of contacts) next = ensurePirateOwnerProfile(next, contact.contactCycleKey).state;
  return next;
}
