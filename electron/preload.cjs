// The host half of the chrome-to-host interface. Everything the chrome calls
// goes through here, so the page never touches Electron APIs directly and the
// same chrome runs unchanged in a plain browser (where window.alexandria is absent).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alexandria', {
  host: 'electron',
  revealWorlds: () => ipcRenderer.invoke('alexandria:reveal-worlds'),
  worldsDir: () => ipcRenderer.invoke('alexandria:worlds-dir'),
  minimize: () => ipcRenderer.invoke('alexandria:minimize'),
  close: () => ipcRenderer.invoke('alexandria:close'),
});
