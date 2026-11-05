/**
 * Points, curves and transforms in the two spaces the model uses: pattern-plane
 * centimetres (Vec2) and world metres (Vec3).
 */

/** Core data model types shared by the pattern editor, simulation, and serialization. */

// ============ Geometry primitives ============

/** Point in pattern-plane coordinates, in centimeters. */
export interface Vec2 { x: number; y: number; }

/** Point in world coordinates, in meters. */
export interface Vec3 { x: number; y: number; z: number; }
export const vec2 = (x: number, y: number): Vec2 => ({ x, y });
export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Point where a curve leaves or reaches a pattern point, in absolute pattern coordinates. */
export interface BezierHandle {
  x: number;
  y: number;
  /** False when the opposite handle stays independent while dragging. */
  mirrored?: boolean;
}

/** Circular arc between the edge endpoints, sampled at the bezier tolerance. */
export interface ArcGeom {
  center: Vec2;
  radius: number;
  /** Start and end angle in radians, measured at the center. */
  startAngle: number;
  endAngle: number;
  /** True sweeps counter-clockwise from start to end. */
  ccw: boolean;
}

/** Where an object sits in the 3D scene: meters, radians (XYZ order) and per-axis scale. */
export interface ObjectTransform {
  position: Vec3;
  rotationEuler: Vec3;
  scale: Vec3;
}
