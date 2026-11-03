/**
 * Quick actions on a map object (right mouse button in «Вселенная»).
 *
 * Which actions an object offers mirrors the «Звёздный атлас» dialog; whether
 * one can go right now, from which planet and with which ships is decided by
 * the authoritative flight runtime: every plan here is a `previewFlight` of
 * the same command the fleet screen would send. Nothing in this module adds a
 * game rule: it only chooses UI defaults (nearest source, a starting ship set).
 */
import type { ShipId } from '../domain/combat/ids.ts';
import { SOLAR_SATELLITE_ID } from '../domain/combat/ids.ts';
import type { CommanderId } from '../domain/combat/commanders.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { calculateRouteDistance } from '../domain/flights/distance.ts';
import type { MissionId, TargetRelation } from '../domain/flights/types.ts';
import type { TransportCargo } from '../domain/flights/cargo.ts';
import type { RuntimeMode, TestTimeScale } from '../domain/runtime/mode.ts';
import { getUniverseActionState } from '../domain/universe/runtime.ts';
import type { UniverseCoordinate, UniverseObjectKind, UniverseOwnerAlliance, UniversePlanetNode } from '../domain/universe/types.ts';
import type { SaveState } from './contracts.ts';
import { getAttackCommanderSelection } from './attack.ts';
import { acceptLiveExploration } from './exploration-operations.ts';
import { selectOwnedPlanet } from './owned-planets.ts';
import {
  getAvailableFleetForPlanet,
  isRecyclerShip,
  previewFlight,
  resolveRecycleTargetKindAtCoordinate,
  type DispatchFlightCommand,
  type FlightCommandResult,
  type FlightLaunchContext,
} from './flights.ts';

export type QuickActionId =
  | 'colonize'
  | 'gas'
  | 'recycle'
  | 'spy'
  | 'attack'
  | 'transport'
  | 'deployment'
  | 'exploration-recon'
  | 'expedition'
  | 'exploration-attack'
  | 'pirate-recon'
  | 'pirate-elimination'
  | 'pirate-report';

/** Everything the map already knows about the object under the cursor. */
export type QuickTarget = {
  node: UniversePlanetNode;
  /** Owner relation for an inhabited planet, as getUniverseOwnerRelation computes it. */
  relation?: TargetRelation;
  owner?: { id: string; displayName: string; raceId?: string; alliance?: UniverseOwnerAlliance | null };
  /** For an asteroid: the kind of the position it currently sits on. */
  underlyingKind?: UniverseObjectKind;
  /** Free orbital debris at the coordinate. */
  orbitalDebris?: number;
  /** Unique objects and anomalies: undefined means out of expedition range. */
  explorationStatus?: 'free' | 'self' | 'occupied';
  pirate?: {
    contactCycleKey: string;
    recon: { enabled: boolean; disabledReason: string | null };
    elimination: { enabled: boolean; disabledReason: string | null };
    latestReportId: string | null;
  };
};

export type QuickActionRule = {
  id: QuickActionId;
  label: string;
  /** Flight mission; absent for actions that only open something. */
  missionId?: MissionId;
  enabled: boolean;
  /** Why the action cannot go, in the dialog's own words. */
  reason?: string;
};

export const QUICK_ACTION_LABELS: Record<QuickActionId, string> = {
  colonize: 'Колонизировать',
  gas: 'Отправить переработчика',
  recycle: 'Собрать обломки',
  spy: 'Шпионаж',
  attack: 'Атака',
  transport: 'Транспорт',
  deployment: 'Перебазировать',
  'exploration-recon': 'Исследовать зондом',
  expedition: 'Экспедиция',
  'exploration-attack': 'Атаковать',
  'pirate-recon': 'Разведать',
  'pirate-elimination': 'Пиратский рейд',
  'pirate-report': 'Открыть разведотчёт',
};

const MISSION_OF: Record<QuickActionId, MissionId | undefined> = {
  colonize: 'colonize',
  gas: 'gas',
  recycle: 'recycle',
  spy: 'espionage',
  attack: 'attack',
  transport: 'transport',
  deployment: 'deployment',
  'exploration-recon': 'exploration-recon',
  expedition: 'expedition',
  'exploration-attack': 'attack',
  'pirate-recon': 'pirate-recon',
  'pirate-elimination': 'pirate-elimination',
  'pirate-report': undefined,
};

const OUT_OF_RANGE = 'Доступно в пределах пяти систем от ваших колоний.';

function rule(id: QuickActionId, enabled: boolean, reason?: string): QuickActionRule {
  return { id, label: QUICK_ACTION_LABELS[id], missionId: MISSION_OF[id], enabled, ...(enabled || !reason ? {} : { reason }) };
}

/**
 * The actions an object offers, in the order of the «Звёздный атлас» dialog.
 * Map-level rules only (relation, occupancy, pirate contact); ships, gas and
 * the remaining launch checks come from `planQuickSend`.
 */
export function listQuickActions(target: QuickTarget, currentOwnerId: string): QuickActionRule[] {
  const { node } = target;
  const debris = (target.orbitalDebris ?? 0) > 0;
  const recycle = debris ? [rule('recycle', true)] : [];
  switch (node.kind) {
    case 'player':
    case 'npc': {
      const relation = target.relation ?? 'neutral';
      const transport = getUniverseActionState('fleet', node, currentOwnerId, relation);
      if (node.ownerId === currentOwnerId || relation === 'self') {
        return [rule('transport', transport.enabled, transport.reason), rule('deployment', true), ...recycle];
      }
      if (relation === 'ally') return [rule('transport', transport.enabled, transport.reason), ...recycle];
      const spy = getUniverseActionState('spy', node, currentOwnerId, relation);
      const attack = getUniverseActionState('attack', node, currentOwnerId, relation);
      return [
        rule('spy', spy.enabled && Boolean(target.owner), spy.reason),
        rule('attack', attack.enabled && Boolean(target.owner), attack.reason),
        rule('transport', transport.enabled, transport.reason),
        ...recycle,
      ];
    }
    case 'empty':
      return [rule('colonize', true), ...recycle];
    case 'asteroid':
      return [
        ...(target.underlyingKind === 'empty' ? [rule('colonize', true)] : []),
        ...(node.asteroid ? [rule('gas', true)] : []),
      ];
    case 'unique':
    case 'anomaly': {
      const status = target.explorationStatus;
      return [
        rule('exploration-recon', Boolean(status), OUT_OF_RANGE),
        ...(status === 'occupied'
          ? [rule('exploration-attack', true)]
          : [rule('expedition', status === 'free', status === 'self' ? 'Ваш флот уже добывает здесь.' : `Экспедиция: ${OUT_OF_RANGE.toLowerCase()}`)]),
        ...recycle,
      ];
    }
    case 'pirate': {
      const contact = target.pirate;
      return [
        rule('pirate-recon', Boolean(contact?.recon.enabled), contact?.recon.disabledReason || 'Разведка сейчас недоступна.'),
        rule('pirate-elimination', Boolean(contact?.elimination.enabled), contact?.elimination.disabledReason || 'Атака сейчас недоступна.'),
        rule('pirate-report', Boolean(contact?.latestReportId), 'Разведотчёт ещё не сформирован.'),
        ...recycle,
      ];
    }
    default:
      return recycle;
  }
}

export type QuickFleet = {
  ships: Partial<Record<ShipId, number>>;
  commanders?: Partial<Record<CommanderId, number>>;
};

const CARGO_SHIPS: readonly ShipId[] = ['transporter', 'mega-transporter'];
const SINGLE_PROBE: readonly QuickActionId[] = ['spy', 'exploration-recon', 'pirate-recon'];
const COMBAT_ACTIONS: readonly QuickActionId[] = ['attack', 'exploration-attack', 'pirate-elimination'];
const SERVICE_SHIPS = new Set<ShipId>([SOLAR_SATELLITE_ID, 'spy-probe', 'transporter', 'mega-transporter', 'colonizer', 'recycler']);

function positive(ships: Partial<Record<ShipId, number>>): Partial<Record<ShipId, number>> {
  return Object.fromEntries(Object.entries(ships).filter(([, count]) => Math.floor(count ?? 0) > 0)) as Partial<Record<ShipId, number>>;
}

function shipCargo(factionId: CombatFactionId, shipId: ShipId): number {
  return getFactionShipCatalog(factionId).find((entity) => entity.id === shipId)?.ship?.cargo ?? 0;
}

/** Ships this action can carry at all (the adjust list in the quick panel). */
export function quickActionShipIds(state: SaveState, actionId: QuickActionId): ShipId[] {
  const factionId = state.profile.factionId as CombatFactionId;
  const all = getFactionShipCatalog(factionId).map((entity) => entity.id as ShipId).filter((id) => id !== SOLAR_SATELLITE_ID);
  if (SINGLE_PROBE.includes(actionId)) return ['spy-probe'];
  if (actionId === 'colonize') return ['colonizer'];
  if (actionId === 'gas' || actionId === 'recycle') return all.filter((id) => isRecyclerShip(id, factionId));
  if (actionId === 'transport') return all;
  if (actionId === 'expedition') return [...CARGO_SHIPS, ...all.filter((id) => isRecyclerShip(id, factionId))];
  return all;
}

/**
 * A sensible starting ship set from what is free on the planet: one probe or
 * colonizer, recyclers sized to known debris (all of them for the hidden gas
 * of an asteroid), every warship for combat, cargo hulls for expeditions and
 * transport, the whole fleet for a rebase.
 */
export function defaultQuickFleet(state: SaveState, actionId: QuickActionId, originPlanetId: string, target: QuickTarget): QuickFleet {
  const factionId = state.profile.factionId as CombatFactionId;
  const free = getAvailableFleetForPlanet(state, originPlanetId);
  const has = (shipId: ShipId) => Math.max(0, Math.floor(free.ships[shipId] ?? 0));
  if (SINGLE_PROBE.includes(actionId)) return { ships: positive({ 'spy-probe': Math.min(1, has('spy-probe')) }) };
  if (actionId === 'colonize') return { ships: positive({ colonizer: Math.min(1, has('colonizer')) }) };
  if (actionId === 'gas' || actionId === 'recycle') {
    const recyclers = quickActionShipIds(state, actionId);
    if (actionId === 'gas' || !(target.orbitalDebris && target.orbitalDebris > 0)) {
      return { ships: positive(Object.fromEntries(recyclers.map((id) => [id, has(id)]))) };
    }
    // Fill the largest hulls first until the known debris fits.
    let left = target.orbitalDebris;
    const ships: Partial<Record<ShipId, number>> = {};
    for (const id of [...recyclers].sort((a, b) => shipCargo(factionId, b) - shipCargo(factionId, a))) {
      const cargo = shipCargo(factionId, id);
      if (left <= 0 || cargo <= 0) break;
      const count = Math.min(has(id), Math.ceil(left / cargo));
      ships[id] = count;
      left -= count * cargo;
    }
    return { ships: positive(ships) };
  }
  if (COMBAT_ACTIONS.includes(actionId)) {
    const ships = Object.fromEntries((Object.keys(free.ships) as ShipId[]).filter((id) => !SERVICE_SHIPS.has(id)).map((id) => [id, has(id)]));
    return { ships: positive(ships), commanders: getAttackCommanderSelection(state, originPlanetId) };
  }
  if (actionId === 'expedition' || actionId === 'transport') {
    return { ships: positive(Object.fromEntries(quickActionShipIds(state, 'expedition').filter((id) => actionId === 'expedition' || CARGO_SHIPS.includes(id)).map((id) => [id, has(id)]))) };
  }
  if (actionId === 'deployment') {
    const ships = Object.fromEntries((Object.keys(free.ships) as ShipId[]).filter((id) => id !== SOLAR_SATELLITE_ID).map((id) => [id, has(id)]));
    const commanders = Object.fromEntries(Object.entries(free.commanders).filter(([, count]) => (count ?? 0) > 0)) as Partial<Record<CommanderId, number>>;
    return { ships: positive(ships), commanders };
  }
  return { ships: {} };
}

function raceOf(raceId: string | undefined): 'aegis' | 'synod' | 'veyra' {
  return raceId === 'synod' || raceId === 'veyra' ? raceId : 'aegis';
}

export type QuickRuntime = { now: number; mode: RuntimeMode; testTimeScale?: TestTimeScale };

/**
 * The fleet screen's launch context for «Подробно» (same shape as the dialog's
 * buttons). Probe-only actions have no fleet-screen form, so they have none.
 */
export function quickLaunchContext(actionId: QuickActionId, target: QuickTarget): FlightLaunchContext | null {
  const { node } = target;
  const coordinate = { ...node.coordinate };
  const owner = target.owner;
  switch (actionId) {
    case 'colonize': return { missionId: 'colonize', targetKind: 'empty', destination: { kind: 'coordinate', coordinate } };
    case 'gas': return { missionId: 'gas', targetKind: 'asteroid', destination: { kind: 'coordinate', coordinate } };
    case 'recycle': return { missionId: 'recycle', destination: { kind: 'coordinate', coordinate } };
    case 'transport': return { missionId: 'transport', targetRelation: target.relation, destination: { kind: 'planet', planetId: node.id, coordinate } };
    case 'deployment': return { missionId: 'deployment', targetRelation: 'self', destination: { kind: 'planet', planetId: node.id, coordinate } };
    case 'spy':
    case 'attack':
      return {
        missionId: actionId === 'spy' ? 'espionage' : 'attack',
        targetRelation: target.relation, targetKind: node.kind, targetPlanetName: node.name,
        targetOwnerId: owner?.id, targetOwnerName: owner?.displayName, targetRaceId: raceOf(owner?.raceId), targetAlliance: owner?.alliance ?? null,
        destination: { kind: 'planet', planetId: node.id, coordinate },
      };
    case 'expedition':
      return { missionId: 'expedition', contactCycleKey: node.id, targetKind: node.kind, targetPlanetName: node.name, targetRelation: 'neutral', destination: { kind: 'coordinate', coordinate } };
    case 'exploration-attack':
      return { missionId: 'attack', contactCycleKey: node.id, operationId: node.id, targetKind: node.kind, targetRelation: 'neutral', targetPlanetName: node.name, destination: { kind: 'coordinate', coordinate } };
    case 'pirate-elimination':
      return target.pirate ? {
        missionId: 'pirate-elimination', contactCycleKey: target.pirate.contactCycleKey, destination: { kind: 'coordinate', coordinate },
        targetKind: 'pirate', targetRelation: 'neutral', targetPlanetName: 'Пираты',
      } : null;
    default: return null;
  }
}

/** The exact dispatch command the fleet screen would build for this launch. */
export function buildQuickCommand(
  state: SaveState,
  actionId: QuickActionId,
  target: QuickTarget,
  originPlanetId: string,
  fleet: QuickFleet,
  runtime: QuickRuntime,
  cargo?: TransportCargo,
): DispatchFlightCommand | null {
  const missionId = MISSION_OF[actionId];
  const { node } = target;
  const coordinate = { ...node.coordinate };
  const common = { missionId: missionId!, requestId: `quick-${actionId}-${originPlanetId}-${node.id}-${runtime.now}`, originPlanetId, selectedShips: fleet.ships, departedAt: runtime.now };
  // Same commands as the dialog's «Исследовать зондом» and «Разведать».
  if (actionId === 'exploration-recon') {
    return { ...common, contactCycleKey: node.id, operationId: node.id, targetKind: node.kind, destination: { kind: 'coordinate', coordinate } };
  }
  if (actionId === 'pirate-recon') {
    return target.pirate ? { ...common, contactCycleKey: target.pirate.contactCycleKey, targetKind: 'pirate', targetRelation: 'neutral', destination: { kind: 'coordinate', coordinate } } : null;
  }
  const context = quickLaunchContext(actionId, target);
  if (!context || !missionId) return null;
  const base: DispatchFlightCommand = { ...context, ...common };
  switch (actionId) {
    case 'recycle':
      return { ...base, targetKind: resolveRecycleTargetKindAtCoordinate(state, node.coordinate, runtime.now, runtime.mode) };
    case 'attack':
    case 'exploration-attack':
    case 'pirate-elimination':
      return { ...base, selectedCommanders: fleet.commanders ?? {}, maxRounds: 12 };
    case 'deployment':
      return { ...base, selectedCommanders: fleet.commanders ?? {} };
    case 'transport':
      return { ...base, cargo: cargo ?? { metal: 0, minerals: 0, gas: 0, debris: 0 } };
    case 'expedition':
      return { ...base, operationId: node.id };
    default:
      return base;
  }
}

/**
 * The state a command is checked and sent against, as the player would set it
 * up by hand: a rebase leaves from the planet selected in the header (so that
 * planet is selected first), and from the map accepting an exploration
 * contact and launching its probe is one step (as in the dialog).
 */
export function prepareQuickState(state: SaveState, command: DispatchFlightCommand, runtime: QuickRuntime): SaveState {
  let prepared = state;
  if (command.missionId === 'deployment' && command.originPlanetId && command.originPlanetId !== state.currentPlanetId) {
    prepared = selectOwnedPlanet(prepared, command.originPlanetId);
  }
  if (command.missionId === 'exploration-recon' && command.operationId
    && !prepared.exploration?.acceptedContactIds?.includes(command.operationId)) {
    prepared = acceptLiveExploration(prepared, command.operationId, runtime.now, runtime.mode) ?? prepared;
  }
  return prepared;
}

/** Previews the launch exactly as Send will run it. */
export function previewQuickCommand(state: SaveState, command: DispatchFlightCommand, runtime: QuickRuntime): FlightCommandResult {
  return previewFlight(prepareQuickState(state, command, runtime), command, { now: runtime.now, mode: runtime.mode, testTimeScale: runtime.testTimeScale });
}

const NO_SHIPS: Partial<Record<QuickActionId, string>> = {
  spy: 'Нет свободного шпионского зонда ни на одной вашей планете.',
  'exploration-recon': 'Нет свободного шпионского зонда ни на одной вашей планете.',
  'pirate-recon': 'Нет свободного шпионского зонда ни на одной вашей планете.',
  colonize: 'Нет свободного колонизатора ни на одной вашей планете.',
  gas: 'Нет свободных переработчиков ни на одной вашей планете.',
  recycle: 'Нет свободных переработчиков ни на одной вашей планете.',
  attack: 'Нет свободных боевых кораблей ни на одной вашей планете.',
  'exploration-attack': 'Нет свободных боевых кораблей ни на одной вашей планете.',
  'pirate-elimination': 'Нет свободных боевых кораблей ни на одной вашей планете.',
  expedition: 'Нет свободных транспортов или переработчиков ни на одной вашей планете.',
  transport: 'Нет свободных транспортов ни на одной вашей планете.',
  deployment: 'Нет свободных кораблей на других ваших планетах.',
};

export function planetCoordinate(state: SaveState, planetId: string): UniverseCoordinate {
  const planet = state.planets[planetId];
  return { galaxy: planet?.universeGalaxy ?? 1, system: planet?.universeSystem ?? 1, position: planet?.universePosition ?? 1 };
}

/** Own planets that may launch this action, nearest first (the current planet wins a tie). */
export function quickOriginCandidates(state: SaveState, actionId: QuickActionId, target: QuickTarget): string[] {
  return Object.keys(state.planets)
    .filter((planetId) => planetId !== target.node.id)
    .map((planetId) => ({ planetId, distance: calculateRouteDistance(planetCoordinate(state, planetId), target.node.coordinate) }))
    .sort((a, b) => a.distance - b.distance || Number(b.planetId === state.currentPlanetId) - Number(a.planetId === state.currentPlanetId))
    .map((item) => item.planetId);
}

export type QuickSendPlan = {
  actionId: QuickActionId;
  originPlanetId: string | null;
  fleet: QuickFleet;
  command: DispatchFlightCommand | null;
  preview: FlightCommandResult | null;
  /** Set when nothing can launch: the runtime's own refusal or «no free ships». */
  error?: string;
};

export function planFromOrigin(state: SaveState, actionId: QuickActionId, target: QuickTarget, originPlanetId: string, runtime: QuickRuntime, fleet = defaultQuickFleet(state, actionId, originPlanetId, target), cargo?: TransportCargo): QuickSendPlan {
  const command = buildQuickCommand(state, actionId, target, originPlanetId, fleet, runtime, cargo);
  const preview = command ? previewQuickCommand(state, command, runtime) : null;
  return {
    actionId, originPlanetId, fleet, command, preview,
    ...(preview && !preview.ok ? { error: preview.error.message } : {}),
  };
}

/**
 * Default source: the nearest own planet whose default fleet the runtime
 * accepts; otherwise the nearest one that has suitable ships (its refusal is
 * shown); otherwise «no free ships».
 */
export function planQuickSend(state: SaveState, actionId: QuickActionId, target: QuickTarget, runtime: QuickRuntime): QuickSendPlan {
  let fallback: QuickSendPlan | null = null;
  for (const originPlanetId of quickOriginCandidates(state, actionId, target)) {
    const fleet = defaultQuickFleet(state, actionId, originPlanetId, target);
    if (Object.keys(fleet.ships).length === 0 && Object.keys(fleet.commanders ?? {}).length === 0) continue;
    const plan = planFromOrigin(state, actionId, target, originPlanetId, runtime, fleet);
    if (plan.preview?.ok) return plan;
    fallback ??= plan;
  }
  return fallback ?? {
    actionId, originPlanetId: null, fleet: { ships: {} }, command: null, preview: null,
    error: NO_SHIPS[actionId] ?? 'Нет свободных кораблей для этого действия.',
  };
}

export type QuickActionView = QuickActionRule & { plan?: QuickSendPlan };

/** The menu: map rules first, then the runtime's verdict for the default launch. */
export function evaluateQuickActions(state: SaveState, target: QuickTarget, runtime: QuickRuntime): QuickActionView[] {
  return listQuickActions(target, state.profile.playerId).map((action) => {
    if (!action.enabled || !action.missionId) return action;
    const plan = planQuickSend(state, action.id, target, runtime);
    return plan.preview?.ok ? { ...action, plan } : { ...action, enabled: false, reason: plan.error, plan };
  });
}

/** Probe and colonizer actions send one ship from one planet; the rest may gather fleets from several. */
export function isMultiSourceAction(actionId: QuickActionId): boolean {
  return !SINGLE_PROBE.includes(actionId) && actionId !== 'colonize';
}

/** One source planet of a (possibly multi-planet) launch: its suggested fleet and the runtime's verdict. */
export type QuickLegPlan = QuickSendPlan & { originPlanetId: string };

/**
 * Every own planet that holds ships for this action, nearest first, each with
 * its own default fleet, flight time and arrival. The panel pre-checks the
 * first leg the runtime accepts; the player adds the others.
 */
export function planQuickLegs(state: SaveState, actionId: QuickActionId, target: QuickTarget, runtime: QuickRuntime): QuickLegPlan[] {
  return quickOriginCandidates(state, actionId, target).flatMap((originPlanetId) => {
    const fleet = defaultQuickFleet(state, actionId, originPlanetId, target);
    if (Object.keys(fleet.ships).length === 0 && Object.keys(fleet.commanders ?? {}).length === 0) return [];
    return [planFromOrigin(state, actionId, target, originPlanetId, runtime, fleet) as QuickLegPlan];
  });
}

export type QuickLegOutcome = { originPlanetId: string; result: FlightCommandResult };

/**
 * Sends the legs one after another through the given dispatcher (the game's
 * `dispatchFlight`), each against the state the previous one left. A refused
 * leg spends nothing and does not stop the others. The planet selected in the
 * header stays the one the player had.
 */
export function sendQuickLegs(
  state: SaveState,
  commands: readonly DispatchFlightCommand[],
  runtime: QuickRuntime,
  dispatch: (state: SaveState, command: DispatchFlightCommand, options: { now: number; mode: RuntimeMode; testTimeScale?: TestTimeScale }) => FlightCommandResult,
): { state: SaveState; outcomes: QuickLegOutcome[] } {
  const selected = state.currentPlanetId;
  let current = state;
  const outcomes: QuickLegOutcome[] = [];
  for (const command of commands) {
    const prepared = prepareQuickState(current, command, runtime);
    const result = dispatch(prepared, command, { now: runtime.now, mode: runtime.mode, testTimeScale: runtime.testTimeScale });
    if (result.ok) current = result.state;
    outcomes.push({ originPlanetId: command.originPlanetId ?? selected, result });
  }
  if (current.currentPlanetId !== selected && current.planets[selected]) current = selectOwnedPlanet(current, selected);
  return { state: current, outcomes };
}
