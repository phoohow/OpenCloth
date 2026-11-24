import { EPS } from '@/base/math/scalar';
import { add2, cross2, distance2, dot2, scale2, sub2, type Vec2 } from '@/base/math/vec2';

export interface SegmentProjection {
  point: Vec2;
  t: number;
}

export function projectOnLine2(p: Vec2, a: Vec2, b: Vec2): SegmentProjection {
  const ab = sub2(b, a);
  const lengthSquared = dot2(ab, ab);
  const t = lengthSquared > 0 ? dot2(sub2(p, a), ab) / lengthSquared : 0;
  return { point: add2(a, scale2(ab, t)), t };
}

export function projectOnSegment2(p: Vec2, a: Vec2, b: Vec2): SegmentProjection {
  const projection = projectOnLine2(p, a, b);
  if (projection.t >= 0 && projection.t <= 1) return projection;
  const t = projection.t < 0 ? 0 : 1;
  return { point: t === 0 ? a : b, t };
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  return distance2(p, projectOnSegment2(p, a, b).point);
}

export function pointOnSegment2(p: Vec2, a: Vec2, b: Vec2, tolerance = EPS): boolean {
  const ab = sub2(b, a);
  if (Math.abs(cross2(ab, sub2(p, a))) > tolerance) return false;
  return p.x >= Math.min(a.x, b.x) - tolerance && p.x <= Math.max(a.x, b.x) + tolerance
    && p.y >= Math.min(a.y, b.y) - tolerance && p.y <= Math.max(a.y, b.y) + tolerance;
}

export function segmentCrossing2(
  p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2, margin = EPS,
): Vec2 | null {
  const d1 = sub2(p2, p1);
  const d2 = sub2(q2, q1);
  const denominator = cross2(d1, d2);
  if (Math.abs(denominator) < 1e-12) return null;
  const offset = sub2(q1, p1);
  const t = cross2(offset, d2) / denominator;
  const s = cross2(offset, d1) / denominator;
  if (t <= margin || t >= 1 - margin || s <= margin || s >= 1 - margin) return null;
  return add2(p1, scale2(d1, t));
}

export function segmentsStrictlyCross2(
  p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2, tolerance = 0,
): boolean {
  const d1 = cross2(sub2(p2, p1), sub2(q1, p1));
  const d2 = cross2(sub2(p2, p1), sub2(q2, p1));
  const d3 = cross2(sub2(q2, q1), sub2(p1, q1));
  const d4 = cross2(sub2(q2, q1), sub2(p2, q1));
  const straddles = (a: number, b: number): boolean =>
    (a > tolerance && b < -tolerance) || (a < -tolerance && b > tolerance);
  return straddles(d1, d2) && straddles(d3, d4);
}

export function segmentsIntersect2(
  p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2, tolerance = EPS,
): boolean {
  const d1 = cross2(sub2(p2, p1), sub2(q1, p1));
  const d2 = cross2(sub2(p2, p1), sub2(q2, p1));
  const d3 = cross2(sub2(q2, q1), sub2(p1, q1));
  const d4 = cross2(sub2(q2, q1), sub2(p2, q1));
  const straddles = (a: number, b: number): boolean =>
    (a > tolerance && b < -tolerance) || (a < -tolerance && b > tolerance);
  if (straddles(d1, d2) && straddles(d3, d4)) return true;
  return pointOnSegment2(q1, p1, p2, tolerance) || pointOnSegment2(q2, p1, p2, tolerance)
    || pointOnSegment2(p1, q1, q2, tolerance) || pointOnSegment2(p2, q1, q2, tolerance);
}
