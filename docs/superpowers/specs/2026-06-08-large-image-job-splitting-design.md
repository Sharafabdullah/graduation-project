# Multi-Part Jobs: Splitting Oversized Drawings into Sequential Sub-Jobs

**Date:** 2026-06-08
**Status:** Approved

---

## Problem Statement

The bed is `bedMaxX × bedMaxY` mm (default 200×200). Nothing currently stops a user from
compiling artwork whose toolpath is larger than that — `compileSVGToGCode` does not scale to
fit the bed, it just emits machine coordinates directly. Today, an oversized job either gets
flagged by `scanGCodeBounds` as a soft-limit violation and has its out-of-bounds lines **skipped**
at runtime (silently losing part of the drawing), which is not what anyone wants.

This is `todo.md` item 5, requested verbatim:

> I want to add a feature to draw pictures larger than the canvas - it divides a large picture
> into multiple sub jobs and saves them under one large job, the admin then can execute the jobs
> sequentially, when he finishes a part of the paper (the sub job finished) - he re-arranges the
> paper, and starts the next sub job. There is also a view to see how the sub jobs are divided.

This is a real-world "tiled plotting" workflow: the physical paper is smaller than the artwork,
so the artwork is cut into a grid of bed-sized tiles, each plotted on its own sheet/region with
the operator manually repositioning paper between tiles.

---

## Section 1: Where splitting happens — G-code-level tiling, not SVG-level

**Decision:** Split the **compiled G-code** (a flat `lines[]` array, machine coordinates,
post-`compileSVGToGCode`), not the SVG or the traced point-sets.

Why this beats splitting earlier in the pipeline:
- It's a pure `lines[] → lines[][]` transform with no dependency on Fabric.js, SVG parsing, or
  the tracer — so it works on **any** compiled/loaded G-code, not just image-traced artwork (a
  hand-drawn `VectorDrawerTab` design that's too big benefits equally).
- It reuses 100% of the existing compiler (header/footer conventions, `M3`/`M5` pen
  convention, feed rate emission) — the splitter only needs to *re-emit* in the same style, which
  is far simpler than re-deriving G-code generation rules at the SVG layer.
- Geometric clipping against axis-aligned tile rectangles is well-understood (Liang-Barsky line
  clipping) and works directly on the `(x, y)` pairs already present in `G0`/`G1` lines — no
  coordinate-transform bookkeeping across SVG `transform` chains.

**New file:** `src/lib/gcodeSplitter.js` — pure functions, no React/DOM dependency (testable with
`node --test` like `bezier.js`/`colorMatch.js`).

---

## Section 2: Parsing the toolpath into clippable segments

The splitter needs an ordered list of drawing segments with pen state — the same information
`GCodePreview` derives ad-hoc inside its canvas-drawing loop (`GCodePreview.jsx:30-84`), but as
a reusable data structure rather than immediate-mode drawing calls. Rather than refactor the
preview (it's working, canvas-coupled code — not worth destabilizing), `gcodeSplitter.js` gets
its own focused parser:

```js
// Walks `lines`, tracking position and pen state (M3/M4 = down, M5 = up — the
// mode-agnostic convention gcodeCompiler emits; see GCodePreview.jsx:47 for why
// M280 angle-based detection is also recognized for legacy saved jobs).
// Returns an ordered list of motion segments.
export function parseToolpathSegments(lines) {
  // → [{ from: {x,y}, to: {x,y}, drawing: boolean, feedRate: number }, ...]
}

// Bounding box of DRAWING moves only (G1 with pen down) — matches the
// "Drawing bounding box" GCodePreview already overlays (GCodePreview.jsx:118-129).
// G0 rapids (incl. the "G0 X0 Y0 ; return home" footer) must be excluded or
// they'd pin the bbox to include the origin.
export function computeDrawingBounds(segments) {
  // → { minX, minY, maxX, maxY } or null if there are no drawing segments
}
```

---

## Section 3: Tile grid layout

```js
// Lays out a grid of bedW × bedH tiles that fully covers `bounds`, anchored
// at the bounds' bottom-left corner (minX, minY). No overlap, no scaling —
// see "Out of scope" for why.
export function planTileGrid(bounds, bedW, bedH) {
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / bedW));
  const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / bedH));
  return { rows, cols, tileW: bedW, tileH: bedH };
}
```

A tile at grid position `(row, col)` (row 0 = bottom, matching machine-Y-up convention) covers
the rectangle:
```
x ∈ [bounds.minX + col * bedW,  bounds.minX + (col+1) * bedW]
y ∈ [bounds.minY + row * bedH,  bounds.minY + (row+1) * bedH]
```
A point `(x, y)` inside that tile maps to **tile-local coordinates** (what the sub-job's G-code
will actually contain, so it plots correctly on a fresh sheet zeroed at the tile's corner):
```
localX = x - (bounds.minX + col * bedW)
localY = y - (bounds.minY + row * bedH)
```

**Numbering / display order:** tiles are presented in reading order — top-left to bottom-right,
row by row — which means `displayRow = rows - 1 - row` (since row 0 is the bottom in machine
space but should display at the bottom of the on-screen diagram, i.e. last). Tile #N (1-based) =
`displayRow * cols + col + 1`. The division view (Section 6) renders this numbering directly so
the operator just follows "Part 1, Part 2, …" without needing to reason about machine coordinates.

---

## Section 4: Clipping segments against tiles (Liang-Barsky)

```js
// Standard Liang-Barsky parametric line clipping against an axis-aligned
// rectangle. Returns the clipped {from, to} sub-segment, or null if the
// segment doesn't intersect rect at all.
function clipSegmentToRect(p0, p1, rect) { ... }
```

For each **drawing** segment (`drawing: true`), and for each tile rectangle, compute the clipped
sub-segment. A segment can clip into zero, one, or (if it's long enough to span a tile) more than
one tile.

**Reassembling continuous strokes per tile:** a single original stroke (one continuous pen-down
run) may cross a tile's boundary multiple times — each crossing must become a separate pen-up/
pen-down stroke in that tile's sub-job (you can't draw through a gap in the paper). The algorithm
walks the original stroke's segments in order, accumulating a polyline per tile:

- clip is `null` → finalize any in-progress polyline for that tile (push it, reset)
- clip is non-null and its `from` matches the polyline's last point (within `1e-6`) → extend
  the polyline with `to`
- clip is non-null but `from` doesn't match → the path exited and re-entered this tile; finalize
  the old polyline (if any) and start a new one at `[from, to]`
- at the end of the stroke, finalize any remaining polyline

This correctly produces N disjoint strokes for a path that crosses a tile's boundary N times,
each becoming its own `G0`(rapid)/`M3`/`G1…`/`M5` sequence in that tile's output — exactly
mirroring how `gcodeCompiler.generatePathGcode` already structures pen-up/down transitions
(`gcodeCompiler.js:285-316`).

**Rapids (`G0`, pen up) are not clipped or replicated** — they only matter for repositioning the
pen between strokes in the *original* job. Each tile's sub-job synthesizes its own `G0` moves to
the start of each reconstructed stroke, just like `compileSVGToGCode` does for a fresh path.

---

## Section 5: Emitting each sub-job's G-code

```js
export function splitGCodeIntoTiles(lines, settings) {
  // settings: { bedW, bedH, maxFeedrate }
  // → { grid: {rows, cols, tileW, tileH}, bounds, subJobs: [{ row, col, lines }] }
  // subJobs is ordered in DISPLAY order (Part 1, Part 2, … — see Section 3)
}
```

Each sub-job's `lines` is a **complete, independent, valid G-code program**, matching the header/
footer conventions `compileSVGToGCode` already establishes (`gcodeCompiler.js:278-282,338`):

```
; Generated by Platform Control — Multi-Part Job "<name>" — Part <n> of <total> (row R, col C)
G21 ; mm units
G90 ; absolute positioning
F<maxFeedrate>
M5 ; tool off
<reconstructed strokes, tile-local coordinates, G0/M3/G1.../M5 per Section 4>
G0 X0 Y0 ; return home
```

Because every sub-job is plotted on its own freshly-zeroed sheet, **each one assumes machine
`(0,0)` is that tile's bottom-left corner** — which is exactly what re-zeroing between parts
(Section 7) guarantees.

---

## Section 6: Persistence — `.mjob.json` manifest files

**Decision:** one self-contained JSON manifest per multi-part job (not N separate `.gcode` files
plus an index — avoids partial-write/orphan-file bookkeeping, and "one file = one job" matches
the existing mental model of `userData/jobs/`).

```js
{
  version: 1,
  type: 'multi-job',
  name: string,
  createdAt: number,            // Date.now()
  grid: { rows, cols, tileW, tileH },
  bounds: { minX, minY, maxX, maxY },   // original artwork's drawing bbox
  subJobs: [
    { row, col, lines: string[] },      // ordered in DISPLAY order — see Section 3
    ...
  ],
}
```

**`main.js` additions** (alongside the existing `file:save-job`/`file:get-jobs`,
`main.js:233-296`):
- `file:save-multi-job` `(name, manifest)` → sanitizes `name`, writes
  `<sanitized>-<timestamp>.mjob.json` to the existing `jobsDir`, returns
  `{ success, job: <manifest-with-path> }`
- `file:get-multi-jobs` → scans `jobsDir` for `*.mjob.json`, `JSON.parse`s each, returns
  `{ success, jobs: [...] }`

**`preload.js` additions:** `saveMultiJob(name, manifest)`, `getMultiJobs()`.

**`JobsContext.jsx` additions:** a parallel `multiJobs` array loaded on mount via
`getMultiJobs()`, with `addMultiJob`/`removeMultiJob` helpers mirroring the existing
`loadedFiles`/`addLoadedFile`/`removeLoadedFile` (in-memory removal only — "Delete removes from
context, not disk", matching `CLAUDE.md`'s documented convention; the user can still delete the
underlying file via "Open Jobs Folder").

Multi-jobs are **kept structurally separate** from flat `loadedFiles` rather than shoehorned into
the same `{ name, path, content, size, lines }` shape — they don't have a single linear G-code
preview, they have a grid + N independent programs, and forcing a uniform shape would mean every
consumer of `loadedFiles` needs a `multiJob` branch. A parallel list with its own dedicated UI
(Section 8) keeps both concerns simple.

---

## Section 7: Sequential execution UX — operator-paced, not auto-chained

**Decision:** the admin manually starts each sub-job; the app does **not** attempt to
auto-detect "operator finished rearranging paper" and auto-advance.

Why: rearranging paper is an inherently physical, manual action — there's no sensor for "the
operator is done repositioning the sheet." Building an auto-chaining state machine on top of
the existing per-job streaming lifecycle (`SerialContext`'s pending-queue/command-tracking
machinery) would add real complexity for a transition that *must* be gated on a human decision
anyway. The simplest correct design: show clear status + instructions, let the admin click
"Start" on each part when ready. This also means errors/stops on one part can't cascade into
auto-starting the next.

**Critical correctness requirement — re-zeroing between parts:** every sub-job's G-code assumes
machine `(0,0)` = that tile's bottom-left corner on a *freshly positioned* sheet (Section 5). The
UI must make this unmissable: before starting part *N* (for *N* > 1), the operator must
reposition the paper **and re-establish the origin** (re-home via the existing `homeStage()` flow,
or jog to a reference point and `Set Zero` / `G92`). The per-part instruction panel (Section 8)
states this explicitly — it is not optional, skipping it means the next part draws in the wrong
place on the new sheet.

**Reuses, unchanged:** `startStreaming(lines, jobName)`, `jobHistory`, all existing soft-limit /
emergency-stop / pause-resume machinery in `SerialContext`. A sub-job is, to the streaming layer,
just another G-code job — `jobName` is set to `"<Multi-Part name> — Part N of M"` so it shows up
distinctly in `jobHistory` and the `/console?jobId=` filter.

---

## Section 8: UI — "Multi-Part" tab + division view

### 8a — Entry point: detecting oversized compiled jobs in `Image2GCodePage`

After `handleCompile` succeeds, compute `computeDrawingBounds(parseToolpathSegments(lines))` and
compare against `bedW`/`bedH`. If the artwork exceeds either dimension, show a banner (next to
the existing `compileWarning` soft-limit banner, same visual language):

> ⚠ This drawing is 480 × 320 mm — larger than your 200 × 200 mm bed.
> **[ Split into a Multi-Part Job → ]**

Clicking it runs `splitGCodeIntoTiles`, opens the existing `Dialog` (prompt mode, like
`handleSaveJob`) for a name, calls `window.platform.saveMultiJob(name, manifest)`, adds the result
via `addMultiJob`, and navigates to `/gcode` — mirroring `performSaveJob`'s flow
(`Image2GCodePage.jsx:98-114`) almost exactly.

### 8b — New tab in `GCodeJobsPage`: "Multi-Part"

A fourth file-browser tab (alongside Built-in / Loaded / History), listing `multiJobs` by name
with a `RxC parts` badge. Selecting one renders `MultiJobView` in the right panel **instead of**
the standard `GCodePreview` + line list.

### 8c — `MultiJobView` component (new: `src/components/MultiJobView.jsx` + `.css`)

Two halves:

1. **Division diagram** — an SVG/canvas grid (rows × cols rectangles sized proportionally to
   `grid.tileW`/`tileH`, in display order per Section 3) with each cell numbered "Part N". The
   currently-selected/next-to-run part is highlighted (accent border + fill), completed parts
   shown with a checkmark/dimmed state (tracked via local component state keyed by sub-job index,
   reset when a different multi-job is selected — *not* persisted; "done" here just means "I ran
   it in this session", a lightweight progress cue, not a durable record — `jobHistory` is the
   durable record).
2. **Part list + runner** — for the selected part: a `GCodePreview` of just that sub-job's
   toolpath (reusing the existing component — it already accepts a plain `lines[]`), an
   instruction panel:

   > **Part 3 of 6** (row 2, col 1)
   > 1. Remove the finished sheet for Part 2.
   > 2. Place a fresh sheet and re-establish the origin: **Home** the machine, then **Set Zero**
   >    at this sheet's bottom-left corner (or jog to your reference mark and Set Zero there).
   > 3. Click **Start Part 3** below.

   …and a `Start Part N` button (disabled while `streaming`, mirrors `handleStart` in
   `Image2GCodePage`/`GCodeJobsPage` — calls `startStreaming(subJob.lines, "<name> — Part N of M")`).

This satisfies "There is also a view to see how the sub jobs are divided" with the division
diagram, and "execute the jobs sequentially… re-arrange the paper, and start the next sub job"
with the per-part instruction + Start flow.

---

## Out of scope (v1)

- **Tile overlap / registration marks drawn on the paper.** Real tiled-plotting setups sometimes
  overlap adjacent tiles slightly so minor misalignment is visually forgiving, or draw alignment
  crosses on the paper itself. Both add real complexity (double-drawing in overlap zones; or
  polluting the artwork with non-data marks) for a benefit the user didn't ask for. Because tiles
  are bed-sized with **no overlap and no scaling**, the geometry is simple and exact: the
  per-part instruction panel can (and does) state precisely how to re-zero. If misalignment in
  practice proves to be a problem, overlap is the natural follow-up — but it shouldn't be built
  speculatively.
- **Multicolor mode + tiling combined.** `compileSVGToGCode`'s multicolor mode groups paths by
  color and inserts `M0` between groups (`gcodeCompiler.js:320-331`); the splitter re-groups
  strokes by *tile*, not by color, so combining the two would require redesigning both grouping
  passes together. Splitting treats its input as a plain monochrome toolpath. A user wanting both
  would need to compile+split per color manually — clunky, but correct, and there's no evidence
  this combination is actually needed yet.
- **Auto-chaining sub-job execution.** Covered in Section 7 — the paper-rearrangement step is
  inherently manual, so there is no "auto-advance" to build.
- **Scaling artwork to fit an integer number of tiles.** The grid is sized to *cover* the bbox
  (`Math.ceil`), so the last row/column of tiles will typically be partially empty — that's fine
  and expected (real paper sizes aren't exact multiples of the bed either).
