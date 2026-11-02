// Evidence for «an accepted player command was lost»: every state the game
// commits (RUNTIME_STATE_CHANGED_EVENT) and every write of the save key, each
// with a digest the QA script chose, in order, with page timestamps. A failed
// wait prints it, so the report shows whether the command never reached React
// state, or reached it and was reverted, or was only lost on the way to storage.
const { PARSE_SAVE } = require('./qa-save.cjs');

/**
 * @param {string} saveKey the save's localStorage key
 * @param {string} digestSource page-side function (save) => small JSON-able value
 * @param {string} [domDigestSource] page-side function () => small value read from the DOM; logged with every click and 150 ms after it
 */
async function installStateTrace(win, saveKey, digestSource, domDigestSource = '() => null') {
  await win.webContents.executeJavaScript(`(() => {
    if (window.__qaStateTrace) return;
    const trace = window.__qaStateTrace = [];
    const parse = ${PARSE_SAVE};
    const digest = ${digestSource};
    // Clock ticks repeat the same digest every second: identical neighbours of one kind are counted, not listed.
    const last = {};
    const push = (kind, detail) => {
      const key = JSON.stringify(detail.digest ?? null);
      if (detail.digest !== undefined && last[kind]?.key === key) { last[kind].entry.repeat = (last[kind].entry.repeat || 1) + 1; return; }
      const entry = { kind, at: Math.round(performance.now()), ...detail };
      trace.push(entry);
      if (detail.digest !== undefined) last[kind] = { key, entry };
      if (trace.length > 120) trace.shift();
    };
    window.addEventListener('asterion:runtime-state-changed', (event) => {
      let value = null;
      try { value = digest(event.detail); } catch (error) { value = String(error); }
      push('state', { digest: value });
    });
    const domDigest = ${domDigestSource};
    window.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('button, [data-qa-trade-submit], [data-qa-route]') : null;
      const name = target ? [...target.attributes].map((a) => a.name).filter((n) => n.startsWith('data-qa')).join(' ') : '';
      let dom = null;
      try { dom = domDigest(); } catch (error) { dom = String(error); }
      push('click', { target: name, disabled: Boolean(target?.disabled), dom });
      setTimeout(() => { let after = null; try { after = domDigest(); } catch (error) { after = String(error); } push('after-click', { dom: after }); }, 150);
    }, true);
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
