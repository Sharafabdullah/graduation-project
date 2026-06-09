# Spec: SVG Vector Editor + G2/G3 Arc G-code Support
**Date:** 2026-06-09
**Status:** Approved

---

## Overview

Two features implemented in sequence:

1. **Phase 1 — SVG Vector Editor:** Replace the Fabric.js canvas in `VectorDrawerTab` with a custom React+SVG path editor. All shapes are real `<path>` elements. Users can edit nodes, simplify paths, smooth edges, and draw new lines directly in SVG space.

2. **Phase 2 — G2/G3 Arc G-code:** Add circular arc motion commands to the firmware and compiler. The firmware interpolates arcs locally (no per-step serial traffic). The compiler emits G2/G3 for circles and where Bezier segments fit an arc within tolerance.

Phase 1 is a prerequisite for Phase 2 because the new SVG-native editor produces cleaner path output that the arc compiler can reason about more accurately.

---

## Phase 1: SVG Vector Editor

### Goals

- Replace Fabric.js with a true SVG-DOM-based editor
- Path editing feels like a simplified Illustrator: click to select, drag nodes, simplify, smooth
- `toSVG()` / `loadSVG()` API is unchanged — compiler and context integration stay the same
- Zoom/pan, keyboard shortcuts, Delete/Undo

### Non-goals

- Full Bezier handle editing for newly drawn paths (new pen/line tools produce L-only paths; existing imported Q/C paths expose their handles for drag)
- Text tool (removed — not useful for CNC pen plotting)
- Multi-level undo (single-level is sufficient)

### Data model

```js
// Internal path record
{
  id: string,        // uuid
  d: string,         // SVG path data string (absolute commands)
  color: string,     // stroke color (for multicolor mode grouping)
  fill: string,      // fill color ('none' for outlines)
}
```

All editing operations mutate `d`. The component state is `paths: PathRecord[]` plus `selectedId: string | null`.

### Component tree

```
VectorEditor (main, exposes useImperativeHandle)
├── SVGCanvas
│   ├── BedBoundary (dashed rect, not exported)
│   ├── PathLayer  (renders all <path> elements)
│   └── NodeEditor (overlay for selected path: anchor + control-handle circles)
├── ToolPalette (left sidebar: select, pen, line)
└── OperationsPanel (right sidebar: simplify slider, smooth button, delete-all)
```

### Tools

| Tool | Gesture | Behavior |
|------|---------|----------|
| `select` | Click path | Selects it, shows node editor |
| `select` | Click empty | Deselects |
| `select` | Drag node | Moves that coordinate in the parsed command list, re-serializes to `d` |
| `pen` | Mouse-down → drag → up | Records `M x,y L x,y L ...` while dragging; commits path on mouse-up |
| `line` | Click start, click end | Emits `M x,y L x,y` |
| `Delete` / `Backspace` | (keyboard) | Deletes selected path |
| `Ctrl+A` | (keyboard) | Selects all paths |
| `Ctrl+Z` | (keyboard) | Single-level undo |
| `Escape` | (keyboard) | Deselects / cancels active draw |
| Scroll wheel | | Zoom at cursor |
| Space + drag | | Pan |

### Node editor

- `svg-path-parser` (already installed) parses selected path `d` into an absolute-command array
- Anchor points (M, L, Z endpoints, Q/C endpoints) render as filled 6px circles
- Q/C control handles render as open 5px circles connected to their anchor by a dashed line
- Dragging any circle updates that coordinate in the command array and re-serializes with a simple `formatD()` function
- Node editor is a pure SVG overlay inside the same `<svg>` tag — no separate DOM layer needed

### Canvas-level operations

| Operation | Implementation |
|-----------|---------------|
| **Simplify** | Slider 0–5 (mm tolerance). Extracts all L-point runs from each path via `svg-path-parser`, runs `simplify-js` (Ramer-Douglas-Peucker), re-serializes. Q/C commands are first flattened to densely-sampled L points, simplified, then written back as L. |
| **Smooth edges** | Button. For each path that is L-only (no Q/C), converts L segments to cubic Bezier using Catmull-Rom centripetal parameterization → C commands. Paths already containing Q/C are left unchanged. |
| **Undo** | Stores `prevPaths` snapshot before each destructive op (simplify, smooth, delete, pen commit). `Ctrl+Z` restores. Only one level deep. |
| **Delete all** | Confirmation `Dialog` → clears `paths` state. |

### `useImperativeHandle` API (unchanged contract)

```js
toSVG()       // → SVG string (bed boundary excluded)
loadSVG(str)  // loads SVG, converts all geometry to path records, fits to bed
```

`loadSVG` normalizes `<rect>`, `<circle>`, `<ellipse>`, `<line>` elements to path `d` strings before storing.

### Zoom / pan

- `viewTransform: { x, y, scale }` state on `SVGCanvas`
- `<g transform="translate(x,y) scale(s)">` wraps all content
- Scroll → update `scale` and recompute `x,y` to keep cursor point fixed
- Space+mousedown → pan mode: update `x,y` on mousemove
- SVG `pointer-events` set to `none` on non-interactive elements during pan

### Imports / dependencies

- `simplify-js` — new dependency (2 KB minified, MIT)
- `svg-path-parser` — already installed
- Fabric.js — **removed** from `VectorEditor`; stays available for any other usage elsewhere but is no longer imported in `VectorEditor.jsx`

### Files changed

| File | Change |
|------|--------|
| `src/components/VectorEditor/VectorEditor.jsx` | Full rewrite |
| `src/components/VectorEditor/NodeEditor.jsx` | New component |
| `src/components/VectorEditor/PathLayer.jsx` | New component |
| `src/components/VectorEditor/OperationsPanel.jsx` | New component |
| `src/components/VectorEditor/ToolPalette.jsx` | Rewrite (remove Fabric tool refs) |
| `src/components/VectorEditor/VectorEditor.css` | Update styles |
| `src/lib/pathOps.js` | New: `simplifyPaths`, `smoothPaths`, `formatD`, `svgToPaths`, `pathsToSvg` |
| `package.json` | Add `simplify-js` |

---

## Phase 2: G2/G3 Arc G-code

### Goals

- Firmware accepts and interpolates G2 (CW) and G3 (CCW) arc commands using I/J offset method
- Compiler emits G2/G3 for true circles and for Q/C Bezier segments that fit a circular arc within tolerance
- Soft limits and G-code preview understand G2/G3
- R-format (radius-only) G2/G3 is accepted and converted to I/J internally in firmware

### Non-goals

- Ellipse arcs (rx ≠ ry): kept as tessellated G1 (no standard G-code for ellipses)
- Helical arcs (G2/G3 with Z motion): out of scope for 2-axis pen plotter

### 2.1 Firmware — `cnc_base.h`

#### New function: `moveArc`

```cpp
void moveArc(float endX, float endY, float offsetI, float offsetJ,
             bool clockwise, float feedRate);
```

Algorithm:
1. `cx = currentX + offsetI`, `cy = currentY + offsetJ`
2. `radius = sqrt(offsetI² + offsetJ²)`
3. `startAngle = atan2(currentY - cy, currentX - cx)`
4. `endAngle = atan2(endY - cy, endX - cx)`
5. Normalize sweep direction (CW vs CCW), handle full-circle (start == end → sweep = ±2π)
6. `angularStep = 2 * acos(1 - chordError / radius)` (clamped to min 0.5°, max 15°)
7. Loop from `startAngle` to `endAngle` in `angularStep` increments:
   - `ptX = cx + radius * cos(angle)`
   - `ptY = cy + radius * sin(angle)`
   - `moveLinear(ptX, ptY, feedRate)`
8. Final `moveLinear(endX, endY, feedRate)` — land exactly on stated endpoint

#### New config key: `$CE`

- `float chordError = 0.2;` — global, runtime-mutable
- `$CE=<mm>` sets it (min 0.01, max 2.0)
- Reported in `$?` output

#### G-code parsing additions in `processParsedGCode()`

```cpp
case 2:
case 3: {
  // parse X, Y (endpoint), I (x-offset to center), J (y-offset to center)
  // R format: if HasWord('R') and no I/J, compute I/J from radius + endpoint geometry
  // call moveArc(...)
  Serial.println("ok");
  break;
}
```

R-format conversion: given current pos P0, endpoint P1, and radius R:
- midpoint M = midpoint(P0, P1)
- distance d = |P0P1| / 2
- h = sqrt(R² - d²)
- center is M ± h * perpendicular_unit_vector
- Sign chosen: positive R → minor arc (center on left of P0→P1 for G3, right for G2)

#### Files changed (firmware)

| File | Change |
|------|--------|
| `Arduino Codes/CNC_Firmware/cnc_base.h` | Add `moveArc()`, `$CE` config, G2/G3 case in `processParsedGCode()` |

### 2.2 Compiler — `gcodeCompiler.js`

#### New internal point type

```js
{ type: 'A', x, y, i, j, clockwise }
// x,y = absolute endpoint (machine coords, Y already flipped)
// i,j = offset from arc START to center (not from origin)
// clockwise = true → G2, false → G3
```

#### Circle/ellipse handling

Replace `ellipseToPoints()` with `circleToArcs()` for the case `rx === ry`:

```
Two half-arcs (each 180°):
  Half 1: G0 to (cx - rx, cy) [pen up], then G2/G3 to (cx + rx, cy) with I=rx J=0
  Half 2: G2/G3 to (cx - rx, cy) with I=-rx J=0
```

`<ellipse>` with `rx !== ry` keeps the existing `ellipseToPoints()` tessellation.

#### Bezier arc-fitting: `fitArcToBezier(p0, ctrl1, [ctrl2], p1)`

For Q (quadratic) segments: 3 sample points — p0, ctrl, p1.
For C (cubic) segments: 4 sample points — p0, ctrl1, ctrl2, p1.

Algorithm (circumscribed circle through 3 points):
1. Use p0, midpoint of curve (t=0.5), p1 as the 3 reference points
2. Compute circumscribed circle center and radius
3. Sample the Bezier at 8 intermediate t values
4. Measure max deviation: distance from each sample to the circumscribed circle
5. If `maxDeviation < ARC_FIT_TOLERANCE` (0.05 mm): determine CW/CCW from cross-product, emit `'A'` point
6. Otherwise: fall back to `tessellateQuadratic` / `tessellateCubic` from `bezier.js` — existing behavior

`ARC_FIT_TOLERANCE = 0.05` — constant, not user-configurable (sub-0.1mm is imperceptible on a pen plotter).

#### `generatePathGcode()` update

```js
case 'A':
  if (!penDown) { lines.push('M3 ; tool on'); penDown = true; }
  lines.push(`G${pt.clockwise ? 2 : 3} X${x} Y${y} I${pt.i.toFixed(3)} J${pt.j.toFixed(3)} F${maxFeedrate}`);
  break;
```

Note: I/J in the G-code output are **relative to the arc's start point** (the machine position at the moment that line executes), which matches the firmware's expectation and the industry-standard I/J interpretation.

### 2.3 Soft Limits — `softLimits.js`

#### `scanGCodeBounds()` extension

For lines matching `/^G[23]\s/`:
1. Parse endpoint X, Y and offsets I, J
2. Reconstruct center, radius, start/end angles
3. Check endpoint against `isInWarnZone`
4. For each cardinal angle (0°, 90°, 180°, 270°): if angle falls within arc sweep, compute that point and check it too
5. Include all violations found

`parseXY()` extended to also return `{ i, j }` when present (non-breaking change — callers that only use `x`/`y` are unaffected).

#### Live streaming check in `SerialContext`

The `sendNextGCodeLine` function that calls `isInWarnZone` before sending each line is updated to also handle G2/G3 endpoint + arc-extent checking (same logic as `scanGCodeBounds`).

### 2.4 G-code Preview — `GCodePreview.jsx`

Parse G2/G3 lines in the preview's drawing loop:

```js
const arcMatch = line.match(/^G([23])\s+X([\d.-]+)\s+Y([\d.-]+)\s+I([\d.-]+)\s+J([\d.-]+)/i);
if (arcMatch) {
  const cw = arcMatch[1] === '2';
  const ex = parseFloat(arcMatch[2]), ey = parseFloat(arcMatch[3]);
  const ci = parseFloat(arcMatch[4]), cj = parseFloat(arcMatch[5]);
  const cx = currentX + ci, cy = currentY + cj;
  const r = Math.sqrt(ci*ci + cj*cj);
  const startA = Math.atan2(currentY - cy, currentX - cx);
  const endA   = Math.atan2(ey - cy, ex - cx);
  ctx.arc(toCanvasX(cx), toCanvasY(cy), r * scale, startA, endA, !cw);
  ctx.stroke();
}
```

### 2.5 Settings

| Item | Change |
|------|--------|
| `SettingsContext.jsx` `DEFAULT_SETTINGS` | Add `chordError: 0.2` |
| `SettingsPage.jsx` | Add `$CE` input field under motion section |
| `applyToArduino()` | Add `$CE=${settings.chordError}` to send list |
| `CLAUDE.md` | Update firmware G-code table with G2/G3 and `$CE` |

### Files changed (Phase 2)

| File | Change |
|------|--------|
| `Arduino Codes/CNC_Firmware/cnc_base.h` | `moveArc()`, G2/G3 parsing, `$CE` config |
| `Desktop_App/src/lib/gcodeCompiler.js` | `circleToArcs()`, `fitArcToBezier()`, `'A'` point type, `generatePathGcode` G2/G3 emit |
| `Desktop_App/src/lib/softLimits.js` | G2/G3 awareness in `scanGCodeBounds`, `parseXY` extension |
| `Desktop_App/src/components/GCodePreview.jsx` | G2/G3 arc rendering |
| `Desktop_App/src/contexts/SettingsContext.jsx` | `chordError` default |
| `Desktop_App/src/pages/SettingsPage.jsx` | `$CE` input |
| `CLAUDE.md` | Firmware table + `$CE` config key |

---

## Implementation Order

```
Phase 1 — SVG Vector Editor
  1. Install simplify-js
  2. Write pathOps.js (simplifyPaths, smoothPaths, formatD, svgToPaths, pathsToSvg)
  3. Rewrite VectorEditor.jsx + sub-components (PathLayer, NodeEditor, OperationsPanel, ToolPalette)
  4. Update VectorEditor.css
  5. Smoke-test: load traced SVG → edit nodes → simplify → export SVG → compile to G-code

Phase 2 — G2/G3 Arcs
  6. Firmware: moveArc(), G2/G3 parsing, $CE config
  7. Compiler: circleToArcs(), fitArcToBezier(), 'A' point type, generatePathGcode update
  8. softLimits.js: G2/G3 awareness
  9. GCodePreview.jsx: arc rendering
  10. Settings: chordError field + applyToArduino
  11. CLAUDE.md: update firmware reference table
```

---

## Open Questions / Known Constraints

- **Simplify on Q/C paths:** Catmull-Rom smoothing only applies to L-only paths. Paths with existing Q/C handles (from the tracer) are not re-smoothed to avoid double-processing. User can simplify first (flattens to L), then smooth.
- **Full-circle G2/G3:** Standard G-code forbids an arc whose endpoint equals its start point. Circles are always split into two 180° half-arcs. This is transparent to the user.
- **Arc-fit tolerance:** `ARC_FIT_TOLERANCE = 0.05mm` is hardcoded. The pen tip width (typically 0.3–0.8mm) is far larger than this, so it's imperceptible in practice.
- **Y-axis flip in arc I/J:** The compiler flips Y coordinates (machine Y = bedH - svgY). Arc I/J offsets are computed after this flip. The `i`/`j` values in the emitted G-code are already in machine coordinates — firmware does not need to know about the flip.
