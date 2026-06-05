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
  const pendingQueueRef = useRef([]);
  const commandMapRef = useRef(new Map());
  const pollInFlightRef = useRef(false);
  const pollIntervalRef = useRef(null);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const logConsole = useCallback((message, type = '') => {
    const now = Date.now();
    const d = new Date(now);
    const ts = d.toTimeString().slice(0, 8);
    setConsoleLog((prev) => {
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
  }, [logConsole, logEvent]);

  // ── Send command ────────────────────────────────────────────────────────────
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
    window.platform.send('!');
  }, [logConsole, logEvent]);

  const resumeStreaming = useCallback(() => {
    if (!streamingRef.current || !pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    setMachineState('Streaming');
    logConsole('Job resumed.', 'info');
    logEvent('resumed', 'Job resumed', 'info');
    window.platform.send('~');
    if (!waitingForOkRef.current) sendNextGCodeLine();
  }, [logConsole, logEvent, sendNextGCodeLine]);

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

  // ── Incoming data ───────────────────────────────────────────────────────────
  useEffect(() => {
    const handleData = (data) => {
      const trimmed = data.trim();
      const isOk = trimmed.toLowerCase() === 'ok';
      const isError = trimmed.toLowerCase().startsWith('error:');

      // Silent auto-poll path — parse state, skip logging and command queue
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

      // Console logging
      if (trimmed.startsWith('Debug:')) {
        logConsole(trimmed, 'info');
      } else if (!isOk) {
        logConsole(`< ${trimmed}`, 'received');
      }

      // Append non-ok lines to front-of-queue command's response
      if (!isOk && pendingQueueRef.current.length > 0) {
        const topId = pendingQueueRef.current[0];
        const entry = commandMapRef.current.get(topId);
        if (entry) entry.response = [...(entry.response || []), trimmed];
      }

      // Finalize on ok
      if (isOk) {
        const topId = pendingQueueRef.current.shift();
        if (topId) {
          const entry = commandMapRef.current.get(topId);
          if (entry) {
            const now = Date.now();
            const updated = { ...entry, status: 'done', ackedAt: now, duration: now - entry.sentAt };
            commandMapRef.current.set(topId, updated);
            setCommandLog((prev) => prev.map((c) => (c.id === topId ? updated : c)));
          }
        }
        waitingForOkRef.current = false;
        if (streamingRef.current && !pausedRef.current) sendNextGCodeLine();
      }

      // Finalize on error
      if (isError) {
        const topId = pendingQueueRef.current.shift();
        if (topId) {
          const entry = commandMapRef.current.get(topId);
          if (entry) {
            const updated = { ...entry, status: 'error', response: [...(entry.response || []), trimmed] };
            commandMapRef.current.set(topId, updated);
            setCommandLog((prev) => prev.map((c) => (c.id === topId ? updated : c)));
          }
        }
        logEvent('error', trimmed, 'critical');
      }

      // Position parsing
      const posMatch = trimmed.match(/X[:\s]?([\d.-]+)\s*Y[:\s]?([\d.-]+)/i);
      if (posMatch) setPosition({ x: parseFloat(posMatch[1]), y: parseFloat(posMatch[2]) });

      // State line parsing (manual ? query)
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

      // Homing events from firmware debug messages
      if (trimmed === 'Homing sequence started...') {
        setMachineState('Homing');
        logEvent('homing_start', 'Homing sequence started', 'info');
      }
      if (trimmed.toLowerCase().includes('homing complete')) {
        setMachineState('Idle');
        logEvent('homing_done', trimmed, 'info');
      }
    };

    const handleStatus = (status) => {
      if (status.type === 'disconnected') {
        setConnected(false);
        setPortPath('');
        logConsole('Connection lost.', 'error');
        logEvent('disconnected', 'Connection lost unexpectedly', 'critical');
      } else if (status.type === 'error') {
        logConsole(`Serial error: ${status.message}`, 'error');
        logEvent('error', `Serial error: ${status.message}`, 'critical');
      }
    };

    const removeDataListener = window.platform.onData(handleData);
    const removeStatusListener = window.platform.onStatus(handleStatus);
    return () => { removeDataListener(); removeStatusListener(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-poll ? every 3s when connected, skip during streaming ──────────────
  useEffect(() => {
    if (!connected) {
      clearInterval(pollIntervalRef.current);
      return;
    }
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
