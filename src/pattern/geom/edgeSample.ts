import type { Measurement, Pattern, Vec2 } from '../../core/model/types';
import { adaptiveSampleBezier, edgeCurve } from './bezier';
import { adaptiveSampleArc } from './arc';

/** Samples one pattern edge as polyline points; curve and arc edges use adaptive tolerance. */
export function sampleEdge(pattern: Pattern, edgeId: string, reverse = false): Vec2[] {
  const edge = pattern.edges[edgeId];
  if (!edge) return [];
  const p0 = pattern.points[edge.startPointId]?.pos;
  const p1 = pattern.points[edge.endPointId]?.pos;
  if (!p0 || !p1) return [];

  let pts: Vec2[];
  if (edge.type === 'arc' && edge.arc) {
    pts = adaptiveSampleArc(edge.arc, 0.02);
  } else if (edge.type === 'bezier') {
    const curve = edgeCurve(pattern, edge);
    pts = curve ? adaptiveSampleBezier(curve, 0.2) : [p0, p1];
  } else {
    pts = [p0, p1];
  }
  return reverse ? [...pts].reverse() : pts;
}

/** Cumulative chord lengths of a polyline. */
function chordLengths(pts: Vec2[]): number[] {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return acc;
}

/** Point at arc-length fraction t along an edge. */
export function pointAtT(pattern: Pattern, edgeId: string, t: number): Vec2 | null {
  const pts = sampleEdge(pattern, edgeId);
  if (pts.length < 2) return pts[0] ?? null;
  const acc = chordLengths(pts);
  const target = Math.min(1, Math.max(0, t)) * acc[acc.length - 1];
  for (let i = 1; i < acc.length; i++) {
    if (acc[i] >= target) {
      const span = acc[i] - acc[i - 1] || 1;
      const k = (target - acc[i - 1]) / span;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k,
      };
    }
  }
  return { ...pts[pts.length - 1] };
}

/** Sampled polyline of the arc-length sub-interval [t0, t1] of an edge. */
export function sampleEdgeInterval(
  pattern: Pattern, edgeId: string, t0 = 0, t1 = 1, reverse = false,
): Vec2[] {
  const pts = sampleEdge(pattern, edgeId);
  if (pts.length < 2 || (t0 === 0 && t1 === 1)) return reverse ? [...pts].reverse() : pts;
  const acc = chordLengths(pts);
  const total = acc[acc.length - 1] || 1;
  const lo = Math.min(t0, t1) * total;
  const hi = Math.max(t0, t1) * total;
  const out: Vec2[] = [pointAtT(pattern, edgeId, Math.min(t0, t1))!];
  for (let i = 1; i < pts.length - 1; i++) {
    if (acc[i] > lo && acc[i] < hi) out.push(pts[i]);
  }
  out.push(pointAtT(pattern, edgeId, Math.max(t0, t1))!);
  return reverse ? [...out].reverse() : out;
}

/** Total sampled length of an edge, in cm. */
export function edgeLength(pattern: Pattern, edgeId: string): number {
  const pts = sampleEdge(pattern, edgeId);
  const acc = chordLengths(pts);
  return acc[acc.length - 1] ?? 0;
}

/** Sampled length of the arc-length sub-interval [t0, t1] of an edge, in cm. */
export function edgeIntervalLength(pattern: Pattern, edgeId: string, t0 = 0, t1 = 1): number {
  const acc = chordLengths(sampleEdgeInterval(pattern, edgeId, t0, t1));
  return acc[acc.length - 1] ?? 0;
}

/**
 * Reading of one dimension line: centimetres for distances and edge lengths, degrees for
 * angles. Null when the elements it references no longer exist.
 */
export function measurementValue(pattern: Pattern, measurement: Measurement): number | null {
  const a = measurement.refs.pointAId ? pattern.points[measurement.refs.pointAId]?.pos : null;
  const b = measurement.refs.pointBId ? pattern.points[measurement.refs.pointBId]?.pos : null;
  if (measurement.kind === 'edgeLength') {
    return measurement.refs.edgeId && pattern.edges[measurement.refs.edgeId]
      ? edgeLength(pattern, measurement.refs.edgeId)
      : null;
  }
  if (!a || !b) return null;
  if (measurement.kind === 'angle') return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return Math.hypot(b.x - a.x, b.y - a.y);
}
