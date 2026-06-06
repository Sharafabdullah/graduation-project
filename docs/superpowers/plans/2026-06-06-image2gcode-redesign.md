# Image-to-GCode Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Image2GCodePage.jsx` with a two-tab workspace — (1) Image-to-GCode raster pipeline with Web Worker tracing and (2) an interactive Fabric.js vector editor — both feeding a shared compile → preview → stream bottom bar.

**Architecture:** Parent `Image2GCodePage` owns `compiledGCode`, `lineWidth`, `activeTab`, and `injectedSVG` state. Tab 1 uses a Web Worker to trace images via imagetracerjs and returns an SVG string. Tab 2 hosts a Fabric.js canvas (`1px = 1mm`, sized to bed dimensions) with a tool palette. A shared bottom bar compiles whichever source is active (traced SVG or canvas), previews toolpaths, and wires into `SerialContext.startStreaming`.

**Tech Stack:** React 18, Electron 28, Vite 6, fabric@5, imagetracerjs, svg-path-parser, lucide-react (existing)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Install | `package.json` | add fabric, imagetracerjs, svg-path-parser |
| Modify | `main.js` | add `file:save-gcode` IPC handler |
| Modify | `preload.js` | expose `window.platform.saveGCode(lines)` |
| Create | `src/workers/tracerWorker.js` | Web Worker: imagetracerjs → SVG string |
| Create | `src/hooks/useImageTracer.js` | Worker lifecycle + bridge hook |
| Create | `src/lib/gcodeCompiler.js` | SVG path → G-code array |
| Create | `src/components/VectorEditor/VectorEditor.jsx` | Fabric.js canvas (forwardRef) |
| Create | `src/components/VectorEditor/ToolPalette.jsx` | Tool selection icon bar |
| Create | `src/components/VectorEditor/VectorEditor.css` | Canvas + palette layout |
| Create | `src/components/GCodePreview.jsx` | 2D toolpath canvas renderer |
| Create | `src/components/GCodePreview.css` | Preview styles |
| Create | `src/pages/tabs/ImageToGCodeTab.jsx` | Tab 1: dropzone + tracer controls + SVG preview |
| Create | `src/pages/tabs/VectorDrawerTab.jsx` | Tab 2: hosts VectorEditor |
| Rewrite | `src/pages/Image2GCodePage.jsx` | Parent: tabs + shared bottom bar state |
| Rewrite | `src/pages/Image2GCodePage.css` | Full layout for new structure |

---

## Task 1: Install Dependencies + Save-GCode IPC

**Files:**
- Modify: `package.json`
- Modify: `main.js`
- Modify: `preload.js`

- [ ] **Step 1: Install npm packages**

```bash
cd "d:\University\Graduation Project\Desktop_App"
npm install fabric@5 imagetracerjs svg-path-parser
```

Expected: packages appear in `node_modules`, `package.json` updated with three new deps.

- [ ] **Step 2: Add save-gcode IPC handler to `main.js`**

After the existing `file:save-log` handler (line ~203), add:

```js
// ── IPC: Save G-Code file ─────────────────────────────────────────────────────
ipcMain.handle('file:save-gcode', async (_event, lines) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save G-Code',
    defaultPath: `job-${Date.now()}.gcode`,
    filters: [
      { name: 'G-Code Files', extensions: ['gcode', 'nc'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return { success: false };
  try {
    fs.writeFileSync(result.filePath, lines.join('\n'), 'utf-8');
    return { success: true, path: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
```

- [ ] **Step 3: Expose saveGCode in `preload.js`**

Add one line to the `contextBridge.exposeInMainWorld` object (after `saveLog`):

```js
saveGCode: (lines) => ipcRenderer.invoke('file:save-gcode', lines),
```

- [ ] **Step 4: Commit**

```bash
git add main.js preload.js package.json package-lock.json
git commit -m "feat: install fabric/imagetracerjs/svg-path-parser, add save-gcode IPC"
```

---

## Task 2: Web Worker + useImageTracer Hook

**Files:**
- Create: `src/workers/tracerWorker.js`
- Create: `src/hooks/useImageTracer.js`

- [ ] **Step 1: Create `src/workers/tracerWorker.js`**

```js
import ImageTracer from 'imagetracerjs';

self.onmessage = function (e) {
  const { imageData, options } = e.data;
  try {
    ImageTracer.imageToSVG(
      imageData,
      (svgString) => self.postMessage({ svg: svgString }),
      options
    );
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
```

- [ ] **Step 2: Create `src/hooks/useImageTracer.js`**

```js
import { useState, useRef, useEffect, useCallback } from 'react';

export function useImageTracer() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const workerRef = useRef(null);

  useEffect(() => {
    workerRef.current = new Worker(
      new URL('../workers/tracerWorker.js', import.meta.url),
      { type: 'module' }
    );
    workerRef.current.onmessage = (e) => {
      setLoading(false);
      if (e.data.error) {
        setError(e.data.error);
      } else {
        setResult(e.data.svg);
        setError(null);
      }
    };
    return () => workerRef.current.terminate();
  }, []);

  const trace = useCallback((base64DataUrl, options = {}) => {
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
    workerRef.current.postMessage({
      imageData: base64DataUrl,
      options: { ...defaultOptions, ...options },
    });
  }, []);

  return { trace, result, loading, error };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/workers/tracerWorker.js src/hooks/useImageTracer.js
git commit -m "feat: add imagetracerjs Web Worker and useImageTracer hook"
```

---

## Task 3: G-Code Compiler

**Files:**
- Create: `src/lib/gcodeCompiler.js`

The Fabric canvas uses `1px = 1mm` so all path coordinates from `canvas.toSVG()` are already in mm. The same applies when the tracer SVG is compiled directly.

- [ ] **Step 1: Create `src/lib/gcodeCompiler.js`**

```js
import { parseSVG, makeAbsolute } from 'svg-path-parser';

function extractPaths(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const paths = [];
  doc.querySelectorAll('path').forEach((el) => {
    const d = el.getAttribute('d');
    if (d) paths.push(d);
  });
  return paths;
}

function pathToPoints(d) {
  const commands = makeAbsolute(parseSVG(d));
  const points = [];
  for (const cmd of commands) {
    switch (cmd.code) {
      case 'M': case 'L':
        points.push({ type: cmd.code, x: cmd.x, y: cmd.y });
        break;
      case 'C':
        points.push({ type: 'L', x: cmd.x, y: cmd.y });
        break;
      case 'Q':
        points.push({ type: 'L', x: cmd.x, y: cmd.y });
        break;
      case 'Z':
        if (points.length > 0) {
          points.push({ type: 'Z', x: points[0].x, y: points[0].y });
        }
        break;
      default:
        if (cmd.x !== undefined && cmd.y !== undefined) {
          points.push({ type: 'L', x: cmd.x, y: cmd.y });
        }
    }
  }
  return points;
}

export function compileSVGToGCode(svgString, settings) {
  const {
    maxFeedrate = 1000,
    servoPenDown = 30,
    servoPenUp = 75,
  } = settings;

  const paths = extractPaths(svgString);
  const lines = [];

  lines.push('; Generated by Platform Control');
  lines.push('G21 ; mm units');
  lines.push('G90 ; absolute positioning');
  lines.push(`F${maxFeedrate}`);
  lines.push(`M280 P0 S${servoPenUp} ; pen up`);

  for (const d of paths) {
    const points = pathToPoints(d);
    if (points.length === 0) continue;

    let penDown = false;

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const x = pt.x.toFixed(3);
      const y = pt.y.toFixed(3);

      if (i === 0 || pt.type === 'M') {
        if (penDown) {
          lines.push(`M280 P0 S${servoPenUp} ; pen up`);
          penDown = false;
        }
        lines.push(`G0 X${x} Y${y}`);
      } else if (pt.type === 'Z') {
        lines.push(`G1 X${x} Y${y} F${maxFeedrate}`);
        lines.push(`M280 P0 S${servoPenUp} ; pen up`);
        penDown = false;
      } else {
        if (!penDown) {
          lines.push(`M280 P0 S${servoPenDown} ; pen down`);
          penDown = true;
        }
        lines.push(`G1 X${x} Y${y} F${maxFeedrate}`);
      }
    }

    if (penDown) {
      lines.push(`M280 P0 S${servoPenUp} ; pen up`);
    }
  }

  lines.push('G0 X0 Y0 ; return home');
  return lines;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/gcodeCompiler.js
git commit -m "feat: add SVG-to-GCode compiler using svg-path-parser"
```

---

## Task 4: GCodePreview Component

Manual 2D canvas renderer — no external library needed, full control over styling.

**Files:**
- Create: `src/components/GCodePreview.jsx`
- Create: `src/components/GCodePreview.css`

- [ ] **Step 1: Create `src/components/GCodePreview.jsx`**

```jsx
import React, { useEffect, useRef } from 'react';
import './GCodePreview.css';

export default function GCodePreview({ lines = [], bedW = 200, bedH = 200 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    const scaleX = W / bedW;
    const scaleY = H / bedH;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(0, 0, W, H);

    let cx = 0, cy = 0;
    let penDown = false;

    const toCanvas = (x, y) => [x * scaleX, y * scaleY];

    for (const line of lines) {
      const trimmed = line.trim().toUpperCase();
      if (!trimmed || trimmed.startsWith(';')) continue;

      const xMatch = trimmed.match(/X([-\d.]+)/);
      const yMatch = trimmed.match(/Y([-\d.]+)/);
      if (!xMatch && !yMatch) {
        if (trimmed.includes('M280') && trimmed.includes('S')) {
          const sMatch = trimmed.match(/S([\d.]+)/);
          if (sMatch) {
            const angle = parseFloat(sMatch[1]);
            penDown = angle < 60;
          }
        }
        continue;
      }

      const nx = xMatch ? parseFloat(xMatch[1]) : cx;
      const ny = yMatch ? parseFloat(yMatch[1]) : cy;

      if (trimmed.startsWith('G0')) {
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(100,100,160,0.4)';
        ctx.lineWidth = 0.5;
        ctx.moveTo(...toCanvas(cx, cy));
        ctx.lineTo(...toCanvas(nx, ny));
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (trimmed.startsWith('G1') && penDown) {
        ctx.beginPath();
        ctx.strokeStyle = '#00bfff';
        ctx.lineWidth = 1;
        ctx.moveTo(...toCanvas(cx, cy));
        ctx.lineTo(...toCanvas(nx, ny));
        ctx.stroke();
      }

      cx = nx;
      cy = ny;
    }
  }, [lines, bedW, bedH]);

  return (
    <div className="gcode-preview-wrap">
      <canvas
        ref={canvasRef}
        className="gcode-preview-canvas"
        width={400}
        height={400}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/GCodePreview.css`**

```css
.gcode-preview-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.5rem;
}

.gcode-preview-canvas {
  max-width: 100%;
  max-height: 300px;
  border-radius: 4px;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/GCodePreview.jsx src/components/GCodePreview.css
git commit -m "feat: add 2D G-code toolpath preview canvas component"
```

---

## Task 5: VectorEditor + ToolPalette

**Files:**
- Create: `src/components/VectorEditor/VectorEditor.jsx`
- Create: `src/components/VectorEditor/ToolPalette.jsx`
- Create: `src/components/VectorEditor/VectorEditor.css`

- [ ] **Step 1: Create `src/components/VectorEditor/ToolPalette.jsx`**

```jsx
import React from 'react';
import {
  MousePointer2, Square, Circle, Minus, PenLine, Type, Trash2
} from 'lucide-react';

const TOOLS = [
  { id: 'select', icon: MousePointer2, label: 'Select' },
  { id: 'rect',   icon: Square,        label: 'Rectangle' },
  { id: 'circle', icon: Circle,        label: 'Circle' },
  { id: 'line',   icon: Minus,         label: 'Line' },
  { id: 'pen',    icon: PenLine,       label: 'Freehand' },
  { id: 'text',   icon: Type,          label: 'Text' },
];

export default function ToolPalette({ activeTool, onToolChange, onDeleteSelected }) {
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
      <div className="tool-divider" />
      <button className="tool-btn tool-delete" title="Delete selected" onClick={onDeleteSelected}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/VectorEditor/VectorEditor.jsx`**

```jsx
import React, {
  useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback
} from 'react';
import { fabric } from 'fabric';
import ToolPalette from './ToolPalette';
import './VectorEditor.css';

const VectorEditor = forwardRef(function VectorEditor(
  { bedW = 200, bedH = 200, lineWidth = 1, injectedSVG = null },
  ref
) {
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const [activeTool, setActiveTool] = useState('select');
  const activeToolRef = useRef('select');
  const isDrawingRef = useRef(false);
  const originRef = useRef({ x: 0, y: 0 });
  const activeObjectRef = useRef(null);

  useImperativeHandle(ref, () => ({
    toSVG: () => fabricRef.current?.toSVG() ?? '',
    loadSVG: (svgString) => {
      if (!fabricRef.current) return;
      fabric.loadSVGFromString(svgString, (objects, options) => {
        const group = fabric.util.groupSVGElements(objects, options);
        group.scaleToWidth(Math.min(bedW * 0.9, group.width));
        fabricRef.current.add(group);
        fabricRef.current.renderAll();
      });
    },
  }));

  useEffect(() => {
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: bedW,
      height: bedH,
      backgroundColor: '#ffffff',
      selection: true,
    });
    fabricRef.current = canvas;

    // Bed boundary (excluded from SVG export via custom property)
    const border = new fabric.Rect({
      left: 0, top: 0, width: bedW, height: bedH,
      fill: 'transparent',
      stroke: '#555',
      strokeWidth: 0.5,
      strokeDashArray: [4, 4],
      selectable: false,
      evented: false,
      excludeFromExport: true,
    });
    canvas.add(border);
    canvas.sendToBack(border);

    const handleKeyDown = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement.tagName !== 'INPUT') {
        const active = canvas.getActiveObjects();
        canvas.discardActiveObject();
        active.forEach((obj) => {
          if (!obj.excludeFromExport) canvas.remove(obj);
        });
        canvas.renderAll();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      canvas.dispose();
    };
  }, [bedW, bedH]);

  // Inject SVG from tracer when prop changes
  useEffect(() => {
    if (!injectedSVG || !fabricRef.current) return;
    fabric.loadSVGFromString(injectedSVG, (objects, options) => {
      const group = fabric.util.groupSVGElements(objects, options);
      group.scaleToWidth(Math.min(bedW * 0.9, group.width ?? bedW));
      group.set({ left: bedW / 2, top: bedH / 2, originX: 'center', originY: 'center' });
      fabricRef.current.add(group);
      fabricRef.current.renderAll();
    });
  }, [injectedSVG, bedW, bedH]);

  const setTool = useCallback((tool) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    activeToolRef.current = tool;
    setActiveTool(tool);

    canvas.isDrawingMode = tool === 'pen';
    canvas.selection = tool === 'select';
    canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';

    if (tool === 'pen') {
      canvas.freeDrawingBrush.width = lineWidth;
      canvas.freeDrawingBrush.color = '#000000';
    }

    canvas.off('mouse:down');
    canvas.off('mouse:move');
    canvas.off('mouse:up');

    if (tool === 'rect' || tool === 'circle' || tool === 'line') {
      canvas.on('mouse:down', (opt) => {
        if (isDrawingRef.current) return;
        isDrawingRef.current = true;
        const p = canvas.getPointer(opt.e);
        originRef.current = { x: p.x, y: p.y };

        let shape;
        if (tool === 'rect') {
          shape = new fabric.Rect({
            left: p.x, top: p.y, width: 0, height: 0,
            fill: 'transparent', stroke: '#000', strokeWidth: lineWidth,
          });
        } else if (tool === 'circle') {
          shape = new fabric.Ellipse({
            left: p.x, top: p.y, rx: 0, ry: 0,
            fill: 'transparent', stroke: '#000', strokeWidth: lineWidth,
          });
        } else {
          shape = new fabric.Line([p.x, p.y, p.x, p.y], {
            stroke: '#000', strokeWidth: lineWidth,
          });
        }
        activeObjectRef.current = shape;
        canvas.add(shape);
      });

      canvas.on('mouse:move', (opt) => {
        if (!isDrawingRef.current || !activeObjectRef.current) return;
        const p = canvas.getPointer(opt.e);
        const o = originRef.current;
        const shape = activeObjectRef.current;

        if (tool === 'rect') {
          shape.set({
            left: Math.min(p.x, o.x), top: Math.min(p.y, o.y),
            width: Math.abs(p.x - o.x), height: Math.abs(p.y - o.y),
          });
        } else if (tool === 'circle') {
          shape.set({
            left: Math.min(p.x, o.x), top: Math.min(p.y, o.y),
            rx: Math.abs(p.x - o.x) / 2, ry: Math.abs(p.y - o.y) / 2,
          });
        } else {
          shape.set({ x2: p.x, y2: p.y });
        }
        canvas.renderAll();
      });

      canvas.on('mouse:up', () => {
        isDrawingRef.current = false;
        activeObjectRef.current = null;
      });
    }

    if (tool === 'text') {
      canvas.once('mouse:down', (opt) => {
        const p = canvas.getPointer(opt.e);
        const text = new fabric.IText('Text', {
          left: p.x, top: p.y,
          fontSize: 14, fill: '#000',
          fontFamily: 'Arial',
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
        canvas.renderAll();
        setTool('select');
      });
    }
  }, [lineWidth, bedW, bedH]);

  useEffect(() => {
    setTool(activeTool);
  }, [lineWidth]);

  const deleteSelected = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    canvas.discardActiveObject();
    active.forEach((obj) => {
      if (!obj.excludeFromExport) canvas.remove(obj);
    });
    canvas.renderAll();
  }, []);

  return (
    <div className="vector-editor">
      <ToolPalette
        activeTool={activeTool}
        onToolChange={setTool}
        onDeleteSelected={deleteSelected}
      />
      <div className="canvas-wrap">
        <canvas ref={canvasElRef} />
      </div>
    </div>
  );
});

export default VectorEditor;
```

- [ ] **Step 3: Create `src/components/VectorEditor/VectorEditor.css`**

```css
.vector-editor {
  display: flex;
  gap: 0.5rem;
  height: 100%;
  min-height: 0;
}

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

.tool-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tool-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.tool-btn.tool-delete {
  color: var(--error-color, #f44);
}

.tool-divider {
  height: 1px;
  background: var(--border-color);
  margin: 0.25rem 0;
}

.canvas-wrap {
  flex: 1;
  overflow: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 0.5rem;
}

.canvas-wrap canvas {
  display: block;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/VectorEditor/
git commit -m "feat: add Fabric.js VectorEditor with ToolPalette (Phase 1)"
```

---

## Task 6: ImageToGCodeTab Component

**Files:**
- Create: `src/pages/tabs/ImageToGCodeTab.jsx`

- [ ] **Step 1: Create `src/pages/tabs/ImageToGCodeTab.jsx`**

```jsx
import React, { useState, useRef } from 'react';
import { Upload, ArrowRight } from 'lucide-react';
import { useImageTracer } from '../../hooks/useImageTracer';

export default function ImageToGCodeTab({ onSendToDrawer }) {
  const { trace, result: tracedSVG, loading, error } = useImageTracer();
  const [options, setOptions] = useState({
    numberofcolors: 2,
    ltres: 1,
    qtres: 1,
    pathomit: 8,
  });
  const [previewSrc, setPreviewSrc] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreviewSrc(ev.target.result);
      trace(ev.target.result, options);
    };
    reader.readAsDataURL(file);
  };

  const handleRetrace = () => {
    if (previewSrc) trace(previewSrc, options);
  };

  const setOpt = (key, val) =>
    setOptions((prev) => ({ ...prev, [key]: val }));

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

        <div className="form-group">
          <label>Colors: {options.numberofcolors}</label>
          <input type="range" min="2" max="16" value={options.numberofcolors}
            onChange={(e) => setOpt('numberofcolors', Number(e.target.value))}
            className="slider" />
        </div>

        <div className="form-group">
          <label>Line Threshold (ltres): {options.ltres}</label>
          <input type="range" min="0.1" max="5" step="0.1" value={options.ltres}
            onChange={(e) => setOpt('ltres', Number(e.target.value))}
            className="slider" />
        </div>

        <div className="form-group">
          <label>Spline Threshold (qtres): {options.qtres}</label>
          <input type="range" min="0.1" max="5" step="0.1" value={options.qtres}
            onChange={(e) => setOpt('qtres', Number(e.target.value))}
            className="slider" />
        </div>

        <div className="form-group">
          <label>Min Path Length (pathomit): {options.pathomit}</label>
          <input type="range" min="1" max="32" value={options.pathomit}
            onChange={(e) => setOpt('pathomit', Number(e.target.value))}
            className="slider" />
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

- [ ] **Step 2: Commit**

```bash
git add src/pages/tabs/ImageToGCodeTab.jsx
git commit -m "feat: add ImageToGCodeTab with tracer controls and SVG preview"
```

---

## Task 7: VectorDrawerTab Component

**Files:**
- Create: `src/pages/tabs/VectorDrawerTab.jsx`

- [ ] **Step 1: Create `src/pages/tabs/VectorDrawerTab.jsx`**

```jsx
import React from 'react';
import VectorEditor from '../../components/VectorEditor/VectorEditor';

export default function VectorDrawerTab({ editorRef, bedW, bedH, lineWidth, injectedSVG }) {
  return (
    <div className="tab-content drawer-tab">
      <VectorEditor
        ref={editorRef}
        bedW={bedW}
        bedH={bedH}
        lineWidth={lineWidth}
        injectedSVG={injectedSVG}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/tabs/VectorDrawerTab.jsx
git commit -m "feat: add VectorDrawerTab wrapper component"
```

---

## Task 8: Image2GCodePage Rewrite (Parent + Bottom Bar)

**Files:**
- Rewrite: `src/pages/Image2GCodePage.jsx`
- Rewrite: `src/pages/Image2GCodePage.css`

- [ ] **Step 1: Rewrite `src/pages/Image2GCodePage.jsx`**

```jsx
import React, { useState, useRef, useCallback } from 'react';
import { useSerial } from '../contexts/SerialContext';
import { useSettings } from '../contexts/SettingsContext';
import ImageToGCodeTab from './tabs/ImageToGCodeTab';
import VectorDrawerTab from './tabs/VectorDrawerTab';
import GCodePreview from '../components/GCodePreview';
import { compileSVGToGCode } from '../lib/gcodeCompiler';
import { Play, Save, Zap } from 'lucide-react';
import './Image2GCodePage.css';

export default function Image2GCodePage() {
  const { connected, streaming, startStreaming } = useSerial();
  const { settings } = useSettings();
  const bedW = settings?.bedMaxX || 200;
  const bedH = settings?.bedMaxY || 200;

  const [activeTab, setActiveTab] = useState('image');
  const [lineWidth, setLineWidth] = useState(1);
  const [injectedSVG, setInjectedSVG] = useState(null);
  const [tracedSVG, setTracedSVG] = useState(null);
  const [compiledGCode, setCompiledGCode] = useState([]);
  const [compiling, setCompiling] = useState(false);
  const editorRef = useRef(null);

  const handleSendToDrawer = useCallback((svgString) => {
    setTracedSVG(svgString);
    setInjectedSVG(svgString);
    setActiveTab('drawer');
  }, []);

  const handleCompile = useCallback(() => {
    setCompiling(true);
    try {
      let svgSource = '';
      if (activeTab === 'drawer' && editorRef.current) {
        svgSource = editorRef.current.toSVG();
      } else if (tracedSVG) {
        svgSource = tracedSVG;
      }
      if (!svgSource) return;
      const lines = compileSVGToGCode(svgSource, {
        maxFeedrate: settings?.maxFeedrate || 1000,
        servoPenDown: settings?.servoPenDown || 30,
        servoPenUp: settings?.servoPenUp || 75,
      });
      setCompiledGCode(lines);
    } finally {
      setCompiling(false);
    }
  }, [activeTab, tracedSVG, settings]);

  const handleSave = useCallback(async () => {
    if (compiledGCode.length === 0) return;
    await window.platform.saveGCode(compiledGCode);
  }, [compiledGCode]);

  const handleStart = useCallback(() => {
    if (compiledGCode.length > 0) startStreaming(compiledGCode);
  }, [compiledGCode, startStreaming]);

  const canCompile = activeTab === 'drawer' || !!tracedSVG;

  return (
    <div className="page i2g-page">
      <div className="page-header">
        <h1 className="page-title">Image to G-Code</h1>
        <p className="page-subtitle">Trace images or draw vectors, then compile and run</p>
      </div>

      <div className="i2g-layout">
        {/* ── Tab bar ─────────────────────────────────────── */}
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

        {/* ── Tab content ─────────────────────────────────── */}
        <div className="i2g-tab-body">
          {activeTab === 'image' && (
            <ImageToGCodeTab onSendToDrawer={handleSendToDrawer} />
          )}
          {activeTab === 'drawer' && (
            <VectorDrawerTab
              editorRef={editorRef}
              bedW={bedW}
              bedH={bedH}
              lineWidth={lineWidth}
              injectedSVG={injectedSVG}
            />
          )}
        </div>

        {/* ── Shared bottom bar ────────────────────────────── */}
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
              disabled={!canCompile || compiling}
            >
              <Zap size={14} style={{ marginRight: 6 }} />
              {compiling ? 'Compiling…' : 'Compile Job'}
            </button>
          </div>

          <div className="bottom-bar-preview">
            <GCodePreview lines={compiledGCode} bedW={bedW} bedH={bedH} />
          </div>

          <div className="bottom-bar-right">
            <span className="gcode-line-count">
              {compiledGCode.length > 0 ? `${compiledGCode.length} lines` : 'No G-Code'}
            </span>
            <button
              className="btn btn-secondary"
              onClick={handleSave}
              disabled={compiledGCode.length === 0}
            >
              <Save size={14} style={{ marginRight: 6 }} />
              Save .gcode
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
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `src/pages/Image2GCodePage.css`**

```css
.i2g-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.i2g-layout {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 0;
}

/* ── Tabs ───────────────────────────────────────────────────── */
.i2g-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.i2g-tab {
  padding: 0.6rem 1.25rem;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.i2g-tab:hover { color: var(--text-primary); }

.i2g-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* ── Tab body ───────────────────────────────────────────────── */
.i2g-tab-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.tab-content {
  height: 100%;
  overflow: auto;
}

/* ── Image tab ──────────────────────────────────────────────── */
.image-tab {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 1rem;
  padding: 1rem;
  height: 100%;
  box-sizing: border-box;
}

.image-tab-controls {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.image-tab-preview {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

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

.preview-img {
  max-width: 100%;
  max-height: 200px;
  object-fit: contain;
}

.svg-preview {
  max-width: 100%;
  max-height: 100%;
}

.svg-preview svg {
  max-width: 100%;
  max-height: 250px;
  display: block;
}

/* ── Drawer tab ─────────────────────────────────────────────── */
.drawer-tab {
  padding: 1rem;
  box-sizing: border-box;
}

/* ── Bottom bar ─────────────────────────────────────────────── */
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

.bottom-bar-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}

.bottom-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.line-width-input {
  width: 70px;
}

.bottom-bar-preview {
  display: flex;
  justify-content: center;
}

.bottom-bar-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}

.gcode-line-count {
  font-size: 0.8rem;
  color: var(--text-muted);
  white-space: nowrap;
}

/* ── Shared form helpers ────────────────────────────────────── */
.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 0.4rem;
}

.file-input {
  width: 100%;
  font-size: 0.8rem;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.4rem;
}

.number-input {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  font-size: 0.875rem;
  width: 100%;
  box-sizing: border-box;
}

.slider {
  width: 100%;
  margin: 0.25rem 0;
}

.placeholder-text {
  color: var(--text-muted);
  font-style: italic;
  font-size: 0.85rem;
}

.error-text {
  color: var(--error-color, #f44);
  font-size: 0.8rem;
  margin-top: 0.5rem;
}

.btn-success {
  background: #2a7a2a;
  color: #fff;
}

.btn-success:hover:not(:disabled) {
  background: #338833;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/Image2GCodePage.jsx src/pages/Image2GCodePage.css src/pages/tabs/
git commit -m "feat: rewrite Image2GCodePage with two-tab layout and shared compile/preview bar"
```

---

## Task 9: Smoke Test + Fix

- [ ] **Step 1: Run the app**

```bash
cd "d:\University\Graduation Project\Desktop_App"
npm run electron:dev
```

- [ ] **Step 2: Verify Tab 1 (Image to G-Code)**
  - Navigate to "Image to G-Code" page in sidebar
  - Confirm two tabs appear: "Image to G-Code" / "Vector Drawer"
  - Upload a JPG → tracer controls appear → click Re-trace → loading message → SVG preview appears
  - Click "Open in Drawer" → switches to Drawer tab with SVG loaded on canvas
  - Return to Image tab → click "Compile Job" from Image tab → bottom bar shows line count and toolpath preview

- [ ] **Step 3: Verify Tab 2 (Vector Drawer)**
  - Switch to Vector Drawer tab
  - Select Rect tool → draw a rectangle on the canvas
  - Select Circle tool → draw a circle
  - Select tool → move/resize objects
  - Press Delete → selected object is removed
  - Click "Compile Job" → G-code compiles, preview renders in bottom bar
  - Click "Save .gcode" → native save dialog opens
  - If connected: "Run Job" button becomes active

- [ ] **Step 4: Fix any import/runtime errors found during smoke test**

Common issues to watch for:
  - `fabric` import: if `import { fabric } from 'fabric'` fails, try `import * as fabric from 'fabric'` and adjust usages to `fabric.fabric.Canvas`
  - Worker module: if `new Worker(new URL(...), { type: 'module' })` fails in Electron, check Vite's `worker.format` config
  - `DOMParser` in compiler: available in browser/renderer process, not in Node — keep it in the renderer only
  - `svg-path-parser` named exports: verify `import { parseSVG, makeAbsolute } from 'svg-path-parser'` works; check package exports if not

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix: resolve smoke test issues in image2gcode redesign"
```

---

## Self-Review Checklist

- [x] **Phase 1 (Fabric.js canvas):** VectorEditor, ToolPalette, Delete key, bed boundary, toSVG() via ref — Tasks 5, 7
- [x] **Phase 2 (Web Worker + tracer):** tracerWorker.js, useImageTracer hook, ImageToGCodeTab controls, SVG preview, "Open in Drawer" — Tasks 2, 6
- [x] **Phase 3 (SVG→GCode compiler):** gcodeCompiler.js, compile button active tab logic, settings injected — Task 3, 8
- [x] **Phase 4 (Preview + execution):** GCodePreview 2D renderer, startStreaming wired, save-gcode IPC — Tasks 1, 4, 8
- [x] **IPC save-gcode:** main.js + preload.js — Task 1
- [x] **lineWidth shared state:** owned by Image2GCodePage, passed to VectorEditor and bottom bar — Task 8
- [x] **injectedSVG flow:** tracedSVG → setInjectedSVG → VectorEditor prop → useEffect loads it — Tasks 6, 7, 8
- [x] **Tab pattern consistent with GCodeJobsPage:** internal state, same CSS approach — Task 8
