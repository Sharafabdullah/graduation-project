/* ═══════════════════════════════════════════════════════════════════════════════
   Platform Control — Renderer Process
   All UI event handlers, serial communication logic, and G-code streaming.
   ═══════════════════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  connected: false,
  portPath: '',
  gcodeFiles: [],        // Array of loaded file objects
  selectedFileIndex: -1, // Currently selected file in the list
  gcodeLines: [],        // Parsed G-code lines of selected file
  streaming: false,
  paused: false,
  currentLine: 0,
  totalLines: 0,
  waitingForOk: false,
  position: { x: 0, y: 0 },
  feedRate: 0,
  spindleSpeed: 0,
};

// ── DOM References ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const dom = {
  serialPortSelect: $('serialPortSelect'),
  baudRateInput: $('baudRateInput'),
  connectBtn: $('connectBtn'),
  disconnectBtn: $('disconnectBtn'),
  refreshPortsBtn: $('refreshPortsBtn'),
  connectionStatus: $('connectionStatus'),
  statusText: $('statusText'),
  stepsPerMmX: $('stepsPerMmX'),
  stepsPerMmY: $('stepsPerMmY'),
  enableLimitSwitches: $('enableLimitSwitches'),
  enableHoming: $('enableHoming'),
  saveSettingsBtn: $('saveSettingsBtn'),
  jogIncrement: $('jogIncrement'),
  jogUp: $('jogUp'),
  jogDown: $('jogDown'),
  jogLeft: $('jogLeft'),
  jogRight: $('jogRight'),
  jogCenter: $('jogCenter'),
  goToX: $('goToX'),
  goToY: $('goToY'),
  goBtn: $('goBtn'),
  homeBtn: $('homeBtn'),
  loadGCodeBtn: $('loadGCodeBtn'),
  fileList: $('fileList'),
  progressFill: $('progressFill'),
  progressPercent: $('progressPercent'),
  startBtn: $('startBtn'),
  pauseBtn: $('pauseBtn'),
  resumeBtn: $('resumeBtn'),
  stopBtn: $('stopBtn'),
  consoleOutput: $('consoleOutput'),
  currentX: $('currentX'),
  currentY: $('currentY'),
  feedRate: $('feedRate'),
  spindleSpeed: $('spindleSpeed'),
  rawGcodeInput: $('rawGcodeInput'),
  sendRawBtn: $('sendRawBtn'),
};

// ── Utility Functions ─────────────────────────────────────────────────────────
function timestamp() {
  const now = new Date();
  return `[${now.toTimeString().slice(0, 8)}]`;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function logConsole(message, type = '') {
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  line.textContent = `${timestamp()} ${message}`;
  dom.consoleOutput.appendChild(line);
  dom.consoleOutput.scrollTop = dom.consoleOutput.scrollHeight;

  // Keep only last 200 lines
  while (dom.consoleOutput.children.length > 200) {
    dom.consoleOutput.removeChild(dom.consoleOutput.firstChild);
  }
}

function setConnectionStatus(status, text) {
  const dot = dom.connectionStatus.querySelector('.status-dot');
  dot.className = `status-dot ${status}`;
  dom.statusText.textContent = text;
}

function updateProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  dom.progressFill.style.width = `${pct}%`;
  dom.progressPercent.textContent = `${pct}%`;
}

function updatePositionDisplay() {
  dom.currentX.textContent = `${state.position.x.toFixed(2)} mm`;
  dom.currentY.textContent = `${state.position.y.toFixed(2)} mm`;
  dom.feedRate.textContent = `${state.feedRate} mm/min`;
  dom.spindleSpeed.textContent = `${state.spindleSpeed} RPM`;
}

// ── Serial Communication ──────────────────────────────────────────────────────
async function refreshPorts() {
  const ports = await window.platform.listPorts();
  dom.serialPortSelect.innerHTML = '<option value="">-- Select Port --</option>';
  ports.forEach((port) => {
    const opt = document.createElement('option');
    opt.value = port.path;
    opt.textContent = port.manufacturer
      ? `${port.path} (${port.manufacturer})`
      : port.path;
    dom.serialPortSelect.appendChild(opt);
  });
  if (ports.length === 0) {
    logConsole('No serial ports found.', 'info');
  } else {
    logConsole(`Found ${ports.length} serial port(s).`, 'info');
  }
}

async function connect() {
  const portPath = dom.serialPortSelect.value;
  const baudRate = dom.baudRateInput.value;

  if (!portPath) {
    logConsole('Please select a serial port.', 'error');
    return;
  }

  logConsole(`Connecting to ${portPath} at ${baudRate} baud...`);
  setConnectionStatus('disconnected', `Status: Connecting to ${portPath}...`);

  const result = await window.platform.connect(portPath, baudRate);
  if (result.success) {
    state.connected = true;
    state.portPath = portPath;
    setConnectionStatus('connected', `Status: Connected to ${portPath}`);
    logConsole('Connection successful.', 'received');
  } else {
    setConnectionStatus('error', `Status: Connection failed`);
    logConsole(`Connection failed: ${result.error}`, 'error');
  }
}

async function disconnect() {
  logConsole('Disconnecting...');
  const result = await window.platform.disconnect();
  state.connected = false;
  state.portPath = '';
  setConnectionStatus('disconnected', 'Status: Disconnected');
  if (result.success) {
    logConsole('Disconnected successfully.', 'info');
  }
  // Stop any streaming
  if (state.streaming) {
    stopStreaming();
  }
}

async function sendCommand(cmd) {
  if (!state.connected) {
    logConsole('Not connected. Cannot send command.', 'error');
    return false;
  }
  logConsole(`> ${cmd}`, 'sent');
  const result = await window.platform.send(cmd);
  if (!result.success) {
    logConsole(`Send error: ${result.error}`, 'error');
    return false;
  }
  return true;
}

// ── Incoming Serial Data Handler ──────────────────────────────────────────────
function handleSerialData(data) {
  // Only log if it's a debug message or not just "ok" to avoid spam
  if (data.startsWith('Debug:')) {
    logConsole(data, 'info'); // Using 'info' makes it yellow/warning color
  } else if (data !== 'ok') {
    logConsole(`< ${data}`, 'received');
  }

  // Parse position reports (Marlin/GRBL style): X:10.00 Y:20.00 Z:0.00
  const posMatch = data.match(/X[:\s]?([\d.-]+)\s*Y[:\s]?([\d.-]+)/i);
  if (posMatch) {
    state.position.x = parseFloat(posMatch[1]);
    state.position.y = parseFloat(posMatch[2]);
    updatePositionDisplay();
  }

  // Parse feed rate: F1000
  const feedMatch = data.match(/F[:\s]?([\d.]+)/i);
  if (feedMatch && !data.startsWith('<')) {
    // Only update if it looks like a standalone feed report
  }

  // Parse spindle speed: S12000
  const spindleMatch = data.match(/S[:\s]?([\d.]+)/i);
  if (spindleMatch) {
    state.spindleSpeed = parseInt(spindleMatch[1], 10);
    updatePositionDisplay();
  }

  // GRBL-style status report: <Idle|MPos:0.000,0.000,0.000|FS:0,0>
  const grblMatch = data.match(/<(\w+)\|MPos:([\d.-]+),([\d.-]+),([\d.-]+)\|.*?FS?:([\d.]+)/);
  if (grblMatch) {
    state.position.x = parseFloat(grblMatch[2]);
    state.position.y = parseFloat(grblMatch[3]);
    state.feedRate = parseInt(grblMatch[5], 10);
    updatePositionDisplay();
  }

  // Handle 'ok' response for G-code streaming handshake
  if (data.toLowerCase().startsWith('ok')) {
    state.waitingForOk = false;
    if (state.streaming && !state.paused) {
      sendNextGCodeLine();
    }
  }

  // Handle errors
  if (data.toLowerCase().startsWith('error')) {
    logConsole(`Machine error: ${data}`, 'error');
  }
}

function handleSerialStatus(status) {
  if (status.type === 'disconnected') {
    state.connected = false;
    setConnectionStatus('disconnected', 'Status: Disconnected');
    logConsole('Connection lost.', 'error');
  } else if (status.type === 'error') {
    logConsole(`Serial error: ${status.message}`, 'error');
  }
}

// ── Jog Controls ──────────────────────────────────────────────────────────────
function jog(axis, direction) {
  const increment = parseFloat(dom.jogIncrement.value);
  const value = increment * direction;
  const feedRate = 1000;

  // Use relative positioning
  sendCommand('G91'); // Set relative mode
  sendCommand(`G0 ${axis}${value.toFixed(3)} F${feedRate}`);
  sendCommand('G90'); // Return to absolute mode

  // Optimistically update position
  if (axis === 'X') state.position.x += value;
  if (axis === 'Y') state.position.y += value;
  updatePositionDisplay();
}

function goToPosition() {
  const x = parseFloat(dom.goToX.value);
  const y = parseFloat(dom.goToY.value);
  sendCommand(`G90`); // Absolute mode
  sendCommand(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F1000`);
  state.position.x = x;
  state.position.y = y;
  updatePositionDisplay();
}

function goHome() {
  sendCommand('G28'); // Home all axes
  state.position.x = 0;
  state.position.y = 0;
  updatePositionDisplay();
  logConsole('Homing initiated...', 'info');
}

// ── Machine Settings ──────────────────────────────────────────────────────────
function saveSettings() {
  const settings = {
    stepsPerMmX: dom.stepsPerMmX.value,
    stepsPerMmY: dom.stepsPerMmY.value,
    limitSwitches: dom.enableLimitSwitches.checked,
    homing: dom.enableHoming.checked,
  };

  logConsole('Note: For the custom Main_Firmware, settings (steps/mm, homing) are currently hardcoded in the Arduino sketch.', 'info');
  // If we want to send them to the Arduino dynamically in the future, we could invent custom commands here.
  // Example: sendCommand(`M92 X${settings.stepsPerMmX} Y${settings.stepsPerMmY}`);

  logConsole('Settings saved locally.', 'info');
}

// ── G-Code File Management ────────────────────────────────────────────────────
async function loadGCodeFile() {
  const file = await window.platform.loadGCodeFile();
  if (!file) return; // User cancelled

  // Add to file list
  state.gcodeFiles.push(file);
  renderFileList();
  selectFile(state.gcodeFiles.length - 1);
  logConsole(`Loaded: ${file.name} (${formatSize(file.size)}, ${file.lines} commands)`, 'info');
}

function renderFileList() {
  dom.fileList.innerHTML = '';
  if (state.gcodeFiles.length === 0) {
    dom.fileList.innerHTML = `
      <div class="file-item placeholder-item">
        <span class="file-name">No file loaded</span>
      </div>`;
    return;
  }

  state.gcodeFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = `file-item ${index === state.selectedFileIndex ? 'selected' : ''}`;
    item.innerHTML = `
      <span class="file-name">${file.name}</span>
      <span class="file-size">${formatSize(file.size)}</span>`;
    item.addEventListener('click', () => selectFile(index));
    dom.fileList.appendChild(item);
  });
}

function selectFile(index) {
  state.selectedFileIndex = index;
  const file = state.gcodeFiles[index];
  // Parse G-code: filter out empty lines and comments
  state.gcodeLines = file.content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith(';') && !l.startsWith('('));
  state.totalLines = state.gcodeLines.length;
  state.currentLine = 0;
  updateProgress(0, state.totalLines);
  renderFileList();
}

// ── G-Code Streaming ──────────────────────────────────────────────────────────
function startStreaming() {
  if (state.gcodeLines.length === 0) {
    logConsole('No G-code file loaded.', 'error');
    return;
  }
  if (!state.connected) {
    logConsole('Not connected. Cannot start job.', 'error');
    return;
  }

  state.streaming = true;
  state.paused = false;
  state.currentLine = 0;
  state.waitingForOk = false;
  document.body.classList.add('streaming');
  logConsole(`Starting job: ${state.gcodeFiles[state.selectedFileIndex].name}`, 'info');
  sendNextGCodeLine();
}

function sendNextGCodeLine() {
  if (!state.streaming || state.paused) return;
  if (state.currentLine >= state.totalLines) {
    // Job complete
    state.streaming = false;
    document.body.classList.remove('streaming');
    updateProgress(state.totalLines, state.totalLines);
    logConsole('Job completed!', 'info');
    return;
  }

  const line = state.gcodeLines[state.currentLine];
  state.currentLine++;
  updateProgress(state.currentLine, state.totalLines);

  // Parse feed rate from G-code line for display
  const fMatch = line.match(/F([\d.]+)/i);
  if (fMatch) {
    state.feedRate = parseInt(fMatch[1], 10);
    updatePositionDisplay();
  }

  state.waitingForOk = true;
  sendCommand(line);
}

function pauseStreaming() {
  if (!state.streaming) return;
  state.paused = true;
  logConsole('Job paused.', 'info');
  // Optionally send feed hold
  sendCommand('!'); // GRBL feed hold
}

function resumeStreaming() {
  if (!state.streaming || !state.paused) return;
  state.paused = false;
  logConsole('Job resumed.', 'info');
  sendCommand('~'); // GRBL cycle resume
  if (!state.waitingForOk) {
    sendNextGCodeLine();
  }
}

function stopStreaming() {
  state.streaming = false;
  state.paused = false;
  state.currentLine = 0;
  state.waitingForOk = false;
  document.body.classList.remove('streaming');
  updateProgress(0, state.totalLines);
  logConsole('Job stopped.', 'info');
  // Send reset
  sendCommand('\x18'); // GRBL soft reset
}

// ── Event Listeners ───────────────────────────────────────────────────────────

// Connection
dom.connectBtn.addEventListener('click', connect);
dom.disconnectBtn.addEventListener('click', disconnect);
dom.refreshPortsBtn.addEventListener('click', refreshPorts);

// Machine Settings
dom.saveSettingsBtn.addEventListener('click', saveSettings);

// Jog Controls
dom.jogUp.addEventListener('click', () => jog('Y', 1));
dom.jogDown.addEventListener('click', () => jog('Y', -1));
dom.jogLeft.addEventListener('click', () => jog('X', -1));
dom.jogRight.addEventListener('click', () => jog('X', 1));
dom.jogCenter.addEventListener('click', goHome);

// Go To Position
dom.goBtn.addEventListener('click', goToPosition);
dom.homeBtn.addEventListener('click', goHome);

// G-Code File
dom.loadGCodeBtn.addEventListener('click', loadGCodeFile);
dom.startBtn.addEventListener('click', startStreaming);
dom.pauseBtn.addEventListener('click', pauseStreaming);
dom.resumeBtn.addEventListener('click', resumeStreaming);
dom.stopBtn.addEventListener('click', stopStreaming);

// Raw G-Code Input
dom.sendRawBtn.addEventListener('click', () => {
  const cmd = dom.rawGcodeInput.value.trim();
  if (cmd) {
    if (!state.connected) {
      logConsole('Not connected. Cannot send command.', 'error');
      return;
    }
    sendCommand(cmd);
    dom.rawGcodeInput.value = '';
  }
});

dom.rawGcodeInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    dom.sendRawBtn.click();
  }
});

// Serial data/status listeners
window.platform.onData(handleSerialData);
window.platform.onStatus(handleSerialStatus);

// Keyboard shortcuts for jog
document.addEventListener('keydown', (e) => {
  // Only if not focused on an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  switch (e.key) {
    case 'ArrowUp':    e.preventDefault(); jog('Y', 1); break;
    case 'ArrowDown':  e.preventDefault(); jog('Y', -1); break;
    case 'ArrowLeft':  e.preventDefault(); jog('X', -1); break;
    case 'ArrowRight': e.preventDefault(); jog('X', 1); break;
  }
});

// ── Initialize ────────────────────────────────────────────────────────────────
(async function init() {
  logConsole('Platform Control initialized.', 'info');
  updatePositionDisplay();
  await refreshPorts();
})();
