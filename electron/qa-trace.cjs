// Evidence for «an accepted player command was lost»: every state the game
// commits (RUNTIME_STATE_CHANGED_EVENT) and every write of the save key, each
// with a digest the QA script chose, in order, with page timestamps. A failed
// wait prints it, so the report shows whether the command never reached React
// state, or reached it and was reverted, or was only lost on the way to storage.
const { PARSE_SAVE } = require('./qa-save.cjs');

/**
 * @param {string} saveKey the save's localStorage key
 * @param {string} digestSource page-side function (save) => small JSON-able value
 */
async function installStateTrace(win, saveKey, digestSource) {
  await win.webContents.executeJavaScript(`(() => {
    if (window.__qaStateTrace) return;
    const trace = window.__qaStateTrace = [];
    const parse = ${PARSE_SAVE};
    const digest = ${digestSource};
    const push = (kind, detail) => { trace.push({ kind, at: Math.round(performance.now()), ...detail }); if (trace.length > 120) trace.shift(); };
    window.addEventListener('asterion:runtime-state-changed', (event) => {
      let value = null;
      try { value = digest(event.detail); } catch (error) { value = String(error); }
      push('state', { digest: value });
    });
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage && String(key) === ${JSON.stringify(saveKey)}) {
        let value2 = 'unparsed';
        try { value2 = digest(parse(String(value))); } catch {}
        push('write', { digest: value2, chars: String(value).length });
      }
      return originalSetItem.call(this, key, value);
    };
  })()`);
}

async function readStateTrace(win) {
  return win.webContents.executeJavaScript(`JSON.stringify(window.__qaStateTrace || null)`).catch((error) => String(error));
}

module.exports = { installStateTrace, readStateTrace };
