import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import { DEFAULT_COMBAT_PRIORITY } from '../combat/priority.ts';
import { getCombatMatchupMultiplier, resolveCombat, type CombatMatchupClass } from '../combat/resolver.ts';
import type { BattleReport } from '../combat/report.ts';
import type { CombatInput, CombatStackInput } from '../combat/simulator.ts';
import { COMBAT_FACTION_IDS, type CombatFactionId } from '../combat/factions.ts';
import { COMBAT_TECHNOLOGIES, createDefaultCombatTechnologies } from '../combat/technologies.ts';
import type { CombatOrdinaryClass } from '../combat/types.ts';
import { PIRATE_BASE_SHIPS, PIRATE_CATALOG, PIRATE_CATALOG_BY_ID, type PirateBaseShipId, type PirateShipId } from './catalog.ts';
import {
  createPirateProfile,
  expectedPirateTierShares,
  pirateLevelForResourcePoints,
  pirateTechnologyLevelForResourcePoints,
  type PirateProfile,
  type PirateTierShares,
} from './profile.ts';

export const PIRATE_BALANCE_SEED_CORPUS = Object.freeze({
  version: 'asterion-pirate-combat-v1',
  prefix: 'pirate-combat-v1',
  runIndexEncoding: 'base-10, zero-padded to 4 digits',
  scenarioEncoding: '[faction, score band, attacker tech band, fleet formation, run index]',
});

export const PIRATE_BALANCE_SCORE_BANDS = Object.freeze([
  { id: 'low', totalPoints: 1_000, resourcePoints: 1_000, battlePoints: 0 },
  { id: 'early', totalPoints: 10_000, resourcePoints: 10_000, battlePoints: 0 },
  { id: 'mid', totalPoints: 100_000, resourcePoints: 100_000, battlePoints: 0 },
  { id: 'advanced', totalPoints: 1_000_000, resourcePoints: 1_000_000, battlePoints: 0 },
  { id: 'high', totalPoints: 10_000_000, resourcePoints: 10_000_000, battlePoints: 0 },
] as const);

export const PIRATE_BALANCE_ATTACKER_TECH_BANDS = Object.freeze([0, 5, 10] as const);
export const PIRATE_BALANCE_POPULATION = 10_000;

const ORDINARY_CLASSES: readonly CombatOrdinaryClass[] = ['scout', 'cruiser', 'defender', 'battleship', 'destroyer', 'bomber'];
const FORMATIONS = ['mirror', 'counter', 'mixed'] as const;
const Z95 = 1.959963984540054;

export type PirateBalanceFormation = (typeof FORMATIONS)[number];
export type PirateBalanceMatchup = Readonly<{
  key: string;
  faction: CombatFactionId;
  scoreBand: string;
  totalPoints: number;
  pirateShipLevel: number;
  pirateTechnologyLevel: number;
  attackerTechnologyLevel: 0 | 5 | 10;
  formation: PirateBalanceFormation;
  runs: number;
  attackerWinRate: number;
  attackerWinRate95: readonly [number, number];
  defenderWinRate: number;
  defenderWinRate95: readonly [number, number];
  drawRate: number;
  drawRate95: readonly [number, number];
  attackerSurvivingPopulationMedian: number;
  attackerSurvivingPopulationRange: readonly [number, number];
  pirateSurvivingPopulationMedian: number;
  pirateSurvivingPopulationRange: readonly [number, number];
  meanRounds: number;
  pirateShipFrequency: Readonly<Partial<Record<PirateBaseShipId, number>>>;
  seedCorpus: Readonly<{ first: string; last: string }>;
}>;

export type PirateProfileSampling = Readonly<{
  faction: CombatFactionId;
  scoreBand: string;
  profiles: number;
  expectedTierShares: PirateTierShares;
  observedTierShares: PirateTierShares;
  tierShareConfidence95: Readonly<Record<1 | 2 | 3, readonly [number, number]>>;
  observedShipShares: Readonly<Partial<Record<PirateBaseShipId, number>>>;
}>;

export type PirateRipperCalibration = Readonly<{
  runs: number;
  capRippers: number;
  expectedChancePerEligibleRound: number;
  eligibleFirstRounds: number;
  firstRoundProcs: number;
  firstRoundProcRate: number;
  firstRoundProcRate95: readonly [number, number];
  maxProcsInAnyRound: number;
  selectedShipTypeCounts: Readonly<Partial<Record<PirateBaseShipId, number>>>;
}>;

export type PirateLevelStat = Readonly<{
  shipId: PirateShipId;
  name: string;
  shipLevel: 0 | 5 | 10;
  technologyLevel: number;
  attackPerUnit: number;
  lifePerUnit: number;
  armorPercent: number;
}>;

export type PirateCatalogMedian = Readonly<{
  shipId: PirateShipId;
  name: string;
  sourceShipId: string;
  populationByFaction: Readonly<Record<CombatFactionId, number>>;
  attackByFaction: Readonly<Record<CombatFactionId, number>>;
  lifeByFaction: Readonly<Record<CombatFactionId, number>>;
  populationMedian: number;
  attackMedian: number;
  lifeMedian: number;
}>;

export type PirateCombatBalanceSimulation = Readonly<{
  seedCorpus: typeof PIRATE_BALANCE_SEED_CORPUS;
  runsPerMatchup: number;
  matchupCount: number;
  totalBattles: number;
  matchups: readonly PirateBalanceMatchup[];
  profileSampling: readonly PirateProfileSampling[];
  ripperCalibration: PirateRipperCalibration;
  levelStats: readonly PirateLevelStat[];
  catalogMedians: readonly PirateCatalogMedian[];
  classMatchups: readonly Readonly<{ attacker: CombatOrdinaryClass; defender: CombatOrdinaryClass; multiplier: number }>[];
}>;

type Accumulator = {
  wins: number;
  losses: number;
  draws: number;
  rounds: number;
  playerResidual: number[];
  pirateResidual: number[];
  shipCounts: Partial<Record<PirateBaseShipId, number>>;
  firstSeed: string;
  lastSeed: string;
};

function safeCount(value: number) { return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
function median(values: readonly number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function range(values: readonly number[]): readonly [number, number] {
  return values.length ? [Math.min(...values), Math.max(...values)] : [0, 0];
}
function wilson(successes: number, trials: number): readonly [number, number] {
  if (!trials) return [0, 0];
  const z2 = Z95 * Z95;
  const p = successes / trials;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const radius = Z95 * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials) / denominator;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}
function sourceShip(faction: CombatFactionId, id: string) {
  const entity = getFactionShipCatalog(faction).find((candidate) => candidate.id === id);
  if (!entity) throw new Error(`Missing ${id} in ${faction} combat catalog`);
  return entity;
}
function makeTechnologies(level: number) {
  const technologies = createDefaultCombatTechnologies();
  for (const technology of COMBAT_TECHNOLOGIES) {
    // Keep exactly one of the three mutually exclusive technologies active.
    if (technology.id === 'maneuverDefense' || technology.id === 'criticalHit') continue;
    technologies[technology.id] = Math.min(technology.maxLevel, level);
  }
  return technologies;
}
function profileFor(faction: CombatFactionId, band: typeof PIRATE_BALANCE_SCORE_BANDS[number], run: number) {
  return createPirateProfile({
    ownerId: `balance-owner:${faction}:${band.id}`,
    contactCycleKey: `run-${run.toString().padStart(4, '0')}`,
    score: band,
  });
}
function pirateStacks(profile: PirateProfile): CombatStackInput[] {
  return Object.entries(profile.shares).flatMap(([rawId, share]) => {
    const id = rawId as PirateShipId;
    if (!share || id === 'pirate-planet-breaker') return [];
    const entity = PIRATE_CATALOG_BY_ID[id];
    return [{ entityId: id, count: Math.max(1, Math.round(PIRATE_BALANCE_POPULATION * share / 100 / entity.population)), level: profile.shipLevel }];
  });
}
function playerStacks(faction: CombatFactionId, formation: PirateBalanceFormation, pirateId: PirateBaseShipId, shipLevel: number): CombatStackInput[] {
  if (formation !== 'mixed') {
    const pirateClass = PIRATE_CATALOG_BY_ID[pirateId].ordinaryClass as CombatOrdinaryClass;
    const playerClass = formation === 'mirror' ? pirateClass : [...ORDINARY_CLASSES].sort((left, right) => (
      getCombatMatchupMultiplier(right, pirateClass as CombatMatchupClass)
      - getCombatMatchupMultiplier(left, pirateClass as CombatMatchupClass)
      || ORDINARY_CLASSES.indexOf(left) - ORDINARY_CLASSES.indexOf(right)
    ))[0]!;
    const entity = sourceShip(faction, playerClass);
    return [{ entityId: entity.id as CombatStackInput['entityId'], count: Math.max(1, Math.round(PIRATE_BALANCE_POPULATION / entity.population)), level: shipLevel }];
  }
  return ORDINARY_CLASSES.map((shipClass) => {
    const entity = sourceShip(faction, shipClass);
    return { entityId: entity.id as CombatStackInput['entityId'], count: Math.max(1, Math.round(PIRATE_BALANCE_POPULATION / ORDINARY_CLASSES.length / entity.population)), level: shipLevel };
  });
}
function battleInput(
  faction: CombatFactionId,
  profile: PirateProfile,
  ships: CombatStackInput[],
  technologyLevel: number,
  seed: string,
): CombatInput {
  const priority = DEFAULT_COMBAT_PRIORITY;
  return {
    scenarioId: seed,
    timestamp: '2026-01-01T00:00:00.000Z',
    attacker: {
      participant: { playerId: 'balance-player', playerName: 'Балансировочный флот', race: faction, side: 'attacker' },
      factionId: faction,
      ships,
      commanders: [],
      activeCommanderId: null,
    },
    defender: {
      participant: { playerId: profile.ownerId, playerName: 'Пираты', race: 'pirates', side: 'defender' },
      combatProfile: { kind: 'pirate', snapshot: profile },
      ships: pirateStacks(profile),
      commanders: [],
      activeCommanderId: null,
    },
    maxRounds: 8,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
    attackerTechnologies: makeTechnologies(technologyLevel),
    defenderTechnologies: profile.technologies,
    technologyMode: 'independent',
    executionMode: 'production',
    attackerTargetPriority: 'population',
    defenderTargetPriority: 'population',
    seed,
    profileId: 'asterion-pirate-combat-balance-v1',
  };
}
function recordBattle(acc: Accumulator, report: BattleReport) {
  if (report.winner === 'attacker') acc.wins += 1;
  else if (report.winner === 'defender') acc.losses += 1;
  else acc.draws += 1;
  acc.rounds += report.roundCount;
  acc.playerResidual.push(safeCount(report.attackerForce.populationAfter));
  acc.pirateResidual.push(safeCount(report.defenderForce.populationAfter));
}
function sampleProfiles(faction: CombatFactionId, band: typeof PIRATE_BALANCE_SCORE_BANDS[number], runs: number): PirateProfileSampling {
  const tierCount: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  const shipCount: Partial<Record<PirateBaseShipId, number>> = {};
  for (let run = 0; run < runs; run += 1) {
    const profile = profileFor(faction, band, run);
    tierCount[profile.tier] += 1;
    const selected = Object.entries(profile.shares).find(([, share]) => share === 100)?.[0] as PirateBaseShipId | undefined;
    if (selected) shipCount[selected] = (shipCount[selected] ?? 0) + 1;
  }
  const share = (tier: 1 | 2 | 3) => tierCount[tier] * 100 / runs;
  return {
    faction,
    scoreBand: band.id,
    profiles: runs,
    expectedTierShares: expectedPirateTierShares(band.totalPoints),
    observedTierShares: { 1: share(1), 2: share(2), 3: share(3) },
    tierShareConfidence95: { 1: wilson(tierCount[1], runs), 2: wilson(tierCount[2], runs), 3: wilson(tierCount[3], runs) },
    observedShipShares: Object.fromEntries(Object.entries(shipCount).map(([id, count]) => [id, count! * 100 / runs])) as Partial<Record<PirateBaseShipId, number>>,
  };
}

function calibrateRipperAbility(runs: number): PirateRipperCalibration {
  const profile = createPirateProfile({ ownerId: 'ripper-calibration', contactCycleKey: 'fixed', score: { resourcePoints: 0, battlePoints: 1_000, totalPoints: 1_000 } });
  const pirateFleet: CombatStackInput[] = [
    { entityId: 'pirate-hound', count: 1 }, { entityId: 'pirate-raider', count: 1 },
    { entityId: 'pirate-corsair', count: 1 }, { entityId: 'pirate-executioner', count: 1 },
    { entityId: 'pirate-butcher', count: 10 }, { entityId: 'pirate-bruiser', count: 1 },
  ];
  const selectedShipTypeCounts: Partial<Record<PirateBaseShipId, number>> = {};
  let eligibleFirstRounds = 0;
  let firstRoundProcs = 0;
  let maxProcsInAnyRound = 0;
  for (let run = 0; run < runs; run += 1) {
    const seed = `${PIRATE_BALANCE_SEED_CORPUS.prefix}:double-attack:${run.toString().padStart(4, '0')}`;
    const priority = DEFAULT_COMBAT_PRIORITY;
    const input: CombatInput = {
      scenarioId: seed,
      timestamp: '2026-01-01T00:00:00.000Z',
      attacker: {
        participant: { playerId: profile.ownerId, playerName: 'Пираты', race: 'pirates', side: 'attacker' },
        combatProfile: { kind: 'pirate', snapshot: profile },
        ships: pirateFleet,
        commanders: [],
        activeCommanderId: null,
      },
      defender: {
        participant: { playerId: 'calibration-target', playerName: 'Контрольный флот', race: 'aegis', side: 'defender' },
        factionId: 'aegis',
        ships: [{ entityId: 'death-star', count: 40 }],
        commanders: [],
        activeCommanderId: null,
      },
      maxRounds: 8,
      attackerPriority: [...priority.attack],
      defenderPriority: [...priority.defense],
      technologyMode: 'independent',
      executionMode: 'production',
      seed,
    };
    const report = resolveCombat(input, { reportId: `ripper-calibration-${run}` });
    const firstRound = report.rounds[0];
    if (!firstRound) continue;
    const stillHasTarget = report.defenderForce.stacks.some((stack) => stack.countAfter > 0);
    if (stillHasTarget) eligibleFirstRounds += 1;
    for (const round of report.rounds) {
      const procs = round.events.filter((event) => event.shipAbilityId === 'pirate-double-attack');
      maxProcsInAnyRound = Math.max(maxProcsInAnyRound, procs.length);
      if (round.index === 1 && stillHasTarget && procs.length > 0) {
        firstRoundProcs += 1;
        const selected = procs[0]?.targetEntityId;
        if (selected && selected !== 'pirate-planet-breaker') {
          const id = selected as PirateBaseShipId;
          selectedShipTypeCounts[id] = (selectedShipTypeCounts[id] ?? 0) + 1;
        }
      }
    }
  }
  return {
    runs,
    capRippers: 10,
    expectedChancePerEligibleRound: 0.05,
    eligibleFirstRounds,
    firstRoundProcs,
    firstRoundProcRate: eligibleFirstRounds ? firstRoundProcs / eligibleFirstRounds : 0,
    firstRoundProcRate95: wilson(firstRoundProcs, eligibleFirstRounds),
    maxProcsInAnyRound,
    selectedShipTypeCounts,
  };
}

function collectLevelStats(): PirateLevelStat[] {
  const rows: PirateLevelStat[] = [];
  const pointSamples = [{ level: 0, points: 0 }, { level: 5, points: 100_000 }, { level: 10, points: 3_000_000 }] as const;
  for (const sample of pointSamples) {
    const profile = createPirateProfile({
      ownerId: `pirate-level-${sample.level}`,
      contactCycleKey: 'snapshot',
      score: { totalPoints: sample.points, resourcePoints: sample.points, battlePoints: 0 },
    });
    for (const ship of PIRATE_CATALOG) {
      const report = resolveCombat({
        scenarioId: `level-${sample.level}-${ship.id}`,
        timestamp: '2026-01-01T00:00:00.000Z',
        attacker: {
          participant: { playerId: profile.ownerId, playerName: 'Пираты', race: 'pirates', side: 'attacker' },
          combatProfile: { kind: 'pirate', snapshot: profile },
          ships: [{ entityId: ship.id, count: 1, level: sample.level }],
          commanders: [],
          activeCommanderId: null,
        },
        defender: {
          participant: { playerId: 'level-target', playerName: 'Контрольный флот', race: 'aegis', side: 'defender' },
          factionId: 'aegis',
          ships: [{ entityId: 'death-star', count: 1 }],
          commanders: [],
          activeCommanderId: null,
        },
        maxRounds: 5,
        attackerPriority: [...DEFAULT_COMBAT_PRIORITY.attack],
        defenderPriority: [...DEFAULT_COMBAT_PRIORITY.defense],
        attackerTechnologies: profile.technologies,
        defenderTechnologies: createDefaultCombatTechnologies(),
        technologyMode: 'independent',
        seed: `pirate-level-snapshot:${sample.level}:${ship.id}`,
      }, { reportId: `pirate-level-snapshot-${sample.level}-${ship.id}` });
      const stack = report.attackerForce.stacks[0]!;
      rows.push({
        shipId: ship.id,
        name: ship.name,
        shipLevel: sample.level,
        technologyLevel: pirateTechnologyLevelForResourcePoints(sample.points),
        attackPerUnit: stack.attackPerUnit ?? 0,
        lifePerUnit: stack.lifePerUnit ?? 0,
        armorPercent: stack.armor ?? 0,
      });
    }
  }
  return rows;
}

function collectCatalogMedians(): PirateCatalogMedian[] {
  return PIRATE_CATALOG.map((pirate) => {
    const sources = Object.fromEntries(COMBAT_FACTION_IDS.map((faction) => [faction, sourceShip(faction, pirate.sourceId)])) as Record<CombatFactionId, ReturnType<typeof sourceShip>>;
    const med = (select: (faction: CombatFactionId) => number) => COMBAT_FACTION_IDS.map(select).sort((a, b) => a - b)[1]!;
    return {
      shipId: pirate.id,
      name: pirate.name,
      sourceShipId: pirate.sourceId,
      populationByFaction: Object.fromEntries(COMBAT_FACTION_IDS.map((faction) => [faction, sources[faction].population])) as Record<CombatFactionId, number>,
      attackByFaction: Object.fromEntries(COMBAT_FACTION_IDS.map((faction) => [faction, sources[faction].combat.attack])) as Record<CombatFactionId, number>,
      lifeByFaction: Object.fromEntries(COMBAT_FACTION_IDS.map((faction) => [faction, sources[faction].combat.life])) as Record<CombatFactionId, number>,
      populationMedian: med((faction) => sources[faction].population),
      attackMedian: med((faction) => sources[faction].combat.attack),
      lifeMedian: med((faction) => sources[faction].combat.life),
    };
  });
}

export function runPirateCombatBalanceSimulation(options: Readonly<{ runsPerMatchup?: number; doubleAttackRuns?: number }> = {}): PirateCombatBalanceSimulation {
  const runsPerMatchup = Math.max(1, Math.min(1_000, Math.floor(options.runsPerMatchup ?? 300)));
  const doubleAttackRuns = Math.max(100, Math.min(20_000, Math.floor(options.doubleAttackRuns ?? 2_000)));
  const matchups: PirateBalanceMatchup[] = [];
  const profileSampling: PirateProfileSampling[] = [];

  for (const faction of COMBAT_FACTION_IDS) {
    for (const band of PIRATE_BALANCE_SCORE_BANDS) {
      const profiles = Array.from({ length: runsPerMatchup }, (_, run) => profileFor(faction, band, run));
      profileSampling.push(sampleProfiles(faction, band, runsPerMatchup));
      for (const attackerTechnologyLevel of PIRATE_BALANCE_ATTACKER_TECH_BANDS) {
        for (const formation of FORMATIONS) {
          const acc: Accumulator = {
            wins: 0, losses: 0, draws: 0, rounds: 0, playerResidual: [], pirateResidual: [], shipCounts: {}, firstSeed: '', lastSeed: '',
          };
          const key = `${faction}/${band.id}/tech-${attackerTechnologyLevel}/${formation}`;
          for (let run = 0; run < runsPerMatchup; run += 1) {
            const profile = profiles[run]!;
            const selected = Object.entries(profile.shares).find(([, share]) => share === 100)?.[0] as PirateBaseShipId | undefined;
            if (!selected) throw new Error(`Profile ${profile.seed} has no base ship.`);
            const seed = `${PIRATE_BALANCE_SEED_CORPUS.prefix}:${key}:${run.toString().padStart(4, '0')}`;
            if (!acc.firstSeed) acc.firstSeed = seed;
            acc.lastSeed = seed;
            acc.shipCounts[selected] = (acc.shipCounts[selected] ?? 0) + 1;
            const report = resolveCombat(battleInput(
              faction,
              profile,
              playerStacks(faction, formation, selected, profile.shipLevel),
              attackerTechnologyLevel,
              seed,
            ), { reportId: seed });
            recordBattle(acc, report);
          }
          const runs = runsPerMatchup;
          matchups.push({
            key, faction, scoreBand: band.id, totalPoints: band.totalPoints,
            pirateShipLevel: pirateLevelForResourcePoints(band.resourcePoints),
            pirateTechnologyLevel: pirateTechnologyLevelForResourcePoints(band.resourcePoints),
            attackerTechnologyLevel, formation, runs,
            attackerWinRate: acc.wins / runs, attackerWinRate95: wilson(acc.wins, runs),
            defenderWinRate: acc.losses / runs, defenderWinRate95: wilson(acc.losses, runs),
            drawRate: acc.draws / runs, drawRate95: wilson(acc.draws, runs),
            attackerSurvivingPopulationMedian: median(acc.playerResidual),
            attackerSurvivingPopulationRange: range(acc.playerResidual),
            pirateSurvivingPopulationMedian: median(acc.pirateResidual),
            pirateSurvivingPopulationRange: range(acc.pirateResidual),
            meanRounds: acc.rounds / runs,
            pirateShipFrequency: Object.fromEntries(Object.entries(acc.shipCounts).map(([id, count]) => [id, count! / runs])) as Partial<Record<PirateBaseShipId, number>>,
            seedCorpus: { first: acc.firstSeed, last: acc.lastSeed },
          });
        }
      }
    }
  }

  return {
    seedCorpus: PIRATE_BALANCE_SEED_CORPUS,
    runsPerMatchup,
    matchupCount: matchups.length,
    totalBattles: matchups.reduce((sum, item) => sum + item.runs, 0),
    matchups,
    profileSampling,
    ripperCalibration: calibrateRipperAbility(doubleAttackRuns),
    levelStats: collectLevelStats(),
    catalogMedians: collectCatalogMedians(),
    classMatchups: ORDINARY_CLASSES.flatMap((attacker) => ORDINARY_CLASSES.map((defender) => ({
      attacker, defender, multiplier: getCombatMatchupMultiplier(attacker, defender),
    }))),
  };
}

function asPercent(value: number) { return `${(value * 100).toFixed(1)}%`; }
function asInterval(value: readonly [number, number]) { return `${asPercent(value[0])}–${asPercent(value[1])}`; }

export function pirateCombatBalanceMarkdown(result: PirateCombatBalanceSimulation) {
  const lines = [
    '# Pirate combat balance — PR1',
    '',
    `Generated ${result.totalBattles.toLocaleString('en-US')} seeded battles across ${result.matchupCount} matchups; ${result.runsPerMatchup} runs per matchup.`,
    `Seed corpus: \`${result.seedCorpus.version}\`; each battle seed includes faction, score band, attacker tech, formation, and run index.`,
    '',
    '## Scope and limits',
    '',
    'This run checks neutral pirate ship statistics, the shared six-class matchup table, score-profile sampling, and the once-per-round Ripper ability. It does not simulate contact frequency, travel, incoming raids, planet siege, or planet destruction; those belong to later PRs.',
    `Each side targets ${PIRATE_BALANCE_POPULATION.toLocaleString('en-US')} combat population. Integer ship counts can leave a small population difference. Player and pirate ship levels are matched to the score profile (0–10); player technology is independently checked at levels 0, 5, and 10.`,
    '',
    '## Profile tier sampling',
    '',
    '| Faction | Score band | Profiles | Expected T1/T2/T3 | Observed T1/T2/T3 | Wilson 95% intervals T1/T2/T3 |',
    '| --- | --- | ---: | --- | --- | --- |',
    ...result.profileSampling.map((sample) => {
      const fmt = (ci: readonly [number, number]) => `${asPercent(ci[0])}–${asPercent(ci[1])}`;
      const intervals = [sample.tierShareConfidence95[1], sample.tierShareConfidence95[2], sample.tierShareConfidence95[3]].map(fmt).join('; ');
      return `| ${sample.faction} | ${sample.scoreBand} | ${sample.profiles} | ${sample.expectedTierShares[1].toFixed(1)}/${sample.expectedTierShares[2].toFixed(1)}/${sample.expectedTierShares[3].toFixed(1)}% | ${sample.observedTierShares[1].toFixed(1)}/${sample.observedTierShares[2].toFixed(1)}/${sample.observedTierShares[3].toFixed(1)}% | ${intervals} |`;
    }),
    '',
    '### Observed pirate ship mix by profile sample',
    '',
    '| Faction | Score band | Hound | Raider | Kaper | Executioner | Ripper | Bruiser |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...result.profileSampling.map((sample) => `| ${sample.faction} | ${sample.scoreBand} | ${sample.observedShipShares['pirate-hound']?.toFixed(1) ?? '0.0'}% | ${sample.observedShipShares['pirate-raider']?.toFixed(1) ?? '0.0'}% | ${sample.observedShipShares['pirate-corsair']?.toFixed(1) ?? '0.0'}% | ${sample.observedShipShares['pirate-executioner']?.toFixed(1) ?? '0.0'}% | ${sample.observedShipShares['pirate-butcher']?.toFixed(1) ?? '0.0'}% | ${sample.observedShipShares['pirate-bruiser']?.toFixed(1) ?? '0.0'}% |`),
    '',
    '## Combat outcomes',
    '',
    '“Mirror” uses the pirate class on the player side. “Counter” picks the faction class with the largest existing damage multiplier against the sampled pirate class. “Mixed” spreads the player population over the six regular ship classes.',
    '',
    '| Faction | Score | Player tech | Formation | Player/pirate ship level; pirate tech | Player win (95% CI) | Draw (95% CI) | Pirate win (95% CI) | Player survivors median [range] / pirate survivors median [range] |',
    '| --- | --- | ---: | --- | ---: | --- | --- | --- | ---: |',
    ...result.matchups.map((row) => `| ${row.faction} | ${row.scoreBand} | ${row.attackerTechnologyLevel} | ${row.formation} | ${row.pirateShipLevel}/${row.pirateShipLevel}; ${row.pirateTechnologyLevel} | ${asPercent(row.attackerWinRate)} (${asInterval(row.attackerWinRate95)}) | ${asPercent(row.drawRate)} (${asInterval(row.drawRate95)}) | ${asPercent(row.defenderWinRate)} (${asInterval(row.defenderWinRate95)}) | ${Math.round(row.attackerSurvivingPopulationMedian).toLocaleString('en-US')} [${row.attackerSurvivingPopulationRange.map((value) => Math.round(value).toLocaleString('en-US')).join('–')}] / ${Math.round(row.pirateSurvivingPopulationMedian).toLocaleString('en-US')} [${row.pirateSurvivingPopulationRange.map((value) => Math.round(value).toLocaleString('en-US')).join('–')}] |`),
    '',
    '## Potroshitel extra-attack calibration',
    '',
    `Rule: min(0.5 percentage point × living Potroshitel count, 5%), one roll per pirate fleet per round. Ten living Potroshitel reach the 5% cap. First-round observed rate: ${result.ripperCalibration.firstRoundProcs}/${result.ripperCalibration.eligibleFirstRounds} (${asPercent(result.ripperCalibration.firstRoundProcRate)}; 95% CI ${asInterval(result.ripperCalibration.firstRoundProcRate95)}). Maximum extra attacks observed in one round: ${result.ripperCalibration.maxProcsInAnyRound}.`,
    `Chosen ship-type counts on successful first-round rolls: ${Object.entries(result.ripperCalibration.selectedShipTypeCounts).map(([id, count]) => `${id}=${count}`).join(', ') || 'no successful rolls'}. The roll chooses uniformly among living pirate ship types, regardless of each stack's size.`,
    '',
    '## Stats sourced from faction medians',
    '',
    '| Pirate ship | Source class | Population Aegis/Synod/Veyra | Attack Aegis/Synod/Veyra | Life Aegis/Synod/Veyra | Median population/attack/life |',
    '| --- | --- | --- | --- | --- | --- |',
    ...result.catalogMedians.map((row) => `| ${row.name} | ${row.sourceShipId} | ${Object.values(row.populationByFaction).join('/')} | ${Object.values(row.attackByFaction).join('/')} | ${Object.values(row.lifeByFaction).join('/')} | ${row.populationMedian}/${row.attackMedian}/${row.lifeMedian} |`),
    '',
    '## Ship level and technology snapshots',
    '',
    '| Ship | Level | Tech level | Attack per unit | Life per unit | Armor % |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...result.levelStats.map((row) => `| ${row.name} | ${row.shipLevel} | ${row.technologyLevel} | ${row.attackPerUnit.toLocaleString('en-US')} | ${row.lifePerUnit.toLocaleString('en-US')} | ${row.armorPercent.toFixed(1)} |`),
    '',
    '## Standard damage matchup coefficients',
    '',
    '| Attacker class | Target class | Multiplier |',
    '| --- | --- | ---: |',
    ...result.classMatchups.map((row) => `| ${row.attacker} | ${row.defender} | ×${row.multiplier.toFixed(2)} |`),
    '',
    'These confidence intervals describe seeded Asterion outcomes. They do not establish parity with another game. A “counter” result tests the existing class coefficient table, not an automatic victory guarantee.',
    '',
  ];
  return lines.join('\n');
}
