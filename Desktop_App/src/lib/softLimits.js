/**
 * Parse X and Y coordinates from a single G-code line.
 * Returns { x, y } where either may be null if not present.
 * Returns null if the line has neither X nor Y.
 */
export function parseXY(line) {
  const upper = line.trim().toUpperCase();
  const xMatch = upper.match(/X([-\d.]+)/);
  const yMatch = upper.match(/Y([-\d.]+)/);
  if (!xMatch && !yMatch) return null;
  return {
    x: xMatch ? parseFloat(xMatch[1]) : null,
    y: yMatch ? parseFloat(yMatch[1]) : null,
  };
}

/**
 * Returns true if a position falls in the warn/flag zone near the bed edges.
 *
 * Rule:
 *   - x < softLimitMargin  OR  x > bedMaxX - softLimitMargin  → flagged
 *   - y < softLimitMargin  OR  y > bedMaxY - softLimitMargin  → flagged
 *
 * x or y may be null (axis not specified in the G-code line); only non-null axes are checked.
 *
 * NOTE: this is a "stay away from the edges of the drawable area" warning — it is
 * NOT the hard safety floor near the limit switches. For that, see violatesSafeFloor().
 * (0, 0) is intentionally NOT exempted: machine (0, 0) is the limit-switch position,
 * the single most dangerous point on the machine, and must be flagged like anywhere else.
 */
export function isInWarnZone(x, y, { bedMaxX, bedMaxY, softLimitMargin }) {
  if (x === null && y === null) return false;
  if (x !== null) {
    if (x < softLimitMargin) return true;
    if (x > bedMaxX - softLimitMargin) return true;
  }
  if (y !== null) {
    if (y < softLimitMargin) return true;
    if (y > bedMaxY - softLimitMargin) return true;
  }
  return false;
}

/**
 * Returns true if a position would cross the hard safety floor near the limit
 * switches — the distance the machine retreated to during the most recent
 * homing pass (homingBackoff at the time homing completed).
 *
 * Unlike isInWarnZone (a soft "stay inside the drawable area" warning), this is
 * a hard physical-safety boundary: machine (0, 0) is the limit-switch position,
 * and floorX/floorY mark how far the head backed off from it. Crossing back below
 * that point risks re-triggering — or grinding past — the switches.
 *
 * floorX/floorY must be the ACTUAL backoff distance used during the last homing
 * pass, not necessarily the current `homingBackoff` setting — if the user changes
 * that setting afterward, the physical retreat the machine already performed
 * doesn't change retroactively. The new value only takes effect on the next home.
 *
 * x or y may be null (axis not specified); only non-null axes are checked.
 */
export function violatesSafeFloor(x, y, floorX, floorY) {
  if (x !== null && x < floorX) return true;
  if (y !== null && y < floorY) return true;
  return false;
}

// Axis-aligned bounding box of a G2/G3 arc in machine coordinates.
// x0,y0 = start; x1,y1 = end; i,j = offsets from start to center; cw = clockwise
function arcBounds(x0, y0, x1, y1, i, j, cw) {
  const cx = x0 + i, cy = y0 + j;
  const r  = Math.sqrt(i*i + j*j);
  const startAngle = Math.atan2(y0 - cy, x0 - cx);
  const endAngle   = Math.atan2(y1 - cy, x1 - cx);

  let sweep;
  if (cw) { sweep = startAngle - endAngle; if (sweep <= 0) sweep += 2*Math.PI; }
  else     { sweep = endAngle - startAngle; if (sweep <= 0) sweep += 2*Math.PI; }

  const pts = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
  for (const cardAngle of [0, Math.PI/2, Math.PI, 3*Math.PI/2]) {
    let delta = cw ? (startAngle - cardAngle) : (cardAngle - startAngle);
    while (delta < 0) delta += 2*Math.PI;
    if (delta <= sweep) pts.push({ x: cx + r*Math.cos(cardAngle), y: cy + r*Math.sin(cardAngle) });
  }
  return {
    minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
    minY: Math.min(...pts.map(p => p.y)), maxY: Math.max(...pts.map(p => p.y)),
  };
}

/**
 * Scan an array of G-code line strings for boundary violations.
 * Checks G0/G1 linear moves and G2/G3 arc moves (including full arc extent).
 * Returns an array of violation objects: { lineIndex, line, x, y }.
 */
export function scanGCodeBounds(lines, { bedMaxX, bedMaxY, softLimitMargin }) {
  const violations = [];
  let cx = 0, cy = 0; // track current machine position for arc bounds

  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].trim().toUpperCase();
    const isG01 = upper.startsWith('G0 ') || upper.startsWith('G1 ') || upper === 'G0' || upper === 'G1';
    const isG23 = /^G[23][\s]/.test(upper);

    if (!isG01 && !isG23) continue;

    const pos = parseXY(upper);
    if (!pos) continue;
    const nx = pos.x !== null ? pos.x : cx;
    const ny = pos.y !== null ? pos.y : cy;

    if (isG01) {
      if (isInWarnZone(pos.x, pos.y, { bedMaxX, bedMaxY, softLimitMargin })) {
        violations.push({ lineIndex: i, line: lines[i], x: pos.x, y: pos.y });
      }
    } else {
      const iMatch = upper.match(/I([-\d.]+)/);
      const jMatch = upper.match(/J([-\d.]+)/);
      const oI = iMatch ? parseFloat(iMatch[1]) : 0;
      const oJ = jMatch ? parseFloat(jMatch[1]) : 0;
      const cw = upper[1] === '2';
      const b  = arcBounds(cx, cy, nx, ny, oI, oJ, cw);
      const checks = [
        { x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY },
        { x: b.minX, y: b.maxY }, { x: b.maxX, y: b.maxY },
        { x: nx,     y: ny     },
      ];
      if (checks.some(pt => isInWarnZone(pt.x, pt.y, { bedMaxX, bedMaxY, softLimitMargin }))) {
        violations.push({ lineIndex: i, line: lines[i], x: nx, y: ny });
      }
    }

    cx = nx; cy = ny;
  }
  return violations;
}

/**
 * Returns true if a positive-direction jog would exceed the soft ceiling.
 * Only applies when direction > 0 (negative jogs are bounded by physical stop).
 *
 * @param {number} currentPos  Current axis position in mm
 * @param {number} increment   Jog step magnitude (always positive)
 * @param {'X'|'Y'} axis
 * @param {object} settings    Must contain bedMaxX, bedMaxY, softLimitMargin
 */
export function wouldExceedPositiveLimit(currentPos, increment, axis, { bedMaxX, bedMaxY, softLimitMargin }) {
  const target = currentPos + increment;
  const ceiling = axis === 'X' ? bedMaxX - softLimitMargin : bedMaxY - softLimitMargin;
  return target > ceiling;
}

/**
 * Returns true if a negative-direction jog would cross the hard safety floor
 * near the limit switches (see violatesSafeFloor for what `floor` represents
 * and why it must be the backoff distance captured at homing time, not the
 * live `homingBackoff` setting).
 *
 * @param {number} currentPos  Current axis position in mm (machine-absolute)
 * @param {number} increment   Jog step magnitude (always positive)
 * @param {number} floor       Actual backoff distance used during the last homing pass
 */
export function wouldCrossSafeFloor(currentPos, increment, floor) {
  return (currentPos - increment) < floor;
}
