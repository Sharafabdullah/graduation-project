import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { useSettings } from './SettingsContext';
import { isInWarnZone, wouldExceedPositiveLimit } from '../lib/softLimits';

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
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // ── Connection ──────────────────────────────────────────────────────────────
  const [connected, setConnected] = useState(false);
  const [portPath, setPortPath] = useState('');
  const [selectedPort, setSelectedPort] = useState('');
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

  // ── Job history ─────────────────────────────────────────────────────────────
  const [jobHistory, setJobHistory] = useState([]);
  const currentJobIdRef = useRef(null);
  const currentJobNameRef = useRef('');
  const jobStartedAtRef = useRef(null);

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
  const pendingWaitMapRef = useRef(new Map()); // commandId → resolve fn

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const logConsole = useCallback((message, type = '') => {
    const now = Date.now();
    const d = new Date(now);
    const ts = d.toTimeString().slice(0, 8);
    const jobId = currentJobIdRef.current;
    setConsoleLog((prev) => {
      const newLog = [...prev, { message: `[${ts}] ${message}`, type, id: now + Math.random(), timestamp: now, jobId }];
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

  const addJobHistory = useCallback((entry) => {
    setJobHistory((prev) => {
      const next = [...prev, entry];
      return next.length > 100 ? next.slice(-100) : next;
    });
  }, []);

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

  const sendAndWait = useCallback((cmd) => {
    return new Promise((resolve, reject) => {
      if (!connected) { reject(new Error('Not connected')); return; }
      const now = Date.now();
      const id = `cmd-${now}-${Math.random().toString(36).slice(2)}`;
      pendingWaitMapRef.current.set(id, { resolve, reject });
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
      window.platform.send(cmd).then(result => {
        if (!result || !result.success) {
          pendingWaitMapRef.current.delete(id);
          pendingQueueRef.current = pendingQueueRef.current.filter(x => x !== id);
          logConsole(`> ${cmd} [send failed]`, 'error');
          reject(new Error(result?.error || 'Send failed'));
        } else {
          logConsole(`> ${cmd}`, 'sent');
        }
      }).catch(err => {
        pendingWaitMapRef.current.delete(id);
        pendingQueueRef.current = pendingQueueRef.current.filter(x => x !== id);
        reject(err);
      });
    });
  }, [connected, logConsole]);

  // ── Streaming ───────────────────────────────────────────────────────────────
  const sendNextGCodeLine = useCallback(() => {
    if (!streamingRef.current || pausedRef.current) return;

    while (currentLineRef.current < totalLinesRef.current) {
      const candidate = gcodeLinesRef.current[currentLineRef.current];
      const upper = candidate.trim().toUpperCase();
      if (upper.startsWith('G0') || upper.startsWith('G1')) {
        const xM = upper.match(/X([-\d.]+)/);
        const yM = upper.match(/Y([-\d.]+)/);
        if (xM || yM) {
          const s = settingsRef.current;
          const x = xM ? parseFloat(xM[1]) : null;
          const y = yM ? parseFloat(yM[1]) : null;
          if (isInWarnZone(x, y, {
            bedMaxX: s?.bedMaxX || 200,
            bedMaxY: s?.bedMaxY || 200,
            softLimitMargin: s?.softLimitMargin || 10,
          })) {
            logConsole(`Skipped out-of-bounds line: ${candidate.trim()}`, 'warning');
            currentLineRef.current++;
            setCurrentLine(currentLineRef.current);
            continue;
          }
        }
      }
      break;
    }

    if (currentLineRef.current >= totalLinesRef.current) {
      streamingRef.current = false;
      setStreaming(false);
      setMachineState('Idle');
      setCurrentLine(totalLinesRef.current);
      logConsole('Job completed!', 'info');
      logEvent('job_done', 'Job completed successfully', 'info');

      const jobId = currentJobIdRef.current;
      if (jobId) {
        const endedAt = Date.now();
        addJobHistory({
          id: jobId,
          name: currentJobNameRef.current,
          startedAt: jobStartedAtRef.current,
          endedAt,
          duration: endedAt - jobStartedAtRef.current,
          status: 'completed',
          jobId,
        });
        currentJobIdRef.current = null;
      }
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
  }, [logConsole, logEvent, addJobHistory]);

  const startStreaming = useCallback((lines, jobName = 'Job') => {
    if (lines.length === 0) { logConsole('No G-code file loaded.', 'error'); return; }
    if (!connected) { logConsole('Not connected. Cannot start job.', 'error'); return; }

    setCommandLog([]);
    commandMapRef.current.clear();
    pendingQueueRef.current = [];

    const jobId = crypto.randomUUID();
    currentJobIdRef.current = jobId;
    currentJobNameRef.current = jobName;
    jobStartedAtRef.current = Date.now();

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
    const wasStreaming = streamingRef.current;
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

    const jobId = currentJobIdRef.current;
    if (wasStreaming && jobId) {
      const endedAt = Date.now();
      addJobHistory({
        id: jobId,
        name: currentJobNameRef.current,
        startedAt: jobStartedAtRef.current,
        endedAt,
        duration: endedAt - jobStartedAtRef.current,
        status: 'stopped',
        jobId,
      });
      currentJobIdRef.current = null;
    }

    if (connected) {
      window.platform.send('\x18');
      logEvent('estop', 'Emergency stop sent to Arduino', 'critical');
    }
  }, [connected, logConsole, logEvent, addJobHistory]);

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
          const responses = entry?.response || [];
          if (entry) {
            const now = Date.now();
            const updated = { ...entry, status: 'done', ackedAt: now, duration: now - entry.sentAt };
            commandMapRef.current.set(topId, updated);
            setCommandLog((prev) => prev.map((c) => (c.id === topId ? updated : c)));
          }
          const waiter = pendingWaitMapRef.current.get(topId);
          if (waiter) {
            waiter.resolve(responses);
            pendingWaitMapRef.current.delete(topId);
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
          const waiter = pendingWaitMapRef.current.get(topId);
          if (waiter) {
            waiter.reject(new Error(trimmed));
            pendingWaitMapRef.current.delete(topId);
          }
        }
        waitingForOkRef.current = false;
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
        // Reject all pending sendAndWait Promises so homeStage and callers don't hang
        pendingWaitMapRef.current.forEach(({ reject }) => {
          reject(new Error('Disconnected'));
        });
        pendingWaitMapRef.current.clear();
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
    if (direction > 0) {
      const s = settingsRef.current;
      const cur = axis === 'X' ? position.x : position.y;
      if (wouldExceedPositiveLimit(cur, increment, axis, {
        bedMaxX: s?.bedMaxX || 200,
        bedMaxY: s?.bedMaxY || 200,
        softLimitMargin: s?.softLimitMargin || 10,
      })) {
        logConsole(`Jog blocked: would exceed soft limit on ${axis}`, 'warning');
        return;
      }
    }
    const value = increment * direction;
    sendCommand('G91');
    sendCommand(`G0 ${axis}${value.toFixed(3)} F1000`);
    sendCommand('G90');
    setPosition((prev) => ({
      x: axis === 'X' ? prev.x + value : prev.x,
      y: axis === 'Y' ? prev.y + value : prev.y,
    }));
  }, [sendCommand, logConsole, position]);

  const goToPosition = useCallback((x, y) => {
    const s = settingsRef.current;
    if (isInWarnZone(x, y, {
      bedMaxX: s?.bedMaxX || 200,
      bedMaxY: s?.bedMaxY || 200,
      softLimitMargin: s?.softLimitMargin || 10,
    })) {
      logConsole(`Warning: position (${x.toFixed(1)}, ${y.toFixed(1)}) is in the soft-limit zone`, 'warning');
    }
    sendCommand('G90');
    sendCommand(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F1000`);
    setPosition({ x, y });
  }, [sendCommand, logConsole]);

  const homeStage = useCallback(async () => {
    if (!connected) { logConsole('Not connected. Cannot home.', 'error'); return; }
    setMachineState('Homing');
    logConsole('Starting homing sequence...', 'info');
    logEvent('homing_start', 'App-orchestrated homing started', 'info');
    try {
      const s = settingsRef.current;
      const hf = s?.homingFeedrate || 600;
      const backoff = s?.homingBackoff || 2;
      const cx = ((s?.bedMaxX || 200) / 2).toFixed(1);
      const cy = ((s?.bedMaxY || 200) / 2).toFixed(1);
      const mf = s?.maxFeedrate || 1000;

      await sendAndWait('M5');
      await sendAndWait('$HOMING=1');
      await sendAndWait('G91');
      const responses = await sendAndWait(`G0 X-500 Y-500 F${hf}`);

      const xHomed = responses.some(r => r.toLowerCase() === 'x stop triggered');
      const yHomed = responses.some(r => r.toLowerCase() === 'y stop triggered');

      if (!xHomed || !yHomed) {
        logConsole(`Homing failed — stops not triggered (X:${xHomed} Y:${yHomed})`, 'error');
        logEvent('homing_failed', `Stop not triggered — X:${xHomed} Y:${yHomed}`, 'critical');
        setMachineState('Error');
        await sendAndWait('$HOMING=0').catch(() => {});
        await sendAndWait('G90').catch(() => {});
        return;
      }

      await sendAndWait(`G0 X${backoff} Y${backoff} F${hf}`);
      await sendAndWait('G90');
      await sendAndWait('$HOMING=0');
      await sendAndWait(`G0 X${cx} Y${cy} F${mf}`);

      setPosition({ x: parseFloat(cx), y: parseFloat(cy) });
      setMachineState('Idle');
      logConsole('Homing complete. Head at stage centre.', 'info');
      logEvent('homing_done', 'Homing complete', 'info');
    } catch (err) {
      logConsole(`Homing error: ${err.message}`, 'error');
      logEvent('homing_failed', err.message, 'critical');
      setMachineState('Error');
      sendAndWait('$HOMING=0').catch(() => {});
      sendAndWait('G90').catch(() => {});
    }
  }, [connected, logConsole, logEvent, sendAndWait]);

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
    selectedPort, setSelectedPort,
    position, feedRate, spindleSpeed, arduinoState,
    streaming, paused, currentLine, totalLines,
    consoleLog, commandLog, eventLog,
    jobHistory,
    logConsole, logEvent, clearConsole,
    refreshPorts, connect, disconnect, sendCommand,
    jogWithIncrement, goToPosition, goToOrigin, homeStage, setZero,
    penUp, penDown, setServoAngle,
    startStreaming, pauseStreaming, resumeStreaming, stopStreaming,
  };

  return <SerialContext.Provider value={value}>{children}</SerialContext.Provider>;
}
