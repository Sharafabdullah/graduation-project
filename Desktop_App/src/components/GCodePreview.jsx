import React, { useEffect, useRef } from 'react';
import './GCodePreview.css';

export default function GCodePreview({ lines = [], bedW = 200, bedH = 200, softLimitMargin = 10 }) {
  const canvasRef = useRef(null);

  // Maintain bed aspect ratio within a 400px bounding box
  const PREVIEW_MAX = 400;
  const aspect = bedW / bedH;
  const canvasW = aspect >= 1 ? PREVIEW_MAX : Math.round(PREVIEW_MAX * aspect);
  const canvasH = aspect <= 1 ? PREVIEW_MAX : Math.round(PREVIEW_MAX / aspect);

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

    // Soft-limit inner border
    const marginPxX = softLimitMargin * scaleX;
    const marginPxY = softLimitMargin * scaleY;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(marginPxX, marginPxY, W - 2 * marginPxX, H - 2 * marginPxY);
    ctx.restore();

    // Drawing bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    lines.forEach(line => {
      const upper = line.trim().toUpperCase();
      if (!upper.startsWith('G0') && !upper.startsWith('G1')) return;
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
  }, [lines, bedW, bedH, softLimitMargin]);

  return (
    <div className="gcode-preview-wrap">
      <canvas
        ref={canvasRef}
        className="gcode-preview-canvas"
        width={canvasW}
        height={canvasH}
      />
    </div>
  );
}
