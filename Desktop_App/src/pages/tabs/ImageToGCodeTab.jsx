import React, { useRef, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { useImageTracer } from '../../hooks/useImageTracer';
import { useImage2GCode } from '../../contexts/Image2GCodeContext';
import { binarizeImageData } from '../../lib/imageBinarize';

export default function ImageToGCodeTab({ onSendToDrawer, mode }) {
  const { trace, result: tracerResult, backgroundColor: sampledBackground, loading, error } = useImageTracer();
  const {
    previewSrc, setPreviewSrc,
    tracedSVG, setTracedSVG,
    tracerOptions, setTracerOptions,
    setBackgroundColor,
  } = useImage2GCode();

  const fileInputRef = useRef(null);
  const binarizedCanvasRef = useRef(null);

  useEffect(() => {
    if (tracerResult) setTracedSVG(tracerResult);
  }, [tracerResult, setTracedSVG]);

  useEffect(() => {
    if (sampledBackground) setBackgroundColor(sampledBackground);
  }, [sampledBackground, setBackgroundColor]);

  // Live threshold preview: re-binarize whenever source image or threshold changes (outline mode only)
  useEffect(() => {
    if (mode !== 'outline' || !previewSrc) return;
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
  }, [previewSrc, tracerOptions.threshold, mode]);

  const setOpt = (key, val) =>
    setTracerOptions((prev) => ({ ...prev, [key]: val }));

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreviewSrc(ev.target.result);
      setTracedSVG(null);
      trace(ev.target.result, { ...tracerOptions, multicolorMode: mode === 'multicolor' });
    };
    reader.readAsDataURL(file);
  };

  const handleRetrace = () => {
    if (previewSrc) trace(previewSrc, { ...tracerOptions, multicolorMode: mode === 'multicolor' });
  };

  return (
    <div className="tab-content image-tab">
      <div className="image-tab-controls card">
        <h3 className="section-header">Import Image</h3>

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

        {mode === 'outline' && (
          <div className="form-group">
            <label>Ink Threshold: {tracerOptions.threshold}</label>
            <input type="range" min="0" max="255" value={tracerOptions.threshold}
              onChange={(e) => setOpt('threshold', Number(e.target.value))}
              className="slider" disabled={loading} />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
              Pixels darker than this are drawn; lighter pixels are skipped.
            </p>
          </div>
        )}

        {mode === 'multicolor' && (
          <div className="form-group">
            <label>Color Levels: {tracerOptions.numberofcolors}</label>
            <input type="range" min="2" max="16" value={tracerOptions.numberofcolors}
              onChange={(e) => setOpt('numberofcolors', Number(e.target.value))}
              className="slider" disabled={loading} />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
              Number of distinct ink colors to extract. Machine pauses between colors for pen swap.
            </p>
          </div>
        )}

        <div className="form-group">
          <label>Curve Smoothness: {tracerOptions.qtres}</label>
          <input type="range" min="0.1" max="4" step="0.1" value={tracerOptions.qtres}
            onChange={(e) => setOpt('qtres', Number(e.target.value))}
            className="slider" disabled={loading} />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
            Higher = smoother curves. Lower = follows contours more precisely.
          </p>
        </div>

        <div className="form-group">
          <label>Noise Filter: {tracerOptions.pathomit}px</label>
          <input type="range" min="0" max="64" value={tracerOptions.pathomit}
            onChange={(e) => setOpt('pathomit', Number(e.target.value))}
            className="slider" disabled={loading} />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
            Removes stray marks smaller than this size (pixels).
          </p>
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
            onClick={() => onSendToDrawer(tracedSVG)}
            style={{ width: '100%', marginTop: '0.5rem' }}
          >
            <ArrowRight size={14} style={{ marginRight: 6 }} />
            Open in Drawer
          </button>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="image-tab-preview card">
        <h3 className="section-header">Original</h3>
        <div className="preview-box">
          {previewSrc
            ? <img src={previewSrc} alt="Original" className="preview-img" />
            : <span className="placeholder-text">No image loaded</span>}
        </div>

        {mode === 'outline' && (
          <>
            <h3 className="section-header">Threshold Preview</h3>
            <div className="preview-box">
              {previewSrc
                ? <canvas ref={binarizedCanvasRef} className="preview-canvas" />
                : <span className="placeholder-text">Load an image to preview the B/W mask</span>}
            </div>
          </>
        )}

        <h3 className="section-header">Traced Vector</h3>
        <div className="preview-box">
          {loading && <span className="placeholder-text">Tracing in background…</span>}
          {!loading && tracedSVG && (
            <div className="svg-preview" dangerouslySetInnerHTML={{ __html: tracedSVG }} />
          )}
          {!loading && !tracedSVG && !error && (
            <span className="placeholder-text">Result will appear here after tracing</span>
          )}
        </div>
      </div>
    </div>
  );
}
