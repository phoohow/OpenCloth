import type { Panel, Pattern, Seam, Vec2 } from '@/model/types';
import { samplePanelOutline } from '@/pattern/panel/panelBuilder';
import { sampleEdge } from '@/pattern/geom/edgeSample';

/** Which end of a seam interval the joint sits at. */
export type SeamJointEnd = 'start' | 'end';

/** Rigid map carrying one panel into the other's frame as the seam would hold it. */
export type SewnPose = (p: Vec2) => Vec2;

/** Corner where the two sides of a seam end meet, measured in the sewn-flat pose. */
export interface SeamJoint {
  seamId: string;
  end: SeamJointEnd;
  panelAId: string;
  panelBId: string;
  /** Outline corner of each side that the joint rounds. */
  pointAId: string;
  pointBId: string;
  /** Joint position, in panel A's coordinates. */
  pos: Vec2;
  /** Angle between the two outline edges leaving the joint; 180 runs straight through. */
  angleDeg: number;
  /** `180 - angleDeg`: how far the joined edge bends at this corner. */
  bendDeg: number;
  /** The two panels cover each other's area once the seam is closed. */
  overlap: boolean;
  /** Maps panel B's flat pattern into panel A's frame with the seam closed. */
  pose: SewnPose;
}

const EPS = 1e-6;

/** Radius around the joint within which the two panels are checked for covering each other. */
const JOINT_PROBE_CM = 2;

/** How far inside the other panel a point must be, past outline sampling noise, to count as covered. */
const PENETRATION_CM = 0.4;

const unit = (v: Vec2): Vec2 | null => {
  const l = Math.hypot(v.x, v.y);
  return l < EPS ? null : { x: v.x / l, y: v.y / l };
};

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/** Unsigned angle between two directions, in degrees. */
function angleBetweenDeg(a: Vec2, b: Vec2): number {
  const dot = a.x * b.x + a.y * b.y;
  const cross = a.x * b.y - a.y * b.x;
  return (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
}

/** Ray-cast point-in-polygon test. */
function insidePolygon(poly: Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Panel holding an edge on its outer outline, or null. */
function outlinePanel(pattern: Pattern, edgeId: string): Panel | null {
  for (const panel of Object.values(pattern.panels)) {
    if (panel.outlineEdgeIds.includes(edgeId)) return panel;
  }
  return null;
}

/** Unit travel direction of an edge at one of its endpoints. */
function travelAt(pattern: Pattern, edgeId: string, pointId: string): Vec2 | null {
  const edge = pattern.edges[edgeId];
  if (!edge) return null;
  const pts = sampleEdge(pattern, edgeId);
  if (pts.length < 2) return null;
  if (edge.startPointId === pointId) return unit({ x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y });
  if (edge.endPointId === pointId) {
    const n = pts.length;
    return unit({ x: pts[n - 1].x - pts[n - 2].x, y: pts[n - 1].y - pts[n - 2].y });
  }
  return null;
}

/** Index of a point in a sampled outline polygon, matching by position. */
function vertexIndex(poly: Vec2[], pos: Vec2): number {
  let best = -1;
  let bestDist = 1e-4;
  poly.forEach((p, i) => {
    const d = Math.hypot(p.x - pos.x, p.y - pos.y);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

/**
 * Ray leaving a panel's outline corner along the edge that continues the contour past the
 * seam edge: of the two outline neighbours, the one sitting on the seam edge is the seam side.
 */
function leavingRay(pattern: Pattern, panel: Panel, seamEdgeId: string, pos: Vec2): Vec2 | null {
  const poly = samplePanelOutline(pattern, panel);
  const i = vertexIndex(poly, pos);
  if (i < 0 || poly.length < 3) return null;
  const n = poly.length;
  const prev = poly[(i - 1 + n) % n];
  const next = poly[(i + 1) % n];
  const away = distanceToEdge(pattern, seamEdgeId, prev) < distanceToEdge(pattern, seamEdgeId, next)
    ? next : prev;
  return unit(sub(away, poly[i]));
}

/** Nearest distance from a point to an edge's samples; zero when the point sits on that edge. */
function distanceToEdge(pattern: Pattern, edgeId: string, p: Vec2): number {
  let best = Infinity;
  for (const q of sampleEdge(pattern, edgeId)) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
  return best;
}

/** B's interval parameter paired with A's at the given seam end. */
function pairedB(seam: Seam, end: SeamJointEnd): number {
  const aStart = end === 'start';
  return aStart !== seam.flip ? seam.b.t0 : seam.b.t1;
}

/**
 * Corner where one seam end joins; both sides must stop on an outline corner. The angle is
 * between the two contour edges that continue away from the joint after panel B is laid into
 * panel A's frame with the seam closed: 180 degrees means the joined edge runs straight on,
 * anything smaller bends or doubles back at this corner.
 */
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

  // Closing the seam turns B until its stitch line runs against A's, which presses the two
  // panels flat on opposite sides of the seam.
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

  const rayBSewn = unit(sub(pose({ x: posB.x + rayB.x, y: posB.y + rayB.y }), pos));
  if (!rayBSewn) return null;

  const sewnB = outlineB.map(pose);
  // Overlap is judged where the joint meets the contour, and only for a real intrusion: the
  // point must lie inside the other panel and further than PENETRATION_CM from its samples.
  const near = (p: Vec2): boolean => Math.hypot(p.x - pos.x, p.y - pos.y) <= JOINT_PROBE_CM;
  const intrudes = (p: Vec2, poly: Vec2[]): boolean => {
    if (!insidePolygon(poly, p)) return false;
    return poly.every(q => Math.hypot(p.x - q.x, p.y - q.y) > PENETRATION_CM);
  };
  const overlap = sewnB.filter(near).some(p => intrudes(p, outlineA))
    || outlineA.filter(near).some(p => intrudes(p, sewnB));

  const angleDeg = angleBetweenDeg(rayA, rayBSewn);
  return {
    seamId, end, panelAId: panelA.id, panelBId: panelB.id, pointAId, pointBId,
    pos, angleDeg, bendDeg: 180 - angleDeg, overlap, pose,
  };
}

/** Panel B's outline drawn in panel A's frame, as the closed seam would hold it. */
export function sewnOutline(pattern: Pattern, joint: SeamJoint): Vec2[] {
  const panel = pattern.panels[joint.panelBId];
  if (!panel) return [];
  return samplePanelOutline(pattern, panel).map(joint.pose);
}

/** Both corners of the joint, for a fillet that rounds the sewn corner away. */
export function jointCornerIds(joint: SeamJoint): string[] {
  return [joint.pointAId, joint.pointBId];
}
