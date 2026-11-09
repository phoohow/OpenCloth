/** 3D vector algebra over world-space points, in meters. */

/** Point in world coordinates, in meters. */
export interface Vec3 { x: number; y: number; z: number; }

/** Creates a 3D point. */
export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Sum of two vectors. */
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

/** Difference of two vectors. */
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

/** Vector multiplied by a scalar. */
export const scale3 = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });

/** Dot product. */
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Cross product, right-handed. */
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** Euclidean length. */
export const length3 = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);

/** Length of a 3D vector given by its components. */
export const hypot3 = (dx: number, dy: number, dz: number): number => Math.hypot(dx, dy, dz);

/** Distance between two points. */
export const distance3 = (a: Vec3, b: Vec3): number => length3(sub3(a, b));

/** Zero vector. */
export const ZERO3: Vec3 = { x: 0, y: 0, z: 0 };

/** Unit basis vectors. */
export const AXIS_X: Vec3 = { x: 1, y: 0, z: 0 };
export const AXIS_Y: Vec3 = { x: 0, y: 1, z: 0 };
export const AXIS_Z: Vec3 = { x: 0, y: 0, z: 1 };

/** Unit vector, or null for a zero-length input. */
export function normalize3(v: Vec3): Vec3 | null {
  const size = length3(v);
  return size > 1e-9 ? scale3(v, 1 / size) : null;
}

/** One component by index: 0 → x, 1 → y, 2 → z. */
export function component3(v: Vec3, index: number): number {
  return index === 0 ? v.x : index === 1 ? v.y : v.z;
}

/** Component-wise interpolation between two vectors. */
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/** Rotates a vector about a unit axis by `angle` radians (Rodrigues' formula). */
export function rotateAxis3(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const axial = dot3(v, axis);
  const cross = cross3(axis, v);
  return {
    x: v.x * cos + cross.x * sin + axis.x * axial * (1 - cos),
    y: v.y * cos + cross.y * sin + axis.y * axial * (1 - cos),
    z: v.z * cos + cross.z * sin + axis.z * axial * (1 - cos),
  };
}
