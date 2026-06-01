const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('platform', {
  // Serial port operations
  listPorts: () => ipcRenderer.invoke('serial:list-ports'),
  connect: (portPath, baudRate) =>
    ipcRenderer.invoke('serial:connect', { portPath, baudRate }),
  disconnect: () => ipcRenderer.invoke('serial:disconnect'),
  send: (data) => ipcRenderer.invoke('serial:send', data),

  // File operations
  loadGCodeFile: () => ipcRenderer.invoke('file:load-gcode'),
  saveLog: (content) => ipcRenderer.invoke('file:save-log', content),

  // Settings persistence
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Receive data and status events from main process
  onData: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('serial:data', listener);
    return () => ipcRenderer.removeListener('serial:data', listener);
  },
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('serial:status', listener);
    return () => ipcRenderer.removeListener('serial:status', listener);
  },
});
