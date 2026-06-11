import React from 'react';
import { isWhiteOrNone } from '../../lib/colorMatch.js';

export function PathLayer({ paths, selectedIds, onShapeMouseDown }) {
  return (
    <g className="path-layer">
      {paths.map(p => {
        const fill = p.fill || 'none';
        const stroke = p.color || '#000000';
        const fillIsBlank = isWhiteOrNone(fill);
        const strokeIsBlank = isWhiteOrNone(stroke);
        const isSelected = selectedIds.has(p.id);
        // White/blank shapes (e.g. a traced image's background fill) shouldn't
        // intercept clicks meant for the visible (black) shapes underneath.
        const pointerEvents = fillIsBlank && strokeIsBlank ? 'none'
          : fillIsBlank ? 'visibleStroke'
          : 'visiblePainted';
        return (
          <path
            key={p.id}
            d={p.d}
            stroke={isSelected ? 'var(--accent)' : stroke}
            fill={fill}
            strokeWidth={isSelected ? 1.5 : 1}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: 'pointer', pointerEvents }}
            onMouseDown={e => onShapeMouseDown(e, p.id)}
          />
        );
      })}
    </g>
  );
}
