const BACKGROUND_COLOR_DISTANCE = 60;

export function parseRgbColor(colorStr) {
  if (!colorStr) return null;
  const m = colorStr.trim().toLowerCase().match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!m) return null;
  return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
}

export function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

export function isWhiteOrNone(colorStr) {
  if (!colorStr || colorStr === 'none') return true;
  const c = colorStr.trim().toLowerCase().replace(/\s+/g, '');
  return c === 'white' || c === '#fff' || c === '#ffffff' || c === 'rgb(255,255,255)';
}

export function isBackgroundColor(colorStr, backgroundColor) {
  if (!colorStr || colorStr === 'none') return true;
  if (!backgroundColor) return isWhiteOrNone(colorStr);
  const c = parseRgbColor(colorStr);
  if (!c) return isWhiteOrNone(colorStr);
  return colorDistance(c, backgroundColor) <= BACKGROUND_COLOR_DISTANCE;
}
