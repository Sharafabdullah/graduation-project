# Potrace Tracing Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Image→G-code outline tracing accurate by switching the default tracing engine to Potrace (`esm-potrace-wasm`, already installed), while keeping imagetracerjs as a visible, user-selectable fallback.

**Architecture:** A pure `buildPotraceOptions()` function maps the existing UI sliders onto Potrace's parameters (the unit-tested seam). `useImageTracer` gains a Potrace path that runs on the main thread (lazy WASM `init()`, accepts `ImageData` directly); the existing Web Worker keeps serving the imagetracerjs fallback. A new `tracerEngine` context field + a dropdown in `ImageToGCodeTab` lets the user pick the engine. `gcodeCompiler.js` is unchanged — it already handles Potrace's Bézier output.

**Tech Stack:** React 18, Vite 6, Electron 28, `esm-potrace-wasm` (WASM Potrace), `imagetracerjs` (fallback), Node built-in test runner (`node --test`).

Spec: `docs/superpowers/specs/2026-06-11-potrace-tracing-engine-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `Desktop_App/src/lib/potraceOptions.js` | Pure mapping: UI slider values → Potrace options object. No browser deps (node-testable). | Create |
| `Desktop_App/src/lib/potraceOptions.test.mjs` | `node --test` unit tests for the mapping. | Create |
| `Desktop_App/src/contexts/Image2GCodeContext.jsx` | Add `tracerEngine` state (default `'potrace'`). | Modify |
| `Desktop_App/src/hooks/useImageTracer.js` | Add Potrace main-thread path (lazy init); branch on `engine`; keep worker path for imagetracerjs. | Modify |
| `Desktop_App/src/pages/tabs/ImageToGCodeTab.jsx` | Engine dropdown; pass `engine` + `mode` into `trace()`. | Modify |

No changes to `gcodeCompiler.js`, `tracerWorker.js`, `colorMatch.js`, or `imageBinarize.js`.

---

## Parameter mapping reference (implemented in Task 1)

UI slider ranges come from `ImageToGCodeTab.jsx`:

| UI control | Range | Potrace option | Mapping |
|------------|-------|----------------|---------|
| Curve Smoothness (`qtres`) | 0.1–4 | `alphamax` (0–1.34) | `clamp((qtres-0.1)/(4-0.1)*1.34, 0, 1.34)` |
| Line Precision (`ltres`) | 0.1–4 | `opttolerance` | `clamp(ltres*0.25, 0.05, 1)` |
| Noise Filter (`pathomit`) | 0–64 | `turdsize` | `max(0, round(pathomit))` |
| Color Levels (`numberofcolors`) | 2–16 | `posterizelevel` | `clamp(round(numberofcolors), 1, 255)` |
| Ink Threshold (`threshold`) | 0–255 | (binarize before trace) | handled in the hook, not in options |
| Pre-blur (`blurradius`) | 0–5 | (canvas blur before trace) | handled in the hook, not in options |

Constant options: `turnpolicy: 4`, `opticurve: 1`, `pathonly: false` (always — `true` would
return bare path strings without an `<svg>` wrapper and break the downstream pipeline). Outline
mode adds `extractcolors: false`; multicolor mode adds `extractcolors: true`,
`posterizationalgorithm: 0`, and `posterizelevel`.

---

## Task 1: Pure option-mapping function

**Files:**
- Create: `Desktop_App/src/lib/potraceOptions.js`
- Test: `Desktop_App/src/lib/potraceOptions.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `Desktop_App/src/lib/potraceOptions.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPotraceOptions, clamp } from './potraceOptions.js';

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('clamp bounds a value', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});

test('outline mode: constant options and disabled color extraction', () => {
  const o = buildPotraceOptions({ qtres: 1, ltres: 1, pathomit: 8 }, 'outline');
  assert.equal(o.turnpolicy, 4);
  assert.equal(o.opticurve, 1);
  assert.equal(o.pathonly, false);
  assert.equal(o.extractcolors, false);
  assert.equal(o.turdsize, 8);
});

test('outline mode: slider→param mappings', () => {
  const o = buildPotraceOptions({ qtres: 1, ltres: 1, pathomit: 8 }, 'outline');
  approx(o.alphamax, (1 - 0.1) / (4 - 0.1) * 1.34);
  approx(o.opttolerance, 0.25);
});

test('outline mode: edge values clamp correctly', () => {
  const lo = buildPotraceOptions({ qtres: 0.1, ltres: 0.1, pathomit: 0 }, 'outline');
  approx(lo.alphamax, 0);
  approx(lo.opttolerance, 0.05); // 0.1*0.25=0.025 clamped up to 0.05
  assert.equal(lo.turdsize, 0);

  const hi = buildPotraceOptions({ qtres: 4, ltres: 4, pathomit: 64 }, 'outline');
  approx(hi.alphamax, 1.34);
  approx(hi.opttolerance, 1); // 4*0.25=1.0
  assert.equal(hi.turdsize, 64);
});

test('multicolor mode: enables color extraction with posterize level', () => {
  const o = buildPotraceOptions({ qtres: 1, ltres: 1, pathomit: 8, numberofcolors: 6 }, 'multicolor');
  assert.equal(o.extractcolors, true);
  assert.equal(o.posterizationalgorithm, 0);
  assert.equal(o.posterizelevel, 6);
  assert.equal(o.pathonly, false);
});

test('multicolor mode: posterizelevel clamps to [1,255]', () => {
  assert.equal(buildPotraceOptions({ numberofcolors: 1000 }, 'multicolor').posterizelevel, 255);
  assert.equal(buildPotraceOptions({ numberofcolors: 0 }, 'multicolor').posterizelevel, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Desktop_App && node --test src/lib/potraceOptions.test.mjs`
Expected: FAIL — `Cannot find module './potraceOptions.js'` / `buildPotraceOptions is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `Desktop_App/src/lib/potraceOptions.js`:

```js
// Pure mapping from the Image→G-code UI sliders onto esm-potrace-wasm options.
// No browser/DOM dependencies so it is unit-testable under `node --test`.
//
// NOTE: esm-potrace-wasm is GPL-2.0 (inherited from Potrace). Acceptable for a
// university capstone; recorded here and in the design spec for awareness.

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// uiOptions: { qtres, ltres, pathomit, numberofcolors } (subset OK; defaults applied).
// mode: 'outline' | 'multicolor'
export function buildPotraceOptions(uiOptions = {}, mode = 'outline') {
  const {
    qtres = 1,
    ltres = 1,
    pathomit = 8,
    numberofcolors = 4,
  } = uiOptions;

  const alphamax = clamp((qtres - 0.1) / (4 - 0.1) * 1.34, 0, 1.34);
  const opttolerance = clamp(ltres * 0.25, 0.05, 1);
  const turdsize = Math.max(0, Math.round(pathomit));

  const base = {
    turdsize,
    turnpolicy: 4,
    alphamax,
    opticurve: 1,
    opttolerance,
    pathonly: false, // always full <svg>; `true` returns bare path strings
  };

  if (mode === 'multicolor') {
    return {
      ...base,
      extractcolors: true,
      posterizelevel: clamp(Math.round(numberofcolors), 1, 255),
      posterizationalgorithm: 0,
    };
  }
  return { ...base, extractcolors: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Desktop_App && node --test src/lib/potraceOptions.test.mjs`
Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add Desktop_App/src/lib/potraceOptions.js Desktop_App/src/lib/potraceOptions.test.mjs
git commit -m "feat(image2gcode): add pure Potrace option-mapping (slider→param)"
```

---

## Task 2: Add `tracerEngine` to Image2GCodeContext

**Files:**
- Modify: `Desktop_App/src/contexts/Image2GCodeContext.jsx`

This task has no automated test (it's React context plumbing); it's verified when the UI consumes
it in Task 4. Keep the change minimal.

- [ ] **Step 1: Add the state field**

In `Image2GCodeContext.jsx`, after the `tracerMode` state declaration (line ~27), add:

```jsx
  const [tracerEngine, setTracerEngine] = useState('potrace'); // 'potrace' | 'imagetracer'
```

- [ ] **Step 2: Expose it in the context value**

In the `value` object, add `tracerEngine, setTracerEngine` next to `tracerMode, setTracerMode`:

```jsx
    tracerMode, setTracerMode,
    tracerEngine, setTracerEngine,
```

- [ ] **Step 3: Verify it builds**

Run: `cd Desktop_App && npm run build`
Expected: Build succeeds with no errors referencing `Image2GCodeContext`.

- [ ] **Step 4: Commit**

```bash
git add Desktop_App/src/contexts/Image2GCodeContext.jsx
git commit -m "feat(image2gcode): add tracerEngine state (default potrace)"
```

---

## Task 3: Wire Potrace into useImageTracer

**Files:**
- Modify: `Desktop_App/src/hooks/useImageTracer.js`

The Potrace path runs on the main thread (WASM, async, accepts `ImageData`). The existing worker
path is preserved for the imagetracerjs fallback. WASM `init()` is lazily run once via a
module-level promise.

This task is verified by build + the manual run in Task 5 (the WASM/DOM trace cannot run under
`node --test`).

- [ ] **Step 1: Replace the hook with the engine-branching version**

Replace the entire contents of `Desktop_App/src/hooks/useImageTracer.js` with:

```js
import { useState, useRef, useEffect, useCallback } from 'react';
import { potrace, init as initPotrace } from 'esm-potrace-wasm';
import { binarizeImageData, sampleCornerColor } from '../lib/imageBinarize';
import { buildPotraceOptions } from '../lib/potraceOptions';

// Lazily initialise the Potrace WASM module exactly once; concurrent callers
// share the same promise.
let potraceInitPromise = null;
function ensurePotrace() {
  if (!potraceInitPromise) potraceInitPromise = initPotrace();
  return potraceInitPromise;
}

export function useImageTracer() {
  const [result, setResult] = useState(null);
  const [backgroundColor, setBackgroundColor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const workerRef = useRef(null);

  // Worker is only used for the imagetracerjs fallback engine.
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
      engine = 'potrace',
      mode = 'outline',
      threshold = 128,
      numberofcolors = 4,
      ltres = 1,
      qtres = 1,
      pathomit = 8,
      blurradius = 0,
    } = options;
    const multicolor = mode === 'multicolor';

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');

      if (engine === 'potrace') {
        // Pre-blur is applied as a canvas filter for the Potrace path
        // (imagetracerjs applies blur itself, below).
        if (blurradius > 0) ctx.filter = `blur(${blurradius}px)`;
        ctx.drawImage(img, 0, 0);
        ctx.filter = 'none';
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        (async () => {
          try {
            await ensurePotrace();
            let source = imageData;
            if (multicolor) {
              setBackgroundColor(sampleCornerColor(imageData));
            } else {
              const bin = binarizeImageData(imageData, threshold);
              source = new ImageData(bin.data, bin.width, bin.height);
            }
            const opts = buildPotraceOptions(
              { qtres, ltres, pathomit, numberofcolors },
              multicolor ? 'multicolor' : 'outline'
            );
            const svg = await potrace(source, opts);
            if (!svg || !/<path/i.test(svg)) {
              setError('No shapes found — adjust the threshold and re-trace.');
            } else {
              setResult(svg);
              setError(null);
            }
          } catch (err) {
            setError(err?.message || 'Tracing engine failed to load');
          } finally {
            setLoading(false);
          }
        })();
        return;
      }

      // ── imagetracerjs fallback (runs in the worker) ──────────────────────
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let pixelData;
      let traceOptions;
      if (multicolor) {
        setBackgroundColor(sampleCornerColor(imageData));
        pixelData = imageData;
        traceOptions = { numberofcolors, ltres, qtres, pathomit, blurradius, viewbox: true };
      } else {
        pixelData = binarizeImageData(imageData, threshold);
        traceOptions = { numberofcolors: 2, ltres, qtres, pathomit, blurradius, viewbox: true };
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

- [ ] **Step 2: Verify it builds**

Run: `cd Desktop_App && npm run build`
Expected: Build succeeds. If Vite reports it cannot resolve the Potrace WASM asset, add
`optimizeDeps: { exclude: ['esm-potrace-wasm'] }` to `Desktop_App/vite.config.*` and rebuild
(the library fetches its `.wasm` at runtime and should not be pre-bundled). Re-run the build until
it succeeds.

- [ ] **Step 3: Commit**

```bash
git add Desktop_App/src/hooks/useImageTracer.js
git commit -m "feat(image2gcode): trace with Potrace by default; imagetracerjs fallback"
```

---

## Task 4: Engine dropdown in ImageToGCodeTab

**Files:**
- Modify: `Desktop_App/src/pages/tabs/ImageToGCodeTab.jsx`

- [ ] **Step 1: Consume the new context field**

In the `useImage2GCode()` destructure block (lines ~9-17), add `tracerEngine, setTracerEngine`:

```jsx
    tracerMode, setTracerMode,
    tracerEngine, setTracerEngine,
    lineWidth, setLineWidth,
    fillWideStrokes, setFillWideStrokes,
```

- [ ] **Step 2: Pass engine + mode into both trace calls**

In `handleFileChange`, replace the `trace(...)` call:

```jsx
    trace(ev.target.result, { ...tracerOptions, engine: tracerEngine, mode: tracerMode });
```

In `handleRetrace`, replace the `trace(...)` call:

```jsx
    if (previewSrc) trace(previewSrc, { ...tracerOptions, engine: tracerEngine, mode: tracerMode });
```

(These replace the previous `multicolorMode: tracerMode === 'multicolor'` argument; the hook now
derives multicolor from `mode`.)

- [ ] **Step 3: Add the engine dropdown to the controls panel**

Immediately after the mode toggle block (the `</div>` closing `.tracer-mode-toggle`, line ~172),
insert:

```jsx
        <div className="form-group">
          <label>Tracing Engine</label>
          <select
            className="input"
            value={tracerEngine}
            onChange={(e) => setTracerEngine(e.target.value)}
            disabled={loading}
          >
            <option value="potrace">Potrace (accurate)</option>
            <option value="imagetracer">ImageTracer (legacy)</option>
          </select>
          <p className="hint-text">Potrace gives smoother, more accurate outlines. ImageTracer is the legacy fallback.</p>
        </div>
```

- [ ] **Step 4: Verify it builds**

Run: `cd Desktop_App && npm run build`
Expected: Build succeeds with no errors referencing `ImageToGCodeTab`.

- [ ] **Step 5: Commit**

```bash
git add Desktop_App/src/pages/tabs/ImageToGCodeTab.jsx
git commit -m "feat(image2gcode): add visible tracing-engine selector (Potrace/ImageTracer)"
```

---

## Task 5: Manual verification in the running app

**Files:** none (verification only).

No automated test can exercise the WASM/DOM trace. Verify behavior in the real Electron app.

- [ ] **Step 1: Launch the app**

Run: `cd Desktop_App && npm run electron:dev`
Expected: App window opens; navigate to the Image→G-code page.

- [ ] **Step 2: Outline accuracy (primary goal)**

With **Tracing Engine = Potrace** and **Outline** mode, load a line-art/logo image from
`Input Files/`. Click Trace.
Expected: Traced Vector preview shows smooth, accurate outlines that follow the source closely.
Adjust Ink Threshold and confirm the threshold preview + retrace track it.

- [ ] **Step 3: Compare against the fallback**

Switch Tracing Engine to **ImageTracer (legacy)** and re-trace the same image.
Expected: Visibly blockier/less accurate than Potrace — confirms the toggle works and Potrace is
the better default.

- [ ] **Step 4: Edge case — empty result**

Set Ink Threshold to 0 (or 255) so binarization yields a single solid color, then re-trace with
Potrace.
Expected: Friendly error "No shapes found — adjust the threshold and re-trace." (no crash).

- [ ] **Step 5: Multicolor + background removal**

Switch to **Multicolor** mode, load a simple multi-color image with a plain background, set Color
Levels (e.g. 4), and trace with Potrace. Click "Add to Canvas", then Compile.
Expected: Traced colors appear; the background is not drawn; the G-code preview looks correct and
within bounds.

- [ ] **Step 6: Full pipeline sanity**

Back in Outline mode with Potrace, trace → Add to Canvas → Compile → check the G-code preview
renders a sensible toolpath.
Expected: Toolpath matches the traced shapes; no out-of-bounds banner for a normally-sized image.

- [ ] **Step 7: Record verification**

If all steps pass, note completion. No commit needed (no file changes). If any step fails, stop
and debug before considering the feature complete.

---

## Self-Review notes

- **Spec coverage:** engine selection (Tasks 2, 4), Potrace main-thread path + lazy init (Task 3),
  outline binarize + slider remap (Tasks 1, 3), multicolor via `extractcolors`/`posterizelevel`
  (Tasks 1, 3), background filtering reuse (Task 3 sets `backgroundColor`; compiler unchanged),
  fallback preserved (Task 3), unit-tested mapping (Task 1), GPL note (Task 1 header comment +
  spec). All spec sections covered.
- **Correction vs spec:** spec listed `pathonly: true` for outline; implementation uses
  `pathonly: false` in both modes (a `true` value returns bare path strings without `<svg>` and
  breaks the pipeline). Outline vs multicolor is distinguished by `extractcolors` + binarize-first.
- **Type/name consistency:** `buildPotraceOptions(uiOptions, mode)`, `clamp`, `ensurePotrace`,
  `tracerEngine`/`setTracerEngine`, and option keys (`turdsize`, `alphamax`, `opttolerance`,
  `posterizelevel`, `extractcolors`, `pathonly`) are used identically across all tasks.
```
