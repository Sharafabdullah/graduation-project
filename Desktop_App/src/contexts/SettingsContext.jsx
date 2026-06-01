import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const SettingsContext = createContext(null);

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

const DEFAULT_SETTINGS = {
  // Motor
  stepsPerRev: 200,
  microsteps: 16,
  leadScrewPitch: 8.0,

  // Speed
  maxFeedrate: 3000,
  minFeedrate: 10,
  homingFeedrate: 600,
  homingBackoff: 2.0,

  // Servo
  servoPenUp: 75,
  servoPenDown: 30,
  servoHome: 90,
  servoSettleMs: 150,

  // Timing
  minStepPulseUs: 5,
  dirSetupDelayUs: 5,
  minLoopDelayUs: 50,

  // Limit switches
  enableLimitSwitchX: true,
  enableLimitSwitchY: true,

  // Connection defaults
  defaultBaudRate: '115200',

  // Machine Boundaries (Soft Limits)
  bedMaxX: 200,
  bedMaxY: 200,
};

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  // Load settings on mount
  useEffect(() => {
    (async () => {
      const saved = await window.platform.loadSettings();
      if (saved) {
        setSettings(prev => ({ ...prev, ...saved }));
      }
      setLoaded(true);
    })();
  }, []);

  // Calculate steps/mm
  const stepsPerMm = (settings.stepsPerRev * settings.microsteps) / settings.leadScrewPitch;

  // Update a single setting
  const updateSetting = useCallback((key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  // Save to disk
  const saveSettings = useCallback(async () => {
    const result = await window.platform.saveSettings(settings);
    return result;
  }, [settings]);

  // Send settings to Arduino via $ commands
  const applyToArduino = useCallback(async (sendCommand) => {
    const commands = [
      `$MS=${settings.microsteps}`,
      `$SPR=${settings.stepsPerRev}`,
      `$LP=${settings.leadScrewPitch}`,
      `$MF=${settings.maxFeedrate}`,
      `$HF=${settings.homingFeedrate}`,
      `$HB=${settings.homingBackoff}`,
      `$SU=${settings.servoPenUp}`,
      `$SD=${settings.servoPenDown}`,
      `$SH=${settings.servoHome}`,
      `$ST=${settings.servoSettleMs}`,
    ];

    for (const cmd of commands) {
      await sendCommand(cmd);
      // Small delay between commands
      await new Promise(r => setTimeout(r, 50));
    }
  }, [settings]);

  const value = {
    settings,
    stepsPerMm,
    loaded,
    updateSetting,
    saveSettings,
    applyToArduino,
    DEFAULT_SETTINGS,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
