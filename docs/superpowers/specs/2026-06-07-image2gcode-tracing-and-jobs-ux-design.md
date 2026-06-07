# Image2GCode: In-App Dialogs, Three-Tab Layout & Tracing Redesign

**Date:** 2026-06-07
**Status:** Approved

---

## Problem Statement

Three distinct issues to address on top of the existing Image2GCode page (which already merged
"Send to Jobs" and "Save .gcode" into a single "Save Job" button — see
`2026-06-06-image2gcode-fixes-and-jobs.md`):

1. **Naming UX is clunky** — `handleSaveJob` uses the native `window.prompt()` to ask for a job
   name, `alert()` to report failures, and `VectorEditor`'s "delete everything" uses
   `window.confirm()`. These native browser dialogs break the app's dark theme and feel jarring.
2. **Page layout doesn't match the intended workflow** — the page has two tabs (Import/Trace,
   Vector Drawer) plus a cramped G-Code Preview squeezed into the shared bottom bar. The user
   wants a third dedicated tab to view the compiled toolpath outline at full size.
3. **Tracing parameters don't behave as expected** — confirmed root cause: `isWhiteOrNone()` in
   `gcodeCompiler.js` uses a hardcoded brightness check (`r,g,b > 250`) to decide which traced
   paths represent "background" (and should be skipped). imagetracerjs's default color sampling
   (`colorsampling: 2`, grid-based) frequently produces background palette colors that fail this
   check (e.g. `rgb(210,210,210)` for photo-lit scans) — verified directly: with
   `numberofcolors >= 6` on a synthetic "scanned paper" image, the background survives the filter
   and gets traced + drawn as a large filled shape, defeating "white = no draw, black = draw".
   Additionally, `pathToPoints()` collapses Bezier `C`/`Q` curve segments straight to their
   endpoint, discarding curve shape — so `qtres` (spline threshold) has little visible effect on
   the final toolpath.

---

## Section 1: In-App `Dialog` Component

**New files:** `src/components/Dialog.jsx`, `src/components/Dialog.css`

A single reusable modal supporting two modes, styled with the existing theme variables
(`--bg-card`, `--border`, `--accent`, `--text-primary`, `.btn` classes):

```js
// Imperative-friendly hook-based API mounted once near the app root, OR
// a controlled component rendered per-use. Controlled component chosen for
// simplicity — no portal/singleton plumbing needed.

<Dialog
  open={dialogState.open}
  mode="prompt" | "confirm" | "alert"
  title="Save Job"
  message="Enter a name for this job:"      // confirm/alert
  defaultValue="Image Job 14:32:07"          // prompt
  confirmLabel="Save"
  onConfirm={(value) => { ... }}             // value is the input string for prompt mode
  onCancel={() => { ... }}
/>
```

- **prompt** — message + text input (pre-filled with `defaultValue`, auto-selected/focused) +
  Save/Cancel buttons. Enter submits, Escape cancels.
- **confirm** — message + Yes/Cancel buttons (used for "delete everything").
- **alert** — message + single OK button (used for save-failure errors).

Rendered as a fixed-position overlay (`position: fixed`, semi-transparent backdrop, centered
card) using the same `.card` look as the rest of the app.

### Call sites updated

| File | Replaces | With |
|---|---|---|
| `Image2GCodePage.jsx` | `window.prompt(...)` in `handleSaveJob` | `<Dialog mode="prompt">` via local `dialogState` |
| `Image2GCodePage.jsx` | `alert(...)` on save failure | `<Dialog mode="alert">` |
| `VectorEditor.jsx` | `window.confirm('Are you sure...')` | `<Dialog mode="confirm">` |

Each page/component owns its own `dialogState` (`{ open, mode, ...props }`) — no global dialog
context needed; this is page-local UI state, not cross-cutting app state.

---

## Section 2: Three-Tab Layout

`Image2GCodePage` gains a third tab. Tab bar becomes:

1. **"Import & Trace"** — existing `ImageToGCodeTab` (upload image, tracer params, SVG preview)
2. **"Draw & Finalize"** — existing `VectorDrawerTab` (Fabric.js canvas)
3. **"G-Code Outline"** *(new)* — `GCodePreview` promoted out of the bottom bar into a
   full-size dedicated view, plus the line-count readout and compile-warning message that
   currently live in the bottom bar's right section

The shared bottom bar (Line Width control, "Compile Job", "Save Job", "Run Job") remains visible
across **all three tabs** — compiling/saving/running are cross-cutting actions the user should
be able to trigger from any tab without losing context. Only the `<GCodePreview>` canvas itself
(currently rendered small inside `.bottom-bar-preview`) moves to occupy Tab 3's full content
area; the bottom bar's preview slot is removed and that horizontal space is reclaimed for the
line-count/warning text.

`Image2GCodeContext.activeTab` type changes from `'image' | 'drawer'` to
`'image' | 'drawer' | 'outline'`.

**Files changed:** `Image2GCodePage.jsx`, `Image2GCodePage.css`, `Image2GCodeContext.jsx`

---

## Section 3: Tracing Redesign — Threshold-Based Binarization

Replaces the brittle "guess which palette color is background" approach with a deterministic
preprocessing step that **guarantees** white=skip / black=draw for any input image.

### 3a — Brightness threshold preprocessing (new)

**New file:** `src/lib/imageBinarize.js`

```js
// Converts an ImageData to a binarized ImageData: pixels with
// luminance < threshold become pure black (0,0,0,255), else pure white (255,255,255,255).
export function binarizeImageData(imageData, threshold) { ... }
```

Luminance computed as standard `0.299*R + 0.587*G + 0.114*B`. This runs on the main thread
(canvas already available there per `useImageTracer`) right before the image is posted to the
tracer worker, so the worker always receives strictly two-tone pixel data.

### 3b — Threshold control in `ImageToGCodeTab`

New slider: **"Threshold: {value}"** (range 0–255, default 128) with a live binarized preview
(small canvas showing the black/white mask) so the user can see exactly what will be traced
*before* committing to a trace. Adjusting the slider re-renders the preview instantly (cheap
canvas operation); clicking "Re-trace" re-runs the full pipeline with the new threshold.

`tracerOptions` in `Image2GCodeContext` gains a `threshold: 128` field.

### 3c — Forced black/white palette in the tracer

`useImageTracer.trace()` now always passes `numberofcolors: 2, colorsampling: 0` (generated
grayscale palette → guaranteed pure black `(0,0,0)` + pure white `(255,255,255)`) when tracing
binarized data — overriding whatever `numberofcolors` the user set for single-color mode (that
slider becomes multicolor-mode-only, see 3e).

### 3d — Simplified, reliable background filter

`isWhiteOrNone()` in `gcodeCompiler.js` is simplified to an exact check:
`color === 'rgb(255,255,255)' || color === 'white' || color === '#fff' || color === '#ffffff' || color === 'none'`
— safe now that the palette is forced to pure black/white upstream. The fragile
`r,g,b > 250` brightness-range guess is removed entirely.

### 3e — Multicolor mode keeps full-color tracing, gets corner-sampled background detection

When **Multicolor Mode** is checked, the binarization step is skipped (the user wants real
colors), and `numberofcolors`/`colorsampling: 2` behave as before — but instead of relying on
`isWhiteOrNone`, the compiler determines the background color by **sampling the four corner
pixels of the source image** (passed through from `ImageToGCodeTab` alongside the SVG) and
treats whichever palette color is closest (by Euclidean RGB distance) to the corner-pixel
average as background/skip. This is a far more reliable heuristic than "is it white" — it
works for colored paper, photos with colored borders, etc.

`compileSVGToGCode(svgString, settings)` gains an optional `backgroundColor: {r,g,b}` field in
`settings`; when present (multicolor mode), it's used for the closest-match comparison instead
of `isWhiteOrNone`.

### 3f — Curve tessellation fix

`pathToPoints()` in `gcodeCompiler.js`: the `case 'C': case 'Q':` branch currently pushes a
single `{ type: 'L', x: endpoint }`, discarding curve shape. Replace with tessellation —
sample N=8 points along the actual quadratic/cubic Bezier curve (De Casteljau or direct
parametric evaluation using the parsed control points `cmd.x1,y1[,x2,y2]` and endpoint
`cmd.x,y`) and push a `{ type: 'L' }` point for each. This makes `qtres` (which controls how
aggressively imagetracerjs fits curves vs. straight segments) visibly affect the smoothness of
the final toolpath, instead of being neutralized by the endpoint-only collapse.

**Files changed:** `src/lib/imageBinarize.js` (new), `src/hooks/useImageTracer.js`,
`src/pages/tabs/ImageToGCodeTab.jsx`, `src/contexts/Image2GCodeContext.jsx`,
`src/lib/gcodeCompiler.js`

---

## File Change Summary

| File | Change |
|---|---|
| `src/components/Dialog.jsx` (new) | Reusable prompt/confirm/alert modal |
| `src/components/Dialog.css` (new) | Modal styling matching app theme |
| `src/lib/imageBinarize.js` (new) | Luminance-threshold binarization utility |
| `src/pages/Image2GCodePage.jsx` | Add third tab; replace window.prompt/alert with Dialog; remove preview from bottom bar |
| `src/pages/Image2GCodePage.css` | Layout for three tabs; bottom-bar restyle |
| `src/components/VectorEditor/VectorEditor.jsx` | Replace window.confirm with Dialog |
| `src/contexts/Image2GCodeContext.jsx` | `activeTab` gains `'outline'`; `tracerOptions.threshold` |
| `src/hooks/useImageTracer.js` | Binarize before posting to worker (single-color mode); force 2-color palette |
| `src/pages/tabs/ImageToGCodeTab.jsx` | Threshold slider + live binarized preview |
| `src/lib/gcodeCompiler.js` | Simplified `isWhiteOrNone`; corner-sampled background for multicolor; curve tessellation |

---

## Out of Scope

- The "Save Job" persistence/loading mechanism itself (disk storage, Loaded Jobs list, History
  tab, Open Jobs Folder) — already implemented per `2026-06-06-image2gcode-fixes-and-jobs.md`;
  this spec only changes *how the user is prompted for a name* and *how errors are surfaced*.
- Drill/Laser machine modes, networking tab, large-image job splitting, per-mode theming —
  tracked separately in `todo.md`.
- Changing the imagetracerjs `numberofcolors`/`ltres`/`pathomit` slider ranges or defaults
  beyond what's needed to support the new threshold workflow.
