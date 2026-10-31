// Loader for tools/npc-capacity.mjs: the test asset loader plus three patches
// made to the game's source as it loads, in this process only (the game's
// files are not changed):
//   ASTERION_BENCH_NPC_MAX=N   WORLD_LIMITS.npcMax becomes N (150-NPC worlds load unclamped);
//   ASTERION_BENCH_ALL_ONLINE=1 every NPC is online around the clock (back-to-back
//                              three-hour sessions; an upper bound, not a game rule);
//   always: counters on globalThis.__npcBench for attention moments (count, time,
//   actions) and skipped idle moments, read by the tool. Results are unchanged.
//
//   node --experimental-strip-types --experimental-loader ./tools/npc-capacity-loader.mjs tools/npc-capacity.mjs ...
const npcMax = process.env.ASTERION_BENCH_NPC_MAX;
const allOnline = process.env.ASTERION_BENCH_ALL_ONLINE === '1';

function patch(source, from, to, file) {
  if (!source.includes(from)) throw new Error(`npc-capacity-loader: "${from.slice(0, 60)}" not found in ${file}`);
  return source.replace(from, to);
}

const ALL_ONLINE_CALENDAR = `
/** npc-capacity bench: online around the clock, eight back-to-back 180-minute sessions a day. */
export function getNpcSessionEvents(profile, fromAt, toAt) {
  assertInterval(fromAt, toAt);
  if (toAt === fromAt) return [];
  const events = [];
  const session = 180 * 60_000;
  for (let day = Math.floor(fromAt / NPC_CALENDAR_DAY_MS) - 1; day <= Math.floor(toAt / NPC_CALENDAR_DAY_MS) + 1; day += 1) {
    for (let index = 0; index < 8; index += 1) {
      const startAt = day * NPC_CALENDAR_DAY_MS + index * session;
      const endAt = startAt + session - 1_000;
      const sessionId = 'npc-session:v1:' + JSON.stringify([profile.privateSeed, profile.ownerId, day, index]);
      for (const [at, boundary] of [[startAt, 'session-start'], [endAt, 'session-end']]) {
        if (at < fromAt || at >= toAt) continue;
        events.push(Object.freeze({ at, priority: 'npc-session-boundary', ownerId: profile.ownerId, sessionId, boundary,
          eventId: 'npc-session-event:v1:' + JSON.stringify([profile.privateSeed, profile.ownerId, day, index, boundary === 'session-start' ? 'start' : 'end']) }));
      }
    }
  }
  return events.sort((left, right) => left.at - right.at || compareStableIds(left.eventId, right.eventId));
}
`;

export async function load(url, context, nextLoad) {
  const pathname = new URL(url).pathname;
  if (/\.(png|jpe?g|webp|svg)$/i.test(pathname)) {
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
  }
  const result = await nextLoad(url, context);
  let source;
  const text = () => source ??= String(result.source).replace(/\r\n/g, '\n');
  if (npcMax && pathname.endsWith('/src/domain/world/config.ts')) {
    source = patch(text(), '  npcMax: 100,', `  npcMax: ${Number(npcMax)},`, pathname);
  } else if (allOnline && pathname.endsWith('/src/domain/npc/calendar.ts')) {
    source = patch(text(), 'export function getNpcSessionEvents(', 'function calendarGetNpcSessionEvents(', pathname) + ALL_ONLINE_CALENDAR;
  } else if (pathname.endsWith('/src/application/npc-replay.ts')) {
    source = patch(text(), '    if (isNpcDecisionIdle(profile, event)) {\n',
      '    if (isNpcDecisionIdle(profile, event)) {\n      (globalThis as any).__npcBench && ((globalThis as any).__npcBench.idle += 1);\n', pathname);
    source = patch(source, '      const decisions = applyNpcAutonomyAttention(',
      '      const __benchAt = performance.now();\n      const decisions = applyNpcAutonomyAttention(', pathname);
    source = patch(source, '      world = decisions[decisions.length - 1]!.state;\n',
      '      world = decisions[decisions.length - 1]!.state;\n'
      + '      { const bench = (globalThis as any).__npcBench; if (bench) { bench.attention += 1; bench.actions += decisions.filter((decision) => !decision.wait).length; bench.attentionMs += performance.now() - __benchAt; } }\n', pathname);
  }
  return source === undefined ? result : { ...result, source, shortCircuit: true };
}
