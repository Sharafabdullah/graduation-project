# Image-to-GCode Redesign — Design Spec
**Date:** 2026-06-06  
**Author:** Claude (senior architect)

---

## Overview

Replace the current `Image2GCodePage.jsx` (pixel-threshold + contour tracer) with a two-tab workspace:

1. **Image to G-Code tab** — import raster image → trace to vector → preview toolpaths → compile G-code
2. **Vector Drawer tab** — interactive Fabric.js canvas for creating/editing vector art → compile G-code

Both tabs share a compiled G-code state and feed into the same machine execution pipeline (`SerialContext.startStreaming`).

---

## Architecture

```
Image2GCodePage (parent — owns compiledGCode state)
├── Tab 1: ImageToGCodeTab
│   ├── ImageDropzone           (file input)
│   ├── TracerControls          (threshold, color mode, params)
│   ├── useImageTracer hook     (manages Web Worker lifecycle)
│   ├── tracerWorker.js         (Web Worker: imagetracerjs → SVG string)
│   ├── SVG preview             (inline SVG display)
│   └── "Open in Drawer" btn   (sends SVG → VectorEditor)
│
├── Tab 2: VectorDrawerTab
│   ├── VectorEditor            (Fabric.js canvas)
│   │   ├── ToolPalette         (Select, Rect, Circle, Line, Text, Pen)
│   │   └── bed boundary rect   (from settings.bedMaxX/bedMaxY)
│   └── injectedSVG prop        (receives traced SVG from Tab 1)
│
└── Shared bottom bar
    ├── LineWidthControl        (stroke-width for all paths)
    ├── "Compile Job" btn       (canvas.toSVG() → svg-to-gcode)
    ├── GCodePreview            (gcode-preview renders toolpaths)
    ├── "Start Job" btn         (startStreaming(compiledGCode))
    └── "Save .gcode" btn       (Electron IPC save dialog)
```

---

## Phase 1: VectorEditor (Fabric.js Canvas)

**Component:** `src/components/VectorEditor/VectorEditor.jsx`

- Install `fabric@5` (v5 for stability; v6 has breaking ESM changes incompatible with Vite+Electron)
- Canvas pixel size = `bedMaxX * SCALE` × `bedMaxY * SCALE` (SCALE = px-per-mm, auto-fit to container)
- Bed boundary: drawn as a non-selectable, non-evented dashed rect at canvas edges (visual guide only, excluded from `toSVG()` via layer separation)
- Tools: Select (default), Rectangle, Circle, Line, Freehand (Pencil), Text
- Delete key removes selected object(s)
- All objects default stroke-width = `lineWidth` prop (owned by `Image2GCodePage`, passed down; default 1)
- Incoming SVG from image tracer: accepted as `injectedSVG` prop; `useEffect` watches it and calls `fabric.loadSVGFromString()` when it changes
- `fabricRef` (forwarded ref) exposes `toSVG()` to parent for compile step
- `canvas.toSVG()` used as single source-of-truth export

**ToolPalette:** small icon bar (lucide-react icons) docked left of canvas

---

## Phase 2: Import Pipeline (Web Worker + ImageTracer)

**Worker:** `public/tracerWorker.js` (placed in `/public` so Vite serves it as static asset; instantiated via `new Worker('/tracerWorker.js')`)

- Install `imagetracerjs`
- Worker receives `{ imageData: base64string, options: {...} }` via `postMessage`
- Runs `ImageTracer.imageToSVG(...)` → posts back `{ svg: svgString }`
- On error, posts `{ error: message }`

**Hook:** `src/hooks/useImageTracer.js`
- Manages worker lifecycle (create once, terminate on unmount)
- Exposes `{ trace(base64, options), result, loading, error }`

**Flow:**
1. User drops/selects JPG/PNG in ImageDropzone
2. File read as base64 DataURL
3. `trace(base64, options)` called → worker processes in background
4. On result: SVG preview shown + "Open in Drawer" enabled
5. "Open in Drawer" switches to Tab 2 and calls `VectorEditor.loadSVG(svgString)`

**Tracer options exposed to user:** `ltres` (line threshold), `qtres` (spline threshold), `pathomit` (min path length), color quantization palette size

---

## Phase 3: CAM Compiler (SVG → G-Code)

**Library:** `svg-to-gcode` npm package (pen-plotter oriented, no native deps).  
If that package proves incompatible with Electron renderer, fall back to `svg-path-parser` + hand-written G-code emitter in `gcodeCompiler.js` — the interface is identical either way.  
**Utility:** `src/lib/gcodeCompiler.js`

```js
export async function compileSVGToGCode(svgString, settings) {
  // Inject machine params from SettingsContext
  // Returns string[] of G-code lines
}
```

**Settings injected:**
- `maxFeedrate` → feed rate for G1 moves
- `servoPenDown` → M280 P0 S{servoPenDown} (pen down)
- `servoPenUp` → M280 P0 S{servoPenUp} (pen up)
- `bedMaxX`, `bedMaxY` → bounds clamping / scale

**Compile source (which tab is active):**
- Tab 1 active → compiles directly from the `tracedSVG` string (no drawer required)
- Tab 2 active → compiles from `fabricCanvasRef.current.toSVG()`
- "Compile Job" button disabled if neither source is available

**Triggered by:** "Compile Job" button in shared bottom bar  
**Output stored in:** `compiledGCode` state in parent `Image2GCodePage`

---

## Phase 4: Simulation & Execution

**Library:** `gcode-preview` (npm)  
**Component:** `src/components/GCodePreview.jsx`

- Renders a `<canvas>` bound to gcode-preview instance
- Re-renders whenever `compiledGCode` changes
- 2D top-down toolpath view
- Sized to match bed aspect ratio

**Execution:**
- "Start Job" calls `startStreaming(compiledGCode)` from `useSerial()`
- Disabled unless `connected === true`
- Shows streaming progress from SerialContext

**Save to disk:**
- "Save .gcode" calls `window.platform.saveGCode(lines)` (new IPC handler needed in `main.js`)
- Saves as UTF-8 `.gcode` file via Electron `dialog.showSaveDialog`

---

## State Flow

```
ImageDropzone → base64 → useImageTracer → svgString
                                              ↓
VectorEditor ←←←←←←←←← loadSVG(svgString) ←┘
    ↓ canvas.toSVG()
gcodeCompiler → compiledGCode[]
    ↓                 ↓
GCodePreview    startStreaming()
```

---

## File Plan

### New files
| File | Purpose |
|------|---------|
| `public/tracerWorker.js` | Web Worker for imagetracerjs |
| `src/hooks/useImageTracer.js` | Worker bridge hook |
| `src/lib/gcodeCompiler.js` | SVG-to-GCode compilation utility |
| `src/components/VectorEditor/VectorEditor.jsx` | Fabric.js canvas + tools |
| `src/components/VectorEditor/ToolPalette.jsx` | Tool selection UI |
| `src/components/VectorEditor/VectorEditor.css` | Canvas + palette styles |
| `src/components/GCodePreview.jsx` | gcode-preview wrapper |
| `src/components/GCodePreview.css` | Preview styles |
| `src/pages/ImageToGCodeTab.jsx` | Tab 1 content |
| `src/pages/VectorDrawerTab.jsx` | Tab 2 content |

### Modified files
| File | Change |
|------|--------|
| `src/pages/Image2GCodePage.jsx` | Full rewrite — two tabs + shared state |
| `src/pages/Image2GCodePage.css` | Updated layout for tabbed UI |
| `main.js` | Add `save-gcode` IPC handler |
| `preload.js` | Expose `window.platform.saveGCode(lines)` |
| `package.json` | Add `fabric@5`, `imagetracerjs`, `svg2gcode`, `gcode-preview` |

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `fabric` | `^5.3.0` | Vector canvas editor |
| `imagetracerjs` | `^1.2.6` | Raster→vector tracing (in worker) |
| `svg2gcode` | latest | SVG→G-code CAM compiler |
| `gcode-preview` | latest | 2D toolpath visualizer |

---

## Key Decisions

1. **Fabric v5 not v6** — v6 is ESM-only and has known Vite+Electron issues; v5 is stable
2. **Worker in `/public/`** — Vite doesn't bundle workers from `src/` in Electron renderer without extra config; serving from `/public/` via URL is the simplest path
3. **imagetracerjs over Potrace** — browser-native, no native binaries, works in Worker
4. **Internal tabs not routes** — consistent with GCodeJobsPage pattern already in the codebase
5. **Shared bottom bar** — compile/preview/execute live below both tabs so user never loses context
6. **Scale factor** — canvas displays mm-space scaled to pixels; SVG export uses mm units so the CAM compiler works in real-world coordinates
