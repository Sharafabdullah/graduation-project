import React from 'react';
import {
  MousePointer2, Square, Circle, Minus, PenLine, Type, Eraser, Trash2, FileX
} from 'lucide-react';

const TOOLS = [
  { id: 'select', icon: MousePointer2, label: 'Select' },
  { id: 'pen',    icon: PenLine,       label: 'Freehand' },
  { id: 'rect',   icon: Square,        label: 'Rectangle' },
  { id: 'circle', icon: Circle,        label: 'Circle' },
  { id: 'line',   icon: Minus,         label: 'Line' },
  { id: 'text',   icon: Type,          label: 'Text' },
  { id: 'eraser', icon: Eraser,        label: 'Eraser (click to delete)' },
];

export default function ToolPalette({ activeTool, onToolChange, onDeleteSelected, onDeleteAll }) {
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
      <button className="tool-btn tool-delete-all" title="Delete everything" onClick={onDeleteAll}>
        <FileX size={16} />
      </button>
    </div>
  );
}
