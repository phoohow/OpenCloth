import type { MeshCollider } from '@/avatar/collider/meshCollider';

/** Body cross-section approximated by a line segment with elliptical half widths. */
export interface Capsule {
  /** Segment start */
  ax: number; ay: number; az: number;
  /** Segment end */
  bx: number; by: number; bz: number;
  /** Cross-section half width (x) */
  radius: number;
  /** Cross-section half depth (z); falls back to `radius` when unset. */
  radiusZ?: number;
}

/**
 * Body collision proxy: the capsule approximation plus, when the body mesh is available,
 * the exact triangle grid that takes precedence over it.
 */
export interface AvatarCollider {
  capsules: Capsule[];
  /** Bounding box for fast rejection */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Exact collider built from the body mesh; the capsules are not used when it is present. */
  mesh?: MeshCollider | null;
}
