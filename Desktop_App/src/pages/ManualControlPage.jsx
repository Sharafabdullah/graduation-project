import React, { useState } from 'react';
import { useSerial } from '../contexts/SerialContext';
import { useMode } from '../contexts/ModeContext';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Crosshair } from 'lucide-react';
import ModeSelector from '../components/ModeSelector';
import './ManualControlPage.css';

export default function ManualControlPage() {
  const {
    connected, position, feedRate, jogWithIncrement, goToPosition, goToOrigin, homeStage, setZero,
    penUp, penDown, setServoAngle, sendCommand
  } = useSerial();
  const { modeConfig } = useMode();

  const [jogIncrement, setJogIncrement] = useState(1);
  const [goX, setGoX] = useState(0);
  const [goY, setGoY] = useState(0);
  const [servoAngle, setLocalServoAngle] = useState(75);
  const [toolPower, setToolPower] = useState(200);

  const handleJog = (axis, direction) => {
    jogWithIncrement(axis, direction, jogIncrement);
  };

  const handleGoTo = () => {
    goToPosition(goX, goY);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Manual Control</h1>
          <p className="page-subtitle">Jog the machine, set positions, and control the head</p>
        </div>
        <ModeSelector />
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
                <ChevronUp size={20} />
              </button>
              <div className="jog-spacer" />
            </div>
            <div className="jog-row">
              <button className="btn btn-primary jog-btn" onClick={() => handleJog('X', 1)} disabled={!connected} title="X-">
                <ChevronLeft size={20} />
              </button>
              <button className="btn btn-secondary jog-btn jog-center" onClick={goToOrigin} disabled={!connected} title="Go to Origin">
                <Crosshair size={18} />
              </button>
              <button className="btn btn-primary jog-btn" onClick={() => handleJog('X', -1)} disabled={!connected} title="X+">
                <ChevronRight size={20} />
              </button>
            </div>
            <div className="jog-row">
              <div className="jog-spacer" />
              <button className="btn btn-primary jog-btn" onClick={() => handleJog('Y', -1)} disabled={!connected} title="Y-">
                <ChevronDown size={20} />
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button className="btn btn-primary full-width" onClick={handleGoTo} disabled={!connected}>Go To Custom X/Y</button>
            <button className="btn btn-secondary full-width" onClick={goToOrigin} disabled={!connected}>Go to Origin</button>
            <button className="btn btn-ghost full-width" onClick={homeStage} disabled={!connected}>Home Stage</button>
            <button className="btn btn-ghost full-width" onClick={setZero} disabled={!connected}>Set Origin (G92)</button>
          </div>
        </div>

        {/* Tool Control */}
        <div className="card">
          <h2 className="section-header">{modeConfig.label} Control</h2>
          <div className="button-group" style={{ flexDirection: 'column' }}>
            <button className="btn btn-primary full-width" onClick={penUp} disabled={!connected}>
              <ChevronUp size={16} />
              {modeConfig.toolOffLabel} ({modeConfig.toolOffCmd})
            </button>
            <button className="btn btn-primary full-width" onClick={penDown} disabled={!connected}>
              <ChevronDown size={16} />
              {modeConfig.toolOnLabel} ({modeConfig.toolOnCmd})
            </button>
          </div>

          {(modeConfig.hasSpindleSpeed || modeConfig.hasLaserPower) && (
            <div className="form-row" style={{ marginTop: '16px' }}>
              <label>{modeConfig.hasLaserPower ? 'Laser Power' : 'Spindle Speed'} (0-255): {toolPower}</label>
              <input
                type="range"
                min="0"
                max="255"
                value={toolPower}
                onChange={e => setToolPower(parseInt(e.target.value))}
                style={{ height: 'auto', padding: 0 }}
              />
              <button className="btn btn-secondary btn-sm" onClick={() => sendCommand(`M3 S${toolPower}`)} disabled={!connected}>
                Turn On at {toolPower}
              </button>
            </div>
          )}

          {modeConfig.hasServo && (
            <div className="form-row" style={{ marginTop: '16px' }}>
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
          )}
        </div>
      </div>
    </div>
  );
}
