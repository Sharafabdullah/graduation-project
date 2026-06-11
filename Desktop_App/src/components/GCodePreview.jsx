import React, { useEffect, useRef, useState } from 'react';
import './GCodePreview.css';

export default function GCodePreview({ lines = [], bedW = 200, bedH = 200, softLimitMargin = 10, homeFloor = null }) {
  const canvasRef = useRef(null);
  const wrapRef   = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ w: 400, h: 400 });

  // Fill the wrapper while preserving the bed aspect ratio
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const compute = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const pad = 16;
      const maxW = Math.max(width  - pad, 10);
      const maxH = Math.max(height - pad, 10);
      const aspect = bedW / bedH;
      let w, h;
      if (maxW / maxH > aspect) { h = maxH; w = h * aspect; }
      else                       { w = maxW; h = w / aspect; }
      setCanvasSize({ w: Math.round(w), h: Math.round(h) });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [bedW, bedH]);

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

    // Flip Y: machine Y=0 is at bottom, SVG/canvas Y=0 is at top
    const toCanvas = (x, y) => [x * scaleX, (bedH - y) * scaleY];

    for (const line of lines) {
      const trimmed = line.trim().toUpperCase();
      if (!trimmed || trimmed.startsWith(';')) continue;

      const xMatch = trimmed.match(/X([-\d.]+)/);
      const yMatch = trimmed.match(/Y([-\d.]+)/);
      if (!xMatch && !yMatch) {
        // gcodeCompiler now emits the mode-agnostic M3 (tool on) / M5 (tool off)
        // convention (matching the multi-mode firmware and every built-in program),
        // not the legacy M280 servo-angle command — recognize both so old saved
        // jobs still preview correctly. M4 (laser dynamic mode) also counts as "on".
        if (trimmed.startsWith('M3') || trimmed.startsWith('M4')) {
          penDown = true;
        } else if (trimmed.startsWith('M5')) {
          penDown = false;
        } else if (trimmed.includes('M280') && trimmed.includes('S')) {
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
      } else if ((trimmed.startsWith('G2') || trimmed.startsWith('G3')) && penDown) {
        const iMatch = trimmed.match(/I([-\d.]+)/);
        const jMatch = trimmed.match(/J([-\d.]+)/);
        const oI = iMatch ? parseFloat(iMatch[1]) : 0;
        const oJ = jMatch ? parseFloat(jMatch[1]) : 0;
        const acx = cx + oI, acy = cy + oJ;
        const ar  = Math.sqrt(oI*oI + oJ*oJ);
        if (ar > 0.01) {
          // sa/ea are angles in machine coords (Y-up). Canvas Y is flipped, so negate.
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

      cx = nx;
      cy = ny;
    }

    // Soft-limit inner border
    const marginPxX = softLimitMargin * scaleX;
    const marginPxY = softLimitMargin * scaleY;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(marginPxX, marginPxY, W - 2 * marginPxX, H - 2 * marginPxY);
    ctx.restore();

    // Hard safety floor near the limit switches (machine (0,0) corner).
    // Distinct from the soft-limit margin above: this marks how far the head
    // backed off during the last successful homing pass — crossing back below
    // it risks re-triggering or grinding past the switches. Only meaningful
    // (and only drawn) once the machine has actually been homed.
    if (homeFloor) {
      const floorPxX = homeFloor.x * scaleX;
      const floorPxY = homeFloor.y * scaleY;
      ctx.save();
      ctx.fillStyle = 'rgba(241, 76, 76, 0.12)';
      ctx.strokeStyle = 'rgba(241, 76, 76, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      // x < floorX band (left edge, full bed height)
      ctx.fillRect(0, 0, floorPxX, H);
      ctx.strokeRect(0, 0, floorPxX, H);
      // y < floorY band (bottom edge, full bed width — canvas Y is flipped)
      ctx.fillRect(0, H - floorPxY, W, floorPxY);
      ctx.strokeRect(0, H - floorPxY, W, floorPxY);
      ctx.restore();
    }

    // Drawing bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    lines.forEach(line => {
      const upper = line.trim().toUpperCase();
      if (!upper.startsWith('G1') && !upper.startsWith('G2') && !upper.startsWith('G3')) return;
      const xM = upper.match(/X([-\d.]+)/);
      const yM = upper.match(/Y([-\d.]+)/);
      const x = xM ? parseFloat(xM[1]) : null;
      const y = yM ? parseFloat(yM[1]) : null;
      if (x !== null) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      if (y !== null) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    });

    if (minX !== Infinity && minY !== Infinity) {
      // Y is flipped: machine Y=0 is at bottom, canvas Y=0 is at top
      const bx = minX * scaleX;
      const by = (bedH - maxY) * scaleY;
      const bw = (maxX - minX) * scaleX;
      const bh = (maxY - minY) * scaleY;
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 191, 255, 0.5)';
      ctx.fillStyle = 'rgba(0, 191, 255, 0.07)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
      // dimension label
      const drawW = (maxX - minX).toFixed(0);
      const drawH = (maxY - minY).toFixed(0);
      ctx.fillStyle = 'rgba(0, 191, 255, 0.9)';
      ctx.font = '10px monospace';
      ctx.fillText(`${drawW} × ${drawH} mm`, bx + 3, by + 12);
      ctx.restore();
    }

    // Bed dimension labels
    ctx.save();
    ctx.fillStyle = 'rgba(180, 180, 180, 0.8)';
    ctx.font = '11px monospace';
    // Bottom edge: "{bedW} mm" centered
    ctx.textAlign = 'center';
    ctx.fillText(`${bedW} mm`, W / 2, H - 4);
    // Left edge: "{bedH} mm" rotated 90°
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(12, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${bedH} mm`, 0, 0);
    ctx.restore();
    ctx.restore();

    // Axis indicators
    ctx.save();
    ctx.fillStyle = 'rgba(180, 180, 180, 0.7)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('X→', W - 24, H - 4);
    ctx.fillText('↑Y', 2, 14);
    ctx.restore();
  }, [lines, bedW, bedH, softLimitMargin, homeFloor, canvasSize]);

  return (
    <div ref={wrapRef} className="gcode-preview-wrap">
      <canvas
        ref={canvasRef}
        className="gcode-preview-canvas"
        width={canvasSize.w}
        height={canvasSize.h}
      />
    </div>
  );
}
