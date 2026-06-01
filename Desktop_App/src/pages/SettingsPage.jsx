import React from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useSerial } from '../contexts/SerialContext';
import './SettingsPage.css';

export default function SettingsPage() {
  const { settings, stepsPerMm, updateSetting, saveSettings, applyToArduino } = useSettings();
  const { connected, sendCommand, logConsole } = useSerial();

  const handleSave = async () => {
    const result = await saveSettings();
    if (result.success) {
      logConsole('Settings saved to disk.', 'info');
    } else {
      logConsole(`Error saving settings: ${result.error}`, 'error');
    }
  };

  const handleApply = async () => {
    if (!connected) {
      logConsole('Not connected. Cannot apply settings to Arduino.', 'error');
      return;
    }
    logConsole('Applying settings to Arduino...', 'info');
    await applyToArduino(sendCommand);
    logConsole('All settings sent to Arduino.', 'info');
  };

  const handleSaveAndApply = async () => {
    await handleSave();
    if (connected) {
      await handleApply();
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Machine Settings</h1>
        <p className="page-subtitle">Configure hardware parameters — applied to Arduino on save</p>
      </div>

      <div className="settings-grid">
        {/* Motor Configuration */}
        <div className="card">
          <h2 className="section-header">Motor Configuration</h2>
          <div className="form-row">
            <label>Steps per Revolution</label>
            <select value={settings.stepsPerRev} onChange={e => updateSetting('stepsPerRev', parseInt(e.target.value))}>
              <option value="200">200 (1.8° stepper)</option>
              <option value="400">400 (0.9° stepper)</option>
            </select>
          </div>
          <div className="form-row">
            <label>Microstepping</label>
            <select value={settings.microsteps} onChange={e => updateSetting('microsteps', parseInt(e.target.value))}>
              <option value="1">1 (Full step)</option>
              <option value="2">1/2</option>
              <option value="4">1/4</option>
              <option value="8">1/8</option>
              <option value="16">1/16</option>
              <option value="32">1/32</option>
            </select>
          </div>
          <div className="form-row">
            <label>Lead Screw Pitch (mm/rev)</label>
            <input
              type="number"
              value={settings.leadScrewPitch}
              step="0.1"
              onChange={e => updateSetting('leadScrewPitch', parseFloat(e.target.value) || 1)}
            />
          </div>
          <div className="calculated-display">
            <span className="calc-label">Calculated Steps/mm</span>
            <span className="calc-value">{stepsPerMm.toFixed(1)}</span>
          </div>
        </div>

        {/* Speed Limits */}
        <div className="card">
          <h2 className="section-header">Speed Limits</h2>
          <div className="form-row">
            <label>Max Feedrate (mm/min)</label>
            <input
              type="number"
              value={settings.maxFeedrate}
              onChange={e => updateSetting('maxFeedrate', parseInt(e.target.value) || 100)}
            />
          </div>
          <div className="form-row">
            <label>Min Feedrate (mm/min)</label>
            <input
              type="number"
              value={settings.minFeedrate}
              onChange={e => updateSetting('minFeedrate', parseInt(e.target.value) || 1)}
            />
          </div>
          <div className="form-row">
            <label>Homing Feedrate (mm/min)</label>
            <input
              type="number"
              value={settings.homingFeedrate}
              onChange={e => updateSetting('homingFeedrate', parseInt(e.target.value) || 100)}
            />
          </div>
          <div className="form-row">
            <label>Homing Backoff (mm)</label>
            <input
              type="number"
              value={settings.homingBackoff}
              step="0.1"
              onChange={e => updateSetting('homingBackoff', parseFloat(e.target.value) || 0.5)}
            />
          </div>
        </div>

        {/* Servo Configuration */}
        <div className="card">
          <h2 className="section-header">Servo Configuration</h2>
          <div className="form-row">
            <label>Head Up Angle (°)</label>
            <input
              type="number"
              value={settings.servoPenUp}
              min="0" max="180"
              onChange={e => updateSetting('servoPenUp', parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="form-row">
            <label>Head Down Angle (°)</label>
            <input
              type="number"
              value={settings.servoPenDown}
              min="0" max="180"
              onChange={e => updateSetting('servoPenDown', parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="form-row">
            <label>Home Angle (°)</label>
            <input
              type="number"
              value={settings.servoHome}
              min="0" max="180"
              onChange={e => updateSetting('servoHome', parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="form-row">
            <label>Settle Time (ms)</label>
            <input
              type="number"
              value={settings.servoSettleMs}
              onChange={e => updateSetting('servoSettleMs', parseInt(e.target.value) || 50)}
            />
          </div>
        </div>

        {/* Advanced Timing */}
        <div className="card">
          <h2 className="section-header">Advanced Timing</h2>
          <div className="form-row">
            <label>Min Step Pulse Width (µs)</label>
            <input
              type="number"
              value={settings.minStepPulseUs}
              onChange={e => updateSetting('minStepPulseUs', parseInt(e.target.value) || 1)}
            />
          </div>
          <div className="form-row">
            <label>Direction Setup Delay (µs)</label>
            <input
              type="number"
              value={settings.dirSetupDelayUs}
              onChange={e => updateSetting('dirSetupDelayUs', parseInt(e.target.value) || 1)}
            />
          </div>
          <div className="form-row">
            <label>Min Loop Delay (µs)</label>
            <input
              type="number"
              value={settings.minLoopDelayUs}
              onChange={e => updateSetting('minLoopDelayUs', parseInt(e.target.value) || 10)}
            />
          </div>
          <div className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.enableLimitSwitchX}
              onChange={e => updateSetting('enableLimitSwitchX', e.target.checked)}
              id="limitX"
            />
            <label htmlFor="limitX">Enable X Limit Switch</label>
          </div>
          <div className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.enableLimitSwitchY}
              onChange={e => updateSetting('enableLimitSwitchY', e.target.checked)}
              id="limitY"
            />
            <label htmlFor="limitY">Enable Y Limit Switch</label>
          </div>
        </div>

        {/* Machine Dimensions */}
        <div className="card">
          <h2 className="section-header">Machine Boundaries (Soft Limits)</h2>
          <div className="form-row">
            <label>Max X Travel (mm)</label>
            <input
              type="number"
              value={settings.bedMaxX}
              onChange={e => updateSetting('bedMaxX', parseFloat(e.target.value) || 100)}
            />
          </div>
          <div className="form-row">
            <label>Max Y Travel (mm)</label>
            <input
              type="number"
              value={settings.bedMaxY}
              onChange={e => updateSetting('bedMaxY', parseFloat(e.target.value) || 100)}
            />
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="settings-actions">
        <button className="btn btn-secondary" onClick={handleSave}>
          Save to Disk
        </button>
        <button className="btn btn-primary" onClick={handleApply} disabled={!connected}>
          Apply to Arduino
        </button>
        <button className="btn btn-primary" onClick={handleSaveAndApply}>
          Save & Apply
        </button>
      </div>
    </div>
  );
}
