import { describe, expect, it } from 'vitest';
import { bodyOccludesSegment } from '../../../src/core/engine/bodyOcclusion';

/** Signed distance to a unit sphere at the origin. */
const unitSphere = (x: number, y: number, z: number) => Math.hypot(x, y, z) - 1;

/** Camera five meters up +Z, looking down -Z. */
const camera = { x: 0, y: 0, z: 5 };
const forward = { x: 0, y: 0, z: -1 };

describe('bodyOccludesSegment', () => {
  it('reports no occlusion when the cloth sits in front of the body', () => {
    // Cloth at z = +1, right on the near surface.
    expect(bodyOccludesSegment(unitSphere, camera, forward, 4)).toBe(false);
  });

  it('reports occlusion when the cloth is behind the body', () => {
    // Cloth at z = -1: the ray passes through the whole body first.
    expect(bodyOccludesSegment(unitSphere, camera, forward, 6)).toBe(true);
  });

  it('ignores the body when the ray passes beside it', () => {
    const sideways = { x: 0, y: 0, z: -1 };
    expect(bodyOccludesSegment(unitSphere, { x: 4, y: 0, z: 5 }, sideways, 6)).toBe(false);
  });

  it('stops short of the cloth so cloth resting on the skin still counts as visible', () => {
    // Cloth at z = 0.995, just outside the surface; the walk ends before touching it.
    expect(bodyOccludesSegment(unitSphere, camera, forward, 4.005)).toBe(false);
  });

  it('finds a limb thinner than the distance between two samples', () => {
    // 2 cm slab at z = 1, cloth at z = 0.5: a uniform walk of 12 samples steps over it.
    const slab = (_x: number, _y: number, z: number) => Math.abs(z - 1) - 0.01;
    expect(bodyOccludesSegment(slab, camera, forward, 4.5)).toBe(true);
  });
});
