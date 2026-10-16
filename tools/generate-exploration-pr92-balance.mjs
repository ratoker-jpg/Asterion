// PR92 deterministic analytical economic matrix. NOT a combat simulation or live game flight.
import { FACTION_SHIP_MECHANICS } from '../src/domain/combat/faction-ship-data.ts';
import { EXPLORATION_PROFILES, EXPLORATION_RULES, explorationBaseRate,
  explorationMiningRates, explorationRareProbability, emptyExplorationCargo, accumulateExplorationCargo,
} from '../src/domain/exploration/model.ts';
import { calculateFlightFuel } from '../src/domain/flights/fuel.ts';
import { calculateEffectiveFleetSpeed, calculateOneWayDurationMs } from '../src/domain/flights/speed.ts';

const factions = ['aegis', 'synod', 'veyra'];
const points = [1000, 10_000, 100_000, 300_000, 1_000_000, 3_000_000, 6_000_000];
const mixtures = [
  ['1 transporter', { transporter: 1 }],
  ['10 transporters', { transporter: 10 }],
  ['100 transporters', { transporter: 100 }],
  ['1 mega transporter + guard', { 'mega-transporter': 1, destroyer: 1 }],
  ['10 mega transporters + guard', { 'mega-transporter': 10, destroyer: 1 }],
  ['100 mega transporters + guard', { 'mega-transporter': 100, destroyer: 10 }],
  ['combat-heavy', { destroyer: 100, battleship: 10 }],
  ['10 recyclers + guard', { recycler: 10, destroyer: 1 }],
];
const departures = [4, 8, 12];
const origin = { galaxy: 1, system: 1, position: 1 };
const destination = { galaxy: 1, system: 2, position: 11 };
const routeDistance = 12_000; // controlled representative assumption, NOT a live route calculation.
const allProfiles = Object.entries(EXPLORATION_PROFILES).flatMap(([kind, profiles]) =>
  profiles.map(profile => ({ kind, profile })));
const cases = [];
const aggregate = { cases: 0, feasibleReturnsBeforeExpiry: 0, extracted: 0, gas: 0, scarce: 0, noviceSingleTransportMax: 0 };
for (const faction of factions) {
  const fleetCatalog = FACTION_SHIP_MECHANICS[faction];
  for (const p of points) {
    for (const { kind, profile } of allProfiles) {
      for (const [label, ships] of mixtures) {
        const capacity = Object.entries(ships).reduce((sum, [id, count]) => {
          const ship = fleetCatalog[id];
          const totalCargo = (ship.ship?.cargo ?? 0) * count;
          sum.all += totalCargo;
          if (id === 'transporter' || id === 'mega-transporter') sum.transporters += totalCargo;
          if (id === 'recycler') sum.recyclers += totalCargo;
          sum.hullCost += (ship.cost.metal + ship.cost.minerals + ship.cost.gas) * count;
          return sum;
        }, { all: 0, transporters: 0, recyclers: 0, hullCost: 0 });
        const speed = calculateEffectiveFleetSpeed(faction, ships);
        const oneWayDurationMs = calculateOneWayDurationMs(origin, destination, speed);
        const fuel = calculateFlightFuel(faction, ships, routeDistance);
        const rates = explorationMiningRates(p, profile, capacity);
        for (const leaveAtMinutes of departures) {
          const miningMinutes = Math.max(0, leaveAtMinutes - oneWayDurationMs / 60_000);
          const mined = accumulateExplorationCargo(emptyExplorationCargo(),
            Object.fromEntries(Object.keys(emptyExplorationCargo()).map(k => [k, 1e10])),
            rates, Math.round(miningMinutes * 60_000), emptyExplorationCargo(), capacity.all).cargo;
          const yieldTotal = Object.values(mined).reduce((sum, val) => sum + val, 0);
          const feasible = leaveAtMinutes < 18 && miningMinutes >= 0 && oneWayDurationMs / 60_000 < leaveAtMinutes;
          const row = { faction, P: p, kind, variant: profile.variant, profile: profile.name,
            q: profile.q, risk: profile.risk, squad: label, leaveAtMinutes, oneWayMinutes: oneWayDurationMs / 60_000,
            speed, gas: fuel, fleetCost: capacity.hullCost, cargoCapacity: capacity.all,
            rates, mined, totalMined: yieldTotal, feasible, tokenChance: explorationRareProbability(profile, miningMinutes * 60_000),
            npcAttemptChancePer3Min: EXPLORATION_RULES.npcAttemptChance[profile.risk],
            hazardPer3Min: kind === 'anomaly' ? EXPLORATION_RULES.anomalyHazardChance[profile.risk] : 0,
            battleResult: 'NOT SIMULATED', lossCost: null };
          cases.push(row);
          aggregate.cases++;
          if (feasible) aggregate.feasibleReturnsBeforeExpiry++;
          aggregate.extracted += yieldTotal;
          aggregate.gas += fuel;
          if (p === 1000 && label === '1 transporter') aggregate.noviceSingleTransportMax = Math.max(aggregate.noviceSingleTransportMax, yieldTotal);
          if (yieldTotal === 0) aggregate.scarce++;
        }
      }
    }
  }
}
const summary = {
  status: 'ANALYTICAL ONLY: no combat resolver calls; not expected-profit or PvP success',
  assumptions: { travel: 'one system, ten positions', fuelRouteDistance: routeDistance, timeHorizonMinutes: 18,
    noBotReplay: true, noCombat: true, noRarePayout: true, noFuelRefund: true },
  aggregate,
  examples: cases.filter(c => c.P === 1000 && c.faction === 'aegis' && c.variant === 1 && c.kind === 'unique')
    .slice(0, 12),
  eliteExamples: cases.filter(c => c.P === 3_000_000 && c.faction === 'synod'
    && c.variant === 16 && c.kind === 'unique' && c.leaveAtMinutes === 12).slice(0, 8),
  totalScenarios: cases.length,
};
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
