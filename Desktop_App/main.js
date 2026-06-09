const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Create jobs folder
const jobsDir = path.join(app.getPath('userData'), 'jobs');
if (!fs.existsSync(jobsDir)) {
  fs.mkdirSync(jobsDir, { recursive: true });
}

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

// ── IPC: Save G-Code file ─────────────────────────────────────────────────────
ipcMain.handle('file:save-gcode', async (_event, lines) => {
  if (!Array.isArray(lines)) return { success: false, error: 'lines must be an array' };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save G-Code',
    defaultPath: `job-${Date.now()}.gcode`,
    filters: [
      { name: 'G-Code Files', extensions: ['gcode', 'nc'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return { success: false, error: 'Save canceled' };
  try {
    fs.writeFileSync(result.filePath, lines.join('\n'), 'utf-8');
    return { success: true, path: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: Jobs management ───────────────────────────────────────────────────────
ipcMain.handle('file:save-job', async (_event, name, lines) => {
  try {
    // Sanitize name for filename
    const sanitizedName = name.replace(/[^a-z0-9_-]/gi, '_');
    const fileName = `${sanitizedName}-${Date.now()}.gcode`;
    const filePath = path.join(jobsDir, fileName);
    const content = lines.join('\n');
    fs.writeFileSync(filePath, content, 'utf-8');
    
    return {
      success: true,
      job: {
        name,
        path: filePath,
        content: content,
        size: Buffer.byteLength(content, 'utf8'),
        lines: lines.length,
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('file:get-jobs', async () => {
  try {
    const files = fs.readdirSync(jobsDir);
    const jobs = [];
    for (const file of files) {
      if (file.endsWith('.gcode') || file.endsWith('.nc')) {
        const filePath = path.join(jobsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);
        
        // Extract original name from filename if possible, otherwise use filename
        let name = file;
        const match = file.match(/^(.*)-\d+\.gcode$/);
        if (match) {
          name = match[1].replace(/_/g, ' ');
        }

        jobs.push({
          name: name,
          path: filePath,
          content: content,
          size: stats.size,
          lines: content.split('\n').filter(l => l.trim() && !l.trim().startsWith(';')).length,
        });
      }
    }
    return { success: true, jobs };
  } catch (err) {
    return { success: false, error: err.message, jobs: [] };
  }
});

ipcMain.handle('file:open-jobs-folder', async () => {
  try {
    await shell.openPath(jobsDir);
    return { success: true };
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

// ── IPC: Firmware Upload via avrdude ──────────────────────────────────────────
//
// Resolves avrdude from (in order):
//   1. <app>/firmware/avrdude/avrdude.exe  (bundled)
//   2. %LOCALAPPDATA%\Arduino15\packages\arduino\tools\avrdude\...\avrdude.exe
//   3. 'avrdude' on system PATH
//
// Streams stdout/stderr lines back as 'firmware:upload-progress' events.
// Returns { success, exitCode, log[] } when done.

function resolveAvrdude() {
  const bundled = path.join(__dirname, 'firmware', 'avrdude', 'avrdude.exe');
  if (fs.existsSync(bundled)) return { exe: bundled, conf: path.join(path.dirname(bundled), 'avrdude.conf') };

  // Try Arduino15 installation
  const local = process.env.LOCALAPPDATA || '';
  const toolsBase = path.join(local, 'Arduino15', 'packages', 'arduino', 'tools', 'avrdude');
  if (fs.existsSync(toolsBase)) {
    const versions = fs.readdirSync(toolsBase).sort().reverse();
    for (const ver of versions) {
      const exe = path.join(toolsBase, ver, 'bin', 'avrdude.exe');
      const conf = path.join(toolsBase, ver, 'etc', 'avrdude.conf');
      if (fs.existsSync(exe)) return { exe, conf: fs.existsSync(conf) ? conf : null };
    }
  }

  // Fall back to PATH
  return { exe: 'avrdude', conf: null };
}

ipcMain.handle('firmware:upload', async (_event, { portPath, mode }) => {
  const VALID_MODES = ['pen', 'drill', 'laser'];
  if (!VALID_MODES.includes(mode)) {
    return { success: false, error: `Invalid mode: ${mode}` };
  }

  const hexPath = path.join(__dirname, 'firmware', `${mode}.hex`);
  if (!fs.existsSync(hexPath)) {
    return {
      success: false,
      error: `Firmware file not found: ${hexPath}. See Desktop_App/firmware/README.md for instructions to compile from source.`,
    };
  }

  const { exe, conf } = resolveAvrdude();
  const args = [
    '-v',
    '-p', 'atmega2560',
    '-c', 'wiring',
    '-P', portPath,
    '-b', '115200',
    '-D',
    '-U', `flash:w:${hexPath}:i`,
  ];
  if (conf) { args.unshift('-C', conf); }

  const log = [];
  const sendProgress = (line) => {
    log.push(line);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('firmware:upload-progress', line);
    }
  };

  // Close the serial port if it is currently open to release the OS lock on the COM port
  if (serialPort && serialPort.isOpen) {
    sendProgress(`[FIRMWARE] Serial port is currently open. Closing port to allow avrdude access...`);
    await new Promise((resolveClose) => {
      serialPort.close((err) => {
        if (err) {
          sendProgress(`[FIRMWARE] Warning during port close: ${err.message}`);
        } else {
          sendProgress(`[FIRMWARE] Port closed successfully.`);
        }
        serialPort = null;
        resolveClose();
      });
    });
  }

  sendProgress(`[AVRDUDE] Flashing ${mode}.hex to ${portPath}...`);
  sendProgress(`[AVRDUDE] Command: ${exe} ${args.join(' ')}`);

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(exe, args);
    } catch (err) {
      resolve({ success: false, error: `Failed to spawn avrdude: ${err.message}`, log });
      return;
    }

    proc.stdout.on('data', (d) => sendProgress(d.toString().trim()));
    proc.stderr.on('data', (d) => sendProgress(d.toString().trim()));

    proc.on('close', (code) => {
      const success = code === 0;
      sendProgress(success
        ? `[AVRDUDE] Flash complete. Exit code: ${code}`
        : `[AVRDUDE] Flash FAILED. Exit code: ${code}`);
      resolve({ success, exitCode: code, log });
    });

    proc.on('error', (err) => {
      sendProgress(`[AVRDUDE] Error: ${err.message}`);
      resolve({ success: false, error: err.message, log });
    });
  });
});

