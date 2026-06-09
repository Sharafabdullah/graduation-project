import React from 'react';

export function PathLayer({ paths, selectedId, onSelect }) {
  return (
    <g className="path-layer">
      {paths.map(p => (
        <path
          key={p.id}
          d={p.d}
          stroke={selectedId === p.id ? 'var(--accent)' : (p.color || '#000000')}
          fill={p.fill || 'none'}
          strokeWidth={selectedId === p.id ? 1.5 : 1}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: 'pointer' }}
          onMouseDown={e => { e.stopPropagation(); onSelect(p.id); }}
        />
      ))}
    </g>
  );
}
