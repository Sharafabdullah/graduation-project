// Pure G-code → G-code transform: splits an oversized compiled job into a
// grid of bed-sized sub-jobs. No React/DOM dependency — testable with `node --test`.
// See docs/superpowers/specs/2026-06-08-large-image-job-splitting-design.md for the
// full design rationale (why G-code-level splitting, why no tile overlap, etc).

const EPSILON = 1e-6;

function pointsEqual(a, b) {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

// Walks `lines`, tracking position and pen state using the mode-agnostic M3/M4
// (tool on) / M5 (tool off) convention gcodeCompiler emits — the same
// recognition GCodePreview.jsx uses (including the legacy M280-angle fallback
// for old saved jobs, so split also works on jobs saved before that switch).
// Returns an ordered list of motion segments, one per G0/G1 line.
export function parseToolpathSegments(lines) {
  const segments = [];
  let cx = 0, cy = 0;
  let drawing = false;
  let feedRate = 0;

  for (const line of lines) {
    const trimmed = line.trim().toUpperCase();
    if (!trimmed || trimmed.startsWith(';')) continue;

    const fMatch = trimmed.match(/F([-\d.]+)/);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const xMatch = trimmed.match(/X([-\d.]+)/);
    const yMatch = trimmed.match(/Y([-\d.]+)/);

    if (!xMatch && !yMatch) {
      if (trimmed.startsWith('M3') || trimmed.startsWith('M4')) {
        drawing = true;
      } else if (trimmed.startsWith('M5')) {
        drawing = false;
      } else if (trimmed.includes('M280') && trimmed.includes('S')) {
        const sMatch = trimmed.match(/S([\d.]+)/);
        if (sMatch) drawing = parseFloat(sMatch[1]) < 60;
      }
      continue;
    }

    const nx = xMatch ? parseFloat(xMatch[1]) : cx;
    const ny = yMatch ? parseFloat(yMatch[1]) : cy;

    if (trimmed.startsWith('G0') || trimmed.startsWith('G1')) {
      segments.push({
        from: { x: cx, y: cy },
        to: { x: nx, y: ny },
        drawing: trimmed.startsWith('G1') && drawing,
        feedRate,
      });
    }

    cx = nx;
    cy = ny;
  }

  return segments;
}

// Bounding box of DRAWING segments only — mirrors the "Drawing bounding box"
// GCodePreview already overlays (GCodePreview.jsx:118-129). Excluding rapids
// (G0) is essential: the "G0 X0 Y0 ; return home" footer every compiled job
// ends with would otherwise pin the bbox to always include the origin.
export function computeDrawingBounds(segments) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const seg of segments) {
    if (!seg.drawing) continue;
    for (const p of [seg.from, seg.to]) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}
