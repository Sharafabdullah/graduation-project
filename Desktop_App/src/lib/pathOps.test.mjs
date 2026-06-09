// Desktop_App/src/lib/pathOps.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, formatPath, simplifyPath, smoothPath, applyMatrixToPath, fitPathsToBed } from './pathOps.js';

describe('parsePath', () => {
  it('parses a simple M L Z', () => {
    const cmds = parsePath('M 0 0 L 10 0 L 10 10 Z');
    assert.equal(cmds.length, 4);
    assert.equal(cmds[0].code, 'M');
    assert.equal(cmds[1].code, 'L');
    assert.equal(cmds[3].code, 'Z');
  });
  it('returns [] for empty string', () => {
    assert.deepEqual(parsePath(''), []);
  });
});

describe('formatPath', () => {
  it('round-trips M L Z', () => {
    const original = 'M 0.000 0.000 L 10.000 0.000 Z';
    const cmds = parsePath(original);
    assert.equal(formatPath(cmds), original);
  });
});

describe('simplifyPath', () => {
  it('reduces collinear points on a horizontal line', () => {
    const pts = Array.from({ length: 10 }, (_, i) => `L ${i * 10} 0`).join(' ');
    const d = `M 0 0 ${pts}`;
    const simplified = simplifyPath(d, 1);
    const cmds = parsePath(simplified);
    assert.ok(cmds.length < 10, `Expected fewer than 10 cmds, got ${cmds.length}`);
  });

  it('preserves a path with only 2 points', () => {
    const d = 'M 0.000 0.000 L 10.000 10.000';
    assert.equal(simplifyPath(d, 1), d);
  });

  it('returns unchanged path for empty string', () => {
    assert.equal(simplifyPath(''), '');
  });
});

describe('smoothPath', () => {
  it('converts L-only path to C commands', () => {
    const d = 'M 0.000 0.000 L 10.000 5.000 L 20.000 0.000 L 30.000 5.000';
    const smoothed = smoothPath(d);
    assert.ok(smoothed.includes('C'), 'Expected C commands after smoothing');
  });

  it('does not modify path that already has C commands', () => {
    const d = 'M 0.000 0.000 C 5.000 5.000 15.000 5.000 20.000 0.000';
    assert.equal(smoothPath(d), d);
  });

  it('does not modify short paths', () => {
    const d = 'M 0.000 0.000 L 10.000 10.000';
    assert.equal(smoothPath(d), d);
  });
});

describe('applyMatrixToPath', () => {
  it('scales path coordinates by a scale matrix', () => {
    const d = 'M 0.000 0.000 L 10.000 0.000';
    const scale2 = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const result = applyMatrixToPath(d, scale2);
    assert.ok(result.includes('20.000'), `Expected scaled coords in: ${result}`);
  });

  it('translates path coordinates', () => {
    const d = 'M 0.000 0.000 L 10.000 0.000';
    const translate = { a: 1, b: 0, c: 0, d: 1, e: 5, f: 10 };
    const result = applyMatrixToPath(d, translate);
    assert.ok(result.includes('M 5.000 10.000'), `Expected translated M: ${result}`);
  });
});

describe('fitPathsToBed', () => {
  it('scales paths to fit bed at 90%', () => {
    // svgW=100, svgH=100, bedW=200, bedH=200
    // scale = min(200*0.9/100, 200*0.9/100) = 1.8
    // tx = (200 - 100*1.8)/2 = 10, ty = 10
    // L 100 0 → L 100*1.8+10 = 190
    const paths = [{ id: 'a', d: 'M 0.000 0.000 L 100.000 0.000', color: '#000', fill: 'none' }];
    const fitted = fitPathsToBed(paths, 100, 100, 200, 200);
    const cmds = parsePath(fitted[0].d);
    const lCmd = cmds.find(c => c.code === 'L');
    assert.ok(Math.abs(lCmd.x - 190) < 0.1, `Expected x≈190 after scale+center, got ${lCmd.x}`);
  });
});
