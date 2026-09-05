const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('asterionDesktop', Object.freeze({
  getDisplaySettings: () => ipcRenderer.invoke('asterion:get-display-settings'),
  setWindowMode: (mode) => ipcRenderer.invoke('asterion:set-window-mode', mode),
  setWindowSize: (resolution) => ipcRenderer.invoke('asterion:set-window-size', resolution),
  onDisplaySettingsChanged: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, settings) => listener(settings);
    ipcRenderer.on('asterion:display-settings-changed', handler);
    return () => ipcRenderer.removeListener('asterion:display-settings-changed', handler);
  },
}));
