import type { Pattern, Vec2 } from '../../core/model/types';
import { sampleEdge, sampleEdgeInterval } from '../../pattern/panel/panelBuilder';
import { pointAtT } from '../../pattern/geom/edgeSample';
import { elementNodeId, type PatternElementKind } from '../../core/model/elementRef';

/** Axis-aligned bounds in world centimeters. */
export interface Rect { min: Vec2; max: Vec2 }

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(poly: Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Pattern point addressed by id during hit-testing. */
export interface NamedPoint { id: string; pos: Vec2 }

/** Id of the nearest point within radius; null when none qualifies. */
export function nearestPointWithinRadius(
  points: readonly NamedPoint[], target: Vec2, radius: number,
): string | null {
  let bestId: string | null = null;
  let bestDist = radius;
  for (const pt of points) {
    const d = Math.hypot(pt.pos.x - target.x, pt.pos.y - target.y);
    if (d <= bestDist) {
      bestDist = d;
      bestId = pt.id;
    }
  }
  return bestId;
}

/** Closest point on segment a-b to p, with its clamped parameter. */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { point: { x: a.x + dx * t, y: a.y + dy * t }, t };
}

/** Edge under the cursor, with the projected position on it. */
export interface EdgeHit {
  edgeId: string;
  /** Projected position on the edge polyline. */
  point: Vec2;
  /** Approximate parameter along the full edge, 0..1. */
  t: number;
  distance: number;
}

/** Nearest hit among the sampled polylines of the given edges, within radius. */
export function nearestEdgeSegment(
  pattern: Pattern, edgeIds: readonly string[], target: Vec2, radius: number,
): EdgeHit | null {
  let best: EdgeHit | null = null;
  for (const edgeId of edgeIds) {
    const pts = sampleEdge(pattern, edgeId);
    const segCount = pts.length - 1;
    if (segCount < 1) continue;
    for (let i = 0; i < segCount; i++) {
      const { point, t } = projectOnSegment(target, pts[i], pts[i + 1]);
      const distance = Math.hypot(target.x - point.x, target.y - point.y);
      if (distance > radius || (best && best.distance <= distance)) continue;
      best = { edgeId, point, t: (i + t) / segCount, distance };
    }
  }
  return best;
}

/** Panel whose outline or hole loop contains the edge. */
export function panelIdOfEdge(pattern: Pattern, edgeId: string): string | null {
  for (const panel of Object.values(pattern.panels)) {
    if (panel.outlineEdgeIds.includes(edgeId)) return panel.id;
    if ((panel.holes ?? []).some(loop => loop.includes(edgeId))) return panel.id;
  }
  return null;
}

/** Visible panel under a world point: its outline first, then one of its edges. */
export function visiblePanelUnderPoint(
  pattern: Pattern, outlines: ReadonlyMap<string, Vec2[]>, target: Vec2, radius: number,
): string | null {
  for (const [panelId, polygon] of outlines) {
    if (!pattern.panels[panelId]?.visible) continue;
    if (pointInPolygon(polygon, target)) return panelId;
  }
  const hit = nearestEdgeSegment(pattern, Object.keys(pattern.edges), target, radius);
  if (!hit) return null;
  const ownerId = panelIdOfEdge(pattern, hit.edgeId);
  return ownerId && pattern.panels[ownerId]?.visible ? ownerId : null;
}

/** Panels whose outline edges reference the point. */
export function panelsOfPoint(pattern: Pattern, pointId: string): string[] {
  const result: string[] = [];
  for (const panel of Object.values(pattern.panels)) {
    for (const edgeId of panel.outlineEdgeIds) {
      const edge = pattern.edges[edgeId];
      if (edge && (edge.startPointId === pointId || edge.endPointId === pointId)) {
        result.push(panel.id);
        break;
      }
    }
  }
  return result;
}

/** Whether the points' bounding box overlaps the rect. */
export function rectIntersectsBBox(rect: Rect, points: readonly Vec2[]): boolean {
  if (points.length === 0) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return maxX >= rect.min.x && minX <= rect.max.x && maxY >= rect.min.y && minY <= rect.max.y;
}

/** Element rows of the given kinds whose geometry the marquee rect covers. Panels stay plain scene ids. */
export function elementsInRect(
  pattern: Pattern, rect: Rect, kinds: readonly PatternElementKind[],
): string[] {
  const rows: string[] = [];
  for (const kind of kinds) {
    for (const element of elementGeometry(pattern, kind)) {
      if (element.points.some(p => p.x >= rect.min.x && p.x <= rect.max.x && p.y >= rect.min.y && p.y <= rect.max.y)) {
        rows.push(kind === 'panel' ? element.id : elementNodeId(kind, element.id));
      }
    }
  }
  return rows;
}

/** Nearest element of the given kinds within radius, as a selection row. */
export function pickElements(
  pattern: Pattern, target: Vec2, radius: number, kinds: readonly PatternElementKind[],
): string | null {
  let best: { row: string; distance: number } | null = null;
  for (const kind of kinds) {
    for (const element of elementGeometry(pattern, kind)) {
      const distance = distanceToPolyline(element.points, target);
      if (distance > radius || (best && best.distance <= distance)) continue;
      best = { row: elementNodeId(kind, element.id), distance };
    }
  }
  return best?.row ?? null;
}

/** Shortest distance from a point to a polyline; a single point measures to itself. */
function distanceToPolyline(points: readonly Vec2[], target: Vec2): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(target.x - points[0].x, target.y - points[0].y);
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const hit = projectOnSegment(target, points[i], points[i + 1]).point;
    best = Math.min(best, Math.hypot(target.x - hit.x, target.y - hit.y));
  }
  return best;
}

/**
 * Sampled polylines of every element of one kind, in object-id order. Panels list their outline
 * corners; the marquee rule and the pick rule both read this, so they stay in step.
 */
function elementGeometry(pattern: Pattern, kind: PatternElementKind): Array<{ id: string; points: Vec2[] }> {
  switch (kind) {
    case 'panel':
      return Object.values(pattern.panels).map(panel => ({
        id: panel.id,
        points: panel.outlineEdgeIds
          .map(edgeId => pattern.edges[edgeId] && pattern.points[pattern.edges[edgeId]!.startPointId])
          .filter((p): p is NonNullable<typeof p> => !!p)
          .map(p => p.pos),
      }));
    case 'point':
      return Object.values(pattern.points).map(point => ({ id: point.id, points: [point.pos] }));
    case 'edge':
      return Object.values(pattern.edges).map(edge => ({ id: edge.id, points: sampleEdge(pattern, edge.id) }));
    case 'internal':
      return Object.values(pattern.internalLines ?? {}).map(line => ({ id: line.id, points: line.points }));
    case 'dart':
      return Object.values(pattern.darts).map(dart => ({
        id: dart.id,
        points: [pattern.points[dart.tipId]?.pos,
          ...sampleEdge(pattern, dart.edge1Id),
          ...sampleEdge(pattern, dart.edge2Id)].filter((p): p is Vec2 => !!p),
      }));
    case 'seam':
      return Object.values(pattern.seams)
        .filter(seam => seam.stitchVisible !== false)
        .map(seam => ({
          id: seam.id,
          points: [...sampleEdgeInterval(pattern, seam.a.edgeId, seam.a.t0, seam.a.t1),
            ...sampleEdgeInterval(pattern, seam.b.edgeId, seam.b.t0, seam.b.t1)],
        }));
    case 'notch':
      return Object.values(pattern.notches ?? {}).map(notch => {
        const at = pointAtT(pattern, notch.edgeId, notch.t);
        return { id: notch.id, points: at ? [at] : [] };
      });
    case 'annotation':
      return Object.values(pattern.annotations ?? {}).map(note => ({ id: note.id, points: [note.pos] }));
    case 'measurement':
      return Object.values(pattern.measurements ?? {}).map(measurement => {
        const a = measurement.refs.pointAId && pattern.points[measurement.refs.pointAId];
        const b = measurement.refs.pointBId && pattern.points[measurement.refs.pointBId];
        const points = a && b ? [a.pos, b.pos] : (measurement.refs.edgeId ? sampleEdge(pattern, measurement.refs.edgeId) : []);
        return { id: measurement.id, points };
      });
  }
}
