import { TAU, clamp01, wrapAngle, wrapAngleSigned, type Vec2 } from '@/base/math';

/** Circular arc between two endpoints, with angles in radians. */
export interface ArcGeom {
  center: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
  ccw: boolean;
}

/** Signed sweep of an arc in radians; negative runs clockwise from start to end. */
export function arcSpan(arc: ArcGeom): number {
  const delta = wrapAngle(arc.endAngle - arc.startAngle);
  return arc.ccw ? delta : delta - TAU;
}

/** Fraction of the arc nearest to `p`; the middle when the arc has no sweep. */
export function arcTForPoint(arc: ArcGeom, p: Vec2): number {
  const sweep = arcSpan(arc);
  if (sweep === 0) return 0.5;
  const angle = Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
  return clamp01(wrapAngleSigned(angle - arc.startAngle) / sweep);
}

/** Point on the arc at fraction t of its sweep. */
export function evalArc(arc: ArcGeom, t: number): Vec2 {
  const angle = arc.startAngle + arcSpan(arc) * t;
  return {
    x: arc.center.x + arc.radius * Math.cos(angle),
    y: arc.center.y + arc.radius * Math.sin(angle),
  };
}

/**
 * Builds the arc through three points; collinear input returns null.
 * The sweep direction follows the a → mid → b order.
 */
export function arcFromThreePoints(a: Vec2, mid: Vec2, b: Vec2): ArcGeom | null {
  const ax = a.x, ay = a.y, bx = b.x, by = b.y, cx = mid.x, cy = mid.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const center = { x: ux, y: uy };
  const radius = Math.hypot(ax - ux, ay - uy);
  const startAngle = Math.atan2(ay - uy, ax - ux);
  const midAngle = Math.atan2(cy - uy, cx - ux);
  const endAngle = Math.atan2(by - uy, bx - ux);
  // Counter-clockwise when the mid angle falls on the CCW path from start to end.
  const ccwToMid = wrapAngle(midAngle - startAngle);
  const ccwToEnd = wrapAngle(endAngle - startAngle);
  const ccw = ccwToMid <= ccwToEnd + 1e-9;
  return { center, radius, startAngle, endAngle, ccw };
}

/** Samples the arc so chord deviation stays under the tolerance, at 8 points minimum. */
export function adaptiveSampleArc(arc: ArcGeom, tolerance = 0.02): Vec2[] {
  const span = Math.abs(arcSpan(arc));
  const steps = Math.max(8, Math.ceil(span / Math.acos(Math.max(0, 1 - tolerance / arc.radius))));
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) pts.push(evalArc(arc, i / steps));
  return pts;
}
