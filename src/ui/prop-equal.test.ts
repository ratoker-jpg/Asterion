import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { propValuesEqual } from './prop-equal.ts';

test('equal data in fresh objects and arrays is equal, functions are ignored', () => {
  assert.equal(propValuesEqual({ a: [1, { b: 'x' }], f: () => 1 }, { a: [1, { b: 'x' }], f: () => 2 }), true);
});

test('a changed leaf, length or key set is not equal', () => {
  assert.equal(propValuesEqual({ a: [1, 2] }, { a: [1, 3] }), false);
  assert.equal(propValuesEqual([1], [1, 2]), false);
  assert.equal(propValuesEqual({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(propValuesEqual(1, '1'), false);
});

test('elements compare by type, key and props; class instances by reference', () => {
  const Box = () => null;
  assert.equal(propValuesEqual(createElement(Box, { v: 1 }), createElement(Box, { v: 1 })), true);
  assert.equal(propValuesEqual(createElement(Box, { v: 1 }), createElement(Box, { v: 2 })), false);
  assert.equal(propValuesEqual(new Map(), new Map()), false);
});

test('beyond the depth limit values count as changed', () => {
  const deep = (): unknown => ({ a: { b: { c: { d: { e: { f: 1 } } } } } });
  assert.equal(propValuesEqual(deep(), deep()), false);
  const state = { x: 1 };
  assert.equal(propValuesEqual({ a: { b: { c: { d: { e: state } } } } }, { a: { b: { c: { d: { e: state } } } } }), true);
});
