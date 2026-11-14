/** Tuple-based vector algebra for allocation-light per-vertex work. */

/** Three-component vector stored as a tuple. */
export type Vec3Tuple = readonly [number, number, number];

/** Sum of two vectors. */
export const add3t = (a: Vec3Tuple, b: Vec3Tuple): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Difference of two vectors. */
export const sub3t = (a: Vec3Tuple, b: Vec3Tuple): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Vector multiplied by a scalar. */
export const scale3t = (v: Vec3Tuple, s: number): [number, number, number] => [v[0] * s, v[1] * s, v[2] * s];

/** Point between two points at fraction t. */
export const lerp3t = (a: Vec3Tuple, b: Vec3Tuple, t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
];

/** Dot product. */
export const dot3t = (a: Vec3Tuple, b: Vec3Tuple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Cross product, right-handed. */
export const cross3t = (a: Vec3Tuple, b: Vec3Tuple): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Euclidean length. */
export const length3t = (v: Vec3Tuple): number => Math.hypot(v[0], v[1], v[2]);

/** Distance between two points. */
export const distance3t = (a: Vec3Tuple, b: Vec3Tuple): number => length3t(sub3t(a, b));

/** Unit vector; a zero-length input keeps the zero vector. */
export function normalize3t(v: Vec3Tuple): [number, number, number] {
  const length = length3t(v);
  return length > 1e-12 ? scale3t(v, 1 / length) : [0, 0, 0];
}
