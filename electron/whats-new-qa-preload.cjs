// QA only (electron/whats-new-qa.cjs): the update row shows up as in the installed
// game, so the menu footer is checked with everything it really holds. No network.
const { contextBridge } = require('electron');

const state = { status: 'latest', currentVersion: '1.8.18', enabled: true };

contextBridge.exposeInMainWorld('asterionDesktop', {
  updates: {
    get: async () => state,
    check: async () => state,
    install: async () => ({ ok: false }),
    onState: () => () => undefined,
  },
});
