const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let serialPort = null;
let SerialPort, ReadlineParser;

// Dynamically load serialport (graceful fallback if not installed)
try {
  const sp = require('serialport');
  SerialPort = sp.SerialPort;
  ReadlineParser = sp.ReadlineParser;
} catch (e) {
  console.warn('serialport module not found. Serial features will be simulated.');
}

// Settings file path
const settingsPath = path.join(app.getPath('userData'), 'machine-settings.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    title: 'Platform Control',
    backgroundColor: '#1E1E1E',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
  });

  // In dev mode, load the Vite dev server; in production load the dist build
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
  }
  app.quit();
});

// ── IPC: List available serial ports ──────────────────────────────────────────
ipcMain.handle('serial:list-ports', async () => {
  if (!SerialPort) return [];
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || '',
      vendorId: p.vendorId || '',
    }));
  } catch (err) {
    console.error('Error listing ports:', err);
    return [];
  }
});

// ── IPC: Connect to a serial port ─────────────────────────────────────────────
ipcMain.handle('serial:connect', async (_event, { portPath, baudRate }) => {
  if (!SerialPort) {
    return { success: false, error: 'serialport module not installed. Run: npm install serialport' };
  }

  // Close existing connection
  if (serialPort && serialPort.isOpen) {
    try { serialPort.close(); } catch (e) { /* ignore */ }
  }

  return new Promise((resolve) => {
    try {
      serialPort = new SerialPort({
        path: portPath,
        baudRate: parseInt(baudRate, 10),
      });

      const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

      serialPort.on('open', () => {
        resolve({ success: true });
      });

      parser.on('data', (data) => {
        const line = data.toString().trim();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('serial:data', line);
        }
      });

      serialPort.on('error', (err) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('serial:status', {
            type: 'error',
            message: err.message,
          });
        }
      });

      serialPort.on('close', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('serial:status', {
            type: 'disconnected',
            message: 'Port closed',
          });
        }
      });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

// ── IPC: Disconnect serial port ───────────────────────────────────────────────
ipcMain.handle('serial:disconnect', async () => {
  if (serialPort && serialPort.isOpen) {
    return new Promise((resolve) => {
      serialPort.close((err) => {
        serialPort = null;
        resolve({ success: !err, error: err ? err.message : null });
      });
    });
  }
  serialPort = null;
  return { success: true };
});

// ── IPC: Send data over serial ────────────────────────────────────────────────
ipcMain.handle('serial:send', async (_event, data) => {
  if (!serialPort || !serialPort.isOpen) {
    return { success: false, error: 'Not connected' };
  }
  return new Promise((resolve) => {
    serialPort.write(data + '\n', (err) => {
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        serialPort.drain(() => resolve({ success: true }));
      }
    });
  });
});

// ── IPC: Load G-Code file via dialog ──────────────────────────────────────────
ipcMain.handle('file:load-gcode', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Load G-Code File',
    filters: [
      { name: 'G-Code Files', extensions: ['gcode', 'nc', 'ngc', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  const stats = fs.statSync(filePath);

  return {
    name: path.basename(filePath),
    path: filePath,
    content: content,
    size: stats.size,
    lines: content.split('\n').filter(l => l.trim() && !l.trim().startsWith(';')).length,
  };
});

// ── IPC: Save console log to file ─────────────────────────────────────────────
ipcMain.handle('file:save-log', async (_event, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Console Log',
    defaultPath: `console-log-${Date.now()}.txt`,
    filters: [
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled) return { success: false };

  try {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { success: true, path: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: Settings persistence ─────────────────────────────────────────────────
ipcMain.handle('settings:load', async () => {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
  return null;
});

ipcMain.handle('settings:save', async (_event, settings) => {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
