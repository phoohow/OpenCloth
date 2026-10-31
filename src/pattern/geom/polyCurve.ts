import type { ArcGeom, Vec2 } from '../../core/model/types';
import { add, distance, dot, scale, sub } from './vec2';
import { adaptiveSampleArc } from './arc';
import type { CubicBezier2 } from './bezier';

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
  const total = samples.reduce((acc, p, i) => (i === 0 ? 0 : acc + distance(samples[i - 1], p)), 0) || 1;
  let acc = 0;
  let bb = 0;
  let bc = 0;
  let cc = 0;
  let br0 = 0;
  let br1 = 0;
  const tangentDot = dot(startTangent, endTangent);
  for (let i = 0; i < samples.length; i++) {
    if (i > 0) acc += distance(samples[i - 1], samples[i]);
    const t = i === 0 ? 0 : i === samples.length - 1 ? 1 : acc / total;
    const w = basis(t);
    const residual = sub(samples[i], add(
      scale(start, w.a + w.b),
      scale(end, w.c + w.d),
    ));
    bb += w.b * w.b;
    bc += w.b * w.c * tangentDot;
    cc += w.c * w.c;
    br0 += w.b * dot(residual, startTangent);
    br1 += w.c * dot(residual, endTangent);
  }
  const det = bb * cc - bc * bc;
  const chord = distance(start, end) || 1;
  if (Math.abs(det) < 1e-12) return { start: chord / 3, end: chord / 3 };
  const clamp = (v: number): number => Math.min(chord * 4, Math.max(0, v));
  return { start: clamp((cc * br0 - bc * br1) / det), end: clamp((bc * br0 - bb * br1) / det) };
}

/** Cubic curve through the span endpoints with the fitted handle lengths. */
export function bezierFromFit(input: BezierFitInput, handles: HandleLengths): CubicBezier2 {
  return {
    p0: input.start,
    c0: add(input.start, scale(input.startTangent, handles.start)),
    c1: sub(input.end, scale(input.endTangent, handles.end)),
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
export function distanceToPolyline(p: Vec2, polyline: Vec2[]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return distance(p, polyline[0]);
  let best = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1], b = polyline[i];
    const lenSq = distance(a, b) ** 2;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), sub(b, a)) / lenSq));
    best = Math.min(best, distance(p, add(a, scale(sub(b, a), t))));
  }
  return best;
}
