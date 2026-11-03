const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('quota', {
  read: () => ipcRenderer.invoke('quota:state'),
  action: name => {
    if (['refresh', 'collapse', 'hide', 'menu', 'details', 'preview', 'leave'].includes(name)) ipcRenderer.send('quota:action', name);
  },
  subscribe: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('quota:changed', listener);
    return () => ipcRenderer.removeListener('quota:changed', listener);
  }
});
