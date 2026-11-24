export const ZERO3: Vec3 = { x: 0, y: 0, z: 0 };

export const AXIS_X: Vec3 = { x: 1, y: 0, z: 0 };

export const AXIS_Y: Vec3 = { x: 0, y: 1, z: 0 };

export const AXIS_Z: Vec3 = { x: 0, y: 0, z: 1 };

export const AXIS_NEG_X: Vec3 = { x: -1, y: 0, z: 0 };

export const AXIS_NEG_Y: Vec3 = { x: 0, y: -1, z: 0 };

export const AXIS_NEG_Z: Vec3 = { x: 0, y: 0, z: -1 };

export interface Vec3 { x: number; y: number; z: number; }

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

export const scale3 = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });

export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const length3 = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);

export const distance3 = (a: Vec3, b: Vec3): number => length3(sub3(a, b));

export function unit3(v: Vec3, tolerance = 1e-9): Vec3 | null {
  const size = length3(v);
  return size > tolerance ? scale3(v, 1 / size) : null;
}

export function normalize3(v: Vec3, fallback: Vec3 = ZERO3): Vec3 {
  return unit3(v) ?? fallback;
}

export function component3(v: Vec3, index: number): number {
  return index === 0 ? v.x : index === 1 ? v.y : v.z;
}

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
