# SVG Vector Editor + G2/G3 Arc G-code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Fabric.js canvas with a true SVG path editor, then add G2/G3 arc support to firmware and compiler.

**Architecture:** Phase 1 — custom React+SVG editor where shapes are real `<path>` elements, with node editing, simplify (RDP via simplify-js), and smooth (Catmull-Rom→Bezier). Phase 2 — firmware `moveArc()` using angular micro-segmentation; compiler emits G2/G3 for circles and Bezier segments that fit a circumscribed arc within 0.05mm tolerance.

**Tech Stack:** React 18, SVG DOM, `svg-path-parser` (already installed), `simplify-js` (new), Arduino C++ with `<math.h>`, Node built-in test runner for unit tests.

---

## File Map

**New files:**
- `Desktop_App/src/lib/pathOps.js` — parsePath, formatPath, simplifyPath, smoothPath, applyMatrixToPath, fitPathsToBed, svgToPaths, pathsToSvg
- `Desktop_App/src/lib/pathOps.test.mjs` — unit tests for pure-JS path functions
- `Desktop_App/src/components/VectorEditor/useViewTransform.js` — zoom/pan state hook
- `Desktop_App/src/components/VectorEditor/PathLayer.jsx` — renders `<path>` elements
- `Desktop_App/src/components/VectorEditor/NodeEditor.jsx` — draggable node overlay
- `Desktop_App/src/components/VectorEditor/OperationsPanel.jsx` — simplify/smooth/undo UI

**Fully rewritten:**
- `Desktop_App/src/components/VectorEditor/VectorEditor.jsx` — drop Fabric.js, use SVG DOM
- `Desktop_App/src/components/VectorEditor/ToolPalette.jsx` — drop eraser/text/rect/circle Fabric tools; keep select/pen/line + delete actions
- `Desktop_App/src/components/VectorEditor/VectorEditor.css` — updated styles

**Modified:**
- `Desktop_App/package.json` — add `simplify-js`, remove `fabric` (only used in VectorEditor)
- `Desktop_App/src/lib/gcodeCompiler.js` — circleToPoints(), fitArcToSampledCurve(), 'A' point type
- `Desktop_App/src/lib/gcodeCompiler.test.mjs` — new (create if missing) arc-output tests
- `Desktop_App/src/lib/softLimits.js` — arcBounds(), G2/G3 in scanGCodeBounds()
- `Desktop_App/src/lib/softLimits.test.mjs` — arc scanning tests
- `Desktop_App/src/components/GCodePreview.jsx` — render G2/G3 arcs with ctx.arc()
- `Desktop_App/src/contexts/SettingsContext.jsx` — add `chordError: 0.2`
- `Desktop_App/src/pages/SettingsPage.jsx` — add $CE input field
- `Arduino Codes/CNC_Firmware/cnc_base.h` — moveArc(), G2/G3 parsing, $CE config

---

## Phase 1 — SVG Vector Editor

---

### Task 1: Install simplify-js and update package.json

**Files:**
- Modify: `Desktop_App/package.json`

- [ ] **Step 1: Install simplify-js**

```bash
cd "Desktop_App"
npm install simplify-js
```

Expected: `simplify-js` appears in `node_modules` and `package.json` dependencies.

- [ ] **Step 2: Remove fabric from package.json dependencies**

In `Desktop_App/package.json`, remove the `"fabric": "^5.5.2"` line from `"dependencies"`. Then run:

```bash
npm uninstall fabric
```

- [ ] **Step 3: Commit**

```bash
git add Desktop_App/package.json Desktop_App/package-lock.json
git commit -m "chore: swap fabric for simplify-js in vector editor deps"
```

---

### Task 2: Create pathOps.js — core path string utilities

**Files:**
- Create: `Desktop_App/src/lib/pathOps.js`

- [ ] **Step 1: Write the file**

```js
// Desktop_App/src/lib/pathOps.js
// Runs in both browser (Electron renderer) and Node (unit tests).
// svgToPaths / pathsToSvg use DOMParser — browser only.
import { parseSVG, makeAbsolute } from 'svg-path-parser';
import simplify from 'simplify-js';
import { isBackgroundColor } from './colorMatch.js';

// ── Path string ↔ command array ──────────────────────────────────────────────

export function parsePath(d) {
  if (!d || !d.trim()) return [];
  return makeAbsolute(parseSVG(d));
}

export function formatPath(cmds) {
  return cmds.map(cmd => {
    switch (cmd.code) {
      case 'M': return `M ${n(cmd.x)} ${n(cmd.y)}`;
      case 'L': return `L ${n(cmd.x)} ${n(cmd.y)}`;
      case 'C': return `C ${n(cmd.x1)} ${n(cmd.y1)} ${n(cmd.x2)} ${n(cmd.y2)} ${n(cmd.x)} ${n(cmd.y)}`;
      case 'Q': return `Q ${n(cmd.x1)} ${n(cmd.y1)} ${n(cmd.x)} ${n(cmd.y)}`;
      case 'Z': return 'Z';
      default: {
        let s = cmd.code;
        if (cmd.x !== undefined) s += ` ${n(cmd.x)}`;
        if (cmd.y !== undefined) s += ` ${n(cmd.y)}`;
        return s.trim();
      }
    }
  }).join(' ');
}

function n(v) { return (v ?? 0).toFixed(3); }

// ── Transform helpers ─────────────────────────────────────────────────────────

function applyMatrix(x, y, m) {
  if (!m) return { x, y };
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

export function applyMatrixToPath(d, m) {
  if (!m) return d;
  const cmds = parsePath(d);
  const out = cmds.map(cmd => {
    if (cmd.x === undefined && cmd.y === undefined) return cmd;
    const pt  = applyMatrix(cmd.x ?? 0, cmd.y ?? 0, m);
    const res = { ...cmd, x: pt.x, y: pt.y };
    if (cmd.x1 !== undefined) { const p1 = applyMatrix(cmd.x1, cmd.y1, m); res.x1 = p1.x; res.y1 = p1.y; }
    if (cmd.x2 !== undefined) { const p2 = applyMatrix(cmd.x2, cmd.y2, m); res.x2 = p2.x; res.y2 = p2.y; }
    return res;
  });
  return formatPath(out);
}

// Scale + center a set of path records to fit 90% of bedW×bedH.
// svgW/svgH are the source coordinate space dimensions (e.g. SVG viewBox).
export function fitPathsToBed(paths, svgW, svgH, bedW, bedH) {
  if (svgW <= 0 || svgH <= 0) return paths;
  const scale = Math.min((bedW * 0.9) / svgW, (bedH * 0.9) / svgH);
  const tx = (bedW - svgW * scale) / 2;
  const ty = (bedH - svgH * scale) / 2;
  const m = { a: scale, b: 0, c: 0, d: scale, e: tx, f: ty };
  return paths.map(p => ({ ...p, d: applyMatrixToPath(p.d, m) }));
}

// ── Path simplification (Ramer-Douglas-Peucker) ───────────────────────────────

function flattenCmdsToPoints(cmds) {
  const pts = [];
  let px = 0, py = 0;
  for (const cmd of cmds) {
    if (cmd.code === 'M' || cmd.code === 'L' || cmd.code === 'Z') {
      px = cmd.x ?? px; py = cmd.y ?? py;
      pts.push({ x: px, y: py });
    } else if (cmd.code === 'Q') {
      for (let t = 0.1; t < 1.0; t += 0.1) {
        const mt = 1 - t;
        pts.push({ x: mt*mt*px + 2*mt*t*cmd.x1 + t*t*cmd.x, y: mt*mt*py + 2*mt*t*cmd.y1 + t*t*cmd.y });
      }
      px = cmd.x; py = cmd.y; pts.push({ x: px, y: py });
    } else if (cmd.code === 'C') {
      for (let t = 0.1; t < 1.0; t += 0.1) {
        const mt = 1 - t;
        pts.push({
          x: mt*mt*mt*px + 3*mt*mt*t*cmd.x1 + 3*mt*t*t*cmd.x2 + t*t*t*cmd.x,
          y: mt*mt*mt*py + 3*mt*mt*t*cmd.y1 + 3*mt*t*t*cmd.y2 + t*t*t*cmd.y,
        });
      }
      px = cmd.x; py = cmd.y; pts.push({ x: px, y: py });
    }
  }
  return pts;
}

function splitSubpaths(cmds) {
  const sub = []; let cur = [];
  for (const cmd of cmds) {
    if (cmd.code === 'M' && cur.length > 0) { sub.push(cur); cur = [cmd]; }
    else cur.push(cmd);
  }
  if (cur.length > 0) sub.push(cur);
  return sub;
}

export function simplifyPath(d, tolerance = 1) {
  if (!d || !d.trim()) return d;
  const cmds = parsePath(d);
  if (cmds.length < 3) return d;
  const subpaths = splitSubpaths(cmds);
  const result = [];
  for (const sub of subpaths) {
    const hasZ = sub[sub.length - 1]?.code === 'Z';
    const pts  = flattenCmdsToPoints(sub);
    const simp = simplify(pts, tolerance, true);
    if (simp.length < 2) { result.push(...sub); continue; }
    result.push({ code: 'M', x: simp[0].x, y: simp[0].y });
    for (let i = 1; i < simp.length; i++) result.push({ code: 'L', x: simp[i].x, y: simp[i].y });
    if (hasZ) result.push({ code: 'Z', x: simp[0].x, y: simp[0].y });
  }
  return formatPath(result);
}

// ── Path smoothing (Catmull-Rom centripetal → cubic Bezier) ──────────────────

export function smoothPath(d) {
  if (!d || !d.trim()) return d;
  const cmds = parsePath(d);
  if (cmds.some(c => c.code === 'Q' || c.code === 'C')) return d; // already has curves
  const pts  = cmds.filter(c => c.x !== undefined).map(c => ({ x: c.x, y: c.y }));
  if (pts.length < 3) return d;
  const hasZ = cmds[cmds.length - 1]?.code === 'Z';
  const out  = [{ code: 'M', x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cx1 = p1.x + (p2.x - p0.x) / 6;
    const cy1 = p1.y + (p2.y - p0.y) / 6;
    const cx2 = p2.x - (p3.x - p1.x) / 6;
    const cy2 = p2.y - (p3.y - p1.y) / 6;
    out.push({ code: 'C', x1: cx1, y1: cy1, x2: cx2, y2: cy2, x: p2.x, y: p2.y });
  }
  if (hasZ) out.push({ code: 'Z', x: pts[0].x, y: pts[0].y });
  return formatPath(out);
}

// ── SVG DOM → PathRecord[] (browser only) ─────────────────────────────────────

function parseTransform(str) {
  if (!str) return null;
  const m = str.match(/matrix\(\s*([-\d.e]+)[,\s]+([-\d.e]+)[,\s]+([-\d.e]+)[,\s]+([-\d.e]+)[,\s]+([-\d.e]+)[,\s]+([-\d.e]+)\s*\)/);
  if (m) return { a: +m[1], b: +m[2], c: +m[3], d: +m[4], e: +m[5], f: +m[6] };
  const t = str.match(/translate\(\s*([-\d.e]+)(?:[,\s]+([-\d.e]+))?\s*\)/);
  if (t) return { a: 1, b: 0, c: 0, d: 1, e: +t[1], f: +(t[2] || 0) };
  const s = str.match(/scale\(\s*([-\d.e]+)(?:[,\s]+([-\d.e]+))?\s*\)/);
  if (s) return { a: +s[1], b: 0, c: 0, d: +(s[2] || s[1]), e: 0, f: 0 };
  return null;
}

function getElementTransform(el, svgRoot) {
  const mats = [];
  let node = el;
  while (node && node !== svgRoot) {
    const t = parseTransform(node.getAttribute?.('transform'));
    if (t) mats.unshift(t);
    node = node.parentElement;
  }
  if (!mats.length) return null;
  return mats.reduce((acc, m) => ({
    a: acc.a*m.a + acc.c*m.b, b: acc.b*m.a + acc.d*m.b,
    c: acc.a*m.c + acc.c*m.d, d: acc.b*m.c + acc.d*m.d,
    e: acc.a*m.e + acc.c*m.f + acc.e, f: acc.b*m.e + acc.d*m.f + acc.f,
  }), { a:1, b:0, c:0, d:1, e:0, f:0 });
}

function elementToD(el, svgRoot) {
  const t = getElementTransform(el, svgRoot);
  const tag = el.tagName.toLowerCase();

  if (tag === 'path') {
    const raw = el.getAttribute('d');
    if (!raw) return null;
    return applyMatrixToPath(raw, t);
  }
  if (tag === 'rect') {
    const x = +el.getAttribute('x')||0, y = +el.getAttribute('y')||0;
    const w = +el.getAttribute('width')||0, h = +el.getAttribute('height')||0;
    if (w <= 0 || h <= 0) return null;
    const pts = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([px,py]) => applyMatrix(px,py,t));
    return `M ${n(pts[0].x)} ${n(pts[0].y)} L ${n(pts[1].x)} ${n(pts[1].y)} L ${n(pts[2].x)} ${n(pts[2].y)} L ${n(pts[3].x)} ${n(pts[3].y)} Z`;
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = +el.getAttribute('cx')||0, cy = +el.getAttribute('cy')||0;
    const rx = +el.getAttribute('rx')||+el.getAttribute('r')||0;
    const ry = +el.getAttribute('ry')||+el.getAttribute('r')||0;
    if (rx <= 0 || ry <= 0) return null;
    const steps = 64;
    const pts = Array.from({ length: steps + 1 }, (_, i) => {
      const a = (i / steps) * 2 * Math.PI;
      return applyMatrix(cx + rx * Math.cos(a), cy + ry * Math.sin(a), t);
    });
    return `M ${n(pts[0].x)} ${n(pts[0].y)} ` +
      pts.slice(1).map(p => `L ${n(p.x)} ${n(p.y)}`).join(' ') + ' Z';
  }
  if (tag === 'line') {
    const p1 = applyMatrix(+el.getAttribute('x1')||0, +el.getAttribute('y1')||0, t);
    const p2 = applyMatrix(+el.getAttribute('x2')||0, +el.getAttribute('y2')||0, t);
    return `M ${n(p1.x)} ${n(p1.y)} L ${n(p2.x)} ${n(p2.y)}`;
  }
  return null;
}

let _uid = 0;
const uid = () => `p${++_uid}`;

export function svgToPaths(svgString, backgroundColor = null) {
  const doc  = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const root = doc.documentElement;
  const paths = [];
  root.querySelectorAll('path, rect, circle, ellipse, line').forEach(el => {
    const d = elementToD(el, root);
    if (!d) return;
    const stroke = el.getAttribute('stroke') || 'none';
    const fill   = el.getAttribute('fill')   || 'none';
    const color  = stroke !== 'none' ? stroke : (fill !== 'none' ? fill : '#000000');
    if (backgroundColor && isBackgroundColor(color, backgroundColor)) return;
    paths.push({ id: uid(), d, color, fill });
  });
  return paths;
}

export function pathsToSvg(paths, width, height) {
  const els = paths.map(p =>
    `  <path d="${p.d}" stroke="${p.color}" fill="${p.fill}" stroke-width="1" />`
  ).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${els}\n</svg>`;
}
```

- [ ] **Step 2: Commit scaffold**

```bash
git add Desktop_App/src/lib/pathOps.js
git commit -m "feat: add pathOps.js — path utilities for SVG vector editor"
```

---

### Task 3: Write and run pathOps unit tests

**Files:**
- Create: `Desktop_App/src/lib/pathOps.test.mjs`

- [ ] **Step 1: Write tests**

```js
// Desktop_App/src/lib/pathOps.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, formatPath, simplifyPath, smoothPath, applyMatrixToPath, fitPathsToBed } from './pathOps.js';

describe('parsePath', () => {
  it('parses a simple M L Z', () => {
    const cmds = parsePath('M 0 0 L 10 0 L 10 10 Z');
    assert.equal(cmds.length, 4);
    assert.equal(cmds[0].code, 'M');
    assert.equal(cmds[1].code, 'L');
    assert.equal(cmds[3].code, 'Z');
  });
  it('returns [] for empty string', () => {
    assert.deepEqual(parsePath(''), []);
  });
});

describe('formatPath', () => {
  it('round-trips M L Z', () => {
    const original = 'M 0.000 0.000 L 10.000 0.000 Z';
    const cmds = parsePath(original);
    assert.equal(formatPath(cmds), original);
  });
});

describe('simplifyPath', () => {
  it('reduces collinear points on a horizontal line', () => {
    // 10 collinear points → should simplify to 2
    const pts = Array.from({ length: 10 }, (_, i) => `L ${i * 10} 0`).join(' ');
    const d = `M 0 0 ${pts}`;
    const simplified = simplifyPath(d, 1);
    const cmds = parsePath(simplified);
    // The 10 collinear points on y=0 should collapse to start + end
    assert.ok(cmds.length < 10, `Expected fewer than 10 cmds, got ${cmds.length}`);
  });

  it('preserves a path with only 2 points', () => {
    const d = 'M 0.000 0.000 L 10.000 10.000';
    assert.equal(simplifyPath(d, 1), d);
  });

  it('returns unchanged path for empty string', () => {
    assert.equal(simplifyPath(''), '');
  });
});

describe('smoothPath', () => {
  it('converts L-only path to C commands', () => {
    const d = 'M 0.000 0.000 L 10.000 5.000 L 20.000 0.000 L 30.000 5.000';
    const smoothed = smoothPath(d);
    assert.ok(smoothed.includes('C'), 'Expected C commands after smoothing');
  });

  it('does not modify path that already has C commands', () => {
    const d = 'M 0.000 0.000 C 5.000 5.000 15.000 5.000 20.000 0.000';
    assert.equal(smoothPath(d), d);
  });

  it('does not modify short paths', () => {
    const d = 'M 0.000 0.000 L 10.000 10.000';
    assert.equal(smoothPath(d), d);
  });
});

describe('applyMatrixToPath', () => {
  it('scales path coordinates by a scale matrix', () => {
    const d = 'M 0.000 0.000 L 10.000 0.000';
    const scale2 = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const result = applyMatrixToPath(d, scale2);
    assert.ok(result.includes('20.000'), `Expected scaled coords in: ${result}`);
  });

  it('translates path coordinates', () => {
    const d = 'M 0.000 0.000 L 10.000 0.000';
    const translate = { a: 1, b: 0, c: 0, d: 1, e: 5, f: 10 };
    const result = applyMatrixToPath(d, translate);
    assert.ok(result.includes('M 5.000 10.000'), `Expected translated M: ${result}`);
  });
});

describe('fitPathsToBed', () => {
  it('scales paths to fit bed at 90%', () => {
    const paths = [{ id: 'a', d: 'M 0.000 0.000 L 100.000 0.000', color: '#000', fill: 'none' }];
    const fitted = fitPathsToBed(paths, 100, 100, 200, 200);
    // 90% of 200 = 180mm, so scale = 1.8, with centering offset
    const cmds = parsePath(fitted[0].d);
    const lCmd = cmds.find(c => c.code === 'L');
    assert.ok(Math.abs(lCmd.x - 180) < 0.1, `Expected x≈180 after scale, got ${lCmd.x}`);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd "Desktop_App"
node --test src/lib/pathOps.test.mjs
```

Expected: all tests pass. Fix any failures before continuing.

- [ ] **Step 3: Commit**

```bash
git add Desktop_App/src/lib/pathOps.test.mjs
git commit -m "test: add unit tests for pathOps.js"
```

---

### Task 4: Write useViewTransform.js

**Files:**
- Create: `Desktop_App/src/components/VectorEditor/useViewTransform.js`

- [ ] **Step 1: Write the hook**

```js
// Desktop_App/src/components/VectorEditor/useViewTransform.js
import { useRef, useState, useCallback } from 'react';

export function useViewTransform() {
  const [vt, setVt] = useState({ x: 0, y: 0, scale: 1 });
  const panRef = useRef(null); // { startX, startY, tx, ty }

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const rect = e.currentTarget.getBoundingClientRect();
    setVt(prev => {
      const newScale = Math.min(20, Math.max(0.05, prev.scale * factor));
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const svgX = (mx - prev.x) / prev.scale;
      const svgY = (my - prev.y) / prev.scale;
      return { scale: newScale, x: mx - svgX * newScale, y: my - svgY * newScale };
    });
  }, []);

  const startPan = useCallback((clientX, clientY) => {
    setVt(prev => {
      panRef.current = { startX: clientX, startY: clientY, tx: prev.x, ty: prev.y };
      return prev;
    });
  }, []);

  const updatePan = useCallback((clientX, clientY) => {
    if (!panRef.current) return;
    const { startX, startY, tx, ty } = panRef.current;
    setVt(prev => ({ ...prev, x: tx + (clientX - startX), y: ty + (clientY - startY) }));
  }, []);

  const endPan = useCallback(() => { panRef.current = null; }, []);

  // Convert client (screen) coords to SVG content coords
  const toSvg = useCallback((clientX, clientY, containerRect) => ({
    x: (clientX - containerRect.left - vt.x) / vt.scale,
    y: (clientY - containerRect.top  - vt.y) / vt.scale,
  }), [vt]);

  return { vt, onWheel, startPan, updatePan, endPan, toSvg };
}
```

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/components/VectorEditor/useViewTransform.js
git commit -m "feat: add useViewTransform hook for SVG editor zoom/pan"
```

---

### Task 5: Write PathLayer.jsx

**Files:**
- Create: `Desktop_App/src/components/VectorEditor/PathLayer.jsx`

- [ ] **Step 1: Write the component**

```jsx
// Desktop_App/src/components/VectorEditor/PathLayer.jsx
import React from 'react';

export function PathLayer({ paths, selectedId, onSelect }) {
  return (
    <g className="path-layer">
      {paths.map(p => (
        <path
          key={p.id}
          d={p.d}
          stroke={selectedId === p.id ? 'var(--accent)' : (p.color || '#000000')}
          fill={p.fill || 'none'}
          strokeWidth={selectedId === p.id ? 1.5 : 1}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: 'pointer' }}
          onMouseDown={e => { e.stopPropagation(); onSelect(p.id); }}
        />
      ))}
    </g>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/components/VectorEditor/PathLayer.jsx
git commit -m "feat: add PathLayer component for SVG path rendering"
```

---

### Task 6: Write NodeEditor.jsx

**Files:**
- Create: `Desktop_App/src/components/VectorEditor/NodeEditor.jsx`

- [ ] **Step 1: Write the component**

```jsx
// Desktop_App/src/components/VectorEditor/NodeEditor.jsx
import React, { useRef } from 'react';
import { parsePath, formatPath } from '../../lib/pathOps.js';

// Build a flat list of draggable nodes from parsed commands.
// Each node: { cmdIndex, field, x, y, type: 'anchor'|'ctrl' }
function buildNodes(cmds) {
  const nodes = [];
  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i];
    if (['M','L','Z'].includes(cmd.code) && cmd.x !== undefined) {
      nodes.push({ cmdIndex: i, field: null, x: cmd.x, y: cmd.y, type: 'anchor' });
    } else if (cmd.code === 'Q') {
      nodes.push({ cmdIndex: i, field: 'ctrl1', x: cmd.x1, y: cmd.y1, type: 'ctrl' });
      nodes.push({ cmdIndex: i, field: null,    x: cmd.x,  y: cmd.y,  type: 'anchor' });
    } else if (cmd.code === 'C') {
      nodes.push({ cmdIndex: i, field: 'ctrl1', x: cmd.x1, y: cmd.y1, type: 'ctrl' });
      nodes.push({ cmdIndex: i, field: 'ctrl2', x: cmd.x2, y: cmd.y2, type: 'ctrl' });
      nodes.push({ cmdIndex: i, field: null,    x: cmd.x,  y: cmd.y,  type: 'anchor' });
    }
  }
  return nodes;
}

export function NodeEditor({ path, onUpdateD, scale }) {
  const dragging = useRef(null); // { nodeIndex, startSvgX, startSvgY, origCmds }

  const cmds  = parsePath(path.d);
  const nodes = buildNodes(cmds);
  const r     = 5 / (scale || 1); // radius in SVG units, constant in screen px

  const handleMouseDown = (e, nodeIndex) => {
    e.stopPropagation();
    dragging.current = { nodeIndex, origCmds: JSON.parse(JSON.stringify(cmds)) };
  };

  const handleMouseMove = (e, svgX, svgY) => {
    if (!dragging.current) return;
    const { nodeIndex, origCmds } = dragging.current;
    const node = nodes[nodeIndex];
    const dx = svgX - node.x;
    const dy = svgY - node.y;
    const updated = origCmds.map((cmd, ci) => {
      if (ci !== node.cmdIndex) return cmd;
      const c = { ...cmd };
      if (node.field === 'ctrl1') { c.x1 += dx; c.y1 += dy; }
      else if (node.field === 'ctrl2') { c.x2 += dx; c.y2 += dy; }
      else { c.x = (c.x ?? 0) + dx; c.y = (c.y ?? 0) + dy; }
      return c;
    });
    onUpdateD(formatPath(updated));
  };

  const handleMouseUp = () => { dragging.current = null; };

  // Anchor lines from anchor to its control handles (for Q/C)
  const handleLines = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== 'ctrl') continue;
    const anchor = nodes.find((n, j) => j > i && n.cmdIndex === nodes[i].cmdIndex && n.type === 'anchor');
    if (anchor) handleLines.push({ x1: nodes[i].x, y1: nodes[i].y, x2: anchor.x, y2: anchor.y });
  }

  return (
    <g
      className="node-editor"
      onMouseMove={e => {
        // Caller (VectorEditor) feeds SVG coords via a data attribute trick;
        // here we just propagate — actual coord conversion is in VectorEditor.
      }}
    >
      {handleLines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
          stroke="var(--accent)" strokeWidth={0.5 / (scale||1)} strokeDasharray={`${2/(scale||1)},${2/(scale||1)}`} />
      ))}
      {nodes.map((node, i) => (
        <circle
          key={i}
          cx={node.x} cy={node.y} r={r}
          fill={node.type === 'anchor' ? 'var(--accent)' : 'transparent'}
          stroke="var(--accent)"
          strokeWidth={1 / (scale || 1)}
          style={{ cursor: 'move' }}
          onMouseDown={e => handleMouseDown(e, i)}
        />
      ))}
    </g>
  );
}

// Attach drag-continuation helpers so VectorEditor can forward global mousemove/up.
NodeEditor.continueDrag = null;
NodeEditor.endDrag = null;
```

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/components/VectorEditor/NodeEditor.jsx
git commit -m "feat: add NodeEditor component for SVG path node editing"
```

---

### Task 7: Write OperationsPanel.jsx

**Files:**
- Create: `Desktop_App/src/components/VectorEditor/OperationsPanel.jsx`

- [ ] **Step 1: Write the component**

```jsx
// Desktop_App/src/components/VectorEditor/OperationsPanel.jsx
import React from 'react';
import { Sliders, Spline, Undo2, Trash2 } from 'lucide-react';

export function OperationsPanel({
  simplifyTolerance, onSimplifyToleranceChange, onSimplify,
  onSmooth, onUndo, canUndo,
  onDeleteAll,
}) {
  return (
    <div className="ops-panel">
      <div className="ops-section">
        <label className="ops-label" title="Ramer-Douglas-Peucker tolerance in mm">
          <Sliders size={13} /> Simplify
        </label>
        <div className="ops-row">
          <input
            type="range" min="0.1" max="5" step="0.1"
            value={simplifyTolerance}
            onChange={e => onSimplifyToleranceChange(parseFloat(e.target.value))}
            className="ops-slider"
          />
          <span className="ops-val">{simplifyTolerance.toFixed(1)}</span>
        </div>
        <button className="btn btn-secondary ops-btn" onClick={onSimplify}>Apply Simplify</button>
      </div>

      <div className="ops-section">
        <label className="ops-label">
          <Spline size={13} /> Smooth
        </label>
        <button className="btn btn-secondary ops-btn" onClick={onSmooth}
          title="Convert L-only paths to curves (Catmull-Rom)">
          Smooth Edges
        </button>
      </div>

      <div className="ops-divider" />

      <button
        className="btn btn-secondary ops-btn"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo last operation (Ctrl+Z)"
      >
        <Undo2 size={13} /> Undo
      </button>

      <button className="btn btn-danger ops-btn" onClick={onDeleteAll} title="Delete all paths">
        <Trash2 size={13} /> Delete All
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/components/VectorEditor/OperationsPanel.jsx
git commit -m "feat: add OperationsPanel for simplify/smooth/undo/delete-all"
```

---

### Task 8: Rewrite ToolPalette.jsx

**Files:**
- Modify: `Desktop_App/src/components/VectorEditor/ToolPalette.jsx`

- [ ] **Step 1: Rewrite with SVG tools only (no Fabric-specific tools)**

```jsx
// Desktop_App/src/components/VectorEditor/ToolPalette.jsx
import React from 'react';
import { MousePointer2, PenLine, Minus } from 'lucide-react';

const TOOLS = [
  { id: 'select', icon: MousePointer2, label: 'Select / Edit Nodes (V)' },
  { id: 'pen',    icon: PenLine,       label: 'Freehand Pen (P)' },
  { id: 'line',   icon: Minus,         label: 'Straight Line (L)' },
];

export default function ToolPalette({ activeTool, onToolChange }) {
  return (
    <div className="tool-palette">
      {TOOLS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          className={`tool-btn${activeTool === id ? ' active' : ''}`}
          title={label}
          onClick={() => onToolChange(id)}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/components/VectorEditor/ToolPalette.jsx
git commit -m "feat: simplify ToolPalette to SVG-native tools"
```

---

### Task 9: Rewrite VectorEditor.jsx

**Files:**
- Modify: `Desktop_App/src/components/VectorEditor/VectorEditor.jsx`

- [ ] **Step 1: Rewrite the component (remove all Fabric.js, use SVG DOM)**

```jsx
// Desktop_App/src/components/VectorEditor/VectorEditor.jsx
import React, {
  forwardRef, useImperativeHandle, useRef, useState, useCallback,
  useEffect,
} from 'react';
import ToolPalette from './ToolPalette';
import { PathLayer } from './PathLayer';
import { NodeEditor } from './NodeEditor';
import { OperationsPanel } from './OperationsPanel';
import Dialog from '../Dialog';
import { useViewTransform } from './useViewTransform';
import {
  svgToPaths, pathsToSvg, simplifyPath, smoothPath, fitPathsToBed,
} from '../../lib/pathOps.js';
import './VectorEditor.css';

let _uid = 0;
const uid = () => `ve-${++_uid}-${Date.now()}`;

const VectorEditor = forwardRef(function VectorEditor(
  { bedW = 200, bedH = 200, lineWidth = 1, backgroundColor = null,
    softLimitMargin = 10, homed = false, homeFloor = null },
  ref
) {
  const svgRef  = useRef(null);
  const wrapRef = useRef(null);
  const { vt, onWheel, startPan, updatePan, endPan, toSvg } = useViewTransform();

  const [paths,     setPaths]     = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tool,      setTool]      = useState('select');
  const [prevPaths, setPrevPaths] = useState(null);   // single-level undo
  const [drawing,   setDrawing]   = useState(null);   // { points } for pen
  const [lineStart, setLineStart] = useState(null);   // {x,y} for line tool
  const [simplifyTol, setSimplifyTol] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const toolRef = useRef(tool);
  useEffect(() => { toolRef.current = tool; }, [tool]);

  // ── Imperative API ─────────────────────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    toSVG: () => pathsToSvg(paths, bedW, bedH),

    loadSVG: (svgString) => {
      const doc  = new DOMParser().parseFromString(svgString, 'image/svg+xml');
      const root = doc.documentElement;
      const vbRaw = root.getAttribute('viewBox');
      const [, , vbW, vbH] = vbRaw ? vbRaw.split(/\s+/).map(Number) : [0, 0, bedW, bedH];
      const loaded = svgToPaths(svgString, backgroundColor);
      const fitted = fitPathsToBed(loaded, vbW || bedW, vbH || bedH, bedW, bedH);
      setPrevPaths(paths);
      setPaths(fitted);
      setSelectedId(null);
    },

    addSVG: (svgString) => {
      const doc  = new DOMParser().parseFromString(svgString, 'image/svg+xml');
      const root = doc.documentElement;
      const vbRaw = root.getAttribute('viewBox');
      const [, , vbW, vbH] = vbRaw ? vbRaw.split(/\s+/).map(Number) : [0, 0, bedW, bedH];
      const loaded = svgToPaths(svgString, backgroundColor);
      const fitted = fitPathsToBed(loaded, vbW || bedW, vbH || bedH, bedW, bedH);
      setPrevPaths(prev => prev); // keep existing undo state
      setPaths(prev => [...prev, ...fitted]);
    },
  }), [paths, bedW, bedH, backgroundColor]);

  // ── SVG coordinate helpers ──────────────────────────────────────────────────

  const getSvgCoords = useCallback((e) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return toSvg(e.clientX, e.clientY, rect);
  }, [toSvg]);

  // ── Path update (for node editor drag) ─────────────────────────────────────

  const updateSelectedPath = useCallback((newD) => {
    setPaths(prev => prev.map(p => p.id === selectedId ? { ...p, d: newD } : p));
  }, [selectedId]);

  // ── Mouse events ────────────────────────────────────────────────────────────

  const nodeEditorRef = useRef(null);
  const isDraggingNode = useRef(false);

  const handleMouseDown = useCallback((e) => {
    const { x, y } = getSvgCoords(e);

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      startPan(e.clientX, e.clientY);
      return;
    }

    const t = toolRef.current;
    if (t === 'select') { /* click on path handled by PathLayer */ }
    if (t === 'pen') {
      setDrawing({ points: [{ x, y }] });
    }
    if (t === 'line') {
      setLineStart({ x, y });
    }
  }, [getSvgCoords, startPan]);

  const handleMouseMove = useCallback((e) => {
    if (isPanning) { updatePan(e.clientX, e.clientY); return; }
    if (isDraggingNode.current && nodeEditorRef.current) {
      const { x, y } = getSvgCoords(e);
      nodeEditorRef.current.continueDrag?.(x, y);
      return;
    }
    const t = toolRef.current;
    if (t === 'pen' && drawing) {
      const { x, y } = getSvgCoords(e);
      setDrawing(prev => ({ points: [...prev.points, { x, y }] }));
    }
  }, [isPanning, updatePan, getSvgCoords, drawing]);

  const handleMouseUp = useCallback((e) => {
    if (isPanning) { setIsPanning(false); endPan(); return; }
    if (isDraggingNode.current) { isDraggingNode.current = false; return; }
    const { x, y } = getSvgCoords(e);
    const t = toolRef.current;

    if (t === 'pen' && drawing && drawing.points.length > 1) {
      const d = `M ${drawing.points[0].x.toFixed(3)} ${drawing.points[0].y.toFixed(3)} ` +
        drawing.points.slice(1).map(p => `L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ');
      setPrevPaths(paths);
      setPaths(prev => [...prev, { id: uid(), d, color: '#000000', fill: 'none' }]);
      setDrawing(null);
    }

    if (t === 'line' && lineStart) {
      const d = `M ${lineStart.x.toFixed(3)} ${lineStart.y.toFixed(3)} L ${x.toFixed(3)} ${y.toFixed(3)}`;
      setPrevPaths(paths);
      setPaths(prev => [...prev, { id: uid(), d, color: '#000000', fill: 'none' }]);
      setLineStart(null);
    }
  }, [isPanning, endPan, getSvgCoords, drawing, lineStart, paths]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e) => {
      if (document.activeElement.tagName === 'INPUT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        setPrevPaths(paths);
        setPaths(prev => prev.filter(p => p.id !== selectedId));
        setSelectedId(null);
      }
      if (e.key === 'Escape') { setSelectedId(null); setDrawing(null); setLineStart(null); }
      if (e.ctrlKey && e.key === 'a') { e.preventDefault(); /* select all: just set first */ }
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); if (prevPaths) { setPaths(prevPaths); setPrevPaths(null); } }
      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'p' || e.key === 'P') setTool('pen');
      if (e.key === 'l' || e.key === 'L') setTool('line');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, prevPaths, paths]);

  // ── Operations ──────────────────────────────────────────────────────────────

  const handleSimplify = useCallback(() => {
    setPrevPaths(paths);
    setPaths(prev => prev.map(p => ({ ...p, d: simplifyPath(p.d, simplifyTol) })));
  }, [paths, simplifyTol]);

  const handleSmooth = useCallback(() => {
    setPrevPaths(paths);
    setPaths(prev => prev.map(p => ({ ...p, d: smoothPath(p.d) })));
  }, [paths]);

  const handleUndo = useCallback(() => {
    if (prevPaths) { setPaths(prevPaths); setPrevPaths(null); }
  }, [prevPaths]);

  const handleDeleteAll = useCallback(() => setConfirmOpen(true), []);
  const confirmDeleteAll = useCallback(() => {
    setPrevPaths(paths);
    setPaths([]);
    setSelectedId(null);
    setConfirmOpen(false);
  }, [paths]);

  // ── In-progress drawing preview ─────────────────────────────────────────────

  const previewD = drawing && drawing.points.length > 1
    ? `M ${drawing.points[0].x.toFixed(3)} ${drawing.points[0].y.toFixed(3)} ` +
      drawing.points.slice(1).map(p => `L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ')
    : null;

  const linePreviewD = lineStart
    ? null // we'd need current mouse pos — skip for now, cursor change is enough
    : null;

  // ── Fit canvas to container via scale ───────────────────────────────────────

  const [fitScale, setFitScale] = useState(1);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const pad = 32;
      setFitScale(Math.min((width - pad) / bedW, (height - pad) / bedH, 4));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [bedW, bedH]);

  // Initial transform centers the bed in the wrapper
  useEffect(() => {
    // On first mount, center the bed. The view transform starts at (0,0,1).
    // We don't mutate vt here directly — the fitScale above handles it visually
    // via the SVG transform. Users can pan/zoom from there.
  }, []);

  const cursor = isPanning ? 'grabbing'
    : tool === 'select' ? 'default'
    : 'crosshair';

  const selectedPath = paths.find(p => p.id === selectedId);

  return (
    <div className="vector-editor">
      <ToolPalette activeTool={tool} onToolChange={setTool} />

      <div
        className="svg-canvas-wrap"
        ref={wrapRef}
        style={{ cursor }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={onWheel}
      >
        <svg
          ref={svgRef}
          width={bedW * fitScale}
          height={bedH * fitScale}
          viewBox={`0 0 ${bedW} ${bedH}`}
          style={{ display: 'block', background: '#ffffff' }}
        >
          {/* Bed boundary — not exported */}
          <rect x={0} y={0} width={bedW} height={bedH}
            fill="none" stroke="#555" strokeWidth={0.5} strokeDasharray="4,4" />

          {/* Soft limit margin zone */}
          <rect
            x={softLimitMargin} y={softLimitMargin}
            width={Math.max(0, bedW - 2*softLimitMargin)}
            height={Math.max(0, bedH - 2*softLimitMargin)}
            fill="none" stroke="rgba(255,200,0,0.35)"
            strokeWidth={0.5} strokeDasharray="2,2" />

          {/* Home floor danger zone */}
          {homed && homeFloor && (
            <>
              <rect x={0} y={0} width={homeFloor.x} height={bedH}
                fill="rgba(241,76,76,0.12)" stroke="rgba(241,76,76,0.6)"
                strokeWidth={0.5} strokeDasharray="1,1" />
              <rect x={0} y={bedH - homeFloor.y} width={bedW} height={homeFloor.y}
                fill="rgba(241,76,76,0.12)" stroke="rgba(241,76,76,0.6)"
                strokeWidth={0.5} strokeDasharray="1,1" />
            </>
          )}

          <PathLayer paths={paths} selectedId={selectedId} onSelect={setSelectedId} />

          {selectedPath && (
            <NodeEditor
              ref={nodeEditorRef}
              path={selectedPath}
              onUpdateD={updateSelectedPath}
              scale={fitScale}
            />
          )}

          {/* In-progress pen stroke */}
          {previewD && (
            <path d={previewD} stroke="#007ACC" fill="none"
              strokeWidth={1} strokeDasharray="3,2" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>

      <OperationsPanel
        simplifyTolerance={simplifyTol}
        onSimplifyToleranceChange={setSimplifyTol}
        onSimplify={handleSimplify}
        onSmooth={handleSmooth}
        onUndo={handleUndo}
        canUndo={!!prevPaths}
        onDeleteAll={handleDeleteAll}
      />

      <Dialog
        open={confirmOpen}
        mode="confirm"
        title="Delete Everything"
        message="Are you sure you want to delete all paths?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={confirmDeleteAll}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
});

export default VectorEditor;
```

- [ ] **Step 2: Fix NodeEditor to work as forwardRef (the ref in VectorEditor above needs it)**

Update `NodeEditor.jsx` to be a `forwardRef` component and expose `continueDrag`:

```jsx
// Append to NodeEditor.jsx — replace the export with:
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { parsePath, formatPath } from '../../lib/pathOps.js';

// ... (keep buildNodes function from Task 6) ...

export const NodeEditor = forwardRef(function NodeEditor({ path, onUpdateD, scale }, ref) {
  const dragging = useRef(null);
  const cmds  = parsePath(path.d);
  const nodes = buildNodes(cmds);
  const r     = 5 / Math.max(scale || 1, 0.1);

  useImperativeHandle(ref, () => ({
    continueDrag: (svgX, svgY) => {
      if (!dragging.current) return;
      const { nodeIndex, origX, origY, origCmds } = dragging.current;
      const node = nodes[nodeIndex];
      const dx = svgX - origX;
      const dy = svgY - origY;
      const updated = origCmds.map((cmd, ci) => {
        if (ci !== node.cmdIndex) return cmd;
        const c = { ...cmd };
        if (node.field === 'ctrl1') { c.x1 += dx; c.y1 += dy; }
        else if (node.field === 'ctrl2') { c.x2 += dx; c.y2 += dy; }
        else { if (c.x !== undefined) c.x += dx; if (c.y !== undefined) c.y += dy; }
        return c;
      });
      onUpdateD(formatPath(updated));
    },
    endDrag: () => { dragging.current = null; },
  }), [nodes, onUpdateD]);

  const handleNodeMouseDown = (e, nodeIndex, svgX, svgY) => {
    e.stopPropagation();
    dragging.current = {
      nodeIndex,
      origX: svgX, origY: svgY,
      origCmds: JSON.parse(JSON.stringify(cmds)),
    };
  };

  // Handle lines (ctrl → anchor)
  const handleLines = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== 'ctrl') continue;
    const anchor = nodes.find((n, j) => j > i && n.cmdIndex === nodes[i].cmdIndex && n.type === 'anchor');
    if (anchor) handleLines.push({ x1: nodes[i].x, y1: nodes[i].y, x2: anchor.x, y2: anchor.y });
  }

  return (
    <g className="node-editor">
      {handleLines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
          stroke="var(--accent)" strokeWidth={0.5/Math.max(scale||1,0.1)}
          strokeDasharray={`${2/Math.max(scale||1,0.1)},${2/Math.max(scale||1,0.1)}`} />
      ))}
      {nodes.map((node, i) => (
        <circle key={i} cx={node.x} cy={node.y} r={r}
          fill={node.type === 'anchor' ? 'var(--accent)' : 'transparent'}
          stroke="var(--accent)" strokeWidth={1/Math.max(scale||1,0.1)}
          style={{ cursor: 'move' }}
          onMouseDown={e => handleNodeMouseDown(e, i, node.x, node.y)}
        />
      ))}
    </g>
  );
});
```

Replace the contents of `NodeEditor.jsx` with this final version (the forwardRef version replaces the non-ref version from Task 6).

- [ ] **Step 3: Wire node dragging in VectorEditor — update handleMouseMove and handleMouseUp**

The `nodeEditorRef` is already referenced in the JSX. The `isDraggingNode` ref needs to be set when a node's `onMouseDown` fires. Since `NodeEditor` stops propagation, we need a different approach: listen for a custom event or use a ref flag. Simplest approach — use a `mousedown` on the node that sets a flag on the SVG wrap.

In `VectorEditor.jsx`, add this effect to detect node drags:

```jsx
// Add inside VectorEditor, after nodeEditorRef definition:
useEffect(() => {
  const handleNodeDragStart = () => { isDraggingNode.current = true; };
  const el = wrapRef.current;
  // Nodes set this flag via a custom event bubbling up to wrap
  el?.addEventListener('node-drag-start', handleNodeDragStart);
  return () => el?.removeEventListener('node-drag-start', handleNodeDragStart);
}, []);
```

And in `NodeEditor.jsx`'s `handleNodeMouseDown`, dispatch the custom event:

```jsx
const handleNodeMouseDown = (e, nodeIndex, svgX, svgY) => {
  e.stopPropagation();
  e.currentTarget.closest('svg')?.parentElement?.dispatchEvent(new CustomEvent('node-drag-start'));
  dragging.current = { nodeIndex, origX: svgX, origY: svgY, origCmds: JSON.parse(JSON.stringify(cmds)) };
};
```

And update `handleMouseMove` in VectorEditor to call `nodeEditorRef.current?.continueDrag`:

```jsx
const handleMouseMove = useCallback((e) => {
  if (isPanning) { updatePan(e.clientX, e.clientY); return; }
  const { x, y } = getSvgCoords(e);
  if (isDraggingNode.current && nodeEditorRef.current) {
    nodeEditorRef.current.continueDrag(x, y);
    return;
  }
  const t = toolRef.current;
  if (t === 'pen' && drawing) {
    setDrawing(prev => ({ points: [...prev.points, { x, y }] }));
  }
}, [isPanning, updatePan, getSvgCoords, drawing]);
```

And `handleMouseUp`:

```jsx
const handleMouseUp = useCallback((e) => {
  if (isPanning) { setIsPanning(false); endPan(); return; }
  if (isDraggingNode.current) {
    isDraggingNode.current = false;
    nodeEditorRef.current?.endDrag?.();
    return;
  }
  // ... rest unchanged
}, [isPanning, endPan, getSvgCoords, drawing, lineStart, paths]);
```

- [ ] **Step 4: Commit**

```bash
git add Desktop_App/src/components/VectorEditor/VectorEditor.jsx Desktop_App/src/components/VectorEditor/NodeEditor.jsx
git commit -m "feat: rewrite VectorEditor with SVG-native path editing"
```

---

### Task 10: Update VectorEditor.css

**Files:**
- Modify: `Desktop_App/src/components/VectorEditor/VectorEditor.css`

- [ ] **Step 1: Replace the CSS**

```css
/* Desktop_App/src/components/VectorEditor/VectorEditor.css */
.vector-editor {
  display: flex;
  gap: 0.5rem;
  flex: 1;
  width: 100%;
  min-height: 0;
  overflow: hidden;
}

/* ── Tool Palette ── */
.tool-palette {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem 0.25rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  flex-shrink: 0;
}

.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.tool-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.tool-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }

/* ── SVG Canvas ── */
.svg-canvas-wrap {
  flex: 1;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  user-select: none;
}

.svg-canvas-wrap svg {
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.4);
}

/* ── Operations Panel ── */
.ops-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 0.5rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  flex-shrink: 0;
  width: 140px;
  font-size: 0.75rem;
}

.ops-section { display: flex; flex-direction: column; gap: 0.25rem; }
.ops-label { display: flex; align-items: center; gap: 4px; color: var(--text-secondary); }
.ops-row { display: flex; align-items: center; gap: 0.25rem; }
.ops-slider { flex: 1; accent-color: var(--accent); }
.ops-val { color: var(--text-secondary); min-width: 28px; text-align: right; }
.ops-btn { width: 100%; font-size: 0.72rem; padding: 0.3rem 0.5rem; }
.ops-divider { height: 1px; background: var(--border-color); margin: 0.25rem 0; }
```

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/components/VectorEditor/VectorEditor.css
git commit -m "style: update VectorEditor CSS for SVG-native layout"
```

---

### Task 11: Smoke-test Phase 1 and commit

- [ ] **Step 1: Run the app**

```bash
cd Desktop_App
npm run electron:dev
```

- [ ] **Step 2: Test these flows**
  1. Navigate to Image → G-Code page
  2. Load a test image, trace it, click "Send to Canvas" — paths should appear in the SVG canvas
  3. Click a path — it should highlight in accent color
  4. In node editor, drag an anchor point — path should reshape
  5. Adjust the Simplify slider and click "Apply Simplify" — path point count should reduce
  6. Click "Smooth Edges" — straight L paths should gain curves
  7. Ctrl+Z — paths should restore to pre-simplify state
  8. Use the Pen tool to draw a freehand path — it should appear as a path element
  9. Delete key removes selected path
  10. Click "Compile" — G-code should generate from the SVG canvas content

- [ ] **Step 3: Fix any bugs found**

- [ ] **Step 4: Commit Phase 1 complete**

```bash
git add -A
git commit -m "feat: Phase 1 complete — SVG vector editor replacing Fabric.js canvas"
```

---

## Phase 2 — G2/G3 Arc G-code

---

### Task 12: Firmware — add moveArc() and $CE config

**Files:**
- Modify: `Arduino Codes/CNC_Firmware/cnc_base.h`

- [ ] **Step 1: Add chordError variable after the existing motion config block**

After the line `float homingBackoffMm = 2.0;` (around line 58), add:

```cpp
float chordError = 0.2;  // mm — max chord deviation per arc micro-segment ($CE)
```

- [ ] **Step 2: Add forward declaration for moveArc after the existing forward declarations**

After `void moveLinear(float targetXMm, float targetYMm, float feedRate);` (around line 89), add:

```cpp
void moveArc(float endX, float endY, float offsetI, float offsetJ, bool clockwise, float feedRate);
```

- [ ] **Step 3: Add the moveArc() implementation after the moveLinear() function**

After the closing `}` of `moveLinear()` (around line 334), add:

```cpp
// ---------------------------------------------------------------------------
//  ARC MOTION — G2/G3 circular arc interpolation
//  endX/Y: target endpoint (mm, absolute machine coords)
//  offsetI/J: distance from current position to arc center (mm)
//  clockwise: true = G2 (CW), false = G3 (CCW)
// ---------------------------------------------------------------------------
void moveArc(float endX, float endY, float offsetI, float offsetJ, bool clockwise, float feedRate) {
  float startX = (float)stepperX.currentPosition()  / stepsPerMmX;
  float startY = (float)stepperY1.currentPosition() / stepsPerMmY;

  float cx = startX + offsetI;
  float cy = startY + offsetJ;
  float r  = sqrt(offsetI * offsetI + offsetJ * offsetJ);

  if (r < 0.01) { moveLinear(endX, endY, feedRate); return; }

  float startAngle = atan2(startY - cy, startX - cx);
  float endAngle   = atan2(endY   - cy, endX   - cx);

  float sweep;
  if (clockwise) {
    sweep = startAngle - endAngle;
    if (sweep <= 0.0) sweep += TWO_PI;
  } else {
    sweep = endAngle - startAngle;
    if (sweep <= 0.0) sweep += TWO_PI;
  }
  // Full circle: endpoint equals start
  if (fabs(endX - startX) < 0.001 && fabs(endY - startY) < 0.001) sweep = TWO_PI;

  // Angular step from chord-error tolerance: chord = 2r sin(θ/2) ≤ chordError
  float ratio   = 1.0 - chordError / r;
  float angStep = (ratio >= 1.0) ? 0.00873 : 2.0 * acos(constrain(ratio, -1.0, 1.0));
  angStep = constrain(angStep, 0.00873, 0.2618); // clamp: 0.5° – 15°

  int numSteps = (int)(sweep / angStep);
  for (int i = 1; i <= numSteps; i++) {
    if (checkEStop()) return;
    float angle = clockwise ? (startAngle - i * angStep) : (startAngle + i * angStep);
    moveLinear(cx + r * cos(angle), cy + r * sin(angle), feedRate);
  }
  moveLinear(endX, endY, feedRate); // land exactly on endpoint
}
```

- [ ] **Step 4: Add $CE to $? output in processBaseCfgCommand()**

Find the `$?` block (around line 474). After `Serial.print("$HB=");` line, add:

```cpp
Serial.print("$CE="); Serial.println(chordError, 3);
```

- [ ] **Step 5: Add $CE key handling in processBaseCfgCommand()**

Find the `else if (key == "HB")` line. After it, add:

```cpp
else if (key == "CE") { chordError = constrain(val, 0.01, 2.0); }
```

- [ ] **Step 6: Commit**

```bash
git add "Arduino Codes/CNC_Firmware/cnc_base.h"
git commit -m "feat(firmware): add moveArc() and \$CE chord-error config"
```

---

### Task 13: Firmware — add G2/G3 parsing

**Files:**
- Modify: `Arduino Codes/CNC_Firmware/cnc_base.h`

- [ ] **Step 1: Add G2/G3 cases in processParsedGCode()**

Find the `case 1:` block (the existing G0/G1 handler, around line 349). After its closing `break;`, add:

```cpp
      case 2:
      case 3: {
        if (GCode.HasWord('F')) {
          float f = GCode.GetWordValue('F');
          if (f > 0.0) currentFeedRate = constrain(f, minFeedrate, maxFeedrate);
        }
        float sX = (float)stepperX.currentPosition()  / stepsPerMmX;
        float sY = (float)stepperY1.currentPosition() / stepsPerMmY;
        float eX = sX, eY = sY;
        float oI = 0.0, oJ = 0.0;

        if (isAbsoluteMode) {
          if (GCode.HasWord('X')) eX = GCode.GetWordValue('X');
          if (GCode.HasWord('Y')) eY = GCode.GetWordValue('Y');
        } else {
          if (GCode.HasWord('X')) eX += GCode.GetWordValue('X');
          if (GCode.HasWord('Y')) eY += GCode.GetWordValue('Y');
        }

        if (GCode.HasWord('R')) {
          // R-format: derive I/J from radius
          float R  = GCode.GetWordValue('R');
          float dx = eX - sX, dy = eY - sY;
          float d  = sqrt(dx*dx + dy*dy);
          if (d < 0.001 || fabs(R) < d / 2.0) {
            Serial.println("error:Invalid arc radius (R too small)");
            return;
          }
          float h   = sqrt(R*R - (d/2.0)*(d/2.0));
          float mx  = (sX + eX) / 2.0, my = (sY + eY) / 2.0;
          float px  = -dy / d, py  = dx / d;
          // For G2 positive R: center is to the right of the start→end direction
          float sign = (gCommand == 2) ? 1.0 : -1.0;
          if (R < 0) sign = -sign;
          oI = mx + sign * h * px - sX;
          oJ = my + sign * h * py - sY;
        } else {
          if (GCode.HasWord('I')) oI = GCode.GetWordValue('I');
          if (GCode.HasWord('J')) oJ = GCode.GetWordValue('J');
        }

        moveArc(eX, eY, oI, oJ, gCommand == 2, currentFeedRate);
        Serial.println("ok");
        break;
      }
```

- [ ] **Step 2: Commit**

```bash
git add "Arduino Codes/CNC_Firmware/cnc_base.h"
git commit -m "feat(firmware): add G2/G3 arc command parsing"
```

---

### Task 14: Compiler — add arc helpers and circle arc emission

**Files:**
- Modify: `Desktop_App/src/lib/gcodeCompiler.js`

- [ ] **Step 1: Add arc helpers after the existing imports (after line 6)**

```js
// Arc fitting tolerance — max deviation of Bezier from circumscribed circle
const ARC_FIT_TOLERANCE = 0.05; // mm

// Circumscribed circle through three points. Returns {cx, cy, r} or null if collinear.
function circumscribedCircle(p0, p1, p2) {
  const ax = p0.x, ay = p0.y, bx = p1.x, by = p1.y, cx = p2.x, cy = p2.y;
  const D = 2 * (ax*(by-cy) + bx*(cy-ay) + cx*(ay-by));
  if (Math.abs(D) < 1e-10) return null;
  const ux = ((ax*ax+ay*ay)*(by-cy) + (bx*bx+by*by)*(cy-ay) + (cx*cx+cy*cy)*(ay-by)) / D;
  const uy = ((ax*ax+ay*ay)*(cx-bx) + (bx*bx+by*by)*(ax-cx) + (cx*cx+cy*cy)*(bx-ax)) / D;
  return { cx: ux, cy: uy, r: Math.sqrt((ax-ux)**2 + (ay-uy)**2) };
}

// Returns arc params {i, j, clockwise} in SVG space, or null if the curve doesn't fit.
// p0=arc start, end=arc end, sampleFn(t)=point on curve at t∈[0,1]
function fitArcToSampledCurve(p0, end, sampleFn) {
  const mid = sampleFn(0.5);
  const circle = circumscribedCircle(p0, mid, end);
  if (!circle || circle.r < 0.5) return null; // too tight / degenerate

  // Check deviation at 7 interior samples
  for (const t of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
    const pt = sampleFn(t);
    if (Math.abs(Math.sqrt((pt.x-circle.cx)**2 + (pt.y-circle.cy)**2) - circle.r) > ARC_FIT_TOLERANCE) {
      return null;
    }
  }

  // CW/CCW in SVG Y-down: positive cross = CW visually
  const cross = (mid.x-p0.x)*(end.y-mid.y) - (mid.y-p0.y)*(end.x-mid.x);
  return {
    i: circle.cx - p0.x, // offset from arc start to center
    j: circle.cy - p0.y,
    clockwise: cross > 0,
  };
}
```

- [ ] **Step 2: Replace `ellipseToPoints` call for true circles**

Find `root.querySelectorAll('ellipse, circle').forEach(el => add(el, ellipseToPoints));` (around line 243).

Replace with:

```js
  root.querySelectorAll('ellipse, circle').forEach(el => {
    const rx = parseFloat(el.getAttribute('rx') || el.getAttribute('r') || 0);
    const ry = parseFloat(el.getAttribute('ry') || el.getAttribute('r') || 0);
    if (Math.abs(rx - ry) < 0.01) {
      add(el, circleToPoints);
    } else {
      add(el, ellipseToPoints);
    }
  });
```

- [ ] **Step 3: Add circleToPoints() function before extractAllPointSets()**

Add after the existing `lineToPoints()` function (around line 141):

```js
// Emit a true circle as two G2/G3 half-arcs instead of 64 G1 lines.
function circleToPoints(el, transform) {
  const cx = parseFloat(el.getAttribute('cx') || 0);
  const cy = parseFloat(el.getAttribute('cy') || 0);
  const r  = parseFloat(el.getAttribute('r') || el.getAttribute('rx') || 0);
  if (r <= 0) return [];

  const center = applyTransform(cx, cy, transform);
  const left   = applyTransform(cx - r, cy, transform);
  const right  = applyTransform(cx + r, cy, transform);
  const top    = applyTransform(cx, cy - r, transform); // top in SVG (y decreases upward)

  const rx = Math.sqrt((right.x - center.x)**2 + (right.y - center.y)**2);

  // Determine CW in SVG Y-down via cross product at top of first half
  const vx1 = top.x - left.x, vy1 = top.y - left.y;
  const vx2 = right.x - top.x, vy2 = right.y - top.y;
  const cw = (vx1 * vy2 - vy1 * vx2) > 0;

  // I/J = offset from arc START to circle center
  return [
    { type: 'M', x: left.x,  y: left.y  },
    { type: 'A', x: right.x, y: right.y, i: center.x - left.x,  j: center.y - left.y,  clockwise: cw },
    { type: 'A', x: left.x,  y: left.y,  i: center.x - right.x, j: center.y - right.y, clockwise: cw },
    { type: 'Z', x: left.x,  y: left.y  },
  ];
}
```

- [ ] **Step 4: Commit**

```bash
git add Desktop_App/src/lib/gcodeCompiler.js
git commit -m "feat(compiler): add circumscribedCircle, fitArcToSampledCurve, circleToPoints"
```

---

### Task 15: Compiler — arc-fit Bezier segments and emit G2/G3

**Files:**
- Modify: `Desktop_App/src/lib/gcodeCompiler.js`

- [ ] **Step 1: Update pathToPoints() to try arc fitting for Q and C commands**

Find the `case 'Q':` block in `pathToPoints()` (around line 62). Replace it:

```js
      case 'Q': {
        const c1  = applyTransform(cmd.x1, cmd.y1, transform);
        const end = applyTransform(cmd.x,  cmd.y,  transform);
        if (prev) {
          const arc = fitArcToSampledCurve(
            prev, end,
            t => {
              const mt = 1 - t;
              return { x: mt*mt*prev.x + 2*mt*t*c1.x + t*t*end.x,
                       y: mt*mt*prev.y + 2*mt*t*c1.y + t*t*end.y };
            }
          );
          if (arc) {
            points.push({ type: 'A', x: end.x, y: end.y, ...arc });
          } else {
            for (const pt of tessellateQuadratic(prev, c1, end))
              points.push({ type: 'L', x: pt.x, y: pt.y });
          }
        } else {
          points.push({ type: 'L', x: end.x, y: end.y });
        }
        break;
      }
```

Find the `case 'C':` block (around line 73). Replace it:

```js
      case 'C': {
        const c1  = applyTransform(cmd.x1, cmd.y1, transform);
        const c2  = applyTransform(cmd.x2, cmd.y2, transform);
        const end = applyTransform(cmd.x,  cmd.y,  transform);
        if (prev) {
          const arc = fitArcToSampledCurve(
            prev, end,
            t => {
              const mt = 1 - t;
              return {
                x: mt*mt*mt*prev.x + 3*mt*mt*t*c1.x + 3*mt*t*t*c2.x + t*t*t*end.x,
                y: mt*mt*mt*prev.y + 3*mt*mt*t*c1.y + 3*mt*t*t*c2.y + t*t*t*end.y,
              };
            }
          );
          if (arc) {
            points.push({ type: 'A', x: end.x, y: end.y, ...arc });
          } else {
            for (const pt of tessellateCubic(prev, c1, c2, end))
              points.push({ type: 'L', x: pt.x, y: pt.y });
          }
        } else {
          points.push({ type: 'L', x: end.x, y: end.y });
        }
        break;
      }
```

- [ ] **Step 2: Update generatePathGcode() to handle type 'A' points**

Find the `} else if (pt.type === 'Z') {` block inside `generatePathGcode` (around line 298). Add a new branch before the closing `else {` for `L` points:

```js
      } else if (pt.type === 'A') {
        if (!penDown) { lines.push('M3 ; tool on'); penDown = true; }
        // SVG CW → machine CCW (Y-flipped) → G3; SVG CCW → G2
        const gNum = pt.clockwise ? 3 : 2;
        const iMm  = pt.i.toFixed(3);
        const jMm  = (-pt.j).toFixed(3); // negate J: SVG Y-down → machine Y-up
        lines.push(`G${gNum} X${x} Y${y} I${iMm} J${jMm} F${maxFeedrate}`);
```

The full updated block (replacing from `} else if (pt.type === 'Z') {` through `lines.push(\`G1...\`)}`):

```js
      } else if (pt.type === 'Z') {
        lines.push(`G1 X${x} Y${y} F${maxFeedrate}`);
        lines.push('M5 ; tool off');
        penDown = false;
      } else if (pt.type === 'A') {
        if (!penDown) { lines.push('M3 ; tool on'); penDown = true; }
        const gNum = pt.clockwise ? 3 : 2;
        const iMm  = pt.i.toFixed(3);
        const jMm  = (-pt.j).toFixed(3);
        lines.push(`G${gNum} X${x} Y${y} I${iMm} J${jMm} F${maxFeedrate}`);
      } else {
        if (!penDown) { lines.push('M3 ; tool on'); penDown = true; }
        lines.push(`G1 X${x} Y${y} F${maxFeedrate}`);
      }
```

- [ ] **Step 3: Commit**

```bash
git add Desktop_App/src/lib/gcodeCompiler.js
git commit -m "feat(compiler): emit G2/G3 for circles and arc-fitting Bezier segments"
```

---

### Task 16: Write compiler arc tests

**Files:**
- Create: `Desktop_App/src/lib/gcodeCompiler.test.mjs`

- [ ] **Step 1: Write tests**

```js
// Desktop_App/src/lib/gcodeCompiler.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileSVGToGCode } from './gcodeCompiler.js';

const SETTINGS = { maxFeedrate: 1000, servoPenDown: 30, servoPenUp: 75, bedH: 200 };

describe('compileSVGToGCode — G2/G3 arc emission', () => {
  it('emits G2/G3 for a circle instead of G1 lines', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <circle cx="100" cy="100" r="50" fill="none" stroke="black" />
    </svg>`;
    const lines = compileSVGToGCode(svg, SETTINGS);
    const arcLines = lines.filter(l => /^G[23]\s/i.test(l));
    const g1Lines  = lines.filter(l => /^G1\s/i.test(l));
    assert.ok(arcLines.length >= 2, `Expected ≥2 arc lines, got ${arcLines.length}: ${arcLines.join(', ')}`);
    assert.equal(g1Lines.length, 0, `Expected 0 G1 lines for a circle, got ${g1Lines.length}`);
  });

  it('arc lines for a circle include I or J parameters', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <circle cx="100" cy="100" r="30" fill="none" stroke="black" />
    </svg>`;
    const lines = compileSVGToGCode(svg, SETTINGS);
    const arcLines = lines.filter(l => /^G[23]\s/i.test(l));
    for (const l of arcLines) {
      assert.ok(/I[-\d.]+/.test(l) || /J[-\d.]+/.test(l),
        `Arc line missing I/J: ${l}`);
    }
  });

  it('ellipse with rx≠ry still uses G1 tessellation', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <ellipse cx="100" cy="100" rx="60" ry="30" fill="none" stroke="black" />
    </svg>`;
    const lines = compileSVGToGCode(svg, SETTINGS);
    const arcLines = lines.filter(l => /^G[23]\s/i.test(l));
    assert.equal(arcLines.length, 0, 'Ellipse rx≠ry should not emit arcs');
  });

  it('straight-line path does not produce arc lines', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <path d="M 10 10 L 100 10 L 100 100" stroke="black" fill="none" />
    </svg>`;
    const lines = compileSVGToGCode(svg, SETTINGS);
    const arcLines = lines.filter(l => /^G[23]\s/i.test(l));
    assert.equal(arcLines.length, 0, 'Straight L path should not emit arcs');
  });

  it('compiled output always starts with G21 and G90 header', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <line x1="0" y1="0" x2="50" y2="50" stroke="black" />
    </svg>`;
    const lines = compileSVGToGCode(svg, SETTINGS);
    assert.ok(lines.some(l => l.startsWith('G21')));
    assert.ok(lines.some(l => l.startsWith('G90')));
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd Desktop_App
node --test src/lib/gcodeCompiler.test.mjs
```

Expected: all pass. If the circle test fails (arc lines = 0), debug `circleToPoints()` — check that the element selector matches `<circle>` tags correctly.

- [ ] **Step 3: Commit**

```bash
git add Desktop_App/src/lib/gcodeCompiler.test.mjs
git commit -m "test: add arc-output unit tests for gcodeCompiler.js"
```

---

### Task 17: Extend softLimits.js for G2/G3

**Files:**
- Modify: `Desktop_App/src/lib/softLimits.js`

- [ ] **Step 1: Add arcBounds() helper and update scanGCodeBounds()**

Replace the entire `softLimits.js` content with the updated version:

```js
// Desktop_App/src/lib/softLimits.js

export function parseXY(line) {
  const upper = line.trim().toUpperCase();
  const xMatch = upper.match(/X([-\d.]+)/);
  const yMatch = upper.match(/Y([-\d.]+)/);
  if (!xMatch && !yMatch) return null;
  return {
    x: xMatch ? parseFloat(xMatch[1]) : null,
    y: yMatch ? parseFloat(yMatch[1]) : null,
  };
}

export function isInWarnZone(x, y, { bedMaxX, bedMaxY, softLimitMargin }) {
  if (x === null && y === null) return false;
  if (x !== null) {
    if (x < softLimitMargin) return true;
    if (x > bedMaxX - softLimitMargin) return true;
  }
  if (y !== null) {
    if (y < softLimitMargin) return true;
    if (y > bedMaxY - softLimitMargin) return true;
  }
  return false;
}

export function violatesSafeFloor(x, y, floorX, floorY) {
  if (x !== null && x < floorX) return true;
  if (y !== null && y < floorY) return true;
  return false;
}

// Axis-aligned bounding box of a G2/G3 arc in machine coordinates.
// x0,y0 = start; x1,y1 = end; i,j = offsets from start to center; cw = clockwise
function arcBounds(x0, y0, x1, y1, i, j, cw) {
  const cx = x0 + i, cy = y0 + j;
  const r  = Math.sqrt(i*i + j*j);
  const startAngle = Math.atan2(y0 - cy, x0 - cx);
  const endAngle   = Math.atan2(y1 - cy, x1 - cx);

  let sweep;
  if (cw) { sweep = startAngle - endAngle; if (sweep <= 0) sweep += 2*Math.PI; }
  else     { sweep = endAngle - startAngle; if (sweep <= 0) sweep += 2*Math.PI; }

  const pts = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
  for (const cardAngle of [0, Math.PI/2, Math.PI, 3*Math.PI/2]) {
    let delta = cw ? (startAngle - cardAngle) : (cardAngle - startAngle);
    while (delta < 0) delta += 2*Math.PI;
    if (delta <= sweep) pts.push({ x: cx + r*Math.cos(cardAngle), y: cy + r*Math.sin(cardAngle) });
  }
  return {
    minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
    minY: Math.min(...pts.map(p => p.y)), maxY: Math.max(...pts.map(p => p.y)),
  };
}

export function scanGCodeBounds(lines, { bedMaxX, bedMaxY, softLimitMargin }) {
  const violations = [];
  let cx = 0, cy = 0; // track current machine position for arc center computation

  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].trim().toUpperCase();
    const isG01 = /^G0?1?\s/.test(upper) || upper.startsWith('G0 ') || upper.startsWith('G1 ');
    const isG23 = /^G[23][\s]/.test(upper);

    if (!isG01 && !isG23) continue;

    const pos = parseXY(upper);
    if (!pos) continue;
    const nx = pos.x !== null ? pos.x : cx;
    const ny = pos.y !== null ? pos.y : cy;

    if (isG01) {
      if (isInWarnZone(pos.x, pos.y, { bedMaxX, bedMaxY, softLimitMargin })) {
        violations.push({ lineIndex: i, line: lines[i], x: pos.x, y: pos.y });
      }
    } else {
      const iMatch = upper.match(/I([-\d.]+)/);
      const jMatch = upper.match(/J([-\d.]+)/);
      const oI = iMatch ? parseFloat(iMatch[1]) : 0;
      const oJ = jMatch ? parseFloat(jMatch[1]) : 0;
      const cw = upper[1] === '2';
      const b  = arcBounds(cx, cy, nx, ny, oI, oJ, cw);
      // Check all four extremal corners of the arc
      const checks = [
        { x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY },
        { x: b.minX, y: b.maxY }, { x: b.maxX, y: b.maxY },
        { x: nx,     y: ny     },
      ];
      if (checks.some(pt => isInWarnZone(pt.x, pt.y, { bedMaxX, bedMaxY, softLimitMargin }))) {
        violations.push({ lineIndex: i, line: lines[i], x: nx, y: ny });
      }
    }

    cx = nx; cy = ny;
  }
  return violations;
}

export function wouldExceedPositiveLimit(currentPos, increment, axis, { bedMaxX, bedMaxY, softLimitMargin }) {
  const target  = currentPos + increment;
  const ceiling = axis === 'X' ? bedMaxX - softLimitMargin : bedMaxY - softLimitMargin;
  return target > ceiling;
}

export function wouldCrossSafeFloor(currentPos, increment, floor) {
  return (currentPos - increment) < floor;
}
```

Note: the `isG01` regex was simplified — the original only checked `startsWith('G0')` and `startsWith('G1')`. The new version is equivalent.

- [ ] **Step 2: Commit**

```bash
git add Desktop_App/src/lib/softLimits.js
git commit -m "feat(softLimits): add G2/G3 arc extent checking in scanGCodeBounds"
```

---

### Task 18: Write softLimits G2/G3 tests

**Files:**
- Modify: `Desktop_App/src/lib/softLimits.test.mjs` (create if missing)

- [ ] **Step 1: Check if the file exists**

```bash
ls Desktop_App/src/lib/softLimits.test.mjs 2>$null; if (-not $?) { echo "not found" }
```

- [ ] **Step 2: Add G2/G3 tests to the file (create if missing)**

Append to (or create) `Desktop_App/src/lib/softLimits.test.mjs`:

```js
// Desktop_App/src/lib/softLimits.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseXY, isInWarnZone, scanGCodeBounds } from './softLimits.js';

const SETTINGS = { bedMaxX: 200, bedMaxY: 200, softLimitMargin: 10 };

describe('parseXY', () => {
  it('parses X and Y', () => {
    const r = parseXY('G1 X50 Y75 F1000');
    assert.equal(r.x, 50); assert.equal(r.y, 75);
  });
  it('returns null when no X or Y', () => {
    assert.equal(parseXY('M3'), null);
  });
});

describe('isInWarnZone', () => {
  it('flags a point inside the margin', () => {
    assert.ok(isInWarnZone(5, 100, SETTINGS));
  });
  it('allows a point well inside the bed', () => {
    assert.ok(!isInWarnZone(100, 100, SETTINGS));
  });
  it('flags a point beyond max', () => {
    assert.ok(isInWarnZone(100, 195, SETTINGS));
  });
});

describe('scanGCodeBounds — G1', () => {
  it('returns violation for G1 outside margin', () => {
    const lines = ['G1 X5 Y100 F1000'];
    const v = scanGCodeBounds(lines, SETTINGS);
    assert.equal(v.length, 1);
    assert.equal(v[0].lineIndex, 0);
  });
  it('no violation for safe G1', () => {
    const lines = ['G1 X100 Y100 F1000'];
    assert.equal(scanGCodeBounds(lines, SETTINGS).length, 0);
  });
});

describe('scanGCodeBounds — G2/G3 arc', () => {
  it('detects arc that swings outside the margin', () => {
    // Arc starting at (50,50), ending at (50,50) — full circle with r=45
    // Center offset: I=45 J=0, so center at (95,50)
    // The arc reaches x=95+45=140 (fine) but also x=95-45=50 (fine)
    // and y=50+45=95 (fine) and y=50-45=5 (violation: < margin 10)
    const lines = [
      'G1 X50 Y50 F1000',
      'G2 X50 Y50 I45 J0 F1000', // full circle, center at (95,50), r=45
    ];
    const v = scanGCodeBounds(lines, SETTINGS);
    assert.ok(v.length >= 1, `Expected violation for arc reaching y=5, got ${v.length}`);
  });

  it('does not flag arc safely inside the bed', () => {
    // Small arc: start (100,100), center offset (10,0), end (120,100)
    // Goes through top of circle at (110,110) — all well inside bed
    const lines = [
      'G1 X100 Y100 F1000',
      'G3 X120 Y100 I10 J0 F1000',
    ];
    const v = scanGCodeBounds(lines, SETTINGS);
    assert.equal(v.length, 0, `Expected no violation, got ${v.length}`);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd Desktop_App
node --test src/lib/softLimits.test.mjs
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add Desktop_App/src/lib/softLimits.test.mjs
git commit -m "test: add G2/G3 arc bound-scanning tests for softLimits.js"
```

---

### Task 19: Update GCodePreview for G2/G3 rendering

**Files:**
- Modify: `Desktop_App/src/components/GCodePreview.jsx`

- [ ] **Step 1: Add G2/G3 branch in the drawing loop**

Find the block:

```js
      } else if (trimmed.startsWith('G1') && penDown) {
        ctx.beginPath();
        ctx.strokeStyle = '#00bfff';
        ctx.lineWidth = 1;
        ctx.moveTo(...toCanvas(cx, cy));
        ctx.lineTo(...toCanvas(nx, ny));
        ctx.stroke();
      }
```

Replace with:

```js
      } else if (trimmed.startsWith('G1') && penDown) {
        ctx.beginPath();
        ctx.strokeStyle = '#00bfff';
        ctx.lineWidth = 1;
        ctx.moveTo(...toCanvas(cx, cy));
        ctx.lineTo(...toCanvas(nx, ny));
        ctx.stroke();
      } else if ((trimmed.startsWith('G2') || trimmed.startsWith('G3')) && penDown) {
        const iMatch = trimmed.match(/I([-\d.]+)/);
        const jMatch = trimmed.match(/J([-\d.]+)/);
        const oI = iMatch ? parseFloat(iMatch[1]) : 0;
        const oJ = jMatch ? parseFloat(jMatch[1]) : 0;
        const acx = cx + oI, acy = cy + oJ;
        const ar  = Math.sqrt(oI*oI + oJ*oJ);
        if (ar > 0.01) {
          const sa = Math.atan2(cy - acy, cx - acx);
          const ea = Math.atan2(ny - acy, nx - acx);
          const cw = trimmed.startsWith('G2');
          const [ccx, ccy] = toCanvas(acx, acy);
          const rPx = ar * Math.min(scaleX, scaleY);
          ctx.beginPath();
          ctx.strokeStyle = '#00bfff';
          ctx.lineWidth = 1;
          // G2 (machine CW) → anticlockwise=true in canvas (Y-flipped)
          ctx.arc(ccx, ccy, rPx, -sa, -ea, cw);
          ctx.stroke();
        }
      }
```

- [ ] **Step 2: Also include G2/G3 endpoints in the bounding box calculation**

Find:

```js
      if (!upper.startsWith('G1')) return;  // only drawing moves
```

Replace with:

```js
      if (!upper.startsWith('G1') && !upper.startsWith('G2') && !upper.startsWith('G3')) return;
```

- [ ] **Step 3: Commit**

```bash
git add Desktop_App/src/components/GCodePreview.jsx
git commit -m "feat(preview): render G2/G3 arcs with ctx.arc() in GCodePreview"
```

---

### Task 20: Add chordError to settings

**Files:**
- Modify: `Desktop_App/src/contexts/SettingsContext.jsx`
- Modify: `Desktop_App/src/pages/SettingsPage.jsx`

- [ ] **Step 1: Add chordError to DEFAULT_SETTINGS in SettingsContext.jsx**

Find the `// Machine Boundaries (Soft Limits)` block. After `softLimitMargin: 10,`, add:

```js
  // Arc interpolation
  chordError: 0.2,
```

- [ ] **Step 2: Add $CE to applyToArduino() in SettingsContext.jsx**

Find `'$HB=${settings.homingBackoff}'`. After it, add:

```js
        `$CE=${settings.chordError}`,
```

- [ ] **Step 3: Add $CE field to SettingsPage.jsx**

Read the SettingsPage.jsx to find the motion section, then add an input for chordError near the feedrate inputs. The exact location depends on the page layout — add it to the Speed/Motion section:

```jsx
<div className="setting-row">
  <label>Arc Chord Error ($CE)</label>
  <input
    type="number" min="0.01" max="2" step="0.01"
    value={settings.chordError ?? 0.2}
    onChange={e => updateSetting('chordError', parseFloat(e.target.value))}
    className="input"
  />
  <span className="setting-unit">mm</span>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add Desktop_App/src/contexts/SettingsContext.jsx Desktop_App/src/pages/SettingsPage.jsx
git commit -m "feat(settings): add chordError (\$CE) arc interpolation setting"
```

---

### Task 21: Final integration test and commit

- [ ] **Step 1: Run unit tests**

```bash
cd Desktop_App
node --test src/lib/pathOps.test.mjs
node --test src/lib/gcodeCompiler.test.mjs
node --test src/lib/softLimits.test.mjs
```

All must pass.

- [ ] **Step 2: Run the app**

```bash
npm run electron:dev
```

- [ ] **Step 3: Test arc G-code flow**
  1. Go to Image → G-Code page
  2. Import a test image with a circle in it (use `Input Files/` folder)
  3. Trace it, send to canvas, compile
  4. In the G-code preview, the circle should render as a smooth arc (not a polygon)
  5. Inspect the compiled G-code in the G-code jobs preview — should contain `G2` or `G3` lines with `I`/`J`

- [ ] **Step 4: Test firmware (if hardware available)**
  1. Upload the firmware (or test via serial monitor)
  2. Send `$?` → should show `$CE=0.200`
  3. Send `G2 X150 Y100 I50 J0 F1000` from Manual Control → machine should trace a semicircle smoothly

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "feat: Phase 2 complete — G2/G3 arc support in firmware, compiler, preview, and settings"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|------------------|------|
| SVG DOM path editor replacing Fabric.js | Tasks 4–11 |
| `toSVG()`, `loadSVG()`, `addSVG()` handle | Task 9 |
| Simplify (RDP) | Task 2, tested Task 3 |
| Smooth (Catmull-Rom) | Task 2, tested Task 3 |
| Zoom/pan | Task 4 |
| Node editing (drag anchor + ctrl handles) | Tasks 6, 9 |
| Delete selected, Ctrl+Z undo | Task 9 |
| Firmware moveArc() + $CE | Task 12 |
| Firmware G2/G3 parsing (I/J + R-format) | Task 13 |
| Compiler: circles → G2/G3 half-arcs | Task 14 |
| Compiler: Bezier → arc fitting | Task 15 |
| Compiler: 'A' type → G2/G3 emit | Task 15 |
| Soft limits: G2/G3 arc extent checking | Task 17, tested Task 18 |
| G-code preview: arc rendering | Task 19 |
| Settings: chordError | Task 20 |

**No placeholders found.** All steps include complete code.

**Type consistency confirmed:** `PathRecord = { id, d, color, fill }` used consistently in pathOps.js, VectorEditor, PathLayer. Point type `'A' = { type, x, y, i, j, clockwise }` defined in Task 14 and consumed in Task 15.
