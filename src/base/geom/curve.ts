import type { ArcGeom } from '@/base/geom/arc';
import type { CubicBezier2 } from '@/base/geom/bezier';
import type { Vec2 } from '@/base/math';

import { adaptiveSampleArc } from '@/base/geom/arc';
import { pointSegmentDistance, projectOnSegment2 } from '@/base/geom/segment2';
import { add2, distance2, dot2, scale2, sub2 } from '@/base/math';

export interface BezierFitInput {
  samples: Vec2[];
  start: Vec2;
  end: Vec2;
  startTangent: Vec2;
  endTangent: Vec2;
}

export interface HandleLengths { start: number; end: number }

function basis(t: number): { a: number; b: number; c: number; d: number } {
  const mt = 1 - t;
  return { a: mt * mt * mt, b: 3 * mt * mt * t, c: 3 * mt * t * t, d: t * t * t };
}

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

export function bezierFromFit(input: BezierFitInput, handles: HandleLengths): CubicBezier2 {
  return {
    p0: input.start,
    c0: add2(input.start, scale2(input.startTangent, handles.start)),
    c1: sub2(input.end, scale2(input.endTangent, handles.end)),
    p1: input.end,
  };
}

export function deviationFromArc(arc: ArcGeom, points: Vec2[]): number {
  return maxDistanceToPolyline(points, adaptiveSampleArc(arc, 0.001));
}

export function maxDistanceToPolyline(points: Vec2[], polyline: Vec2[]): number {
  let worst = 0;
  for (const p of points) worst = Math.max(worst, distanceToPolyline(p, polyline));
  return worst;
}

export function distanceToPolyline(p: Vec2, polyline: readonly Vec2[]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return distance2(p, polyline[0]);
  let best = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    best = Math.min(best, pointSegmentDistance(p, polyline[i - 1], polyline[i]));
  }

  return best;
}

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

export function polylineLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance2(points[i - 1], points[i]);
  return total;
}

export function cumulativePolylineLengths(points: readonly Vec2[]): number[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + distance2(points[i - 1], points[i]));
  }

  return lengths;
}

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

export function monotoneInterp(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (n === 1) return ys[0];
  if (xs[n - 1] < xs[0]) {
    return monotoneInterp([...xs].reverse(), [...ys].reverse(), x);
  }

  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  const m: number[] = [d[0]];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) { m.push(0); continue; }
    const w1 = 2 * (xs[k + 1] - xs[k]) + (xs[k] - xs[k - 1]);
    const w2 = (xs[k + 1] - xs[k]) + 2 * (xs[k] - xs[k - 1]);
    m.push((w1 * d[k - 1] + w2 * d[k]) / (w1 + w2));
  }

  m.push(d[n - 2]);
  let i = 1;
  while (i < n - 1 && xs[i] < x) i++;
  const h = xs[i] - xs[i - 1];
  const t = (x - xs[i - 1]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return ys[i - 1] * (2 * t3 - 3 * t2 + 1) + h * m[i - 1] * (t3 - 2 * t2 + t)
    + ys[i] * (-2 * t3 + 3 * t2) + h * m[i] * (t3 - t2);
}
