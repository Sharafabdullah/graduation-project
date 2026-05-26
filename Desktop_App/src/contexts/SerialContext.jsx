import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const SerialContext = createContext(null);

export function useSerial() {
  const ctx = useContext(SerialContext);
  if (!ctx) throw new Error('useSerial must be used within SerialProvider');
  return ctx;
}

export function SerialProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [portPath, setPortPath] = useState('');
  const [ports, setPorts] = useState([]);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [feedRate, setFeedRate] = useState(0);
  const [spindleSpeed, setSpindleSpeed] = useState(0);
  const [machineState, setMachineState] = useState('Idle'); // Idle, Streaming, Paused, Homing

  // Streaming state
  const [streaming, setStreaming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentLine, setCurrentLine] = useState(0);
  const [totalLines, setTotalLines] = useState(0);
  const [gcodeLines, setGcodeLines] = useState([]);

  // Console log
  const [consoleLog, setConsoleLog] = useState([]);

  // Refs for streaming handshake
  const streamingRef = useRef(false);
  const pausedRef = useRef(false);
  const waitingForOkRef = useRef(false);
  const gcodeLinesRef = useRef([]);
  const currentLineRef = useRef(0);
  const totalLinesRef = useRef(0);

  // Utility: timestamp
  const timestamp = useCallback(() => {
    const now = new Date();
    return `[${now.toTimeString().slice(0, 8)}]`;
  }, []);

  // Log to console
  const logConsole = useCallback((message, type = '') => {
    setConsoleLog(prev => {
      const newLog = [...prev, { message: `${timestamp()} ${message}`, type, id: Date.now() + Math.random() }];
      // Keep only last 500 lines
      return newLog.length > 500 ? newLog.slice(-500) : newLog;
    });
  }, [timestamp]);

  // Clear console
  const clearConsole = useCallback(() => {
    setConsoleLog([]);
  }, []);

  // Refresh ports
  const refreshPorts = useCallback(async () => {
    const portList = await window.platform.listPorts();
    setPorts(portList);
    if (portList.length === 0) {
      logConsole('No serial ports found.', 'info');
    } else {
      logConsole(`Found ${portList.length} serial port(s).`, 'info');
    }
    return portList;
  }, [logConsole]);

  // Connect
  const connect = useCallback(async (port, baudRate) => {
    if (!port) {
      logConsole('Please select a serial port.', 'error');
      return false;
    }
    logConsole(`Connecting to ${port} at ${baudRate} baud...`);
    const result = await window.platform.connect(port, baudRate);
    if (result.success) {
      setConnected(true);
      setPortPath(port);
      logConsole('Connection successful.', 'received');
      return true;
    } else {
      logConsole(`Connection failed: ${result.error}`, 'error');
      return false;
    }
  }, [logConsole]);

  // Disconnect
  const disconnect = useCallback(async () => {
    logConsole('Disconnecting...');
    const result = await window.platform.disconnect();
    setConnected(false);
    setPortPath('');
    if (result.success) {
      logConsole('Disconnected successfully.', 'info');
    }
    if (streamingRef.current) {
      stopStreaming();
    }
  }, [logConsole]);

  // Send command
  const sendCommand = useCallback(async (cmd) => {
    if (!connected) {
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
  }, [connected, logConsole]);

  // Send next G-code line
  const sendNextGCodeLine = useCallback(() => {
    if (!streamingRef.current || pausedRef.current) return;
    if (currentLineRef.current >= totalLinesRef.current) {
      streamingRef.current = false;
      setStreaming(false);
      setMachineState('Idle');
      setCurrentLine(totalLinesRef.current);
      logConsole('Job completed!', 'info');
      return;
    }

    const line = gcodeLinesRef.current[currentLineRef.current];
    currentLineRef.current++;
    setCurrentLine(currentLineRef.current);

    // Parse feed rate from G-code line
    const fMatch = line.match(/F([\d.]+)/i);
    if (fMatch) {
      setFeedRate(parseInt(fMatch[1], 10));
    }

    waitingForOkRef.current = true;
    // Send directly without going through sendCommand to avoid logging issues
    logConsole(`> ${line}`, 'sent');
    window.platform.send(line);
  }, [logConsole]);

  // Start streaming
  const startStreaming = useCallback((lines) => {
    if (lines.length === 0) {
      logConsole('No G-code file loaded.', 'error');
      return;
    }
    if (!connected) {
      logConsole('Not connected. Cannot start job.', 'error');
      return;
    }

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
    sendNextGCodeLine();
  }, [connected, logConsole, sendNextGCodeLine]);

  // Pause
  const pauseStreaming = useCallback(() => {
    if (!streamingRef.current) return;
    pausedRef.current = true;
    setPaused(true);
    setMachineState('Paused');
    logConsole('Job paused.', 'info');
    sendCommand('!');
  }, [logConsole, sendCommand]);

  // Resume
  const resumeStreaming = useCallback(() => {
    if (!streamingRef.current || !pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    setMachineState('Streaming');
    logConsole('Job resumed.', 'info');
    sendCommand('~');
    if (!waitingForOkRef.current) {
      sendNextGCodeLine();
    }
  }, [logConsole, sendCommand, sendNextGCodeLine]);

  // Stop
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
    if (connected) {
      window.platform.send('\x18'); // Soft reset
    }
  }, [connected, logConsole]);

  // Handle incoming serial data
  useEffect(() => {
    const handleData = (data) => {
      // Log non-ok and non-spam messages
      if (data.startsWith('Debug:')) {
        logConsole(data, 'info');
      } else if (data !== 'ok') {
        logConsole(`< ${data}`, 'received');
      }

      // Parse position: X:10.00 Y:20.00
      const posMatch = data.match(/X[:\s]?([\d.-]+)\s*Y[:\s]?([\d.-]+)/i);
      if (posMatch) {
        setPosition({
          x: parseFloat(posMatch[1]),
          y: parseFloat(posMatch[2]),
        });
      }

      // Parse spindle speed: S12000
      const spindleMatch = data.match(/S[:\s]?([\d.]+)/i);
      if (spindleMatch && !data.startsWith('<')) {
        setSpindleSpeed(parseInt(spindleMatch[1], 10));
      }

      // GRBL-style status: <Idle|MPos:0.000,0.000,0.000|FS:0,0>
      const grblMatch = data.match(/<(\w+)\|MPos:([\d.-]+),([\d.-]+),([\d.-]+)\|.*?FS?:([\d.]+)/);
      if (grblMatch) {
        setPosition({
          x: parseFloat(grblMatch[2]),
          y: parseFloat(grblMatch[3]),
        });
        setFeedRate(parseInt(grblMatch[5], 10));
      }

      // Handle 'ok' for streaming handshake
      if (data.toLowerCase().startsWith('ok')) {
        waitingForOkRef.current = false;
        if (streamingRef.current && !pausedRef.current) {
          sendNextGCodeLine();
        }
      }

      // Handle errors
      if (data.toLowerCase().startsWith('error')) {
        logConsole(`Machine error: ${data}`, 'error');
      }
    };

    const handleStatus = (status) => {
      if (status.type === 'disconnected') {
        setConnected(false);
        setPortPath('');
        logConsole('Connection lost.', 'error');
      } else if (status.type === 'error') {
        logConsole(`Serial error: ${status.message}`, 'error');
      }
    };

    window.platform.onData(handleData);
    window.platform.onStatus(handleStatus);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Jog
  const jog = useCallback((axis, direction) => {
    const increment = 1; // Default, will be overridden by caller
    const value = increment * direction;
    sendCommand('G91');
    sendCommand(`G0 ${axis}${value.toFixed(3)} F1000`);
    sendCommand('G90');
  }, [sendCommand]);

  const jogWithIncrement = useCallback((axis, direction, increment) => {
    const value = increment * direction;
    sendCommand('G91');
    sendCommand(`G0 ${axis}${value.toFixed(3)} F1000`);
    sendCommand('G90');

    // Optimistically update position
    setPosition(prev => ({
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
  }, [sendCommand, logConsole]);

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

  const penUp = useCallback(() => {
    sendCommand('M5');
  }, [sendCommand]);

  const penDown = useCallback(() => {
    sendCommand('M3');
  }, [sendCommand]);

  const setServoAngle = useCallback((angle) => {
    sendCommand(`M280 S${angle}`);
  }, [sendCommand]);

  const value = {
    // Connection state
    connected,
    portPath,
    ports,
    machineState,

    // Position
    position,
    feedRate,
    spindleSpeed,

    // Streaming
    streaming,
    paused,
    currentLine,
    totalLines,

    // Console
    consoleLog,
    logConsole,
    clearConsole,

    // Actions
    refreshPorts,
    connect,
    disconnect,
    sendCommand,
    jogWithIncrement,
    goToPosition,
    goToOrigin,
    findLimits,
    setZero,
    penUp,
    penDown,
    setServoAngle,
    startStreaming,
    pauseStreaming,
    resumeStreaming,
    stopStreaming,
  };

  return (
    <SerialContext.Provider value={value}>
      {children}
    </SerialContext.Provider>
  );
}
