import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILD_NOTICE_MAX_WAIT_MS,
  BUILD_NOTICE_WINDOW_MS,
  QUIET_BUILD_MS,
  addBuildCompletion,
  buildNoticeDueAt,
  buildNoticeText,
  type BuildCompletion,
  type BuildNoticeBatch,
} from './build-notices.ts';

const done = (name: string, at: number, durationMs: number | undefined = QUIET_BUILD_MS, planetId = 'samara', planetName = 'Самара'): BuildCompletion =>
  ({ planetId, planetName, name, at, ...(durationMs == null ? {} : { durationMs }) });

test('builds shorter than five minutes finish quietly', () => {
  let batch: BuildNoticeBatch | null = null;
  for (let index = 0; index < 6; index += 1) batch = addBuildCompletion(batch, done(`Шахта ${index}`, 1_000 + index * 500, 40_000));
  assert.equal(batch, null);
  assert.equal(buildNoticeText(batch), null);
});

test('completions close together become one notice; a long build still gets its own', () => {
  let batch: BuildNoticeBatch | null = null;
  const names = ['Металлическая шахта I', 'Минеральная шахта I', 'Газовая скважина I', 'Солнечная электростанция', 'Склад металла', 'Ангар'];
  names.forEach((name, index) => { batch = addBuildCompletion(batch, done(name, 10_000 + index * 1_000)); });
  // A short one in the middle of the stream adds nothing.
  batch = addBuildCompletion(batch, done('Фабрика', 12_500, 30_000));
  assert.equal(batch!.items.length, 6);
  assert.equal(buildNoticeDueAt(batch!), 15_000 + BUILD_NOTICE_WINDOW_MS);
  assert.equal(buildNoticeText(batch), 'Самара: готово 6 построек — Металлическая шахта I, Минеральная шахта I, Газовая скважина I и ещё 3.');

  const single = addBuildCompletion(null, done('Верфь', 50_000, 3 * 3_600_000));
  assert.equal(buildNoticeText(single), 'Самара: постройка завершена — Верфь.');
  // An old save without the build time is treated as a long build.
  assert.equal(buildNoticeText(addBuildCompletion(null, done('Верфь', 50_000, undefined))), 'Самара: постройка завершена — Верфь.');
});

test('a steady stream is not held back forever, and several planets share one notice', () => {
  let batch: BuildNoticeBatch | null = null;
  for (let index = 0; index < 20; index += 1) batch = addBuildCompletion(batch, done('Склад', index * 3_000, QUIET_BUILD_MS, index % 2 ? 'kassia' : 'samara', index % 2 ? 'Кассия' : 'Самара'));
  assert.equal(buildNoticeDueAt(batch!), BUILD_NOTICE_MAX_WAIT_MS);
  assert.equal(buildNoticeText(batch), 'Готово 20 построек на 2 планетах — Склад.');
  assert.equal(buildNoticeText(addBuildCompletion(addBuildCompletion(null, done('Ангар', 1)), done('Ангар', 2))), 'Самара: готово 2 постройки — Ангар.');
});
