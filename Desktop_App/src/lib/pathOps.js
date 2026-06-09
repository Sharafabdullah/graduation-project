// Desktop_App/src/lib/pathOps.js
// Runs in both browser (Electron renderer) and Node (unit tests).
// svgToPaths / pathsToSvg use DOMParser — browser only.
//
// svg-path-parser and simplify-js are CJS packages; Vite handles CJS→ESM
// automatically in the browser build. For Node ESM unit tests the packages
// also expose a default export that works with a standard import.
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
