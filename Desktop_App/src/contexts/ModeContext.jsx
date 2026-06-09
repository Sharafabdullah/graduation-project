/**
 * ModeContext.jsx — Global CNC operating mode state
 *
 * Tracks the current head mode: 'pen' | 'drill' | 'laser'
 * Persists to localStorage so it survives app restarts.
 *
 * Also tracks whether the current firmware on the machine matches the
 * selected mode, so the UI can prompt the user to upload firmware.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export const MODES = {
  pen: {
    id: 'pen',
    label: 'Pen',
    icon: '✏️',
    description: 'Pen plotter — servo Z-axis',
    accentColor: '#007ACC',        // blue (default)
    hexFile: 'pen.hex',
    toolOnLabel: 'Head Down',
    toolOffLabel: 'Head Up',
    toolOnCmd: 'M3',
    toolOffCmd: 'M5',
    hasServo: true,
    hasSpindleSpeed: false,
    hasLaserPower: false,
    image2gcodeEnabled: true,
  },
  drill: {
    id: 'drill',
    label: 'Drill',
    icon: '🔩',
    description: 'Drill / spindle — servo plunge + PWM motor',
    accentColor: '#D4A017',        // amber
    hexFile: 'drill.hex',
    toolOnLabel: 'Plunge Drill',
    toolOffLabel: 'Raise Drill',
    toolOnCmd: 'M3',
    toolOffCmd: 'M5',
    hasServo: true,
    hasSpindleSpeed: true,
    hasLaserPower: false,
    image2gcodeEnabled: false,
  },
  laser: {
    id: 'laser',
    label: 'Laser',
    icon: '⚡',
    description: 'Laser engraver — TTL/PWM diode module',
    accentColor: '#E04F5F',        // red/coral
    hexFile: 'laser.hex',
    toolOnLabel: 'Laser On',
    toolOffLabel: 'Laser Off',
    toolOnCmd: 'M3',
    toolOffCmd: 'M5',
    hasServo: false,
    hasSpindleSpeed: false,
    hasLaserPower: true,
    image2gcodeEnabled: true,
  },
};

const STORAGE_KEY = 'cnc_mode';
const FIRMWARE_KEY = 'cnc_firmware_uploaded';

const ModeContext = createContext(null);

export function useMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error('useMode must be used within ModeProvider');
  return ctx;
}

export function ModeProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const resolved = saved && MODES[saved] ? saved : 'pen';
      document.documentElement.dataset.mode = resolved;
      return resolved;
    } catch {
      return 'pen';
    }
  });

  // Tracks whether the firmware on the machine matches the selected mode.
  // Resets to false whenever mode changes; set to true after successful upload.
  const [firmwareUploaded, setFirmwareUploaded] = useState(() => {
    try {
      return localStorage.getItem(FIRMWARE_KEY) === mode;
    } catch {
      return false;
    }
  });

  const setMode = useCallback((newMode) => {
    if (!MODES[newMode]) return;
    setModeState(newMode);
    setFirmwareUploaded(false);
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
      localStorage.removeItem(FIRMWARE_KEY);
    } catch { /* ignore */ }
  }, []);

  const markFirmwareUploaded = useCallback((uploaded = true) => {
    setFirmwareUploaded(uploaded);
    try {
      if (uploaded) {
        localStorage.setItem(FIRMWARE_KEY, mode);
      } else {
        localStorage.removeItem(FIRMWARE_KEY);
      }
    } catch { /* ignore */ }
  }, [mode]);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  const modeConfig = MODES[mode];

  const value = {
    mode,
    setMode,
    modeConfig,
    MODES,
    firmwareUploaded,
    markFirmwareUploaded,
  };

  return (
    <ModeContext.Provider value={value}>
      {children}
    </ModeContext.Provider>
  );
}
