import React, { useEffect, useRef } from 'react';
import './GCodePreview.css';

export default function GCodePreview({ lines = [], bedW = 200, bedH = 200 }) {
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
  }, [lines, bedW, bedH]);

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
