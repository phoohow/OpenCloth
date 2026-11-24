import type { ArcGeom, Pattern, PatternEdge, Vec2 } from '@/model/types';

import { nearestOnPolyline, polylineMidpoint } from '@/base/geom';
import { projectOnLine2, segmentCrossing2 } from '@/base/geom';
import { arcSpan } from '@/base/geom/arc';
import {
  TAU, distance2, nearlyEqual2, rotate2, wrapAngle,
} from '@/base/math';
import { sampleEdge } from '@/pattern/panel';

const KIND_PULL: Record<SnapKind, number> = {
  endpoint: 0.6, intersection: 0.5, midpoint: 0.35, tangent: 0.3,
  extension: 0.25, perpendicular: 0, equidistant: 0, grid: 0,
};

const EXTENSION_REACH = 6;

export type SnapKind =
  | 'endpoint' | 'intersection' | 'midpoint' | 'perpendicular'
  | 'tangent' | 'extension' | 'equidistant' | 'grid';

export interface SnapCandidate {
  pos: Vec2;
  kind: SnapKind;
  pointId?: string;
  edgeId?: string;
}

export interface InsertTarget {
  pos: Vec2;
  edgeId: string;
  mid: Vec2 | null;
  snapped: boolean;
}

export interface AxisLock {
  from: Vec2;
  to: Vec2;
  axis: 'horizontal' | 'vertical';
}

function visibleGeometry(pattern: Pattern): { edgeIds: Set<string>; pointIds: Set<string> } {
  const edgeIds = new Set<string>();
  const pointIds = new Set<string>();
  const addEdge = (id: string): void => {
    const edge = pattern.edges[id];
    if (!edge) return;
    edgeIds.add(id);
    pointIds.add(edge.startPointId);
    pointIds.add(edge.endPointId);
  };
  for (const panel of Object.values(pattern.panels)) {
    if (panel.visible === false) continue;
    for (const edgeId of [panel.outlineEdgeIds, ...(panel.holes ?? [])].flat()) addEdge(edgeId);
    for (const dartId of panel.dartIds) {
      const dart = pattern.darts[dartId];
      if (!dart) continue;
      addEdge(dart.edge1Id);
      addEdge(dart.edge2Id);
      pointIds.add(dart.tipId);
    }
  }

  return { edgeIds, pointIds };
}

export function collectSnapCandidates(pattern: Pattern): SnapCandidate[] {
  const { edgeIds, pointIds } = visibleGeometry(pattern);
  const out: SnapCandidate[] = [];
  for (const pointId of pointIds) {
    const point = pattern.points[pointId];
    if (point) out.push({ pos: point.pos, kind: 'endpoint', pointId });
  }

  const lines: { a: Vec2; b: Vec2 }[] = [];
  for (const edgeId of edgeIds) {
    const pts = sampleEdge(pattern, edgeId);
    if (pts.length < 2) continue;
    const mid = polylineMidpoint(pts);
    if (mid) out.push({ pos: mid, kind: 'midpoint', edgeId });
    if (pattern.edges[edgeId]?.type === 'line') lines.push({ a: pts[0]!, b: pts[pts.length - 1]! });
  }

  out.push(...lineIntersections(lines));
  return out;
}

export function edgeMidpoint(pattern: Pattern, edgeId: string): Vec2 | null {
  return polylineMidpoint(sampleEdge(pattern, edgeId));
}

export function insertTargetOnEdge(
  pattern: Pattern, hit: { edgeId: string; point: Vec2 }, cursor: Vec2, tolerance: number,
): InsertTarget {
  const mid = edgeMidpoint(pattern, hit.edgeId);
  if (!mid) return { pos: hit.point, edgeId: hit.edgeId, mid: null, snapped: false };
  const snapped = distance2(mid, cursor) <= tolerance;
  return { pos: snapped ? mid : hit.point, edgeId: hit.edgeId, mid, snapped };
}

function lineIntersections(lines: readonly { a: Vec2; b: Vec2 }[]): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const p = lines[i]!, q = lines[j]!;
      if (nearlyEqual2(p.a, q.a) || nearlyEqual2(p.a, q.b)
        || nearlyEqual2(p.b, q.a) || nearlyEqual2(p.b, q.b)) continue;
      const at = segmentCrossing2(p.a, p.b, q.a, q.b);
      if (at) out.push({ pos: at, kind: 'intersection' });
    }
  }

  return out;
}

export function collectCursorCandidates(
  pattern: Pattern, world: Vec2, tolerance: number, anchor?: Vec2,
): SnapCandidate[] {
  const { edgeIds } = visibleGeometry(pattern);
  const out: SnapCandidate[] = [];
  for (const edgeId of edgeIds) {
    const edge = pattern.edges[edgeId];
    if (!edge) continue;
    const pts = sampleEdge(pattern, edgeId);
    if (pts.length < 2) continue;
    const foot = nearestOnPolyline(world, pts);
    if (foot && distance2(foot, world) <= tolerance) {
      out.push({ pos: foot, kind: 'perpendicular', edgeId });
    }

    if (edge.type === 'line') {
      const onExtension = extensionPoint(pts[0]!, pts[pts.length - 1]!, world, tolerance);
      if (onExtension) out.push({ pos: onExtension, kind: 'extension', edgeId });
    }

    if (!anchor) continue;
    for (const point of tangentPoints(edge, pts, anchor)) {
      if (distance2(point, world) <= tolerance) {
        out.push({ pos: point, kind: 'tangent', edgeId });
      }
    }

    const equidistant = equidistantPoint(pts, anchor, world, tolerance);
    if (equidistant) out.push({ pos: equidistant, kind: 'equidistant', edgeId });
  }

  return out;
}

function tangentPoints(edge: PatternEdge, pts: Vec2[], anchor: Vec2): Vec2[] {
  if (edge.type === 'arc' && edge.arc) return arcTangentPoints(edge.arc, anchor);
  if (edge.type === 'bezier') return bezierTangentPoints(pts, anchor);
  return [];
}

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

function angleOnArc(arc: ArcGeom, angle: number): boolean {
  const span = arcSpan(arc);
  const off = wrapAngle(angle - arc.startAngle);
  return span >= 0 ? off <= span + 1e-9 : off >= TAU + span - 1e-9;
}

function bezierTangentPoints(pts: Vec2[], anchor: Vec2): Vec2[] {
  const out: Vec2[] = [];
  let previous: number | null = null;
  for (let i = 1; i + 1 < pts.length; i++) {
    const tx = pts[i + 1]!.x - pts[i - 1]!.x, ty = pts[i + 1]!.y - pts[i - 1]!.y;
    const tl = Math.hypot(tx, ty);
    const vx = pts[i]!.x - anchor.x, vy = pts[i]!.y - anchor.y;
    const vl = Math.hypot(vx, vy);
    if (tl < 1e-12 || vl < 1e-12) continue;
    const cos = (vx * tx + vy * ty) / (vl * tl);
    if (previous !== null && Math.sign(cos) !== Math.sign(previous)) out.push(pts[i]!);
    previous = cos;
  }

  return out;
}

function equidistantPoint(pts: readonly Vec2[], anchor: Vec2, world: Vec2, tolerance: number): Vec2 | null {
  const foot = nearestOnPolyline(world, pts);
  if (!foot) return null;
  const mx = world.x - foot.x, my = world.y - foot.y;
  const offset = Math.hypot(mx, my);
  if (offset < 1e-9) return null;
  const anchorFoot = nearestOnPolyline(anchor, pts);
  if (!anchorFoot) return null;
  const keep = Math.hypot(anchor.x - anchorFoot.x, anchor.y - anchorFoot.y);
  if (keep < 1e-9) return null;
  const pos = { x: foot.x + (mx / offset) * keep, y: foot.y + (my / offset) * keep };
  const shift = distance2(pos, world);
  return shift > 1e-6 && shift <= tolerance ? pos : null;
}

function extensionPoint(a: Vec2, b: Vec2, p: Vec2, tolerance: number): Vec2 | null {
  const length = distance2(a, b);
  if (length < 1e-6) return null;
  const { point, t } = projectOnLine2(p, a, b);
  const margin = tolerance / length;
  if (t >= -margin && t <= 1 + margin) return null;
  const beyond = (t > 1 ? t - 1 : -t) * length;
  if (beyond > tolerance * EXTENSION_REACH) return null;
  return distance2(point, p) <= tolerance ? point : null;
}

export function findSnap(
  world: Vec2, candidates: readonly SnapCandidate[], tolerance: number,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const distance = distance2(candidate.pos, world);
    if (distance > tolerance) continue;
    const score = distance - KIND_PULL[candidate.kind] * tolerance;
    if (score < bestScore - 1e-9) { best = candidate; bestScore = score; }
  }

  return best;
}

export function findSnapAtPattern(
  pattern: Pattern, world: Vec2, candidates: readonly SnapCandidate[], tolerance: number, anchor?: Vec2,
): SnapCandidate | null {
  return findSnap(world, [...candidates, ...collectCursorCandidates(pattern, world, tolerance, anchor)], tolerance);
}

export function constrainAxis(from: Vec2, to: Vec2, tolerance: number): AxisLock | null {
  const dx = Math.abs(to.x - from.x), dy = Math.abs(to.y - from.y);
  if (dx < 1e-9 && dy < 1e-9) return null;
  if (dy <= tolerance && dy <= dx) return { from, to: { x: to.x, y: from.y }, axis: 'horizontal' };
  if (dx <= tolerance && dx < dy) return { from, to: { x: from.x, y: to.y }, axis: 'vertical' };
  return null;
}

export function constrainAngle(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const offset = rotate2({ x: len, y: 0 }, angle);
  return { x: from.x + offset.x, y: from.y + offset.y };
}
