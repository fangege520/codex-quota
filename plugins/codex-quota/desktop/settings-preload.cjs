'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('quotaSettings', {
  read: () => ipcRenderer.invoke('quota:settings-state'),
  usage: () => ipcRenderer.invoke('quota:settings-usage'),
  change: (key, value) => ipcRenderer.send('quota:settings-action', key, value),
  subscribe: fn => ipcRenderer.on('quota:settings-changed', (_event, state) => fn(state))
});
