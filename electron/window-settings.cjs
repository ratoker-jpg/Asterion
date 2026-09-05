const WINDOW_MODES = Object.freeze(['fullscreen', 'windowed']);
const WINDOW_RESOLUTIONS = Object.freeze({
  '1280x720': Object.freeze([1280, 720]),
  '1600x900': Object.freeze([1600, 900]),
  '1920x1080': Object.freeze([1920, 1080]),
  '2560x1440': Object.freeze([2560, 1440]),
});

function isWindowMode(value) {
  return typeof value === 'string' && WINDOW_MODES.includes(value);
}

function parseWindowResolution(value) {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(WINDOW_RESOLUTIONS, value)) return null;
  const [width, height] = WINDOW_RESOLUTIONS[value];
  return { key: value, width, height };
}

function formatWindowResolution(width, height) {
  return `${Math.round(width)}x${Math.round(height)}`;
}

module.exports = {
  WINDOW_MODES,
  WINDOW_RESOLUTIONS,
  isWindowMode,
  parseWindowResolution,
  formatWindowResolution,
};
