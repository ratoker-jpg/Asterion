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
  // Cloud world (electron/cloud.cjs, src/ui/menu/cloud.ts). Network and compression run in the main process.
  cloud: {
    get: () => ipcRenderer.invoke('asterion:cloud:get'),
    set: (next) => ipcRenderer.invoke('asterion:cloud:set', next),
    server: () => ipcRenderer.invoke('asterion:cloud:server'),
    campaign: (id) => ipcRenderer.invoke('asterion:cloud:campaign', id),
    record: (id) => ipcRenderer.invoke('asterion:cloud:record', id),
    upload: (id, name, text, meta) => ipcRenderer.invoke('asterion:cloud:upload', id, name, text, meta),
    // Synchronous on purpose (pagehide): the main process queues it and returns at once.
    uploadOnExit: (id, name, text, meta) => ipcRenderer.sendSync('asterion:cloud:upload-exit', id, name, text, meta),
    wait: (id) => ipcRenderer.invoke('asterion:cloud:wait', id),
    claim: (id, baseRevision) => ipcRenderer.invoke('asterion:cloud:claim', id, baseRevision),
    download: (id, snapshotId) => ipcRenderer.invoke('asterion:cloud:download', id, snapshotId),
    release: (id) => ipcRenderer.invoke('asterion:cloud:release', id),
    markSynced: (id, revision, digest) => ipcRenderer.invoke('asterion:cloud:mark-synced', id, revision, digest),
    preferLocal: (id) => ipcRenderer.invoke('asterion:cloud:prefer-local', id),
  },
  onDisplayState: (listener) => {
    if (typeof listener !== 'function') return () => undefined;
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('asterion:display:state', handler);
    return () => ipcRenderer.removeListener('asterion:display:state', handler);
  },
});
