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

const CORNERS = {
  tl: { hx: 'minX', hy: 'minY', ax: 'maxX', ay: 'maxY', cursor: 'nwse-resize' },
  tr: { hx: 'maxX', hy: 'minY', ax: 'minX', ay: 'maxY', cursor: 'nesw-resize' },
  bl: { hx: 'minX', hy: 'maxY', ax: 'maxX', ay: 'minY', cursor: 'nesw-resize' },
  br: { hx: 'maxX', hy: 'maxY', ax: 'minX', ay: 'minY', cursor: 'nwse-resize' },
};

export const NodeEditor = forwardRef(function NodeEditor(
  { path, onUpdateD, scale, selectedNodes, onSelectedNodesChange, onBeforeChange },
  ref
) {
  const dragging = useRef(null);
  const cmds  = useMemo(() => parsePath(path.d), [path.d]);
  const nodes = useMemo(() => buildNodes(cmds), [cmds]);
  const r     = 5 / Math.max(scale || 1, 0.1);
  const hr    = 4 / Math.max(scale || 1, 0.1);

  function bboxOf(selection) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selection.forEach(idx => {
      const node = nodes[idx];
      if (!node) return;
      minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y);
    });
    return { minX, minY, maxX, maxY };
  }

  useImperativeHandle(ref, () => ({
    continueDrag: (svgX, svgY) => {
      if (!dragging.current) return;
      if (dragging.current.mode === 'scale') return continueScale(svgX, svgY);
      const { selection, origX, origY, origCmds } = dragging.current;
      const dx = svgX - origX;
      const dy = svgY - origY;
      const updated = origCmds.map(c => ({ ...c }));
      selection.forEach(idx => {
        const node = nodes[idx];
        if (!node) return;
        const orig = origCmds[node.cmdIndex];
        const c = updated[node.cmdIndex];
        if (node.field === 'ctrl1') { c.x1 = orig.x1 + dx; c.y1 = orig.y1 + dy; }
        else if (node.field === 'ctrl2') { c.x2 = orig.x2 + dx; c.y2 = orig.y2 + dy; }
        else { if (orig.x !== undefined) c.x = orig.x + dx; if (orig.y !== undefined) c.y = orig.y + dy; }
      });
      onUpdateD(formatPath(updated));
    },
    endDrag: () => { dragging.current = null; },
  }), [nodes, onUpdateD]);

  function continueScale(svgX, svgY) {
    const { anchor, handleOrig, origCmds, selection, shiftLock } = dragging.current;
    const origVecX = handleOrig.x - anchor.x;
    const origVecY = handleOrig.y - anchor.y;
    const newVecX  = svgX - anchor.x;
    const newVecY  = svgY - anchor.y;
    let scaleX = origVecX !== 0 ? newVecX / origVecX : 1;
    let scaleY = origVecY !== 0 ? newVecY / origVecY : 1;
    if (shiftLock) {
      const s = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
      scaleX = Math.sign(scaleX || 1) * s;
      scaleY = Math.sign(scaleY || 1) * s;
    }
    const clamp = v => Math.sign(v || 1) * Math.max(Math.abs(v), 0.02);
    scaleX = clamp(scaleX); scaleY = clamp(scaleY);

    const updated = origCmds.map(c => ({ ...c }));
    selection.forEach(idx => {
      const node = nodes[idx];
      if (!node) return;
      const orig = origCmds[node.cmdIndex];
      const c = updated[node.cmdIndex];
      if (node.field === 'ctrl1') {
        c.x1 = anchor.x + (orig.x1 - anchor.x) * scaleX;
        c.y1 = anchor.y + (orig.y1 - anchor.y) * scaleY;
      } else if (node.field === 'ctrl2') {
        c.x2 = anchor.x + (orig.x2 - anchor.x) * scaleX;
        c.y2 = anchor.y + (orig.y2 - anchor.y) * scaleY;
      } else {
        if (orig.x !== undefined) c.x = anchor.x + (orig.x - anchor.x) * scaleX;
        if (orig.y !== undefined) c.y = anchor.y + (orig.y - anchor.y) * scaleY;
      }
    });
    onUpdateD(formatPath(updated));
  }

  const handleNodeMouseDown = (e, nodeIndex, svgX, svgY) => {
    e.stopPropagation();
    let newSelection;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      newSelection = new Set(selectedNodes);
      if (newSelection.has(nodeIndex)) newSelection.delete(nodeIndex);
      else newSelection.add(nodeIndex);
    } else if (selectedNodes.has(nodeIndex) && selectedNodes.size > 1) {
      newSelection = selectedNodes;
    } else {
      newSelection = new Set([nodeIndex]);
    }
    onSelectedNodesChange(newSelection);
    onBeforeChange?.();
    e.currentTarget.closest('svg')?.parentElement?.dispatchEvent(new CustomEvent('node-drag-start'));
    dragging.current = {
      mode: 'move', selection: newSelection,
      origX: svgX, origY: svgY,
      origCmds: JSON.parse(JSON.stringify(cmds)),
    };
  };

  const handleScaleMouseDown = (e, cornerId) => {
    e.stopPropagation();
    const bbox = bboxOf(selectedNodes);
    const corner = CORNERS[cornerId];
    const handleOrig = { x: bbox[corner.hx], y: bbox[corner.hy] };
    const anchor     = { x: bbox[corner.ax], y: bbox[corner.ay] };
    onBeforeChange?.();
    e.currentTarget.closest('svg')?.parentElement?.dispatchEvent(new CustomEvent('node-drag-start'));
    dragging.current = {
      mode: 'scale',
      anchor, handleOrig,
      origCmds: JSON.parse(JSON.stringify(cmds)),
      selection: new Set(selectedNodes),
      shiftLock: e.shiftKey,
    };
  };

  const handleLines = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== 'ctrl') continue;
    const anchor = nodes.find((n, j) => j > i && n.cmdIndex === nodes[i].cmdIndex && n.type === 'anchor');
    if (anchor) handleLines.push({ x1: nodes[i].x, y1: nodes[i].y, x2: anchor.x, y2: anchor.y });
  }

  const selBBox = selectedNodes.size >= 2 ? bboxOf(selectedNodes) : null;
  const dash = `${2/Math.max(scale||1,0.1)},${2/Math.max(scale||1,0.1)}`;

  return (
    <g className="node-editor">
      {handleLines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
          stroke="var(--accent)" strokeWidth={0.5/Math.max(scale||1,0.1)}
          strokeDasharray={dash} />
      ))}
      {nodes.map((node, i) => {
        const isSel = selectedNodes.has(i);
        return (
          <circle key={i} cx={node.x} cy={node.y} r={isSel ? r * 1.3 : r}
            fill={isSel ? '#ff9800' : (node.type === 'anchor' ? 'var(--accent)' : 'transparent')}
            stroke={isSel ? '#ff9800' : 'var(--accent)'}
            strokeWidth={1/Math.max(scale||1,0.1)}
            style={{ cursor: 'move' }}
            onMouseDown={e => handleNodeMouseDown(e, i, node.x, node.y)}
          />
        );
      })}
      {selBBox && Number.isFinite(selBBox.minX) && (
        <g className="scale-handles">
          <rect x={selBBox.minX} y={selBBox.minY}
            width={Math.max(0, selBBox.maxX - selBBox.minX)}
            height={Math.max(0, selBBox.maxY - selBBox.minY)}
            fill="none" stroke="#ff9800" strokeWidth={0.5/Math.max(scale||1,0.1)}
            strokeDasharray={dash} />
          {Object.entries(CORNERS).map(([id, corner]) => (
            <rect key={id}
              x={selBBox[corner.hx] - hr} y={selBBox[corner.hy] - hr}
              width={hr * 2} height={hr * 2}
              fill="#ff9800" stroke="#ffffff" strokeWidth={0.5/Math.max(scale||1,0.1)}
              style={{ cursor: corner.cursor }}
              onMouseDown={e => handleScaleMouseDown(e, id)}
            />
          ))}
        </g>
      )}
    </g>
  );
});
