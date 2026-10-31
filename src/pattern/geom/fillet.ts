import type { Pattern, PatternEdge, Vec2 } from '../../core/model/types';
import { add, sub, dot, distance, lerp, normalize, scale } from './vec2';
import { genId } from '../../core/model/defaults';
import { edgeCurve, splitEdgeCurve } from './bezier';
import { arcFromThreePoints, arcSpan } from './arc';
import { edgeLength, sampleEdge } from './edgeSample';

/** Edges and tangent points that replace one filleted corner. */
export interface FilletResult {
  /** Replacement edges in outline order: trimmed inbound, fillet arc, trimmed outbound. */
  edges: PatternEdge[];
  /** Ids of the tangent points inserted on the inbound and outbound edges. */
  newPointIds: string[];
}

type CutSide = 'start' | 'end';

const arcPoint = (center: Vec2, radius: number, angle: number): Vec2 => ({
  x: center.x + radius * Math.cos(angle),
  y: center.y + radius * Math.sin(angle),
});

/** Total chord length of a sampled polyline. */
function chordTotal(pts: Vec2[]): number {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) acc += distance(pts[i - 1], pts[i]);
  return acc;
}

/** Unit tangent at an edge endpoint; curves use their sampled direction at that end. */
function tangentAtEdgeEnd(pattern: Pattern, edge: PatternEdge, atEnd: boolean): Vec2 | null {
  const pts = sampleEdge(pattern, edge.id);
  if (pts.length < 2) return null;
  const a = atEnd ? pts[pts.length - 2] : pts[0];
  const b = atEnd ? pts[pts.length - 1] : pts[1];
  return distance(a, b) < 1e-12 ? null : normalize(sub(b, a));
}

/** Point on the edge at `dist` from the given side, or null when the edge is shorter. */
function cutPoint(pattern: Pattern, edge: PatternEdge, dist: number, side: CutSide): Vec2 | null {
  const start = pattern.points[edge.startPointId]?.pos;
  const end = pattern.points[edge.endPointId]?.pos;
  if (!start || !end) return null;

  if (edge.type === 'arc' && edge.arc) {
    const arc = edge.arc;
    if (!(arc.radius > 0)) return null;
    const delta = dist / arc.radius;
    if (delta >= arcSpan(arc)) return null;
    const fromStart = side === 'start' ? delta : arcSpan(arc) - delta;
    return arcPoint(arc.center, arc.radius, arc.ccw ? arc.startAngle + fromStart : arc.startAngle - fromStart);
  }

  if (edge.type === 'bezier' && edgeCurve(pattern, edge)) {
    const pts = sampleEdge(pattern, edge.id);
    const target = side === 'start' ? dist : chordTotal(pts) - dist;
    if (target < 0) return null;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = distance(pts[i - 1], pts[i]);
      if (acc + seg >= target) {
        const k = seg < 1e-12 ? 0 : (target - acc) / seg;
        return lerp(pts[i - 1], pts[i], k);
      }
      acc += seg;
    }
    return null;
  }

  const len = distance(start, end);
  if (len < 1e-12 || dist > len) return null;
  const t = side === 'start' ? dist / len : 1 - dist / len;
  return lerp(start, end, t);
}

/** Registers the tangent point and replacement edge trimming the cut off one side. */
function trimEdge(
  pattern: Pattern,
  edge: PatternEdge,
  side: CutSide,
  cut: Vec2,
  makeEdge: (startId: string, endId: string) => PatternEdge,
): PatternEdge {
  const cutId = genId('pt');
  pattern.points[cutId] = { id: cutId, pos: cut, kind: 'smooth' };

  let kept: PatternEdge;
  if (edge.type === 'arc' && edge.arc) {
    const arc = edge.arc;
    const cutAngle = Math.atan2(cut.y - arc.center.y, cut.x - arc.center.x);
    kept = side === 'start'
      ? makeEdge(cutId, edge.endPointId)
      : makeEdge(edge.startPointId, cutId);
    kept.type = 'arc';
    kept.arc = {
      center: { ...arc.center },
      radius: arc.radius,
      startAngle: side === 'start' ? cutAngle : arc.startAngle,
      endAngle: side === 'end' ? cutAngle : arc.endAngle,
      ccw: arc.ccw,
    };
  } else if (edge.type === 'bezier' && edgeCurve(pattern, edge)) {
    const [first, second] = splitEdgeCurve(pattern, edge, cut, makeEdge);
    kept = side === 'start' ? second : first;
  } else {
    kept = side === 'start' ? makeEdge(cutId, edge.endPointId) : makeEdge(edge.startPointId, cutId);
    kept.type = 'line';
  }

  kept.semantic = edge.semantic;
  kept.seamAllowanceCm = edge.seamAllowanceCm;
  kept.cornerStyle = edge.cornerStyle;
  pattern.edges[kept.id] = kept;
  return kept;
}

/**
 * Replaces a corner of a closed outline with a tangent arc of `radius`, registering the
 * new points and edges in the pattern and removing the two edges it replaces. Line-line
 * corners get exact tangent points; curve and arc neighbours are approximated from their
 * sampled tangents. Returns null when the radius does not fit the adjacent edge lengths
 * or the corner has no filletable wedge.
 */
export function filletCorner(
  pattern: Pattern,
  pointId: string,
  radius: number,
  makeEdge: (startId: string, endId: string) => PatternEdge,
): FilletResult | null {
  const corner = pattern.points[pointId];
  if (!corner || !(radius > 0) || !Number.isFinite(radius)) return null;

  const incident = Object.values(pattern.edges)
    .filter(e => (e.startPointId === pointId || e.endPointId === pointId)
      && e.startPointId !== e.endPointId);
  if (incident.length !== 2) return null;
  const inEdge = incident.find(e => e.endPointId === pointId);
  const outEdge = incident.find(e => e.startPointId === pointId);
  if (!inEdge || !outEdge || inEdge.id === outEdge.id) return null;

  const inLen = edgeLength(pattern, inEdge.id);
  const outLen = edgeLength(pattern, outEdge.id);
  if (!(inLen > 0) || !(outLen > 0)) return null;

  const dirIn = tangentAtEdgeEnd(pattern, inEdge, true);
  const dirOut = tangentAtEdgeEnd(pattern, outEdge, false);
  if (!dirIn || !dirOut) return null;
  // Rays leaving the corner along each edge.
  const u = dirOut;
  const w = scale(dirIn, -1);

  const cosT = Math.min(1, Math.max(-1, dot(u, w)));
  const sinH = Math.sqrt(Math.max(0, (1 - cosT) / 2));
  const cosH = Math.sqrt(Math.max(0, (1 + cosT) / 2));
  // sinH near 0 is a cusp, cosH near 0 a straight angle; neither has a fillet wedge.
  if (sinH < 1e-6 || cosH < 1e-6) return null;

  const tangentLen = radius * cosH / sinH;
  if (tangentLen < 1e-6 || tangentLen > inLen - 1e-6 || tangentLen > outLen - 1e-6) return null;

  const bis = normalize(add(u, w));
  const centerDist = radius / sinH;
  const mid = add(corner.pos, scale(bis, centerDist - radius));

  const cutIn = cutPoint(pattern, inEdge, tangentLen, 'end');
  const cutOut = cutPoint(pattern, outEdge, tangentLen, 'start');
  if (!cutIn || !cutOut || distance(cutIn, cutOut) < 1e-6) return null;

  const arcGeom = arcFromThreePoints(cutIn, mid, cutOut);
  if (!arcGeom || !(arcGeom.radius > 0)) return null;

  const keptIn = trimEdge(pattern, inEdge, 'end', cutIn, makeEdge);
  const keptOut = trimEdge(pattern, outEdge, 'start', cutOut, makeEdge);

  const filletEdge = makeEdge(keptIn.endPointId, keptOut.startPointId);
  filletEdge.type = 'arc';
  filletEdge.arc = arcGeom;
  pattern.edges[filletEdge.id] = filletEdge;

  delete pattern.edges[inEdge.id];
  delete pattern.edges[outEdge.id];

  return {
    edges: [keptIn, filletEdge, keptOut],
    newPointIds: [keptIn.endPointId, keptOut.startPointId],
  };
}

/**
 * Fillets every listed corner with the same radius, one at a time so adjacent corners see
 * the already-rounded edges; the result holds the final live edges of all touched corners.
 * Returns null at the first corner that fails, leaving earlier fillets registered in the
 * pattern.
 */
export function filletCorners(
  pattern: Pattern,
  pointIds: string[],
  radius: number,
  makeEdge: (startId: string, endId: string) => PatternEdge,
): FilletResult | null {
  let live: PatternEdge[] = [];
  const newPointIds: string[] = [];
  for (const id of pointIds) {
    const result = filletCorner(pattern, id, radius, makeEdge);
    if (!result) return null;
    // Earlier results retrimmed by this corner are gone from pattern.edges.
    live = live.filter(e => pattern.edges[e.id] !== undefined);
    live.push(...result.edges);
    newPointIds.push(...result.newPointIds);
  }
  return { edges: live, newPointIds };
}
