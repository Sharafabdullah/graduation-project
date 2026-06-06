// Runs in Electron renderer process only — uses DOMParser (browser API).
import { parseSVG, makeAbsolute } from 'svg-path-parser';

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

function applyTransform(x, y, m) {
  if (!m) return { x, y };
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

// Compose all transforms from element up to (but not including) svgRoot
function getElementTransform(el, svgRoot) {
  const matrices = [];
  let node = el;
  while (node && node !== svgRoot) {
    const t = parseTransform(node.getAttribute && node.getAttribute('transform'));
    if (t) matrices.unshift(t);
    node = node.parentElement;
  }
  if (matrices.length === 0) return null;
  return matrices.reduce((acc, m) => ({
    a: acc.a * m.a + acc.c * m.b,
    b: acc.b * m.a + acc.d * m.b,
    c: acc.a * m.c + acc.c * m.d,
    d: acc.b * m.c + acc.d * m.d,
    e: acc.a * m.e + acc.c * m.f + acc.e,
    f: acc.b * m.e + acc.d * m.f + acc.f,
  }), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
}

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

function rectToPoints(el, transform) {
  const x = parseFloat(el.getAttribute('x') || 0);
  const y = parseFloat(el.getAttribute('y') || 0);
  const w = parseFloat(el.getAttribute('width') || 0);
  const h = parseFloat(el.getAttribute('height') || 0);
  if (w <= 0 || h <= 0) return [];
  return [
    [x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y],
  ].map(([px, py], i) => {
    const p = applyTransform(px, py, transform);
    return { type: i === 0 ? 'M' : i === 4 ? 'Z' : 'L', x: p.x, y: p.y };
  });
}

function ellipseToPoints(el, transform, steps = 64) {
  const cx = parseFloat(el.getAttribute('cx') || 0);
  const cy = parseFloat(el.getAttribute('cy') || 0);
  const rx = parseFloat(el.getAttribute('rx') || el.getAttribute('r') || 0);
  const ry = parseFloat(el.getAttribute('ry') || el.getAttribute('r') || 0);
  if (rx <= 0 || ry <= 0) return [];
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const p = applyTransform(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle), transform);
    pts.push({ type: i === 0 ? 'M' : 'L', x: p.x, y: p.y });
  }
  pts.push({ type: 'Z', x: pts[0].x, y: pts[0].y });
  return pts;
}

function lineToPoints(el, transform) {
  const p1 = applyTransform(
    parseFloat(el.getAttribute('x1') || 0),
    parseFloat(el.getAttribute('y1') || 0),
    transform
  );
  const p2 = applyTransform(
    parseFloat(el.getAttribute('x2') || 0),
    parseFloat(el.getAttribute('y2') || 0),
    transform
  );
  return [{ type: 'M', x: p1.x, y: p1.y }, { type: 'L', x: p2.x, y: p2.y }];
}

function extractAllPointSets(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const root = doc.documentElement;
  const all = [];

  const add = (el, fn) => {
    const t = getElementTransform(el, root);
    const pts = fn(el, t);
    if (pts.length > 0) all.push(pts);
  };

  root.querySelectorAll('path').forEach(el => {
    const d = el.getAttribute('d');
    if (d) add(el, (e, t) => pathToPoints(d, t));
  });
  root.querySelectorAll('rect').forEach(el => add(el, rectToPoints));
  root.querySelectorAll('ellipse, circle').forEach(el => add(el, ellipseToPoints));
  root.querySelectorAll('line').forEach(el => add(el, lineToPoints));

  return all;
}

export function compileSVGToGCode(svgString, settings = {}) {
  const {
    maxFeedrate = 1000,
    servoPenDown = 30,
    servoPenUp = 75,
    bedH = 200,
  } = settings;

  if (maxFeedrate <= 0) throw new RangeError('maxFeedrate must be positive');

  const allPointSets = extractAllPointSets(svgString);
  const lines = [];

  lines.push('; Generated by Platform Control');
  lines.push('G21 ; mm units');
  lines.push('G90 ; absolute positioning');
  lines.push(`F${maxFeedrate}`);
  lines.push(`M280 P0 S${servoPenUp} ; pen up`);

  for (const points of allPointSets) {
    if (points.length === 0) continue;
    let penDown = false;

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const x = pt.x.toFixed(3);
      const y = (bedH - pt.y).toFixed(3); // flip Y: SVG Y grows down, machine Y grows up

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
