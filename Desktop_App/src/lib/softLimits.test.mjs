// Desktop_App/src/lib/softLimits.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseXY, isInWarnZone, scanGCodeBounds } from './softLimits.js';

const SETTINGS = { bedMaxX: 200, bedMaxY: 200, softLimitMargin: 10 };

describe('parseXY', () => {
  it('parses X and Y', () => {
    const r = parseXY('G1 X50 Y75 F1000');
    assert.equal(r.x, 50);
    assert.equal(r.y, 75);
  });
  it('returns null when no X or Y', () => {
    assert.equal(parseXY('M3'), null);
  });
  it('parses only X', () => {
    const r = parseXY('G1 X50 F1000');
    assert.equal(r.x, 50);
    assert.equal(r.y, null);
  });
});

describe('isInWarnZone', () => {
  it('flags a point inside the left margin', () => {
    assert.ok(isInWarnZone(5, 100, SETTINGS));
  });
  it('flags a point inside the bottom margin', () => {
    assert.ok(isInWarnZone(100, 5, SETTINGS));
  });
  it('flags a point beyond the top margin', () => {
    assert.ok(isInWarnZone(100, 195, SETTINGS));
  });
  it('allows a point well inside the bed', () => {
    assert.ok(!isInWarnZone(100, 100, SETTINGS));
  });
});

describe('scanGCodeBounds — G1', () => {
  it('returns violation for G1 outside margin', () => {
    const lines = ['G1 X5 Y100 F1000'];
    const v = scanGCodeBounds(lines, SETTINGS);
    assert.equal(v.length, 1);
    assert.equal(v[0].lineIndex, 0);
  });
  it('no violation for safe G1', () => {
    const lines = ['G1 X100 Y100 F1000'];
    assert.equal(scanGCodeBounds(lines, SETTINGS).length, 0);
  });
  it('skips M-code lines', () => {
    const lines = ['M3', 'M5', 'G1 X100 Y100'];
    assert.equal(scanGCodeBounds(lines, SETTINGS).length, 0);
  });
});

describe('scanGCodeBounds — G2/G3 arc', () => {
  it('detects arc that swings below the Y margin', () => {
    const lines = [
      'G1 X50 Y50 F1000',
      'G2 X50 Y50 I45 J0 F1000',
    ];
    const v = scanGCodeBounds(lines, SETTINGS);
    assert.ok(v.length >= 1, `Expected violation for arc reaching y=5, got ${v.length}`);
  });

  it('does not flag arc safely inside the bed', () => {
    const lines = [
      'G1 X100 Y100 F1000',
      'G3 X110 Y110 I10 J0 F1000',
    ];
    const v = scanGCodeBounds(lines, SETTINGS);
    assert.equal(v.length, 0, `Expected no violation, got ${v.length}`);
  });

  it('tracks current position across lines for arc start', () => {
    const lines = [
      'G0 X50 Y50',
      'G2 X50 Y50 I45 J0 F1000',
    ];
    const v = scanGCodeBounds(lines, SETTINGS);
    assert.ok(v.length >= 1, 'Should detect the arc violation after G0 sets position');
  });
});
