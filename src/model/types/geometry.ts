/**
 * Points, curves and transforms in the two spaces the model uses: pattern-plane
 * centimetres (Vec2) and world metres (Vec3).
 */

import type { Vec3 } from '@/base/geom';

/** Core data model types shared by the pattern editor, simulation, and serialization. */


export type { Vec2, Vec3, ArcGeom } from '@/base/geom';
export { vec2, vec3 } from '@/base/geom';

/** Point where a curve leaves or reaches a pattern point, in absolute pattern coordinates. */
export interface BezierHandle {
  x: number;
  y: number;
  /** False when the opposite handle stays independent while dragging. */
  mirrored?: boolean;
}

/** Where an object sits in the 3D scene: meters, radians (XYZ order) and per-axis scale. */
export interface ObjectTransform {
  position: Vec3;
  rotationEuler: Vec3;
  scale: Vec3;
}
