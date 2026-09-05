const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('asterionDesktop', {
  getDisplayState: () => ipcRenderer.invoke('asterion:display:get'),
  setDisplay: (request) => ipcRenderer.invoke('asterion:display:set', request),
  onDisplayState: (listener) => {
    if (typeof listener !== 'function') return () => undefined;
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('asterion:display:state', handler);
    return () => ipcRenderer.removeListener('asterion:display:state', handler);
  },
});
