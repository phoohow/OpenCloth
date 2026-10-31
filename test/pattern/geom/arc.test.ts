import { describe, expect, it } from 'vitest';
import { vec2 } from '../../../src/core/model/types';
import { adaptiveSampleArc, arcFromThreePoints, arcSpan, evalArc } from '../../../src/pattern/geom/arc';

describe('arcFromThreePoints', () => {
  it('marks a counter-clockwise sweep when the middle point runs that way', () => {
    const arc = arcFromThreePoints(vec2(1, 0), vec2(0, 1), vec2(-1, 0))!;
    expect(arc.ccw).toBe(true);
    expect(arc.radius).toBeCloseTo(1, 6);
    expect(arcSpan(arc)).toBeCloseTo(Math.PI, 6);
  });

  it('marks a clockwise sweep when the middle point runs that way', () => {
    const arc = arcFromThreePoints(vec2(1, 0), vec2(0, -1), vec2(-1, 0))!;
    expect(arc.ccw).toBe(false);
    expect(arcSpan(arc)).toBeCloseTo(-Math.PI, 6);
  });

  it('returns null for collinear points', () => {
    expect(arcFromThreePoints(vec2(0, 0), vec2(1, 1), vec2(2, 2))).toBeNull();
  });
});

describe('evalArc', () => {
  it('passes through the middle point at the half parameter', () => {
    const arc = arcFromThreePoints(vec2(0, 2), vec2(2, 1), vec2(0, 0))!;
    const mid = evalArc(arc, 0.5);
    expect(mid.x).toBeCloseTo(2, 6);
    expect(mid.y).toBeCloseTo(1, 6);
  });

  it('keeps every sample on the circle', () => {
    const arc = arcFromThreePoints(vec2(1, 0), vec2(0, -1), vec2(-1, 0))!;
    for (const p of adaptiveSampleArc(arc, 0.001)) {
      expect(Math.hypot(p.x - arc.center.x, p.y - arc.center.y)).toBeCloseTo(arc.radius, 3);
    }
  });
});
