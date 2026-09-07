import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCTION_SAVE_KEY,
  TEST_SAVE_KEY,
  TEST_TIME_SCALE,
  getRuntimeSaveKey,
  resolveRuntimeMode,
  scaleRuntimeDuration,
} from './mode.ts';

test('runtime mode accepts only the explicit test query and keeps save keys isolated', () => {
  assert.equal(resolveRuntimeMode('?mode=test'), 'test');
  assert.equal(resolveRuntimeMode('?mode=production'), 'production');
  assert.equal(resolveRuntimeMode('?mode=test&other=1'), 'test');
  assert.equal(resolveRuntimeMode('?mode=TEST'), 'production');
  assert.equal(getRuntimeSaveKey('production'), PRODUCTION_SAVE_KEY);
  assert.equal(getRuntimeSaveKey('test'), TEST_SAVE_KEY);
  assert.notEqual(PRODUCTION_SAVE_KEY, TEST_SAVE_KEY);
});
test('time scale applies only in test mode and preserves absolute-duration semantics', () => {
  assert.equal(scaleRuntimeDuration(15 * 60 * 1000, 'production'), 15 * 60 * 1000);
  assert.equal(scaleRuntimeDuration(15 * 60 * 1000, 'test'), (15 * 60 * 1000) / TEST_TIME_SCALE);
  assert.equal(scaleRuntimeDuration(1, 'test'), 1);
});
