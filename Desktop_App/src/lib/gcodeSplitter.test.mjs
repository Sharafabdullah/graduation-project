import { test } from 'node:test';
import assert from 'node:assert';
import { parseToolpathSegments, computeDrawingBounds } from './gcodeSplitter.js';

test('parseToolpathSegments tracks position and pen state across G0/G1/M3/M5', () => {
  const lines = [
    'G21 ; mm units',
    'G0 X10.000 Y10.000',
    'M3 ; tool on',
    'G1 X20.000 Y10.000 F1000',
    'G1 X20.000 Y20.000 F1000',
    'M5 ; tool off',
    'G0 X0.000 Y0.000',
  ];
  const segs = parseToolpathSegments(lines);

  // G21 carries no X/Y — it's not a motion command and produces no segment.
  assert.strictEqual(segs.length, 4);
  assert.deepStrictEqual(segs[0], { from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, drawing: false, feedRate: 0 });
  assert.deepStrictEqual(segs[1], { from: { x: 10, y: 10 }, to: { x: 20, y: 10 }, drawing: true, feedRate: 1000 });
  assert.deepStrictEqual(segs[2], { from: { x: 20, y: 10 }, to: { x: 20, y: 20 }, drawing: true, feedRate: 1000 });
  assert.strictEqual(segs[3].drawing, false); // after M5, the trailing G0 is a rapid
});

test('computeDrawingBounds only considers pen-down (G1, drawing) segments', () => {
  const lines = [
    'G0 X50.000 Y50.000',                // rapid — must not affect bounds
    'M3 ; tool on',
    'G1 X10.000 Y10.000 F1000',
    'G1 X30.000 Y40.000 F1000',
    'M5 ; tool off',
    'G0 X0.000 Y0.000 ; return home',    // rapid to origin — must not pull bounds to (0,0)
  ];
  const bounds = computeDrawingBounds(parseToolpathSegments(lines));
  assert.deepStrictEqual(bounds, { minX: 10, minY: 10, maxX: 50, maxY: 50 });
});

test('computeDrawingBounds returns null when there are no drawing moves', () => {
  const segs = parseToolpathSegments(['G0 X10.000 Y10.000', 'G0 X0.000 Y0.000']);
  assert.strictEqual(computeDrawingBounds(segs), null);
});
