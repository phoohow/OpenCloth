import type { Pattern, PatternEdge, Vec2 } from '../../core/model/types';
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

// ============ Pattern-edge curve access ============

const mirrorAround = (pos: Vec2, h: Vec2): Vec2 => ({ x: 2 * pos.x - h.x, y: 2 * pos.y - h.y });

/**
 * Full cubic form of an edge from its point-level handles. A smooth point with one
 * missing handle mirrors the present one; a bezier edge without handles draws straight.
 */
export function edgeCurve(pattern: Pattern, edge: PatternEdge): CubicBezier2 | null {
  if (edge.type !== 'bezier') return null;
  const p0 = pattern.points[edge.startPointId]?.pos;
  const p1 = pattern.points[edge.endPointId]?.pos;
  if (!p0 || !p1) return null;
  const start = pattern.points[edge.startPointId]!;
  const end = pattern.points[edge.endPointId]!;
  let c0 = start.handleOut ?? null;
  let c1 = end.handleIn ?? null;
  if (!c0 && c1 && start.kind === 'smooth') c0 = mirrorAround(p0, c1);
  if (!c1 && c0 && end.kind === 'smooth') c1 = mirrorAround(p1, c0);
  if (!c0 || !c1) return null;
  return { p0, c0, c1, p1 };
}

/** Writes cubic control points onto the edge's endpoint handles and marks both smooth. */
export function setEdgeCurve(pattern: Pattern, edge: PatternEdge, c0: Vec2, c1: Vec2): void {
  edge.type = 'bezier';
  const start = pattern.points[edge.startPointId];
  const end = pattern.points[edge.endPointId];
  if (start) { start.kind = 'smooth'; start.handleOut = { ...c0 }; }
  if (end) { end.kind = 'smooth'; end.handleIn = { ...c1 }; }
}

/** Split result placed back into the model: handles on the three points, two bezier edges. */
export function splitEdgeCurve(
  pattern: Pattern,
  edge: PatternEdge,
  at: Vec2,
  makeEdge: (startId: string, endId: string) => PatternEdge,
): [PatternEdge, PatternEdge] {
  const curve = edgeCurve(pattern, edge)!;
  const [left, right] = splitBezier(curve, curveTForPoint(curve, at));
  const midId = Object.keys(pattern.points).find(id => near(pattern.points[id].pos, at))
    ?? (() => { throw new Error('split point missing'); })();
  const mid = pattern.points[midId]!;
  const start = pattern.points[edge.startPointId]!;
  const end = pattern.points[edge.endPointId]!;
  start.handleOut = { ...left.c0 }; start.kind = 'smooth';
  mid.handleIn = { ...left.c1 }; mid.handleOut = { ...right.c0 }; mid.kind = 'smooth';
  end.handleIn = { ...right.c1 }; end.kind = 'smooth';
  const e1 = makeEdge(edge.startPointId, midId);
  const e2 = makeEdge(midId, edge.endPointId);
  e1.type = 'bezier'; e2.type = 'bezier';
  e1.semantic = edge.semantic; e2.semantic = edge.semantic;
  return [e1, e2];
}

function near(a: Vec2, b: Vec2): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
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
