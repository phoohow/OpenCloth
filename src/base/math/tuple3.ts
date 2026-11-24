export type Vec3Tuple = readonly [number, number, number];

export const add3t = (a: Vec3Tuple, b: Vec3Tuple): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const sub3t = (a: Vec3Tuple, b: Vec3Tuple): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const scale3t = (v: Vec3Tuple, s: number): [number, number, number] => [v[0] * s, v[1] * s, v[2] * s];

export const lerp3t = (a: Vec3Tuple, b: Vec3Tuple, t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
];

export const midpoint3t = (a: Vec3Tuple, b: Vec3Tuple): [number, number, number] => [
  (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2,
];

export const dot3t = (a: Vec3Tuple, b: Vec3Tuple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross3t = (a: Vec3Tuple, b: Vec3Tuple): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const length3t = (v: Vec3Tuple): number => Math.hypot(v[0], v[1], v[2]);

export const distance3t = (a: Vec3Tuple, b: Vec3Tuple): number => length3t(sub3t(a, b));

export function unit3t(v: Vec3Tuple, tolerance = 1e-12): [number, number, number] | null {
  const length = length3t(v);
  return length > tolerance ? scale3t(v, 1 / length) : null;
}

export function normalize3t(v: Vec3Tuple): [number, number, number] {
  return unit3t(v) ?? [0, 0, 0];
}
