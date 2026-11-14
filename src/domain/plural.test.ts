import assert from 'node:assert/strict';
import test from 'node:test';
import { plural } from './plural.ts';

test('plural picks the Russian form: 1, 2-4, 5-20, 21, 22, 111, 112', () => {
  const form = (n: number) => plural(n, 'корабль', 'корабля', 'кораблей');
  assert.deepEqual([0, 1, 2, 4, 5, 11, 12, 14, 20, 21, 22, 25, 101, 111, 112].map(form),
    ['кораблей', 'корабль', 'корабля', 'корабля', 'кораблей', 'кораблей', 'кораблей', 'кораблей', 'кораблей', 'корабль', 'корабля', 'кораблей', 'корабль', 'кораблей', 'кораблей']);
});
