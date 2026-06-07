# Image2GCode: Dialogs, Three-Tab Layout & Tracing Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace native browser dialogs with an in-app `Dialog` component, restructure `Image2GCodePage` into three tabs (Import & Trace / Draw & Finalize / G-Code Outline), and fix image tracing so brightness-threshold parameters behave deterministically (binarization + corner-sampled background detection + real curve tessellation).

**Architecture:** Three independent slices, ordered so each leaves the app in a working state: (1) a reusable `Dialog` component wired into the two `window.prompt/alert/confirm` call sites, (2) three small dependency-free utility modules (`colorMatch`, `bezier`, `imageBinarize`) with `node --test` coverage, consumed by `gcodeCompiler.js` and `useImageTracer.js` to fix the tracing pipeline, and (3) the three-tab page restructure that promotes `GCodePreview` to a dedicated full-size tab. Pure-logic utilities get unit tests; React/DOM-coupled changes get manual verification via the running Electron app (no component test framework exists in this repo — see spec's "Out of Scope").

**Tech Stack:** Electron 28 + React 18 + Vite 6, React Context API, Web Workers (`imagetracerjs`), `svg-path-parser`, Node's built-in `node --test` runner with `.test.mjs` files.

**Reference spec:** `docs/superpowers/specs/2026-06-07-image2gcode-tracing-and-jobs-ux-design.md`

---

## Task 1: In-app `Dialog` component

**Files:**
- Create: `Desktop_App/src/components/Dialog.jsx`
- Create: `Desktop_App/src/components/Dialog.css`

- [ ] **Step 1: Create `Dialog.jsx`**

```jsx
import React, { useEffect, useRef } from 'react';
import './Dialog.css';

export default function Dialog({
  open,
  mode = 'alert',
  title,
  message,
  defaultValue = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && mode === 'prompt' && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [open, mode]);

  if (!open) return null;

  const handleConfirm = () => {
    if (mode === 'prompt') {
      onConfirm(inputRef.current ? inputRef.current.value : '');
    } else {
      onConfirm();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog-card" role="dialog" aria-modal="true" onKeyDown={handleKeyDown}>
        {title && <h3 className="dialog-title">{title}</h3>}
        {message && <p className="dialog-message">{message}</p>}
        {mode === 'prompt' && (
          <input ref={inputRef} type="text" className="dialog-input" defaultValue={defaultValue} />
        )}
        <div className="dialog-actions">
          {mode !== 'alert' && (
            <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          )}
          <button className="btn btn-primary" onClick={handleConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `Dialog.css`**

```css
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.dialog-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: min(420px, 90vw);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.dialog-title {
  margin: 0;
  font-size: 1rem;
  color: var(--text-primary);
}

.dialog-message {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.dialog-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 0.6rem;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.dialog-input:focus {
  outline: none;
  border-color: var(--border-focus);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
```

- [ ] **Step 3: Commit**

```bash
git add Desktop_App/src/components/Dialog.jsx Desktop_App/src/components/Dialog.css
git commit -m "feat(ui): add reusable in-app Dialog component for prompt/confirm/alert"
```

---

## Task 2: Replace `window.prompt`/`alert` in `Image2GCodePage` with `Dialog`

**Files:**
- Modify: `Desktop_App/src/pages/Image2GCodePage.jsx`

- [ ] **Step 1: Update imports — drop unused `SendToBack`, add `Dialog`**

Replace line 12:
```js
import { Play, Save, Zap, SendToBack } from 'lucide-react';
```
with:
```js
import { Play, Save, Zap } from 'lucide-react';
```

Then add a new import line directly after the `GCodePreview` import (current line 9, `import GCodePreview from '../components/GCodePreview';`):
```js
import Dialog from '../components/Dialog';
```

- [ ] **Step 2: Add dialog state, replace `handleSaveJob`**

Replace the existing `handleSaveJob` (current lines 86-102):
```js
  const handleSaveJob = useCallback(async () => {
    if (compiledGCode.length === 0) return;
    
    let defaultName = `Image Job ${new Date().toTimeString().slice(0, 8)}`;
    const name = window.prompt("Enter a name for this job:", defaultName);
    
    if (!name) return; // user canceled
    
    const result = await window.platform.saveJob(name, compiledGCode);
    if (result && result.success) {
      addLoadedFile(result.job);
      navigate('/gcode');
    } else {
      console.error('Failed to save job:', result?.error);
      alert(`Failed to save job: ${result?.error}`);
    }
  }, [compiledGCode, addLoadedFile, navigate]);
```
with:
```js
  const [dialog, setDialog] = React.useState({ open: false });

  const closeDialog = useCallback(() => setDialog({ open: false }), []);

  const performSaveJob = useCallback(async (name) => {
    const result = await window.platform.saveJob(name, compiledGCode);
    if (result && result.success) {
      addLoadedFile(result.job);
      navigate('/gcode');
    } else {
      setDialog({
        open: true,
        mode: 'alert',
        title: 'Save Failed',
        message: `Failed to save job: ${result?.error || 'Unknown error'}`,
        confirmLabel: 'OK',
        onConfirm: closeDialog,
        onCancel: closeDialog,
      });
    }
  }, [compiledGCode, addLoadedFile, navigate, closeDialog]);

  const handleSaveJob = useCallback(() => {
    if (compiledGCode.length === 0) return;
    const defaultName = `Image Job ${new Date().toTimeString().slice(0, 8)}`;
    setDialog({
      open: true,
      mode: 'prompt',
      title: 'Save Job',
      message: 'Enter a name for this job:',
      defaultValue: defaultName,
      confirmLabel: 'Save',
      onConfirm: (name) => {
        closeDialog();
        if (!name || !name.trim()) return;
        performSaveJob(name.trim());
      },
      onCancel: closeDialog,
    });
  }, [compiledGCode, closeDialog, performSaveJob]);
```

- [ ] **Step 3: Render the dialog**

The component's JSX currently ends with (current lines 206-208):
```jsx
      </div>
    </div>
  );
}
```
where the first `</div>` closes `.i2g-layout` and the second closes `.page`. Add `<Dialog {...dialog} />` as a sibling right after `.i2g-layout` closes, so it overlays the whole page:
```jsx
      </div>

      <Dialog {...dialog} />
    </div>
  );
}
```

- [ ] **Step 4: Manual smoke test**

Run: `cd Desktop_App && npm run electron:dev`

(`npm run dev` only starts Vite — `window.platform.saveJob` is provided by the Electron preload bridge and is unavailable in a plain browser tab, so the Save Job path needs the full Electron shell.)

In the running app: open Image to G-Code, trace or draw something, compile, click "Save Job". Confirm:
- A styled in-app modal appears (matching dark theme) instead of a native browser prompt
- Typing a name and pressing Enter (or clicking "Save") saves the job and navigates to `/gcode`
- Pressing Escape (or clicking outside the card) cancels without saving
- If saving fails, a styled "Save Failed" alert dialog appears (you can simulate this by temporarily renaming `window.platform.saveJob` in devtools console, or just confirm the success path works and trust the code path for the error branch)

Stop the dev server when done (`Ctrl+C` in the terminal, or `pkill -f vite` / `pkill -f electron` as appropriate).

- [ ] **Step 5: Commit**

```bash
git add Desktop_App/src/pages/Image2GCodePage.jsx
git commit -m "refactor(image2gcode): replace window.prompt/alert with in-app Dialog for Save Job"
```

---

## Task 3: Replace `window.confirm` in `VectorEditor` with `Dialog`

**Files:**
- Modify: `Desktop_App/src/components/VectorEditor/VectorEditor.jsx`

- [ ] **Step 1: Add import and confirm-dialog state, convert `deleteAll`**

Add this import after line 6 (`import './VectorEditor.css';`):
```js
import Dialog from '../Dialog';
```

Replace `deleteAll` (current lines 217-226):
```js
  const deleteAll = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (window.confirm('Are you sure you want to delete everything?')) {
      canvas.getObjects().forEach((obj) => {
        if (!obj.excludeFromExport) canvas.remove(obj);
      });
      canvas.renderAll();
    }
  }, []);
```
with:
```js
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const deleteAll = useCallback(() => {
    if (!fabricRef.current) return;
    setConfirmDeleteOpen(true);
  }, []);

  const confirmDeleteAll = useCallback(() => {
    const canvas = fabricRef.current;
    setConfirmDeleteOpen(false);
    if (!canvas) return;
    canvas.getObjects().forEach((obj) => {
      if (!obj.excludeFromExport) canvas.remove(obj);
    });
    canvas.renderAll();
  }, []);
```

- [ ] **Step 2: Render the confirm dialog**

The component currently returns (lines 228-241):
```jsx
  return (
    <div className="vector-editor">
      <ToolPalette
        activeTool={activeTool}
        onToolChange={setTool}
        onDeleteSelected={deleteSelected}
        onDeleteAll={deleteAll}
      />
      <div className="canvas-wrap">
        <canvas ref={canvasElRef} />
      </div>
    </div>
  );
});
```
Add the `Dialog` as a sibling of `.canvas-wrap`, inside `.vector-editor`:
```jsx
  return (
    <div className="vector-editor">
      <ToolPalette
        activeTool={activeTool}
        onToolChange={setTool}
        onDeleteSelected={deleteSelected}
        onDeleteAll={deleteAll}
      />
      <div className="canvas-wrap">
        <canvas ref={canvasElRef} />
      </div>
      <Dialog
        open={confirmDeleteOpen}
        mode="confirm"
        title="Delete Everything"
        message="Are you sure you want to delete everything?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={confirmDeleteAll}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
});
```

- [ ] **Step 3: Manual smoke test**

Run: `cd Desktop_App && npm run dev`

In the running app: open Image to G-Code → "Vector Drawer"/"Draw & Finalize" tab, draw a shape, click "Delete All" in the tool palette. Confirm:
- A styled in-app confirm modal appears (not the native browser confirm dialog)
- "Cancel" dismisses without deleting
- "Delete" clears the canvas (keeping the bed boundary)

- [ ] **Step 4: Commit**

```bash
git add "Desktop_App/src/components/VectorEditor/VectorEditor.jsx"
git commit -m "refactor(vector-editor): replace window.confirm with in-app Dialog for delete-all"
```

---

## Task 4: `colorMatch.js` utility + tests

**Files:**
- Create: `Desktop_App/src/lib/colorMatch.js`
- Create: `Desktop_App/src/lib/colorMatch.test.mjs`

- [ ] **Step 1: Write the failing test file**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { parseRgbColor, colorDistance, isWhiteOrNone, isBackgroundColor } from './colorMatch.js';

test('parseRgbColor parses rgb() strings', () => {
  assert.deepStrictEqual(parseRgbColor('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30 });
  assert.deepStrictEqual(parseRgbColor('RGB(255,0,0)'), { r: 255, g: 0, b: 0 });
});

test('parseRgbColor returns null for non-rgb strings', () => {
  assert.strictEqual(parseRgbColor('black'), null);
  assert.strictEqual(parseRgbColor('#ffffff'), null);
  assert.strictEqual(parseRgbColor(null), null);
});

test('colorDistance computes Euclidean RGB distance', () => {
  assert.strictEqual(colorDistance({ r: 0, g: 0, b: 0 }, { r: 3, g: 4, b: 0 }), 5);
});

test('isWhiteOrNone matches pure white and none, rejects near-white', () => {
  assert.strictEqual(isWhiteOrNone('white'), true);
  assert.strictEqual(isWhiteOrNone('#fff'), true);
  assert.strictEqual(isWhiteOrNone('#ffffff'), true);
  assert.strictEqual(isWhiteOrNone('rgb(255,255,255)'), true);
  assert.strictEqual(isWhiteOrNone('rgb(255, 255, 255)'), true);
  assert.strictEqual(isWhiteOrNone('none'), true);
  assert.strictEqual(isWhiteOrNone(null), true);
  assert.strictEqual(isWhiteOrNone('rgb(250,250,250)'), false);
  assert.strictEqual(isWhiteOrNone('rgb(0,0,0)'), false);
});

test('isBackgroundColor falls back to isWhiteOrNone with no backgroundColor', () => {
  assert.strictEqual(isBackgroundColor('rgb(255,255,255)', null), true);
  assert.strictEqual(isBackgroundColor('rgb(210,210,210)', null), false);
});

test('isBackgroundColor matches colors close to the sampled background', () => {
  const bg = { r: 210, g: 208, b: 205 };
  assert.strictEqual(isBackgroundColor('rgb(215,210,200)', bg), true);  // close -> background, skip
  assert.strictEqual(isBackgroundColor('rgb(20,20,20)', bg), false);    // far -> drawn
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd Desktop_App && node --test src/lib/colorMatch.test.mjs`
Expected: FAIL — `Cannot find module './colorMatch.js'` (or similar "module not found")

- [ ] **Step 3: Write `colorMatch.js`**

```js
const BACKGROUND_COLOR_DISTANCE = 60;

export function parseRgbColor(colorStr) {
  if (!colorStr) return null;
  const m = colorStr.trim().toLowerCase().match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!m) return null;
  return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
}

export function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

export function isWhiteOrNone(colorStr) {
  if (!colorStr || colorStr === 'none') return true;
  const c = colorStr.trim().toLowerCase().replace(/\s+/g, '');
  return c === 'white' || c === '#fff' || c === '#ffffff' || c === 'rgb(255,255,255)';
}

export function isBackgroundColor(colorStr, backgroundColor) {
  if (!colorStr || colorStr === 'none') return true;
  if (!backgroundColor) return isWhiteOrNone(colorStr);
  const c = parseRgbColor(colorStr);
  if (!c) return isWhiteOrNone(colorStr);
  return colorDistance(c, backgroundColor) <= BACKGROUND_COLOR_DISTANCE;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd Desktop_App && node --test src/lib/colorMatch.test.mjs`
Expected: PASS — `# pass 6`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add Desktop_App/src/lib/colorMatch.js Desktop_App/src/lib/colorMatch.test.mjs
git commit -m "feat(lib): add colorMatch utility with corner-sampled background-color matching"
```

---

## Task 5: `bezier.js` utility + tests

**Files:**
- Create: `Desktop_App/src/lib/bezier.js`
- Create: `Desktop_App/src/lib/bezier.test.mjs`

- [ ] **Step 1: Write the failing test file**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { tessellateQuadratic, tessellateCubic } from './bezier.js';

test('tessellateQuadratic returns `steps` points ending at the curve endpoint', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 5, y: 10 };
  const p2 = { x: 10, y: 0 };
  const points = tessellateQuadratic(p0, p1, p2, 4);
  assert.strictEqual(points.length, 4);
  assert.ok(Math.abs(points[points.length - 1].x - p2.x) < 1e-9);
  assert.ok(Math.abs(points[points.length - 1].y - p2.y) < 1e-9);
});

test('tessellateQuadratic midpoint sits on the curve, off the straight chord', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 5, y: 10 };
  const p2 = { x: 10, y: 0 };
  const points = tessellateQuadratic(p0, p1, p2, 2);
  // At t=0.5 a quadratic Bezier evaluates to 0.25*p0 + 0.5*p1 + 0.25*p2 = (5, 5)
  assert.ok(Math.abs(points[0].x - 5) < 1e-9);
  assert.ok(Math.abs(points[0].y - 5) < 1e-9);
  // The straight chord p0->p2 passes through y=0 at its midpoint; the curve bulges to y=5
  assert.notStrictEqual(points[0].y, 0);
});

test('tessellateCubic returns `steps` points ending at the curve endpoint', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 0, y: 10 };
  const p2 = { x: 10, y: 10 };
  const p3 = { x: 10, y: 0 };
  const points = tessellateCubic(p0, p1, p2, p3, 6);
  assert.strictEqual(points.length, 6);
  assert.ok(Math.abs(points[points.length - 1].x - p3.x) < 1e-9);
  assert.ok(Math.abs(points[points.length - 1].y - p3.y) < 1e-9);
});

test('tessellateCubic produces points that bulge off the straight chord', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 0, y: 10 };
  const p2 = { x: 10, y: 10 };
  const p3 = { x: 10, y: 0 };
  const points = tessellateCubic(p0, p1, p2, p3, 2);
  // The straight chord p0->p3 stays at y=0; this S-curve bulges upward at its midpoint
  assert.ok(points[0].y > 0);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd Desktop_App && node --test src/lib/bezier.test.mjs`
Expected: FAIL — `Cannot find module './bezier.js'` (or similar "module not found")

- [ ] **Step 3: Write `bezier.js`**

```js
const BEZIER_STEPS = 8;

export function tessellateQuadratic(p0, p1, p2, steps = BEZIER_STEPS) {
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    points.push({
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    });
  }
  return points;
}

export function tessellateCubic(p0, p1, p2, p3, steps = BEZIER_STEPS) {
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    points.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return points;
}

export { BEZIER_STEPS };
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd Desktop_App && node --test src/lib/bezier.test.mjs`
Expected: PASS — `# pass 4`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add Desktop_App/src/lib/bezier.js Desktop_App/src/lib/bezier.test.mjs
git commit -m "feat(lib): add bezier curve tessellation utility"
```

---

## Task 6: `imageBinarize.js` utility + tests

**Files:**
- Create: `Desktop_App/src/lib/imageBinarize.js`
- Create: `Desktop_App/src/lib/imageBinarize.test.mjs`

- [ ] **Step 1: Write the failing test file**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { binarizeImageData, sampleCornerColor } from './imageBinarize.js';

test('binarizeImageData converts pixels below threshold to black and others to white', () => {
  const data = new Uint8ClampedArray([
    10, 10, 10, 255,
    240, 240, 240, 255,
  ]);
  const result = binarizeImageData({ width: 2, height: 1, data }, 128);
  assert.deepStrictEqual([...result.data], [0, 0, 0, 255, 255, 255, 255, 255]);
  assert.strictEqual(result.width, 2);
  assert.strictEqual(result.height, 1);
});

test('binarizeImageData uses perceptual luminance, not a flat average', () => {
  // Pure green has luminance ~150 (above threshold 128) -> white; pure blue ~29 -> black,
  // even though both have a single 255 channel and would average identically.
  const data = new Uint8ClampedArray([
    0, 255, 0, 255,
    0, 0, 255, 255,
  ]);
  const result = binarizeImageData({ width: 2, height: 1, data }, 128);
  assert.deepStrictEqual([...result.data.slice(0, 4)], [255, 255, 255, 255]);
  assert.deepStrictEqual([...result.data.slice(4, 8)], [0, 0, 0, 255]);
});

test('binarizeImageData never produces intermediate gray values', () => {
  const data = new Uint8ClampedArray(40);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256;
  const result = binarizeImageData({ width: 10, height: 1, data }, 100);
  for (let i = 0; i < result.data.length; i += 4) {
    assert.ok(result.data[i] === 0 || result.data[i] === 255);
    assert.strictEqual(result.data[i], result.data[i + 1]);
    assert.strictEqual(result.data[i], result.data[i + 2]);
    assert.strictEqual(result.data[i + 3], 255);
  }
});

test('sampleCornerColor averages the four corner regions', () => {
  const w = 10, h = 10;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200; data[i + 1] = 100; data[i + 2] = 50; data[i + 3] = 255;
  }
  assert.deepStrictEqual(sampleCornerColor({ width: w, height: h, data }), { r: 200, g: 100, b: 50 });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd Desktop_App && node --test src/lib/imageBinarize.test.mjs`
Expected: FAIL — `Cannot find module './imageBinarize.js'` (or similar "module not found")

- [ ] **Step 3: Write `imageBinarize.js`**

```js
const LUMINANCE_R = 0.299;
const LUMINANCE_G = 0.587;
const LUMINANCE_B = 0.114;

export function binarizeImageData(imageData, threshold) {
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const luminance = LUMINANCE_R * data[i] + LUMINANCE_G * data[i + 1] + LUMINANCE_B * data[i + 2];
    const v = luminance < threshold ? 0 : 255;
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { width, height, data: out };
}

export function sampleCornerColor(imageData, marginRatio = 0.02) {
  const { width, height, data } = imageData;
  const mx = Math.max(1, Math.min(width - 1, Math.floor(width * marginRatio)));
  const my = Math.max(1, Math.min(height - 1, Math.floor(height * marginRatio)));
  const corners = [
    [mx, my],
    [width - 1 - mx, my],
    [mx, height - 1 - my],
    [width - 1 - mx, height - 1 - my],
  ];
  let r = 0, g = 0, b = 0;
  for (const [x, y] of corners) {
    const idx = (y * width + x) * 4;
    r += data[idx];
    g += data[idx + 1];
    b += data[idx + 2];
  }
  return { r: Math.round(r / 4), g: Math.round(g / 4), b: Math.round(b / 4) };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd Desktop_App && node --test src/lib/imageBinarize.test.mjs`
Expected: PASS — `# pass 4`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add Desktop_App/src/lib/imageBinarize.js Desktop_App/src/lib/imageBinarize.test.mjs
git commit -m "feat(lib): add luminance-threshold image binarization utility"
```

---

## Task 7: Wire `colorMatch`/`bezier` into `gcodeCompiler.js` (background filter + curve tessellation)

**Files:**
- Modify: `Desktop_App/src/lib/gcodeCompiler.js`

This is a pure-logic change to DOM-coupled code (uses `DOMParser`, `svg-path-parser`) that cannot run under `node --test` (see plan header — ESM/CJS interop issue with `svg-path-parser`'s named exports under Node's static analyzer). It's covered by Task 4/5's unit tests for the extracted helpers, plus manual end-to-end verification in Task 12.

- [ ] **Step 1: Import the new helpers and remove the local `isWhiteOrNone`**

Replace line 2:
```js
import { parseSVG, makeAbsolute } from 'svg-path-parser';
```
with:
```js
import { parseSVG, makeAbsolute } from 'svg-path-parser';
import { isBackgroundColor } from './colorMatch';
import { tessellateQuadratic, tessellateCubic } from './bezier';
```

Then delete the local `isWhiteOrNone` function entirely (current lines 148-160):
```js
function isWhiteOrNone(colorStr) {
  if (!colorStr || colorStr === 'none') return true;
  const c = colorStr.trim().toLowerCase();
  if (c === 'white' || c === '#fff' || c === '#ffffff') return true;
  const m = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (m) {
    const r = parseInt(m[1], 10);
    const g = parseInt(m[2], 10);
    const b = parseInt(m[3], 10);
    if (r > 250 && g > 250 && b > 250) return true;
  }
  return false;
}

```
(leave the blank line that follows it removed too, so `export function compileSVGToGCode` directly follows the `extractAllPointSets` function)

- [ ] **Step 2: Replace the curve-collapsing branch in `pathToPoints` with real tessellation**

Replace the whole `pathToPoints` function (current lines 40-75):
```js
function pathToPoints(d, transform) {
  const commands = makeAbsolute(parseSVG(d));
  const points = [];
  let startX = 0, startY = 0;
  for (const cmd of commands) {
    switch (cmd.code) {
      case 'M': {
        const p = applyTransform(cmd.x, cmd.y, transform);
        points.push({ type: 'M', x: p.x, y: p.y });
        startX = p.x; startY = p.y;
        break;
      }
      case 'L': {
        const p = applyTransform(cmd.x, cmd.y, transform);
        points.push({ type: 'L', x: p.x, y: p.y });
        break;
      }
      case 'C':
      case 'Q': {
        // Approximate bezier to endpoint — sufficient for pen plotter linear moves
        const p = applyTransform(cmd.x, cmd.y, transform);
        points.push({ type: 'L', x: p.x, y: p.y });
        break;
      }
      case 'Z':
        points.push({ type: 'Z', x: startX, y: startY });
        break;
      default:
        if (cmd.x !== undefined && cmd.y !== undefined) {
          const p = applyTransform(cmd.x, cmd.y, transform);
          points.push({ type: 'L', x: p.x, y: p.y });
        }
    }
  }
  return points;
}
```
with:
```js
function pathToPoints(d, transform) {
  const commands = makeAbsolute(parseSVG(d));
  const points = [];
  let startX = 0, startY = 0;
  for (const cmd of commands) {
    const prev = points[points.length - 1];
    switch (cmd.code) {
      case 'M': {
        const p = applyTransform(cmd.x, cmd.y, transform);
        points.push({ type: 'M', x: p.x, y: p.y });
        startX = p.x; startY = p.y;
        break;
      }
      case 'L': {
        const p = applyTransform(cmd.x, cmd.y, transform);
        points.push({ type: 'L', x: p.x, y: p.y });
        break;
      }
      case 'Q': {
        const c1 = applyTransform(cmd.x1, cmd.y1, transform);
        const end = applyTransform(cmd.x, cmd.y, transform);
        if (prev) {
          for (const pt of tessellateQuadratic(prev, c1, end)) {
            points.push({ type: 'L', x: pt.x, y: pt.y });
          }
        } else {
          points.push({ type: 'L', x: end.x, y: end.y });
        }
        break;
      }
      case 'C': {
        const c1 = applyTransform(cmd.x1, cmd.y1, transform);
        const c2 = applyTransform(cmd.x2, cmd.y2, transform);
        const end = applyTransform(cmd.x, cmd.y, transform);
        if (prev) {
          for (const pt of tessellateCubic(prev, c1, c2, end)) {
            points.push({ type: 'L', x: pt.x, y: pt.y });
          }
        } else {
          points.push({ type: 'L', x: end.x, y: end.y });
        }
        break;
      }
      case 'Z':
        points.push({ type: 'Z', x: startX, y: startY });
        break;
      default:
        if (cmd.x !== undefined && cmd.y !== undefined) {
          const p = applyTransform(cmd.x, cmd.y, transform);
          points.push({ type: 'L', x: p.x, y: p.y });
        }
    }
  }
  return points;
}
```

- [ ] **Step 3: Accept `backgroundColor` in `compileSVGToGCode` and use `isBackgroundColor`**

Replace the settings destructuring (current lines 163-169):
```js
  const {
    maxFeedrate = 1000,
    servoPenDown = 30,
    servoPenUp = 75,
    bedH = 200,
    multicolorMode = false,
  } = settings;
```
with:
```js
  const {
    maxFeedrate = 1000,
    servoPenDown = 30,
    servoPenUp = 75,
    bedH = 200,
    multicolorMode = false,
    backgroundColor = null,
  } = settings;
```

Replace the filter line (current line 216):
```js
  const validSets = allPointSets.filter(s => !isWhiteOrNone(s.color));
```
with:
```js
  const validSets = allPointSets.filter(s => !isBackgroundColor(s.color, backgroundColor));
```

- [ ] **Step 4: Commit**

```bash
git add Desktop_App/src/lib/gcodeCompiler.js
git commit -m "fix(gcodecompiler): tessellate bezier curves and use corner-sampled background matching"
```

---

## Task 8: Add `threshold` and `backgroundColor` to `Image2GCodeContext`

**Files:**
- Modify: `Desktop_App/src/contexts/Image2GCodeContext.jsx`

- [ ] **Step 1: Add `threshold` to `tracerOptions`, add `backgroundColor` state**

Replace the `tracerOptions` initial state (current lines 14-19):
```js
  const [tracerOptions, setTracerOptions] = useState({
    numberofcolors: 2,
    ltres: 1,
    qtres: 1,
    pathomit: 8,
  });
```
with:
```js
  const [tracerOptions, setTracerOptions] = useState({
    numberofcolors: 2,
    ltres: 1,
    qtres: 1,
    pathomit: 8,
    threshold: 128,
  });
```

Add a `backgroundColor` state right after the `multicolorMode` state (current line 23, `const [multicolorMode, setMulticolorMode] = useState(false);`):
```js
  const [backgroundColor, setBackgroundColor] = useState(null);
```

- [ ] **Step 2: Expose `backgroundColor`/`setBackgroundColor` in the context value**

Replace the `value` object (current lines 25-33):
```js
  const value = {
    previewSrc, setPreviewSrc,
    tracedSVG, setTracedSVG,
    tracerOptions, setTracerOptions,
    compiledGCode, setCompiledGCode,
    activeTab, setActiveTab,
    lineWidth, setLineWidth,
    multicolorMode, setMulticolorMode,
  };
```
with:
```js
  const value = {
    previewSrc, setPreviewSrc,
    tracedSVG, setTracedSVG,
    tracerOptions, setTracerOptions,
    compiledGCode, setCompiledGCode,
    activeTab, setActiveTab,
    lineWidth, setLineWidth,
    multicolorMode, setMulticolorMode,
    backgroundColor, setBackgroundColor,
  };
```

- [ ] **Step 3: Commit**

```bash
git add Desktop_App/src/contexts/Image2GCodeContext.jsx
git commit -m "feat(image2gcode): add threshold and backgroundColor to context state"
```

---

## Task 9: Wire binarization + corner sampling into `useImageTracer`

**Files:**
- Modify: `Desktop_App/src/hooks/useImageTracer.js`

- [ ] **Step 1: Import the new helpers, add `backgroundColor` result state, rewrite `trace`**

Replace line 1:
```js
import { useState, useRef, useEffect, useCallback } from 'react';
```
with:
```js
import { useState, useRef, useEffect, useCallback } from 'react';
import { binarizeImageData, sampleCornerColor } from '../lib/imageBinarize';
```

Add a `backgroundColor` state next to the existing `result`/`loading`/`error` states (current line 4):
```js
  const [result, setResult] = useState(null);
```
becomes:
```js
  const [result, setResult] = useState(null);
  const [backgroundColor, setBackgroundColor] = useState(null);
```

Replace the entire `trace` callback (current lines 39-79):
```js
  const trace = useCallback((base64DataUrl, options = {}) => {
    if (!base64DataUrl) {
      setError('No image data provided');
      return;
    }
    setLoading(true);
    setResult(null);
    setError(null);

    const defaultOptions = {
      numberofcolors: 2,
      colorquantcycles: 1,
      ltres: 1,
      qtres: 1,
      pathomit: 8,
      blurradius: 0,
    };

    // Decode the image on the main thread (DOM available here) so the
    // worker receives raw RGBA pixels instead of a data URL — workers
    // cannot call new Image() because they have no DOM access.
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const buffer = imageData.data.buffer.slice(0);
      workerRef.current.postMessage(
        { width: canvas.width, height: canvas.height, buffer, options: { ...defaultOptions, ...options } },
        [buffer]
      );
    };
    img.onerror = () => {
      setLoading(false);
      setError('Failed to load image');
    };
    img.src = base64DataUrl;
  }, []);

  return { trace, result, loading, error };
}
```
with:
```js
  const trace = useCallback((base64DataUrl, options = {}) => {
    if (!base64DataUrl) {
      setError('No image data provided');
      return;
    }
    setLoading(true);
    setResult(null);
    setError(null);
    setBackgroundColor(null);

    const { multicolorMode = false, threshold = 128, ...tracerParams } = options;

    const defaultOptions = {
      numberofcolors: 2,
      colorquantcycles: 1,
      ltres: 1,
      qtres: 1,
      pathomit: 8,
      blurradius: 0,
    };

    // Decode the image on the main thread (DOM available here) so the
    // worker receives raw RGBA pixels instead of a data URL — workers
    // cannot call new Image() because they have no DOM access.
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let pixelData = imageData;
      let traceOptions = { ...defaultOptions, ...tracerParams };

      if (multicolorMode) {
        // Real-color tracing: sample the source image's corners so the
        // compiler can identify (and skip) the background by closest match.
        setBackgroundColor(sampleCornerColor(imageData));
      } else {
        // Single-color tracing: binarize first so the tracer always receives
        // strictly two-tone pixels — guarantees white=skip / black=draw
        // regardless of the source image's lighting or scan artifacts.
        pixelData = binarizeImageData(imageData, threshold);
        traceOptions = { ...traceOptions, numberofcolors: 2, colorsampling: 0 };
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

- [ ] **Step 2: Manual smoke test**

Run: `cd Desktop_App && npm run dev`

In the running app, open Image to G-Code, load an image, and confirm the trace still completes (check the browser devtools console for errors — there's no UI for `threshold`/`multicolorMode` yet, so `trace` is called with the existing `tracerOptions` shape; `threshold` defaults to `128` and `multicolorMode` defaults to `false` inside the hook, so single-color binarization always runs at this point — the resulting traced SVG should look like a clean two-tone silhouette).

- [ ] **Step 3: Commit**

```bash
git add Desktop_App/src/hooks/useImageTracer.js
git commit -m "feat(tracer): binarize single-color traces and sample background color for multicolor"
```

---

## Task 10: Threshold slider + live binarized preview in `ImageToGCodeTab`

**Files:**
- Modify: `Desktop_App/src/pages/tabs/ImageToGCodeTab.jsx`
- Modify: `Desktop_App/src/pages/Image2GCodePage.css`

- [ ] **Step 1: Rewrite `ImageToGCodeTab.jsx`**

Replace the entire file contents with:
```jsx
import React, { useRef, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { useImageTracer } from '../../hooks/useImageTracer';
import { useImage2GCode } from '../../contexts/Image2GCodeContext';
import { binarizeImageData } from '../../lib/imageBinarize';

export default function ImageToGCodeTab({ onSendToDrawer }) {
  const { trace, result: tracerResult, backgroundColor: sampledBackground, loading, error } = useImageTracer();
  const {
    previewSrc, setPreviewSrc,
    tracedSVG, setTracedSVG,
    tracerOptions, setTracerOptions,
    multicolorMode, setMulticolorMode,
    setBackgroundColor,
  } = useImage2GCode();

  const fileInputRef = useRef(null);
  const binarizedCanvasRef = useRef(null);

  // Sync worker result into context so it survives navigation
  useEffect(() => {
    if (tracerResult) setTracedSVG(tracerResult);
  }, [tracerResult, setTracedSVG]);

  // Sync the multicolor-mode corner-sampled background color into context
  // so the compiler can use it to identify background paths to skip.
  useEffect(() => {
    if (sampledBackground) setBackgroundColor(sampledBackground);
  }, [sampledBackground, setBackgroundColor]);

  // Live threshold preview: re-binarize and redraw whenever the source
  // image or threshold changes, so the user sees exactly what will be
  // traced before committing to a (re)trace. Only relevant in single-color
  // mode — multicolor mode traces the original image untouched.
  useEffect(() => {
    if (multicolorMode || !previewSrc) return;
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
  }, [previewSrc, tracerOptions.threshold, multicolorMode]);

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
      trace(ev.target.result, { ...tracerOptions, multicolorMode });
    };
    reader.readAsDataURL(file);
  };

  const handleRetrace = () => {
    if (previewSrc) trace(previewSrc, { ...tracerOptions, multicolorMode });
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

        <div className="form-group" style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
          <input
            type="checkbox"
            id="multicolor-mode"
            checked={multicolorMode}
            onChange={(e) => setMulticolorMode(e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          <label htmlFor="multicolor-mode" style={{ margin: 0, fontWeight: 'normal' }}>Enable Multicolor Mode (pauses for color changes)</label>
        </div>

        <div className="form-group">
          <label>Threshold (ink vs. paper): {tracerOptions.threshold}</label>
          <input type="range" min="0" max="255" value={tracerOptions.threshold}
            onChange={(e) => setOpt('threshold', Number(e.target.value))}
            className="slider" disabled={loading || multicolorMode} />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
            Pixels darker than this are drawn as ink; lighter pixels are skipped as paper.
          </p>
        </div>

        <div className="form-group">
          <label>Colors: {tracerOptions.numberofcolors}</label>
          <input type="range" min="2" max="16" value={tracerOptions.numberofcolors}
            onChange={(e) => setOpt('numberofcolors', Number(e.target.value))}
            className="slider" disabled={loading || !multicolorMode} />
          {!multicolorMode && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
              Only used in Multicolor Mode — single-color traces always use a forced black/white palette.
            </p>
          )}
        </div>

        <div className="form-group">
          <label>Line Threshold (ltres): {tracerOptions.ltres}</label>
          <input type="range" min="0.1" max="5" step="0.1" value={tracerOptions.ltres}
            onChange={(e) => setOpt('ltres', Number(e.target.value))}
            className="slider" disabled={loading} />
        </div>

        <div className="form-group">
          <label>Spline Threshold (qtres): {tracerOptions.qtres}</label>
          <input type="range" min="0.1" max="5" step="0.1" value={tracerOptions.qtres}
            onChange={(e) => setOpt('qtres', Number(e.target.value))}
            className="slider" disabled={loading} />
        </div>

        <div className="form-group">
          <label>Min Path Length (pathomit): {tracerOptions.pathomit}</label>
          <input type="range" min="1" max="32" value={tracerOptions.pathomit}
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

        {!multicolorMode && (
          <>
            <h3 className="section-header" style={{ marginTop: '1rem' }}>Threshold Preview</h3>
            <div className="preview-box">
              {previewSrc
                ? <canvas ref={binarizedCanvasRef} className="preview-canvas" />
                : <span className="placeholder-text">Load an image to preview the black/white mask</span>}
            </div>
          </>
        )}

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
```

- [ ] **Step 2: Add a `.preview-canvas` CSS class**

Add this rule to `Desktop_App/src/pages/Image2GCodePage.css` directly after the existing `.preview-img` rule (current lines 87-91):
```css
.preview-canvas {
  max-width: 100%;
  max-height: 200px;
  image-rendering: pixelated;
}
```

- [ ] **Step 3: Manual smoke test**

Run: `cd Desktop_App && npm run dev`

In the running app, open Image to G-Code → "Import & Trace" tab:
- Load an image (e.g. `Input Files/bitmap_1.png` or `Input Files/house.png`)
- Confirm a "Threshold Preview" panel appears showing a live black/white mask
- Drag the "Threshold" slider — confirm the preview mask updates instantly and the slider is disabled while "Multicolor Mode" is checked
- Click "Re-trace" — confirm the traced SVG mirrors the binarized mask (no stray background fills)
- Check "Multicolor Mode" — confirm the "Threshold Preview" panel disappears and the "Colors" slider becomes enabled (and is disabled again when unchecked)

- [ ] **Step 4: Commit**

```bash
git add "Desktop_App/src/pages/tabs/ImageToGCodeTab.jsx" "Desktop_App/src/pages/Image2GCodePage.css"
git commit -m "feat(image2gcode): add threshold slider with live binarized preview"
```

---

## Task 11: Three-tab restructure of `Image2GCodePage`

**Files:**
- Modify: `Desktop_App/src/pages/Image2GCodePage.jsx`
- Modify: `Desktop_App/src/pages/Image2GCodePage.css`
- Modify: `Desktop_App/src/components/GCodePreview.jsx`

- [ ] **Step 1: Add `backgroundColor` to the destructured context values and pass it through `handleCompile`**

Replace the context destructuring (current lines 23-29, after Task 8 already added `backgroundColor` to the provider):
```js
  const {
    activeTab, setActiveTab,
    lineWidth, setLineWidth,
    tracedSVG, setTracedSVG,
    compiledGCode, setCompiledGCode,
    multicolorMode,
  } = useImage2GCode();
```
with:
```js
  const {
    activeTab, setActiveTab,
    lineWidth, setLineWidth,
    tracedSVG, setTracedSVG,
    compiledGCode, setCompiledGCode,
    multicolorMode,
    backgroundColor,
  } = useImage2GCode();
```

Replace the `compileSVGToGCode` call inside `handleCompile` (current lines 62-68):
```js
      const lines = compileSVGToGCode(svgSource, {
        maxFeedrate: settings?.maxFeedrate || 1000,
        servoPenDown: settings?.servoPenDown || 30,
        servoPenUp: settings?.servoPenUp || 75,
        bedH,
        multicolorMode,
      });
```
with:
```js
      const lines = compileSVGToGCode(svgSource, {
        maxFeedrate: settings?.maxFeedrate || 1000,
        servoPenDown: settings?.servoPenDown || 30,
        servoPenUp: settings?.servoPenUp || 75,
        bedH,
        multicolorMode,
        backgroundColor: multicolorMode ? backgroundColor : null,
      });
```

Also add `backgroundColor` to `handleCompile`'s dependency array (current line 84):
```js
  }, [activeTab, tracedSVG, settings, bedH, setCompiledGCode]);
```
becomes:
```js
  }, [activeTab, tracedSVG, settings, bedH, multicolorMode, backgroundColor, setCompiledGCode]);
```

- [ ] **Step 2: Add the third tab button**

Replace the tab bar (current lines 119-132):
```jsx
        <div className="i2g-tabs">
          <button
            className={`i2g-tab${activeTab === 'image' ? ' active' : ''}`}
            onClick={() => setActiveTab('image')}
          >
            Image to G-Code
          </button>
          <button
            className={`i2g-tab${activeTab === 'drawer' ? ' active' : ''}`}
            onClick={() => setActiveTab('drawer')}
          >
            Vector Drawer
          </button>
        </div>
```
with:
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

- [ ] **Step 3: Add the third tab's content panel**

Replace the tab body (current lines 135-148):
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
            />
          </div>
        </div>
```
with:
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
                <GCodePreview lines={compiledGCode} bedW={bedW} bedH={bedH} softLimitMargin={settings.softLimitMargin ?? 10} />
              </div>
            </div>
          </div>
        </div>
```

- [ ] **Step 4: Remove the preview from the bottom bar and reclaim the space for the line-count/warning**

Replace the entire bottom bar (current lines 151-205):
```jsx
        <div className="i2g-bottom-bar card">
          <div className="bottom-bar-left">
            <label className="bottom-label">Line Width (mm)</label>
            <input
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={lineWidth}
              onChange={(e) => setLineWidth(Number(e.target.value))}
              className="number-input line-width-input"
            />
            <button
              className="btn btn-primary"
              onClick={handleCompile}
              disabled={!canCompile}
            >
              <Zap size={14} style={{ marginRight: 6 }} />
              Compile Job
            </button>
            {compileError && <span className="error-text" style={{ marginLeft: 8 }}>{compileError}</span>}
            {compileWarning && (
              <span style={{ color: 'rgba(255, 200, 0, 0.9)', fontSize: '11px' }}>
                ⚠ {compileWarning} line{compileWarning !== 1 ? 's' : ''} outside safe margin
              </span>
            )}
          </div>

          <div className="bottom-bar-preview">
            <GCodePreview lines={compiledGCode} bedW={bedW} bedH={bedH} softLimitMargin={settings.softLimitMargin ?? 10} />
          </div>

          <div className="bottom-bar-right">
            <span className="gcode-line-count">
              {compiledGCode.length > 0 ? `${compiledGCode.length} lines` : 'No G-Code'}
            </span>
            <button
              className="btn btn-secondary"
              onClick={handleSaveJob}
              disabled={compiledGCode.length === 0}
              title="Save G-code and send to jobs"
            >
              <Save size={14} style={{ marginRight: 6 }} />
              Save Job
            </button>
            <button
              className="btn btn-success"
              onClick={handleStart}
              disabled={!connected || compiledGCode.length === 0 || streaming}
            >
              <Play size={14} style={{ marginRight: 6 }} />
              Run Job
            </button>
          </div>
        </div>
```
with:
```jsx
        <div className="i2g-bottom-bar card">
          <div className="bottom-bar-left">
            <label className="bottom-label">Line Width (mm)</label>
            <input
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={lineWidth}
              onChange={(e) => setLineWidth(Number(e.target.value))}
              className="number-input line-width-input"
            />
            <button
              className="btn btn-primary"
              onClick={handleCompile}
              disabled={!canCompile}
            >
              <Zap size={14} style={{ marginRight: 6 }} />
              Compile Job
            </button>
            {compileError && <span className="error-text" style={{ marginLeft: 8 }}>{compileError}</span>}
          </div>

          <div className="bottom-bar-right">
            <span className="gcode-line-count">
              {compiledGCode.length > 0 ? `${compiledGCode.length} lines` : 'No G-Code'}
            </span>
            <button
              className="btn btn-secondary"
              onClick={handleSaveJob}
              disabled={compiledGCode.length === 0}
              title="Save G-code and send to jobs"
            >
              <Save size={14} style={{ marginRight: 6 }} />
              Save Job
            </button>
            <button
              className="btn btn-success"
              onClick={handleStart}
              disabled={!connected || compiledGCode.length === 0 || streaming}
            >
              <Play size={14} style={{ marginRight: 6 }} />
              Run Job
            </button>
          </div>
        </div>
```

(Note: the inline `compileWarning` readout that lived in `.bottom-bar-left` is removed — it now lives in the new "G-Code Outline" tab's `.outline-tab-info`, next to the line count, which is where the user goes to inspect the compiled result. `compileError` stays in the bottom bar since it's actionable from any tab.)

- [ ] **Step 5: Update `Image2GCodePage.css` — switch the bottom bar from a 3-column grid to 2-column flex, add outline-tab styles**

Replace the `.i2g-bottom-bar` rule (current lines 111-120):
```css
.i2g-bottom-bar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  flex-shrink: 0;
  border-top: 1px solid var(--border-color);
  border-radius: 0;
}
```
with:
```css
.i2g-bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  flex-shrink: 0;
  border-top: 1px solid var(--border-color);
  border-radius: 0;
}
```

Remove the now-unused `.bottom-bar-preview` rule (current lines 139-142):
```css
.bottom-bar-preview {
  display: flex;
  justify-content: center;
}

```

Add new rules for the outline tab directly after the `.svg-preview svg` rule (current lines 98-102, right before the `/* ── Drawer tab ── */` comment):
```css
/* ── Outline tab ────────────────────────────────────────────── */
.outline-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.5rem;
  gap: 1rem;
  box-sizing: border-box;
}

.outline-tab-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
  max-width: 640px;
}

.outline-tab-preview {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
  min-height: 0;
}
```

- [ ] **Step 6: Promote `GCodePreview` to full size**

`GCodePreview` is rendered in exactly one place after this change (the new "G-Code Outline" tab — confirm with `grep -rn "GCodePreview" Desktop_App/src`). Bump its bounding box from the cramped bottom-bar size to a size that fills a dedicated tab.

Replace line 8 of `Desktop_App/src/components/GCodePreview.jsx`:
```js
  const PREVIEW_MAX = 400;
```
with:
```js
  const PREVIEW_MAX = 560;
```

- [ ] **Step 7: Manual smoke test**

Run: `cd Desktop_App && npm run electron:dev`

(Use the Electron dev script, not plain `npm run dev` — "Run Job" needs `SerialContext`'s connection state and "Save Job" needs `window.platform`, both only available inside the Electron shell.)

In the running app, open Image to G-Code and confirm:
- Three tabs are visible: "Import & Trace", "Draw & Finalize", "G-Code Outline"
- The bottom bar (Line Width / Compile Job / Save Job / Run Job) stays visible and functional across all three tabs
- Trace or draw something, click "Compile Job", then switch to "G-Code Outline" — confirm the toolpath preview now renders large and centered, with the line count and any soft-limit warning shown above it
- Compile something that produces a soft-limit warning (e.g. draw near a bed edge) and confirm the warning appears in the "G-Code Outline" tab's info row, and `compileError` (e.g. compiling with nothing drawn) still surfaces in the bottom bar

- [ ] **Step 8: Commit**

```bash
git add "Desktop_App/src/pages/Image2GCodePage.jsx" "Desktop_App/src/pages/Image2GCodePage.css" "Desktop_App/src/components/GCodePreview.jsx"
git commit -m "feat(image2gcode): add dedicated G-Code Outline tab, promote GCodePreview to full size"
```

---

## Task 12: End-to-end manual verification

No new files. This task exercises the full feature set together using the sample images already in the repo (`Input Files/bitmap_1.png`, `Input Files/house.png`) to catch any integration issues the per-task smoke tests missed.

- [ ] **Step 1: Start the app**

Run: `cd Desktop_App && npm run electron:dev`

(Confirmed via `Desktop_App/package.json`: `"electron:dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\""` — this is the only script that launches the full Electron shell with `window.platform` available, needed for the Save Job and Run Job checks below.)

- [ ] **Step 2: Single-color tracing pipeline**

- Load `Input Files/house.png` in "Import & Trace" with Multicolor Mode **off**
- Drag the Threshold slider through a few values; confirm the "Threshold Preview" mask visibly changes and the traced result (after "Re-trace") matches the mask — no stray gray-background shapes
- Click "Open in Drawer", then "Compile Job" — switch to "G-Code Outline" and confirm the rendered toolpath visually matches the binarized silhouette, with smooth curved strokes (not jagged endpoint-only segments) where the source had curves

- [ ] **Step 3: Multicolor tracing pipeline**

- Load a colorful image, check "Multicolor Mode" — confirm the "Threshold Preview" panel disappears, "Colors" slider becomes active, and the Threshold slider becomes disabled
- Trace, open in drawer, compile — confirm the background (paper/canvas color) is correctly excluded from the G-code (no large filled background rectangle in the outline preview) even if it isn't pure white

- [ ] **Step 4: Dialogs**

- "Save Job": confirm the in-app prompt dialog appears, accepts a name, saves, and navigates to the G-Code Jobs page where the new job appears in "Loaded Jobs"
- "Delete All" in the Vector Drawer: confirm the in-app confirm dialog appears and both Cancel/Delete paths work

- [ ] **Step 5: Cross-cutting bottom bar**

- Confirm Line Width, Compile Job, Save Job, and Run Job all work identically regardless of which of the three tabs is active

- [ ] **Step 6: Fix any issues found, then final commit (only if changes were needed)**

If Steps 2-5 surface any bugs, fix them in the relevant file(s) and commit with a message describing the specific fix, e.g.:
```bash
git add <fixed files>
git commit -m "fix(image2gcode): <specific issue found during e2e verification>"
```

If no issues are found, no commit is needed for this task — verification alone is the deliverable.

---

## Self-Review Notes

- **Spec coverage:** Section 1 (Dialog) → Tasks 1-3. Section 2 (three-tab layout) → Task 11. Section 3a-3d (binarization, threshold control, forced palette, simplified background filter) → Tasks 6, 9, 10, 7. Section 3e (multicolor corner-sampled background) → Tasks 4, 9, 7, 11 (Step 1). Section 3f (curve tessellation) → Tasks 5, 7 (Step 2).
- **Placeholder scan:** No TBD/TODO markers; every step shows complete, runnable code or an exact verification procedure with concrete file names from the repo (`Input Files/bitmap_1.png`, `Input Files/house.png`).
- **Type/name consistency checked across tasks:** `tracerOptions.threshold` (Task 8) ↔ `setOpt('threshold', ...)` and `tracerOptions.threshold` reads (Task 10) ↔ `threshold` destructured in `useImageTracer.trace` (Task 9). `backgroundColor`/`setBackgroundColor` (Task 8 context) ↔ `setBackgroundColor` consumed in `ImageToGCodeTab` (Task 10) and `backgroundColor` read in `Image2GCodePage.handleCompile` (Task 11) ↔ `settings.backgroundColor` destructured in `compileSVGToGCode` (Task 7). `isBackgroundColor`/`isWhiteOrNone` exported from `colorMatch.js` (Task 4) ↔ imported in `gcodeCompiler.js` (Task 7, only `isBackgroundColor` is used — `isWhiteOrNone` is its internal fallback). `tessellateQuadratic`/`tessellateCubic` (Task 5) ↔ imported and called with `(prev, c1, end)` / `(prev, c1, c2, end)` argument order matching `(p0, p1, p2[, p3])` signatures (Task 7). `binarizeImageData`/`sampleCornerColor` (Task 6) ↔ imported in both `useImageTracer.js` (Task 9) and `ImageToGCodeTab.jsx` (Task 10, binarize only — for the live preview canvas).
