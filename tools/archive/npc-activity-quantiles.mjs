// Online hours per day by quantile for each NPC activity level (npc-activity-setting report).
// Usage: node --experimental-strip-types tools/npc-activity-quantiles.mjs
import { createNpcState } from '../../src/domain/npc/state.ts';
import { getNpcSessionEvents, NPC_CALENDAR_DAY_MS } from '../../src/domain/npc/calendar.ts';

const START = Date.UTC(2026, 10, 2, 0, 0, 0);
const DAYS = 28;
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const rows = [];
for (const count of [50, 100]) {
  for (const level of ['normal', 'high', 'max']) {
    const perOwner = [];
    const salts = ['qa-a', 'qa-b', 'qa-c', 'qa-d'];
    for (const salt of salts) {
      const ids = Array.from({ length: count }, (_, i) => `npc-${i}`);
      const state = createNpcState(ids, `${salt}-${count}`, START, level);
      for (const profile of Object.values(state.profiles)) {
        const p = { ...profile, campaignStartedAt: START };
        const events = getNpcSessionEvents(p, START, START + (DAYS + 2) * NPC_CALENDAR_DAY_MS);
        const open = new Map();
        const byDay = new Array(DAYS).fill(0);
        for (const e of events) {
          if (e.boundary === 'session-start') open.set(e.sessionId, e.at);
          else {
            const s = open.get(e.sessionId);
            if (s === undefined) continue;
            const day = Math.floor((s - START) / NPC_CALENDAR_DAY_MS);
            if (day >= 0 && day < DAYS) byDay[day] += (e.at - s) / 3_600_000;
          }
        }
        const ordinary = byDay.slice(3);
        perOwner.push({ mean: ordinary.reduce((a, b) => a + b, 0) / ordinary.length, day1: byDay[0], day2: byDay[1], day3: byDay[2] });
      }
    }
    const hours = perOwner.map((o) => o.mean).sort((a, b) => a - b);
    const share = (lo, hi) => hours.filter((h) => h >= lo && h < hi).length / hours.length;
    rows.push({
      count, level, owners: hours.length,
      q: [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95].map((q) => +quantile(hours, q).toFixed(1)),
      min: +hours[0].toFixed(1), max: +hours[hours.length - 1].toFixed(1), mean: +(hours.reduce((a, b) => a + b, 0) / hours.length).toFixed(2),
      shareGe10h: +share(10, 99).toFixed(2), share4to10: +share(4, 10).toFixed(2), share1_5to4: +share(1.5, 4).toFixed(2), shareLt1_5: +share(0, 1.5).toFixed(2),
      day1: +(perOwner.reduce((a, o) => a + o.day1, 0) / perOwner.length).toFixed(1),
      day2: +(perOwner.reduce((a, o) => a + o.day2, 0) / perOwner.length).toFixed(1),
      day3: +(perOwner.reduce((a, o) => a + o.day3, 0) / perOwner.length).toFixed(1),
    });
  }
}
console.log('count level | q05 q10 q25 q50 q75 q90 q95 (h/day) | min max mean | >=10h 4-10h 1.5-4h <1.5h | mean h day1 day2 day3');
for (const r of rows) console.log(`${r.count} ${r.level} | ${r.q.join(' ')} | ${r.min} ${r.max} ${r.mean} | ${r.shareGe10h} ${r.share4to10} ${r.share1_5to4} ${r.shareLt1_5} | ${r.day1} ${r.day2} ${r.day3}`);
