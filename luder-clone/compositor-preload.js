// compositor-preload.js — preload for hidden compositor window
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('compositorAPI', {
  onComposite: (cb) => ipcRenderer.on('composite', (_e, data) => cb(data)),
  sendResult: (data) => ipcRenderer.send('composite-result', data),
});
