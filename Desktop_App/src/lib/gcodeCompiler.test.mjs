// Desktop_App/src/lib/gcodeCompiler.test.mjs
//
// NOTE: gcodeCompiler.js uses DOMParser, which is a browser API and is NOT
// available in plain Node.js. These tests require a DOM environment such as
// jsdom or happy-dom to be polyfilled before running. They cannot be executed
// with `node --test` directly without a DOM polyfill.
//
// To run these tests, install jsdom and add a setup file that sets
// globalThis.DOMParser = new JSDOM().window.DOMParser (or equivalent),
// or run them inside a browser-based test runner (e.g. Vitest with jsdom env).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileSVGToGCode } from './gcodeCompiler.js';

const SETTINGS = { maxFeedrate: 1000, servoPenDown: 30, servoPenUp: 75, bedH: 200 };

describe('compileSVGToGCode — G2/G3 arc emission', () => {
  it('emits G2/G3 for a circle instead of G1 lines', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <circle cx="100" cy="100" r="50" fill="none" stroke="black" />
    </svg>`;
    const lines = compileSVGToGCode(svg, SETTINGS);
    const arcLines = lines.filter(l => /^G[23]\s/i.test(l));
    const g1Lines  = lines.filter(l => /^G1\s/i.test(l));
    assert.ok(arcLines.length >= 2, `Expected ≥2 arc lines, got ${arcLines.length}: ${arcLines.join(', ')}`);
    assert.equal(g1Lines.length, 0, `Expected 0 G1 lines for a circle, got ${g1Lines.length}`);
  });

  it('arc lines for a circle include I or J parameters', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <circle cx="100" cy="100" r="30" fill="none" stroke="black" />
    </svg>`;
    const lines = compileSVGToGCode(svg, SETTINGS);
    const arcLines = lines.filter(l => /^G[23]\s/i.test(l));
    for (const l of arcLines) {
      assert.ok(/I[-\d.]+/.test(l) || /J[-\d.]+/.test(l), `Arc line missing I/J: ${l}`);
    }
  });

  it('ellipse with rx≠ry still uses G1 tessellation', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <ellipse cx="100" cy="100" rx="60" ry="30" fill="none" stroke="black" />
    </svg>`;
    const lines = compileSVGToGCode(svg, SETTINGS);
    const arcLines = lines.filter(l => /^G[23]\s/i.test(l));
    assert.equal(arcLines.length, 0, 'Ellipse rx≠ry should not emit arcs');
  });

  it('straight-line path does not produce arc lines', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <path d="M 10 10 L 100 10 L 100 100" stroke="black" fill="none" />
    </svg>`;
    const lines = compileSVGToGCode(svg, SETTINGS);
    const arcLines = lines.filter(l => /^G[23]\s/i.test(l));
    assert.equal(arcLines.length, 0, 'Straight L path should not emit arcs');
  });

  it('compiled output always starts with G21 and G90 header', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <line x1="0" y1="0" x2="50" y2="50" stroke="black" />
    </svg>`;
    const lines = compileSVGToGCode(svg, SETTINGS);
    assert.ok(lines.some(l => l.startsWith('G21')));
    assert.ok(lines.some(l => l.startsWith('G90')));
  });
});
