const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('asterionDesktop', {
  getDisplayState: () => ipcRenderer.invoke('asterion:display:get'),
  quit: () => ipcRenderer.send('asterion:app:quit'),
  setDisplay: (request) => ipcRenderer.invoke('asterion:display:set', request),
  // Large saves on disk (src/application/save-storage.ts, electron/save-store.cjs).
  saveStore: {
    read: (key, writeId) => {
      const result = ipcRenderer.sendSync('asterion:save-store:read', key, writeId);
      if (result && result.ok) return result.text;
      if (result && result.missing) return null;
      throw new Error(result && result.error || 'Save store read failed.');
    },
    write: (key, writeId, text) => {
      const result = ipcRenderer.sendSync('asterion:save-store:write', key, writeId, text);
      if (!result || !result.ok) throw new Error(result && result.error || 'Save store write failed.');
    },
    // The renderer only copies the text out; the disk write runs in the main process.
    writeAsync: async (key, writeId, text) => {
      const result = await ipcRenderer.invoke('asterion:save-store:write-async', key, writeId, text);
      if (!result || !result.ok) throw new Error(result && result.error || 'Save store write failed.');
    },
    remove: (key) => {
      const result = ipcRenderer.sendSync('asterion:save-store:remove', key);
      if (!result || !result.ok) throw new Error(result && result.error || 'Save store remove failed.');
    },
  },
  // Game updates (electron/updater.cjs). `install` only after the saves are flushed.
  updates: {
    get: () => ipcRenderer.invoke('asterion:update:get'),
    check: () => ipcRenderer.invoke('asterion:update:check'),
    install: () => ipcRenderer.invoke('asterion:update:install'),
    onState: (listener) => {
      if (typeof listener !== 'function') return () => undefined;
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('asterion:update:state', handler);
      return () => ipcRenderer.removeListener('asterion:update:state', handler);
    },
  },
  onDisplayState: (listener) => {
    if (typeof listener !== 'function') return () => undefined;
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('asterion:display:state', handler);
    return () => ipcRenderer.removeListener('asterion:display:state', handler);
  },
});
