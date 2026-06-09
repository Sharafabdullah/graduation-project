import React, {
  useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback
} from 'react';
import { fabric } from 'fabric';
import ToolPalette from './ToolPalette';
import './VectorEditor.css';
import Dialog from '../Dialog';
import { isBackgroundColor } from '../../lib/colorMatch';

const VectorEditor = forwardRef(function VectorEditor(
  {
    bedW = 200, bedH = 200, lineWidth = 1,
    backgroundColor = null, softLimitMargin = 10, homed = false, homeFloor = null,
  },
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
    toSVG: () => {
      const canvas = fabricRef.current;
      if (!canvas) return '';
      const excluded = canvas.getObjects().filter(o => o.excludeFromExport);
      excluded.forEach(o => canvas.remove(o));
      const svg = canvas.toSVG();
      excluded.forEach(o => canvas.add(o));
      if (excluded[0]) canvas.sendToBack(excluded[0]);
      return svg;
    },
    // Replace all canvas content with the given SVG
    loadSVG: (svgString) => {
      if (!fabricRef.current) return;
      const canvas = fabricRef.current;
      canvas.getObjects().forEach(obj => { if (!obj.excludeFromExport) canvas.remove(obj); });
      fabric.loadSVGFromString(svgString, (objects, options) => {
        const filtered = objects.filter(o => !isBackgroundColor(o.fill, backgroundColor));
        const group = fabric.util.groupSVGElements(filtered, options);
        group.scaleToWidth(Math.min(bedW * 0.9, group.width ?? bedW));
        group.set({ left: bedW / 2, top: bedH / 2, originX: 'center', originY: 'center' });
        canvas.add(group);
        canvas.renderAll();
      });
    },
    // Add SVG to canvas WITHOUT clearing existing content
    addSVG: (svgString) => {
      if (!fabricRef.current) return;
      fabric.loadSVGFromString(svgString, (objects, options) => {
        const filtered = objects.filter(o => !isBackgroundColor(o.fill, backgroundColor));
        const group = fabric.util.groupSVGElements(filtered, options);
        group.scaleToWidth(Math.min(bedW * 0.9, group.width ?? bedW));
        group.set({ left: bedW / 2, top: bedH / 2, originX: 'center', originY: 'center' });
        fabricRef.current.add(group);
        fabricRef.current.renderAll();
      });
    },
  }));

  useEffect(() => {
    // Scale canvas pixels so the editor is comfortably large (target ~600px for a 200mm bed)
    const displayScale = Math.max(2, Math.min(4, 600 / Math.max(bedW, bedH)));
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: bedW * displayScale,
      height: bedH * displayScale,
      backgroundColor: '#ffffff',
      selection: true,
    });
    canvas.setZoom(displayScale);
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

    // Soft-limit margin zone — a dashed inset rect distinct from the bed
    // boundary's dash pattern/color (matches GCodePreview's amber [4,4] vs.
    // this inset zone's tighter [2,2] dash), so the editor previews the same
    // "stay off the edges" guidance the G-Code Outline tab already shows.
    const marginZone = new fabric.Rect({
      left: softLimitMargin, top: softLimitMargin,
      width: Math.max(0, bedW - 2 * softLimitMargin),
      height: Math.max(0, bedH - 2 * softLimitMargin),
      fill: 'transparent',
      stroke: 'rgba(255, 200, 0, 0.35)',
      strokeWidth: 0.5,
      strokeDashArray: [2, 2],
      selectable: false,
      evented: false,
      excludeFromExport: true,
    });

    canvas.add(border, marginZone);
    canvas.sendToBack(marginZone);
    canvas.sendToBack(border);

    const handleKeyDown = (e) => {
      const activeObj = canvas.getActiveObject();
      if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement.tagName !== 'INPUT' && !activeObj?.isEditing) {
        const active = canvas.getActiveObjects();
        canvas.discardActiveObject();
        active.forEach((obj) => {
          if (!obj.excludeFromExport) canvas.remove(obj);
        });
        canvas.renderAll();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Apply the initial tool after canvas is ready
    setTool(activeToolRef.current);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      canvas.dispose();
    };
  }, [bedW, bedH, softLimitMargin]);

  // Hard safety floor near the limit switches (machine origin corner) —
  // mirrors GCodePreview's homeFloor overlay so the drawer previews the same
  // danger zone. Only meaningful (and only drawn) once homed; redrawn whenever
  // homing state/floor changes without needing to recreate the whole canvas.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.getObjects().filter(o => o.isHomeFloorOverlay).forEach(o => canvas.remove(o));
    if (homed && homeFloor) {
      const floorStyle = {
        fill: 'rgba(241, 76, 76, 0.12)',
        stroke: 'rgba(241, 76, 76, 0.6)',
        strokeWidth: 0.5,
        strokeDashArray: [1, 1],
        selectable: false,
        evented: false,
        excludeFromExport: true,
        isHomeFloorOverlay: true,
      };
      // Machine (0, 0) is the bottom-left corner of the bed; canvas Y grows
      // downward (the opposite of machine Y — the compiler flips it on
      // export), so the danger bands hug the left edge (x < floorX) and the
      // bottom edge (canvas top = bedH - floorY, for y < floorY).
      canvas.add(
        new fabric.Rect({ ...floorStyle, left: 0, top: 0, width: homeFloor.x, height: bedH }),
        new fabric.Rect({ ...floorStyle, left: 0, top: bedH - homeFloor.y, width: bedW, height: homeFloor.y })
      );
    }
    canvas.renderAll();
  }, [homed, homeFloor, bedW, bedH]);

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

    if (tool === 'eraser') {
      canvas.defaultCursor = 'cell';
      canvas.on('mouse:down', (opt) => {
        const p = canvas.getPointer(opt.e);
        // Use bounding-box hit detection so transparent-fill shapes (circles,
        // rects) are erasable even when clicking through their hollow interior.
        const erasable = canvas.getObjects().filter(o => !o.excludeFromExport);
        // Iterate in reverse so the topmost (last-drawn) object is removed first.
        for (let i = erasable.length - 1; i >= 0; i--) {
          const obj = erasable[i];
          const br = obj.getBoundingRect(true);
          if (p.x >= br.left && p.x <= br.left + br.width &&
              p.y >= br.top  && p.y <= br.top  + br.height) {
            canvas.remove(obj);
            canvas.renderAll();
            break;
          }
        }
      });
    }

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
        // Keep hit-detection bounding coords in sync with the updated geometry.
        shape.setCoords();
        canvas.renderAll();
      });

      canvas.on('mouse:up', () => {
        const shape = activeObjectRef.current;
        if (shape) {
          // Remove shapes that were never dragged (zero/near-zero size) —
          // these are invisible and pollute the canvas / G-code output.
          const tooSmall =
            (shape.type === 'ellipse' && shape.rx < 1 && shape.ry < 1) ||
            (shape.type === 'rect'    && shape.width < 1 && shape.height < 1) ||
            (shape.type === 'line'    && Math.abs(shape.x2 - shape.x1) < 1 &&
                                         Math.abs(shape.y2 - shape.y1) < 1);
          if (tooSmall) canvas.remove(shape);
        }
        isDrawingRef.current = false;
        activeObjectRef.current = null;
        canvas.renderAll();
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
    if (fabricRef.current) {
      setTool(activeToolRef.current);
    }
  }, [lineWidth, setTool]);

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

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const deleteAll = useCallback(() => {
    if (!fabricRef.current) return;
    setConfirmDeleteOpen(true);
  }, []);

  const confirmDeleteAll = useCallback(() => {
    const canvas = fabricRef.current;
    setConfirmDeleteOpen(false);
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.getObjects().forEach((obj) => {
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

export default VectorEditor;
