import type { Pattern, PatternEdge, Vec2 } from '@/model/types';
import type { CubicBezier2 } from '@/common/geom/bezier';
import { splitBezier, curveTForPoint } from '@/common/geom/bezier';

export * from '@/common/geom/bezier';

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
