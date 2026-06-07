import { test } from 'node:test';
import assert from 'node:assert';
import { binarizeImageData, sampleCornerColor } from './imageBinarize.js';

test('binarizeImageData converts pixels below threshold to black and others to white', () => {
  const data = new Uint8ClampedArray([
    10, 10, 10, 255,
    240, 240, 240, 255,
  ]);
  const result = binarizeImageData({ width: 2, height: 1, data }, 128);
  assert.deepStrictEqual([...result.data], [0, 0, 0, 255, 255, 255, 255, 255]);
  assert.strictEqual(result.width, 2);
  assert.strictEqual(result.height, 1);
});

test('binarizeImageData uses perceptual luminance, not a flat average', () => {
  // Pure green has luminance ~150 (above threshold 128) -> white; pure blue ~29 -> black,
  // even though both have a single 255 channel and would average identically.
  const data = new Uint8ClampedArray([
    0, 255, 0, 255,
    0, 0, 255, 255,
  ]);
  const result = binarizeImageData({ width: 2, height: 1, data }, 128);
  assert.deepStrictEqual([...result.data.slice(0, 4)], [255, 255, 255, 255]);
  assert.deepStrictEqual([...result.data.slice(4, 8)], [0, 0, 0, 255]);
});

test('binarizeImageData never produces intermediate gray values', () => {
  const data = new Uint8ClampedArray(40);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256;
  const result = binarizeImageData({ width: 10, height: 1, data }, 100);
  for (let i = 0; i < result.data.length; i += 4) {
    assert.ok(result.data[i] === 0 || result.data[i] === 255);
    assert.strictEqual(result.data[i], result.data[i + 1]);
    assert.strictEqual(result.data[i], result.data[i + 2]);
    assert.strictEqual(result.data[i + 3], 255);
  }
});

test('sampleCornerColor averages the four corner regions', () => {
  const w = 10, h = 10;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200; data[i + 1] = 100; data[i + 2] = 50; data[i + 3] = 255;
  }
  assert.deepStrictEqual(sampleCornerColor({ width: w, height: h, data }), { r: 200, g: 100, b: 50 });
});

test('sampleCornerColor reflects the corners, not the interior', () => {
  const w = 10, h = 10;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const isInterior = x > 2 && x < 7 && y > 2 && y < 7;
      const [r, g, b] = isInterior ? [0, 0, 0] : [200, 100, 50];
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  assert.deepStrictEqual(sampleCornerColor({ width: w, height: h, data }), { r: 200, g: 100, b: 50 });
});

test('sampleCornerColor handles tiny images without producing NaN', () => {
  const px = (r, g, b) => new Uint8ClampedArray([r, g, b, 255]);
  assert.deepStrictEqual(sampleCornerColor({ width: 1, height: 1, data: px(10, 20, 30) }), { r: 10, g: 20, b: 30 });

  const data2x2 = new Uint8ClampedArray(2 * 2 * 4);
  for (let i = 0; i < data2x2.length; i += 4) {
    data2x2[i] = 50; data2x2[i + 1] = 60; data2x2[i + 2] = 70; data2x2[i + 3] = 255;
  }
  assert.deepStrictEqual(sampleCornerColor({ width: 2, height: 2, data: data2x2 }), { r: 50, g: 60, b: 70 });
});
