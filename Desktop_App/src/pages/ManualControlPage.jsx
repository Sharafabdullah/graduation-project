import React, { useState } from 'react';
import { useSerial } from '../contexts/SerialContext';
import './ManualControlPage.css';

export default function ManualControlPage() {
  const {
    connected, position, feedRate, jogWithIncrement, goToPosition, goHome, setZero,
    penUp, penDown, setServoAngle,
  } = useSerial();

  const [jogIncrement, setJogIncrement] = useState(1);
  const [goX, setGoX] = useState(0);
  const [goY, setGoY] = useState(0);
  const [servoAngle, setLocalServoAngle] = useState(75);

  const handleJog = (axis, direction) => {
    jogWithIncrement(axis, direction, jogIncrement);
  };

  const handleGoTo = () => {
    goToPosition(goX, goY);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Manual Control</h1>
        <p className="page-subtitle">Jog the machine, set positions, and control the head</p>
      </div>

      <div className="manual-grid">
        {/* Jog Pad */}
        <div className="card">
          <h2 className="section-header">Jog Controls</h2>
          <div className="form-row">
            <label>Jog Increment (mm)</label>
            <select value={jogIncrement} onChange={e => setJogIncrement(parseFloat(e.target.value))}>
              <option value="0.01">0.01</option>
              <option value="0.1">0.1</option>
              <option value="1">1</option>
              <option value="10">10</option>
              <option value="50">50</option>
            </select>
          </div>
          <div className="jog-pad">
            <div className="jog-row">
              <div className="jog-spacer" />
              <button className="btn btn-primary jog-btn" onClick={() => handleJog('Y', 1)} disabled={!connected} title="Y+">
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z" /></svg>
              </button>
              <div className="jog-spacer" />
            </div>
            <div className="jog-row">
              <button className="btn btn-primary jog-btn" onClick={() => handleJog('X', -1)} disabled={!connected} title="X-">
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z" /></svg>
              </button>
              <button className="btn btn-secondary jog-btn jog-center" onClick={goHome} disabled={!connected} title="Home">
                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M3.05,13H1V11H3.05C3.5,6.83 6.83,3.5 11,3.05V1H13V3.05C17.17,3.5 20.5,6.83 20.95,11H23V13H20.95C20.5,17.17 17.17,20.5 13,20.95V23H11V20.95C6.83,20.5 3.5,17.17 3.05,13M12,5A7,7 0 0,0 5,12A7,7 0 0,0 12,19A7,7 0 0,0 19,12A7,7 0 0,0 12,5Z" /></svg>
              </button>
              <button className="btn btn-primary jog-btn" onClick={() => handleJog('X', 1)} disabled={!connected} title="X+">
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z" /></svg>
              </button>
            </div>
            <div className="jog-row">
              <div className="jog-spacer" />
              <button className="btn btn-primary jog-btn" onClick={() => handleJog('Y', -1)} disabled={!connected} title="Y-">
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z" /></svg>
              </button>
              <div className="jog-spacer" />
            </div>
          </div>
          <div className="jog-increment-badges">
            {[0.01, 0.1, 1, 10, 50].map(v => (
              <button
                key={v}
                className={`increment-badge ${jogIncrement === v ? 'active' : ''}`}
                onClick={() => setJogIncrement(v)}
              >
                {v}mm
              </button>
            ))}
          </div>
        </div>

        {/* Position & Go To */}
        <div className="card">
          <h2 className="section-header">Position</h2>
          <div className="status-grid">
            <div className="status-cell">
              <span className="status-cell-label">Current X</span>
              <span className="status-cell-value">{position.x.toFixed(2)} mm</span>
            </div>
            <div className="status-cell">
              <span className="status-cell-label">Current Y</span>
              <span className="status-cell-value">{position.y.toFixed(2)} mm</span>
            </div>
          </div>

          <h2 className="section-header" style={{ marginTop: '12px' }}>Go To Position</h2>
          <div className="form-row-inline">
            <div className="form-field">
              <label>Go To X</label>
              <input type="number" value={goX} step="0.01" onChange={e => setGoX(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="form-field">
              <label>Go To Y</label>
              <input type="number" value={goY} step="0.01" onChange={e => setGoY(parseFloat(e.target.value) || 0)} />
            </div>
          </div>
          <div className="button-group">
            <button className="btn btn-primary full-width" onClick={handleGoTo} disabled={!connected}>Go</button>
            <button className="btn btn-secondary full-width" onClick={goHome} disabled={!connected}>Home</button>
          </div>
          <button className="btn btn-ghost full-width" onClick={setZero} disabled={!connected}>
            Set Current as Origin (G92)
          </button>
        </div>

        {/* Pen Control */}
        <div className="card">
          <h2 className="section-header">Head Control</h2>
          <div className="button-group" style={{ flexDirection: 'column' }}>
            <button className="btn btn-primary full-width" onClick={penUp} disabled={!connected}>
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z" /></svg>
              Head Up (M5)
            </button>
            <button className="btn btn-primary full-width" onClick={penDown} disabled={!connected}>
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z" /></svg>
              Head Down (M3)
            </button>
          </div>
          <div className="form-row" style={{ marginTop: '8px' }}>
            <label>Custom Servo Angle: {servoAngle}°</label>
            <input
              type="range"
              min="0"
              max="180"
              value={servoAngle}
              onChange={e => setLocalServoAngle(parseInt(e.target.value))}
              style={{ height: 'auto', padding: 0 }}
            />
            <button className="btn btn-secondary btn-sm" onClick={() => setServoAngle(servoAngle)} disabled={!connected}>
              Set Angle (M280 S{servoAngle})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
