// Keys the Electron shell handles before the page sees them.
// Audit 13.11 (2.11): Esc is NOT one of them. The game uses Esc for its menu and for
// closing windows, so the first Esc in full screen must reach the page. Leaving full
// screen is F11 or the «Весь экран / Окно» switch in the settings.
function handleWindowKey(win, event, input) {
  if (input.type === 'mouseWheel' && (input.control || input.meta)) {
    event.preventDefault();
    return;
  }

  if (input.type !== 'keyDown') return;

  if ((input.control || input.meta) && ['+', '=', '-', '_', '0'].includes(input.key)) {
    event.preventDefault();
    return;
  }

  if (input.key === 'F11') {
    event.preventDefault();
    win.setFullScreen(!win.isFullScreen());
  }
}

module.exports = { handleWindowKey };
