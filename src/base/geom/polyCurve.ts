import type { ArcGeom } from '@/base/geom/arc';
import type { Vec2 } from '@/base/math';
import { add2, distance2, dot2, scale2, sub2 } from '@/base/math';
import { pointSegmentDistance, projectOnSegment2 } from '@/base/geom/segment2';
import { adaptiveSampleArc } from '@/base/geom/arc';
import type { CubicBezier2 } from '@/base/geom/bezier';

/** One cubic fit of a polyline span, in the shape a bezier pattern edge stores. */
export interface BezierFitInput {
  /** Dense samples the fit follows, including both endpoints. */
  samples: Vec2[];
  /** Fixed span endpoints. */
  start: Vec2;
  end: Vec2;
  /** Unit travel directions at the span endpoints. */
  startTangent: Vec2;
  endTangent: Vec2;
}

/** Interior control points of a cubic whose endpoints and end tangents are fixed. */
export interface HandleLengths { start: number; end: number }

/** Chord-parameterized cubic basis weights at t. */
function basis(t: number): { a: number; b: number; c: number; d: number } {
  const mt = 1 - t;
  return { a: mt * mt * mt, b: 3 * mt * mt * t, c: 3 * mt * t * t, d: t * t * t };
}

/**
 * Least-squares cubic fit with the endpoints and the endpoint travel directions fixed:
 * only the two handle lengths are solved, so the span keeps its join tangency.
 */
export function fitBezierHandles(input: BezierFitInput): HandleLengths {
  const { samples, start, end, startTangent, endTangent } = input;
  if (samples.length < 2) return { start: 0, end: 0 };
  const total = samples.reduce((acc, p, i) => (i === 0 ? 0 : acc + distance2(samples[i - 1], p)), 0) || 1;
  let acc = 0;
  let bb = 0;
  let bc = 0;
  let cc = 0;
  let br0 = 0;
  let br1 = 0;
  const tangentDot = dot2(startTangent, endTangent);
  for (let i = 0; i < samples.length; i++) {
    if (i > 0) acc += distance2(samples[i - 1], samples[i]);
    const t = i === 0 ? 0 : i === samples.length - 1 ? 1 : acc / total;
    const w = basis(t);
    const residual = sub2(samples[i], add2(
      scale2(start, w.a + w.b),
      scale2(end, w.c + w.d),
    ));
    bb += w.b * w.b;
    bc += w.b * w.c * tangentDot;
    cc += w.c * w.c;
    br0 += w.b * dot2(residual, startTangent);
    br1 += w.c * dot2(residual, endTangent);
  }
  const det = bb * cc - bc * bc;
  const chord = distance2(start, end) || 1;
  if (Math.abs(det) < 1e-12) return { start: chord / 3, end: chord / 3 };
  const clamp = (v: number): number => Math.min(chord * 4, Math.max(0, v));
  return { start: clamp((cc * br0 - bc * br1) / det), end: clamp((bc * br0 - bb * br1) / det) };
}

/** Cubic curve through the span endpoints with the fitted handle lengths. */
export function bezierFromFit(input: BezierFitInput, handles: HandleLengths): CubicBezier2 {
  return {
    p0: input.start,
    c0: add2(input.start, scale2(input.startTangent, handles.start)),
    c1: sub2(input.end, scale2(input.endTangent, handles.end)),
    p1: input.end,
  };
}

/** Greatest distance from any of `points` to the arc. */
export function deviationFromArc(arc: ArcGeom, points: Vec2[]): number {
  return maxDistanceToPolyline(points, adaptiveSampleArc(arc, 0.001));
}

/** Greatest distance from `points` to any segment of the sampled polyline. */
export function maxDistanceToPolyline(points: Vec2[], polyline: Vec2[]): number {
  let worst = 0;
  for (const p of points) worst = Math.max(worst, distanceToPolyline(p, polyline));
  return worst;
}

/** Distance from a point to the nearest segment of a polyline. */
export function distanceToPolyline(p: Vec2, polyline: readonly Vec2[]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return distance2(p, polyline[0]);
  let best = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    best = Math.min(best, pointSegmentDistance(p, polyline[i - 1], polyline[i]));
  }
  return best;
}

/** Point on a polyline nearest to `p`, or null when the polyline is empty. */
export function nearestOnPolyline(p: Vec2, polyline: readonly Vec2[]): Vec2 | null {
  if (polyline.length === 0) return null;
  if (polyline.length === 1) return polyline[0];
  let best: Vec2 | null = null;
  let bestDistance = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const projection = projectOnSegment2(p, polyline[i - 1], polyline[i]);
    const distance = distance2(p, projection.point);
    if (distance < bestDistance) { bestDistance = distance; best = projection.point; }
  }
  return best;
}

/** Total chord length of a polyline. */
export function polylineLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance2(points[i - 1], points[i]);
  return total;
}

/** Cumulative chord length at each point of a polyline. */
export function cumulativePolylineLengths(points: readonly Vec2[]): number[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + distance2(points[i - 1], points[i]));
  }
  return lengths;
}

/** Point at half the polyline's arc length, interpolated inside the segment holding that half. */
export function polylineMidpoint(points: readonly Vec2[]): Vec2 | null {
  const lengths = cumulativePolylineLengths(points);
  const total = lengths[lengths.length - 1] ?? 0;
  if (points.length < 2 || !(total > 1e-9)) return null;
  const half = total / 2;
  for (let i = 1; i < lengths.length; i++) {
    if (lengths[i] < half) continue;
    const segment = lengths[i] - lengths[i - 1];
    const t = segment > 0 ? (half - lengths[i - 1]) / segment : 0;
    return {
      x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
      y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
    };
  }
  return points[points.length - 1];
}
