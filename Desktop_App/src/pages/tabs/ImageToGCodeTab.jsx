import React, { useState, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { useImageTracer } from '../../hooks/useImageTracer';

export default function ImageToGCodeTab({ onSendToDrawer }) {
  const { trace, result: tracedSVG, loading, error } = useImageTracer();
  const [options, setOptions] = useState({
    numberofcolors: 2,
    ltres: 1,
    qtres: 1,
    pathomit: 8,
  });
  const [previewSrc, setPreviewSrc] = useState(null);
  const [sizeError, setSizeError] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      // 10 MB limit — imagetracerjs can be slow on very large images
      setSizeError('Image file too large. Please use an image under 10 MB.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreviewSrc(ev.target.result);
      setSizeError('');
      trace(ev.target.result, options);
    };
    reader.readAsDataURL(file);
  };

  const handleRetrace = () => {
    if (previewSrc) trace(previewSrc, options);
  };

  const setOpt = (key, val) =>
    setOptions((prev) => ({ ...prev, [key]: val }));

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
          {sizeError && <p className="error-text">{sizeError}</p>}
        </div>

        <div className="form-group">
          <label>Colors: {options.numberofcolors}</label>
          <input type="range" min="2" max="16" value={options.numberofcolors}
            onChange={(e) => setOpt('numberofcolors', Number(e.target.value))}
            className="slider" disabled={loading} />
        </div>

        <div className="form-group">
          <label>Line Threshold (ltres): {options.ltres}</label>
          <input type="range" min="0.1" max="5" step="0.1" value={options.ltres}
            onChange={(e) => setOpt('ltres', Number(e.target.value))}
            className="slider" disabled={loading} />
        </div>

        <div className="form-group">
          <label>Spline Threshold (qtres): {options.qtres}</label>
          <input type="range" min="0.1" max="5" step="0.1" value={options.qtres}
            onChange={(e) => setOpt('qtres', Number(e.target.value))}
            className="slider" disabled={loading} />
        </div>

        <div className="form-group">
          <label>Min Path Length (pathomit): {options.pathomit}</label>
          <input type="range" min="1" max="32" value={options.pathomit}
            onChange={(e) => setOpt('pathomit', Number(e.target.value))}
            className="slider" disabled={loading} />
        </div>

        <button
          className="btn btn-secondary"
          onClick={handleRetrace}
          disabled={!previewSrc || loading}
          style={{ width: '100%', marginTop: '0.5rem' }}
        >
          {loading ? 'Tracing…' : 'Re-trace'}
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

        <h3 className="section-header" style={{ marginTop: '1rem' }}>Traced Vector</h3>
        <div className="preview-box">
          {loading && <span className="placeholder-text">Tracing in background…</span>}
          {!loading && tracedSVG && (
            <div
              className="svg-preview"
              dangerouslySetInnerHTML={{ __html: tracedSVG }}
            />
          )}
          {!loading && !tracedSVG && !error && (
            <span className="placeholder-text">Result will appear here</span>
          )}
        </div>
      </div>
    </div>
  );
}
