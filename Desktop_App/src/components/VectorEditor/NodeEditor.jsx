import React, { forwardRef, useImperativeHandle, useRef, useMemo } from 'react';
import { parsePath, formatPath } from '../../lib/pathOps.js';

function buildNodes(cmds) {
  const nodes = [];
  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i];
    if (['M','L','Z'].includes(cmd.code) && cmd.x !== undefined) {
      nodes.push({ cmdIndex: i, field: null, x: cmd.x, y: cmd.y, type: 'anchor' });
    } else if (cmd.code === 'Q') {
      nodes.push({ cmdIndex: i, field: 'ctrl1', x: cmd.x1, y: cmd.y1, type: 'ctrl' });
      nodes.push({ cmdIndex: i, field: null,    x: cmd.x,  y: cmd.y,  type: 'anchor' });
    } else if (cmd.code === 'C') {
      nodes.push({ cmdIndex: i, field: 'ctrl1', x: cmd.x1, y: cmd.y1, type: 'ctrl' });
      nodes.push({ cmdIndex: i, field: 'ctrl2', x: cmd.x2, y: cmd.y2, type: 'ctrl' });
      nodes.push({ cmdIndex: i, field: null,    x: cmd.x,  y: cmd.y,  type: 'anchor' });
    }
  }
  return nodes;
}

export const NodeEditor = forwardRef(function NodeEditor({ path, onUpdateD, scale }, ref) {
  const dragging = useRef(null);
  const cmds  = useMemo(() => parsePath(path.d), [path.d]);
  const nodes = useMemo(() => buildNodes(cmds), [cmds]);
  const r     = 5 / Math.max(scale || 1, 0.1);

  useImperativeHandle(ref, () => ({
    continueDrag: (svgX, svgY) => {
      if (!dragging.current) return;
      const { nodeIndex, origX, origY, origCmds } = dragging.current;
      const node = nodes[nodeIndex];
      const dx = svgX - origX;
      const dy = svgY - origY;
      const updated = origCmds.map((cmd, ci) => {
        if (ci !== node.cmdIndex) return cmd;
        const c = { ...cmd };
        if (node.field === 'ctrl1') { c.x1 += dx; c.y1 += dy; }
        else if (node.field === 'ctrl2') { c.x2 += dx; c.y2 += dy; }
        else { if (c.x !== undefined) c.x += dx; if (c.y !== undefined) c.y += dy; }
        return c;
      });
      onUpdateD(formatPath(updated));
    },
    endDrag: () => { dragging.current = null; },
  }), [nodes, onUpdateD]);

  const handleNodeMouseDown = (e, nodeIndex, svgX, svgY) => {
    e.stopPropagation();
    e.currentTarget.closest('svg')?.parentElement?.dispatchEvent(new CustomEvent('node-drag-start'));
    dragging.current = { nodeIndex, origX: svgX, origY: svgY, origCmds: JSON.parse(JSON.stringify(cmds)) };
  };

  const handleLines = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== 'ctrl') continue;
    const anchor = nodes.find((n, j) => j > i && n.cmdIndex === nodes[i].cmdIndex && n.type === 'anchor');
    if (anchor) handleLines.push({ x1: nodes[i].x, y1: nodes[i].y, x2: anchor.x, y2: anchor.y });
  }

  return (
    <g className="node-editor">
      {handleLines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
          stroke="var(--accent)" strokeWidth={0.5/Math.max(scale||1,0.1)}
          strokeDasharray={`${2/Math.max(scale||1,0.1)},${2/Math.max(scale||1,0.1)}`} />
      ))}
      {nodes.map((node, i) => (
        <circle key={i} cx={node.x} cy={node.y} r={r}
          fill={node.type === 'anchor' ? 'var(--accent)' : 'transparent'}
          stroke="var(--accent)" strokeWidth={1/Math.max(scale||1,0.1)}
          style={{ cursor: 'move' }}
          onMouseDown={e => handleNodeMouseDown(e, i, node.x, node.y)}
        />
      ))}
    </g>
  );
});
