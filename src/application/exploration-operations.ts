import type { SaveState } from './contracts.ts';
import type { RuntimeMode } from '../domain/runtime/mode.ts';
import {
  acceptExplorationOperation, cancelExplorationOperation, createExplorationState,
  getOrMaterializeExplorationContact, resolveExplorationRecon, recordHighestExplorationScore,
} from '../domain/exploration/ledger.ts';
import { explorationResourceScore } from './exploration-flight.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';
import { getExplorationTarget } from './exploration.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import type { ExplorationReconRecord } from '../domain/exploration/ledger.ts';
import {
  createSeededEspionageRng, espionageRollSeed, normalizeRngRoll, repeatReportLosesProbe, resolveSpyReportQuality,
} from '../domain/espionage/runtime.ts';
import { resolveSpyOwnerProfile } from '../domain/espionage/owner-profile.ts';
import { selectOwnerAlliance } from '../domain/command/selectors.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { SpyOwnerProfile } from '../domain/espionage/types.ts';

/** Accepting an operation persists its precise cycle; it never creates a demo operation. */
export function acceptLiveExploration(state: SaveState, id: string, nowMs: number, mode: RuntimeMode): SaveState | null {
  const node = getExplorationTarget(state, id, nowMs, mode);
  if (!node) return null;
  const ledger = state.exploration ?? createExplorationState();
  const remembered = recordHighestExplorationScore(ledger,state.profile.playerId,selectOwnerScores(state)[state.profile.playerId]?.resourcePoints ?? 0);
  const materialized = getOrMaterializeExplorationContact(remembered, node);
  return { ...state, exploration: acceptExplorationOperation(materialized.state, id) };
}
export function cancelLiveExploration(state: SaveState, id: string): SaveState {
  if (!state.exploration?.acceptedContactIds?.includes(id)) return state;
  return { ...state, exploration: cancelExplorationOperation(state.exploration, id) };
}

const espionageRoll = (flightId: string, kind: 'report' | 'repeat-loss') =>
  normalizeRngRoll(Math.floor(createSeededEspionageRng(espionageRollSeed(flightId, kind, 1))() * 100));

/** Owner-wide espionage profile of whoever launched `flight`: the player, or an NPC planet's owner. */
function flightOwnerProfile(state: SaveState, flight: FlightRecord): { level: number; profile?: SpyOwnerProfile } {
  if (flight.ownerSide === 'player' || flight.ownerSide === undefined) {
    return { level: Math.max(0, Math.floor(state.science.levels[5] ?? 0)) };
  }
  const target = state.espionage?.targets?.[flight.originPlanetId];
  const profile = target ? resolveSpyOwnerProfile(target, state.espionage?.bot01Profile) : undefined;
  return { level: Math.max(0, Math.floor(profile?.scienceLevels[5] ?? target?.espionageLevel ?? 0)), profile };
}

/**
 * Espionage over an occupied object follows the planet rules: report tier from the
 * observer/occupant espionage-level delta and one seeded roll, and a repeat look at
 * the same occupied object costs the probe on the canonical loss roll.
 */
function reconOccupant(state: SaveState, flight: FlightRecord, contactId: string, arrivedAt: number, observerId: string):
  { occupant?: ExplorationReconRecord['occupant']; probeLost?: boolean } {
  const contact = state.exploration?.contacts[contactId];
  const claim = contact?.claim;
  if (!claim || claim.ownerId === observerId || (claim.pendingRecallAt !== undefined && arrivedAt >= claim.pendingRecallAt)) return {};
  const held = state.flights.records.find(item => item.id === claim.flightId);
  const target = held ? state.espionage?.targets?.[held.originPlanetId] : undefined;
  const heldByPlayer = claim.ownerId === state.profile.playerId;
  const occupantProfile = target ? resolveSpyOwnerProfile(target, state.espionage?.bot01Profile) : undefined;
  const spy = flightOwnerProfile(state, flight).level;
  const theirs = heldByPlayer
    ? Math.max(0, Math.floor(state.science.levels[5] ?? 0))
    : Math.max(0, Math.floor(occupantProfile?.scienceLevels[5] ?? target?.espionageLevel ?? 0));
  const repeat = (state.exploration?.reconReports ?? []).some(record =>
    record.contactId === contactId && record.ownerId === observerId && record.occupant);
  if (repeat && repeatReportLosesProbe(espionageRoll(flight.id, 'repeat-loss'))) return { probeLost: true };
  const delta = spy - theirs;
  const roll = espionageRoll(flight.id, 'report');
  const quality = resolveSpyReportQuality(delta, roll);
  const raceId = (held?.explorationFactionId ?? held?.attackSnapshot?.attackerFactionId
    ?? (heldByPlayer ? state.profile.factionId : target?.raceId) ?? state.profile.factionId) as CombatFactionId;
  const alliance = selectOwnerAlliance(state.command, claim.ownerId);
  const ships = Object.fromEntries(Object.entries(held?.selectedShips ?? {})
    .filter(([, count]) => Number.isSafeInteger(count) && (count as number) > 0)) as Record<string, number>;
  const levels = (held?.attackSnapshot?.attackerShipLevels ?? occupantProfile?.shipLevels) as Record<string, number> | undefined;
  return {
    occupant: {
      ownerId: claim.ownerId,
      ownerName: heldByPlayer ? state.profile.displayName : target?.ownerName ?? claim.ownerId,
      raceId,
      alliance: alliance ? { id: alliance.id, name: alliance.name, tag: alliance.tag } : null,
      quality, spyLevel: spy, targetEspionageLevel: theirs, delta, roll, firstReport: !repeat,
      ...(quality === 'full' && held ? {
        fleet: ships,
        ...(levels ? { fleetLevels: Object.fromEntries(Object.keys(ships).map(id => [id, levels[id] ?? 0])) } : {}),
      } : {}),
    },
  };
}

/** Recon reports come only from completed one-probe flights, never from a UI click. */
export function resolveExplorationProbeArrival(state: SaveState, flight: FlightRecord, arrivedAt: number, mode: RuntimeMode): {
  state: SaveState; notice: string; probeLost?: boolean;
} {
  const id = flight.operationId;
  const ledger = state.exploration ?? createExplorationState();
  if (!id || !ledger.contacts[id] || !getExplorationTarget(state, id, arrivedAt, mode)) {
    return { state, notice: 'Зонд прибыл после исчезновения объекта. Данные не получены.' };
  }
  if (ledger.reconReports?.some(r => r.flightId === flight.id)) {
    return { state, notice: 'Результат исследования этого полёта уже сохранён.' };
  }
  const observerId = flight.ownerSide === 'npc' ? flight.ownerId : state.profile.playerId;
  if (!observerId) return { state, notice: 'Неизвестный владелец разведки.' };
  const seen = reconOccupant(state, flight, id, arrivedAt, observerId);
  if (seen.probeLost) {
    return { state, probeLost: true, notice: 'Шпионский зонд потерян над занятым объектом при повторном отчёте.' };
  }
  const report = resolveExplorationRecon(ledger.contacts[id]!, observerId, flight.id,
    arrivedAt, ledger.reconReports ?? [], seen.occupant);
  const tier = seen.occupant?.quality === 'full' ? ' Состав флота раскрыт.' : seen.occupant ? ' Состав флота не раскрыт.' : '';
  return {
    state: { ...state, exploration: {
      ...ledger, reconReports: [...(ledger.reconReports ?? []), report].slice(-256),
    } },
    notice: (report.success
      ? 'Зонд завершил исследование: сведения о ресурсах и риске доступны в «Операциях».'
      : 'Зонд исследовал объект, но не получил достоверных данных. Повторная попытка возможна через 120 секунд.')
      + (seen.occupant ? ' Занимает: ' + seen.occupant.ownerName + '.' + tier : ''),
  };
}
