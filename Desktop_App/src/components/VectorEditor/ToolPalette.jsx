import React from 'react';
import {
  MousePointer2, Square, Circle, Minus, PenLine, Type, Trash2
} from 'lucide-react';

const TOOLS = [
  { id: 'select', icon: MousePointer2, label: 'Select' },
  { id: 'rect',   icon: Square,        label: 'Rectangle' },
  { id: 'circle', icon: Circle,        label: 'Circle' },
  { id: 'line',   icon: Minus,         label: 'Line' },
  { id: 'pen',    icon: PenLine,       label: 'Freehand' },
  { id: 'text',   icon: Type,          label: 'Text' },
];

export default function ToolPalette({ activeTool, onToolChange, onDeleteSelected }) {
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
      <div className="tool-divider" />
      <button className="tool-btn tool-delete" title="Delete selected" onClick={onDeleteSelected}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}
