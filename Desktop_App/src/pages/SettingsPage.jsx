import React, { useState } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useSerial } from '../contexts/SerialContext';
import { useMode } from '../contexts/ModeContext';
import ModeSelector from '../components/ModeSelector';
import './SettingsPage.css';

export default function SettingsPage() {
  const { settings, stepsPerMm, updateSetting, saveSettings, applyToArduino } = useSettings();
  const { connected, sendCommand, logConsole, portPath, streaming } = useSerial();
  const { mode, modeConfig, firmwareUploaded, markFirmwareUploaded } = useMode();
  const [uploading, setUploading] = useState(false);

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
    await applyToArduino(sendCommand, modeConfig.id);
    logConsole('All settings sent to Arduino.', 'info');
  };

  const handleSaveAndApply = async () => {
    await handleSave();
    if (connected) {
      await handleApply();
    }
  };

  const handleUploadFirmware = async () => {
    if (!connected || uploading) return;
    if (streaming) {
      logConsole('Cannot upload firmware while streaming a job.', 'error');
      return;
    }

    setUploading(true);
    logConsole(`[FIRMWARE] Starting upload for ${modeConfig.label} mode from Settings...`, 'info');

    try {
      const unsub = typeof window.platform !== 'undefined'
        ? window.platform.onUploadProgress((line) => {
            if (line) logConsole(line, 'info');
          })
        : () => {};

      const result = await window.platform.uploadFirmware(portPath, mode);
      unsub();

      if (result.success) {
        markFirmwareUploaded(true);
        logConsole('[FIRMWARE] Upload successful! Machine is now in ' + modeConfig.label + ' mode.', 'info');
      } else {
        logConsole('[FIRMWARE] Upload FAILED: ' + (result.error || `exit code ${result.exitCode}`), 'error');
      }
    } catch (err) {
      logConsole('[FIRMWARE] Upload error: ' + err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Machine Settings</h1>
          <p className="page-subtitle">Configure hardware parameters — applied to Arduino on save</p>
        </div>
        <ModeSelector />
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
          <div className="form-row">
            <label>Arc Chord Error ($CE, mm)</label>
            <input
              type="number"
              value={settings.chordError ?? 0.2}
              min="0.01" max="2" step="0.01"
              onChange={e => updateSetting('chordError', parseFloat(e.target.value) || 0.2)}
            />
          </div>
        </div>

        {/* Servo Configuration */}
        {modeConfig.hasServo && (
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
        )}

        {/* Drill Configuration */}
        {modeConfig.id === 'drill' && (
          <div className="card">
            <h2 className="section-header">Drill Configuration</h2>
            <div className="form-row">
              <label>Default Spindle Speed (0-255)</label>
              <input
                type="number"
                value={settings.defaultSpindleSpeed}
                min="0" max="255"
                onChange={e => updateSetting('defaultSpindleSpeed', parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="form-row">
              <label>Plunge Dwell (ms)</label>
              <input
                type="number"
                value={settings.plungeDwellMs}
                min="0"
                onChange={e => updateSetting('plungeDwellMs', parseInt(e.target.value) || 0)}
              />
            </div>
          </div>
        )}

        {/* Laser Configuration */}
        {modeConfig.id === 'laser' && (
          <div className="card">
            <h2 className="section-header">Laser Configuration</h2>
            <div className="form-row">
              <label>Laser Max Power (0-255)</label>
              <input
                type="number"
                value={settings.laserMaxPower}
                min="0" max="255"
                onChange={e => updateSetting('laserMaxPower', parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.laserDynamicMode}
                onChange={e => updateSetting('laserDynamicMode', e.target.checked)}
                id="laserDynamicMode"
              />
              <label htmlFor="laserDynamicMode">Dynamic Power Mode (M4)</label>
            </div>
          </div>
        )}

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
          <div className="form-row">
            <label>Safe Working Margin (mm)</label>
            <input
              type="number"
              value={settings.softLimitMargin}
              min="0"
              step="1"
              onChange={e => updateSetting('softLimitMargin', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
        {/* Firmware Configuration */}
        <div className="card">
          <h2 className="section-header">Firmware</h2>
          <div style={{ marginBottom: '12px' }}>
            <strong>Active Mode:</strong> {modeConfig.label}
          </div>
          <div style={{ marginBottom: '16px', color: firmwareUploaded ? 'var(--text-primary)' : 'var(--danger-color)' }}>
            <strong>Status:</strong> {firmwareUploaded ? 'Uploaded / Up-to-date' : 'Upload Required'}
          </div>
          <button
            className={`btn btn-primary ${uploading ? 'uploading' : ''}`}
            onClick={handleUploadFirmware}
            disabled={uploading || streaming || !connected}
          >
            {uploading ? 'Uploading...' : `Upload ${modeConfig.label} Firmware`}
          </button>
          {!connected && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>Connect to machine to upload firmware.</div>}
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
