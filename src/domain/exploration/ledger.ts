import type { TransportCargo } from '../flights/cargo.ts';
import type { UniverseCoordinate, UniversePlanetNode } from '../universe/types.ts';
import {
  EXPLORATION_RULES,
  accumulateExplorationCargo,
  emptyExplorationCargo,
  explorationBaseRate,
  explorationContactId,
  isExplorationContactId,
  explorationMiningRates,
  explorationNodeId,
  explorationProfile,
  profileVariantForArt,
  explorationSeedRoll,
  explorationRareWon,
  captureExplorationCargo,
  type ExplorationKind,
  type MiningCapacity,
} from './model.ts';

export type ExplorationClaim = {
  claimId: string;
  ownerId: string;
  originPlanetId: string;
  flightId: string;
  startedAt: number;
  lastAccruedAt: number;
  heldMs: number;
  cargo: TransportCargo;
  fractionalMs: TransportCargo;
  capacity: MiningCapacity;
  cargoCapacity: number;
  resourcePointsLaunch: number;
  catchupMultiplier: number;
  pendingRecallAt?: number;
  boostedUntilAt?: number;
  defenseBoostConsumed?: boolean;
};

export type ExplorationEvent = {
  id: string;
  at: number;
  kind: 'arrived' | 'recalled' | 'expired' | 'defended' | 'captured' | 'draw' | 'returned' | 'origin-destroyed';
  ownerId: string;
  flightId: string;
  cargo?: TransportCargo;
  lostCargo?: TransportCargo;
  heldMs?: number;
  claimId?: string;
  originPlanetId?: string;
  repairTokens?: number;
  /** Resource wallet credit after destination storage limits; debris is a separate orbital recycling pool. */
  creditedCargo?: TransportCargo;
  /** Resources destroyed on storage-cap overflow (debris never overflows). */
  burnedCargo?: TransportCargo;
};

export type ExplorationContact = {
  id: string;
  kind: ExplorationKind;
  coordinate: UniverseCoordinate;
  variant: number;
  appearedAt: number;
  expiresAt: number;
  worldScoreAtAppearance: number;
  initialReserve: TransportCargo;
  resourceReserve: TransportCargo;
  extractedByType: TransportCargo;
  claim?: ExplorationClaim;
  /** One rare roll per owner and contact cycle is a payout-layer invariant. */
  rareUsedByOwner: string[];
  events: ExplorationEvent[];
};

export type ExplorationState = {
  version: 1;
  contacts: Record<string, ExplorationContact>;
  highestScoresByOwner: Record<string, number>;
  completed: ExplorationEvent[];
  /** Player accepted contacts; not a separate localStorage or demo Operations row. */
  acceptedContactIds?: string[];
  /** Immutable outcomes of real spy-probe flights, including unsuccessful reconnaissance. */
  reconReports?: ExplorationReconRecord[];
};

export function createExplorationState(): ExplorationState {
  return { version: 1, contacts: {}, highestScoresByOwner: {}, completed: [], acceptedContactIds: [], reconReports: [] };
}

const RESOURCES = ['metal', 'minerals', 'gas', 'debris'] as const;

export function recordHighestExplorationScore(state: ExplorationState, ownerId: string, score: number): ExplorationState {
  if (!ownerId || !Number.isFinite(score) || score < 0) return state;
  const highest = Math.max(0, state.highestScoresByOwner[ownerId] ?? 0, score);
  if (highest === state.highestScoresByOwner[ownerId]) return state;
  return { ...state, highestScoresByOwner: { ...state.highestScoresByOwner, [ownerId]: highest } };
}

export function launchExplorationScore(state: ExplorationState, ownerId: string, currentResourceScore: number): number {
  return Math.max(0, currentResourceScore, state.highestScoresByOwner[ownerId] ?? 0);
}

/**
 * One immutable shared reserve per cycle. The caller must snapshot genuine world
 * scores when the object is first observed, never recompute on ownership change.
 * The existing universe schedule is the only authority for appearance/expiry.
 */
export function materializeExplorationContact(node: UniversePlanetNode, worldScoreAtAppearance: number): ExplorationContact {
  const id = explorationNodeId(node);
  if (!id || (node.kind !== 'unique' && node.kind !== 'anomaly') || !node.special?.startAt) throw new Error('Not a canonical exploration contact');
  const variant = node.special.profileVariant
    ?? profileVariantForArt(node.kind, 0);
  const profile = explorationProfile(node.kind, variant);
  const reserve = emptyExplorationCargo();
  const lifeMin = Math.max(0, node.special.expiresAt - node.special.startAt) / 60_000;
  const total = Math.round(explorationBaseRate(worldScoreAtAppearance, profile) * lifeMin * 1.5);
  let allocated = 0;
  for (const key of RESOURCES) {
    if (!profile.weights[key]) continue;
    const amount = Math.floor(total * profile.weights[key]! / 100);
    reserve[key] = amount;
    allocated += amount;
  }
  const first = RESOURCES.find(key => (profile.weights[key] ?? 0) > 0)!;
  reserve[first] += total - allocated;
  return {
    id, kind: node.kind, coordinate: { ...node.coordinate },
    variant, appearedAt: node.special.startAt, expiresAt: node.special.expiresAt,
    worldScoreAtAppearance, initialReserve: { ...reserve },
    resourceReserve: reserve, extractedByType: emptyExplorationCargo(),
    rareUsedByOwner: [], events: [],
  };
}

export function getOrMaterializeExplorationContact(
  state: ExplorationState,
  node: UniversePlanetNode,
  worldScoreAtAppearance: number,
): { state: ExplorationState; contact: ExplorationContact } {
  const id = explorationNodeId(node);
  if (!id) throw new Error('Missing canonical contact ID');
  const existing = state.contacts[id];
  if (existing) return { state, contact: existing };
  const contact = materializeExplorationContact(node, worldScoreAtAppearance);
  return { state: { ...state, contacts: { ...state.contacts, [id]: contact } }, contact };
}

export type ExplorationArrival = {
  claimId: string;
  ownerId: string;
  originPlanetId: string;
  flightId: string;
  arrivedAt: number;
  capacity: MiningCapacity;
  resourcePointsLaunch: number;
  catchupMultiplier: number;
};

export function occupyExplorationContact(contact: ExplorationContact, arrival: ExplorationArrival): ExplorationContact {
  if (contact.claim || arrival.arrivedAt < contact.appearedAt || arrival.arrivedAt >= contact.expiresAt) {
    throw new Error('Contact occupied or expired at arrival');
  }
  if (!arrival.ownerId || !arrival.originPlanetId || !arrival.flightId || !arrival.claimId) throw new Error('Invalid mission identity');
  const claim: ExplorationClaim = {
    ...arrival,
    startedAt: arrival.arrivedAt,
    lastAccruedAt: arrival.arrivedAt,
    heldMs: 0,
    cargo: emptyExplorationCargo(),
    fractionalMs: emptyExplorationCargo(),
    cargoCapacity: Math.max(0, Math.floor(arrival.capacity.all)),
    capacity: { ...arrival.capacity },
  };
  const event: ExplorationEvent = { id: arrival.flightId + ':occupy', kind: 'arrived', at: arrival.arrivedAt, ownerId: arrival.ownerId, flightId: arrival.flightId };
  return { ...contact, claim, events: [...contact.events, event].slice(-100) };
}

export function reconcileExplorationContact(contact: ExplorationContact, nowMs: number): ExplorationContact {
  const claim = contact.claim;
  if (!claim) return contact;
  const end = Math.min(Math.max(claim.lastAccruedAt, nowMs), contact.expiresAt, claim.pendingRecallAt ?? Infinity);
  if (end <= claim.lastAccruedAt) return contact;
  const profile = explorationProfile(contact.kind, contact.variant);
  const nextClaim = { ...claim, cargo: { ...claim.cargo }, fractionalMs: { ...claim.fractionalMs } };
  let reserve = { ...contact.resourceReserve };
  let cursor = claim.lastAccruedAt;
  const boostedUntilAt = claim.boostedUntilAt ?? Number.NEGATIVE_INFINITY;
  while (cursor < end) {
    const nextBoundary = boostedUntilAt > cursor ? Math.min(end, boostedUntilAt) : end;
    const rates = explorationMiningRates(claim.resourcePointsLaunch, profile, claim.capacity,
      claim.catchupMultiplier, cursor < boostedUntilAt);
    const accrued = accumulateExplorationCargo(nextClaim.cargo, reserve, rates,
      nextBoundary - cursor, nextClaim.fractionalMs, claim.cargoCapacity);
    nextClaim.cargo = accrued.cargo;
    nextClaim.fractionalMs = accrued.remainder;
    reserve = accrued.reserve;
    cursor = nextBoundary;
  }
  nextClaim.lastAccruedAt = end;
  nextClaim.heldMs += end - claim.lastAccruedAt;
  const extracted = { ...contact.extractedByType };
  for (const key of RESOURCES) extracted[key] += contact.resourceReserve[key] - reserve[key];
  return { ...contact, claim: nextClaim, resourceReserve: reserve, extractedByType: extracted };
}

export function prepareExplorationRecall(contact: ExplorationContact, ownerId: string, nowMs: number): ExplorationContact {
  const settled = reconcileExplorationContact(contact, nowMs);
  if (!settled.claim || settled.claim.ownerId !== ownerId || settled.claim.pendingRecallAt !== undefined) throw new Error('Cannot recall claim');
  if (nowMs >= settled.expiresAt) return settled;
  return { ...settled, claim: { ...settled.claim, pendingRecallAt: nowMs } };
}

export function isExplorationRecallReady(contact: ExplorationContact, nowMs: number): boolean {
  const pending = contact.claim?.pendingRecallAt;
  return !!contact.claim && (nowMs >= contact.expiresAt
    || pending !== undefined && nowMs >= pending + EXPLORATION_RULES.recallPreparationMs);
}

/** Emits one cargo-bearing event. The flight layer starts the canonical return trip. */
export function releaseExplorationClaim(contact: ExplorationContact, nowMs: number): ExplorationContact {
  const settled = reconcileExplorationContact(contact, nowMs);
  const claim = settled.claim;
  if (!claim || !isExplorationRecallReady(settled, nowMs)) throw new Error('Return preparation not complete');
  const expired = nowMs >= settled.expiresAt;
  const at = expired ? settled.expiresAt : (claim.pendingRecallAt! + EXPLORATION_RULES.recallPreparationMs);
  const event: ExplorationEvent = {
    id: claim.flightId + ':release', at, kind: expired ? 'expired' : 'recalled',
    ownerId: claim.ownerId, flightId: claim.flightId, cargo: { ...claim.cargo },
    heldMs: claim.heldMs, claimId: claim.claimId, originPlanetId: claim.originPlanetId,
  };
  return { ...settled, claim: undefined, events: [...settled.events, event].slice(-100) };
}

/**
 * Takes combat outcome/survivors from the existing resolver, never calculates
 * artificial combat strengths. Attacker arrival must be verified by flight layer.
 */
export function settleExplorationContest(
  contact: ExplorationContact,
  at: number,
  winner: 'attacker' | 'defender' | 'draw',
  attacker: ExplorationArrival,
  attackerSurvivorCargoCapacity: number,
  defenderSurvivorCapacity: MiningCapacity,
  eligibleDefense: boolean,
): { contact: ExplorationContact; captured: TransportCargo; destroyed: TransportCargo } {
  if (!contact.claim || at >= contact.expiresAt || at < contact.appearedAt) throw new Error('No contestable live occupancy');
  if (contact.claim.pendingRecallAt !== undefined
    && at >= contact.claim.pendingRecallAt + EXPLORATION_RULES.recallPreparationMs) {
    throw new Error('Fleet has already started returning');
  }
  const settled = reconcileExplorationContact(contact, at);
  const defender = settled.claim!;
  if (defender.ownerId === attacker.ownerId) throw new Error('Cannot attack own contact');
  const nothing = emptyExplorationCargo();
  if (winner === 'attacker') {
    const loss = captureExplorationCargo(defender.cargo, attackerSurvivorCargoCapacity);
    const fresh = occupyExplorationContact({ ...settled, claim: undefined }, attacker);
    const newClaim = fresh.claim!;
    newClaim.cargo = loss.captured;
    newClaim.capacity = { ...attacker.capacity, all: Math.max(0, attackerSurvivorCargoCapacity) };
    newClaim.cargoCapacity = Math.max(0, Math.floor(attackerSurvivorCargoCapacity));
    const event: ExplorationEvent = { id: attacker.flightId + ':capture', at, kind: 'captured',
      ownerId: attacker.ownerId, flightId: attacker.flightId, cargo: loss.captured, lostCargo: loss.destroyed };
    return { contact: { ...fresh, claim: newClaim, events: [...fresh.events, event].slice(-100) },
      captured: loss.captured, destroyed: loss.destroyed };
  }
  // Surviving defender composition changes cargo capacity and mining power.
  const surviving = { ...defender, capacity: { ...defenderSurvivorCapacity },
    cargoCapacity: Math.max(0, Math.floor(defenderSurvivorCapacity.all)) };
  const lostCargo = emptyExplorationCargo();
  let overflow = Math.max(0, RESOURCES.reduce((sum, key) => sum + surviving.cargo[key], 0) - surviving.cargoCapacity);
  for (const key of [...RESOURCES].reverse()) {
    const removed = Math.min(surviving.cargo[key], overflow);
    surviving.cargo[key] -= removed;
    lostCargo[key] = removed;
    overflow -= removed;
  }
  // Cargo lost to battle is not restored to finite reserve.
  if (winner === 'defender' && eligibleDefense && !surviving.defenseBoostConsumed) {
    surviving.defenseBoostConsumed = true;
    surviving.boostedUntilAt = Math.min(contact.expiresAt, at + EXPLORATION_RULES.defenseBoostMs);
  }
  const event: ExplorationEvent = { id: attacker.flightId + ':contest', at,
    kind: winner === 'draw' ? 'draw' : 'defended', ownerId: defender.ownerId, flightId: defender.flightId, lostCargo };
  return { contact: { ...settled, claim: surviving, events: [...settled.events, event].slice(-100) },
    captured: nothing, destroyed: lostCargo };
}

/**
 * Called ONLY once by the canonical returning flight on successful landing.
 * This is an escrow receipt, NOT a planet-wallet mutation: the application
 * must credit cargo/tokens in the same SaveState transaction as this event.
 */
export function completeExplorationReturn(
  contact: ExplorationContact,
  flightId: string,
  returnedAt: number,
  originExists: boolean,
): { contact: ExplorationContact; payout: { originPlanetId: string; cargo: TransportCargo; repairTokens: number } | null } {
  const id = flightId + ':completed';
  if (contact.events.some(event => event.id === id)) return { contact, payout: null };
  const release = contact.events.find(event => event.id === flightId + ':release');
  if (!release || !release.cargo || !release.claimId || !release.originPlanetId
    || !Number.isFinite(returnedAt) || returnedAt < release.at) throw new Error('No returned and released expedition');
  const rareEligible = originExists && (release.heldMs ?? 0) >= 60_000
    && !contact.rareUsedByOwner.includes(release.ownerId);
  const tokenWon = rareEligible && explorationRareWon(explorationProfile(contact.kind, contact.variant),
    release.heldMs!, contact.id, release.ownerId, release.claimId);
  const event: ExplorationEvent = {
    id, at: returnedAt, ownerId: release.ownerId, flightId,
    kind: originExists ? 'returned' : 'origin-destroyed',
    cargo: originExists ? { ...release.cargo } : emptyExplorationCargo(),
    originPlanetId: release.originPlanetId, claimId: release.claimId,
    heldMs: release.heldMs, repairTokens: tokenWon ? 1 : 0,
  };
  const rareUsedByOwner = rareEligible
    ? [...contact.rareUsedByOwner, release.ownerId].slice(-64) : contact.rareUsedByOwner;
  return {
    contact: { ...contact, rareUsedByOwner, events: [...contact.events, event].slice(-100) },
    payout: originExists ? { originPlanetId: release.originPlanetId,
      cargo: { ...release.cargo }, repairTokens: tokenWon ? 1 : 0 } : null,
  };
}

export function acceptExplorationOperation(state: ExplorationState, contactId: string): ExplorationState {
  if (!isExplorationContactId(contactId) || state.acceptedContactIds?.includes(contactId)) return state;
  return { ...state, acceptedContactIds: [...(state.acceptedContactIds ?? []), contactId].slice(-256) };
}

export function cancelExplorationOperation(state: ExplorationState, contactId: string): ExplorationState {
  if (!state.acceptedContactIds?.includes(contactId)) return state;
  return { ...state, acceptedContactIds: state.acceptedContactIds.filter(id => id !== contactId) };
}

export type ExplorationReconRecord = {
  id: string;
  contactId: string;
  ownerId: string;
  flightId: string;
  resolvedAt: number;
  success: boolean;
};

export function resolveExplorationRecon(
  contact: ExplorationContact,
  ownerId: string,
  flightId: string,
  landedAt: number,
  past: readonly ExplorationReconRecord[],
): ExplorationReconRecord {
  if (landedAt >= contact.expiresAt || landedAt < contact.appearedAt) throw new Error('Expired recon target');
  const duplicate = past.find(r => r.flightId === flightId);
  if (duplicate) return duplicate;
  const last = past.filter(r => r.contactId === contact.id && r.ownerId === ownerId).at(-1);
  if (last && landedAt - last.resolvedAt < EXPLORATION_RULES.reconCooldownMs) throw new Error('Recon cooldown');
  const success = explorationSeedRoll(contact.id, ownerId, flightId, 'recon') < EXPLORATION_RULES.reconSuccess;
  return { id: flightId + ':recon', contactId: contact.id, ownerId, flightId, resolvedAt: landedAt, success };
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validCargo(value: unknown): value is TransportCargo {
  if (!value || typeof value !== 'object') return false;
  const cargo = value as Record<string, unknown>;
  return RESOURCES.every(key => validNumber(cargo[key]));
}

/** Strict migration: untrusted corrupt entries are dropped instead of minted into loot. */
export function migrateExplorationState(value: unknown): ExplorationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createExplorationState();
  const source = value as Partial<ExplorationState>;
  if (source.version !== 1 || !source.contacts || typeof source.contacts !== 'object') return createExplorationState();
  const contacts: Record<string, ExplorationContact> = {};
  for (const [id, raw] of Object.entries(source.contacts).slice(-256)) {
    if (!raw || !id || !['unique', 'anomaly'].includes(raw.kind)
      || !validNumber(raw.appearedAt) || !validNumber(raw.expiresAt)
      || raw.expiresAt <= raw.appearedAt || raw.expiresAt - raw.appearedAt > 1_200_000
      || !validCargo(raw.initialReserve) || !validCargo(raw.resourceReserve)
      || !validCargo(raw.extractedByType)
      || !raw.coordinate || !validNumber(raw.coordinate.galaxy)
      || !validNumber(raw.coordinate.system) || !validNumber(raw.coordinate.position)
      || !validNumber(raw.variant)) continue;
    try {
      explorationProfile(raw.kind, raw.variant);
      const [kind, galaxy, system, cycle, appeared] = id.split(':');
      if (kind !== raw.kind || Number(galaxy) !== raw.coordinate.galaxy
        || Number(system) !== raw.coordinate.system || Number(appeared) !== raw.appearedAt
        || !/^\d+$/.test(cycle ?? '')
        || explorationContactId({ kind: raw.kind, coordinate: raw.coordinate,
          cycleIndex: Number(cycle), startAt: raw.appearedAt }) !== id) continue;
      if (RESOURCES.some(k => raw.initialReserve[k] !== raw.resourceReserve[k] + raw.extractedByType[k])) continue;
      // A corrupt active claim is dropped; never create cargo from invalid persisted state.
      const claim = raw.claim && validCargo(raw.claim.cargo) && validCargo(raw.claim.fractionalMs)
        && validNumber(raw.claim.startedAt) && validNumber(raw.claim.lastAccruedAt)
        && raw.claim.lastAccruedAt >= raw.claim.startedAt
        && raw.claim.startedAt >= raw.appearedAt && raw.claim.startedAt < raw.expiresAt
        && typeof raw.claim.ownerId === 'string' && typeof raw.claim.flightId === 'string'
        && typeof raw.claim.originPlanetId === 'string' && typeof raw.claim.claimId === 'string'
        && validNumber(raw.claim.cargoCapacity) && validNumber(raw.claim.heldMs)
        && validNumber(raw.claim.resourcePointsLaunch) && Number.isFinite(raw.claim.catchupMultiplier)
        && raw.claim.capacity && Number.isFinite(raw.claim.capacity.all)
        ? { ...raw.claim } : undefined;
      contacts[id] = { ...raw, id, claim,
        worldScoreAtAppearance: validNumber(raw.worldScoreAtAppearance) ? raw.worldScoreAtAppearance : 0,
        rareUsedByOwner: Array.isArray(raw.rareUsedByOwner) ? raw.rareUsedByOwner.filter(v => typeof v === 'string').slice(-64) : [],
        events: Array.isArray(raw.events) ? raw.events.slice(-100) : [] };
    } catch { /* invalid profile or identity */ }
  }
  const highestScoresByOwner: Record<string, number> = {};
  for (const [id, score] of Object.entries(source.highestScoresByOwner ?? {}).slice(-256)) {
    if (id && validNumber(score)) highestScoresByOwner[id] = score;
  }
  const acceptedContactIds = Array.isArray(source.acceptedContactIds)
    ? source.acceptedContactIds.filter((id): id is string => typeof id === 'string' && isExplorationContactId(id)).slice(-256)
    : [];
  const reconReports = Array.isArray(source.reconReports)
    ? source.reconReports.filter((record): record is ExplorationReconRecord =>
      Boolean(record && isExplorationContactId(record.contactId)
        && typeof record.id === 'string' && typeof record.ownerId === 'string'
        && typeof record.flightId === 'string' && validNumber(record.resolvedAt)
        && typeof record.success === 'boolean' && record.id === record.flightId + ':recon')).slice(-256)
    : [];
  return { version: 1, contacts, highestScoresByOwner,
    acceptedContactIds, reconReports,
    completed: Array.isArray(source.completed) ? source.completed.slice(-200) : [] };
}
