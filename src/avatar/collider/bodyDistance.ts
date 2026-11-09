import type { AvatarCollider, Capsule } from '@/avatar/collider/types';
import { sampleMeshCollider } from '@/avatar/collider/meshCollider';
import { closestPointOnSegment3, pointSegmentDistance3 } from '@/base/geom';

/** Scratch closest point of the capsule axis; the CPU pass calls it per particle. */
const closestOut = new Float64Array(3);

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
  closestPointOnSegment3(
    px, py, pz, c.ax, c.ay, c.az, c.bx, c.by, c.bz, closestOut,
  );
  const ox = px - closestOut[0];
  const oz = pz - closestOut[2];
  if (rz === rx || Math.hypot(ox, oz) < 1e-6) return rx;
  const t = Math.atan2(oz, ox);
  const cz = Math.cos(t) * rz;
  const sz = Math.sin(t) * rx;
  return (rx * rz) / Math.hypot(cz, sz);
}

function pointToCapsuleDist(px: number, py: number, pz: number, c: Capsule): number {
  return pointSegmentDistance3(px, py, pz, c.ax, c.ay, c.az, c.bx, c.by, c.bz, closestOut);
}
