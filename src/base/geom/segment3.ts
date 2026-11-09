/** Projection and distance of a point against a 3D segment. */

/** Closest point on segment `a → b` to `p`, written into `out`. */
export function closestPointOnSegment3(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  out: Float64Array,
): void {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const lengthSquared = abx * abx + aby * aby + abz * abz;
  const t = lengthSquared > 0
    ? Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / lengthSquared))
    : 0;
  out[0] = ax + abx * t;
  out[1] = ay + aby * t;
  out[2] = az + abz * t;
}

/** Shortest distance from a point to a 3D segment. */
export function pointSegmentDistance3(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  out: Float64Array,
): number {
  closestPointOnSegment3(px, py, pz, ax, ay, az, bx, by, bz, out);
  return Math.hypot(px - out[0], py - out[1], pz - out[2]);
}
