# Image to G-Code — Tracer & Modes Complete Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `esm-potrace-wasm` tracer with `imagetracerjs`, redesign the UI into three explicit modes (Outline / Multicolor / Drawing), and fix the layout so previews fill their container without scrollbars.

**Architecture:** `imagetracerjs` is a pure-JS raster→SVG library (no WASM) that takes `{width, height, data: Uint8ClampedArray}` and returns an SVG string synchronously in a Web Worker. The `tracerWorker.js` is the sole integration point; everything above it (hook, context, UI) just needs its options renamed and the mode split made explicit. The three modes map to four tabs in the page: `outline` (new default, was `image`), `multicolor` (new, extracted from the old checkbox), `drawer` (unchanged), `gcode` (was `outline` — renamed to avoid collision).

**Tech Stack:** Electron 28, React 18, Vite 6, `imagetracerjs` v1.2.6 (already installed), `imageBinarize.js` (existing utility), Web Workers (Vite ESM worker).

---

## File Map

| File | Change |
|------|--------|
| `Desktop_App/src/workers/tracerWorker.js` | Replace `esm-potrace-wasm` with `imagetracerjs` |
| `Desktop_App/src/hooks/useImageTracer.js` | Remove potrace-specific options, map to imagetracerjs |
| `Desktop_App/src/contexts/Image2GCodeContext.jsx` | Rename tab IDs, update option defaults, derive `multicolorMode` |
| `Desktop_App/src/pages/tabs/ImageToGCodeTab.jsx` | Add `mode` prop, rename controls, remove multicolor checkbox |
| `Desktop_App/src/pages/Image2GCodePage.jsx` | New 4-tab structure (outline/multicolor/drawer/gcode) |
| `Desktop_App/src/pages/Image2GCodePage.css` | Fix preview image heights, remove scrollbars |

---

### Task 1: Replace `tracerWorker.js` with `imagetracerjs`

**Files:**
- Modify: `Desktop_App/src/workers/tracerWorker.js`

> Context: The current worker uses `esm-potrace-wasm` which throws "offset is out of bounds" at runtime (a WASM memory bug, not fixable by patching). `imagetracerjs` v1.2.6 is already installed. It is synchronous and pure-JS — no `await`, no `init()`.
>
> `imagetracerjs` API: `ImageTracer.imagedataToSVG(imgd, options)` where `imgd = { width, height, data: Uint8ClampedArray }` and `options` is an object with keys like `numberofcolors`, `ltres`, `qtres`, `pathomit`, `blurradius`.

- [ ] **Step 1: Rewrite `tracerWorker.js`**

Replace the entire file with:

```js
import ImageTracer from 'imagetracerjs';

self.onmessage = function (e) {
  const { width, height, buffer, options } = e.data;
  try {
    const imageData = { width, height, data: new Uint8ClampedArray(buffer) };
    const svg = ImageTracer.imagedataToSVG(imageData, options);
    self.postMessage({ svg });
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
};
```

Note: `imagedataToSVG` is synchronous — no `async/await` needed. The worker does NOT use `type: 'module'` import syntax differently from normal; Vite handles CJS→ESM interop for `imagetracerjs` at build time.

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/workers/tracerWorker.js
git commit -m "fix(tracer): replace esm-potrace-wasm with imagetracerjs (sync, no WASM)"
```

---

### Task 2: Update `useImageTracer.js` for `imagetracerjs` options

**Files:**
- Modify: `Desktop_App/src/hooks/useImageTracer.js`

> Context: The current hook has potrace-specific option names (`turdsize`, `turnpolicy`, `alphamax`, `opticurve`, `opttolerance`, `extractcolors`, `posterizelevel`, `posterizationalgorithm`) and a `MAX_TRACE_SIDE = 1024` downscaling patch that was added trying (unsuccessfully) to fix the WASM bug. All of this must be removed.
>
> `imagetracerjs` options used in this app:
> - `numberofcolors` (2–16): color palette size — always 2 for outline (B&W), user-set for multicolor
> - `ltres` (0.1–4): line-segment error threshold  
> - `qtres` (0.1–4): quadratic-spline error threshold ("curve smoothness")
> - `pathomit` (0–64): discard paths shorter than N pixels ("noise filter")
> - `blurradius` (0–5): pre-blur before tracing
>
> `threshold` and `multicolorMode` are NOT passed to the worker — they control what pre-processing happens on the main thread before the buffer is transferred:
> - outline mode: `binarizeImageData(imageData, threshold)` → then send with `numberofcolors: 2`
> - multicolor mode: send original image data, sample `sampleCornerColor` for background detection

- [ ] **Step 1: Rewrite `useImageTracer.js`**

Replace the entire file with:

```js
import { useState, useRef, useEffect, useCallback } from 'react';
import { binarizeImageData, sampleCornerColor } from '../lib/imageBinarize';

export function useImageTracer() {
  const [result, setResult] = useState(null);
  const [backgroundColor, setBackgroundColor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const workerRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    const worker = new Worker(
      new URL('../workers/tracerWorker.js', import.meta.url),
      { type: 'module' }
    );
    worker.onmessage = (e) => {
      if (!isMounted) return;
      setLoading(false);
      if (e.data.error) {
        setError(e.data.error);
      } else {
        setResult(e.data.svg);
        setError(null);
      }
    };
    worker.onerror = (e) => {
      if (!isMounted) return;
      setLoading(false);
      setError(e.message || 'Worker error');
    };
    workerRef.current = worker;
    return () => {
      isMounted = false;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
  }, []);

  const trace = useCallback((base64DataUrl, options = {}) => {
    if (!base64DataUrl) {
      setError('No image data provided');
      return;
    }
    setLoading(true);
    setResult(null);
    setError(null);
    setBackgroundColor(null);

    const {
      multicolorMode = false,
      threshold = 128,
      numberofcolors = 4,
      ltres = 1,
      qtres = 1,
      pathomit = 8,
      blurradius = 0,
    } = options;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let pixelData;
      let traceOptions;

      if (multicolorMode) {
        setBackgroundColor(sampleCornerColor(imageData));
        pixelData = imageData;
        traceOptions = { numberofcolors, ltres, qtres, pathomit, blurradius };
      } else {
        pixelData = binarizeImageData(imageData, threshold);
        traceOptions = { numberofcolors: 2, ltres, qtres, pathomit, blurradius };
      }

      const buffer = pixelData.data.buffer.slice(0);
      workerRef.current.postMessage(
        { width: pixelData.width, height: pixelData.height, buffer, options: traceOptions },
        [buffer]
      );
    };
    img.onerror = () => {
      setLoading(false);
      setError('Failed to load image');
    };
    img.src = base64DataUrl;
  }, []);

  return { trace, result, backgroundColor, loading, error };
}
```

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/hooks/useImageTracer.js
git commit -m "refactor(tracer): update hook for imagetracerjs options, remove potrace params"
```

---

### Task 3: Update `Image2GCodeContext.jsx` — tab IDs and option defaults

**Files:**
- Modify: `Desktop_App/src/contexts/Image2GCodeContext.jsx`

> Context: Three changes are needed:
> 1. `activeTab` default: `'image'` → `'outline'` (the new default mode)
> 2. `tracerOptions` defaults: replace potrace keys with imagetracerjs keys
> 3. `multicolorMode`: remove stored state, compute it from `activeTab === 'multicolor'` — this eliminates a sync hazard where the stored state could diverge from the active tab
>
> Important: `setMulticolorMode` is currently exported but will be removed. After this task, the only way to change `multicolorMode` is to change `activeTab` to `'multicolor'`.

- [ ] **Step 1: Rewrite `Image2GCodeContext.jsx`**

Replace the entire file with:

```jsx
import React, { createContext, useContext, useState } from 'react';

const Image2GCodeContext = createContext(null);

export function useImage2GCode() {
  const ctx = useContext(Image2GCodeContext);
  if (!ctx) throw new Error('useImage2GCode must be used within Image2GCodeProvider');
  return ctx;
}

export function Image2GCodeProvider({ children }) {
  const [previewSrc, setPreviewSrc] = useState(null);
  const [tracedSVG, setTracedSVG] = useState(null);
  const [tracerOptions, setTracerOptions] = useState({
    numberofcolors: 4,
    ltres: 1,
    qtres: 1,
    pathomit: 8,
    blurradius: 0,
    threshold: 128,
  });
  const [compiledGCode, setCompiledGCode] = useState([]);
  const [activeTab, setActiveTab] = useState('outline');
  const [lineWidth, setLineWidth] = useState(1);
  const [fillWideStrokes, setFillWideStrokes] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState(null);

  // multicolorMode is always derived from activeTab — no separate state
  const multicolorMode = activeTab === 'multicolor';

  const value = {
    previewSrc, setPreviewSrc,
    tracedSVG, setTracedSVG,
    tracerOptions, setTracerOptions,
    compiledGCode, setCompiledGCode,
    activeTab, setActiveTab,
    lineWidth, setLineWidth,
    fillWideStrokes, setFillWideStrokes,
    multicolorMode,
    backgroundColor, setBackgroundColor,
  };

  return <Image2GCodeContext.Provider value={value}>{children}</Image2GCodeContext.Provider>;
}
```

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/contexts/Image2GCodeContext.jsx
git commit -m "refactor(context): rename tabs, imagetracerjs defaults, derive multicolorMode"
```

---

### Task 4: Redesign `ImageToGCodeTab.jsx` — mode prop, renamed controls

**Files:**
- Modify: `Desktop_App/src/pages/tabs/ImageToGCodeTab.jsx`

> Context: This tab now serves both `outline` and `multicolor` modes, selected by a `mode` prop from the parent. The multicolor checkbox is removed — mode switching is done via the parent's tab buttons.
>
> Control mapping:
> - `alphamax` (potrace) → `qtres` (imagetracerjs). Range: 0–4, default 1. Label: "Curve Smoothness".
> - `turdsize` (potrace) → `pathomit` (imagetracerjs). Range: 0–64, default 8. Label: "Noise Filter".
> - `threshold` stays (only shown in `outline` mode — controls binarization before tracing).
> - `numberofcolors` is new (only shown in `multicolor` mode — palette size 2–16).
> - `posterizelevel` and `opttolerance` are removed entirely.
>
> The live threshold preview useEffect watches `tracerOptions.threshold` and `mode` (not `multicolorMode`).
> Both `handleFileChange` and `handleRetrace` pass `multicolorMode: mode === 'multicolor'` to `trace()`.

- [ ] **Step 1: Rewrite `ImageToGCodeTab.jsx`**

Replace the entire file with:

```jsx
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

  // Live threshold preview: re-binarize on image/threshold change (outline mode only)
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
```

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/pages/tabs/ImageToGCodeTab.jsx
git commit -m "refactor(image-tab): mode prop, imagetracerjs controls, remove multicolor checkbox"
```

---

### Task 5: Update `Image2GCodePage.jsx` — new 4-tab structure

**Files:**
- Modify: `Desktop_App/src/pages/Image2GCodePage.jsx`

> Context: Tab IDs must be updated throughout:
> - Old `'image'` → New `'outline'` (first tab, Outline mode)
> - OLD `'outline'` (G-Code Preview) → New `'gcode'` (renamed to avoid collision)
> - Old `'drawer'` → `'drawer'` (unchanged)  
> - New `'multicolor'` tab (was a checkbox inside ImageToGCodeTab)
>
> The `ImageToGCodeTab` now receives a `mode` prop. Both `outline` and `multicolor` tabs render the SAME `ImageToGCodeTab` component instance (with `mode` prop changing), which preserves `previewSrc` and `tracedSVG` when the user switches between them.
>
> `handleCompile` logic: for `'drawer'` tab, get SVG from `editorRef`; for all other tabs, use `tracedSVG`. This is unchanged from current behavior — just replace `activeTab === 'drawer'` check (already correct).
>
> `canCompile` still: `activeTab === 'drawer' || !!tracedSVG` — outline/multicolor set `tracedSVG`.

- [ ] **Step 1: Update `Image2GCodePage.jsx`**

In the JSX, replace ONLY the tab bar and tab body sections. The page header, drill-mode check, bottom bar, and Dialog remain unchanged.

Find and replace this block (the tab bar buttons):
```jsx
        <div className="i2g-tabs">
          <button
            className={`i2g-tab${activeTab === 'image' ? ' active' : ''}`}
            onClick={() => setActiveTab('image')}
          >
            Import &amp; Trace
          </button>
          <button
            className={`i2g-tab${activeTab === 'drawer' ? ' active' : ''}`}
            onClick={() => setActiveTab('drawer')}
          >
            Draw &amp; Finalize
          </button>
          <button
            className={`i2g-tab${activeTab === 'outline' ? ' active' : ''}`}
            onClick={() => setActiveTab('outline')}
          >
            G-Code Outline
          </button>
        </div>
```

With:
```jsx
        <div className="i2g-tabs">
          <button
            className={`i2g-tab${activeTab === 'outline' ? ' active' : ''}`}
            onClick={() => setActiveTab('outline')}
          >
            Outline
          </button>
          <button
            className={`i2g-tab${activeTab === 'multicolor' ? ' active' : ''}`}
            onClick={() => setActiveTab('multicolor')}
          >
            Multicolor
          </button>
          <button
            className={`i2g-tab${activeTab === 'drawer' ? ' active' : ''}`}
            onClick={() => setActiveTab('drawer')}
          >
            Drawing
          </button>
          <button
            className={`i2g-tab${activeTab === 'gcode' ? ' active' : ''}`}
            onClick={() => setActiveTab('gcode')}
          >
            G-Code Preview
          </button>
        </div>
```

Find and replace this block (the tab body):
```jsx
        <div className="i2g-tab-body">
          <div style={{ display: activeTab === 'image' ? 'flex' : 'none', height: '100%' }}>
            <ImageToGCodeTab onSendToDrawer={handleSendToDrawer} />
          </div>
          <div style={{ display: activeTab === 'drawer' ? 'flex' : 'none', height: '100%' }}>
            <VectorDrawerTab
              editorRef={editorRef}
              bedW={bedW}
              bedH={bedH}
              lineWidth={lineWidth}
              injectedSVG={injectedSVG}
              backgroundColor={multicolorMode ? backgroundColor : null}
              softLimitMargin={settings?.softLimitMargin ?? 10}
              homed={homed}
              homeFloor={homed ? homeFloor : null}
            />
          </div>
          <div style={{ display: activeTab === 'outline' ? 'flex' : 'none', height: '100%' }}>
            <div className="tab-content outline-tab">
              <div className="outline-tab-info">
                <span className="gcode-line-count">
                  {compiledGCode.length > 0 ? `${compiledGCode.length} lines` : 'No G-Code — compile a job to see its outline'}
                </span>
                {compileWarning && (
                  <span style={{ color: 'rgba(255, 200, 0, 0.9)', fontSize: '12px' }}>
                    ⚠ {compileWarning} line{compileWarning !== 1 ? 's' : ''} outside safe margin
                  </span>
                )}
              </div>
              <div className="outline-tab-preview">
                <GCodePreview lines={compiledGCode} bedW={bedW} bedH={bedH} softLimitMargin={settings.softLimitMargin ?? 10} homeFloor={homed ? homeFloor : null} />
              </div>
            </div>
          </div>
        </div>
```

With:
```jsx
        <div className="i2g-tab-body">
          <div style={{ display: (activeTab === 'outline' || activeTab === 'multicolor') ? 'flex' : 'none', height: '100%' }}>
            <ImageToGCodeTab
              onSendToDrawer={handleSendToDrawer}
              mode={activeTab === 'multicolor' ? 'multicolor' : 'outline'}
            />
          </div>
          <div style={{ display: activeTab === 'drawer' ? 'flex' : 'none', height: '100%' }}>
            <VectorDrawerTab
              editorRef={editorRef}
              bedW={bedW}
              bedH={bedH}
              lineWidth={lineWidth}
              injectedSVG={injectedSVG}
              backgroundColor={multicolorMode ? backgroundColor : null}
              softLimitMargin={settings?.softLimitMargin ?? 10}
              homed={homed}
              homeFloor={homed ? homeFloor : null}
            />
          </div>
          <div style={{ display: activeTab === 'gcode' ? 'flex' : 'none', height: '100%' }}>
            <div className="tab-content gcode-preview-tab">
              <div className="outline-tab-info">
                <span className="gcode-line-count">
                  {compiledGCode.length > 0 ? `${compiledGCode.length} lines` : 'No G-Code — compile a job first'}
                </span>
                {compileWarning && (
                  <span style={{ color: 'rgba(255, 200, 0, 0.9)', fontSize: '12px' }}>
                    ⚠ {compileWarning} line{compileWarning !== 1 ? 's' : ''} outside safe margin
                  </span>
                )}
              </div>
              <div className="outline-tab-preview">
                <GCodePreview lines={compiledGCode} bedW={bedW} bedH={bedH} softLimitMargin={settings.softLimitMargin ?? 10} homeFloor={homed ? homeFloor : null} />
              </div>
            </div>
          </div>
        </div>
```

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/pages/Image2GCodePage.jsx
git commit -m "feat(image2gcode): add Outline/Multicolor/Drawing/G-Code tabs, remove old Import&Trace"
```

---

### Task 6: Fix `Image2GCodePage.css` — fill layout, no scrollbars on previews

**Files:**
- Modify: `Desktop_App/src/pages/Image2GCodePage.css`

> Context: The current CSS has two bugs causing the "doesn't fill page / scrollbars" symptoms:
> 1. `.preview-img { max-height: 200px }` — forces images to 200px regardless of available space; the `.preview-box` is taller so there's wasted space and layout inconsistency
> 2. `.preview-box { overflow: auto }` — triggers scrollbars when image width exceeds box width
> 3. `.svg-preview svg { max-height: 250px }` — same fixed-height problem for traced SVG
>
> Fix: images fill their flex parent using `max-height: 100%; height: 100%; object-fit: contain`. The preview-box gets `overflow: hidden` (clipping rather than scrolling) and `min-height: 0` (critical for flex children to actually shrink).
>
> Also add `.gcode-preview-tab` as an alias for `.outline-tab` (same styles) since we renamed the CSS class in Task 5.

- [ ] **Step 1: Apply targeted CSS fixes**

In `Desktop_App/src/pages/Image2GCodePage.css`, make these precise replacements:

**Fix 1** — preview-box: change `overflow: auto` to `overflow: hidden`, add `min-height: 0`:

Old:
```css
.preview-box {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  overflow: auto;
  min-height: 100px;
  padding: 0.5rem;
}
```

New:
```css
.preview-box {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  overflow: hidden;
  padding: 0.5rem;
}
```

**Fix 2** — preview-img: remove `max-height: 200px`, let it fill the box:

Old:
```css
.preview-img {
  max-width: 100%;
  max-height: 200px;
  object-fit: contain;
}
```

New:
```css
.preview-img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: 100%;
  object-fit: contain;
  display: block;
}
```

**Fix 3** — preview-canvas: same treatment:

Old:
```css
.preview-canvas {
  max-width: 100%;
  max-height: 200px;
  image-rendering: pixelated;
}
```

New:
```css
.preview-canvas {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: 100%;
  image-rendering: pixelated;
  display: block;
}
```

**Fix 4** — svg-preview svg: remove fixed height:

Old:
```css
.svg-preview svg {
  max-width: 100%;
  max-height: 250px;
  display: block;
}
```

New:
```css
.svg-preview svg {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: 100%;
  display: block;
}
```

**Fix 5** — svg-preview container: needs height to pass down:

Old:
```css
.svg-preview {
  max-width: 100%;
  max-height: 100%;
}
```

New:
```css
.svg-preview {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**Fix 6** — image-tab-preview: add min-height: 0 for flex shrinking:

Old:
```css
.image-tab-preview {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

New:
```css
.image-tab-preview {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  gap: 0.25rem;
}
```

**Fix 7** — add `.gcode-preview-tab` alias at the end of the file (after the existing `.outline-tab` block):

```css
/* Alias for renamed G-Code Preview tab (was .outline-tab) */
.gcode-preview-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.5rem;
  gap: 1rem;
  box-sizing: border-box;
}
```

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/pages/Image2GCodePage.css
git commit -m "fix(layout): preview images fill container, remove fixed 200px heights, no scrollbars"
```

---

### Task 7: Manual verification

> No automated tests exist for this UI flow — testing is visual. Run the app and verify each mode works end-to-end.

- [ ] **Step 1: Start the app**

```bash
cd Desktop_App
npm run electron:dev
```

- [ ] **Step 2: Verify Outline mode (the critical fix)**

1. Navigate to Image to G-Code page
2. Confirm default tab is "Outline" (not "Import & Trace")
3. Click "Choose File" → load any image (PNG/JPG)
4. Confirm:
   - Original image appears in preview (fills its box, no scrollbar)
   - Threshold Preview canvas appears and updates as you drag the slider
   - Traced Vector preview shows placeholder "Result will appear here…"
5. Click "Trace"
6. Confirm traced SVG appears in the Traced Vector box — NO "offset is out of bounds" error
7. Adjust Curve Smoothness and Noise Filter sliders, click "Re-trace", confirm result changes

- [ ] **Step 3: Verify Multicolor mode**

1. Click "Multicolor" tab
2. Load the same image (or a new one)
3. Confirm: no Threshold slider, no Threshold Preview box; Color Levels slider is visible
4. Click "Trace"
5. Confirm: traced SVG appears with multiple colors (no error)

- [ ] **Step 4: Verify Drawing mode**

1. Click "Drawing" tab
2. Confirm: VectorEditor canvas fills the area (unchanged behavior)

- [ ] **Step 5: Verify G-Code Preview tab**

1. In any mode, load an image, trace it, click "Compile Job"
2. Click "G-Code Preview" tab
3. Confirm: GCodePreview canvas shows the toolpath (unchanged behavior)

- [ ] **Step 6: Verify layout fills the page**

1. The preview panel on the right should fill the full available height
2. No scrollbars should appear on the right preview panel
3. Each preview box (Original / Threshold / Traced) should occupy ~1/3 of the panel height

- [ ] **Step 7: Final commit if any manual fixes were applied**

```bash
git add -A
git commit -m "fix(image2gcode): manual fixes from visual verification"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Fix "offset is out of bounds" tracer error | Task 1 (replace library) |
| Default mode = Outline | Task 3 (`activeTab` default `'outline'`) |
| 3 modes: Drawing / Outline / Multicolor | Tasks 4+5 |
| Images fill container without scrollbar | Task 6 |
| Threshold controls only in Outline mode | Task 4 |
| Color level controls only in Multicolor mode | Task 4 |
| Live threshold preview in Outline mode | Task 4 |
| Multicolor mode samples background color for compiler | Task 2+4 |

### Placeholder Scan

No TBDs, TODOs, or missing code blocks found.

### Type Consistency

- `tracerOptions` keys: `numberofcolors`, `ltres`, `qtres`, `pathomit`, `blurradius`, `threshold` — used consistently in Task 2 (hook), Task 3 (context defaults), Task 4 (tab controls).
- `activeTab` values: `'outline'`, `'multicolor'`, `'drawer'`, `'gcode'` — used consistently in Tasks 3, 5.
- `mode` prop to `ImageToGCodeTab`: `'outline'` | `'multicolor'` — set in Task 5, consumed in Task 4.
- `multicolorMode` computed in context (Task 3) as `activeTab === 'multicolor'` — consumed unchanged by `Image2GCodePage.jsx` `handleCompile` and `VectorDrawerTab` props.
