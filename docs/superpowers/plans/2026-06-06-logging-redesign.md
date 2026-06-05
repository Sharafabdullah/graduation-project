# Logging & Command Lifecycle Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-command lifecycle tracking, structured event logging, Arduino state sync, G-code preview status coloring with hover tooltips, and a 3-column console page with synchronized chronological scrolling.

**Architecture:** SerialContext gains three data stores (`commandLog`, `eventLog`, `arduinoState`) and a FIFO `pendingQueueRef` that matches incoming `ok`/`error:` responses to sent commands. GCodeJobsPage derives per-line visual status from `commandLog`. ConsolePage becomes a 3-column view (terminal | command queue | events) with a time-cursor scroll sync mechanism.

**Tech Stack:** React 18, Vite, Electron, CSS Grid, lucide-react (already installed). No test runner — verification is `npm run build` (catches import/syntax errors) plus visual inspection.

---

## File Map

| File | Change |
|---|---|
| `Desktop_App/src/contexts/SerialContext.jsx` | Full rewrite — add commandLog, eventLog, arduinoState, pending queue, auto-poll |
| `Desktop_App/src/pages/GCodeJobsPage.jsx` | Targeted edits — add commandLog, streamCommandMap, status classes, tooltip, nav buttons |
| `Desktop_App/src/pages/GCodeJobsPage.css` | Append — status colors, tooltip, nav button, section-header flex styles |
| `Desktop_App/src/pages/ConsolePage.jsx` | Full rewrite — 3-column layout, scroll sync, command queue, event log columns |
| `Desktop_App/src/pages/ConsolePage.css` | Full replacement — 3-column grid, col header/body, badges, event entries, tooltip |

---

## Task 1: Rewrite SerialContext.jsx

**Files:**
- Modify: `Desktop_App/src/contexts/SerialContext.jsx`

- [ ] **Step 1: Replace the entire file with the new implementation**

```jsx
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';

const SerialContext = createContext(null);

function classifyCommand(cmd) {
  const c = cmd.trim();
  if (c === '!' || c === '~' || c === '\x18') return 'control';
  if (c.startsWith('$')) return 'config';
  if (c === '?') return 'query';
  return 'gcode';
}

export function useSerial() {
  const ctx = useContext(SerialContext);
  if (!ctx) throw new Error('useSerial must be used within SerialProvider');
  return ctx;
}

export function SerialProvider({ children }) {
  // ── Connection ──────────────────────────────────────────────────────────────
  const [connected, setConnected] = useState(false);
  const [portPath, setPortPath] = useState('');
  const [ports, setPorts] = useState([]);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [feedRate, setFeedRate] = useState(0);
  const [spindleSpeed, setSpindleSpeed] = useState(0);
  const [machineState, setMachineState] = useState('Idle');

  // ── Streaming ───────────────────────────────────────────────────────────────
  const [streaming, setStreaming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentLine, setCurrentLine] = useState(0);
  const [totalLines, setTotalLines] = useState(0);
  const [gcodeLines, setGcodeLines] = useState([]);

  // ── Log stores ──────────────────────────────────────────────────────────────
  const [consoleLog, setConsoleLog] = useState([]);
  const [commandLog, setCommandLog] = useState([]);
  const [eventLog, setEventLog] = useState([]);

  // ── Arduino state (synced from ? polling) ───────────────────────────────────
  const [arduinoState, setArduinoState] = useState({
    positionMode: 'Abs',
    feedRate: 0,
    servoAngle: 75,
    limX: false,
    limY: false,
  });

  // ── Streaming refs ──────────────────────────────────────────────────────────
  const streamingRef = useRef(false);
  const pausedRef = useRef(false);
  const waitingForOkRef = useRef(false);
  const gcodeLinesRef = useRef([]);
  const currentLineRef = useRef(0);
  const totalLinesRef = useRef(0);

  // ── Command tracking refs ───────────────────────────────────────────────────
  const pendingQueueRef = useRef([]);       // FIFO of command IDs awaiting ok
  const commandMapRef = useRef(new Map());  // id → entry (mutable, for O(1) update)
  const pollInFlightRef = useRef(false);    // true while silent auto-poll ? is pending
  const pollIntervalRef = useRef(null);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const logConsole = useCallback((message, type = '') => {
    const now = Date.now();
    setConsoleLog((prev) => {
      const d = new Date(now);
      const ts = d.toTimeString().slice(0, 8);
      const newLog = [...prev, { message: `[${ts}] ${message}`, type, id: now + Math.random(), timestamp: now }];
      return newLog.length > 500 ? newLog.slice(-500) : newLog;
    });
  }, []);

  const logEvent = useCallback((event, message, level = 'info') => {
    const now = Date.now();
    setEventLog((prev) => {
      const newLog = [...prev, { id: now + Math.random(), timestamp: now, event, message, level }];
      return newLog.length > 500 ? newLog.slice(-500) : newLog;
    });
  }, []);

  const clearConsole = useCallback(() => setConsoleLog([]), []);

  // ── Ports ───────────────────────────────────────────────────────────────────
  const refreshPorts = useCallback(async () => {
    const portList = await window.platform.listPorts();
    setPorts(portList);
    if (portList.length === 0) logConsole('No serial ports found.', 'info');
    else logConsole(`Found ${portList.length} serial port(s).`, 'info');
    return portList;
  }, [logConsole]);

  // ── Connect / Disconnect ────────────────────────────────────────────────────
  const connect = useCallback(async (port, baudRate) => {
    if (!port) { logConsole('Please select a serial port.', 'error'); return false; }
    logConsole(`Connecting to ${port} at ${baudRate} baud...`);
    const result = await window.platform.connect(port, baudRate);
    if (result.success) {
      setConnected(true);
      setPortPath(port);
      logConsole('Connection successful.', 'received');
      logEvent('connected', `Connected to ${port} at ${baudRate} baud`, 'info');
      return true;
    } else {
      logConsole(`Connection failed: ${result.error}`, 'error');
      logEvent('error', `Connection failed: ${result.error}`, 'critical');
      return false;
    }
  }, [logConsole, logEvent]);

  const disconnect = useCallback(async () => {
    logConsole('Disconnecting...');
    const result = await window.platform.disconnect();
    setConnected(false);
    setPortPath('');
    if (result.success) {
      logConsole('Disconnected successfully.', 'info');
      logEvent('disconnected', 'Disconnected from port', 'warning');
    }
    if (streamingRef.current) stopStreaming(); // eslint-disable-line no-use-before-define
  }, [logConsole, logEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Send command (manual / internal) ────────────────────────────────────────
  const sendCommand = useCallback(async (cmd) => {
    if (!connected) { logConsole('Not connected. Cannot send command.', 'error'); return false; }
    logConsole(`> ${cmd}`, 'sent');

    const now = Date.now();
    const id = `cmd-${now}-${Math.random().toString(36).slice(2)}`;
    const entry = {
      id, cmd, lineNum: null,
      sentAt: now, timestamp: now,
      ackedAt: null, duration: null,
      status: 'executing',
      type: classifyCommand(cmd),
      source: 'manual',
      response: [],
    };
    commandMapRef.current.set(id, entry);
    pendingQueueRef.current.push(id);
    setCommandLog((prev) => {
      const next = [...prev, entry];
      return next.length > 1000 ? next.slice(-1000) : next;
    });

    const result = await window.platform.send(cmd);
    if (!result.success) { logConsole(`Send error: ${result.error}`, 'error'); return false; }
    return true;
  }, [connected, logConsole]);

  // ── Streaming ───────────────────────────────────────────────────────────────
  const sendNextGCodeLine = useCallback(() => {
    if (!streamingRef.current || pausedRef.current) return;
    if (currentLineRef.current >= totalLinesRef.current) {
      streamingRef.current = false;
      setStreaming(false);
      setMachineState('Idle');
      setCurrentLine(totalLinesRef.current);
      logConsole('Job completed!', 'info');
      logEvent('job_done', 'Job completed successfully', 'info');
      return;
    }

    const lineNum = currentLineRef.current;
    const line = gcodeLinesRef.current[lineNum];
    currentLineRef.current++;
    setCurrentLine(currentLineRef.current);

    const fMatch = line.match(/F([\d.]+)/i);
    if (fMatch) setFeedRate(parseInt(fMatch[1], 10));

    const now = Date.now();
    const id = `cmd-${now}-${Math.random().toString(36).slice(2)}`;
    const entry = {
      id, cmd: line, lineNum,
      sentAt: now, timestamp: now,
      ackedAt: null, duration: null,
      status: 'executing',
      type: classifyCommand(line),
      source: 'stream',
      response: [],
    };
    commandMapRef.current.set(id, entry);
    pendingQueueRef.current.push(id);
    setCommandLog((prev) => {
      const next = [...prev, entry];
      return next.length > 1000 ? next.slice(-1000) : next;
    });

    logConsole(`> ${line}`, 'sent');
    waitingForOkRef.current = true;
    window.platform.send(line);
  }, [logConsole, logEvent]);

  const startStreaming = useCallback((lines) => {
    if (lines.length === 0) { logConsole('No G-code file loaded.', 'error'); return; }
    if (!connected) { logConsole('Not connected. Cannot start job.', 'error'); return; }

    // Clear command log for fresh job
    setCommandLog([]);
    commandMapRef.current.clear();
    pendingQueueRef.current = [];

    gcodeLinesRef.current = lines;
    totalLinesRef.current = lines.length;
    currentLineRef.current = 0;
    waitingForOkRef.current = false;
    streamingRef.current = true;
    pausedRef.current = false;

    setGcodeLines(lines);
    setTotalLines(lines.length);
    setCurrentLine(0);
    setStreaming(true);
    setPaused(false);
    setMachineState('Streaming');

    logConsole('Starting job...', 'info');
    logEvent('job_start', `Job started — ${lines.length} lines`, 'info');
    sendNextGCodeLine();
  }, [connected, logConsole, logEvent, sendNextGCodeLine]);

  const pauseStreaming = useCallback(() => {
    if (!streamingRef.current) return;
    pausedRef.current = true;
    setPaused(true);
    setMachineState('Paused');
    logConsole('Job paused.', 'info');
    logEvent('paused', 'Job paused by user', 'warning');
    sendCommand('!');
  }, [logConsole, logEvent, sendCommand]);

  const resumeStreaming = useCallback(() => {
    if (!streamingRef.current || !pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    setMachineState('Streaming');
    logConsole('Job resumed.', 'info');
    logEvent('resumed', 'Job resumed', 'info');
    sendCommand('~');
    if (!waitingForOkRef.current) sendNextGCodeLine();
  }, [logConsole, logEvent, sendCommand, sendNextGCodeLine]);

  const stopStreaming = useCallback(() => {
    streamingRef.current = false;
    pausedRef.current = false;
    waitingForOkRef.current = false;
    currentLineRef.current = 0;
    setStreaming(false);
    setPaused(false);
    setCurrentLine(0);
    setMachineState('Idle');
    logConsole('Job stopped.', 'info');
    logEvent('job_stop', 'Job stopped', 'warning');
    if (connected) {
      window.platform.send('\x18');
      logEvent('estop', 'Emergency stop sent to Arduino', 'critical');
    }
  }, [connected, logConsole, logEvent]);

  // ── Incoming data handler ───────────────────────────────────────────────────
  useEffect(() => {
    const handleData = (data) => {
      const trimmed = data.trim();
      const isOk = trimmed.toLowerCase() === 'ok';
      const isError = trimmed.toLowerCase().startsWith('error:');

      // Silent auto-poll path: parse state but skip logging and command queue
      if (pollInFlightRef.current) {
        const posMatch = trimmed.match(/X[:\s]?([\d.-]+)\s*Y[:\s]?([\d.-]+)/i);
        if (posMatch) setPosition({ x: parseFloat(posMatch[1]), y: parseFloat(posMatch[2]) });

        const stateMatch = trimmed.match(/State:(\w+)\s+F:([\d.]+)\s+Servo:([\d.]+)\s+LimX:(\d)\s+LimY:(\d)/i);
        if (stateMatch) {
          setArduinoState({
            positionMode: stateMatch[1],
            feedRate: parseFloat(stateMatch[2]),
            servoAngle: parseFloat(stateMatch[3]),
            limX: stateMatch[4] === '1',
            limY: stateMatch[5] === '1',
          });
          setFeedRate(parseFloat(stateMatch[2]));
        }
        if (isOk) pollInFlightRef.current = false;
        return;
      }

      // ── Console logging ───────────────────────────────────────────────────
      if (trimmed.startsWith('Debug:')) {
        logConsole(trimmed, 'info');
      } else if (!isOk) {
        logConsole(`< ${trimmed}`, 'received');
      }

      // ── Append non-ok data to executing command's response ────────────────
      if (!isOk && pendingQueueRef.current.length > 0) {
        const topId = pendingQueueRef.current[0];
        const entry = commandMapRef.current.get(topId);
        if (entry) entry.response = [...entry.response, trimmed];
      }

      // ── Finalize command on ok ────────────────────────────────────────────
      if (isOk) {
        const topId = pendingQueueRef.current.shift();
        if (topId) {
          const entry = commandMapRef.current.get(topId);
          if (entry) {
            const now = Date.now();
            entry.status = 'done';
            entry.ackedAt = now;
            entry.duration = now - entry.sentAt;
            setCommandLog((prev) => prev.map((c) => (c.id === topId ? { ...entry } : c)));
          }
        }
        waitingForOkRef.current = false;
        if (streamingRef.current && !pausedRef.current) sendNextGCodeLine();
      }

      // ── Finalize command on error ─────────────────────────────────────────
      if (isError) {
        const topId = pendingQueueRef.current.shift();
        if (topId) {
          const entry = commandMapRef.current.get(topId);
          if (entry) {
            entry.status = 'error';
            setCommandLog((prev) => prev.map((c) => (c.id === topId ? { ...entry } : c)));
          }
        }
        logConsole(`Machine error: ${trimmed}`, 'error');
        setEventLog((prev) => {
          const now = Date.now();
          const newLog = [...prev, { id: now + Math.random(), timestamp: now, event: 'error', message: trimmed, level: 'critical' }];
          return newLog.length > 500 ? newLog.slice(-500) : newLog;
        });
      }

      // ── Position parsing ──────────────────────────────────────────────────
      const posMatch = trimmed.match(/X[:\s]?([\d.-]+)\s*Y[:\s]?([\d.-]+)/i);
      if (posMatch) setPosition({ x: parseFloat(posMatch[1]), y: parseFloat(posMatch[2]) });

      // ── State line parsing (manual ? query, not poll) ─────────────────────
      const stateMatch = trimmed.match(/State:(\w+)\s+F:([\d.]+)\s+Servo:([\d.]+)\s+LimX:(\d)\s+LimY:(\d)/i);
      if (stateMatch) {
        setArduinoState({
          positionMode: stateMatch[1],
          feedRate: parseFloat(stateMatch[2]),
          servoAngle: parseFloat(stateMatch[3]),
          limX: stateMatch[4] === '1',
          limY: stateMatch[5] === '1',
        });
        setFeedRate(parseFloat(stateMatch[2]));
      }

      // ── Homing events ─────────────────────────────────────────────────────
      if (trimmed === 'Homing sequence started...') {
        setMachineState('Homing');
        setEventLog((prev) => {
          const now = Date.now();
          return [...prev, { id: now + Math.random(), timestamp: now, event: 'homing_start', message: 'Homing sequence started', level: 'info' }];
        });
      }
      if (trimmed.startsWith('Debug: Homing Complete')) {
        setMachineState('Idle');
        setEventLog((prev) => {
          const now = Date.now();
          return [...prev, { id: now + Math.random(), timestamp: now, event: 'homing_done', message: trimmed, level: 'info' }];
        });
      }
    };

    const handleStatus = (status) => {
      if (status.type === 'disconnected') {
        setConnected(false);
        setPortPath('');
        logConsole('Connection lost.', 'error');
        setEventLog((prev) => {
          const now = Date.now();
          return [...prev, { id: now + Math.random(), timestamp: now, event: 'disconnected', message: 'Connection lost unexpectedly', level: 'critical' }];
        });
      } else if (status.type === 'error') {
        logConsole(`Serial error: ${status.message}`, 'error');
        setEventLog((prev) => {
          const now = Date.now();
          return [...prev, { id: now + Math.random(), timestamp: now, event: 'error', message: `Serial error: ${status.message}`, level: 'critical' }];
        });
      }
    };

    const removeDataListener = window.platform.onData(handleData);
    const removeStatusListener = window.platform.onStatus(handleStatus);
    return () => { removeDataListener(); removeStatusListener(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-poll ? every 3s when connected, skip during streaming ──────────────
  useEffect(() => {
    if (!connected) { clearInterval(pollIntervalRef.current); return; }
    pollIntervalRef.current = setInterval(() => {
      if (streamingRef.current) return;
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      window.platform.send('?');
    }, 3000);
    return () => clearInterval(pollIntervalRef.current);
  }, [connected]);

  // ── Motion helpers ──────────────────────────────────────────────────────────
  const jogWithIncrement = useCallback((axis, direction, increment) => {
    const value = increment * direction;
    sendCommand('G91');
    sendCommand(`G0 ${axis}${value.toFixed(3)} F1000`);
    sendCommand('G90');
    setPosition((prev) => ({
      x: axis === 'X' ? prev.x + value : prev.x,
      y: axis === 'Y' ? prev.y + value : prev.y,
    }));
  }, [sendCommand]);

  const goToPosition = useCallback((x, y) => {
    sendCommand('G90');
    sendCommand(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F1000`);
    setPosition({ x, y });
  }, [sendCommand]);

  const findLimits = useCallback(() => {
    sendCommand('G28');
    setPosition({ x: 0, y: 0 });
    setMachineState('Homing');
    logConsole('Finding physical limit switches...', 'info');
    logEvent('homing_start', 'Homing sequence requested', 'info');
  }, [sendCommand, logConsole, logEvent]);

  const goToOrigin = useCallback(() => {
    sendCommand('G90');
    sendCommand('G0 X0 Y0 F1000');
    setPosition({ x: 0, y: 0 });
    logConsole('Returning to work origin (X0 Y0)...', 'info');
  }, [sendCommand, logConsole]);

  const setZero = useCallback(() => {
    sendCommand('G92 X0 Y0');
    setPosition({ x: 0, y: 0 });
    logConsole('Work origin set to current position.', 'info');
  }, [sendCommand, logConsole]);

  const penUp = useCallback(() => sendCommand('M5'), [sendCommand]);
  const penDown = useCallback(() => sendCommand('M3'), [sendCommand]);
  const setServoAngle = useCallback((angle) => sendCommand(`M280 S${angle}`), [sendCommand]);

  const value = {
    connected, portPath, ports, machineState,
    position, feedRate, spindleSpeed, arduinoState,
    streaming, paused, currentLine, totalLines,
    consoleLog, commandLog, eventLog,
    logConsole, logEvent, clearConsole,
    refreshPorts, connect, disconnect, sendCommand,
    jogWithIncrement, goToPosition, goToOrigin, findLimits, setZero,
    penUp, penDown, setServoAngle,
    startStreaming, pauseStreaming, resumeStreaming, stopStreaming,
  };

  return <SerialContext.Provider value={value}>{children}</SerialContext.Provider>;
}
```

- [ ] **Step 2: Verify build**

```
cd Desktop_App && npm run build
```

Expected: `✓ built in X.XXs` with no errors.

- [ ] **Step 3: Commit**

```
git add Desktop_App/src/contexts/SerialContext.jsx
git commit -m "feat: add commandLog, eventLog, arduinoState, pending queue, auto-poll to SerialContext"
```

---

## Task 2: Update GCodeJobsPage.jsx

**Files:**
- Modify: `Desktop_App/src/pages/GCodeJobsPage.jsx`

- [ ] **Step 1: Update the React import and add useMemo/useRef**

Change line 1 from:
```jsx
import React, { useState } from 'react';
```
To:
```jsx
import React, { useState, useMemo, useRef } from 'react';
```

- [ ] **Step 2: Add commandLog to the useSerial destructuring**

Change:
```jsx
  const {
    connected, streaming, paused, currentLine, totalLines,
    startStreaming, pauseStreaming, resumeStreaming, stopStreaming, logConsole,
  } = useSerial();
```
To:
```jsx
  const {
    connected, streaming, paused, currentLine, totalLines,
    startStreaming, pauseStreaming, resumeStreaming, stopStreaming, logConsole,
    commandLog,
  } = useSerial();
```

- [ ] **Step 3: Add streamCommandMap, helpers, and state after the progressPct line**

After the line `const progressPct = totalLines > 0 ? Math.round((currentLine / totalLines) * 100) : 0;`, add:

```jsx
  // Build a map from lineNum → commandEntry for O(1) status lookups
  const streamCommandMap = useMemo(() => {
    const map = new Map();
    commandLog.forEach((cmd) => {
      if (cmd.source === 'stream' && cmd.lineNum != null) {
        map.set(cmd.lineNum, cmd);
      }
    });
    return map;
  }, [commandLog]);

  const getLineStatus = (i) => {
    const cmd = streamCommandMap.get(i);
    if (!cmd) return streaming ? 'queued' : '';
    return cmd.status; // 'executing' | 'done' | 'error'
  };

  const formatTimestamp = (ts) => {
    const d = new Date(ts);
    return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  };

  const [hoveredCmd, setHoveredCmd] = useState(null); // { cmd, x, y }
  const previewRef = useRef(null);

  const scrollToExecuting = () => {
    let execIdx = null;
    streamCommandMap.forEach((cmd, idx) => { if (cmd.status === 'executing') execIdx = idx; });
    if (execIdx == null) return;
    previewRef.current?.querySelector(`[data-line="${execIdx}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const scrollToLastDone = () => {
    let lastIdx = -1;
    streamCommandMap.forEach((cmd, idx) => { if (cmd.status === 'done' && idx > lastIdx) lastIdx = idx; });
    if (lastIdx === -1) return;
    previewRef.current?.querySelector(`[data-line="${lastIdx}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
```

- [ ] **Step 4: Replace the preview card section**

Find and replace the entire `{/* Right panel: G-code preview */}` div. Replace:

```jsx
        {/* Right panel: G-code preview */}
        <div className="card gcode-preview-card">
          <h2 className="section-header">
            G-Code Preview
            {selectedFile && (
              <span className="preview-filename"> — {selectedFile.name}</span>
            )}
          </h2>
          <div className="gcode-preview">
            {previewLines.length === 0 ? (
              <div className="preview-placeholder">Select a file to preview its G-code content</div>
            ) : (
              previewLines.map((line, i) => (
                <div
                  key={i}
                  className={`preview-line ${streaming && i < currentLine ? 'executed' : ''} ${streaming && i === currentLine ? 'current' : ''}`}
                >
                  <span className="line-number">{i + 1}</span>
                  <span className="line-content">{line}</span>
                </div>
              ))
            )}
          </div>
        </div>
```

With:

```jsx
        {/* Right panel: G-code preview */}
        <div className="card gcode-preview-card">
          <div className="preview-header">
            <h2 className="section-header" style={{ margin: 0 }}>
              G-Code Preview
              {selectedFile && <span className="preview-filename"> — {selectedFile.name}</span>}
            </h2>
            {streaming && (
              <div className="preview-nav-buttons">
                <button className="btn btn-sm btn-ghost" onClick={scrollToExecuting}>
                  ↑ Executing
                </button>
                <button className="btn btn-sm btn-ghost" onClick={scrollToLastDone}>
                  ↑ Last Done
                </button>
              </div>
            )}
          </div>
          <div className="gcode-preview" ref={previewRef}>
            {previewLines.length === 0 ? (
              <div className="preview-placeholder">Select a file to preview its G-code content</div>
            ) : (
              previewLines.map((line, i) => {
                const status = getLineStatus(i);
                const cmd = streamCommandMap.get(i);
                return (
                  <div
                    key={i}
                    data-line={i}
                    className={`preview-line${status ? ` status-${status}` : ''}`}
                    onMouseEnter={(e) => {
                      if (!cmd || cmd.status === 'queued') return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHoveredCmd({ cmd, x: rect.right + 8, y: rect.top });
                    }}
                    onMouseLeave={() => setHoveredCmd(null)}
                  >
                    <span className="line-number">{i + 1}</span>
                    <span className="line-content">{line}</span>
                  </div>
                );
              })
            )}
          </div>
          {hoveredCmd && (
            <div
              className="preview-tooltip"
              style={{ position: 'fixed', left: hoveredCmd.x, top: hoveredCmd.y, zIndex: 1000 }}
            >
              <div className="tooltip-cmd">{hoveredCmd.cmd.cmd}</div>
              <div className="tooltip-row">
                <span>Sent:</span><span>{formatTimestamp(hoveredCmd.cmd.sentAt)}</span>
              </div>
              {hoveredCmd.cmd.ackedAt ? (
                <>
                  <div className="tooltip-row">
                    <span>Acked:</span><span>{formatTimestamp(hoveredCmd.cmd.ackedAt)}</span>
                  </div>
                  <div className="tooltip-row">
                    <span>Duration:</span><span>{hoveredCmd.cmd.duration}ms</span>
                  </div>
                </>
              ) : (
                <div className="tooltip-row">
                  <span>Acked:</span><span className="tooltip-pending">Pending…</span>
                </div>
              )}
              {hoveredCmd.cmd.response.length > 0 && (
                <div className="tooltip-row">
                  <span>Response:</span>
                  <span>{hoveredCmd.cmd.response.join(' | ')}</span>
                </div>
              )}
            </div>
          )}
        </div>
```

- [ ] **Step 5: Verify build**

```
cd Desktop_App && npm run build
```

Expected: `✓ built in X.XXs` with no errors.

- [ ] **Step 6: Commit**

```
git add Desktop_App/src/pages/GCodeJobsPage.jsx
git commit -m "feat: add per-line status coloring, hover tooltip, and nav buttons to GCodeJobsPage"
```

---

## Task 3: Update GCodeJobsPage.css

**Files:**
- Modify: `Desktop_App/src/pages/GCodeJobsPage.css`

- [ ] **Step 1: Remove old status classes and append new ones**

Remove these existing rules (they conflict with the new status system):
```css
.preview-line.executed {
  opacity: 0.4;
}

.preview-line.current {
  background: var(--accent-subtle);
  border-left: 2px solid var(--accent);
}
```

Then append to the end of the file:

```css
/* ── Preview header (title + nav buttons) ──────────────────────────────────── */
.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.preview-nav-buttons {
  display: flex;
  gap: 6px;
}

/* ── Preview line status colors ─────────────────────────────────────────────── */
.preview-line.status-queued {
  opacity: 0.55;
}

.preview-line.status-executing {
  background: rgba(251, 191, 36, 0.12);
  border-left: 3px solid #fbbf24;
  animation: pulse-executing 1.6s ease-in-out infinite;
}

.preview-line.status-done {
  opacity: 0.45;
}

.preview-line.status-done .line-content {
  color: #4ade80;
}

.preview-line.status-error {
  background: rgba(239, 68, 68, 0.15);
  border-left: 3px solid #ef4444;
}

.preview-line.status-error .line-content {
  color: #ef4444;
}

@keyframes pulse-executing {
  0%, 100% { background: rgba(251, 191, 36, 0.12); }
  50%       { background: rgba(251, 191, 36, 0.24); }
}

/* ── Hover tooltip ───────────────────────────────────────────────────────────── */
.preview-tooltip {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  min-width: 220px;
  max-width: 340px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  font-size: 12px;
  font-family: var(--font-mono);
  pointer-events: none;
}

.tooltip-cmd {
  color: var(--text-primary);
  font-weight: 600;
  margin-bottom: 8px;
  word-break: break-all;
}

.tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-secondary);
  margin-top: 3px;
}

.tooltip-row span:first-child {
  color: var(--text-muted);
  flex-shrink: 0;
}

.tooltip-pending {
  color: #fbbf24;
  font-style: italic;
}
```

- [ ] **Step 2: Verify build**

```
cd Desktop_App && npm run build
```

Expected: `✓ built in X.XXs` with no errors.

- [ ] **Step 3: Commit**

```
git add Desktop_App/src/pages/GCodeJobsPage.css
git commit -m "feat: add status colors, tooltip, and nav button styles to GCodeJobsPage"
```

---

## Task 4: Rewrite ConsolePage.jsx

**Files:**
- Modify: `Desktop_App/src/pages/ConsolePage.jsx`

- [ ] **Step 1: Replace the entire file**

```jsx
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSerial } from '../contexts/SerialContext';
import './ConsolePage.css';

const QUICK_COMMANDS = [
  { label: 'G28 Home', cmd: 'G28' },
  { label: 'M3 Head Down', cmd: 'M3' },
  { label: 'M5 Head Up', cmd: 'M5' },
  { label: 'G90 Abs', cmd: 'G90' },
  { label: 'G91 Rel', cmd: 'G91' },
  { label: '? Status', cmd: '?' },
  { label: '$? Settings', cmd: '$?' },
];

const EVENT_ICONS = {
  connected: '✓',
  disconnected: '✕',
  job_start: '▶',
  job_done: '✓',
  job_stop: '⏹',
  paused: '⏸',
  resumed: '▶',
  estop: '⛔',
  homing_start: '⌂',
  homing_done: '⌂',
  error: '✕',
};

function formatTimestamp(ts) {
  const d = new Date(ts);
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function CmdTooltip({ cmd, x, y }) {
  return (
    <div className="cmd-tooltip" style={{ left: x, top: y }}>
      <div className="tooltip-cmd">{cmd.cmd}</div>
      <div className="tooltip-row"><span>Sent:</span><span>{formatTimestamp(cmd.sentAt)}</span></div>
      {cmd.ackedAt ? (
        <>
          <div className="tooltip-row"><span>Acked:</span><span>{formatTimestamp(cmd.ackedAt)}</span></div>
          <div className="tooltip-row"><span>Duration:</span><span>{cmd.duration}ms</span></div>
        </>
      ) : (
        <div className="tooltip-row"><span>Acked:</span><span className="tooltip-pending">Pending…</span></div>
      )}
      {cmd.response.length > 0 && (
        <div className="tooltip-row tooltip-response">
          <span>Response:</span><span>{cmd.response.join(' | ')}</span>
        </div>
      )}
    </div>
  );
}

export default function ConsolePage() {
  const {
    consoleLog, commandLog, eventLog,
    logConsole, clearConsole, sendCommand, connected,
  } = useSerial();

  const [input, setInput] = useState('');
  const [showOk, setShowOk] = useState(false);
  const [showDebug, setShowDebug] = useState(true);
  const [cmdTypeFilter, setCmdTypeFilter] = useState('all');
  const [cmdStatusFilter, setCmdStatusFilter] = useState('all');
  const [eventLevelFilter, setEventLevelFilter] = useState('all');
  const [hoveredCmd, setHoveredCmd] = useState(null);

  const terminalRef = useRef(null);
  const commandRef = useRef(null);
  const eventRef = useRef(null);
  const terminalEndRef = useRef(null);
  const inputRef = useRef(null);
  const cursorTimestampRef = useRef(null);
  const isSyncingRef = useRef(false);

  // ── Filtered data ────────────────────────────────────────────────────────────
  const filteredConsole = useMemo(() => consoleLog.filter((e) => {
    if (!showOk && e.message.includes('< ok')) return false;
    if (!showDebug && e.message.includes('Debug:')) return false;
    return true;
  }), [consoleLog, showOk, showDebug]);

  const filteredCommands = useMemo(() => commandLog.filter((cmd) => {
    if (cmdTypeFilter !== 'all' && cmd.type !== cmdTypeFilter) return false;
    if (cmdStatusFilter !== 'all' && cmd.status !== cmdStatusFilter) return false;
    return true;
  }), [commandLog, cmdTypeFilter, cmdStatusFilter]);

  const filteredEvents = useMemo(() => eventLog.filter((e) => {
    if (eventLevelFilter !== 'all' && e.level !== eventLevelFilter) return false;
    return true;
  }), [eventLog, eventLevelFilter]);

  // ── Auto-scroll terminal to bottom on new messages ───────────────────────────
  useEffect(() => {
    if (!isSyncingRef.current && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredConsole]);

  // ── Scroll sync helpers ──────────────────────────────────────────────────────
  const getTimestampAtTop = (containerRef) => {
    if (!containerRef.current) return null;
    const containerRect = containerRef.current.getBoundingClientRect();
    const children = Array.from(containerRef.current.children);
    for (const child of children) {
      if (!child.dataset.ts) continue;
      const rect = child.getBoundingClientRect();
      if (rect.bottom > containerRect.top) return parseInt(child.dataset.ts, 10);
    }
    return null;
  };

  const scrollColumnToTimestamp = (containerRef, ts) => {
    if (!containerRef.current || !ts) return;
    const children = Array.from(containerRef.current.children).filter((c) => c.dataset.ts);
    let nearestEl = null;
    for (const child of children) {
      if (parseInt(child.dataset.ts, 10) <= ts) nearestEl = child;
      else break;
    }
    if (nearestEl) nearestEl.scrollIntoView({ block: 'start' });
  };

  // Use ref-backed debounced handlers so the debounce timer survives re-renders
  const terminalScrollFn = useRef(null);
  terminalScrollFn.current = () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    const ts = getTimestampAtTop(terminalRef);
    if (ts) {
      cursorTimestampRef.current = ts;
      scrollColumnToTimestamp(commandRef, ts);
      scrollColumnToTimestamp(eventRef, ts);
    }
    setTimeout(() => { isSyncingRef.current = false; }, 100);
  };

  const commandScrollFn = useRef(null);
  commandScrollFn.current = () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    const ts = getTimestampAtTop(commandRef);
    if (ts) {
      cursorTimestampRef.current = ts;
      scrollColumnToTimestamp(terminalRef, ts);
      scrollColumnToTimestamp(eventRef, ts);
    }
    setTimeout(() => { isSyncingRef.current = false; }, 100);
  };

  const eventScrollFn = useRef(null);
  eventScrollFn.current = () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    const ts = getTimestampAtTop(eventRef);
    if (ts) {
      cursorTimestampRef.current = ts;
      scrollColumnToTimestamp(terminalRef, ts);
      scrollColumnToTimestamp(commandRef, ts);
    }
    setTimeout(() => { isSyncingRef.current = false; }, 100);
  };

  const handleTerminalScroll = useCallback(debounce(() => terminalScrollFn.current?.(), 50), []);
  const handleCommandScroll = useCallback(debounce(() => commandScrollFn.current?.(), 50), []);
  const handleEventScroll = useCallback(debounce(() => eventScrollFn.current?.(), 50), []);

  // ── Input ────────────────────────────────────────────────────────────────────
  const handleSend = () => {
    const cmd = input.trim();
    if (!cmd || !connected) return;
    sendCommand(cmd);
    setInput('');
    inputRef.current?.focus();
  };

  const handleExport = async () => {
    const content = consoleLog.map((e) => e.message).join('\n');
    const result = await window.platform.saveLog(content);
    if (result.success) logConsole(`Log exported to: ${result.path}`, 'info');
  };

  return (
    <div className="page console-page-v2">
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="page-title">Console</h1>
            <p className="page-subtitle">Serial terminal · Command queue · Event log</p>
          </div>
          <div className="console-toolbar">
            <button className="btn btn-sm btn-ghost" onClick={clearConsole}>Clear Terminal</button>
            <button className="btn btn-sm btn-ghost" onClick={handleExport}>Export</button>
          </div>
        </div>
      </div>

      {/* Quick commands */}
      <div className="quick-commands">
        {QUICK_COMMANDS.map((qc) => (
          <button key={qc.cmd} className="btn btn-sm btn-ghost"
            onClick={() => { if (connected) sendCommand(qc.cmd); }}
            disabled={!connected}
          >
            {qc.label}
          </button>
        ))}
      </div>

      {/* 3-column grid */}
      <div className="console-grid">

        {/* Column 1 — Serial Terminal */}
        <div className="console-col">
          <div className="col-header">
            <span className="col-title">Serial Terminal</span>
            <div className="col-filters">
              <label className="filter-toggle">
                <input type="checkbox" checked={showOk} onChange={(e) => setShowOk(e.target.checked)} />
                <span>ok</span>
              </label>
              <label className="filter-toggle">
                <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
                <span>Debug</span>
              </label>
            </div>
          </div>
          <div className="col-body" ref={terminalRef} onScroll={handleTerminalScroll}>
            {filteredConsole.map((entry) => (
              <div key={entry.id} className={`console-line ${entry.type}`} data-ts={entry.timestamp}>
                {entry.message}
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>
        </div>

        {/* Column 2 — Command Queue */}
        <div className="console-col">
          <div className="col-header">
            <span className="col-title">Command Queue</span>
            <div className="col-filters">
              <select value={cmdTypeFilter} onChange={(e) => setCmdTypeFilter(e.target.value)} className="filter-select">
                <option value="all">All types</option>
                <option value="gcode">G-code</option>
                <option value="control">Control</option>
                <option value="config">Config</option>
                <option value="query">Query</option>
              </select>
              <select value={cmdStatusFilter} onChange={(e) => setCmdStatusFilter(e.target.value)} className="filter-select">
                <option value="all">All status</option>
                <option value="executing">Executing</option>
                <option value="done">Done</option>
                <option value="error">Error</option>
              </select>
            </div>
          </div>
          <div className="col-body" ref={commandRef} onScroll={handleCommandScroll}>
            {filteredCommands.map((cmd) => (
              <div
                key={cmd.id}
                className={`cmd-entry type-${cmd.type} status-${cmd.status}`}
                data-ts={cmd.timestamp}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredCmd({ cmd, x: rect.right + 8, y: rect.top });
                }}
                onMouseLeave={() => setHoveredCmd(null)}
              >
                <span className={`cmd-badge badge-${cmd.status}`}>
                  {cmd.status === 'executing' ? '●' : cmd.status === 'done' ? '✓' : cmd.status === 'error' ? '✕' : '○'}
                </span>
                <span className="cmd-text">{cmd.cmd}</span>
                {cmd.duration != null && <span className="cmd-duration">{cmd.duration}ms</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Column 3 — Event Log */}
        <div className="console-col">
          <div className="col-header">
            <span className="col-title">Event Log</span>
            <div className="col-filters">
              <select value={eventLevelFilter} onChange={(e) => setEventLevelFilter(e.target.value)} className="filter-select">
                <option value="all">All levels</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div className="col-body" ref={eventRef} onScroll={handleEventScroll}>
            {filteredEvents.map((ev) => (
              <div key={ev.id} className={`event-entry level-${ev.level}`} data-ts={ev.timestamp}>
                <span className="event-icon">{EVENT_ICONS[ev.event] || '•'}</span>
                <div className="event-body">
                  <span className="event-message">{ev.message}</span>
                  <span className="event-time">{new Date(ev.timestamp).toTimeString().slice(0, 8)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Tooltip (fixed position, above everything) */}
      {hoveredCmd && <CmdTooltip cmd={hoveredCmd.cmd} x={hoveredCmd.x} y={hoveredCmd.y} />}

      {/* Input row */}
      <div className="console-input-row">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
          placeholder="Enter G-code command (e.g., G28, M3 S90, $?)"
          className="console-input"
        />
        <button className="btn btn-primary" onClick={handleSend} disabled={!connected}>Send</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```
cd Desktop_App && npm run build
```

Expected: `✓ built in X.XXs` with no errors.

- [ ] **Step 3: Commit**

```
git add Desktop_App/src/pages/ConsolePage.jsx
git commit -m "feat: redesign ConsolePage as 3-column view with scroll sync"
```

---

## Task 5: Rewrite ConsolePage.css

**Files:**
- Modify: `Desktop_App/src/pages/ConsolePage.css`

- [ ] **Step 1: Replace the entire file**

```css
/* ── Page shell ─────────────────────────────────────────────────────────────── */
.console-page-v2 {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.console-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.filter-toggle input[type="checkbox"] {
  width: 14px;
  height: 14px;
}

.filter-select {
  height: 24px;
  font-size: 11px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  padding: 0 4px;
  cursor: pointer;
}

.quick-commands {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.quick-commands .btn:disabled {
  opacity: 0.35;
}

/* ── 3-column grid ───────────────────────────────────────────────────────────── */
.console-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.console-col {
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  min-height: 0;
}

/* ── Column header ───────────────────────────────────────────────────────────── */
.col-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
  flex-shrink: 0;
  gap: 8px;
}

.col-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--text-muted);
  white-space: nowrap;
}

.col-filters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* ── Column body (scrollable) ────────────────────────────────────────────────── */
.col-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  font-size: 12px;
  font-family: var(--font-mono);
}

/* ── Serial terminal lines ───────────────────────────────────────────────────── */
.console-line {
  padding: 2px 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary);
}

.console-line.sent     { color: #60a5fa; }
.console-line.received { color: #4ade80; }
.console-line.info     { color: var(--text-muted); }
.console-line.error    { color: #f87171; }

/* ── Command queue entries ───────────────────────────────────────────────────── */
.cmd-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-left: 3px solid transparent;
  cursor: default;
  transition: background 0.1s;
}

.cmd-entry:hover {
  background: var(--bg-hover);
}

/* Type left-border tints */
.cmd-entry.type-gcode   { border-left-color: #3b82f6; }
.cmd-entry.type-control { border-left-color: #f97316; }
.cmd-entry.type-config  { border-left-color: #a855f7; }
.cmd-entry.type-query   { border-left-color: #6b7280; }

/* Status badge */
.cmd-badge {
  font-size: 11px;
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}

.badge-executing { color: #fbbf24; }
.badge-done      { color: #4ade80; }
.badge-error     { color: #f87171; }
.badge-skipped   { color: var(--text-muted); }

/* Status row tints */
.cmd-entry.status-executing { background: rgba(251, 191, 36, 0.07); }
.cmd-entry.status-error     { background: rgba(239, 68, 68, 0.08); }

.cmd-text {
  flex: 1;
  color: var(--text-primary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cmd-duration {
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* ── Event log entries ───────────────────────────────────────────────────────── */
.event-entry {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 12px;
  border-left: 3px solid transparent;
}

.event-entry.level-info     { border-left-color: #6b7280; }
.event-entry.level-warning  { border-left-color: #f59e0b; background: rgba(245, 158, 11, 0.05); }
.event-entry.level-critical { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.08); }

.event-icon {
  font-size: 12px;
  flex-shrink: 0;
  margin-top: 1px;
}

.event-entry.level-info     .event-icon { color: var(--text-muted); }
.event-entry.level-warning  .event-icon { color: #f59e0b; }
.event-entry.level-critical .event-icon { color: #ef4444; }

.event-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.event-message {
  font-size: 12px;
  color: var(--text-primary);
  font-family: var(--font);
  word-break: break-word;
}

.event-time {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* ── Command tooltip (fixed position) ───────────────────────────────────────── */
.cmd-tooltip {
  position: fixed;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  min-width: 220px;
  max-width: 340px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  font-size: 12px;
  font-family: var(--font-mono);
  pointer-events: none;
  z-index: 9999;
}

.tooltip-cmd {
  color: var(--text-primary);
  font-weight: 600;
  margin-bottom: 8px;
  word-break: break-all;
}

.tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-secondary);
  margin-top: 3px;
}

.tooltip-row span:first-child {
  color: var(--text-muted);
  flex-shrink: 0;
}

.tooltip-pending {
  color: #fbbf24;
  font-style: italic;
}

.tooltip-response {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

/* ── Input row ───────────────────────────────────────────────────────────────── */
.console-input-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-shrink: 0;
}

.console-input {
  flex: 1;
  height: 36px;
  font-family: var(--font-mono);
}

/* ── Responsive collapse ─────────────────────────────────────────────────────── */
@media (max-width: 1100px) {
  .console-grid {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }
  .console-col:last-child {
    grid-column: 1 / -1;
  }
}
```

- [ ] **Step 2: Verify build**

```
cd Desktop_App && npm run build
```

Expected: `✓ built in X.XXs` with no errors.

- [ ] **Step 3: Commit**

```
git add Desktop_App/src/pages/ConsolePage.css
git commit -m "feat: add 3-column console styles with command queue and event log"
```

---

## Self-Review Notes

- `classifyCommand` is module-level (outside component) — no stale closure risk.
- `pollInFlightRef` gates the `handleData` handler so auto-poll `?` responses are parsed for state but never logged or entered into the command queue.
- `sendNextGCodeLine` creates commandLog entries with `source: 'stream'` and the correct `lineNum` (index into `previewLines`). `startStreaming` clears `commandLog` so previous job entries don't bleed into the new job's preview coloring.
- Scroll sync uses ref-backed debounced functions (`terminalScrollFn.current`, etc.) so the debounce timer is stable across re-renders but the handler always reads fresh state.
- The `disconnect` callback calls `stopStreaming` before it's defined in source order — this is safe in JS (all `useCallback`s are initialized before any runs) and matches the original pattern.
- `data-ts` attributes on every rendered row enable the `getTimestampAtTop` DOM traversal without needing virtualized lists.
