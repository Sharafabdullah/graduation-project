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
  saveGCode: (lines) => ipcRenderer.invoke('file:save-gcode', lines),
  saveJob: (name, lines) => ipcRenderer.invoke('file:save-job', name, lines),
  getJobs: () => ipcRenderer.invoke('file:get-jobs'),
  openJobsFolder: () => ipcRenderer.invoke('file:open-jobs-folder'),

  // Settings persistence
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Firmware upload (portPath: string, mode: 'pen'|'drill'|'laser')
  // Returns { success, exitCode, log[] }
  uploadFirmware: (portPath, mode) =>
    ipcRenderer.invoke('firmware:upload', { portPath, mode }),

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
  // Streaming avrdude progress lines
  onUploadProgress: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on('firmware:upload-progress', listener);
    return () => ipcRenderer.removeListener('firmware:upload-progress', listener);
  },
});

