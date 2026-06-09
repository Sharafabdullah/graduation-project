/**
 * ModeSelector.jsx — Operating mode dropdown with firmware upload
 *
 * Renders in the top-right of every page header.
 * Shows the current mode with its icon. Switching mode shows a confirmation
 * dialog. After switching, shows an "Upload Firmware" button when connected
 * and firmware hasn't been uploaded yet for this mode.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMode, MODES } from '../contexts/ModeContext';
import { useSerial } from '../contexts/SerialContext';
import './ModeSelector.css';

const MODE_ICONS = {
  pen:   { emoji: '✏️',  svg: null },
  drill: { emoji: '🔩', svg: null },
  laser: { emoji: '⚡',  svg: null },
};

export default function ModeSelector() {
  const { mode, setMode, modeConfig, firmwareUploaded, markFirmwareUploaded } = useMode();
  const { connected, portPath, logConsole, logEvent, streaming } = useSerial();

  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null); // mode key to switch to
  const dropRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const requestModeChange = (targetMode) => {
    if (targetMode === mode) { setOpen(false); return; }
    setOpen(false);
    setConfirmTarget(targetMode);
  };

  const confirmModeChange = () => {
    if (!confirmTarget) return;
    setMode(confirmTarget);
    logEvent('mode-change', `Mode changed to ${MODES[confirmTarget].label}`, 'info');
    setConfirmTarget(null);
  };

  const cancelModeChange = () => setConfirmTarget(null);

  const handleUpload = useCallback(async () => {
    if (!connected || uploading) return;
    if (streaming) {
      logConsole('Cannot upload firmware while streaming a job.', 'error');
      return;
    }

    setUploading(true);
    logConsole(`[FIRMWARE] Starting upload for ${modeConfig.label} mode...`, 'info');
    logEvent('firmware', `Uploading ${modeConfig.label} firmware`, 'info');

    try {
      // Subscribe to progress lines before invoking
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
        logEvent('firmware', `${modeConfig.label} firmware upload succeeded`, 'info');
      } else {
        logConsole('[FIRMWARE] Upload FAILED: ' + (result.error || `exit code ${result.exitCode}`), 'error');
        logEvent('firmware', `${modeConfig.label} firmware upload failed`, 'critical');
      }
    } catch (err) {
      logConsole('[FIRMWARE] Upload error: ' + err.message, 'error');
    } finally {
      setUploading(false);
    }
  }, [connected, uploading, streaming, portPath, mode, modeConfig, logConsole, logEvent, markFirmwareUploaded]);

  const firmwareStale = !firmwareUploaded;
  const targetConfig = confirmTarget ? MODES[confirmTarget] : null;

  return (
    <>
      <div className="mode-selector" ref={dropRef}>
        {/* Firmware stale badge + upload button */}
        {firmwareStale && connected && (
          <button
            className={`firmware-upload-btn ${uploading ? 'uploading' : ''}`}
            onClick={handleUpload}
            disabled={uploading || streaming}
            title={uploading ? 'Uploading firmware…' : `Upload ${modeConfig.label} firmware to machine`}
          >
            {uploading ? (
              <span className="upload-spinner" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 16 12 12 8 16" />
                <line x1="12" y1="12" x2="12" y2="21" />
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
              </svg>
            )}
            <span>{uploading ? 'Uploading…' : 'Upload Firmware'}</span>
          </button>
        )}

        {/* Mode dropdown trigger */}
        <button
          id="mode-selector-btn"
          className={`mode-trigger mode-${mode}`}
          onClick={() => setOpen(!open)}
          title={`Current mode: ${modeConfig.label} — click to change`}
        >
          <span className="mode-icon">{MODE_ICONS[mode].emoji}</span>
          <span className="mode-label">{modeConfig.label}</span>
          {firmwareStale && <span className="mode-stale-dot" title="Firmware not yet uploaded" />}
          <svg className={`mode-chevron ${open ? 'open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Dropdown panel */}
        {open && (
          <div className="mode-dropdown" role="listbox" aria-label="Select operating mode">
            <div className="mode-dropdown-header">Operating Mode</div>
            {Object.values(MODES).map((m) => (
              <button
                key={m.id}
                className={`mode-option ${m.id === mode ? 'active' : ''}`}
                role="option"
                aria-selected={m.id === mode}
                onClick={() => requestModeChange(m.id)}
              >
                <span className="mode-option-icon">{MODE_ICONS[m.id].emoji}</span>
                <div className="mode-option-text">
                  <span className="mode-option-label">{m.label}</span>
                  <span className="mode-option-desc">{m.description}</span>
                </div>
                {m.id === mode && (
                  <svg className="mode-option-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      {confirmTarget && targetConfig && (
        <div className="mode-confirm-overlay" onClick={cancelModeChange}>
          <div className="mode-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="mode-confirm-icon">{MODE_ICONS[confirmTarget].emoji}</div>
            <h3 className="mode-confirm-title">Switch to {targetConfig.label} Mode?</h3>
            <p className="mode-confirm-body">
              This will change the app interface to <strong>{targetConfig.label} mode</strong>.{' '}
              You will need to upload the <strong>{targetConfig.label} firmware</strong> to the
              Arduino for the physical machine to behave correctly.
            </p>
            {confirmTarget === 'laser' && (
              <div className="mode-confirm-warning">
                ⚠ Laser mode requires eye protection (OD4+ glasses). Ensure proper ventilation.
              </div>
            )}
            <div className="mode-confirm-actions">
              <button className="btn btn-secondary" onClick={cancelModeChange}>Cancel</button>
              <button
                className="btn btn-primary"
                style={{ background: targetConfig.accentColor, borderColor: targetConfig.accentColor }}
                onClick={confirmModeChange}
              >
                Switch to {targetConfig.label}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
