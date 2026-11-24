import type { AvatarCollider } from '@/avatar/collider/types';

import { sampleMeshCollider } from '@/avatar/collider/meshCollider';

export function evalBodyDistance(collider: AvatarCollider, px: number, py: number, pz: number): number {
  return sampleMeshCollider(collider.mesh, px, py, pz);
}
