# Multi-Part Jobs (Large-Image Splitting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user split a compiled G-code job whose artwork is larger than the bed into a
grid of bed-sized "sub-jobs" saved together as one Multi-Part Job, with a UI to visualize the
grid and run each part sequentially with paper-rearrangement guidance between parts.

**Architecture:** A pure G-code→G-code transform (`gcodeSplitter.js`) parses a compiled job's
toolpath into clippable line segments, computes its drawing bounding box, lays out a grid of
bed-sized tiles over it, clips every drawing segment against each tile rectangle (Liang-Barsky),
reassembles the clipped pieces into continuous per-tile strokes, and re-emits each tile as an
independent, tile-local-coordinate G-code program. Multi-Part Jobs persist as single
`.mjob.json` manifest files (new `file:save-multi-job`/`file:get-multi-jobs` IPC handlers,
mirroring the existing `file:save-job`/`file:get-jobs`), tracked in `JobsContext` alongside (but
structurally separate from) flat-file jobs, and surfaced through a new "Multi-Part" tab in
`GCodeJobsPage` with a dedicated `MultiJobView` component (division diagram + per-part runner).

**Tech Stack:** Plain JS (no new npm dependencies), React 18, Electron IPC, `node --test` for
unit tests (matching `bezier.test.mjs`/`colorMatch.test.mjs` conventions).

**Full design rationale:** see `docs/superpowers/specs/2026-06-08-large-image-job-splitting-design.md`
— this plan implements that spec section by section. Read it first; the "why" behind each
decision below (e.g. why G-code-level splitting, why no tile overlap, why no auto-chaining) is
documented there, not repeated here.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/gcodeSplitter.js` (new) | Pure functions: parse toolpath → compute bounds → plan grid → clip → re-emit sub-jobs. No React/DOM. |
| `src/lib/gcodeSplitter.test.mjs` (new) | Unit tests for every exported function, run via `node --test`. |
| `main.js` (modify) | Add `file:save-multi-job` / `file:get-multi-jobs` IPC handlers next to the existing job handlers. |
| `preload.js` (modify) | Expose `saveMultiJob` / `getMultiJobs` on `window.platform`. |
| `src/contexts/JobsContext.jsx` (modify) | Add `multiJobs` array + `addMultiJob`/`removeMultiJob`, loaded on mount like `loadedFiles`. |
| `src/components/MultiJobView.jsx` + `.css` (new) | Division-diagram + per-part runner UI, shown when a multi-job is selected. |
| `src/pages/Image2GCodePage.jsx` (modify) | Detect oversized compiled jobs; offer "Split into a Multi-Part Job", save via the new IPC, navigate to `/gcode`. |
| `src/pages/GCodeJobsPage.jsx` (modify) | Add a fourth "Multi-Part" tab listing `multiJobs`; render `MultiJobView` for the selected one. |

---

## Task 1: `gcodeSplitter.js` — toolpath parsing & drawing bounds

**Files:**
- Create: `Desktop_App/src/lib/gcodeSplitter.js`
- Create: `Desktop_App/src/lib/gcodeSplitter.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `Desktop_App/src/lib/gcodeSplitter.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { parseToolpathSegments, computeDrawingBounds } from './gcodeSplitter.js';

test('parseToolpathSegments tracks position and pen state across G0/G1/M3/M5', () => {
  const lines = [
    'G21 ; mm units',
    'G0 X10.000 Y10.000',
    'M3 ; tool on',
    'G1 X20.000 Y10.000 F1000',
    'G1 X20.000 Y20.000 F1000',
    'M5 ; tool off',
    'G0 X0.000 Y0.000',
  ];
  const segs = parseToolpathSegments(lines);

  // G21 carries no X/Y — it's not a motion command and produces no segment.
  assert.strictEqual(segs.length, 4);
  assert.deepStrictEqual(segs[0], { from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, drawing: false, feedRate: 0 });
  assert.deepStrictEqual(segs[1], { from: { x: 10, y: 10 }, to: { x: 20, y: 10 }, drawing: true, feedRate: 1000 });
  assert.deepStrictEqual(segs[2], { from: { x: 20, y: 10 }, to: { x: 20, y: 20 }, drawing: true, feedRate: 1000 });
  assert.strictEqual(segs[3].drawing, false); // after M5, the trailing G0 is a rapid
});

test('computeDrawingBounds only considers pen-down (G1, drawing) segments', () => {
  const lines = [
    'G0 X50.000 Y50.000',                // rapid — must not affect bounds
    'M3 ; tool on',
    'G1 X10.000 Y10.000 F1000',
    'G1 X30.000 Y40.000 F1000',
    'M5 ; tool off',
    'G0 X0.000 Y0.000 ; return home',    // rapid to origin — must not pull bounds to (0,0)
  ];
  const bounds = computeDrawingBounds(parseToolpathSegments(lines));
  assert.deepStrictEqual(bounds, { minX: 10, minY: 10, maxX: 50, maxY: 50 });
});

test('computeDrawingBounds returns null when there are no drawing moves', () => {
  const segs = parseToolpathSegments(['G0 X10.000 Y10.000', 'G0 X0.000 Y0.000']);
  assert.strictEqual(computeDrawingBounds(segs), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Desktop_App && node --test src/lib/gcodeSplitter.test.mjs`
Expected: FAIL — `Cannot find module './gcodeSplitter.js'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `parseToolpathSegments` and `computeDrawingBounds`**

Create `Desktop_App/src/lib/gcodeSplitter.js`:

```js
// Pure G-code → G-code transform: splits an oversized compiled job into a
// grid of bed-sized sub-jobs. No React/DOM dependency — testable with `node --test`.
// See docs/superpowers/specs/2026-06-08-large-image-job-splitting-design.md for the
// full design rationale (why G-code-level splitting, why no tile overlap, etc).

const EPSILON = 1e-6;

function pointsEqual(a, b) {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

// Walks `lines`, tracking position and pen state using the mode-agnostic M3/M4
// (tool on) / M5 (tool off) convention gcodeCompiler emits — the same
// recognition GCodePreview.jsx uses (including the legacy M280-angle fallback
// for old saved jobs, so split also works on jobs saved before that switch).
// Returns an ordered list of motion segments, one per G0/G1 line.
export function parseToolpathSegments(lines) {
  const segments = [];
  let cx = 0, cy = 0;
  let drawing = false;
  let feedRate = 0;

  for (const line of lines) {
    const trimmed = line.trim().toUpperCase();
    if (!trimmed || trimmed.startsWith(';')) continue;

    const fMatch = trimmed.match(/F([-\d.]+)/);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const xMatch = trimmed.match(/X([-\d.]+)/);
    const yMatch = trimmed.match(/Y([-\d.]+)/);

    if (!xMatch && !yMatch) {
      if (trimmed.startsWith('M3') || trimmed.startsWith('M4')) {
        drawing = true;
      } else if (trimmed.startsWith('M5')) {
        drawing = false;
      } else if (trimmed.includes('M280') && trimmed.includes('S')) {
        const sMatch = trimmed.match(/S([\d.]+)/);
        if (sMatch) drawing = parseFloat(sMatch[1]) < 60;
      }
      continue;
    }

    const nx = xMatch ? parseFloat(xMatch[1]) : cx;
    const ny = yMatch ? parseFloat(yMatch[1]) : cy;

    if (trimmed.startsWith('G0') || trimmed.startsWith('G1')) {
      segments.push({
        from: { x: cx, y: cy },
        to: { x: nx, y: ny },
        drawing: trimmed.startsWith('G1') && drawing,
        feedRate,
      });
    }

    cx = nx;
    cy = ny;
  }

  return segments;
}

// Bounding box of DRAWING segments only — mirrors the "Drawing bounding box"
// GCodePreview already overlays (GCodePreview.jsx:118-129). Excluding rapids
// (G0) is essential: the "G0 X0 Y0 ; return home" footer every compiled job
// ends with would otherwise pin the bbox to always include the origin.
export function computeDrawingBounds(segments) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const seg of segments) {
    if (!seg.drawing) continue;
    for (const p of [seg.from, seg.to]) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd Desktop_App && node --test src/lib/gcodeSplitter.test.mjs`
Expected: PASS — 3 tests passing (the other test files in the directory aren't picked up by
this single-file invocation; this matches how `bezier.test.mjs` etc. are run per `CLAUDE.md`).

- [ ] **Step 5: Commit**

```bash
git add Desktop_App/src/lib/gcodeSplitter.js Desktop_App/src/lib/gcodeSplitter.test.mjs
git commit -m "feat(gcodesplitter): add toolpath parsing and drawing-bounds calculation"
```

---

## Task 2: `gcodeSplitter.js` — tile grid planning

**Files:**
- Modify: `Desktop_App/src/lib/gcodeSplitter.js`
- Modify: `Desktop_App/src/lib/gcodeSplitter.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `Desktop_App/src/lib/gcodeSplitter.test.mjs` (add the import too):

```js
import { parseToolpathSegments, computeDrawingBounds, planTileGrid } from './gcodeSplitter.js';
```

```js
test('planTileGrid sizes a grid that covers the bounds with bed-sized tiles', () => {
  assert.deepStrictEqual(
    planTileGrid({ minX: 0, minY: 0, maxX: 450, maxY: 90 }, 200, 200),
    { rows: 1, cols: 3, tileW: 200, tileH: 200 }
  );
  assert.deepStrictEqual(
    planTileGrid({ minX: 0, minY: 0, maxX: 50, maxY: 50 }, 200, 200),
    { rows: 1, cols: 1, tileW: 200, tileH: 200 }
  );
  assert.deepStrictEqual(
    planTileGrid({ minX: 100, minY: 50, maxX: 620, maxY: 410 }, 200, 200),
    { rows: 2, cols: 3, tileW: 200, tileH: 200 }
  );
});
```

(Replace the single-symbol import line from Task 1 with the three-symbol one above — don't add
a second `import` line for the same module.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd Desktop_App && node --test src/lib/gcodeSplitter.test.mjs`
Expected: FAIL — `planTileGrid is not a function` (or a `SyntaxError`/`undefined` import error).

- [ ] **Step 3: Implement `planTileGrid`**

Add to `Desktop_App/src/lib/gcodeSplitter.js` (after `computeDrawingBounds`):

```js
// Lays out a grid of bedW × bedH tiles that fully COVERS `bounds` (the artwork's
// drawing bbox), anchored at its bottom-left corner (minX, minY). No overlap,
// no scaling — see the spec's "Out of scope" section for why. The last row/
// column will typically be partially empty; that's expected (real paper sizes
// aren't exact multiples of the bed either).
export function planTileGrid(bounds, bedW, bedH) {
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / bedW));
  const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / bedH));
  return { rows, cols, tileW: bedW, tileH: bedH };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd Desktop_App && node --test src/lib/gcodeSplitter.test.mjs`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add Desktop_App/src/lib/gcodeSplitter.js Desktop_App/src/lib/gcodeSplitter.test.mjs
git commit -m "feat(gcodesplitter): add tile grid planning"
```

---

## Task 3: `gcodeSplitter.js` — Liang-Barsky segment clipping

**Files:**
- Modify: `Desktop_App/src/lib/gcodeSplitter.js`
- Modify: `Desktop_App/src/lib/gcodeSplitter.test.mjs`

- [ ] **Step 1: Write the failing tests**

Update the import line to include `clipSegmentToRect`:

```js
import { parseToolpathSegments, computeDrawingBounds, planTileGrid, clipSegmentToRect } from './gcodeSplitter.js';
```

Append:

```js
test('clipSegmentToRect clips a segment crossing one edge', () => {
  const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const result = clipSegmentToRect({ x: -50, y: 50 }, { x: 50, y: 50 }, rect);
  assert.deepStrictEqual(result, { from: { x: 0, y: 50 }, to: { x: 50, y: 50 } });
});

test('clipSegmentToRect returns the full segment when entirely inside', () => {
  const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const result = clipSegmentToRect({ x: 10, y: 10 }, { x: 90, y: 90 }, rect);
  assert.deepStrictEqual(result, { from: { x: 10, y: 10 }, to: { x: 90, y: 90 } });
});

test('clipSegmentToRect returns null for a segment entirely outside', () => {
  const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  assert.strictEqual(clipSegmentToRect({ x: 200, y: 200 }, { x: 300, y: 300 }, rect), null);
});

test('clipSegmentToRect clips a diagonal segment crossing a corner', () => {
  const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  // Diagonal from (-50,-50) to (150,150) enters at (0,0) and exits at (100,100)
  const result = clipSegmentToRect({ x: -50, y: -50 }, { x: 150, y: 150 }, rect);
  assert.deepStrictEqual(result, { from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Desktop_App && node --test src/lib/gcodeSplitter.test.mjs`
Expected: FAIL — `clipSegmentToRect is not a function`.

- [ ] **Step 3: Implement `clipSegmentToRect` (Liang-Barsky line clipping)**

Add to `Desktop_App/src/lib/gcodeSplitter.js` (after `planTileGrid`):

```js
// Standard Liang-Barsky parametric line-segment clipping against an
// axis-aligned rectangle. Returns the clipped {from, to} sub-segment in the
// same coordinate space as the inputs, or null if the segment doesn't
// intersect `rect` at all. Exported (not just used internally) because correct
// clipping is the trickiest part of this module and deserves direct tests.
export function clipSegmentToRect(p0, p1, rect) {
  let t0 = 0, t1 = 1;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const checks = [
    [-dx, p0.x - rect.minX],
    [dx, rect.maxX - p0.x],
    [-dy, p0.y - rect.minY],
    [dy, rect.maxY - p0.y],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < EPSILON) {
      if (q < 0) return null; // segment is parallel to this edge and outside it
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  if (t0 > t1) return null;
  return {
    from: { x: p0.x + t0 * dx, y: p0.y + t0 * dy },
    to: { x: p0.x + t1 * dx, y: p0.y + t1 * dy },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd Desktop_App && node --test src/lib/gcodeSplitter.test.mjs`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add Desktop_App/src/lib/gcodeSplitter.js Desktop_App/src/lib/gcodeSplitter.test.mjs
git commit -m "feat(gcodesplitter): add Liang-Barsky segment clipping against tile rectangles"
```

---

## Task 4: `gcodeSplitter.js` — full split pipeline

**Files:**
- Modify: `Desktop_App/src/lib/gcodeSplitter.js`
- Modify: `Desktop_App/src/lib/gcodeSplitter.test.mjs`

- [ ] **Step 1: Write the failing tests**

Update the import line to include `splitGCodeIntoTiles`:

```js
import { parseToolpathSegments, computeDrawingBounds, planTileGrid, clipSegmentToRect, splitGCodeIntoTiles } from './gcodeSplitter.js';
```

Append:

```js
test('splitGCodeIntoTiles splits a wide horizontal line into two side-by-side tiles', () => {
  const lines = [
    'G21 ; mm units',
    'G90 ; absolute positioning',
    'F1000',
    'M5 ; tool off',
    'G0 X20.000 Y50.000',
    'M3 ; tool on',
    'G1 X180.000 Y50.000 F1000',
    'M5 ; tool off',
    'G0 X0.000 Y0.000 ; return home',
  ];
  // Drawing spans X 20→180 (160mm) on a 100mm-wide bed — needs 2 columns, 1 row.
  const result = splitGCodeIntoTiles(lines, { bedW: 100, bedH: 100, maxFeedrate: 1000, name: 'Test' });

  assert.deepStrictEqual(result.grid, { rows: 1, cols: 2, tileW: 100, tileH: 100 });
  assert.deepStrictEqual(result.bounds, { minX: 20, minY: 50, maxX: 180, maxY: 50 });
  assert.strictEqual(result.subJobs.length, 2);

  const [part1, part2] = result.subJobs;
  assert.deepStrictEqual({ row: part1.row, col: part1.col }, { row: 0, col: 0 });
  assert.deepStrictEqual({ row: part2.row, col: part2.col }, { row: 0, col: 1 });

  // Part 1 covers tile-local X 0→100 (the first 100mm of the 160mm line)
  assert.ok(part1.lines.includes('G0 X0.000 Y0.000'));
  assert.ok(part1.lines.includes('G1 X100.000 Y0.000 F1000'));
  assert.ok(part1.lines.includes('M3 ; tool on'));
  assert.ok(part1.lines.includes('G0 X0.000 Y0.000 ; return home'));

  // Part 2 covers tile-local X 0→60 (the remaining 60mm)
  assert.ok(part2.lines.includes('G0 X0.000 Y0.000'));
  assert.ok(part2.lines.includes('G1 X60.000 Y0.000 F1000'));

  // Every sub-job's own drawing bounds must fit within the bed — that's the whole point.
  for (const sub of result.subJobs) {
    const subBounds = computeDrawingBounds(parseToolpathSegments(sub.lines));
    assert.ok(subBounds.minX >= -EPSILON_TEST && subBounds.maxX <= 100 + EPSILON_TEST);
    assert.ok(subBounds.minY >= -EPSILON_TEST && subBounds.maxY <= 100 + EPSILON_TEST);
  }
});

test('splitGCodeIntoTiles reassembles a stroke that exits and re-enters the same tile into separate strokes', () => {
  const lines = [
    'G21 ; mm units',
    'G90 ; absolute positioning',
    'F1000',
    'M5 ; tool off',
    // A single continuous zigzag stroke spanning two 100mm-wide tiles
    // (X 40→160, crossing the col0/col1 boundary at x=140 three times).
    // In tile 0 ([40,140] x [30,130]) this must be reassembled into TWO
    // separate strokes: the path leaves tile 0 after the first segment and
    // re-enters partway through the second — you can't draw through that gap.
    'G0 X40.000 Y30.000',
    'M3 ; tool on',
    'G1 X160.000 Y30.000 F1000',
    'G1 X40.000 Y70.000 F1000',
    'G1 X160.000 Y70.000 F1000',
    'M5 ; tool off',
    'G0 X0.000 Y0.000 ; return home',
  ];
  const result = splitGCodeIntoTiles(lines, { bedW: 100, bedH: 100, maxFeedrate: 1000, name: 'Test' });

  // bounds: X 40→160 (120mm → 2 cols), Y 30→70 (40mm → 1 row)
  assert.deepStrictEqual(result.grid, { rows: 1, cols: 2, tileW: 100, tileH: 100 });
  assert.strictEqual(result.subJobs.length, 2);

  const tile0 = result.subJobs.find(s => s.row === 0 && s.col === 0);
  assert.ok(tile0, 'expected a sub-job for row 0, col 0');

  // Hand-traced: clipping the 3-segment zigzag against tile 0's rect
  // ([40,140] x [30,130]) yields polyline [(40,30)→(140,30)] (the first
  // segment exits exactly at the tile's right edge), then a SEPARATE polyline
  // [(140,36.667)→(40,70)→(140,70)] (the path re-enters mid-segment at a
  // different point, breaking continuity). Two disjoint strokes → two M3/M5 pairs.
  const m3Count = tile0.lines.filter(l => l === 'M3 ; tool on').length;
  const m5Count = tile0.lines.filter(l => l === 'M5 ; tool off').length;
  assert.strictEqual(m3Count, 2);
  assert.strictEqual(m5Count, 3); // header M5, plus one M5 closing each of the two strokes
});

test('splitGCodeIntoTiles throws on a job with no drawable paths', () => {
  const lines = ['G21 ; mm units', 'G0 X10.000 Y10.000', 'G0 X0.000 Y0.000'];
  assert.throws(
    () => splitGCodeIntoTiles(lines, { bedW: 100, bedH: 100 }),
    /No drawable paths/
  );
});
```

Add this constant near the top of the test file (alongside the imports) — it gives the
floating-point bound checks in the first test a tiny tolerance for `toFixed(3)` rounding:

```js
const EPSILON_TEST = 1e-6;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Desktop_App && node --test src/lib/gcodeSplitter.test.mjs`
Expected: FAIL — `splitGCodeIntoTiles is not a function`.

- [ ] **Step 3: Implement the reassembly, emission, and `splitGCodeIntoTiles`**

Add to `Desktop_App/src/lib/gcodeSplitter.js` (after `clipSegmentToRect`):

```js
function tileRect(bounds, grid, row, col) {
  const minX = bounds.minX + col * grid.tileW;
  const minY = bounds.minY + row * grid.tileH;
  return { minX, minY, maxX: minX + grid.tileW, maxY: minY + grid.tileH };
}

// Walks the original toolpath in order and, for one tile rectangle, regroups
// the clipped drawing portions into continuous strokes (polylines). A single
// original stroke that exits and re-enters the tile must become SEPARATE
// strokes here — you cannot draw through a gap where there's no paper under
// the pen. See the spec (Section 4) for the continuity rule this implements:
// consecutive clipped pieces merge only when one's end point matches the
// next's start point; anything else starts a fresh stroke.
function reassembleStrokes(segments, rect) {
  const strokes = [];
  let current = null;

  const finish = () => { if (current) { strokes.push(current); current = null; } };

  for (const seg of segments) {
    if (!seg.drawing) { finish(); continue; }

    const clipped = clipSegmentToRect(seg.from, seg.to, rect);
    if (!clipped) { finish(); continue; }

    if (current && pointsEqual(current[current.length - 1], clipped.from)) {
      current.push(clipped.to);
    } else {
      finish();
      current = [clipped.from, clipped.to];
    }
  }
  finish();
  return strokes;
}

function toLocal(point, rect) {
  return { x: point.x - rect.minX, y: point.y - rect.minY };
}

// Emits one tile's complete, independent G-code program: header, the
// reassembled strokes (each its own G0-rapid / M3 / G1... / M5 sequence in
// TILE-LOCAL coordinates — mirrors gcodeCompiler.generatePathGcode's
// pen-up/down structure, gcodeCompiler.js:285-316), and the standard footer.
function emitSubJobLines(strokes, rect, maxFeedrate, header) {
  const lines = [
    header,
    'G21 ; mm units',
    'G90 ; absolute positioning',
    `F${maxFeedrate}`,
    'M5 ; tool off',
  ];

  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    const start = toLocal(stroke[0], rect);
    lines.push(`G0 X${start.x.toFixed(3)} Y${start.y.toFixed(3)}`);
    lines.push('M3 ; tool on');
    for (let i = 1; i < stroke.length; i++) {
      const p = toLocal(stroke[i], rect);
      lines.push(`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)} F${maxFeedrate}`);
    }
    lines.push('M5 ; tool off');
  }

  lines.push('G0 X0.000 Y0.000 ; return home');
  return lines;
}

// Splits a compiled G-code job whose drawing exceeds the bed into a grid of
// bed-sized sub-jobs. Each sub-job is a complete, independent G-code program
// in TILE-LOCAL coordinates — i.e. it assumes machine (0,0) is that tile's
// bottom-left corner on a freshly-positioned, freshly-zeroed sheet (the
// operator MUST re-zero between parts; see the spec's Section 7).
//
// Returns { grid, bounds, subJobs } where subJobs is ordered in DISPLAY order
// (reading order: top-left to bottom-right, row by row — Part 1, Part 2, …)
// regardless of machine-coordinate row numbering (row 0 = bottom in machine
// space, since machine Y grows upward).
export function splitGCodeIntoTiles(lines, settings = {}) {
  const { bedW = 200, bedH = 200, maxFeedrate = 1000, name = 'Multi-Part Job' } = settings;

  const segments = parseToolpathSegments(lines);
  const bounds = computeDrawingBounds(segments);
  if (!bounds) {
    throw new Error('No drawable paths found — cannot split an empty job.');
  }

  const grid = planTileGrid(bounds, bedW, bedH);
  const total = grid.rows * grid.cols;
  const subJobs = [];

  for (let displayRow = 0; displayRow < grid.rows; displayRow++) {
    const row = grid.rows - 1 - displayRow; // displayRow 0 (shown first) = topmost = highest machine row
    for (let col = 0; col < grid.cols; col++) {
      const rect = tileRect(bounds, grid, row, col);
      const strokes = reassembleStrokes(segments, rect);
      const partNum = displayRow * grid.cols + col + 1;
      const header = `; Generated by Platform Control — Multi-Part Job "${name}" — Part ${partNum} of ${total} (row ${row}, col ${col})`;
      subJobs.push({ row, col, lines: emitSubJobLines(strokes, rect, maxFeedrate, header) });
    }
  }

  return { grid, bounds, subJobs };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd Desktop_App && node --test src/lib/gcodeSplitter.test.mjs`
Expected: PASS — 11 tests passing.

- [ ] **Step 5: Commit**

```bash
git add Desktop_App/src/lib/gcodeSplitter.js Desktop_App/src/lib/gcodeSplitter.test.mjs
git commit -m "feat(gcodesplitter): add full split pipeline with stroke reassembly and re-emission"
```

---

## Task 5: Persist Multi-Part Jobs — main-process IPC

**Files:**
- Modify: `Desktop_App/main.js`
- Modify: `Desktop_App/preload.js`

- [ ] **Step 1: Add the IPC handlers to `main.js`**

Open `Desktop_App/main.js`. Find the `file:open-jobs-folder` handler (around line 289-296):

```js
ipcMain.handle('file:open-jobs-folder', async () => {
  try {
    await shell.openPath(jobsDir);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
```

Immediately after it (still before the `// ── IPC: Settings persistence` comment block), add:

```js
// ── IPC: Multi-Part Jobs (large-image splitting) ──────────────────────────────
//
// Persisted as single self-contained .mjob.json manifest files in the same
// jobsDir as flat .gcode jobs — "one file = one job" avoids partial-write/
// orphan-file bookkeeping across N sub-job files + an index. See
// docs/superpowers/specs/2026-06-08-large-image-job-splitting-design.md Section 6.

ipcMain.handle('file:save-multi-job', async (_event, name, manifest) => {
  try {
    const sanitizedName = name.replace(/[^a-z0-9_-]/gi, '_');
    const fileName = `${sanitizedName}-${Date.now()}.mjob.json`;
    const filePath = path.join(jobsDir, fileName);
    const job = { ...manifest, name, path: filePath };
    fs.writeFileSync(filePath, JSON.stringify(job, null, 2), 'utf-8');
    return { success: true, job };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('file:get-multi-jobs', async () => {
  try {
    const files = fs.readdirSync(jobsDir);
    const jobs = [];
    for (const file of files) {
      if (file.endsWith('.mjob.json')) {
        const filePath = path.join(jobsDir, file);
        try {
          const manifest = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          jobs.push({ ...manifest, path: filePath });
        } catch (parseErr) {
          console.warn(`Skipping malformed multi-job file ${file}:`, parseErr.message);
        }
      }
    }
    return { success: true, jobs };
  } catch (err) {
    return { success: false, error: err.message, jobs: [] };
  }
});
```

- [ ] **Step 2: Expose the new IPC calls in `preload.js`**

Open `Desktop_App/preload.js`. Find this block (lines 15-17):

```js
  saveJob: (name, lines) => ipcRenderer.invoke('file:save-job', name, lines),
  getJobs: () => ipcRenderer.invoke('file:get-jobs'),
  openJobsFolder: () => ipcRenderer.invoke('file:open-jobs-folder'),
```

Add two lines immediately after `openJobsFolder`:

```js
  saveJob: (name, lines) => ipcRenderer.invoke('file:save-job', name, lines),
  getJobs: () => ipcRenderer.invoke('file:get-jobs'),
  openJobsFolder: () => ipcRenderer.invoke('file:open-jobs-folder'),
  saveMultiJob: (name, manifest) => ipcRenderer.invoke('file:save-multi-job', name, manifest),
  getMultiJobs: () => ipcRenderer.invoke('file:get-multi-jobs'),
```

- [ ] **Step 3: Manually verify the app still starts cleanly**

Run: `cd Desktop_App && npm run electron:dev`
Expected: the app launches to the Dashboard with no console errors. (`getMultiJobs` isn't called
by any UI yet — Task 6 wires that up — this step just confirms the IPC registration didn't
break startup, e.g. a syntax error in the handler block.) Close the app when confirmed.

- [ ] **Step 4: Commit**

```bash
git add Desktop_App/main.js Desktop_App/preload.js
git commit -m "feat(jobs): add file:save-multi-job / file:get-multi-jobs IPC handlers"
```

---

## Task 6: `JobsContext` — multi-job state

**Files:**
- Modify: `Desktop_App/src/contexts/JobsContext.jsx`

- [ ] **Step 1: Add `multiJobs` state, loading, and helpers**

Open `Desktop_App/src/contexts/JobsContext.jsx`. Replace its entire contents with:

```jsx
import React, { createContext, useContext, useState, useEffect } from 'react';

const JobsContext = createContext(null);

export function useJobs() {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobs must be used within JobsProvider');
  return ctx;
}

export function JobsProvider({ children }) {
  const [loadedFiles, setLoadedFiles] = useState([]);
  const [multiJobs, setMultiJobs] = useState([]);

  useEffect(() => {
    async function loadJobs() {
      const result = await window.platform.getJobs();
      if (result && result.success) {
        setLoadedFiles(prev => {
          const newFiles = [...prev];
          result.jobs.forEach(job => {
            if (!newFiles.some(f => f.path === job.path)) {
              newFiles.push(job);
            }
          });
          return newFiles;
        });
      }
    }
    loadJobs();
  }, []);

  useEffect(() => {
    async function loadMultiJobs() {
      const result = await window.platform.getMultiJobs();
      if (result && result.success) {
        setMultiJobs(prev => {
          const next = [...prev];
          result.jobs.forEach(job => {
            if (!next.some(j => j.path === job.path)) {
              next.push(job);
            }
          });
          return next;
        });
      }
    }
    loadMultiJobs();
  }, []);

  const addLoadedFile = (file) => {
    setLoadedFiles(prev => {
      if (prev.some(f => f.path === file.path)) return prev;
      return [...prev, file];
    });
  };

  const removeLoadedFile = (path) => {
    setLoadedFiles(prev => prev.filter(f => f.path !== path));
  };

  const addMultiJob = (job) => {
    setMultiJobs(prev => {
      if (prev.some(j => j.path === job.path)) return prev;
      return [...prev, job];
    });
  };

  // In-memory removal only — matches removeLoadedFile's documented convention
  // ("Delete removes from context, not disk"); the user can delete the
  // underlying .mjob.json via "Open Jobs Folder".
  const removeMultiJob = (path) => {
    setMultiJobs(prev => prev.filter(j => j.path !== path));
  };

  const value = {
    loadedFiles, addLoadedFile, removeLoadedFile,
    multiJobs, addMultiJob, removeMultiJob,
  };

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}
```

- [ ] **Step 2: Manually verify**

Run: `cd Desktop_App && npm run electron:dev`
Expected: app launches normally (no console errors about `multiJobs`/`getMultiJobs` —
`getMultiJobs` returns `{ success: true, jobs: [] }` on a fresh install since no `.mjob.json`
files exist yet). Close the app when confirmed.

- [ ] **Step 3: Commit**

```bash
git add Desktop_App/src/contexts/JobsContext.jsx
git commit -m "feat(jobs): track multi-part jobs in JobsContext alongside flat-file jobs"
```

---

## Task 7: `MultiJobView` component

**Files:**
- Create: `Desktop_App/src/components/MultiJobView.jsx`
- Create: `Desktop_App/src/components/MultiJobView.css`

- [ ] **Step 1: Create the component**

Create `Desktop_App/src/components/MultiJobView.jsx`:

```jsx
import React, { useState, useEffect } from 'react';
import { useSerial } from '../contexts/SerialContext';
import GCodePreview from './GCodePreview';
import './MultiJobView.css';

// Division-diagram + per-part runner for a Multi-Part Job. `job` is one entry
// from JobsContext.multiJobs: { name, grid: {rows, cols, tileW, tileH},
// bounds, subJobs: [{row, col, lines}], ... } — subJobs is already ordered in
// DISPLAY order (Part 1 = top-left, reading order; see gcodeSplitter.js).
//
// "Done" here is a lightweight, session-local progress cue (reset whenever a
// different job is selected) — NOT a durable record. jobHistory (SerialContext)
// is the durable record of what actually ran; this is just "what have I clicked
// Start on so far in this sitting", to help the operator track their place.
export default function MultiJobView({ job, bedW, bedH, softLimitMargin }) {
  const { connected, streaming, startStreaming } = useSerial();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [doneIndices, setDoneIndices] = useState(() => new Set());

  useEffect(() => {
    setSelectedIndex(0);
    setDoneIndices(new Set());
  }, [job.path]);

  const total = job.subJobs.length;
  const selected = job.subJobs[selectedIndex];
  const partNum = selectedIndex + 1;

  const handleStart = () => {
    if (!selected || selected.lines.length === 0) return;
    startStreaming(selected.lines, `${job.name} — Part ${partNum} of ${total}`);
    setDoneIndices(prev => new Set(prev).add(selectedIndex));
  };

  return (
    <div className="multijob-view">
      <div className="multijob-grid-panel">
        <h3 className="multijob-section-title">How this drawing is divided</h3>
        <p className="multijob-grid-caption">
          {job.grid.rows} × {job.grid.cols} parts — each plotted on its own sheet
          ({job.grid.tileW} × {job.grid.tileH} mm)
        </p>
        <div
          className="multijob-grid"
          style={{ gridTemplateColumns: `repeat(${job.grid.cols}, 1fr)`, gridTemplateRows: `repeat(${job.grid.rows}, 1fr)` }}
        >
          {job.subJobs.map((sub, i) => (
            <button
              key={`${sub.row}-${sub.col}`}
              className={`multijob-cell${i === selectedIndex ? ' active' : ''}${doneIndices.has(i) ? ' done' : ''}`}
              onClick={() => setSelectedIndex(i)}
              title={`Part ${i + 1} of ${total} (row ${sub.row}, col ${sub.col})`}
            >
              <span className="multijob-cell-num">{i + 1}</span>
              {doneIndices.has(i) && <span className="multijob-cell-check">✓</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="multijob-run-panel">
        <h3 className="multijob-section-title">Part {partNum} of {total}</h3>
        <div className="multijob-preview">
          <GCodePreview lines={selected.lines} bedW={bedW} bedH={bedH} softLimitMargin={softLimitMargin} />
        </div>
        <ol className="multijob-instructions">
          {partNum > 1 && (
            <li>Remove the finished sheet for Part {partNum - 1}.</li>
          )}
          <li>Place a fresh sheet{partNum > 1 ? ' in the next position' : ''}.</li>
          <li>
            <strong>Re-establish the origin on this new sheet</strong> — Home the machine, then
            Set Zero at this sheet's bottom-left corner (or jog to your reference mark and Set
            Zero there). Every part assumes machine (0, 0) is its sheet's corner; skipping this
            will draw the part in the wrong place.
          </li>
          <li>Click <strong>Start Part {partNum}</strong> below.</li>
        </ol>
        <button
          className="btn btn-success"
          onClick={handleStart}
          disabled={!connected || streaming || !selected || selected.lines.length === 0}
        >
          ▶ Start Part {partNum}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the stylesheet**

Create `Desktop_App/src/components/MultiJobView.css`:

```css
.multijob-view {
  display: flex;
  gap: 1rem;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.multijob-grid-panel,
.multijob-run-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-y: auto;
  padding: 0.25rem;
}

.multijob-grid-panel { flex: 0 0 280px; }
.multijob-run-panel { flex: 1; }

.multijob-section-title {
  margin: 0 0 0.4rem 0;
  font-size: 0.95rem;
  color: var(--text-primary);
}

.multijob-grid-caption {
  margin: 0 0 0.75rem 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.multijob-grid {
  display: grid;
  gap: 4px;
  aspect-ratio: 1;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px;
}

.multijob-cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-family: var(--font-mono);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.multijob-cell:hover { color: var(--text-primary); border-color: var(--accent); }

.multijob-cell.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.multijob-cell.done:not(.active) {
  border-color: var(--success);
  color: var(--success);
}

.multijob-cell-check {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 0.7rem;
}

.multijob-preview {
  display: flex;
  justify-content: center;
  margin-bottom: 0.75rem;
}

.multijob-instructions {
  margin: 0 0 1rem 0;
  padding-left: 1.25rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.multijob-instructions strong { color: var(--text-primary); }
```

- [ ] **Step 3: Commit**

```bash
git add Desktop_App/src/components/MultiJobView.jsx Desktop_App/src/components/MultiJobView.css
git commit -m "feat(jobs): add MultiJobView division-diagram and per-part runner UI"
```

---

## Task 8: Wire up the split entry point in `Image2GCodePage`

**Files:**
- Modify: `Desktop_App/src/pages/Image2GCodePage.jsx`

- [ ] **Step 1: Import the splitter and add oversize-detection state**

Open `Desktop_App/src/pages/Image2GCodePage.jsx`. Add to the imports near the top (after the
existing `import { compileSVGToGCode } from '../lib/gcodeCompiler';` on line 12):

```js
import { compileSVGToGCode } from '../lib/gcodeCompiler';
import { splitGCodeIntoTiles, parseToolpathSegments, computeDrawingBounds } from '../lib/gcodeSplitter';
```

Add to imports — extend the existing `useJobs` destructuring (line 20) to also pull
`addMultiJob`:

```js
  const { addLoadedFile, addMultiJob } = useJobs();
```

Add new state alongside `compileWarning` (after line 38, `const [compileWarning, ...] = ...`):

```js
  const [oversizeInfo, setOversizeInfo] = React.useState(null); // null | { width, height, bounds }
```

- [ ] **Step 2: Detect oversized drawings inside `handleCompile`**

In `handleCompile` (around line 81-83), find this exact 3-line block:

```js
      setCompiledGCode(lines);
      setCompileError('');
      const violations = scanGCodeBounds(lines, {
```

Replace it with (the oversize check runs first, then the original three lines follow unchanged):

```js
      const drawingBounds = computeDrawingBounds(parseToolpathSegments(lines));
      if (drawingBounds) {
        const width = drawingBounds.maxX - drawingBounds.minX;
        const height = drawingBounds.maxY - drawingBounds.minY;
        setOversizeInfo(
          (width > bedW || height > bedH)
            ? { width, height, bounds: drawingBounds }
            : null
        );
      } else {
        setOversizeInfo(null);
      }

      setCompiledGCode(lines);
      setCompileError('');
      const violations = scanGCodeBounds(lines, {
```

Also clear `oversizeInfo` whenever a new image/drawing is loaded — find the existing effect at
line 49-51:

```js
  useEffect(() => {
    setCompileWarning(null);
  }, [tracedSVG]);
```

Change it to also reset oversize info:

```js
  useEffect(() => {
    setCompileWarning(null);
    setOversizeInfo(null);
  }, [tracedSVG]);
```

- [ ] **Step 3: Add the split handler**

Add a new callback right after `performSaveJob` (after line 114, the closing `}, [compiledGCode, addLoadedFile, navigate, closeDialog]);`):

```js
  const performSplitJob = useCallback(async (name) => {
    try {
      const result = splitGCodeIntoTiles(compiledGCode, {
        bedW, bedH,
        maxFeedrate: settings?.maxFeedrate || 1000,
        name,
      });
      const manifest = {
        version: 1,
        type: 'multi-job',
        createdAt: Date.now(),
        grid: result.grid,
        bounds: result.bounds,
        subJobs: result.subJobs,
      };
      const saved = await window.platform.saveMultiJob(name, manifest);
      if (saved && saved.success) {
        addMultiJob(saved.job);
        navigate('/gcode');
      } else {
        setDialog({
          open: true,
          mode: 'alert',
          title: 'Split Failed',
          message: `Failed to save multi-part job: ${saved?.error || 'Unknown error'}`,
          confirmLabel: 'OK',
          onConfirm: closeDialog,
          onCancel: closeDialog,
        });
      }
    } catch (err) {
      setDialog({
        open: true,
        mode: 'alert',
        title: 'Split Failed',
        message: `Could not split this drawing: ${err.message}`,
        confirmLabel: 'OK',
        onConfirm: closeDialog,
        onCancel: closeDialog,
      });
    }
  }, [compiledGCode, bedW, bedH, settings, addMultiJob, navigate, closeDialog]);

  const handleSplitJob = useCallback(() => {
    if (compiledGCode.length === 0) return;
    const defaultName = `Large Job ${new Date().toTimeString().slice(0, 8)}`;
    setDialog({
      open: true,
      mode: 'prompt',
      title: 'Split into a Multi-Part Job',
      message: 'Enter a name for this multi-part job:',
      defaultValue: defaultName,
      confirmLabel: 'Split & Save',
      onConfirm: (name) => {
        closeDialog();
        if (!name || !name.trim()) return;
        performSplitJob(name.trim());
      },
      onCancel: closeDialog,
    });
  }, [compiledGCode, closeDialog, performSplitJob]);
```

- [ ] **Step 4: Render the oversize banner in the G-Code Outline tab**

In the JSX, find the `outline-tab-info` block (around lines 199-208):

```jsx
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
```

Add an oversize banner immediately after this `</div>` (still inside `.outline-tab`, before
`.outline-tab-preview`):

```jsx
              {oversizeInfo && (
                <div className="outline-oversize-banner">
                  <span>
                    ⚠ This drawing is {oversizeInfo.width.toFixed(0)} × {oversizeInfo.height.toFixed(0)} mm
                    — larger than your {bedW} × {bedH} mm bed.
                  </span>
                  <button className="btn btn-secondary btn-sm" onClick={handleSplitJob}>
                    Split into a Multi-Part Job →
                  </button>
                </div>
              )}
```

- [ ] **Step 5: Add the banner's stylesheet rules**

Open `Desktop_App/src/pages/Image2GCodePage.css`. Find the closing brace of `.outline-tab-preview`
(line 140) — it's immediately followed by the `/* ── Drawer tab ── */` section comment (line 142).
Insert the new rule between them, right after line 140's `}`:

```css
.outline-oversize-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  max-width: 640px;
  background: rgba(255, 200, 0, 0.12);
  border: 1px solid rgba(255, 200, 0, 0.4);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
```

- [ ] **Step 6: Manually verify**

Run: `cd Desktop_App && npm run electron:dev`. Navigate to Image to G-Code → Draw & Finalize,
draw something, then in Settings temporarily lower `bedMaxX`/`bedMaxY` (e.g. to 50×50mm) so a
normal-sized drawing counts as "oversized" — or just draw something larger than the default
200×200 bed using the rectangle tool stretched past the bed-boundary overlay. Compile it, switch
to the G-Code Outline tab.
Expected: the oversize banner appears with the correct dimensions; clicking
"Split into a Multi-Part Job →" opens the name-prompt dialog; confirming navigates to
`/gcode` (Task 9 makes the result visible there). Restore your bed settings afterward.

- [ ] **Step 7: Commit**

```bash
git add Desktop_App/src/pages/Image2GCodePage.jsx Desktop_App/src/pages/Image2GCodePage.css
git commit -m "feat(image2gcode): detect oversized drawings and offer to split into a multi-part job"
```

---

## Task 9: "Multi-Part" tab in `GCodeJobsPage`

**Files:**
- Modify: `Desktop_App/src/pages/GCodeJobsPage.jsx`

> No CSS changes needed — the new tab reuses the existing `.file-list`/`.file-item`/
> `.file-name`/`.file-size`/`.preview-placeholder` classes verbatim (confirmed present and
> used identically by the Loaded/History tabs at `GCodeJobsPage.jsx:209-250`).

- [ ] **Step 1: Import `MultiJobView` and pull `multiJobs` from context**

Open `Desktop_App/src/pages/GCodeJobsPage.jsx`. Add to imports (after line 7,
`import { FileUp, FolderOpen } from 'lucide-react';`):

```js
import MultiJobView from '../components/MultiJobView';
```

Change the `useJobs` destructuring (line 42) from:

```js
  const { loadedFiles, addLoadedFile, removeLoadedFile } = useJobs();
```

to:

```js
  const { loadedFiles, addLoadedFile, removeLoadedFile, multiJobs } = useJobs();
```

- [ ] **Step 2: Add multi-job selection state**

Add alongside the other `useState` declarations (after line 49,
`const [boundsWarning, setBoundsWarning] = useState(null);`):

```js
  const [selectedMultiJob, setSelectedMultiJob] = useState(null);
```

- [ ] **Step 3: Add the "Multi-Part" tab button**

In the tab bar JSX, find the History tab button (lines 159-165):

```jsx
            <button
              className={`gcode-tab ${tab === 'history' ? 'active' : ''}`}
              onClick={() => { setTab('history'); setBoundsWarning(null); }}
            >
              History
              <span className="tab-count">{jobHistory.length}</span>
            </button>
```

Add a new tab button immediately after it (before the `<div style={{ marginLeft: 'auto', ...`):

```jsx
            <button
              className={`gcode-tab ${tab === 'multipart' ? 'active' : ''}`}
              onClick={() => { setTab('multipart'); setBoundsWarning(null); setSelectedFile(null); setPreviewLines([]); }}
            >
              Multi-Part
              <span className="tab-count">{multiJobs.length}</span>
            </button>
```

- [ ] **Step 4: Render the Multi-Part file list**

Add a new tab-content block immediately after the `{tab === 'history' && ( ... )}` block
(after line 272, the closing `)}`):

```jsx
          {tab === 'multipart' && (
            <div className="file-list">
              {multiJobs.length === 0 ? (
                <div className="file-item" style={{ justifyContent: 'center' }}>
                  <span className="file-name" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    No multi-part jobs yet — split an oversized drawing from the Image to G-Code page
                  </span>
                </div>
              ) : (
                multiJobs.map(job => {
                  const isSelected = selectedMultiJob?.path === job.path;
                  return (
                    <div
                      key={job.path}
                      className={`file-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedMultiJob(job)}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                        <span className="file-name">{job.name}</span>
                        <span className="file-size">{job.grid.rows * job.grid.cols} parts · {job.grid.rows}×{job.grid.cols} grid</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
```

- [ ] **Step 5: Render `MultiJobView` instead of `GCodePreview` when on the Multi-Part tab**

Find the right-panel `<div className="card gcode-preview-card">` opening (line 305). The whole
right panel currently always renders the standard preview/list. Change its contents to branch on
`tab === 'multipart'`. Replace the entire right-panel `<div className="card gcode-preview-card">
... </div>` block (lines 305-393) with:

```jsx
        <div className="card gcode-preview-card">
          {tab === 'multipart' ? (
            selectedMultiJob ? (
              <MultiJobView
                job={selectedMultiJob}
                bedW={settings.bedMaxX ?? 200}
                bedH={settings.bedMaxY ?? 200}
                softLimitMargin={settings.softLimitMargin ?? 10}
              />
            ) : (
              <div className="preview-placeholder">Select a multi-part job to view its division and run its parts</div>
            )
          ) : (
            <>
              <div className="preview-header">
                <h2 className="section-header" style={{ margin: 0 }}>
                  G-Code Preview
                  {selectedFile && <span className="preview-filename"> — {selectedFile.name}</span>}
                </h2>
                {streaming && (
                  <div className="preview-nav-buttons">
                    <button className="btn btn-sm btn-ghost" onClick={scrollToExecuting}>
                      ↑ Executing
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={scrollToLastDone}>
                      ↑ Last Done
                    </button>
                  </div>
                )}
              </div>
              {boundsWarning && (
                <div style={{
                  background: 'rgba(255, 200, 0, 0.12)',
                  border: '1px solid rgba(255, 200, 0, 0.4)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  marginBottom: '8px',
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                }}>
                  ⚠ {boundsWarning.count} line{boundsWarning.count !== 1 ? 's' : ''} outside safe working margin — out-of-bounds moves will be skipped at runtime
                </div>
              )}
              <div className="gcode-preview" ref={previewRef}>
                {previewLines.length === 0 ? (
                  <div className="preview-placeholder">Select a file to preview its G-code content</div>
                ) : (
                  previewLines.map((line, i) => {
                    const status = getLineStatus(i);
                    const cmd = streamCommandMap.get(i);
                    return (
                      <div
                        key={i}
                        data-line={i}
                        className={`preview-line${status ? ` status-${status}` : ''}`}
                        onMouseEnter={(e) => {
                          if (!cmd || cmd.status === 'queued') return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoveredCmd({ cmd, x: rect.right + 8, y: rect.top });
                        }}
                        onMouseLeave={() => setHoveredCmd(null)}
                      >
                        <span className="line-number">{i + 1}</span>
                        <span className="line-content">{line}</span>
                      </div>
                    );
                  })
                )}
              </div>

              {hoveredCmd && (
                <div
                  className="preview-tooltip"
                  style={{ position: 'fixed', left: hoveredCmd.x, top: hoveredCmd.y, zIndex: 1000 }}
                >
                  <div className="tooltip-cmd">{hoveredCmd.cmd.cmd}</div>
                  <div className="tooltip-row">
                    <span>Sent:</span><span>{formatTimestamp(hoveredCmd.cmd.sentAt)}</span>
                  </div>
                  {hoveredCmd.cmd.ackedAt ? (
                    <>
                      <div className="tooltip-row">
                        <span>Acked:</span><span>{formatTimestamp(hoveredCmd.cmd.ackedAt)}</span>
                      </div>
                      <div className="tooltip-row">
                        <span>Duration:</span><span>{hoveredCmd.cmd.duration}ms</span>
                      </div>
                    </>
                  ) : (
                    <div className="tooltip-row">
                      <span>Acked:</span><span className="tooltip-pending">Pending…</span>
                    </div>
                  )}
                  {hoveredCmd.cmd.response && hoveredCmd.cmd.response.length > 0 && (
                    <div className="tooltip-row">
                      <span>Response:</span>
                      <span>{hoveredCmd.cmd.response.join(' | ')}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
```

- [ ] **Step 6: Make sure switching away from "Multi-Part" clears its selection state cleanly**

The other three tab buttons already call `setBoundsWarning(null)`. Extend each of their
`onClick` handlers to also clear the multi-job selection, so stale state doesn't linger when
the operator tabs back and forth. Update all three (Built-in, Loaded, History — lines 147, 154,
161 originally):

```jsx
              onClick={() => { setTab('builtin'); setBoundsWarning(null); setSelectedMultiJob(null); }}
```
```jsx
              onClick={() => { setTab('loaded'); setBoundsWarning(null); setSelectedMultiJob(null); }}
```
```jsx
              onClick={() => { setTab('history'); setBoundsWarning(null); setSelectedMultiJob(null); }}
```

- [ ] **Step 7: Manually verify**

Run: `cd Desktop_App && npm run electron:dev`. After completing Task 8's manual verification
(which produces a saved multi-part job), navigate to G-Code Jobs → Multi-Part tab.
Expected: the split job appears in the list with its `RxC grid` badge; selecting it shows the
`MultiJobView` (division diagram on the left, selected part's preview + instructions + Start
button on the right); clicking different grid cells changes the selected part and its preview;
"Start Part N" is disabled while disconnected (per `!connected`) and enabled once connected to
a (real or simulated) port.

- [ ] **Step 8: Commit**

```bash
git add Desktop_App/src/pages/GCodeJobsPage.jsx
git commit -m "feat(jobs): add Multi-Part tab with division view and per-part runner"
```

---

## Task 10: Full build & test suite

**Files:** none (verification only)

- [ ] **Step 1: Run every unit test file**

Run, one at a time (matching the project's documented per-file convention):
```bash
cd Desktop_App
node --test src/lib/bezier.test.mjs
node --test src/lib/colorMatch.test.mjs
node --test src/lib/imageBinarize.test.mjs
node --test src/lib/gcodeSplitter.test.mjs
```
Expected: PASS for all four files, with `gcodeSplitter.test.mjs` showing 11 passing tests.

- [ ] **Step 2: Run the production build**

Run: `cd Desktop_App && npm run build`
Expected: Vite build completes with no errors (matches the "1827 modules" baseline from the
Cluster C verification — module count will increase slightly with the two new files).

- [ ] **Step 3: Final manual end-to-end smoke test**

Run: `cd Desktop_App && npm run electron:dev`
Walk through the full flow once more end to end:
1. Image to G-Code → draw or trace something larger than the bed → Compile Job
2. See the oversize banner on the G-Code Outline tab → Split into a Multi-Part Job → name it → confirm
3. Land on G-Code Jobs → Multi-Part tab → see the new job listed
4. Select it → verify the division diagram matches the grid (e.g. a 2×1 split shows two cells
   numbered 1 and 2) → click each cell → verify its G-code preview changes and stays within
   the bed boundary (no soft-limit warnings on any individual part — that's the proof the split
   actually fits each piece onto one sheet)

- [ ] **Step 4: Commit (only if Step 3 surfaced fixes)**

If the smoke test required any tweaks, stage and commit them with a message describing what was
fixed (e.g. `fix(jobs): correct multi-part tab selection clearing`). If everything worked as
written, there's nothing to commit here — the feature is complete as of Task 9's commit.
