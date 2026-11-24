import type { Pattern, Vec2 } from '@/model/types';

import { arcFromThreePoints, evalArc } from '@/base/geom/arc';
import { ZERO2, add2, midpoint2, sub2 } from '@/base/math';

const deltaOf = (grading: Record<string, Vec2> | undefined, sizeId: string): Vec2 =>
  grading?.[sizeId] ?? ZERO2;

export function resolveSize(pattern: Pattern, fromSizeId: string | undefined, toSizeId: string): Pattern {
  const out = structuredClone(pattern);
  const pointDelta = (p: Pattern['points'][string]): Vec2 => sub2(deltaOf(p.grading, toSizeId), p.grading?.[fromSizeId ?? ''] ?? ZERO2);
  const outEdgeByStart = new Map<string, Pattern['edges'][string]>();
  const inEdgeByEnd = new Map<string, Pattern['edges'][string]>();
  for (const edge of Object.values(out.edges)) {
    if (!outEdgeByStart.has(edge.startPointId)) outEdgeByStart.set(edge.startPointId, edge);
    if (!inEdgeByEnd.has(edge.endPointId)) inEdgeByEnd.set(edge.endPointId, edge);
  }

  for (const id of Object.keys(out.points)) {
    const point = out.points[id];
    const d = pointDelta(point);
    const neighbour = (edgeId: string): Vec2 => pointDelta(out.points[edgeId] ?? { id: edgeId, pos: ZERO2 });
    point.pos = add2(point.pos, d);
    if (point.handleOut) {
      const edge = outEdgeByStart.get(id);
      point.handleOut = add2(point.handleOut, edge ? midpoint2(d, neighbour(edge.endPointId)) : d);
    }

    if (point.handleIn) {
      const edge = inEdgeByEnd.get(id);
      point.handleIn = add2(point.handleIn, edge ? midpoint2(d, neighbour(edge.startPointId)) : d);
    }
  }

  for (const edge of Object.values(out.edges)) {
    if (edge.type !== 'arc' || !edge.arc) continue;
    const start = out.points[edge.startPointId];
    const end = out.points[edge.endPointId];
    if (!start || !end) continue;
    const shift = midpoint2(pointDelta(start), pointDelta(end));
    edge.arc = arcFromThreePoints(start.pos, add2(evalArc(edge.arc, 0.5), shift), end.pos)
      ?? { ...edge.arc, center: add2(edge.arc.center, shift) };
  }

  return out;
}
