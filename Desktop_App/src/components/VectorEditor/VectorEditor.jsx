import React, {
  forwardRef, useImperativeHandle, useRef, useState, useCallback,
  useEffect,
} from 'react';
import ToolPalette from './ToolPalette';
import { PathLayer } from './PathLayer';
import { NodeEditor } from './NodeEditor';
import { OperationsPanel } from './OperationsPanel';
import Dialog from '../Dialog';
import { useViewTransform } from './useViewTransform';
import {
  svgToPaths, pathsToSvg, simplifyPath, smoothPath, fitPathsToBed,
  rectPath, ellipsePath, getPathBBox, applyMatrixToPath,
} from '../../lib/pathOps.js';
import './VectorEditor.css';

let _uid = 0;
const uid = () => `ve-${++_uid}-${Date.now()}`;

// Corner handle geometry for whole-shape group scaling: each corner's own bbox
// key (`hx`/`hy`), the opposite corner used as the scale anchor (`ax`/`ay`),
// and its resize cursor.
const CORNERS = {
  tl: { hx: 'minX', hy: 'minY', ax: 'maxX', ay: 'maxY', cursor: 'nwse-resize' },
  tr: { hx: 'maxX', hy: 'minY', ax: 'minX', ay: 'maxY', cursor: 'nesw-resize' },
  bl: { hx: 'minX', hy: 'maxY', ax: 'maxX', ay: 'minY', cursor: 'nesw-resize' },
  br: { hx: 'maxX', hy: 'maxY', ax: 'minX', ay: 'minY', cursor: 'nwse-resize' },
};

const VectorEditor = forwardRef(function VectorEditor(
  { bedW = 200, bedH = 200, lineWidth = 1, backgroundColor = null,
    softLimitMargin = 10, homed = false, homeFloor = null },
  ref
) {
  const svgRef  = useRef(null);
  const wrapRef = useRef(null);
  const { vt, onWheel, startPan, updatePan, endPan } = useViewTransform();

  const [paths,      setPaths]      = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [tool,       setTool]       = useState('select');
  const [history,    setHistory]    = useState([]);
  const [future,     setFuture]     = useState([]);
  const [drawing,    setDrawing]    = useState(null);
  const [lineStart,  setLineStart]  = useState(null);
  const [shapeStart,   setShapeStart]   = useState(null);
  const [shapeCurrent, setShapeCurrent] = useState(null);
  const [shapeShift,   setShapeShift]   = useState(false);
  const [selectedNodes, setSelectedNodes] = useState(() => new Set());
  const [shapeRect, setShapeRect] = useState(null);
  const [shapeDragging, setShapeDragging] = useState(false);
  const [transformDragging, setTransformDragging] = useState(false);
  const [simplifyTol, setSimplifyTol] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPanning,  setIsPanning]  = useState(false);
  const [fitScale,   setFitScale]   = useState(1);

  // A single selected path also gets per-node editing; multi-selection only
  // gets the whole-shape transform box.
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0] : null;

  // ── History (undo/redo) ─────────────────────────────────────────────────────

  const pushHistory = useCallback((snapshot) => {
    setHistory(h => [...h.slice(-49), snapshot]);
    setFuture([]);
  }, []);

  // Reset node selection whenever the selected path changes
  useEffect(() => { setSelectedNodes(new Set()); }, [selectedId]);

  const toolRef = useRef(tool);
  useEffect(() => { toolRef.current = tool; }, [tool]);

  const nodeEditorRef    = useRef(null);
  const isDraggingNode   = useRef(false);
  const shapeDragRef     = useRef(null);
  const transformDragRef = useRef(null);

  // ── Imperative API ──────────────────────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    toSVG: () => pathsToSvg(paths, bedW, bedH),

    loadSVG: (svgString) => {
      const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
      const root = doc.documentElement;
      const vbRaw = root.getAttribute('viewBox');
      const parts = vbRaw ? vbRaw.split(/\s+/).map(Number) : [0, 0, bedW, bedH];
      const vbW = parts[2] || bedW;
      const vbH = parts[3] || bedH;
      const loaded = svgToPaths(svgString, backgroundColor);
      const fitted = fitPathsToBed(loaded, vbW, vbH, bedW, bedH);
      pushHistory(paths);
      setPaths(fitted);
      setSelectedIds(new Set());
    },

    addSVG: (svgString) => {
      const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
      const root = doc.documentElement;
      const vbRaw = root.getAttribute('viewBox');
      const parts = vbRaw ? vbRaw.split(/\s+/).map(Number) : [0, 0, bedW, bedH];
      const vbW = parts[2] || bedW;
      const vbH = parts[3] || bedH;
      const loaded = svgToPaths(svgString, backgroundColor);
      const fitted = fitPathsToBed(loaded, vbW, vbH, bedW, bedH);
      pushHistory(paths);
      setPaths(prev => [...prev, ...fitted]);
    },
  }), [paths, bedW, bedH, backgroundColor, pushHistory]);

  // ── Fit SVG to container ────────────────────────────────────────────────────

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const pad = 32;
      const s = Math.min((width - pad) / bedW, (height - pad) / bedH, 4);
      setFitScale(s > 0 ? s : 1);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [bedW, bedH]);

  // ── Node drag detection ─────────────────────────────────────────────────────

  useEffect(() => {
    const handleNodeDragStart = () => { isDraggingNode.current = true; };
    const handleGlobalUp = () => {
      if (isDraggingNode.current) {
        isDraggingNode.current = false;
        nodeEditorRef.current?.endDrag?.();
      }
    };
    const el = wrapRef.current;
    el?.addEventListener('node-drag-start', handleNodeDragStart);
    window.addEventListener('mouseup', handleGlobalUp);
    return () => {
      el?.removeEventListener('node-drag-start', handleNodeDragStart);
      window.removeEventListener('mouseup', handleGlobalUp);
    };
  }, []);

  // ── SVG coordinate conversion ───────────────────────────────────────────────

  const getSvgCoords = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    // rect.width/height is the rendered size of the SVG (after CSS transforms)
    // viewBox is bedW × bedH
    return {
      x: (e.clientX - rect.left) / rect.width  * bedW,
      y: (e.clientY - rect.top)  / rect.height * bedH,
    };
  }, [bedW, bedH]);

  const updateSelectedPath = useCallback((newD) => {
    setPaths(prev => prev.map(p => p.id === selectedId ? { ...p, d: newD } : p));
  }, [selectedId]);

  // ── Whole-shape selection & group transforms ────────────────────────────────

  // Click on a shape: plain click selects only it (unless it's already part of
  // a multi-selection, in which case the whole group stays selected so it can
  // be dragged together); Shift/Ctrl-click toggles membership.
  const handleShapeMouseDown = useCallback((e, id) => {
    if (toolRef.current !== 'select') return;
    e.stopPropagation();
    const { x, y } = getSvgCoords(e);
    let newSel;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      newSel = new Set(selectedIds);
      if (newSel.has(id)) newSel.delete(id); else newSel.add(id);
    } else if (selectedIds.has(id) && selectedIds.size > 1) {
      newSel = selectedIds;
    } else {
      newSel = new Set([id]);
    }
    setSelectedIds(newSel);
    if (newSel.has(id)) {
      shapeDragRef.current = {
        origX: x, origY: y, moved: false,
        origD: new Map(paths.filter(p => newSel.has(p.id)).map(p => [p.id, p.d])),
      };
      setShapeDragging(true);
    }
  }, [getSvgCoords, selectedIds, paths]);

  const handleGroupScaleMouseDown = useCallback((e, cornerId, groupBBox) => {
    e.stopPropagation();
    const corner = CORNERS[cornerId];
    transformDragRef.current = {
      mode: 'scale', shiftLock: e.shiftKey, moved: false,
      anchor: { x: groupBBox[corner.ax], y: groupBBox[corner.ay] },
      handleOrig: { x: groupBBox[corner.hx], y: groupBBox[corner.hy] },
      origD: new Map(paths.filter(p => selectedIds.has(p.id)).map(p => [p.id, p.d])),
    };
    setTransformDragging(true);
  }, [paths, selectedIds]);

  const handleGroupRotateMouseDown = useCallback((e, groupBBox) => {
    e.stopPropagation();
    const cx = (groupBBox.minX + groupBBox.maxX) / 2;
    const cy = (groupBBox.minY + groupBBox.maxY) / 2;
    const { x, y } = getSvgCoords(e);
    transformDragRef.current = {
      mode: 'rotate', moved: false,
      center: { x: cx, y: cy },
      startAngle: Math.atan2(y - cy, x - cx),
      origD: new Map(paths.filter(p => selectedIds.has(p.id)).map(p => [p.id, p.d])),
    };
    setTransformDragging(true);
  }, [getSvgCoords, paths, selectedIds]);

  // ── Mouse handlers ──────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      setIsPanning(true);
      startPan(e.clientX, e.clientY);
      return;
    }
    const { x, y } = getSvgCoords(e);
    const t = toolRef.current;
    if (t === 'select') {
      // Clicked empty canvas (background) — start a rubber-band shape selection.
      setShapeRect({ start: { x, y }, current: { x, y }, additive: e.shiftKey });
      return;
    }
    if (t === 'pen')  setDrawing({ points: [{ x, y }] });
    if (t === 'line') setLineStart({ x, y });
    if (t === 'rect' || t === 'ellipse') {
      setShapeStart({ x, y });
      setShapeCurrent({ x, y });
      setShapeShift(e.shiftKey);
    }
  }, [getSvgCoords, startPan]);

  const handleMouseMove = useCallback((e) => {
    if (isPanning) { updatePan(e.clientX, e.clientY); return; }
    const { x, y } = getSvgCoords(e);
    if (isDraggingNode.current && nodeEditorRef.current) {
      nodeEditorRef.current.continueDrag(x, y);
      return;
    }
    if (shapeDragRef.current) {
      const drag = shapeDragRef.current;
      const dx = x - drag.origX, dy = y - drag.origY;
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
        if (!drag.moved) { pushHistory(paths); drag.moved = true; }
        const m = { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
        setPaths(prev => prev.map(p => drag.origD.has(p.id) ? { ...p, d: applyMatrixToPath(drag.origD.get(p.id), m) } : p));
      }
      return;
    }
    if (transformDragRef.current) {
      const t2 = transformDragRef.current;
      if (t2.mode === 'scale') {
        const { anchor, handleOrig, shiftLock, origD } = t2;
        const origVecX = handleOrig.x - anchor.x;
        const origVecY = handleOrig.y - anchor.y;
        const newVecX  = x - anchor.x;
        const newVecY  = y - anchor.y;
        let scaleX = origVecX !== 0 ? newVecX / origVecX : 1;
        let scaleY = origVecY !== 0 ? newVecY / origVecY : 1;
        if (shiftLock) {
          const s = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
          scaleX = Math.sign(scaleX || 1) * s;
          scaleY = Math.sign(scaleY || 1) * s;
        }
        const clamp = v => Math.sign(v || 1) * Math.max(Math.abs(v), 0.02);
        scaleX = clamp(scaleX); scaleY = clamp(scaleY);
        if (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001) {
          if (!t2.moved) { pushHistory(paths); t2.moved = true; }
          const m = { a: scaleX, b: 0, c: 0, d: scaleY, e: anchor.x * (1 - scaleX), f: anchor.y * (1 - scaleY) };
          setPaths(prev => prev.map(p => origD.has(p.id) ? { ...p, d: applyMatrixToPath(origD.get(p.id), m) } : p));
        }
      } else if (t2.mode === 'rotate') {
        const { center, startAngle, origD } = t2;
        const angle = Math.atan2(y - center.y, x - center.x) - startAngle;
        if (Math.abs(angle) > 0.001) {
          if (!t2.moved) { pushHistory(paths); t2.moved = true; }
          const cosA = Math.cos(angle), sinA = Math.sin(angle);
          const m = {
            a: cosA, b: sinA, c: -sinA, d: cosA,
            e: center.x - center.x * cosA + center.y * sinA,
            f: center.y - center.x * sinA - center.y * cosA,
          };
          setPaths(prev => prev.map(p => origD.has(p.id) ? { ...p, d: applyMatrixToPath(origD.get(p.id), m) } : p));
        }
      }
      return;
    }
    if (shapeRect) {
      setShapeRect(prev => ({ ...prev, current: { x, y } }));
      return;
    }
    const t = toolRef.current;
    if (t === 'pen' && drawing) {
      setDrawing(prev => ({ points: [...prev.points, { x, y }] }));
    }
    if ((t === 'rect' || t === 'ellipse') && shapeStart) {
      setShapeCurrent({ x, y });
      setShapeShift(e.shiftKey);
    }
  }, [isPanning, updatePan, getSvgCoords, drawing, shapeStart, shapeRect, paths, pushHistory]);

  const handleMouseUp = useCallback((e) => {
    if (isPanning) { setIsPanning(false); endPan(); return; }
    if (isDraggingNode.current) {
      isDraggingNode.current = false;
      nodeEditorRef.current?.endDrag?.();
      return;
    }
    if (shapeDragRef.current) {
      shapeDragRef.current = null;
      setShapeDragging(false);
      return;
    }
    if (transformDragRef.current) {
      transformDragRef.current = null;
      setTransformDragging(false);
      return;
    }
    const { x, y } = getSvgCoords(e);
    const t = toolRef.current;

    if (shapeRect) {
      const { start, current, additive } = shapeRect;
      const dragDist = Math.hypot(current.x - start.x, current.y - start.y);
      if (dragDist < 0.5) {
        // Plain click on empty canvas — deselect everything (unless shift-clicking).
        if (!additive) {
          setSelectedIds(new Set());
          setSelectedNodes(new Set());
        }
      } else {
        const x0 = Math.min(start.x, current.x), x1 = Math.max(start.x, current.x);
        const y0 = Math.min(start.y, current.y), y1 = Math.max(start.y, current.y);
        const hits = paths.filter(p => {
          const bb = getPathBBox(p.d);
          return bb && bb.minX <= x1 && bb.maxX >= x0 && bb.minY <= y1 && bb.maxY >= y0;
        }).map(p => p.id);
        setSelectedIds(prev => additive ? new Set([...prev, ...hits]) : new Set(hits));
      }
      setShapeRect(null);
      return;
    }

    if (t === 'pen' && drawing && drawing.points.length > 1) {
      const d = `M ${drawing.points[0].x.toFixed(3)} ${drawing.points[0].y.toFixed(3)} ` +
        drawing.points.slice(1).map(p => `L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ');
      pushHistory(paths);
      setPaths(prev => [...prev, { id: uid(), d, color: '#000000', fill: 'none' }]);
      setDrawing(null);
    }
    if (t === 'line' && lineStart) {
      const d = `M ${lineStart.x.toFixed(3)} ${lineStart.y.toFixed(3)} L ${x.toFixed(3)} ${y.toFixed(3)}`;
      pushHistory(paths);
      setPaths(prev => [...prev, { id: uid(), d, color: '#000000', fill: 'none' }]);
      setLineStart(null);
    }
    if ((t === 'rect' || t === 'ellipse') && shapeStart) {
      const shift = e.shiftKey || shapeShift;
      let { x: sx, y: sy } = shapeStart;
      let ex = x, ey = y;
      let w = ex - sx, h = ey - sy;
      if (shift) {
        const side = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * side;
        h = Math.sign(h || 1) * side;
      }
      const x0 = Math.min(sx, sx + w);
      const y0 = Math.min(sy, sy + h);
      const aw = Math.abs(w);
      const ah = Math.abs(h);
      if (aw > 0.5 && ah > 0.5) {
        const d = t === 'rect'
          ? rectPath(x0, y0, aw, ah)
          : ellipsePath(x0 + aw / 2, y0 + ah / 2, aw / 2, ah / 2);
        pushHistory(paths);
        setPaths(prev => [...prev, { id: uid(), d, color: '#000000', fill: 'none' }]);
      }
      setShapeStart(null);
      setShapeCurrent(null);
    }
  }, [isPanning, endPan, getSvgCoords, drawing, lineStart, shapeStart, shapeShift, shapeRect, paths, pushHistory]);

  // ── Keyboard ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e) => {
      if (document.activeElement.tagName === 'INPUT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        pushHistory(paths);
        setPaths(prev => prev.filter(p => !selectedIds.has(p.id)));
        setSelectedIds(new Set());
        setSelectedNodes(new Set());
        return;
      }
      if (e.key === 'Escape') {
        setSelectedIds(new Set()); setDrawing(null); setLineStart(null);
        setShapeStart(null); setShapeCurrent(null);
        setSelectedNodes(new Set()); setShapeRect(null);
        return;
      }
      if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          setFuture(f => {
            if (f.length === 0) return f;
            setHistory(h => [...h, paths]);
            setPaths(f[0]);
            return f.slice(1);
          });
        } else {
          setHistory(h => {
            if (h.length === 0) return h;
            setFuture(f => [paths, ...f]);
            setPaths(h[h.length - 1]);
            return h.slice(0, -1);
          });
        }
        setSelectedNodes(new Set());
        return;
      }
      if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        setFuture(f => {
          if (f.length === 0) return f;
          setHistory(h => [...h, paths]);
          setPaths(f[0]);
          return f.slice(1);
        });
        setSelectedNodes(new Set());
        return;
      }
      if (!e.ctrlKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') setTool('select');
        if (e.key === 'p' || e.key === 'P') setTool('pen');
        if (e.key === 'l' || e.key === 'L') setTool('line');
        if (e.key === 'r' || e.key === 'R') setTool('rect');
        if (e.key === 'e' || e.key === 'E') setTool('ellipse');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, paths, pushHistory]);

  // ── Global drag listeners (keep drag working when mouse exits container) ────

  useEffect(() => {
    const isAnyDragActive = isPanning || drawing !== null || lineStart !== null
      || shapeStart !== null || shapeRect !== null || shapeDragging || transformDragging;
    if (!isAnyDragActive) return;

    const onGlobalMove = (e) => handleMouseMove(e);
    const onGlobalUp   = (e) => handleMouseUp(e);
    window.addEventListener('mousemove', onGlobalMove);
    window.addEventListener('mouseup',   onGlobalUp);
    return () => {
      window.removeEventListener('mousemove', onGlobalMove);
      window.removeEventListener('mouseup',   onGlobalUp);
    };
  }, [isPanning, drawing, lineStart, shapeStart, shapeRect, shapeDragging, transformDragging, handleMouseMove, handleMouseUp]);

  // ── Non-passive wheel listener ──────────────────────────────────────────────

  useEffect(() => {
    const el = wrapRef.current;
    const handler = (e) => { e.preventDefault(); onWheel(e); };
    el?.addEventListener('wheel', handler, { passive: false });
    return () => el?.removeEventListener('wheel', handler);
  }, [onWheel]);

  // ── Operations ──────────────────────────────────────────────────────────────

  const handleSimplify = useCallback(() => {
    pushHistory(paths);
    setPaths(prev => prev.map(p => ({ ...p, d: simplifyPath(p.d, simplifyTol) })));
    setSelectedNodes(new Set());
  }, [paths, simplifyTol, pushHistory]);

  const handleSmooth = useCallback(() => {
    pushHistory(paths);
    setPaths(prev => prev.map(p => ({ ...p, d: smoothPath(p.d) })));
    setSelectedNodes(new Set());
  }, [paths, pushHistory]);

  const handleUndo = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) return h;
      setFuture(f => [paths, ...f]);
      setPaths(h[h.length - 1]);
      return h.slice(0, -1);
    });
    setSelectedNodes(new Set());
  }, [paths]);

  const handleRedo = useCallback(() => {
    setFuture(f => {
      if (f.length === 0) return f;
      setHistory(h => [...h, paths]);
      setPaths(f[0]);
      return f.slice(1);
    });
    setSelectedNodes(new Set());
  }, [paths]);

  const confirmDeleteAll = useCallback(() => {
    pushHistory(paths);
    setPaths([]);
    setSelectedIds(new Set());
    setSelectedNodes(new Set());
    setConfirmOpen(false);
  }, [paths, pushHistory]);

  // ── Preview of in-progress draw ─────────────────────────────────────────────

  const previewD = drawing && drawing.points.length > 1
    ? `M ${drawing.points[0].x.toFixed(3)} ${drawing.points[0].y.toFixed(3)} ` +
      drawing.points.slice(1).map(p => `L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ')
    : null;

  let shapePreviewD = null;
  if (shapeStart && shapeCurrent) {
    let { x: sx, y: sy } = shapeStart;
    let w = shapeCurrent.x - sx, h = shapeCurrent.y - sy;
    if (shapeShift) {
      const side = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * side;
      h = Math.sign(h || 1) * side;
    }
    const x0 = Math.min(sx, sx + w);
    const y0 = Math.min(sy, sy + h);
    const aw = Math.abs(w), ah = Math.abs(h);
    if (aw > 0.01 && ah > 0.01) {
      shapePreviewD = tool === 'rect'
        ? rectPath(x0, y0, aw, ah)
        : ellipsePath(x0 + aw / 2, y0 + ah / 2, aw / 2, ah / 2);
    }
  }

  const cursor = isPanning ? 'grabbing'
    : tool === 'select' ? 'default'
    : 'crosshair';

  const selectedPath = paths.find(p => p.id === selectedId);

  // Union bounding box of all selected shapes, for the group transform overlay.
  const groupBBox = paths.filter(p => selectedIds.has(p.id)).reduce((acc, p) => {
    const bb = getPathBBox(p.d);
    if (!bb) return acc;
    if (!acc) return { ...bb };
    return {
      minX: Math.min(acc.minX, bb.minX), minY: Math.min(acc.minY, bb.minY),
      maxX: Math.max(acc.maxX, bb.maxX), maxY: Math.max(acc.maxY, bb.maxY),
    };
  }, null);
  const hr = 4 / Math.max(fitScale, 0.1);
  const rotateOffset = 12 / Math.max(fitScale, 0.1);

  return (
    <div className="vector-editor">
      <ToolPalette activeTool={tool} onToolChange={setTool} />

      <div
        className="svg-canvas-wrap"
        ref={wrapRef}
        style={{ cursor }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <svg
          ref={svgRef}
          width={bedW * fitScale}
          height={bedH * fitScale}
          viewBox={`0 0 ${bedW} ${bedH}`}
          style={{ display: 'block', background: '#ffffff', transform: `translate(${vt.x}px, ${vt.y}px) scale(${vt.scale})`, transformOrigin: '0 0' }}
        >
          {/* Bed boundary */}
          <rect x={0} y={0} width={bedW} height={bedH}
            fill="none" stroke="#555" strokeWidth={0.5} strokeDasharray="4,4" />

          {/* Soft limit margin */}
          <rect
            x={softLimitMargin} y={softLimitMargin}
            width={Math.max(0, bedW - 2*softLimitMargin)}
            height={Math.max(0, bedH - 2*softLimitMargin)}
            fill="none" stroke="rgba(255,200,0,0.35)"
            strokeWidth={0.5} strokeDasharray="2,2" />

          {/* Home floor danger zone */}
          {homed && homeFloor && (
            <>
              <rect x={0} y={0} width={homeFloor.x} height={bedH}
                fill="rgba(241,76,76,0.12)" stroke="rgba(241,76,76,0.6)"
                strokeWidth={0.5} strokeDasharray="1,1" />
              <rect x={0} y={bedH - homeFloor.y} width={bedW} height={homeFloor.y}
                fill="rgba(241,76,76,0.12)" stroke="rgba(241,76,76,0.6)"
                strokeWidth={0.5} strokeDasharray="1,1" />
            </>
          )}

          <PathLayer paths={paths} selectedIds={selectedIds} onShapeMouseDown={handleShapeMouseDown} />

          {selectedPath && (
            <NodeEditor
              ref={nodeEditorRef}
              path={selectedPath}
              onUpdateD={updateSelectedPath}
              scale={fitScale}
              selectedNodes={selectedNodes}
              onSelectedNodesChange={setSelectedNodes}
              onBeforeChange={() => pushHistory(paths)}
            />
          )}

          {groupBBox && Number.isFinite(groupBBox.minX) && (
            <g className="shape-transform">
              <rect x={groupBBox.minX} y={groupBBox.minY}
                width={Math.max(0, groupBBox.maxX - groupBBox.minX)}
                height={Math.max(0, groupBBox.maxY - groupBBox.minY)}
                fill="none" stroke="var(--accent)"
                strokeWidth={0.75/Math.max(fitScale,0.1)}
                strokeDasharray={`${3/Math.max(fitScale,0.1)},${2/Math.max(fitScale,0.1)}`}
                style={{ pointerEvents: 'none' }} />
              {Object.entries(CORNERS).map(([id, corner]) => (
                <rect key={id}
                  x={groupBBox[corner.hx] - hr} y={groupBBox[corner.hy] - hr}
                  width={hr * 2} height={hr * 2}
                  fill="var(--accent)" stroke="#ffffff"
                  strokeWidth={0.5/Math.max(fitScale,0.1)}
                  style={{ cursor: corner.cursor }}
                  onMouseDown={e => handleGroupScaleMouseDown(e, id, groupBBox)}
                />
              ))}
              <line
                x1={(groupBBox.minX + groupBBox.maxX) / 2} y1={groupBBox.minY}
                x2={(groupBBox.minX + groupBBox.maxX) / 2} y2={groupBBox.minY - rotateOffset}
                stroke="var(--accent)" strokeWidth={0.5/Math.max(fitScale,0.1)} />
              <circle
                cx={(groupBBox.minX + groupBBox.maxX) / 2} cy={groupBBox.minY - rotateOffset}
                r={hr * 1.2} fill="var(--accent)" stroke="#ffffff"
                strokeWidth={0.5/Math.max(fitScale,0.1)}
                style={{ cursor: 'grab' }}
                onMouseDown={e => handleGroupRotateMouseDown(e, groupBBox)}
              />
            </g>
          )}

          {previewD && (
            <path d={previewD} stroke="#007ACC" fill="none"
              strokeWidth={1} strokeDasharray="3,2" vectorEffect="non-scaling-stroke" />
          )}

          {shapePreviewD && (
            <path d={shapePreviewD} stroke="#007ACC" fill="none"
              strokeWidth={1} strokeDasharray="3,2" vectorEffect="non-scaling-stroke" />
          )}

          {shapeRect && (() => {
            const { start, current } = shapeRect;
            const rx = Math.min(start.x, current.x);
            const ry = Math.min(start.y, current.y);
            const rw = Math.abs(current.x - start.x);
            const rh = Math.abs(current.y - start.y);
            if (rw < 0.5 && rh < 0.5) return null;
            return (
              <rect x={rx} y={ry} width={rw} height={rh}
                fill="rgba(255,152,0,0.12)" stroke="#ff9800"
                strokeWidth={0.5/Math.max(fitScale,0.1)}
                strokeDasharray={`${2/Math.max(fitScale,0.1)},${2/Math.max(fitScale,0.1)}`} />
            );
          })()}
        </svg>
      </div>

      <OperationsPanel
        simplifyTolerance={simplifyTol}
        onSimplifyToleranceChange={setSimplifyTol}
        onSimplify={handleSimplify}
        onSmooth={handleSmooth}
        onUndo={handleUndo}
        canUndo={history.length > 0}
        onRedo={handleRedo}
        canRedo={future.length > 0}
        onDeleteAll={() => setConfirmOpen(true)}
      />

      <Dialog
        open={confirmOpen}
        mode="confirm"
        title="Delete Everything"
        message="Are you sure you want to delete all paths?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={confirmDeleteAll}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
});

export default VectorEditor;
