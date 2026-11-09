/** Camera presets and pure box framing, independent of three. */

import type { Vec3 } from '@/base/geom';
import type { Bounds } from '@/render/common';

/** Named view the camera can jump to; the camera sits on the direction ray, looking at the scene. */
export type CameraPreset =
  | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
  | 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight';

/** View direction and up vector of one preset. */
export interface ViewFrame {
  direction: Vec3;
  up: Vec3;
}

const SQRT_HALF = Math.SQRT1_2;
const UP = { x: 0, y: 1, z: 0 };

/** Axis-aligned view frames: four sides, top and bottom, then four 45-degree corners. */
export const CAMERA_VIEW_FRAMES: Record<CameraPreset, ViewFrame> = {
  front: { direction: { x: 0, y: 0, z: 1 }, up: UP },
  back: { direction: { x: 0, y: 0, z: -1 }, up: UP },
  left: { direction: { x: -1, y: 0, z: 0 }, up: UP },
  right: { direction: { x: 1, y: 0, z: 0 }, up: UP },
  top: { direction: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: -1 } },
  bottom: { direction: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  frontLeft: { direction: { x: -SQRT_HALF, y: 0, z: SQRT_HALF }, up: UP },
  frontRight: { direction: { x: SQRT_HALF, y: 0, z: SQRT_HALF }, up: UP },
  backLeft: { direction: { x: -SQRT_HALF, y: 0, z: -SQRT_HALF }, up: UP },
  backRight: { direction: { x: SQRT_HALF, y: 0, z: -SQRT_HALF }, up: UP },
};

/** Extra room left around the framed box, as a multiplier of the exact fit. */
export const FIT_MARGIN = 1.08;

/** Half-extents of a box measured on the view axes; `depth` runs along the view direction. */
export interface ProjectedExtents {
  width: number;
  height: number;
  depth: number;
}

/** World-space placement that frames a box from one view direction. */
export interface CameraFit {
  distance: number;
  viewHeight: number;
}

/** Right, up and backward axes of the view frame. */
function viewAxes(frame: ViewFrame): { right: Vec3; up: Vec3; back: Vec3 } {
  const back = normalize(frame.direction) ?? { x: 0, y: 0, z: 1 };
  const right = normalize(cross(frame.up, back)) ?? { x: 1, y: 0, z: 0 };
  const up = normalize(cross(back, right)) ?? { x: 0, y: 1, z: 0 };
  return { right, up, back };
}

/** Measures a box along the view axes, so the framing only needs the projected extents. */
export function projectBox(box: Bounds, frame: ViewFrame): ProjectedExtents {
  const half = {
    x: (box.max.x - box.min.x) / 2,
    y: (box.max.y - box.min.y) / 2,
    z: (box.max.z - box.min.z) / 2,
  };
  const { right, up, back } = viewAxes(frame);
  let width = 0;
  let height = 0;
  let depth = 0;
  for (let i = 0; i < 8; i++) {
    const corner = {
      x: i & 1 ? half.x : -half.x,
      y: i & 2 ? half.y : -half.y,
      z: i & 4 ? half.z : -half.z,
    };
    width = Math.max(width, Math.abs(dot(corner, right)));
    height = Math.max(height, Math.abs(dot(corner, up)));
    depth = Math.max(depth, Math.abs(dot(corner, back)));
  }
  return { width, height, depth };
}

/** Camera distance where the nearest box corner still fits the vertical and horizontal field. */
export function perspectiveFitDistance(
  extents: ProjectedExtents, fovDeg: number, aspect: number, margin = FIT_MARGIN,
): number {
  const vertical = Math.tan((fovDeg * Math.PI / 180) / 2);
  const horizontal = vertical * Math.max(0.01, aspect);
  const fitted = Math.max(extents.height / vertical, extents.width / horizontal);
  return Math.max(0.1, (fitted + extents.depth) * margin);
}

/** Orthographic frustum height covering the box, widened when the aspect makes it too narrow. */
export function orthoFitViewHeight(extents: ProjectedExtents, aspect: number, margin = FIT_MARGIN): number {
  const width = extents.width * 2;
  const height = extents.height * 2;
  return Math.max(0.1, Math.max(height, width / Math.max(0.01, aspect)) * margin);
}

/** Distance and orthographic height that frame the box for the viewport's current aspect. */
export function fitCameraToBox(box: Bounds, frame: ViewFrame, fovDeg: number, aspect: number): CameraFit {
  const extents = projectBox(box, frame);
  return {
    distance: perspectiveFitDistance(extents, fovDeg, aspect),
    viewHeight: orthoFitViewHeight(extents, aspect),
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v: Vec3): Vec3 | null {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > 1e-9 ? { x: v.x / length, y: v.y / length, z: v.z / length } : null;
}
