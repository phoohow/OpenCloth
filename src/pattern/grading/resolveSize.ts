import type { Pattern, Vec2 } from '@/model/types';
import { arcFromThreePoints, evalArc } from '@/common/geom/arc';

const ZERO: Vec2 = { x: 0, y: 0 };
const addV = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const subV = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const midV = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const deltaOf = (grading: Record<string, Vec2> | undefined, sizeId: string): Vec2 => grading?.[sizeId] ?? ZERO;

/**
 * Copy of the pattern with every point resolved to `toSizeId`, converted from `fromSizeId`.
 * Curve handles shift by the average of their two anchor points' deltas, and arc edges refit
 * through their shifted midpoint so both stay attached to the graded endpoints; ids stay stable.
 */
export function resolveSize(pattern: Pattern, fromSizeId: string | undefined, toSizeId: string): Pattern {
  const out = structuredClone(pattern);
  const pointDelta = (p: Pattern['points'][string]): Vec2 => subV(deltaOf(p.grading, toSizeId), p.grading?.[fromSizeId ?? ''] ?? ZERO);
  const outEdgeByStart = new Map<string, Pattern['edges'][string]>();
  const inEdgeByEnd = new Map<string, Pattern['edges'][string]>();
  for (const edge of Object.values(out.edges)) {
    if (!outEdgeByStart.has(edge.startPointId)) outEdgeByStart.set(edge.startPointId, edge);
    if (!inEdgeByEnd.has(edge.endPointId)) inEdgeByEnd.set(edge.endPointId, edge);
  }
  for (const id of Object.keys(out.points)) {
    const point = out.points[id];
    const d = pointDelta(point);
    const neighbour = (edgeId: string): Vec2 => pointDelta(out.points[edgeId] ?? { id: edgeId, pos: ZERO });
    point.pos = addV(point.pos, d);
    if (point.handleOut) {
      const edge = outEdgeByStart.get(id);
      point.handleOut = addV(point.handleOut, edge ? midV(d, neighbour(edge.endPointId)) : d);
    }
    if (point.handleIn) {
      const edge = inEdgeByEnd.get(id);
      point.handleIn = addV(point.handleIn, edge ? midV(d, neighbour(edge.startPointId)) : d);
    }
  }
  for (const edge of Object.values(out.edges)) {
    if (edge.type !== 'arc' || !edge.arc) continue;
    const start = out.points[edge.startPointId];
    const end = out.points[edge.endPointId];
    if (!start || !end) continue;
    const shift = midV(pointDelta(start), pointDelta(end));
    edge.arc = arcFromThreePoints(start.pos, addV(evalArc(edge.arc, 0.5), shift), end.pos)
      ?? { ...edge.arc, center: addV(edge.arc.center, shift) };
  }
  return out;
}
