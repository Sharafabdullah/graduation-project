import React from 'react';
import { MousePointer2, PenLine, Minus, Square, Circle } from 'lucide-react';

const TOOLS = [
  { id: 'select',  icon: MousePointer2, label: 'Select / Edit Nodes (V)' },
  { id: 'pen',     icon: PenLine,       label: 'Freehand Pen (P)' },
  { id: 'line',    icon: Minus,         label: 'Straight Line (L)' },
  { id: 'rect',    icon: Square,        label: 'Rectangle — drag to draw, hold Shift for square (R)' },
  { id: 'ellipse', icon: Circle,        label: 'Ellipse — drag to draw, hold Shift for circle (E)' },
];

export default function ToolPalette({ activeTool, onToolChange }) {
  return (
    <div className="tool-palette">
      {TOOLS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          className={`tool-btn${activeTool === id ? ' active' : ''}`}
          title={label}
          onClick={() => onToolChange(id)}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}
