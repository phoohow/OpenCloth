import type { MeshCollider } from '@/avatar/collider/meshCollider';

/**
 * Body collision proxy: the exact triangle grid of the body surface.
 */
export interface AvatarCollider {
  /** Triangle grid of the body surface. */
  mesh: MeshCollider;
}
