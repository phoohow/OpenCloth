import type { Vec2 } from '@/base/math';

import { lerp2, distance2 } from '@/base/math';

export interface CubicBezier2 {
  p0: Vec2; c0: Vec2; c1: Vec2; p1: Vec2;
}

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

export function splitBezier(b: CubicBezier2, t: number): [CubicBezier2, CubicBezier2] {
  const p01 = lerp2(b.p0, b.c0, t);
  const p12 = lerp2(b.c0, b.c1, t);
  const p23 = lerp2(b.c1, b.p1, t);
  const p012 = lerp2(p01, p12, t);
  const p123 = lerp2(p12, p23, t);
  const mid = lerp2(p012, p123, t);
  return [
    { p0: b.p0, c0: p01, c1: p012, p1: mid },
    { p0: mid, c0: p123, c1: p23, p1: b.p1 },
  ];
}

export function adaptiveSampleBezier(b: CubicBezier2, tolerance = 0.1, maxDepth = 8): Vec2[] {
  const out: Vec2[] = [b.p0];
  subdivide(b, tolerance, out, 0, maxDepth);
  return out;
}

function subdivide(b: CubicBezier2, tol: number, out: Vec2[], depth: number, maxDepth: number): void {
  const mid = evalBezier(b, 0.5);
  const chord = lerp2(b.p0, b.p1, 0.5);
  if (distance2(mid, chord) < tol || depth >= maxDepth) {
    out.push(b.p1);
    return;
  }

  const [left, right] = splitBezier(b, 0.5);
  subdivide(left, tol, out, depth + 1, maxDepth);
  subdivide(right, tol, out, depth + 1, maxDepth);
}

export function smoothSplineSegments(points: readonly Vec2[], closed = false): CubicBezier2[] {
  const n = points.length;
  if (n < 2) return [];
  const at = (i: number): Vec2 => (closed ? points[(i + n) % n]! : points[Math.min(n - 1, Math.max(0, i))]!);
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

export function curveTForPoint(curve: CubicBezier2, p: Vec2, samples = 32): number {
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const d = distance2(evalBezier(curve, t), p);
    if (d < bestD) { bestD = d; bestT = t; }
  }

  return bestT;
}
