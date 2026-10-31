import type { ArcGeom, Pattern, PatternEdge, Vec2 } from '../../core/model/types';
import { arcSpan } from '../../pattern/geom/arc';
import { sampleEdge } from '../../pattern/panel/panelBuilder';
import { snapToGrid } from './viewMath';

/** Kinds of snap candidate, ordered by pick priority. */
export type SnapKind =
  | 'endpoint' | 'intersection' | 'midpoint' | 'perpendicular'
  | 'tangent' | 'extension' | 'equidistant' | 'grid';

/** A snap candidate position with its kind and optional source ids. */
export interface SnapCandidate {
  pos: Vec2;
  kind: SnapKind;
  pointId?: string;
  edgeId?: string;
}

const KIND_RANK: Record<SnapKind, number> = {
  endpoint: 0, intersection: 1, midpoint: 2, perpendicular: 3,
  tangent: 4, extension: 5, equidistant: 6, grid: 7,
};

/** Snap candidates drawn from the pattern: vertices, edge midpoints and edge crossings. */
export function collectSnapCandidates(pattern: Pattern): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (const point of Object.values(pattern.points)) {
    out.push({ pos: point.pos, kind: 'endpoint', pointId: point.id });
  }
  const lines: { id: string; a: Vec2; b: Vec2 }[] = [];
  for (const edge of Object.values(pattern.edges)) {
    const pts = sampleEdge(pattern, edge.id);
    if (pts.length < 2) continue;
    out.push({ pos: pts[Math.floor(pts.length / 2)], kind: 'midpoint', edgeId: edge.id });
    if (edge.type === 'line') lines.push({ id: edge.id, a: pts[0], b: pts[pts.length - 1] });
  }
  out.push(...lineIntersections(pattern, lines));
  return out;
}

/** Crossing points of straight edges that do not already share a vertex. */
function lineIntersections(pattern: Pattern, lines: { id: string; a: Vec2; b: Vec2 }[]): SnapCandidate[] {
  const shared = (x: Vec2, y: Vec2): boolean => Math.hypot(x.x - y.x, x.y - y.y) < 1e-6;
  const out: SnapCandidate[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const p = lines[i], q = lines[j];
      if (shared(p.a, q.a) || shared(p.a, q.b) || shared(p.b, q.a) || shared(p.b, q.b)) continue;
      const at = segmentCrossing(p, q);
      if (at && pattern.edges[p.id] && pattern.edges[q.id]) out.push({ pos: at, kind: 'intersection' });
    }
  }
  return out;
}

/** Interior crossing point of two segments, null when parallel or non-crossing. */
function segmentCrossing(
  p: { a: Vec2; b: Vec2 }, q: { a: Vec2; b: Vec2 },
): Vec2 | null {
  const dx1 = p.b.x - p.a.x, dy1 = p.b.y - p.a.y;
  const dx2 = q.b.x - q.a.x, dy2 = q.b.y - q.a.y;
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q.a.x - p.a.x) * dy2 - (q.a.y - p.a.y) * dx2) / den;
  const s = ((q.a.x - p.a.x) * dy1 - (q.a.y - p.a.y) * dx1) / den;
  if (t <= 1e-6 || t >= 1 - 1e-6 || s <= 1e-6 || s >= 1 - 1e-6) return null;
  return { x: p.a.x + t * dx1, y: p.a.y + t * dy1 };
}

/**
 * Cursor-dependent candidates: the perpendicular foot on an edge, the tangency point on a
 * curve or arc from the draft anchor, the projection onto a straight edge's extension, and the
 * point holding the anchor's offset distance along a nearby edge's normal.
 */
export function collectCursorCandidates(
  pattern: Pattern, world: Vec2, tolerance: number, anchor?: Vec2,
): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (const edge of Object.values(pattern.edges)) {
    const pts = sampleEdge(pattern, edge.id);
    if (pts.length < 2) continue;
    const foot = nearestOnPolyline(pts, world);
    if (foot && Math.hypot(foot.x - world.x, foot.y - world.y) <= tolerance) {
      out.push({ pos: foot, kind: 'perpendicular', edgeId: edge.id });
    }
    if (edge.type === 'line') {
      const onExtension = extensionPoint(pts[0], pts[pts.length - 1], world, tolerance);
      if (onExtension) out.push({ pos: onExtension, kind: 'extension', edgeId: edge.id });
    }
    if (!anchor) continue;
    for (const point of tangentPoints(edge, pts, anchor)) {
      if (Math.hypot(point.x - world.x, point.y - world.y) <= tolerance) {
        out.push({ pos: point, kind: 'tangent', edgeId: edge.id });
      }
    }
    const equidistant = equidistantPoint(pts, anchor, world, tolerance);
    if (equidistant) out.push({ pos: equidistant, kind: 'equidistant', edgeId: edge.id });
  }
  return out;
}

/** Tangency points from `anchor` on a curve or arc edge: exact for an arc, sampled for a bezier. */
function tangentPoints(edge: PatternEdge, pts: Vec2[], anchor: Vec2): Vec2[] {
  if (edge.type === 'arc' && edge.arc) return arcTangentPoints(edge.arc, anchor);
  if (edge.type === 'bezier') return bezierTangentPoints(pts, anchor);
  return [];
}

/**
 * Arc points where the line from `anchor` is tangent; none when the anchor is inside the circle.
 * The two tangent points make an angle acos(r / |AO|) with the anchor direction at the centre.
 */
function arcTangentPoints(arc: ArcGeom, anchor: Vec2): Vec2[] {
  const dx = anchor.x - arc.center.x, dy = anchor.y - arc.center.y;
  const d = Math.hypot(dx, dy);
  if (d <= arc.radius + 1e-9) return [];
  const base = Math.atan2(dy, dx);
  const spread = Math.acos(arc.radius / d);
  const out: Vec2[] = [];
  for (const angle of [base - spread, base + spread]) {
    if (!angleOnArc(arc, angle)) continue;
    out.push({ x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) });
  }
  return out;
}

/** True when `angle` lies within the arc's swept range from its start toward its end. */
function angleOnArc(arc: ArcGeom, angle: number): boolean {
  const span = arcSpan(arc);
  let off = (angle - arc.startAngle) % (Math.PI * 2);
  if (off < 0) off += Math.PI * 2;
  return span >= 0 ? off <= span + 1e-9 : off >= Math.PI * 2 + span - 1e-9;
}

/** Sampled bezier points where the anchor-to-point vector turns perpendicular to the edge. */
function bezierTangentPoints(pts: Vec2[], anchor: Vec2): Vec2[] {
  const out: Vec2[] = [];
  let previous: number | null = null;
  for (let i = 1; i + 1 < pts.length; i++) {
    const tx = pts[i + 1].x - pts[i - 1].x, ty = pts[i + 1].y - pts[i - 1].y;
    const tl = Math.hypot(tx, ty);
    const vx = pts[i].x - anchor.x, vy = pts[i].y - anchor.y;
    const vl = Math.hypot(vx, vy);
    if (tl < 1e-12 || vl < 1e-12) continue;
    const cos = (vx * tx + vy * ty) / (vl * tl);
    if (previous !== null && Math.sign(cos) !== Math.sign(previous)) out.push(pts[i]);
    previous = cos;
  }
  return out;
}

/** The point keeping the anchor's perpendicular offset from the edge, set on the edge normal at the cursor's foot. */
function equidistantPoint(pts: readonly Vec2[], anchor: Vec2, world: Vec2, tolerance: number): Vec2 | null {
  const foot = nearestOnPolyline(pts, world);
  if (!foot) return null;
  const mx = world.x - foot.x, my = world.y - foot.y;
  const offset = Math.hypot(mx, my);
  if (offset < 1e-9) return null;
  const anchorFoot = nearestOnPolyline(pts, anchor);
  if (!anchorFoot) return null;
  const keep = Math.hypot(anchor.x - anchorFoot.x, anchor.y - anchorFoot.y);
  if (keep < 1e-9) return null;
  const pos = { x: foot.x + (mx / offset) * keep, y: foot.y + (my / offset) * keep };
  const shift = Math.hypot(pos.x - world.x, pos.y - world.y);
  return shift > 1e-6 && shift <= tolerance ? pos : null;
}

/** Nearest point of a polyline to `p`, or null when the polyline is degenerate. */
function nearestOnPolyline(pts: readonly Vec2[], p: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    if (len2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
    const at = { x: a.x + t * vx, y: a.y + t * vy };
    const d = Math.hypot(at.x - p.x, at.y - p.y);
    if (d < bestD) { bestD = d; best = at; }
  }
  return best;
}

/** Projection of `p` onto the edge's line when it falls outside the segment but stays close. */
function extensionPoint(a: Vec2, b: Vec2, p: Vec2, tolerance: number): Vec2 | null {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-12) return null;
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  const margin = tolerance / Math.sqrt(len2);
  if (t >= -margin && t <= 1 + margin) return null;
  const at = { x: a.x + t * vx, y: a.y + t * vy };
  return Math.hypot(at.x - p.x, at.y - p.y) <= tolerance ? at : null;
}

/** Best candidate for a world position: nearest wins, ties break by kind priority. */
export function findSnap(
  world: Vec2, candidates: readonly SnapCandidate[], tolerance: number,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  for (const c of candidates) {
    const d = Math.hypot(c.pos.x - world.x, c.pos.y - world.y);
    if (d > tolerance) continue;
    if (!best) { best = c; continue; }
    const bd = Math.hypot(best.pos.x - world.x, best.pos.y - world.y);
    if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && KIND_RANK[c.kind] < KIND_RANK[best.kind])) {
      best = c;
    }
  }
  return best;
}

/** Static plus cursor-derived candidates, resolved with the same nearest-then-priority rule. */
export function findSnapAtPattern(
  pattern: Pattern, world: Vec2, candidates: readonly SnapCandidate[], tolerance: number, anchor?: Vec2,
): SnapCandidate | null {
  return findSnap(world, [...candidates, ...collectCursorCandidates(pattern, world, tolerance, anchor)], tolerance);
}

/**
 * Resolution of one pointer position for drafting input: snap candidate when close,
 * grid otherwise, raw when freehand (Alt).
 */
export function resolveDraftPoint(
  world: Vec2, candidates: readonly SnapCandidate[], opts: { freehand?: boolean; gridStep?: number },
): { pos: Vec2; snap: SnapCandidate | null } {
  if (opts.freehand) return { pos: world, snap: null };
  const snap = findSnap(world, candidates, 8 / 4);
  if (snap) return { pos: snap.pos, snap };
  return { pos: snapToGrid(world, opts.gridStep), snap: null };
}

/** Constraint of shift-drag input: nearest multiple of 45° from the anchor. */
export function constrainAngle(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}
