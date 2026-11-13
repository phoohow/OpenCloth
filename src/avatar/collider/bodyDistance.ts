import type { AvatarCollider } from '@/avatar/collider/types';
import { sampleMeshCollider } from '@/avatar/collider/meshCollider';

/** CPU-side signed distance to the body surface; negative inside the body. */
export function evalBodyDistance(collider: AvatarCollider, px: number, py: number, pz: number): number {
  return sampleMeshCollider(collider.mesh, px, py, pz);
}
