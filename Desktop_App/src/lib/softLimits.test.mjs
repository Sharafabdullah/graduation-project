import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseXY,
  isInWarnZone,
  violatesSafeFloor,
  scanGCodeBounds,
  wouldExceedPositiveLimit,
  wouldCrossSafeFloor,
} from './softLimits.js';

const settings = { bedMaxX: 200, bedMaxY: 200, softLimitMargin: 10 };

test('parseXY extracts X and Y, leaving missing axes null', () => {
  assert.deepStrictEqual(parseXY('G1 X10 Y20 F1000'), { x: 10, y: 20 });
  assert.deepStrictEqual(parseXY('G1 X-5'), { x: -5, y: null });
  assert.deepStrictEqual(parseXY('G1 Y5'), { x: null, y: 5 });
  assert.strictEqual(parseXY('G1 F1000'), null);
});

test('isInWarnZone flags positions near any bed edge', () => {
  assert.strictEqual(isInWarnZone(5, 100, settings), true);   // near left edge
  assert.strictEqual(isInWarnZone(195, 100, settings), true); // near right edge
  assert.strictEqual(isInWarnZone(100, 5, settings), true);   // near bottom edge
  assert.strictEqual(isInWarnZone(100, 195, settings), true); // near top edge
  assert.strictEqual(isInWarnZone(100, 100, settings), false); // centre — safe
});

test('isInWarnZone does NOT exempt (0, 0) — it is the limit-switch position', () => {
  assert.strictEqual(isInWarnZone(0, 0, settings), true);
});

test('isInWarnZone only checks axes that are present', () => {
  assert.strictEqual(isInWarnZone(null, 100, settings), false);
  assert.strictEqual(isInWarnZone(5, null, settings), true);
});

test('violatesSafeFloor flags positions below the captured homing-backoff floor', () => {
  const floorX = 2, floorY = 2;
  assert.strictEqual(violatesSafeFloor(0, 0, floorX, floorY), true);
  assert.strictEqual(violatesSafeFloor(1, 50, floorX, floorY), true);
  assert.strictEqual(violatesSafeFloor(50, 1, floorX, floorY), true);
  assert.strictEqual(violatesSafeFloor(2, 2, floorX, floorY), false); // exactly at the floor — safe
  assert.strictEqual(violatesSafeFloor(50, 50, floorX, floorY), false);
});

test('violatesSafeFloor only checks axes that are present', () => {
  assert.strictEqual(violatesSafeFloor(null, 1, 2, 2), true);
  assert.strictEqual(violatesSafeFloor(50, null, 2, 2), false);
});

test('scanGCodeBounds reports violations including (0, 0)', () => {
  const lines = [
    'G21 ; mm units',
    'G0 X0 Y0',
    'G1 X100 Y100',
    'G1 X5 Y100',
  ];
  const violations = scanGCodeBounds(lines, settings);
  assert.strictEqual(violations.length, 2);
  assert.deepStrictEqual(violations[0], { lineIndex: 1, line: 'G0 X0 Y0', x: 0, y: 0 });
  assert.deepStrictEqual(violations[1], { lineIndex: 3, line: 'G1 X5 Y100', x: 5, y: 100 });
});

test('wouldExceedPositiveLimit blocks jogs that would cross the ceiling', () => {
  assert.strictEqual(wouldExceedPositiveLimit(185, 10, 'X', settings), true);
  assert.strictEqual(wouldExceedPositiveLimit(100, 10, 'X', settings), false);
  assert.strictEqual(wouldExceedPositiveLimit(185, 10, 'Y', settings), true);
});

test('wouldCrossSafeFloor blocks jogs that would cross the homed floor', () => {
  const floor = 2;
  assert.strictEqual(wouldCrossSafeFloor(3, 5, floor), true);   // 3 - 5 = -2 < 2
  assert.strictEqual(wouldCrossSafeFloor(10, 5, floor), false); // 10 - 5 = 5 >= 2
  assert.strictEqual(wouldCrossSafeFloor(2, 0.5, floor), true); // 2 - 0.5 = 1.5 < 2
});
