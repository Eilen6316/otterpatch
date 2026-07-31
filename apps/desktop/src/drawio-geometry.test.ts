import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  avoidRoute,
  bandRect,
  controlPoints,
  edgePts,
  intersects,
  ortho,
  resizeNode,
  roundedPath,
  smoothPath,
  snap,
  straightRoute,
  type BNode,
} from './drawio-geometry.js';

const node = (id: string, x: number, y: number, w = 60, h = 40): BNode => ({
  id,
  x,
  y,
  w,
  h,
  inner: '',
  label: id,
});

test('drawio routes connect node perimeters and preserve explicit waypoints', () => {
  const left = node('left', 0, 0);
  const right = node('right', 200, 0);

  assert.deepEqual(straightRoute(left, right), [{ x: 60, y: 20 }, { x: 200, y: 20 }]);
  assert.deepEqual(ortho(left, right), [{ x: 60, y: 20 }, { x: 200, y: 20 }]);

  const waypoint = { x: 120, y: -60 };
  const routed = edgePts(left, right, 'ortho', [waypoint]);
  assert.equal(routed.length, 5);
  assert.deepEqual(routed[1], { x: 120, y: 0 });
  assert.deepEqual(routed[2], waypoint);
  assert.deepEqual(controlPoints(left, right, [waypoint])[1], waypoint);
});

test('drawio obstacle routing detours around ordinary nodes', () => {
  const left = node('left', 0, 0);
  const right = node('right', 200, 0);
  const blocker = node('blocker', 100, 0);

  const direct = avoidRoute(left, right, { id: 'edge', style: 'ortho' }, [left, right]);
  const detour = avoidRoute(left, right, { id: 'edge', style: 'ortho' }, [left, blocker, right]);

  assert.equal(direct.length, 2);
  assert.ok(detour.length > direct.length);
  assert.ok(detour.some((point) => point.y < blocker.y));
});

test('drawio geometry keeps paths, snapping, selection, and resize deterministic', () => {
  assert.equal(snap(24), 20);
  assert.equal(snap(25), 30);
  assert.match(smoothPath([{ x: 0, y: 0 }, { x: 100, y: 0 }]), /^M 0 0 Q /);
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }]), 'M 0 0 L 12 0 Q 20 0 20 8 L 20 20');

  const box = node('box', 0, 0, 100, 50);
  assert.deepEqual(resizeNode({ box, k: 'se', sx: 100, sy: 50 }, 140, 70, true), { ...box, w: 140, h: 70 });
  assert.deepEqual(bandRect({ x0: 30, y0: 40, x1: 10, y1: 5 }), { x: 10, y: 5, w: 20, h: 35 });
  assert.equal(intersects({ x: 50, y: 10, w: 30, h: 30 }, box), true);
  assert.equal(intersects({ x: 120, y: 10, w: 20, h: 20 }, box), false);
});
