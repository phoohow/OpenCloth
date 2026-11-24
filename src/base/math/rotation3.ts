import type { Vec3Tuple } from '@/base/math/tuple3';

export type Quaternion = readonly [x: number, y: number, z: number, w: number];

export function normalizeQuaternion(q: Quaternion): Quaternion {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (length < 1e-12) return [0, 0, 0, 1];
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

export function quaternionFromUnitVectors(from: Vec3Tuple, to: Vec3Tuple): Quaternion {
  const r = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + 1;
  if (r < 1e-6) {
    const axis: Vec3Tuple = Math.abs(from[0]) > Math.abs(from[2])
      ? [-from[1], from[0], 0]
      : [0, -from[2], from[1]];
    return normalizeQuaternion([axis[0], axis[1], axis[2], 0]);
  }

  return normalizeQuaternion([
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
    r,
  ]);
}

export function rotateAxis3Tuple(v: Vec3Tuple, axis: Vec3Tuple, angle: number): [number, number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const axial = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
  const cross: Vec3Tuple = [
    axis[1] * v[2] - axis[2] * v[1],
    axis[2] * v[0] - axis[0] * v[2],
    axis[0] * v[1] - axis[1] * v[0],
  ];
  return [
    v[0] * cos + cross[0] * sin + axis[0] * axial * (1 - cos),
    v[1] * cos + cross[1] * sin + axis[1] * axial * (1 - cos),
    v[2] * cos + cross[2] * sin + axis[2] * axial * (1 - cos),
  ];
}

export function rotateEuler3(v: Vec3Tuple, euler: Vec3Tuple): [number, number, number] {
  const cx = Math.cos(euler[0]), sx = Math.sin(euler[0]);
  const cy = Math.cos(euler[1]), sy = Math.sin(euler[1]);
  const cz = Math.cos(euler[2]), sz = Math.sin(euler[2]);
  const m00 = cy * cz, m01 = -cy * sz, m02 = sy;
  const m10 = cx * sz + sx * sy * cz, m11 = cx * cz - sx * sy * sz, m12 = -sx * cy;
  const m20 = sx * sz - cx * sy * cz, m21 = sx * cz + cx * sy * sz, m22 = cx * cy;
  return [
    m00 * v[0] + m01 * v[1] + m02 * v[2],
    m10 * v[0] + m11 * v[1] + m12 * v[2],
    m20 * v[0] + m21 * v[1] + m22 * v[2],
  ];
}

export function rotateQuaternion3(v: Vec3Tuple, q: Quaternion): [number, number, number] {
  const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
  const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
  const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
  return [
    v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
    v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
    v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
  ];
}
