import type { Vec2 } from '../../core/model/types';
import { lerp, distance } from './vec2';

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
