import React, { useState, useEffect } from 'react';
import { useSerial } from '../contexts/SerialContext';
import { useSettings } from '../contexts/SettingsContext';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Crosshair, ChevronUp, ChevronDown, XCircle, Move, FileBarChart2, Settings, Terminal } from 'lucide-react';
import './DashboardPage.css';

export default function DashboardPage() {
  const {
    connected,
    portPath,
    ports,
    position,
    feedRate,
    spindleSpeed,
    machineState,
    refreshPorts,
    connect,
    disconnect,
    streaming,
    currentLine,
    totalLines,
    goToOrigin,
    penUp,
    penDown,
    sendCommand,
    logConsole,
    stopStreaming,
  } = useSerial();
  const { settings } = useSettings();
  const navigate = useNavigate();

  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState(
    settings.defaultBaudRate || '115200',
  );

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

  const progressPct =
    totalLines > 0 ? Math.round((currentLine / totalLines) * 100) : 0;

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
                onChange={(e) => setSelectedPort(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">-- Select Port --</option>
                {ports.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.manufacturer ? `${p.path} (${p.manufacturer})` : p.path}
                  </option>
                ))}
              </select>
              <button
                className="btn-icon"
                onClick={() => refreshPorts()}
                title="Refresh ports"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
          <div className="form-row">
            <label>Baud Rate</label>
            <input
              type="text"
              value={baudRate}
              onChange={(e) => setBaudRate(e.target.value)}
            />
          </div>
          <div className="button-group">
            <button
              className="btn btn-primary"
              onClick={handleConnect}
              disabled={connected}
            >
              Connect
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleDisconnect}
              disabled={!connected}
            >
              Disconnect
            </button>
          </div>
          <div className="status-indicator">
            <span
              className={`status-dot ${connected ? 'connected' : 'disconnected'}`}
            />
            <span>
              {connected ? `Connected to ${portPath}` : 'Disconnected'}
            </span>
          </div>
        </div>

        {/* Live Position Card */}
        <div className="card dashboard-position">
          <h2 className="section-header">Live Position</h2>
          <div className="status-grid">
            <div className="status-cell">
              <span className="status-cell-label">X Position</span>
              <span className="status-cell-value">
                {position.x.toFixed(2)} mm
              </span>
            </div>
            <div className="status-cell">
              <span className="status-cell-label">Y Position</span>
              <span className="status-cell-value">
                {position.y.toFixed(2)} mm
              </span>
            </div>
            <div className="status-cell">
              <span className="status-cell-label">Feed Rate</span>
              <span className="status-cell-value">{feedRate} mm/min</span>
            </div>
            <div className="status-cell">
              <span className="status-cell-label">Machine State</span>
              <span
                className={`status-cell-value state-${machineState.toLowerCase()}`}
              >
                {machineState}
              </span>
            </div>
          </div>

          {/* Job Progress (if streaming) */}
          {streaming && (
            <div className="progress-section" style={{ marginTop: '8px' }}>
              <div className="progress-label">
                <span>Job Progress</span>
                <span>
                  {progressPct}% ({currentLine}/{totalLines})
                </span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions Card */}
        <div className="card dashboard-actions">
          <h2 className="section-header">Quick Actions</h2>
          <div className="quick-actions-grid">
            <button
              className="btn btn-primary quick-action-btn"
              onClick={goToOrigin}
              disabled={!connected}
            >
              <Crosshair size={18} />
              Go to Origin
            </button>
            <button
              className="btn btn-secondary quick-action-btn"
              onClick={penUp}
              disabled={!connected}
            >
              <ChevronUp size={18} />
              Head Up
            </button>
            <button
              className="btn btn-secondary quick-action-btn"
              onClick={penDown}
              disabled={!connected}
            >
              <ChevronDown size={18} />
              Head Down
            </button>
            <button
              className="btn btn-danger quick-action-btn"
              onClick={handleEStop}
              disabled={!connected}
            >
              <XCircle size={18} />
              E-Stop
            </button>
          </div>
        </div>

        {/* Quick Navigate Card */}
        <div className="card dashboard-navigate">
          <h2 className="section-header">Quick Navigate</h2>
          <div className="quick-nav-grid">
            <button
              className="btn btn-ghost full-width"
              onClick={() => navigate('/manual')}
            >
              <Move size={16} />
              Manual Control
            </button>
            <button
              className="btn btn-ghost full-width"
              onClick={() => navigate('/gcode')}
            >
              <FileBarChart2 size={16} />
              G-Code Jobs
            </button>
            <button
              className="btn btn-ghost full-width"
              onClick={() => navigate('/settings')}
            >
              <Settings size={16} />
              Settings
            </button>
            <button
              className="btn btn-ghost full-width"
              onClick={() => navigate('/console')}
            >
              <Terminal size={16} />
              Console
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
