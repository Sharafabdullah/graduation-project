import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PlusCircle } from 'lucide-react';
import { useImageTracer } from '../../hooks/useImageTracer';
import { useImage2GCode } from '../../contexts/Image2GCodeContext';
import { binarizeImageData } from '../../lib/imageBinarize';

export default function ImageToGCodeTab({ onAddToCanvas }) {
  const { trace, result: tracerResult, backgroundColor: sampledBackground, loading, error } = useImageTracer();
  const {
    previewSrc, setPreviewSrc,
    tracedSVG, setTracedSVG,
    tracerOptions, setTracerOptions,
    setBackgroundColor,
    tracerMode, setTracerMode,
    lineWidth, setLineWidth,
    fillWideStrokes, setFillWideStrokes,
  } = useImage2GCode();

  const fileInputRef = useRef(null);
  const binarizedCanvasRef = useRef(null);

  useEffect(() => {
    if (tracerResult) setTracedSVG(tracerResult);
  }, [tracerResult, setTracedSVG]);

  useEffect(() => {
    if (sampledBackground) setBackgroundColor(sampledBackground);
  }, [sampledBackground, setBackgroundColor]);

  // Live threshold preview
  useEffect(() => {
    if (tracerMode !== 'outline' || !previewSrc) return;
    const canvas = binarizedCanvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const binarized = binarizeImageData(imageData, tracerOptions.threshold);
      ctx.putImageData(new ImageData(binarized.data, binarized.width, binarized.height), 0, 0);
    };
    img.src = previewSrc;
  }, [previewSrc, tracerOptions.threshold, tracerMode]);

  const setOpt = (key, val) =>
    setTracerOptions((prev) => ({ ...prev, [key]: val }));

  // ── Synchronized pan/zoom ────────────────────────────────────────────────
  // All three preview boxes share a single transform: translate(tx,ty) scale(scale)
  // with transformOrigin '0 0'. At scale=1, tx=ty=0 the image is centered inside
  // the box (by the inner flex wrapper). Zoom math keeps the point under the
  // cursor fixed across scale changes.
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const [view, setViewState] = useState({ scale: 1, tx: 0, ty: 0 });
  const dragging = useRef(false);
  const dragStart = useRef(null);
  const previewPanelRef = useRef(null);

  const setView = useCallback((updater) => {
    setViewState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      viewRef.current = next;
      return next;
    });
  }, []);

  const resetView = useCallback(() => {
    setView({ scale: 1, tx: 0, ty: 0 });
  }, [setView]);

  // Wheel: must be non-passive to call preventDefault
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const box = e.target.closest('.preview-box');
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView(v => {
      const newScale = Math.max(0.15, Math.min(30, v.scale * factor));
      const ratio = newScale / v.scale;
      return { scale: newScale, tx: cx + (v.tx - cx) * ratio, ty: cy + (v.ty - cy) * ratio };
    });
  }, [setView]);

  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel) return;
    panel.addEventListener('wheel', handleWheel, { passive: false });
    return () => panel.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Drag pan
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    dragStart.current = {
      x: e.clientX, y: e.clientY,
      tx: viewRef.current.tx, ty: viewRef.current.ty,
    };
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current || !dragStart.current) return;
      const { x, y, tx, ty } = dragStart.current;
      setView(v => ({ ...v, tx: tx + (e.clientX - x), ty: ty + (e.clientY - y) }));
    };
    const onUp = () => { dragging.current = false; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [setView]);

  // The inner wrapper for each preview box: fills the box, centers content,
  // and carries the shared transform. transformOrigin '0 0' + the zoom math
  // in handleWheel keeps the hovered point fixed during zoom.
  const transformWrap = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
    transformOrigin: '0 0',
    userSelect: 'none',
    pointerEvents: 'none',
  };

  // ── File handling ────────────────────────────────────────────────────────
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return;
    resetView();
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreviewSrc(ev.target.result);
      setTracedSVG(null);
      trace(ev.target.result, { ...tracerOptions, multicolorMode: tracerMode === 'multicolor' });
    };
    reader.readAsDataURL(file);
  };

  const handleRetrace = () => {
    if (previewSrc) trace(previewSrc, { ...tracerOptions, multicolorMode: tracerMode === 'multicolor' });
  };

  return (
    <div className="tab-content image-tab">
      {/* ── Controls panel ───────────────────────────────────────────────── */}
      <div className="image-tab-controls card">

        {/* Mode toggle */}
        <div className="tracer-mode-toggle">
          <button
            className={`mode-btn${tracerMode === 'outline' ? ' active' : ''}`}
            onClick={() => setTracerMode('outline')}
          >Outline</button>
          <button
            className={`mode-btn${tracerMode === 'multicolor' ? ' active' : ''}`}
            onClick={() => setTracerMode('multicolor')}
          >Multicolor</button>
        </div>

        <div className="form-group">
          <label>Image File (JPG / PNG)</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="file-input"
            onChange={handleFileChange}
          />
        </div>

        {tracerMode === 'outline' && (
          <div className="form-group">
            <label>Ink Threshold: {tracerOptions.threshold}</label>
            <input type="range" min="0" max="255" value={tracerOptions.threshold}
              onChange={(e) => setOpt('threshold', Number(e.target.value))}
              className="slider" disabled={loading} />
            <p className="hint-text">Pixels darker than this are drawn; lighter are skipped.</p>
          </div>
        )}

        {tracerMode === 'multicolor' && (
          <div className="form-group">
            <label>Color Levels: {tracerOptions.numberofcolors}</label>
            <input type="range" min="2" max="16" value={tracerOptions.numberofcolors}
              onChange={(e) => setOpt('numberofcolors', Number(e.target.value))}
              className="slider" disabled={loading} />
            <p className="hint-text">Number of distinct ink colors. Machine pauses between colors.</p>
          </div>
        )}

        <div className="form-group">
          <label>Curve Smoothness: {tracerOptions.qtres}</label>
          <input type="range" min="0.1" max="4" step="0.1" value={tracerOptions.qtres}
            onChange={(e) => setOpt('qtres', Number(e.target.value))}
            className="slider" disabled={loading} />
          <p className="hint-text">Higher = smoother curves. Lower = follows contours precisely.</p>
        </div>

        <div className="form-group">
          <label>Line Precision: {tracerOptions.ltres}</label>
          <input type="range" min="0.1" max="4" step="0.1" value={tracerOptions.ltres}
            onChange={(e) => setOpt('ltres', Number(e.target.value))}
            className="slider" disabled={loading} />
          <p className="hint-text">Lower = more precise straight-line tracing. Higher = simpler paths.</p>
        </div>

        <div className="form-group">
          <label>Pre-blur: {tracerOptions.blurradius}px</label>
          <input type="range" min="0" max="5" step="1" value={tracerOptions.blurradius}
            onChange={(e) => setOpt('blurradius', Number(e.target.value))}
            className="slider" disabled={loading} />
          <p className="hint-text">Blur before tracing to reduce noise and smooth jagged edges.</p>
        </div>

        <div className="form-group">
          <label>Noise Filter: {tracerOptions.pathomit}px</label>
          <input type="range" min="0" max="64" value={tracerOptions.pathomit}
            onChange={(e) => setOpt('pathomit', Number(e.target.value))}
            className="slider" disabled={loading} />
          <p className="hint-text">Removes stray marks smaller than this size.</p>
        </div>

        {/* Output/compile settings */}
        <div className="settings-divider">Output Settings</div>

        <div className="output-settings-row">
          <div className="form-group form-group--small">
            <label>Line Width (mm)</label>
            <input
              type="number" min="0.1" max="10" step="0.1"
              value={lineWidth}
              onChange={(e) => setLineWidth(Number(e.target.value))}
              className="number-input"
              style={{ width: 70 }}
            />
          </div>
          <label className="checkbox-label" title="Draw closed shapes as parallel inward passes spaced by Line Width">
            <input
              type="checkbox"
              checked={fillWideStrokes}
              onChange={(e) => setFillWideStrokes(e.target.checked)}
            />
            Fill wide strokes
          </label>
        </div>

        <button
          className="btn btn-secondary"
          onClick={handleRetrace}
          disabled={!previewSrc || loading}
          style={{ width: '100%', marginTop: '0.5rem' }}
        >
          {loading ? 'Tracing…' : tracedSVG ? 'Re-trace' : 'Trace'}
        </button>

        {tracedSVG && (
          <button
            className="btn btn-primary"
            onClick={() => onAddToCanvas(tracedSVG)}
            style={{ width: '100%' }}
          >
            <PlusCircle size={14} style={{ marginRight: 6 }} />
            Add to Canvas
          </button>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>

      {/* ── Preview panel ────────────────────────────────────────────────── */}
      <div
        className="image-tab-preview card"
        ref={previewPanelRef}
        onMouseDown={handleMouseDown}
        style={{ position: 'relative' }}
      >
        {/* Floating Reset View button in top-right corner of the panel */}
        <button
          className="btn btn-ghost btn-sm preview-reset-btn"
          onClick={resetView}
          title="Reset zoom and pan (double-click any preview)"
        >
          Reset View
        </button>

        <div className="preview-box" onDoubleClick={resetView}>
          <span className="preview-box-label">Original</span>
          {previewSrc ? (
            <div style={transformWrap}>
              <img src={previewSrc} alt="Original" className="preview-img" draggable={false} />
            </div>
          ) : (
            <span className="placeholder-text">No image loaded</span>
          )}
        </div>

        {tracerMode === 'outline' && (
          <div className="preview-box" onDoubleClick={resetView}>
            <span className="preview-box-label">Threshold</span>
            {previewSrc ? (
              <div style={transformWrap}>
                <canvas ref={binarizedCanvasRef} className="preview-canvas" />
              </div>
            ) : (
              <span className="placeholder-text">Load an image to preview the B/W mask</span>
            )}
          </div>
        )}

        <div className="preview-box" onDoubleClick={resetView}>
          <span className="preview-box-label">Traced Vector</span>
          {loading && <span className="placeholder-text">Tracing in background…</span>}
          {!loading && tracedSVG && (
            <div style={transformWrap}>
              <div className="svg-preview" dangerouslySetInnerHTML={{ __html: tracedSVG }} />
            </div>
          )}
          {!loading && !tracedSVG && !error && (
            <span className="placeholder-text">Result will appear here after tracing</span>
          )}
        </div>
      </div>
    </div>
  );
}
