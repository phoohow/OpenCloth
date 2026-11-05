import type { Vec2 } from '@/common/geom/primitives';
import { lerp, distance } from '@/common/geom/primitives';

/** Cubic Bezier curve in 2D: endpoints plus two control points. */
export interface CubicBezier2 {
  p0: Vec2; c0: Vec2; c1: Vec2; p1: Vec2;
}

/** Evaluates the curve at parameter t. */
export function evalBezier(b: CubicBezier2, t: number): Vec2 {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const bc = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * b.p0.x + bc * b.c0.x + c * b.c1.x + d * b.p1.x,
    y: a * b.p0.y + bc * b.c0.y + c * b.c1.y + d * b.p1.y,
  };
}

/** Splits a cubic Bezier at parameter t with de Casteljau. */
export function splitBezier(b: CubicBezier2, t: number): [CubicBezier2, CubicBezier2] {
  const p01 = lerp(b.p0, b.c0, t);
  const p12 = lerp(b.c0, b.c1, t);
  const p23 = lerp(b.c1, b.p1, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const mid = lerp(p012, p123, t);
  return [
    { p0: b.p0, c0: p01, c1: p012, p1: mid },
    { p0: mid, c0: p123, c1: p23, p1: b.p1 },
  ];
}

/** Samples the curve adaptively: denser where curvature is high. */
export function adaptiveSampleBezier(b: CubicBezier2, tolerance = 0.1, maxDepth = 8): Vec2[] {
  const out: Vec2[] = [b.p0];
  subdivide(b, tolerance, out, 0, maxDepth);
  return out;
}

function subdivide(b: CubicBezier2, tol: number, out: Vec2[], depth: number, maxDepth: number): void {
  const mid = evalBezier(b, 0.5);
  const chord = lerp(b.p0, b.p1, 0.5);
  if (distance(mid, chord) < tol || depth >= maxDepth) {
    out.push(b.p1);
    return;
  }
  const [left, right] = splitBezier(b, 0.5);
  subdivide(left, tol, out, depth + 1, maxDepth);
  subdivide(right, tol, out, depth + 1, maxDepth);
}

/**
 * Cubic segments of a Catmull-Rom spline through `points`, one segment per neighbouring pair, so a
 * freehand stroke can be stored as bezier edges or previewed as a curve.
 */
export function smoothSplineSegments(points: readonly Vec2[], closed = false): CubicBezier2[] {
  const n = points.length;
  if (n < 2) return [];
  const at = (i: number): Vec2 => (closed ? points[(i + n) % n]! : points[Math.min(n - 1, Math.max(0, i))]!);
  // Uniform Catmull-Rom tangent: the chord across a point's neighbours, which the control points of
  // the two adjoining cubics split into thirds.
  const tangentAt = (i: number): Vec2 => {
    const prev = at(i - 1), next = at(i + 1);
    const scale = !closed && (i === 0 || i === n - 1) ? 1 : 0.5;
    return { x: (next.x - prev.x) * scale, y: (next.y - prev.y) * scale };
  };
  const segments: CubicBezier2[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = at(i), p1 = at(i + 1);
    const t0 = tangentAt(i), t1 = tangentAt(i + 1);
    segments.push({
      p0, p1,
      c0: { x: p0.x + t0.x / 3, y: p0.y + t0.y / 3 },
      c1: { x: p1.x - t1.x / 3, y: p1.y - t1.y / 3 },
    });
  }
  return segments;
}

/** Approximate curve parameter whose point is closest to `p` (32 samples). */
export function curveTForPoint(curve: CubicBezier2, p: Vec2): number {
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const d = distance(evalBezier(curve, t), p);
    if (d < bestD) { bestD = d; bestT = t; }
  }
  return bestT;
}
