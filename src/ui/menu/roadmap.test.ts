import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RAIL_PLANS_AT, daysBetween, formatDay, formatRange, nextRow, pluralRu, railLayout, railPosition, roadmapStats, type EraBox, type RoadmapData } from './roadmap.ts';

const data = JSON.parse(readFileSync(new URL('../../../changelog/roadmap.json', import.meta.url), 'utf8')) as RoadmapData;

test('the file loads with its eras, rows, plans and refresh rule', () => {
  assert.ok(data.eras.length >= 10);
  assert.ok(data.prs.length >= 150);
  assert.ok(data.plans.length > 0);
  assert.equal(data.refresh.nextAt, 300);
  assert.ok(data.prs.some((pr) => pr.n === data.lastPr) || data.excluded.some((entry) => entry.n === data.lastPr));
});

test('the numbers at the top come from the file', () => {
  const stats = roadmapStats(data);
  assert.equal(stats.proposed, data.prs.length);
  assert.equal(stats.shipped + stats.notShipped + stats.inWork, stats.proposed);
  assert.equal(stats.releases, data.releases.count);
  assert.equal(stats.days, daysBetween(data.prs[0]?.date ?? '', data.prs[data.prs.length - 1]?.date ?? ''));
  assert.ok(stats.days > 30);
});

test('dates read like a person wrote them', () => {
  assert.equal(formatDay('2026-11-03'), '3 ноября');
  assert.equal(formatRange('2026-11-03', '2026-11-04'), '3–4 ноября');
  assert.equal(formatRange('2026-08-31', '2026-09-01'), '31 августа – 1 сентября');
  assert.equal(formatRange('2026-10-21', '2026-10-21'), '21 октября');
  assert.equal(daysBetween('2026-08-31', '2026-08-31'), 1);
  assert.equal(daysBetween('2026-08-31', '2026-09-01'), 2);
});

test('Russian plurals', () => {
  const forms = ['выпуск', 'выпуска', 'выпусков'] as const;
  assert.equal(pluralRu(1, forms), 'выпуск');
  assert.equal(pluralRu(3, forms), 'выпуска');
  assert.equal(pluralRu(11, forms), 'выпусков');
  assert.equal(pluralRu(21, forms), 'выпуск');
  assert.equal(pluralRu(150, forms), 'выпусков');
});

test('the rail holds every row, in order, with the plans mark after them', () => {
  const rail = railLayout(data);
  assert.equal(rail.ticks.length, data.prs.length);
  assert.equal(rail.eras.length, data.eras.length);
  assert.equal(rail.marks.length, data.milestones.length);
  assert.equal(rail.eras[0]?.from, 0);
  assert.ok(Math.abs((rail.eras[rail.eras.length - 1]?.to ?? 0) - RAIL_PLANS_AT) < 1e-9);
  for (let at = 1; at < rail.ticks.length; at += 1) assert.ok((rail.ticks[at]?.at ?? 0) > (rail.ticks[at - 1]?.at ?? 1));
  assert.equal(rail.ticks.filter((tick) => tick.off).length, data.prs.filter((pr) => pr.status !== 'done').length);
});

test('labels on the rail keep room for each other at 1280 wide', () => {
  const rail = railLayout(data);
  const labelled = rail.marks.filter((mark) => mark.rail);
  const width = 1160;
  // Labels take turns above and below the line; a label is at most this wide at 12 px bold.
  for (let at = 2; at < labelled.length; at += 1) {
    const gap = ((labelled[at]?.at ?? 0) - (labelled[at - 2]?.at ?? 0)) * width;
    assert.ok(gap > 96, `${labelled[at]?.rail}: ${gap}`);
  }
});

const boxes: EraBox[] = [
  { top: 0, height: 1000, from: 0, to: 0.5 },
  { top: 1000, height: 1000, from: 0.5, to: 0.9 },
];

test('the rail pointer starts at the start and ends at the end', () => {
  assert.deepEqual(railPosition(0, 500, 2500, boxes), { at: 0, era: 0, line: 0 });
  assert.equal(railPosition(2000, 500, 2500, boxes).at, 1);
});

test('the rail pointer follows the reading line through the eras', () => {
  const inFirst = railPosition(500, 500, 2500, boxes);
  assert.equal(inFirst.era, 0);
  assert.ok(Math.abs(inFirst.at - 0.3375) < 1e-9);
  assert.equal(railPosition(1000, 500, 2500, boxes).era, 1);
  // Past the last era, in the plans.
  assert.equal(railPosition(1900, 500, 2500, boxes).at, 0.9);
});

test('keys walk the rows', () => {
  const rows = [{ n: 1, era: 'a' }, { n: 2, era: 'a' }, { n: 3, era: 'b' }, { n: 4, era: 'b' }, { n: 5, era: 'c' }];
  assert.equal(nextRow(rows, 1, 'ArrowDown'), 2);
  assert.equal(nextRow(rows, 1, 'ArrowUp'), 1);
  assert.equal(nextRow(rows, 5, 'ArrowDown'), 5);
  assert.equal(nextRow(rows, 1, 'PageDown'), 3);
  assert.equal(nextRow(rows, 3, 'PageDown'), 5);
  assert.equal(nextRow(rows, 5, 'PageDown'), 5);
  assert.equal(nextRow(rows, 4, 'PageUp'), 3);
  assert.equal(nextRow(rows, 3, 'PageUp'), 1);
  assert.equal(nextRow(rows, 1, 'PageUp'), 1);
  assert.equal(nextRow(rows, 3, 'Home'), 1);
  assert.equal(nextRow(rows, 3, 'End'), 5);
  assert.equal(nextRow(rows, 99, 'ArrowDown'), 1);
  assert.equal(nextRow(rows, 3, 'x'), 3);
});
