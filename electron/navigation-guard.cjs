// The game window shows only its own page (audit 13.11, 2.12).
const { pathToFileURL } = require('url');

/** True for the game's own page (its query and hash may change: a reload, the menu route). */
function isGamePageUrl(url, gamePage) {
  try {
    const target = new URL(url);
    const own = pathToFileURL(gamePage);
    return target.protocol === 'file:' && target.pathname === own.pathname;
  } catch { return false; }
}

module.exports = { isGamePageUrl };
