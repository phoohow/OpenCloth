/** Pure camera-space projection shared by picking, overlays and viewport widgets. */

import type { Vec3 } from '@/base/math';
import { cross3, dot3, normalize3, scale3, sub3 } from '@/base/math';
import type { CameraState } from '@/render/common/types';

/** Orthonormal axes of a camera view, in world space. */
export interface ViewBasis {
  /** Unit direction the camera looks along. */
  forward: Vec3;
  /** Unit screen-right direction. */
  right: Vec3;
  /** Unit screen-up direction. */
  up: Vec3;
  /** Unit direction from the target toward the camera. */
  back: Vec3;
}

/** Screen position in CSS pixels, Y down, plus the point's distance along the view. */
export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
}

/** Orthonormal view axes of a camera placement, or null for a degenerate view. */
export function cameraBasis(camera: Pick<CameraState, 'position' | 'target' | 'up'>): ViewBasis | null {
  const forward = normalize3(sub3(camera.target, camera.position));
  if (!forward) return null;
  const right = normalize3(cross3(forward, camera.up));
  if (!right) return null;
  return { forward, right, up: cross3(right, forward), back: scale3(forward, -1) };
}

/** Normalized device coordinates of a world point, Y up; null behind the near plane. */
export function projectWorldToNdc(point: Vec3, camera: CameraState, aspect = camera.aspect): Vec3 | null {
  const basis = cameraBasis(camera);
  if (!basis) return null;
  const rel = sub3(point, camera.position);
  const depth = dot3(rel, basis.forward);
  if (depth <= camera.near) return null;
  const x = dot3(rel, basis.right);
  const y = dot3(rel, basis.up);
  if (camera.projection === 'orthographic') {
    const halfHeight = Math.max(0.001, camera.viewHeightMeters) / 2;
    const halfWidth = halfHeight * Math.max(0.001, aspect);
    return { x: x / halfWidth, y: y / halfHeight, z: (depth - camera.near) / (camera.far - camera.near) };
  }
  const tanHalf = Math.tan(camera.fovDeg * Math.PI / 360);
  return {
    x: x / (depth * tanHalf * Math.max(0.001, aspect)),
    y: y / (depth * tanHalf),
    z: (depth - camera.near) / (camera.far - camera.near),
  };
}

/** CSS-pixel position of a world point inside a viewport of the given size. */
export function projectWorldToScreen(
  point: Vec3, camera: CameraState, width: number, height: number,
): ScreenPoint | null {
  const ndc = projectWorldToNdc(point, camera, width / Math.max(1, height));
  if (!ndc) return null;
  const basis = cameraBasis(camera);
  if (!basis) return null;
  return {
    x: (ndc.x + 1) * width / 2,
    y: (1 - ndc.y) * height / 2,
    depth: dot3(sub3(point, camera.position), basis.forward),
  };
}

/** World meters covered by one screen pixel at the depth of `point`. */
export function worldUnitsPerPixel(camera: CameraState, point: Vec3, height: number): number {
  const basis = cameraBasis(camera);
  const forward = basis?.forward ?? { x: 0, y: 0, z: -1 };
  const depth = Math.max(0.05, dot3(sub3(point, camera.position), forward));
  if (camera.projection === 'orthographic') {
    return Math.max(1e-5, Math.max(0.001, camera.viewHeightMeters) / Math.max(1, height));
  }
  const tanHalf = Math.tan(camera.fovDeg * Math.PI / 360);
  return Math.max(1e-5, 2 * tanHalf * depth / Math.max(1, height));
}
