// Why an NPC build queue stands empty: samples every few minutes and sorts every idle planet by reason.
//   ... tools/npc-growth-diag.mjs [--bots=50] [--hours=2] [--step=5] [--seed=GROWTH1] [--speed=superfast] [--activity=max]
import { pathToFileURL } from 'node:url';
import { applyCampaignRuntimeForCatchup } from '../../src/application/npc-catchup-runner.ts';
import { advanceLiveWorld, beginLiveWorld } from '../../src/application/npc-live-world.ts';
import { getNpcBuildingCandidates } from '../../src/application/npc-economy.ts';
import { createGrowthWorld } from './npc-growth-lab.mjs';

const MIN = 60_000;
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

function classify(state, planet, at) {
  const profile = state.npc.profiles[planet.ownerId];
  if ((planet.buildingQueue ?? []).some((order) => order.finishAt > at)) return 'busy';
  const candidates = getNpcBuildingCandidates(planet, true).filter(({ role }) => role !== 'research' && role !== 'recycling' && role !== 'spaceport' && role !== 'planetary-government');
  const affordable = candidates.filter(({ availability }) => availability.canBuild);
  const reasons = new Set(candidates.map(({ availability }) => availability.reason));
  let why;
  if (!profile.session.active) why = 'offline';
  else if (typeof profile.session.idleUntil === 'number' && profile.session.idleUntil > at) why = affordable.length ? 'online-sleeping-with-options' : 'online-sleeping-nothing-affordable';
  else why = affordable.length ? 'online-awake-with-options' : 'online-awake-nothing-affordable';
  if (!affordable.length) {
    const energy = [...reasons].some((reason) => /энерг/i.test(reason ?? ''));
    why += energy ? ':energy' : ':resources';
  }
  return why;
}

function main() {
  const bots = Number(option('bots', '50'));
  const hours = Number(option('hours', '2'));
  const step = Number(option('step', '5')) * MIN;
  let state = createGrowthWorld({ bots, seed: option('seed', 'GROWTH1'), speed: option('speed', 'superfast'), activity: option('activity', 'max') });
  const at0 = state.npcReplay.processedThroughAt;
  applyCampaignRuntimeForCatchup(state, at0);
  const { summary: _summary, ...replay } = state.npcReplay;
  state = beginLiveWorld({ ...state, npcReplay: { ...replay, targetAt: at0 } });
  let groups;
  const total = {};
  for (let at = at0 + step; at <= at0 + hours * 3_600_000; at += step) {
    const result = advanceLiveWorld(state, at, { groups });
    state = result.state; groups = result.groups;
    const counts = {};
    for (const planet of Object.values(state.espionage.targets).filter((target) => target.kind === 'npc')) {
      const why = classify(state, planet, at);
      counts[why] = (counts[why] ?? 0) + 1; total[why] = (total[why] ?? 0) + 1;
    }
    console.log(`+${Math.round((at - at0) / MIN)}m`, JSON.stringify(counts));
  }
  console.log('TOTAL', JSON.stringify(Object.fromEntries(Object.entries(total).sort((a, b) => b[1] - a[1]))));
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
