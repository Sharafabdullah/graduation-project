import { test } from 'node:test';
import assert from 'node:assert';
import { tessellateQuadratic, tessellateCubic } from './bezier.js';

test('tessellateQuadratic returns `steps` points ending at the curve endpoint', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 5, y: 10 };
  const p2 = { x: 10, y: 0 };
  const points = tessellateQuadratic(p0, p1, p2, 4);
  assert.strictEqual(points.length, 4);
  assert.ok(Math.abs(points[points.length - 1].x - p2.x) < 1e-9);
  assert.ok(Math.abs(points[points.length - 1].y - p2.y) < 1e-9);
});

test('tessellateQuadratic midpoint sits on the curve, off the straight chord', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 5, y: 10 };
  const p2 = { x: 10, y: 0 };
  const points = tessellateQuadratic(p0, p1, p2, 2);
  // At t=0.5 a quadratic Bezier evaluates to 0.25*p0 + 0.5*p1 + 0.25*p2 = (5, 5)
  assert.ok(Math.abs(points[0].x - 5) < 1e-9);
  assert.ok(Math.abs(points[0].y - 5) < 1e-9);
  // The straight chord p0->p2 passes through y=0 at its midpoint; the curve bulges to y=5
  assert.notStrictEqual(points[0].y, 0);
});

test('tessellateCubic returns `steps` points ending at the curve endpoint', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 0, y: 10 };
  const p2 = { x: 10, y: 10 };
  const p3 = { x: 10, y: 0 };
  const points = tessellateCubic(p0, p1, p2, p3, 6);
  assert.strictEqual(points.length, 6);
  assert.ok(Math.abs(points[points.length - 1].x - p3.x) < 1e-9);
  assert.ok(Math.abs(points[points.length - 1].y - p3.y) < 1e-9);
});

test('tessellateCubic produces points that bulge off the straight chord', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 0, y: 10 };
  const p2 = { x: 10, y: 10 };
  const p3 = { x: 10, y: 0 };
  const points = tessellateCubic(p0, p1, p2, p3, 2);
  // The straight chord p0->p3 stays at y=0; this S-curve bulges upward at its midpoint
  assert.ok(points[0].y > 0);
});
