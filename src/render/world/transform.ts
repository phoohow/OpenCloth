/** Transform helpers the world uses for bounds and picking, independent of three. */

import type { Vec3 } from '@/base/geom';
import type { Bounds, Transform } from '@/render/world/types';

/** Transform with no offset, rotation or scale. */
export const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotationEuler: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

/** Copy of a transform, so callers can keep mutating their own record. */
export function cloneTransform(transform: Transform): Transform {
  return {
    position: { ...transform.position },
    rotationEuler: { ...transform.rotationEuler },
    scale: { ...transform.scale },
  };
}

/**
 * Column-major matrix of a transform, matching three's Euler XYZ composition.
 * Kept here so bounds and raycasts agree with the backend realization.
 */
export function transformMatrix(transform: Transform): number[] {
  const { position, rotationEuler: euler, scale } = transform;
  const c1 = Math.cos(euler.x);
  const s1 = Math.sin(euler.x);
  const c2 = Math.cos(euler.y);
  const s2 = Math.sin(euler.y);
  const c3 = Math.cos(euler.z);
  const s3 = Math.sin(euler.z);
  const { x: sx, y: sy, z: sz } = scale;
  return [
    c2 * c3 * sx, (c1 * s3 + s1 * s2 * c3) * sx, (s1 * s3 - c1 * s2 * c3) * sx, 0,
    -c2 * s3 * sy, (c1 * c3 - s1 * s2 * s3) * sy, (s1 * c3 + c1 * s2 * s3) * sy, 0,
    s2 * sz, -s1 * c2 * sz, c1 * c2 * sz, 0,
    position.x, position.y, position.z, 1,
  ];
}

/** Applies a transform to a point. */
export function transformPoint(point: Vec3, transform: Transform): Vec3 {
  const m = transformMatrix(transform);
  return {
    x: m[0]! * point.x + m[4]! * point.y + m[8]! * point.z + m[12]!,
    y: m[1]! * point.x + m[5]! * point.y + m[9]! * point.z + m[13]!,
    z: m[2]! * point.x + m[6]! * point.y + m[10]! * point.z + m[14]!,
  };
}

/** Axis-aligned bounds of a transformed box. */
export function transformBounds(bounds: Bounds, transform: Transform): Bounds {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < 8; i++) {
    const corner = transformPoint({
      x: i & 1 ? bounds.max.x : bounds.min.x,
      y: i & 2 ? bounds.max.y : bounds.min.y,
      z: i & 4 ? bounds.max.z : bounds.min.z,
    }, transform);
    min.x = Math.min(min.x, corner.x);
    min.y = Math.min(min.y, corner.y);
    min.z = Math.min(min.z, corner.z);
    max.x = Math.max(max.x, corner.x);
    max.y = Math.max(max.y, corner.y);
    max.z = Math.max(max.z, corner.z);
  }
  return { min, max };
}
