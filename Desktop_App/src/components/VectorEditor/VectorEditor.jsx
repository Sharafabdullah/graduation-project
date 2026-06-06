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
    toSVG: () => {
      const canvas = fabricRef.current;
      if (!canvas) return '';
      // Temporarily remove bed boundary (excludeFromExport) so it doesn't become a cut path
      const excluded = canvas.getObjects().filter(o => o.excludeFromExport);
      excluded.forEach(o => canvas.remove(o));
      const svg = canvas.toSVG();
      excluded.forEach(o => canvas.add(o));
      if (excluded[0]) canvas.sendToBack(excluded[0]);
      return svg;
    },
    loadSVG: (svgString) => {
      if (!fabricRef.current) return;
      fabric.loadSVGFromString(svgString, (objects, options) => {
        const group = fabric.util.groupSVGElements(objects, options);
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
    canvas.add(border);
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
  }, [bedW, bedH]);

  // Inject SVG from tracer when prop changes
  useEffect(() => {
    if (!injectedSVG || !fabricRef.current) return;
    // Clear existing user objects (keep bed boundary)
    const canvas = fabricRef.current;
    canvas.getObjects().forEach((obj) => {
      if (!obj.excludeFromExport) canvas.remove(obj);
    });
    fabric.loadSVGFromString(injectedSVG, (objects, options) => {
      const group = fabric.util.groupSVGElements(objects, options);
      group.scaleToWidth(Math.min(bedW * 0.9, group.width ?? bedW));
      group.set({ left: bedW / 2, top: bedH / 2, originX: 'center', originY: 'center' });
      canvas.add(group);
      canvas.renderAll();
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
