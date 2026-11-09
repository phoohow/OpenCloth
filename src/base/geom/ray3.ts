/** Ray intersections and ray-to-point distance in world space. */

import { add3, cross3, dot3, length3, scale3, sub3, type Vec3 } from '@/base/math/vec3';

/** Point where a ray crosses a plane, or null when they are parallel. */
export function intersectRayPlane3(
  origin: Vec3, direction: Vec3, planePoint: Vec3, normal: Vec3,
): Vec3 | null {
  const denominator = dot3(direction, normal);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = dot3(sub3(planePoint, origin), normal) / denominator;
  if (!Number.isFinite(t)) return null;
  return add3(origin, scale3(direction, t));
}

/** Intersection of a ray with one triangle; `u` weights p1 and `v` weights p2. */
export interface RayTriangleHit {
  distance: number;
  u: number;
  v: number;
}

/**
 * Moller-Trumbore ray-triangle intersection. `detEpsilon` rejects grazing rays and
 * `minDistance` rejects hits at the ray origin.
 */
export function intersectRayTriangle3(
  origin: Vec3,
  direction: Vec3,
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  detEpsilon = 1e-9,
  minDistance = 1e-6,
): RayTriangleHit | null {
  const edge1 = sub3(p1, p0);
  const edge2 = sub3(p2, p0);
  const h = cross3(direction, edge2);
  const determinant = dot3(edge1, h);
  if (Math.abs(determinant) < detEpsilon) return null;
  const inverse = 1 / determinant;
  const s = sub3(origin, p0);
  const u = dot3(s, h) * inverse;
  if (u < 0 || u > 1) return null;
  const q = cross3(s, edge1);
  const v = dot3(direction, q) * inverse;
  if (v < 0 || u + v > 1) return null;
  const distance = dot3(edge2, q) * inverse;
  return distance > minDistance ? { distance, u, v } : null;
}

/**
 * Perpendicular distance from a point to a ray; Infinity when the projection falls behind
 * the origin or the direction is zero.
 */
export function pointRayDistance3(point: Vec3, origin: Vec3, direction: Vec3): number {
  const size = length3(direction);
  if (size === 0) return Infinity;
  const unit = scale3(direction, 1 / size);
  const offset = sub3(point, origin);
  if (dot3(offset, unit) <= 0) return Infinity;
  return length3(cross3(offset, unit));
}
