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

  // Receive data and status events from main process
  onData: (callback) => {
    ipcRenderer.on('serial:data', (_event, data) => callback(data));
  },
  onStatus: (callback) => {
    ipcRenderer.on('serial:status', (_event, status) => callback(status));
  },
});
