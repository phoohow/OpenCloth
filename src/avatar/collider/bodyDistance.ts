import type { AvatarCollider, Capsule } from './avatarCollider';
import { sampleMeshCollider } from './meshCollider';

/** CPU-side signed distance to the body surface; negative inside the body. */
export function evalBodyDistance(collider: AvatarCollider, px: number, py: number, pz: number): number {
  if (collider.mesh) return sampleMeshCollider(collider.mesh, px, py, pz);
  let minDist = Infinity;
  for (const c of collider.capsules) {
    const d = pointToCapsuleDist(px, py, pz, c) - ellipseRadiusAt(c, px, py, pz);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/** Cross-section half radius along the direction from the capsule axis to a point. */
function ellipseRadiusAt(c: Capsule, px: number, py: number, pz: number): number {
  const rx = c.radius;
  const rz = c.radiusZ ?? rx;
  const closest = closestPointOnSegment(px, py, pz, c.ax, c.ay, c.az, c.bx, c.by, c.bz);
  const ox = px - closest[0];
  const oz = pz - closest[2];
  if (rz === rx || Math.hypot(ox, oz) < 1e-6) return rx;
  const t = Math.atan2(oz, ox);
  const cz = Math.cos(t) * rz;
  const sz = Math.sin(t) * rx;
  return (rx * rz) / Math.hypot(cz, sz);
}

function pointToCapsuleDist(px: number, py: number, pz: number, c: Capsule): number {
  const closest = closestPointOnSegment(px, py, pz, c.ax, c.ay, c.az, c.bx, c.by, c.bz);
  return Math.hypot(px - closest[0], py - closest[1], pz - closest[2]);
}

function closestPointOnSegment(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): [number, number, number] {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const abLen2 = abx * abx + aby * aby + abz * abz;
  let t = abLen2 > 0 ? (apx * abx + apy * aby + apz * abz) / abLen2 : 0;
  t = Math.max(0, Math.min(1, t));
  return [ax + abx * t, ay + aby * t, az + abz * t];
}
