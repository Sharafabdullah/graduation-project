import React, { useState, useEffect } from 'react';
import { useSerial } from '../contexts/SerialContext';
import { useSettings } from '../contexts/SettingsContext';
import { useNavigate } from 'react-router-dom';
import './DashboardPage.css';

export default function DashboardPage() {
  const {
    connected, portPath, ports, position, feedRate, spindleSpeed, machineState,
    refreshPorts, connect, disconnect, streaming, currentLine, totalLines,
    goToOrigin, penUp, penDown, sendCommand, logConsole, stopStreaming,
  } = useSerial();
  const { settings } = useSettings();
  const navigate = useNavigate();

  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState(settings.defaultBaudRate || '115200');

  // Refresh ports on mount
  useEffect(() => {
    refreshPorts();
  }, []);

  const handleConnect = async () => {
    if (connected) return;
    await connect(selectedPort, baudRate);
  };

  const handleDisconnect = async () => {
    await disconnect();
  };

  const handleEStop = () => {
    if (!connected) return;
    logConsole('EMERGENCY STOP: Work has been stopped by the user.', 'error');
    stopStreaming();
  };

  const progressPct = totalLines > 0 ? Math.round((currentLine / totalLines) * 100) : 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Machine overview and quick controls</p>
      </div>

      <div className="dashboard-grid">
        {/* Connection Card */}
        <div className="card dashboard-connection">
          <h2 className="section-header">Connection</h2>
          <div className="form-row">
            <label>Serial Port</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <select
                value={selectedPort}
                onChange={e => setSelectedPort(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">-- Select Port --</option>
                {ports.map(p => (
                  <option key={p.path} value={p.path}>
                    {p.manufacturer ? `${p.path} (${p.manufacturer})` : p.path}
                  </option>
                ))}
              </select>
              <button className="btn-icon" onClick={() => refreshPorts()} title="Refresh ports">
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path fill="currentColor" d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z" />
                </svg>
              </button>
            </div>
          </div>
          <div className="form-row">
            <label>Baud Rate</label>
            <input
              type="text"
              value={baudRate}
              onChange={e => setBaudRate(e.target.value)}
            />
          </div>
          <div className="button-group">
            <button className="btn btn-primary" onClick={handleConnect} disabled={connected}>
              Connect
            </button>
            <button className="btn btn-secondary" onClick={handleDisconnect} disabled={!connected}>
              Disconnect
            </button>
          </div>
          <div className="status-indicator">
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
            <span>{connected ? `Connected to ${portPath}` : 'Disconnected'}</span>
          </div>
        </div>

        {/* Live Position Card */}
        <div className="card dashboard-position">
          <h2 className="section-header">Live Position</h2>
          <div className="status-grid">
            <div className="status-cell">
              <span className="status-cell-label">X Position</span>
              <span className="status-cell-value">{position.x.toFixed(2)} mm</span>
            </div>
            <div className="status-cell">
              <span className="status-cell-label">Y Position</span>
              <span className="status-cell-value">{position.y.toFixed(2)} mm</span>
            </div>
            <div className="status-cell">
              <span className="status-cell-label">Feed Rate</span>
              <span className="status-cell-value">{feedRate} mm/min</span>
            </div>
            <div className="status-cell">
              <span className="status-cell-label">Machine State</span>
              <span className={`status-cell-value state-${machineState.toLowerCase()}`}>
                {machineState}
              </span>
            </div>
          </div>

          {/* Job Progress (if streaming) */}
          {streaming && (
            <div className="progress-section" style={{ marginTop: '8px' }}>
              <div className="progress-label">
                <span>Job Progress</span>
                <span>{progressPct}% ({currentLine}/{totalLines})</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions Card */}
        <div className="card dashboard-actions">
          <h2 className="section-header">Quick Actions</h2>
          <div className="quick-actions-grid">
            <button className="btn btn-primary quick-action-btn" onClick={goToOrigin} disabled={!connected}>
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M3.05,13H1V11H3.05C3.5,6.83 6.83,3.5 11,3.05V1H13V3.05C17.17,3.5 20.5,6.83 20.95,11H23V13H20.95C20.5,17.17 17.17,20.5 13,20.95V23H11V20.95C6.83,20.5 3.5,17.17 3.05,13M12,5A7,7 0 0,0 5,12A7,7 0 0,0 12,19A7,7 0 0,0 19,12A7,7 0 0,0 12,5Z" />
              </svg>
              Go to Origin
            </button>
            <button className="btn btn-secondary quick-action-btn" onClick={penUp} disabled={!connected}>
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z" />
              </svg>
              Head Up
            </button>
            <button className="btn btn-secondary quick-action-btn" onClick={penDown} disabled={!connected}>
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z" />
              </svg>
              Head Down
            </button>
            <button className="btn btn-danger quick-action-btn" onClick={handleEStop} disabled={!connected}>
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z" />
              </svg>
              E-Stop
            </button>
          </div>
        </div>

        {/* Quick Navigate Card */}
        <div className="card dashboard-navigate">
          <h2 className="section-header">Quick Navigate</h2>
          <div className="quick-nav-grid">
            <button className="btn btn-ghost full-width" onClick={() => navigate('/manual')}>
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M13,6V11H18V7.75L22.25,12L18,16.25V13H13V18H16.25L12,22.25L7.75,18H11V13H6V16.25L1.75,12L6,7.75V11H11V6H7.75L12,1.75L16.25,6H13Z" />
              </svg>
              Manual Control
            </button>
            <button className="btn btn-ghost full-width" onClick={() => navigate('/gcode')}>
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M9,13V19H7V13H9M15,15V19H13V15H15M11,11V19H13V11H11" />
              </svg>
              G-Code Jobs
            </button>
            <button className="btn btn-ghost full-width" onClick={() => navigate('/settings')}>
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.04 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.04 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
              </svg>
              Settings
            </button>
            <button className="btn btn-ghost full-width" onClick={() => navigate('/console')}>
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M20,19V7H4V19H20M20,3A2,2 0 0,1 22,5V19A2,2 0 0,1 20,21H4A2,2 0 0,1 2,19V5C2,3.89 2.9,3 4,3H20M13,17V15H18V17H13M9.58,13L5.57,9L7,7.59L12,12.59L7,17.59L5.57,16.17L9.58,13Z" />
              </svg>
              Console
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
