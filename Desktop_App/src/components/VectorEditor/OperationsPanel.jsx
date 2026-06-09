import React from 'react';
import { Sliders, Spline, Undo2, Trash2 } from 'lucide-react';

export function OperationsPanel({
  simplifyTolerance, onSimplifyToleranceChange, onSimplify,
  onSmooth, onUndo, canUndo,
  onDeleteAll,
}) {
  return (
    <div className="ops-panel">
      <div className="ops-section">
        <label className="ops-label" title="Ramer-Douglas-Peucker tolerance in mm">
          <Sliders size={13} /> Simplify
        </label>
        <div className="ops-row">
          <input
            type="range" min="0.1" max="5" step="0.1"
            value={simplifyTolerance}
            onChange={e => onSimplifyToleranceChange(parseFloat(e.target.value))}
            className="ops-slider"
          />
          <span className="ops-val">{simplifyTolerance.toFixed(1)}</span>
        </div>
        <button className="btn btn-secondary ops-btn" onClick={onSimplify}>Apply Simplify</button>
      </div>

      <div className="ops-section">
        <label className="ops-label">
          <Spline size={13} /> Smooth
        </label>
        <button className="btn btn-secondary ops-btn" onClick={onSmooth}
          title="Convert L-only paths to curves (Catmull-Rom)">
          Smooth Edges
        </button>
      </div>

      <div className="ops-divider" />

      <button
        className="btn btn-secondary ops-btn"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo last operation (Ctrl+Z)"
      >
        <Undo2 size={13} /> Undo
      </button>

      <button className="btn btn-danger ops-btn" onClick={onDeleteAll} title="Delete all paths">
        <Trash2 size={13} /> Delete All
      </button>
    </div>
  );
}
