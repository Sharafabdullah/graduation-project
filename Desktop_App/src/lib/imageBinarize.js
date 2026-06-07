const LUMINANCE_R = 0.299;
const LUMINANCE_G = 0.587;
const LUMINANCE_B = 0.114;

export function binarizeImageData(imageData, threshold) {
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const luminance = LUMINANCE_R * data[i] + LUMINANCE_G * data[i + 1] + LUMINANCE_B * data[i + 2];
    const v = luminance < threshold ? 0 : 255;
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { width, height, data: out };
}

export function sampleCornerColor(imageData, marginRatio = 0.02) {
  const { width, height, data } = imageData;
  const mx = Math.max(1, Math.min(width - 1, Math.floor(width * marginRatio)));
  const my = Math.max(1, Math.min(height - 1, Math.floor(height * marginRatio)));
  const corners = [
    [mx, my],
    [width - 1 - mx, my],
    [mx, height - 1 - my],
    [width - 1 - mx, height - 1 - my],
  ];
  let r = 0, g = 0, b = 0;
  for (const [x, y] of corners) {
    const idx = (y * width + x) * 4;
    r += data[idx];
    g += data[idx + 1];
    b += data[idx + 2];
  }
  return { r: Math.round(r / 4), g: Math.round(g / 4), b: Math.round(b / 4) };
}
