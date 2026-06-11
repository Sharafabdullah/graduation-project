# Potrace Tracing Engine — Design Spec

**Date:** 2026-06-11
**Topic:** Replace the default raster→SVG tracing engine with Potrace for accurate outlines; keep imagetracerjs as a selectable fallback.
**Status:** Approved (design), pending implementation plan.

## Problem

The Image→G-code tracing produces inaccurate, blocky outlines. The current engine
(`imagetracerjs`) is a grid-sampling tracer: it quantizes the image onto a color grid and
walks cell boundaries, so it cannot follow contours smoothly. It is also the root cause of the
documented background-color bug (it emits grid-sampled near-white fills like `rgb(210,210,210)`
that the compiler's white test misses).

`esm-potrace-wasm` (a WASM build of **Potrace** — the same engine Inkscape's "Trace Bitmap"
uses) and `simplify-js` are **already in `package.json`** but were never wired into the tracing
path (a prior migration appears to have been reverted). Potrace produces true smooth Bézier
outlines and is the industry standard for bitmap tracing.

## Goals

- Make outline (single-color) tracing accurate — this is the primary success criterion.
- Use Potrace as the default engine; no new dependency (already installed).
- Keep `imagetracerjs` available as a **user-selectable fallback** via a visible UI control.
- Route multicolor mode through Potrace too (secondary), retiring the buggy grid-sampled
  background path.
- Preserve the existing friendly slider UX (Threshold, Curve Smoothness, Line Precision,
  Noise Filter, Pre-blur, Color Levels) by re-mapping the sliders onto Potrace parameters.

## Non-Goals

- No changes to `gcodeCompiler.js`. It already handles cubic/quadratic Béziers via arc-fitting
  + tessellation, so Potrace's curve output is already supported.
- No third tracing engine (e.g. VTracer). Outline is the priority and Potrace covers it.
- No hole-aware fill changes. `fillWideStrokes` behavior is unchanged.

## Approach

**A. Potrace as default engine, imagetracerjs as selectable fallback.** (Chosen.)

Considered and rejected:
- **B. Keep imagetracerjs, tune defaults harder** — it's a grid-sampler; tuning can't reach
  Potrace's outline accuracy.
- **C. Add VTracer/another engine** — heavier, new dependency, GPL/Rust-WASM build complexity;
  unnecessary since Potrace is installed and outline is the priority.

## Architecture

### Engine selection

- Add `tracerEngine: 'potrace' | 'imagetracer'` to `Image2GCodeContext` (default `'potrace'`).
- Expose it in `ImageToGCodeTab` controls panel as a small dropdown/segmented control
  ("Tracing Engine: Potrace (accurate) / ImageTracer (legacy)").
- Persisted in context like the other tracer options, so it survives tab navigation.

### Where Potrace runs

- Potrace runs **on the main thread** inside `useImageTracer`. `esm-potrace-wasm` is async
  (WASM) and accepts `ImageData` directly; a typical trace is sub-second. The existing
  `tracerWorker.js` (imagetracerjs) is left intact for the fallback path.
- `init()` from `esm-potrace-wasm` is called **lazily once** on first Potrace use (guarded by a
  module-level promise so concurrent calls share one init).
- The existing main-thread image-decode step (Image → canvas → `getImageData`) is reused; the
  resulting `ImageData` is fed to either Potrace (main thread) or the worker (imagetracerjs).

### Option mapping (the testable core)

A **pure** function `buildPotraceOptions(uiOptions, mode)` maps the UI slider values onto Potrace
options. This is the unit-tested seam.

Outline mode (`mode === 'outline'`):
- Image is **binarized** at the **Ink Threshold** slider first (reuse `binarizeImageData`).
- Potrace options:
  - `pathonly: true`
  - `extractcolors: false`
  - `turdsize` ← **Noise Filter** (`pathomit`)
  - `alphamax` ← **Curve Smoothness** (`qtres`), mapped into Potrace's `[0, 1.34]` range
  - `opttolerance` ← **Line Precision** (`ltres`)
  - `opticurve: 1`
- **Pre-blur** (`blurradius`) is applied as a canvas blur pass before binarization (existing
  blur behavior preserved).

Multicolor mode (`mode === 'multicolor'`):
- Potrace options:
  - `extractcolors: true`
  - `posterizelevel` ← **Color Levels** (`numberofcolors`)
  - `turdsize`, `alphamax`, `opttolerance` mapped as above
- `sampleCornerColor` is still computed and stored as `backgroundColor`; the compiler's
  existing `isBackgroundColor` filtering removes the background group. No new background code.

The exact numeric mappings (slider ranges → Potrace ranges) are defined in
`buildPotraceOptions` and pinned by unit tests, so they're explicit and adjustable.

### Output contract

- Potrace returns a complete `<svg>` string with width/height (and viewBox). This flows into the
  existing pipeline unchanged: preview render, `svgToPaths`/`fitPathsToBed`, and
  `compileSVGToGCode`. Outline paths are emitted as `fill`-colored paths; the compiler's
  white/background filter handles them.
- If Potrace returns no paths (e.g. threshold leaves an all-white image), the hook surfaces a
  friendly "No shapes found — adjust threshold" error, same channel as today's `error` state.

## Data Flow

```
[Image file]
   ↓ FileReader → dataURL
useImageTracer.trace(dataURL, { ...tracerOptions, engine, mode })
   ↓ main thread: Image → canvas → (pre-blur) → getImageData
   ├─ engine = 'potrace':
   │     outline:    binarize(threshold) → potrace(imageData, buildPotraceOptions(opts,'outline'))
   │     multicolor: potrace(imageData, buildPotraceOptions(opts,'multicolor'))
   │     → SVG string (main thread)
   └─ engine = 'imagetracer':
         postMessage(buffer) → tracerWorker.js → ImageTracer.imagedataToSVG → SVG string
   ↓
[SVG string] → preview + compileSVGToGCode (unchanged)
```

## Components Touched

| File | Change |
|------|--------|
| `src/hooks/useImageTracer.js` | Add Potrace path (lazy `init`, main-thread trace), keep worker path for fallback; branch on `engine`. |
| `src/lib/potraceOptions.js` (new) | Pure `buildPotraceOptions(uiOptions, mode)` mapping + range helpers. |
| `src/contexts/Image2GCodeContext.jsx` | Add `tracerEngine` state (default `'potrace'`). |
| `src/pages/tabs/ImageToGCodeTab.jsx` | Add engine dropdown; pass `engine` + `mode` into `trace()`. |
| `src/lib/potraceOptions.test.mjs` (new) | `node --test` unit tests for the mapping. |
| `package.json` (note) | Already lists `esm-potrace-wasm`; no add needed. Record GPL-2.0 note. |

No change to `gcodeCompiler.js`, `colorMatch.js`, `softLimits.js`, or the streaming path.

## Error Handling

- Lazy `init()` failure → `error` state with "Tracing engine failed to load".
- Empty/all-white result → "No shapes found — adjust threshold".
- imagetracerjs fallback path keeps its current error handling.

## Testing

- **Unit (automated, `node --test`):** `buildPotraceOptions` — slider values map to the expected
  Potrace option object for both outline and multicolor modes, including range clamping/edge
  values (min/max sliders).
- **Manual (in-app):** Trace a line-art image, a logo, and a photo in outline mode with Potrace;
  compare smoothness/accuracy against imagetracerjs via the engine toggle. Verify multicolor mode
  with background removal. Verify compiled G-code preview looks correct and stays within bounds.

## Risks / Notes

- **License:** `esm-potrace-wasm` is **GPL-2.0** (inherited from Potrace), while `package.json`
  declares MIT. Acceptable for a university capstone (no commercial distribution), but recorded
  here for awareness.
- **WASM loading under Vite/Electron:** `init()` must locate the `.wasm` asset. Running Potrace
  on the main thread (not the worker) avoids worker-WASM-URL fragility under Vite. Verify the
  asset resolves in both `electron:dev` and the production `vite build`.
- Main-thread tracing briefly occupies the UI thread; acceptable for typical image sizes and
  matches how the reference app (SVGcode) uses this library. Revisit a worker port only if large
  images cause noticeable jank.
