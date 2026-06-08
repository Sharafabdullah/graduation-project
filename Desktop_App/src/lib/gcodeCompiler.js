// Runs in Electron renderer process only — uses DOMParser (browser API).
import { parseSVG, makeAbsolute } from 'svg-path-parser';
import Offset from 'polygon-offset';
import { isBackgroundColor } from './colorMatch';
import { tessellateQuadratic, tessellateCubic } from './bezier';

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

// Split a point set into M..Z (or M..<end>) subpaths. A single SVG <path>
// can contain several disjoint contours (e.g. letters with holes); each one
// starts at an 'M' and, if closed, ends at a 'Z'.
function splitIntoSubpaths(points) {
  const subpaths = [];
  let current = [];
  for (const pt of points) {
    if (pt.type === 'M' && current.length > 0) {
      subpaths.push(current);
      current = [pt];
    } else {
      current.push(pt);
    }
  }
  if (current.length > 0) subpaths.push(current);
  return subpaths;
}

function isClosedSubpath(subpath) {
  return subpath.length > 2 && subpath[subpath.length - 1].type === 'Z';
}

// Convert a polygon-offset ring (array of [x, y] pairs, possibly with the
// closing point repeated) back into the {type, x, y} point format the
// compiler's G-code generator expects. Returns [] for degenerate rings.
function ringToPoints(ring) {
  let pts = ring;
  if (pts.length > 1) {
    const [fx, fy] = pts[0];
    const [lx, ly] = pts[pts.length - 1];
    if (Math.abs(fx - lx) < 1e-6 && Math.abs(fy - ly) < 1e-6) pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return [];
  const out = pts.map(([x, y], i) => ({ type: i === 0 ? 'M' : 'L', x, y }));
  out.push({ type: 'Z', x: out[0].x, y: out[0].y });
  return out;
}

const MAX_FILL_PASSES = 200;

// Generate concentric inward-offset passes that fill a closed shape with
// parallel strokes spaced `lineWidth` apart — so a pen wider than a hairline
// can solid-fill the shape rather than draw only its outline. Returns an
// array of point sets, starting with the outline itself (pass 0) and
// shrinking inward until the shape is consumed or MAX_FILL_PASSES is hit.
//
// Limitation: only single-contour shapes are expanded this way (see the
// `isClosedSubpath`/length === 1 check at the call site). Offsetting a
// multi-contour shape (e.g. a letter "O") inward would shrink its inner
// hole boundary the wrong way — toward the hole rather than toward the
// filled ring — producing an incorrect toolpath. There is no off-the-shelf
// solution for hole-aware pen-plotter fill (see spec notes), so multi-
// contour shapes fall back to single-pass outline-only behaviour.
function generateFillPasses(subpath, lineWidth) {
  const outline = subpath.map((p) => ({ type: p.type === 'Z' ? 'Z' : p.type, x: p.x, y: p.y }));
  if (!(lineWidth > 0)) return [outline];

  const ring = subpath.map((p) => [p.x, p.y]);
  const passes = [outline];
  const offset = new Offset();

  for (let i = 1; i <= MAX_FILL_PASSES; i++) {
    let rings;
    try {
      rings = offset.data(ring).padding(i * lineWidth);
    } catch {
      break;
    }
    if (!rings || rings.length === 0) break;
    // Non-convex shrinkage can split a ring into fragments; keep the
    // largest one so the toolpath stays a single simple pass per offset step.
    const largest = rings.reduce((a, b) => (b.length > a.length ? b : a));
    const passPoints = ringToPoints(largest);
    if (passPoints.length === 0) break;
    passes.push(passPoints);
  }
  return passes;
}

function extractAllPointSets(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const root = doc.documentElement;
  const all = [];

  const add = (el, fn) => {
    const t = getElementTransform(el, root);
    const pts = fn(el, t);
    if (pts.length > 0) {
      let color = el.getAttribute('fill') || el.getAttribute('stroke') || 'black';
      if (color === 'none') color = el.getAttribute('stroke') || 'black';
      all.push({ points: pts, color });
    }
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
    multicolorMode = false,
    backgroundColor = null,
    lineWidth = 0,
    fillWideStrokes = false,
  } = settings;

  if (maxFeedrate <= 0) throw new RangeError('maxFeedrate must be positive');

  // Opt-in: expand a single-contour closed shape into N concentric inward
  // passes spaced `lineWidth` apart, so a pen wider than a hairline can
  // solid-fill it instead of drawing only its outline. Open paths and
  // multi-contour shapes (e.g. letters with holes) are left as single-pass
  // outlines — see generateFillPasses() for why holes can't be handled here.
  const expandForFill = (points) => {
    if (!fillWideStrokes || !(lineWidth > 0)) return [points];
    const subpaths = splitIntoSubpaths(points);
    if (subpaths.length !== 1 || !isClosedSubpath(subpaths[0])) return [points];
    return generateFillPasses(subpaths[0], lineWidth);
  };

  const allPointSets = extractAllPointSets(svgString);
  const lines = [];

  lines.push('; Generated by Platform Control');
  lines.push('G21 ; mm units');
  lines.push('G90 ; absolute positioning');
  lines.push(`F${maxFeedrate}`);
  lines.push(`M5 ; tool off`);

  // Helper to generate gcode for a single point set
  const generatePathGcode = (points) => {
    if (points.length === 0) return;
    let penDown = false;

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const x = pt.x.toFixed(3);
      const y = (bedH - pt.y).toFixed(3); // flip Y: SVG Y grows down, machine Y grows up

      if (i === 0 || pt.type === 'M') {
        if (penDown) {
          lines.push(`M5 ; tool off`);
          penDown = false;
        }
        lines.push(`G0 X${x} Y${y}`);
      } else if (pt.type === 'Z') {
        lines.push(`G1 X${x} Y${y} F${maxFeedrate}`);
        lines.push(`M5 ; tool off`);
        penDown = false;
      } else {
        if (!penDown) {
          lines.push(`M3 ; tool on`);
          penDown = true;
        }
        lines.push(`G1 X${x} Y${y} F${maxFeedrate}`);
      }
    }

    if (penDown) {
      lines.push(`M5 ; tool off`);
    }
  };

  const validSets = allPointSets.filter(s => !isBackgroundColor(s.color, backgroundColor));

  if (multicolorMode) {
    const colorGroups = {};
    for (const set of validSets) {
      if (!colorGroups[set.color]) colorGroups[set.color] = [];
      colorGroups[set.color].push(set.points);
    }
    for (const [color, groups] of Object.entries(colorGroups)) {
      lines.push(`M0 ; Change pen to color: ${color}`);
      for (const points of groups) {
        for (const pass of expandForFill(points)) generatePathGcode(pass);
      }
    }
  } else {
    for (const set of validSets) {
      for (const pass of expandForFill(set.points)) generatePathGcode(pass);
    }
  }

  return lines;
}
