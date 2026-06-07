import { test } from 'node:test';
import assert from 'node:assert';
import { parseRgbColor, colorDistance, isWhiteOrNone, isBackgroundColor } from './colorMatch.js';

test('parseRgbColor parses rgb() strings', () => {
  assert.deepStrictEqual(parseRgbColor('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30 });
  assert.deepStrictEqual(parseRgbColor('RGB(255,0,0)'), { r: 255, g: 0, b: 0 });
});

test('parseRgbColor returns null for non-rgb strings', () => {
  assert.strictEqual(parseRgbColor('black'), null);
  assert.strictEqual(parseRgbColor('#ffffff'), null);
  assert.strictEqual(parseRgbColor(null), null);
});

test('colorDistance computes Euclidean RGB distance', () => {
  assert.strictEqual(colorDistance({ r: 0, g: 0, b: 0 }, { r: 3, g: 4, b: 0 }), 5);
});

test('isWhiteOrNone matches pure white and none, rejects near-white', () => {
  assert.strictEqual(isWhiteOrNone('white'), true);
  assert.strictEqual(isWhiteOrNone('#fff'), true);
  assert.strictEqual(isWhiteOrNone('#ffffff'), true);
  assert.strictEqual(isWhiteOrNone('rgb(255,255,255)'), true);
  assert.strictEqual(isWhiteOrNone('rgb(255, 255, 255)'), true);
  assert.strictEqual(isWhiteOrNone('none'), true);
  assert.strictEqual(isWhiteOrNone(null), true);
  assert.strictEqual(isWhiteOrNone('rgb(250,250,250)'), false);
  assert.strictEqual(isWhiteOrNone('rgb(0,0,0)'), false);
});

test('isBackgroundColor falls back to isWhiteOrNone with no backgroundColor', () => {
  assert.strictEqual(isBackgroundColor('rgb(255,255,255)', null), true);
  assert.strictEqual(isBackgroundColor('rgb(210,210,210)', null), false);
});

test('isBackgroundColor matches colors close to the sampled background', () => {
  const bg = { r: 210, g: 208, b: 205 };
  assert.strictEqual(isBackgroundColor('rgb(215,210,200)', bg), true);  // close -> background, skip
  assert.strictEqual(isBackgroundColor('rgb(20,20,20)', bg), false);    // far -> drawn
});
