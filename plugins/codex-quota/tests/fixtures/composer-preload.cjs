const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fixture', { quit: () => ipcRenderer.send('fixture:quit') });
