import * as THREE from 'three/webgpu';

/** Named view the camera can jump to; the camera sits on the direction ray, looking at the scene. */
export type CameraPreset =
  | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
  | 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight';

/** View direction and up vector of one preset. */
export interface ViewFrame {
  /** Direction from the scene centre to the camera. */
  direction: THREE.Vector3;
  /** World up vector the camera is rolled against. */
  up: THREE.Vector3;
}

const SQRT_HALF = Math.SQRT1_2;

/** Axis-aligned view frames: four sides, top and bottom, then four 45-degree corners. */
export const CAMERA_VIEW_FRAMES: Record<CameraPreset, ViewFrame> = {
  front: { direction: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  back: { direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  left: { direction: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  right: { direction: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  top: { direction: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
  bottom: { direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
  frontLeft: { direction: new THREE.Vector3(-SQRT_HALF, 0, SQRT_HALF), up: new THREE.Vector3(0, 1, 0) },
  frontRight: { direction: new THREE.Vector3(SQRT_HALF, 0, SQRT_HALF), up: new THREE.Vector3(0, 1, 0) },
  backLeft: { direction: new THREE.Vector3(-SQRT_HALF, 0, -SQRT_HALF), up: new THREE.Vector3(0, 1, 0) },
  backRight: { direction: new THREE.Vector3(SQRT_HALF, 0, -SQRT_HALF), up: new THREE.Vector3(0, 1, 0) },
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
  /** Camera position, `distance` along the frame direction from the box centre. */
  distance: number;
  /** Orthographic frustum height in world units at zoom 1. */
  viewHeight: number;
}

/** Right, up and backward axes of the view frame. */
function viewAxes(frame: ViewFrame): { right: THREE.Vector3; up: THREE.Vector3; back: THREE.Vector3 } {
  const eye = frame.direction.clone();
  const matrix = new THREE.Matrix4().lookAt(eye, new THREE.Vector3(0, 0, 0), frame.up);
  return {
    right: new THREE.Vector3().setFromMatrixColumn(matrix, 0),
    up: new THREE.Vector3().setFromMatrixColumn(matrix, 1),
    back: new THREE.Vector3().setFromMatrixColumn(matrix, 2),
  };
}

/** Measures a box along the view axes, so the framing only needs the projected extents. */
export function projectBox(box: THREE.Box3, frame: ViewFrame): ProjectedExtents {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const { right, up, back } = viewAxes(frame);
  const corner = new THREE.Vector3();
  let width = 0;
  let height = 0;
  let depth = 0;
  // Only the eight corners can be extreme on an axis-aligned box.
  for (let i = 0; i < 8; i++) {
    corner.set(
      center.x + ((i & 1) ? size.x / 2 : -size.x / 2),
      center.y + ((i & 2) ? size.y / 2 : -size.y / 2),
      center.z + ((i & 4) ? size.z / 2 : -size.z / 2),
    ).sub(center);
    width = Math.max(width, Math.abs(corner.dot(right)));
    height = Math.max(height, Math.abs(corner.dot(up)));
    depth = Math.max(depth, Math.abs(corner.dot(back)));
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
export function fitCameraToBox(box: THREE.Box3, frame: ViewFrame, fovDeg: number, aspect: number): CameraFit {
  const extents = projectBox(box, frame);
  return {
    distance: perspectiveFitDistance(extents, fovDeg, aspect),
    viewHeight: orthoFitViewHeight(extents, aspect),
  };
}
