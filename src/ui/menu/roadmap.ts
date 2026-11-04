/**
 * «Весь роадмэп»: pure helpers over the reviewed history in changelog/roadmap.json
 * (rules in changelog/README.md, checks in tools/roadmap.mjs). The screen loads the
 * file on demand, so nothing here imports it.
 */

export type RoadmapStatus = 'done' | 'open' | 'closed';
export type RoadmapPr = { n: number; era: string; date: string; status: RoadmapStatus; title: string; text: string; decision?: string; version?: string };
export type RoadmapEra = { id: string; title: string; story: string };
export type RoadmapMilestone = { pr: number; title: string; rail?: string };
export type RoadmapPlan = { title: string; text: string };
export type RoadmapData = {
  lastPr: number;
  updated: string;
  refresh: { every: number; nextAt: number };
  releases: { count: number; first: string; firstDate: string; last: string };
  eras: RoadmapEra[];
  prs: RoadmapPr[];
  excluded: { n: number; reason: string }[];
  milestones: RoadmapMilestone[];
  plans: RoadmapPlan[];
};

const DAY_MS = 86_400_000;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function parts(date: string): { year: number; month: number; day: number } {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return { year, month, day };
}

/** `2026-11-03` → `3 ноября`. */
export function formatDay(date: string): string {
  const { month, day } = parts(date);
  return `${day} ${MONTHS[month - 1] ?? ''}`;
}

/** `3–4 ноября`, `31 августа – 1 сентября`, `21 октября`. */
export function formatRange(from: string, to: string): string {
  if (from === to) return formatDay(from);
  const left = parts(from);
  const right = parts(to);
  if (left.month === right.month) return `${left.day}–${right.day} ${MONTHS[right.month - 1] ?? ''}`;
  return `${formatDay(from)} – ${formatDay(to)}`;
}

/** Whole calendar days from the first date to the last, both counted. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** `1 доработка`, `3 доработки`, `150 доработок`. */
export function pluralRu(count: number, forms: readonly [string, string, string]): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return forms[2];
  if (units === 1) return forms[0];
  if (units >= 2 && units <= 4) return forms[1];
  return forms[2];
}

export type RoadmapStats = { shipped: number; proposed: number; notShipped: number; inWork: number; days: number; releases: number };

export function roadmapStats(data: RoadmapData): RoadmapStats {
  const shipped = data.prs.filter((pr) => pr.status === 'done');
  const dates = data.prs.map((pr) => pr.date);
  const first = dates[0] ?? data.updated;
  const last = dates[dates.length - 1] ?? data.updated;
  return {
    shipped: shipped.length,
    proposed: data.prs.length,
    notShipped: data.prs.filter((pr) => pr.status === 'closed').length,
    inWork: data.prs.filter((pr) => pr.status === 'open').length,
    days: daysBetween(first, last),
    releases: data.releases.count,
  };
}

/** The rail shares the width by work, not by calendar: the dense last days stay readable. */
export const RAIL_PLANS_AT = 0.965;

export type RailEra = { id: string; from: number; to: number; first: string; last: string; count: number };
export type RailTick = { at: number; off: boolean };
export type RailMark = RoadmapMilestone & { at: number; date: string };
export type RailLayout = { eras: RailEra[]; ticks: RailTick[]; marks: RailMark[] };

export function railLayout(data: RoadmapData): RailLayout {
  const total = Math.max(data.prs.length, 1);
  const atIndex = (index: number) => (index / total) * RAIL_PLANS_AT;
  const ticks = data.prs.map((pr, index) => ({ at: atIndex(index + 0.5), off: pr.status !== 'done' }));
  const eras: RailEra[] = [];
  for (const era of data.eras) {
    const start = data.prs.findIndex((pr) => pr.era === era.id);
    if (start < 0) continue;
    const rows = data.prs.filter((pr) => pr.era === era.id);
    eras.push({
      id: era.id,
      from: atIndex(start),
      to: atIndex(start + rows.length),
      first: rows[0]?.date ?? '',
      last: rows[rows.length - 1]?.date ?? '',
      count: rows.length,
    });
  }
  const marks: RailMark[] = [];
  for (const milestone of data.milestones) {
    const index = data.prs.findIndex((pr) => pr.n === milestone.pr);
    const pr = data.prs[index];
    if (pr) marks.push({ ...milestone, at: atIndex(index + 0.5), date: pr.date });
  }
  return { eras, ticks, marks };
}

export type EraBox = { top: number; height: number; from: number; to: number };

/**
 * Where the pointer on the rail stands for a scroll position. The reading line starts at
 * the very top and settles 35% down the view, so the journey starts at the first mark and
 * reaches the end when the list does.
 */
export function railPosition(scrollTop: number, viewHeight: number, contentHeight: number, eras: readonly EraBox[]): { at: number; era: number; line: number } {
  const settle = Math.min(1, scrollTop / Math.max(viewHeight, 1));
  const line = scrollTop + viewHeight * 0.35 * settle;
  if (eras.length === 0) return { at: 0, era: 0, line };
  const last = eras[eras.length - 1] as EraBox;
  if (scrollTop + viewHeight >= contentHeight - 2 && scrollTop > 0) return { at: 1, era: eras.length - 1, line };
  if (line >= last.top + last.height) return { at: last.to, era: eras.length - 1, line };
  let era = 0;
  for (let index = 0; index < eras.length; index += 1) if ((eras[index] as EraBox).top <= line) era = index;
  const box = eras[era] as EraBox;
  const inside = box.height > 0 ? Math.min(1, Math.max(0, (line - box.top) / box.height)) : 0;
  return { at: box.from + (box.to - box.from) * inside, era, line };
}

/** The row an arrow, Page or Home/End key leads to from `current`. */
export function nextRow(rows: readonly Pick<RoadmapPr, 'n' | 'era'>[], current: number, key: string): number {
  const at = rows.findIndex((row) => row.n === current);
  const here = rows[at];
  if (!here) return rows[0]?.n ?? current;
  const clamp = (index: number) => (rows[Math.min(rows.length - 1, Math.max(0, index))] as { n: number }).n;
  if (key === 'ArrowDown') return clamp(at + 1);
  if (key === 'ArrowUp') return clamp(at - 1);
  if (key === 'Home') return clamp(0);
  if (key === 'End') return clamp(rows.length - 1);
  if (key === 'PageDown') {
    const next = rows.findIndex((row, index) => index > at && row.era !== here.era);
    return next < 0 ? clamp(rows.length - 1) : clamp(next);
  }
  if (key === 'PageUp') {
    const start = rows.findIndex((row) => row.era === here.era);
    if (at > start) return clamp(start);
    const previous = rows[start - 1];
    return previous ? clamp(rows.findIndex((row) => row.era === previous.era)) : clamp(0);
  }
  return current;
}
