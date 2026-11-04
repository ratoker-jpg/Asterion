import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MAX_BYTES, REFRESH_EVERY, ROADMAP_FILE, moscowDate, rawEntry, readRoadmap, validateRoadmap } from './roadmap.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const pr = (n, overrides = {}) => ({ n, era: 'a', date: `2026-09-0${n}`, status: 'done', title: `Запись ${n}`, text: 'Что это дало игре.', ...overrides });
const sample = () => ({
  lastPr: 3,
  updated: '2026-09-09',
  refresh: { every: REFRESH_EVERY, nextAt: 150 },
  releases: { count: 1, first: '1.0.1', firstDate: '2026-09-02', last: '1.0.1' },
  eras: [{ id: 'a', title: 'Глава', story: 'История главы.' }],
  prs: [pr(1), pr(3, { status: 'closed' })],
  excluded: [{ n: 2, reason: 'Это задача, а не правка.' }],
  milestones: [{ pr: 1, title: 'Первая веха', rail: 'Веха' }],
  plans: [{ title: 'План', text: 'Что хотим сделать.' }],
});

test('the sample used by these tests is valid', () => {
  assert.deepEqual(validateRoadmap(sample()), []);
});

test('the real file passes every rule', () => {
  assert.deepEqual(validateRoadmap(readRoadmap()), []);
});

test('the real file stays light', () => {
  assert.ok(readFileSync(ROADMAP_FILE).length <= MAX_BYTES);
});

test('the real file: every PR up to lastPr is present or excluded with a reason, and the next refresh is at 300', () => {
  const data = readRoadmap();
  const present = new Set(data.prs.map((entry) => entry.n));
  const excluded = new Set(data.excluded.map((entry) => entry.n));
  for (let n = 1; n <= data.lastPr; n += 1) assert.ok(present.has(n) || excluded.has(n), `№${n}`);
  assert.equal(present.size, data.prs.length, 'numbers are unique');
  assert.equal(data.refresh.nextAt, 300);
  const sorted = [...data.prs].sort((left, right) => (left.date === right.date ? left.n - right.n : left.date < right.date ? -1 : 1));
  assert.deepEqual(data.prs.map((entry) => entry.n), sorted.map((entry) => entry.n), 'dates are ordered');
});

test('a number repeated or missing is caught', () => {
  const repeated = sample();
  repeated.prs.push(pr(3, { date: '2026-09-04' }));
  assert.ok(validateRoadmap(repeated).some((error) => error.includes('повторяется')));
  const missing = sample();
  missing.excluded = [];
  assert.ok(validateRoadmap(missing).some((error) => error.includes('№2')));
});

test('an exclusion without a reason is caught', () => {
  const data = sample();
  data.excluded[0].reason = '';
  assert.ok(validateRoadmap(data).some((error) => error.includes('reason')));
});

test('dates out of order are caught', () => {
  const data = sample();
  data.prs[0].date = '2026-09-08';
  assert.ok(validateRoadmap(data).some((error) => error.includes('порядок')));
});

test('eras do not interleave', () => {
  const data = sample();
  data.eras.push({ id: 'b', title: 'Вторая', story: 'История.' });
  data.prs[0].era = 'b';
  assert.ok(validateRoadmap(data).some((error) => error.includes('эры идут подряд')));
});

test('a closed PR cannot carry a version or a milestone', () => {
  const data = sample();
  data.prs[1].version = '1.0.2';
  data.milestones.push({ pr: 3, title: 'Другая' });
  const errors = validateRoadmap(data);
  assert.ok(errors.some((error) => error.includes('невыпущенного')));
  assert.ok(errors.some((error) => error.includes('только у выпущенного')));
});

test('the refresh rule holds', () => {
  const data = sample();
  data.refresh.nextAt = 200;
  assert.ok(validateRoadmap(data).some((error) => error.includes('refresh.nextAt')));
});

for (const [name, text] of [
  ['an address', 'Сервер на 10.20.30.40 работает'],
  ['an email', 'Пишите на someone@example.com'],
  ['a local folder', 'Лежит в D:\\Desktop\\Asterion'],
  ['a secret path', 'Ключ в /etc/asterion'],
  ['a key', 'Лежит рядом с cloud-key'],
  ['agent chatter', 'Это сделал Claude в отдельной сессии'],
  ['jargon', 'Сделан рефакторинг'],
]) {
  test(`${name} never reaches the public history`, () => {
    const data = sample();
    data.prs[0].text = text;
    assert.ok(validateRoadmap(data).length > 0, text);
  });
}

test('dates follow the Moscow clock', () => {
  assert.equal(moscowDate('2026-10-29T22:05:33Z'), '2026-10-30');
  assert.equal(moscowDate('2026-10-29T20:05:33Z'), '2026-10-29');
});

test('a raw PR maps to its status honestly', () => {
  assert.deepEqual(rawEntry({ number: 5, title: 'x', merged_at: '2026-09-01T10:00:00Z', created_at: '2026-08-31T10:00:00Z', state: 'closed' }, '1.0.1'), { n: 5, status: 'done', date: '2026-09-01', githubTitle: 'x', version: '1.0.1' });
  assert.equal(rawEntry({ number: 6, title: 'x', merged_at: null, created_at: '2026-09-01T10:00:00Z', state: 'closed' }).status, 'closed');
  assert.equal(rawEntry({ number: 7, title: 'x', merged_at: null, created_at: '2026-09-01T10:00:00Z', state: 'open' }, '1.0.1').status, 'open');
  assert.equal(rawEntry({ number: 7, title: 'x', merged_at: null, created_at: '2026-09-01T10:00:00Z', state: 'open' }, '1.0.1').version, undefined);
});

test('clone helper keeps the sample independent', () => {
  const data = clone(sample());
  data.prs.pop();
  assert.equal(sample().prs.length, 2);
});
