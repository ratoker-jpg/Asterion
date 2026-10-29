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
    remove: (key) => {
      const result = ipcRenderer.sendSync('asterion:save-store:remove', key);
      if (!result || !result.ok) throw new Error(result && result.error || 'Save store remove failed.');
    },
  },
  onDisplayState: (listener) => {
    if (typeof listener !== 'function') return () => undefined;
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('asterion:display:state', handler);
    return () => ipcRenderer.removeListener('asterion:display:state', handler);
  },
});
