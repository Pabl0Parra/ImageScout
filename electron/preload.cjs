const { contextBridge, ipcRenderer } = require('electron');
const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('scout', {
  settings: call('settings:get'), configure: call('settings:set'), search: call('images:search'),
  save: call('images:save'), imageBytes: call('images:bytes'), library: call('library:list'),
  reveal: call('library:reveal'), hide: call('window:hide'),
  onFocus: (callback) => { const listener = () => callback(); ipcRenderer.on('window:focus-search', listener); return () => ipcRenderer.removeListener('window:focus-search', listener); }
});
