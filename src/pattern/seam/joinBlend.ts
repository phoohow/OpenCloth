import type { Panel, Pattern, Seam, Vec2 } from '@/model/types';

import { pointInPolygon } from '@/base/geom';
import { distanceToPolyline } from '@/base/geom/curve';
import {
  EPS, angleBetween2, distance2, radToDeg, sub2, unit2,
} from '@/base/math';
import { sampleEdge } from '@/pattern/geom';
import { samplePanelOutline } from '@/pattern/panel';

const JOINT_PROBE_CM = 2;

const PENETRATION_CM = 0.4;

export type SeamJointEnd = 'start' | 'end';

export type SewnPose = (p: Vec2) => Vec2;

export interface SeamJoint {
  seamId: string;
  end: SeamJointEnd;
  panelAId: string;
  panelBId: string;
  pointAId: string;
  pointBId: string;
  pos: Vec2;
  angleDeg: number;
  bendDeg: number;
  overlap: boolean;
  pose: SewnPose;
}

function outlinePanel(pattern: Pattern, edgeId: string): Panel | null {
  for (const panel of Object.values(pattern.panels)) {
    if (panel.outlineEdgeIds.includes(edgeId)) return panel;
  }

  return null;
}

function travelAt(pattern: Pattern, edgeId: string, pointId: string): Vec2 | null {
  const edge = pattern.edges[edgeId];
  if (!edge) return null;
  const pts = sampleEdge(pattern, edgeId);
  if (pts.length < 2) return null;
  if (edge.startPointId === pointId) return unit2(sub2(pts[1], pts[0]), EPS);
  if (edge.endPointId === pointId) {
    const n = pts.length;
    return unit2(sub2(pts[n - 1], pts[n - 2]), EPS);
  }

  return null;
}

function vertexIndex(poly: Vec2[], pos: Vec2): number {
  let best = -1;
  let bestDist = 1e-4;
  poly.forEach((p, i) => {
    const d = distance2(p, pos);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

function leavingRay(pattern: Pattern, panel: Panel, seamEdgeId: string, pos: Vec2): Vec2 | null {
  const poly = samplePanelOutline(pattern, panel);
  const i = vertexIndex(poly, pos);
  if (i < 0 || poly.length < 3) return null;
  const n = poly.length;
  const prev = poly[(i - 1 + n) % n];
  const next = poly[(i + 1) % n];
  const away = distanceToEdge(pattern, seamEdgeId, prev) < distanceToEdge(pattern, seamEdgeId, next)
    ? next : prev;
  return unit2(sub2(away, poly[i]), EPS);
}

function distanceToEdge(pattern: Pattern, edgeId: string, p: Vec2): number {
  return distanceToPolyline(p, sampleEdge(pattern, edgeId));
}

function pairedB(seam: Seam, end: SeamJointEnd): number {
  const aStart = end === 'start';
  return aStart !== seam.flip ? seam.b.t0 : seam.b.t1;
}

export function seamJoint(pattern: Pattern, seamId: string, end: SeamJointEnd): SeamJoint | null {
  const seam = pattern.seams[seamId];
  if (!seam) return null;
  const aT = end === 'start' ? seam.a.t0 : seam.a.t1;
  const bT = pairedB(seam, end);
  if (Math.min(aT, 1 - aT) > EPS || Math.min(bT, 1 - bT) > EPS) return null;

  const panelA = outlinePanel(pattern, seam.a.edgeId);
  const panelB = outlinePanel(pattern, seam.b.edgeId);
  if (!panelA || !panelB || panelA.id === panelB.id) return null;

  const edgeA = pattern.edges[seam.a.edgeId];
  const edgeB = pattern.edges[seam.b.edgeId];
  if (!edgeA || !edgeB) return null;
  const pointAId = aT < 0.5 ? edgeA.startPointId : edgeA.endPointId;
  const pointBId = bT < 0.5 ? edgeB.startPointId : edgeB.endPointId;
  const pos = pattern.points[pointAId]?.pos;
  const posB = pattern.points[pointBId]?.pos;
  if (!pos || !posB) return null;

  const travelA = travelAt(pattern, seam.a.edgeId, pointAId);
  const travelB = travelAt(pattern, seam.b.edgeId, pointBId);
  if (!travelA || !travelB) return null;

  const rayA = leavingRay(pattern, panelA, seam.a.edgeId, pos);
  const rayB = leavingRay(pattern, panelB, seam.b.edgeId, posB);
  if (!rayA || !rayB) return null;

  const outlineA = samplePanelOutline(pattern, panelA);
  const outlineB = samplePanelOutline(pattern, panelB);
  const target = { x: -travelA.x, y: -travelA.y };
  const cos = travelB.x * target.x + travelB.y * target.y;
  const sin = travelB.x * target.y - travelB.y * target.x;
  const pose: SewnPose = p => {
    const dx = p.x - posB.x;
    const dy = p.y - posB.y;
    return { x: pos.x + dx * cos - dy * sin, y: pos.y + dx * sin + dy * cos };
  };

  const rayBSewn = unit2(sub2(pose({ x: posB.x + rayB.x, y: posB.y + rayB.y }), pos), EPS);
  if (!rayBSewn) return null;

  const sewnB = outlineB.map(pose);
  const near = (p: Vec2): boolean => distance2(p, pos) <= JOINT_PROBE_CM;
  const intrudes = (p: Vec2, poly: Vec2[]): boolean => {
    if (!pointInPolygon(poly, p)) return false;
    return poly.every(q => distance2(p, q) > PENETRATION_CM);
  };
  const overlap = sewnB.filter(near).some(p => intrudes(p, outlineA))
    || outlineA.filter(near).some(p => intrudes(p, sewnB));

  const angleDeg = radToDeg(angleBetween2(rayA, rayBSewn));
  return {
    seamId, end, panelAId: panelA.id, panelBId: panelB.id, pointAId, pointBId,
    pos, angleDeg, bendDeg: 180 - angleDeg, overlap, pose,
  };
}

export function sewnOutline(pattern: Pattern, joint: SeamJoint): Vec2[] {
  const panel = pattern.panels[joint.panelBId];
  if (!panel) return [];
  return samplePanelOutline(pattern, panel).map(joint.pose);
}

export function jointCornerIds(joint: SeamJoint): string[] {
  return [joint.pointAId, joint.pointBId];
}
