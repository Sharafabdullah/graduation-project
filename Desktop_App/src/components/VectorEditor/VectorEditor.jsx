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
} from '../../lib/pathOps.js';
import './VectorEditor.css';

let _uid = 0;
const uid = () => `ve-${++_uid}-${Date.now()}`;

const VectorEditor = forwardRef(function VectorEditor(
  { bedW = 200, bedH = 200, lineWidth = 1, backgroundColor = null,
    softLimitMargin = 10, homed = false, homeFloor = null },
  ref
) {
  const svgRef  = useRef(null);
  const wrapRef = useRef(null);
  const { vt, onWheel, startPan, updatePan, endPan, toSvg } = useViewTransform();

  const [paths,      setPaths]      = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tool,       setTool]       = useState('select');
  const [prevPaths,  setPrevPaths]  = useState(null);
  const [drawing,    setDrawing]    = useState(null);
  const [lineStart,  setLineStart]  = useState(null);
  const [simplifyTol, setSimplifyTol] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPanning,  setIsPanning]  = useState(false);
  const [fitScale,   setFitScale]   = useState(1);

  const toolRef = useRef(tool);
  useEffect(() => { toolRef.current = tool; }, [tool]);

  const nodeEditorRef   = useRef(null);
  const isDraggingNode  = useRef(false);

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
      setPrevPaths(paths);
      setPaths(fitted);
      setSelectedId(null);
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
      setPaths(prev => [...prev, ...fitted]);
    },
  }), [paths, bedW, bedH, backgroundColor]);

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
    const el = wrapRef.current;
    el?.addEventListener('node-drag-start', handleNodeDragStart);
    return () => el?.removeEventListener('node-drag-start', handleNodeDragStart);
  }, []);

  // ── SVG coordinate conversion ───────────────────────────────────────────────

  const getSvgCoords = useCallback((e) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return toSvg(e.clientX, e.clientY, rect);
  }, [toSvg]);

  const updateSelectedPath = useCallback((newD) => {
    setPaths(prev => prev.map(p => p.id === selectedId ? { ...p, d: newD } : p));
  }, [selectedId]);

  // ── Mouse handlers ──────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      startPan(e.clientX, e.clientY);
      return;
    }
    const { x, y } = getSvgCoords(e);
    const t = toolRef.current;
    if (t === 'pen')  setDrawing({ points: [{ x, y }] });
    if (t === 'line') setLineStart({ x, y });
  }, [getSvgCoords, startPan]);

  const handleMouseMove = useCallback((e) => {
    if (isPanning) { updatePan(e.clientX, e.clientY); return; }
    const { x, y } = getSvgCoords(e);
    if (isDraggingNode.current && nodeEditorRef.current) {
      nodeEditorRef.current.continueDrag(x, y);
      return;
    }
    const t = toolRef.current;
    if (t === 'pen' && drawing) {
      setDrawing(prev => ({ points: [...prev.points, { x, y }] }));
    }
  }, [isPanning, updatePan, getSvgCoords, drawing]);

  const handleMouseUp = useCallback((e) => {
    if (isPanning) { setIsPanning(false); endPan(); return; }
    if (isDraggingNode.current) {
      isDraggingNode.current = false;
      nodeEditorRef.current?.endDrag?.();
      return;
    }
    const { x, y } = getSvgCoords(e);
    const t = toolRef.current;

    if (t === 'pen' && drawing && drawing.points.length > 1) {
      const d = `M ${drawing.points[0].x.toFixed(3)} ${drawing.points[0].y.toFixed(3)} ` +
        drawing.points.slice(1).map(p => `L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ');
      setPrevPaths(paths);
      setPaths(prev => [...prev, { id: uid(), d, color: '#000000', fill: 'none' }]);
      setDrawing(null);
    }
    if (t === 'line' && lineStart) {
      const d = `M ${lineStart.x.toFixed(3)} ${lineStart.y.toFixed(3)} L ${x.toFixed(3)} ${y.toFixed(3)}`;
      setPrevPaths(paths);
      setPaths(prev => [...prev, { id: uid(), d, color: '#000000', fill: 'none' }]);
      setLineStart(null);
    }
  }, [isPanning, endPan, getSvgCoords, drawing, lineStart, paths]);

  // ── Keyboard ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e) => {
      if (document.activeElement.tagName === 'INPUT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        setPrevPaths(paths);
        setPaths(prev => prev.filter(p => p.id !== selectedId));
        setSelectedId(null);
        return;
      }
      if (e.key === 'Escape') { setSelectedId(null); setDrawing(null); setLineStart(null); return; }
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); if (prevPaths) { setPaths(prevPaths); setPrevPaths(null); } return; }
      if (!e.ctrlKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') setTool('select');
        if (e.key === 'p' || e.key === 'P') setTool('pen');
        if (e.key === 'l' || e.key === 'L') setTool('line');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, prevPaths, paths]);

  // ── Operations ──────────────────────────────────────────────────────────────

  const handleSimplify = useCallback(() => {
    setPrevPaths(paths);
    setPaths(prev => prev.map(p => ({ ...p, d: simplifyPath(p.d, simplifyTol) })));
  }, [paths, simplifyTol]);

  const handleSmooth = useCallback(() => {
    setPrevPaths(paths);
    setPaths(prev => prev.map(p => ({ ...p, d: smoothPath(p.d) })));
  }, [paths]);

  const handleUndo = useCallback(() => {
    if (prevPaths) { setPaths(prevPaths); setPrevPaths(null); }
  }, [prevPaths]);

  const confirmDeleteAll = useCallback(() => {
    setPrevPaths(paths);
    setPaths([]);
    setSelectedId(null);
    setConfirmOpen(false);
  }, [paths]);

  // ── Preview of in-progress draw ─────────────────────────────────────────────

  const previewD = drawing && drawing.points.length > 1
    ? `M ${drawing.points[0].x.toFixed(3)} ${drawing.points[0].y.toFixed(3)} ` +
      drawing.points.slice(1).map(p => `L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ')
    : null;

  const cursor = isPanning ? 'grabbing'
    : tool === 'select' ? 'default'
    : 'crosshair';

  const selectedPath = paths.find(p => p.id === selectedId);

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
        onWheel={onWheel}
      >
        <svg
          ref={svgRef}
          width={bedW * fitScale}
          height={bedH * fitScale}
          viewBox={`0 0 ${bedW} ${bedH}`}
          style={{ display: 'block', background: '#ffffff' }}
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

          <PathLayer paths={paths} selectedId={selectedId} onSelect={setSelectedId} />

          {selectedPath && (
            <NodeEditor
              ref={nodeEditorRef}
              path={selectedPath}
              onUpdateD={updateSelectedPath}
              scale={fitScale}
            />
          )}

          {previewD && (
            <path d={previewD} stroke="#007ACC" fill="none"
              strokeWidth={1} strokeDasharray="3,2" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>

      <OperationsPanel
        simplifyTolerance={simplifyTol}
        onSimplifyToleranceChange={setSimplifyTol}
        onSimplify={handleSimplify}
        onSmooth={handleSmooth}
        onUndo={handleUndo}
        canUndo={!!prevPaths}
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
