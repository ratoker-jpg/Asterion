const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatWindowResolution,
  isWindowMode,
  parseWindowResolution,
} = require('./window-settings.cjs');

test('desktop IPC mode payload accepts only explicit whitelist', () => {
  assert.equal(isWindowMode('fullscreen'), true);
  assert.equal(isWindowMode('windowed'), true);
  assert.equal(isWindowMode('borderless'), false);
  assert.equal(isWindowMode({ mode: 'fullscreen' }), false);
});

test('desktop IPC resolution payload accepts only explicit presets', () => {
  assert.deepEqual(parseWindowResolution('1280x720'), { key: '1280x720', width: 1280, height: 720 });
  assert.deepEqual(parseWindowResolution('2560x1440'), { key: '2560x1440', width: 2560, height: 1440 });
  assert.equal(parseWindowResolution('3840x2160'), null);
  assert.equal(parseWindowResolution('../1920x1080'), null);
});

test('desktop display state formats current content dimensions without changing the monitor', () => {
  assert.equal(formatWindowResolution(1920, 1080), '1920x1080');
  assert.equal(formatWindowResolution(1599.6, 899.7), '1600x900');
});
