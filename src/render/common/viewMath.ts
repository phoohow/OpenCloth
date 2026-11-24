import type { Vec3 } from '@/base/math';
import type { Bounds, CameraState } from '@/render/common/types';

import { AXIS_X, AXIS_Y, AXIS_Z, cross3, degToRad, dot3, normalize3, scale3, sub3, unit3 } from '@/base/math';

export const FIT_MARGIN = 0.95;

export interface ViewBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  back: Vec3;
}

export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
}

export interface CameraFit {
  distance: number;
  viewHeight: number;
}

export interface ProjectedExtents {
  width: number;
  height: number;
  depth: number;
}

export function cameraBasis(camera: Pick<CameraState, 'position' | 'target' | 'up'>): ViewBasis | null {
  const forward = unit3(sub3(camera.target, camera.position));
  if (!forward) return null;
  const right = unit3(cross3(forward, camera.up));
  if (!right) return null;
  return { forward, right, up: cross3(right, forward), back: scale3(forward, -1) };
}

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

export function projectBox(box: Bounds, direction: Vec3, up: Vec3): ProjectedExtents {
  const half = {
    x: (box.max.x - box.min.x) / 2,
    y: (box.max.y - box.min.y) / 2,
    z: (box.max.z - box.min.z) / 2,
  };
  const back = normalize3(direction, AXIS_Z);
  const right = normalize3(cross3(up, back), AXIS_X);
  const screenUp = normalize3(cross3(back, right), AXIS_Y);
  let width = 0;
  let height = 0;
  let depth = 0;
  for (let i = 0; i < 8; i++) {
    const corner = {
      x: i & 1 ? half.x : -half.x,
      y: i & 2 ? half.y : -half.y,
      z: i & 4 ? half.z : -half.z,
    };
    width = Math.max(width, Math.abs(dot3(corner, right)));
    height = Math.max(height, Math.abs(dot3(corner, screenUp)));
    depth = Math.max(depth, Math.abs(dot3(corner, back)));
  }

  return { width, height, depth };
}

export function perspectiveFitDistance(
  extents: ProjectedExtents, fovDeg: number, aspect: number, margin = FIT_MARGIN,
): number {
  const vertical = Math.tan(degToRad(fovDeg) / 2);
  const horizontal = vertical * Math.max(0.01, aspect);
  const fitted = Math.max(extents.height / vertical, extents.width / horizontal);
  return Math.max(0.1, (fitted + extents.depth) * margin);
}

export function orthoFitViewHeight(
  extents: ProjectedExtents, aspect: number, margin = FIT_MARGIN,
): number {
  const width = extents.width * 2;
  const height = extents.height * 2;
  return Math.max(0.1, Math.max(height, width / Math.max(0.01, aspect)) * margin);
}
