/** Column-major 3x3 matrices for XYZ Euler rotations and per-axis scales. */

import {
  AXIS_X, AXIS_Y, component3, cross3, dot3, length3, normalize3, scale3, sub3, type Vec3,
} from '@/base/math/vec3';

/** Column-major 3x3 matrix; element `col * 3 + row`. */
export type Matrix3 = number[];

/** A matrix that leaves vectors unchanged. */
export function identityMatrix3(): Matrix3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

/** Rotation-scale matrix of an XYZ Euler rotation followed by a per-axis scale. */
export function eulerScaleMatrix3(euler: Vec3, scale: Vec3): Matrix3 {
  const c1 = Math.cos(euler.x), s1 = Math.sin(euler.x);
  const c2 = Math.cos(euler.y), s2 = Math.sin(euler.y);
  const c3 = Math.cos(euler.z), s3 = Math.sin(euler.z);
  return [
    c2 * c3 * scale.x, (c1 * s3 + s1 * s2 * c3) * scale.x, (s1 * s3 - c1 * s2 * c3) * scale.x,
    -c2 * s3 * scale.y, (c1 * c3 - s1 * s2 * s3) * scale.y, (s1 * c3 + c1 * s2 * s3) * scale.y,
    s2 * scale.z, -s1 * c2 * scale.z, c1 * c2 * scale.z,
  ];
}

/** Product of two column-major matrices. */
export function multiplyMatrix3(a: Matrix3, b: Matrix3): Matrix3 {
  const out: Matrix3 = new Array<number>(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] = a[row]! * b[col * 3]!
        + a[3 + row]! * b[col * 3 + 1]!
        + a[6 + row]! * b[col * 3 + 2]!;
    }
  }
  return out;
}

/** Right-handed rotation of `angle` radians about a unit axis (Rodrigues). */
export function axisRotationMatrix3(axis: Vec3, angle: number): Matrix3 {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const { x, y, z } = axis;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c,
  ];
}

/** World matrix scaling along three orthonormal local axes. */
export function axisScaleMatrix3(axes: readonly Vec3[], factors: Vec3): Matrix3 {
  const f = [factors.x, factors.y, factors.z];
  const out: Matrix3 = new Array<number>(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      let value = 0;
      for (let k = 0; k < 3; k++) {
        value += f[k]! * component3(axes[k]!, col) * component3(axes[k]!, row);
      }
      out[col * 3 + row] = value;
    }
  }
  return out;
}

/** Applies a linear matrix to a vector. */
export function applyMatrix3(m: Matrix3, v: Vec3): Vec3 {
  return {
    x: m[0]! * v.x + m[3]! * v.y + m[6]! * v.z,
    y: m[1]! * v.x + m[4]! * v.y + m[7]! * v.z,
    z: m[2]! * v.x + m[5]! * v.y + m[8]! * v.z,
  };
}

/** XYZ Euler angles of a rotation matrix, matching three's Euler order. */
export function eulerFromMatrix3(m: Matrix3): Vec3 {
  const m13 = m[6]!;
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) {
    return { x: Math.atan2(-m[7]!, m[8]!), y, z: Math.atan2(-m[3]!, m[0]!) };
  }
  return { x: Math.atan2(m[5]!, m[4]!), y, z: 0 };
}

/**
 * Splits a rotation-scale matrix into an orthogonal rotation and per-axis scales.
 * Sheared columns are orthonormalized by Gram-Schmidt so the rotation stays usable.
 */
export function decomposeMatrix3(m: Matrix3): { rotation: Matrix3; scale: Vec3 } {
  const columns: Vec3[] = [
    { x: m[0]!, y: m[1]!, z: m[2]! },
    { x: m[3]!, y: m[4]!, z: m[5]! },
    { x: m[6]!, y: m[7]!, z: m[8]! },
  ];
  const scale = {
    x: Math.max(1e-4, length3(columns[0]!)),
    y: Math.max(1e-4, length3(columns[1]!)),
    z: Math.max(1e-4, length3(columns[2]!)),
  };
  const x = normalize3(columns[0]!) ?? AXIS_X;
  const yRaw = sub3(columns[1]!, scale3(x, dot3(x, columns[1]!)));
  const y = normalize3(yRaw) ?? AXIS_Y;
  const z = cross3(x, y);
  return {
    rotation: [x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z],
    scale,
  };
}

/** Local X/Y/Z world directions of an XYZ Euler rotation; the matrix columns. */
export function rotationAxes3(euler: Vec3): [Vec3, Vec3, Vec3] {
  const m = eulerScaleMatrix3(euler, { x: 1, y: 1, z: 1 });
  return [
    { x: m[0]!, y: m[1]!, z: m[2]! },
    { x: m[3]!, y: m[4]!, z: m[5]! },
    { x: m[6]!, y: m[7]!, z: m[8]! },
  ];
}
