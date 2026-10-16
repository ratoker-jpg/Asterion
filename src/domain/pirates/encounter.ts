import { resolveCombat } from '../combat/resolver.ts';
import { COMMANDER_IDS, type CommanderId } from '../combat/commanders.ts';
import { getCombatFactionName, isCombatFactionId, type CombatFactionId } from '../combat/factions.ts';
import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { ShipId } from '../combat/ids.ts';
import {
  calculateStacksPopulation,
  type CombatInput,
  type CombatStackInput,
  type SimulatorMaxRounds,
} from '../combat/simulator.ts';
import type { BattleParticipant, BattleReport } from '../combat/report.ts';
import type { AttackLaunchSnapshot } from '../attack/types.ts';
import {
  PIRATE_CATALOG,
  type PirateShipId,
} from './catalog.ts';
import {
  calculatePirateEliminationPopulationBudget,
  type PiratePopulationBudget,
  type PirateProfile,
} from './profile.ts';

export const PIRATE_ELIMINATION_NO_TARGET_MESSAGE = 'По указанным координатам планеты пиратов не обнаружено';

export type PirateEliminationAttacker = Readonly<{
  playerId: string;
  playerName: string;
  planetName?: string;
  coordinates?: string;
  /** Full selected flight payload; support ships are filtered through the faction catalog. */
  selectedShips: Readonly<Partial<Record<ShipId, number>>>;
  selectedCommanders: Readonly<Partial<Record<CommanderId, number>>>;
  /** Values captured at dispatch. Never reread levels or science from the live save on arrival. */
  snapshot: AttackLaunchSnapshot;
}>;

export type PirateEliminationEncounterInput = Readonly<{
  reportId: string;
  timestamp: string;
  seed: string;
  contactCycleKey: string;
  /** The persisted owner-and-cycle profile selected at dispatch. */
  pirateProfile: PirateProfile | null;
  /** Dispatch-time immutable population roll; old flight records omit it. */
  populationBudget?: PiratePopulationBudget;
  attacker: PirateEliminationAttacker;
  piratePlanetName?: string;
  pirateCoordinates?: string;
}>;

export type PirateEliminationEncounterResult =
  | Readonly<{
      kind: 'no-target';
      reason: 'missing-profile' | 'stale-contact-cycle';
      message: typeof PIRATE_ELIMINATION_NO_TARGET_MESSAGE;
    }>
  | Readonly<{
      kind: 'rejected';
      reason: 'owner-profile-mismatch' | 'invalid-attacker-snapshot' | 'invalid-pirate-profile' | 'zero-garrison-budget';
      sentCombatPopulation: number;
      populationBudget?: PiratePopulationBudget;
    }>
  | Readonly<{
      kind: 'resolved';
      report: BattleReport;
      /** Immutable input passed through the shared resolver. */
      combatInput: CombatInput;
      pirateProfile: PirateProfile;
      pirateGarrison: Readonly<Record<PirateShipId, number>>;
      sentCombatPopulation: number;
      populationBudget: PiratePopulationBudget;
      victory: boolean;
    }>;

function frozenProfile(profile: PirateProfile): PirateProfile {
  return Object.freeze({
    ...profile,
    score: Object.freeze({ ...profile.score }),
    technologies: Object.freeze({ ...profile.technologies }),
    expectedTierShares: Object.freeze({ ...profile.expectedTierShares }),
    sampledTierShares: Object.freeze({ ...profile.sampledTierShares }),
    shares: Object.freeze({ ...profile.shares }),
  });
}

function validCount(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}

function selectedCombatShips(
  factionId: CombatFactionId,
  selected: Readonly<Partial<Record<ShipId, number>>>,
  levels: AttackLaunchSnapshot['attackerShipLevels'],
): CombatStackInput[] | null {
  const catalog = getFactionShipCatalog(factionId);
  const combatShips = catalog.filter((entity) => entity.kind === 'ship' && entity.category === 'Боевой корабль');
  const result: CombatStackInput[] = [];
  for (const entity of combatShips) {
    const id = entity.id as ShipId;
    const count = selected[id];
    if (!validCount(count)) return null;
    if (!count) continue;
    const level = levels[id] ?? 0;
    if (!Number.isSafeInteger(level) || level < 0) return null;
    result.push({ entityId: id, count, level });
  }
  return result;
}

function selectedCombatCommanders(
  selected: Readonly<Partial<Record<CommanderId, number>>>,
  levels: AttackLaunchSnapshot['attackerCommanderLevels'],
  priority: readonly CommanderId[],
): CombatStackInput[] | null {
  const result: CombatStackInput[] = [];
  for (const id of COMMANDER_IDS) {
    const count = selected[id];
    if (!validCount(count)) return null;
    if (!count) continue;
    const level = levels[id] ?? 0;
    if (!Number.isSafeInteger(level) || level < 0) return null;
    result.push({ entityId: id, count, level });
  }
  const rank = (id: string) => {
    const index = priority.indexOf(id as CommanderId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return result.sort((left, right) => rank(left.entityId) - rank(right.entityId));
}

function immutableCombatInput(input: CombatInput): CombatInput {
  const freezeSide = (side: CombatInput['attacker']) => Object.freeze({
    ...side,
    participant: Object.freeze({ ...side.participant }),
    ships: Object.freeze(side.ships.map((stack) => Object.freeze({ ...stack }))),
    commanders: Object.freeze((side.commanders ?? []).map((stack) => Object.freeze({ ...stack }))),
    commander: side.commander ? Object.freeze({ ...side.commander }) : null,
    ...(side.defenses ? { defenses: Object.freeze(side.defenses.map((stack) => Object.freeze({ ...stack }))) } : {}),
  });
  return Object.freeze({
    ...input,
    attacker: freezeSide(input.attacker),
    defender: freezeSide(input.defender),
    attackerPriority: Object.freeze([...input.attackerPriority]),
    defenderPriority: Object.freeze([...input.defenderPriority]),
    attackerTechnologies: Object.freeze({ ...input.attackerTechnologies }),
    defenderTechnologies: Object.freeze({ ...input.defenderTechnologies }),
  }) as unknown as CombatInput;
}

function pirateParticipant(input: PirateEliminationEncounterInput): BattleParticipant {
  return Object.freeze({
    playerName: 'Пираты',
    ...(input.piratePlanetName ? { planetName: input.piratePlanetName } : {}),
    ...(input.pirateCoordinates ? { coordinates: input.pirateCoordinates } : {}),
    race: 'pirates',
    side: 'defender',
  });
}

/**
 * Materialize one full, fresh pirate garrison and resolve it through the
 * standard combat engine. Contact existence and the owner profile are fixed
 * at dispatch; an old flight cannot silently attach to a later cycle.
 */
export function resolvePirateEliminationEncounter(
  input: PirateEliminationEncounterInput,
): PirateEliminationEncounterResult {
  const profile = input.pirateProfile;
  if (!profile) {
    return Object.freeze({
      kind: 'no-target',
      reason: 'missing-profile',
      message: PIRATE_ELIMINATION_NO_TARGET_MESSAGE,
    });
  }
  if (profile.ownerId !== input.attacker.playerId) {
    return Object.freeze({ kind: 'rejected', reason: 'owner-profile-mismatch', sentCombatPopulation: 0 });
  }
  if (profile.contactCycleKey !== input.contactCycleKey) {
    return Object.freeze({
      kind: 'no-target',
      reason: 'stale-contact-cycle',
      message: PIRATE_ELIMINATION_NO_TARGET_MESSAGE,
    });
  }
  if (!input.contactCycleKey.trim()
    || !input.reportId.trim()
    || !input.seed.trim()
    || !Number.isFinite(Date.parse(input.timestamp))
    || !input.attacker.playerId.trim()
    || !input.attacker.playerName.trim()
    || ![5, 8, 12].includes(input.attacker.snapshot.maxRounds)
    || !isCombatFactionId(input.attacker.snapshot.attackerFactionId)) {
    return Object.freeze({ kind: 'rejected', reason: 'invalid-attacker-snapshot', sentCombatPopulation: 0 });
  }

  const snapshot = input.attacker.snapshot;
  const attackerShips = selectedCombatShips(
    snapshot.attackerFactionId,
    input.attacker.selectedShips,
    snapshot.attackerShipLevels,
  );
  const attackerCommanders = selectedCombatCommanders(
    input.attacker.selectedCommanders,
    snapshot.attackerCommanderLevels,
    snapshot.attackerPriority,
  );
  if (!attackerShips || !attackerCommanders) {
    return Object.freeze({ kind: 'rejected', reason: 'invalid-attacker-snapshot', sentCombatPopulation: 0 });
  }

  const sentCombatPopulation = calculateStacksPopulation(
    [...attackerShips, ...attackerCommanders],
    snapshot.attackerFactionId,
  );
  let populationBudget: PiratePopulationBudget;
  try {
    populationBudget = input.populationBudget
      ?? calculatePirateEliminationPopulationBudget(Math.round(sentCombatPopulation), profile.shares);
    if (populationBudget.coefficient !== undefined && populationBudget.actualPopulation > populationBudget.targetPopulation
      || Object.entries(populationBudget.ships).some(([shipId, count]) =>
        !PIRATE_CATALOG.some((ship) => ship.id === shipId)
        || !Number.isSafeInteger(count) || count < 0)
      || Object.entries(populationBudget.ships).reduce((sum, [shipId, count]) =>
        sum + (PIRATE_CATALOG.find((ship) => ship.id === shipId)?.population ?? 0) * count, 0) !== populationBudget.actualPopulation
    ) throw new Error('Invalid immutable garrison snapshot');
  } catch {
    return Object.freeze({ kind: 'rejected', reason: 'invalid-pirate-profile', sentCombatPopulation });
  }
  const pirateGarrison = Object.freeze(Object.fromEntries(PIRATE_CATALOG.filter((ship) => ship.tier !== 'special' || (populationBudget.ships[ship.id] ?? 0) > 0).map((ship) => [
    ship.id,
    populationBudget.ships[ship.id] ?? 0,
  ])) as Record<PirateShipId, number>);
  if (populationBudget.actualPopulation <= 0
    || !PIRATE_CATALOG.some((ship) => pirateGarrison[ship.id] > 0)) {
    return Object.freeze({
      kind: 'rejected',
      reason: 'zero-garrison-budget',
      sentCombatPopulation,
      populationBudget,
    });
  }

  const pirateSnapshot = frozenProfile(profile);
  const attackerParticipant: BattleParticipant = Object.freeze({
    playerId: input.attacker.playerId,
    playerName: input.attacker.playerName,
    ...(input.attacker.planetName ? { planetName: input.attacker.planetName } : {}),
    ...(input.attacker.coordinates ? { coordinates: input.attacker.coordinates } : {}),
    race: getCombatFactionName(snapshot.attackerFactionId),
    side: 'attacker',
  });
  const allPirateStacks: CombatStackInput[] = PIRATE_CATALOG.filter((ship) => ship.tier !== 'special' || pirateGarrison[ship.id] > 0).map((ship) => ({
    entityId: ship.id,
    count: pirateGarrison[ship.id],
    level: pirateSnapshot.shipLevel,
  }));
  const activeCommanderId = snapshot.attackerPriority.find((id) => attackerCommanders.some((stack) => stack.entityId === id)) ?? null;
  const combatInput = immutableCombatInput({
    scenarioId: input.reportId,
    timestamp: input.timestamp,
    attacker: {
      participant: attackerParticipant,
      factionId: snapshot.attackerFactionId,
      ships: attackerShips,
      commanders: attackerCommanders,
      commander: attackerCommanders[0] ?? null,
      activeCommanderId,
    },
    defender: {
      participant: pirateParticipant(input),
      combatProfile: Object.freeze({ kind: 'pirate' as const, snapshot: pirateSnapshot }),
      ships: allPirateStacks,
      commanders: [],
      commander: null,
      activeCommanderId: null,
    },
    maxRounds: snapshot.maxRounds as SimulatorMaxRounds,
    attackerPriority: [...snapshot.attackerPriority],
    defenderPriority: [],
    attackerTechnologies: { ...snapshot.attackerTechnologies },
    defenderTechnologies: { ...pirateSnapshot.technologies },
    technologyMode: 'independent',
    executionMode: 'production',
    seed: input.seed,
    profileId: 'asterion-pirate-elimination-v1',
  });
  const report = resolveCombat(combatInput, { reportId: input.reportId, missionType: 'pirate-elimination' });
  const victory = report.winner === 'attacker' && report.defenderForce.populationAfter === 0;

  return Object.freeze({
    kind: 'resolved',
    report,
    combatInput,
    pirateProfile: pirateSnapshot,
    pirateGarrison,
    sentCombatPopulation,
    populationBudget,
    victory,
  });
}
