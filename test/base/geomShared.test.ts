import { describe, expect, it } from 'vitest';
import { pointInPolygon, pointSegmentDistance } from '@/base/geom';
import { vec2 } from '@/base/math';

const SQUARE = [vec2(0, 0), vec2(4, 0), vec2(4, 4), vec2(0, 4)];

describe('base/geom shared hit tests', () => {
  it('accepts interior points and rejects exterior ones', () => {
    expect(pointInPolygon(SQUARE, vec2(2, 2))).toBe(true);
    expect(pointInPolygon(SQUARE, vec2(5, 2))).toBe(false);
    expect(pointInPolygon([...SQUARE].reverse(), vec2(2, 2))).toBe(true);
    expect(pointInPolygon([], vec2(0, 0))).toBe(false);
  });

  it('measures the distance from a point to a segment', () => {
    const a = vec2(0, 0), b = vec2(10, 0);
    expect(pointSegmentDistance(vec2(5, 3), a, b)).toBeCloseTo(3);
    expect(pointSegmentDistance(vec2(-4, 0), a, b)).toBeCloseTo(4);
    expect(pointSegmentDistance(vec2(14, 0), a, b)).toBeCloseTo(4);
    expect(pointSegmentDistance(vec2(0, 0), vec2(0, 0), vec2(0, 0))).toBe(0);
  });
});
