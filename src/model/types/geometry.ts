import type { Vec3 } from '@/base/math';

export type { ArcGeom } from '@/base/geom/arc';
export { vec2, vec3, type Vec2, type Vec3 } from '@/base/math';

export interface BezierHandle {
  x: number;
  y: number;
  mirrored?: boolean;
}

export interface ObjectTransform {
  position: Vec3;
  rotationEuler: Vec3;
  scale: Vec3;
}
