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
 * Returns true if a position falls in the warn/flag zone.
 *
 * Rule:
 *   - x < softLimitMargin  OR  x > bedMaxX - softLimitMargin  → flagged
 *   - y < softLimitMargin  OR  y > bedMaxY - softLimitMargin  → flagged
 *   - Exception: x === 0 AND y === 0 (explicit home return) → never flagged
 *
 * x or y may be null (axis not specified in the G-code line); only non-null axes are checked.
 */
export function isInWarnZone(x, y, { bedMaxX, bedMaxY, softLimitMargin }) {
  if (x === null && y === null) return false;
  if ((x === null || x === 0) && (y === null || y === 0)) return false;
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
 * Scan an array of G-code line strings for boundary violations.
 * Only checks G0 and G1 lines that contain X or Y coordinates.
 * Returns an array of violation objects: { lineIndex, line, x, y }.
 */
export function scanGCodeBounds(lines, { bedMaxX, bedMaxY, softLimitMargin }) {
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].trim().toUpperCase();
    if (!upper.startsWith('G0') && !upper.startsWith('G1')) continue;
    const pos = parseXY(upper);
    if (!pos) continue;
    if (isInWarnZone(pos.x, pos.y, { bedMaxX, bedMaxY, softLimitMargin })) {
      violations.push({ lineIndex: i, line: lines[i], x: pos.x, y: pos.y });
    }
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
