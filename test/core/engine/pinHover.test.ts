import { describe, expect, it } from 'vitest';
import { ndcDistancePx, pinsByScreenDistance } from '@/runtime/pinHover';
import type { Vec3 } from '@/model/types';

/** Fixed projections for the candidate indices; missing indices cannot be projected. */
function projections(points: Record<number, Vec3>) {
  return (index: number) => points[index] ?? null;
}

describe('pinsByScreenDistance', () => {
  const width = 800;
  const height = 600;

  it('measures distance in pixels, not in NDC units', () => {
    const centre: Vec3 = { x: 0, y: 0, z: 0 };
    // 0.05 NDC on the x axis is 20 px on an 800 px wide viewport.
    expect(ndcDistancePx(0.05, 0, centre, width, height)).toBeCloseTo(20);
    expect(ndcDistancePx(0, 0.05, centre, width, height)).toBeCloseTo(15);
  });

  it('orders the pins under the pointer by increasing distance', () => {
    const project = projections({
      4: { x: 0.01, y: 0.0, z: 0 },
      9: { x: 0.03, y: 0.02, z: 0 },
    });
    // 2 px from pin 9, 8 px from pin 4.
    expect(pinsByScreenDistance([4, 9], project, 0.026, 0.016, width, height, 14)).toEqual([9, 4]);
  });

  it('drops pins outside the hover radius', () => {
    const project = projections({ 4: { x: 0.2, y: 0, z: 0 } });
    expect(pinsByScreenDistance([4], project, 0, 0, width, height, 14)).toEqual([]);
  });

  it('drops pins behind the camera and ones that cannot be projected', () => {
    const project = projections({ 1: { x: 0, y: 0, z: 2 }, 2: { x: 0, y: 0, z: 0 } });
    expect(pinsByScreenDistance([1, 7], project, 0, 0, width, height, 14)).toEqual([]);
    expect(pinsByScreenDistance([1, 2], project, 0, 0, width, height, 14)).toEqual([2]);
  });

  it('keeps only the requested number of nearest pins', () => {
    const project = projections({
      1: { x: 0, y: 0, z: 0 },
      2: { x: 0.01, y: 0, z: 0 },
      3: { x: 0.02, y: 0, z: 0 },
    });
    expect(pinsByScreenDistance([1, 2, 3], project, 0, 0, width, height, 14, 2)).toEqual([1, 2]);
  });

  it('has nothing to report for an empty pin set', () => {
    expect(pinsByScreenDistance([], () => ({ x: 0, y: 0, z: 0 }), 0, 0, width, height, 14)).toEqual([]);
  });
});
