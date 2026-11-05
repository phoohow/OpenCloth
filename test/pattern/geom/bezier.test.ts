import { describe, expect, it } from 'vitest';
import { vec2 } from '@/model/types';
import { evalBezier, smoothSplineSegments } from '@/pattern/geom/bezier';

/** The four corners of a 10 × 10 square, clockwise from the lower-left. */
const square = [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)];

describe('smoothSplineSegments', () => {
  it('runs one cubic per point pair and passes through every point', () => {
    const closed = smoothSplineSegments(square, true);
    const open = smoothSplineSegments(square);

    expect(closed).toHaveLength(4);
    expect(open).toHaveLength(3);
    closed.forEach((segment, i) => {
      expect(segment.p0).toEqual(square[i]);
      expect(segment.p1).toEqual(square[(i + 1) % 4]);
    });
    // The closing segment returns to the first corner.
    expect(closed[3]!.p1).toEqual(square[0]);
  });

  it('keeps a shared point tangent-continuous', () => {
    const segments = smoothSplineSegments(square, true);
    // Handles on both sides of a point are mirror images, which is what makes the join smooth.
    segments.forEach((segment, i) => {
      const joint = segment.p1;
      const next = segments[(i + 1) % segments.length]!;
      expect(next.p0).toEqual(joint);
      expect(segment.c1.x + next.c0.x).toBeCloseTo(2 * joint.x, 9);
      expect(segment.c1.y + next.c0.y).toBeCloseTo(2 * joint.y, 9);
    });
  });

  it('leaves the straight chord between two corners', () => {
    const [segment] = smoothSplineSegments([vec2(0, 0), vec2(10, 0), vec2(10, 10)], true);
    // Both controls sit off the chord, so the curve bows away from the straight line joining them.
    expect(Math.abs(segment!.c0.y)).toBeGreaterThan(1);
    expect(Math.abs(segment!.c1.y)).toBeGreaterThan(1);
    expect(Math.abs(evalBezier(segment!, 0.5).y)).toBeGreaterThan(0.5);
  });

  it('returns nothing for a stroke shorter than two points', () => {
    expect(smoothSplineSegments([vec2(1, 1)])).toEqual([]);
    expect(smoothSplineSegments([])).toEqual([]);
  });
});
