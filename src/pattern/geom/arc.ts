import type { ArcGeom, Vec2 } from '../../core/model/types';

/** Shortest signed delta from a to b on the unit circle. */
function angleDelta(a: number, b: number, ccw: boolean): number {
  let d = (b - a) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return ccw ? d : d - Math.PI * 2;
}

/** Signed sweep of an arc in radians; negative runs clockwise from start to end. */
export function arcSpan(arc: ArcGeom): number {
  return angleDelta(arc.startAngle, arc.endAngle, arc.ccw);
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
  const ccwToMid = wrapClockwise(midAngle - startAngle);
  const ccwToEnd = wrapClockwise(endAngle - startAngle);
  const ccw = ccwToMid <= ccwToEnd + 1e-9;
  return { center, radius, startAngle, endAngle, ccw };
}

/** Angle wrapped into [0, 2π). */
function wrapClockwise(angle: number): number {
  let d = angle % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return d;
}

/** Samples the arc so chord deviation stays under the tolerance, at 8 points minimum. */
export function adaptiveSampleArc(arc: ArcGeom, tolerance = 0.02): Vec2[] {
  const span = Math.abs(arcSpan(arc));
  const steps = Math.max(8, Math.ceil(span / Math.acos(Math.max(0, 1 - tolerance / arc.radius))));
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) pts.push(evalArc(arc, i / steps));
  return pts;
}
