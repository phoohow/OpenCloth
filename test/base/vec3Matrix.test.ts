import { describe, expect, it } from 'vitest';
import {
  AXIS_X, AXIS_Y, AXIS_Z, ZERO3, add3, applyMatrix3, axisRotationMatrix3, axisScaleMatrix3,
  component3, cross3, decomposeMatrix3, distance3, dot3, eulerFromMatrix3, eulerScaleMatrix3,
  identityMatrix3, length3, multiplyMatrix3, normalize3, rotationAxes3, scale3, sub3, unit3,
  type Vec3,
} from '@/base/math';
import { intersectRayPlane3 } from '@/base/geom';

const ONE: Vec3 = { x: 1, y: 1, z: 1 };

function near(actual: number, expected: number, epsilon = 1e-6): void {
  expect(Math.abs(actual - expected)).toBeLessThan(epsilon);
}

function nearVec(actual: Vec3, expected: Vec3): void {
  near(actual.x, expected.x);
  near(actual.y, expected.y);
  near(actual.z, expected.z);
}

describe('base/geom Vec3', () => {
  it('adds, subtracts and scales vectors', () => {
    nearVec(add3({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }), { x: 5, y: 7, z: 9 });
    nearVec(sub3({ x: 4, y: 5, z: 6 }, { x: 1, y: 2, z: 3 }), { x: 3, y: 3, z: 3 });
    nearVec(scale3({ x: 1, y: -2, z: 3 }, 2), { x: 2, y: -4, z: 6 });
    expect(component3({ x: 1, y: 2, z: 3 }, 1)).toBe(2);
  });

  it('computes products, lengths and distances', () => {
    expect(dot3({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
    nearVec(cross3(AXIS_X, AXIS_Y), AXIS_Z);
    near(length3({ x: 3, y: 4, z: 0 }), 5);
    near(distance3({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 2 }), 3);
  });

  it('normalizes non-zero vectors and falls back on zero ones', () => {
    nearVec(normalize3({ x: 0, y: 3, z: 4 }), { x: 0, y: 0.6, z: 0.8 });
    nearVec(normalize3({ x: 0, y: 0, z: 0 }), ZERO3);
    nearVec(normalize3({ x: 0, y: 0, z: 0 }, AXIS_Y), AXIS_Y);
    expect(unit3({ x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('base/math matrix3', () => {
  it('round-trips an XYZ Euler rotation through its matrix', () => {
    const euler = { x: 0.3, y: -0.7, z: 1.1 };
    nearVec(eulerFromMatrix3(eulerScaleMatrix3(euler, ONE)), euler);
  });

  it('a quarter turn about Z maps local X onto world Y', () => {
    const rotation = axisRotationMatrix3(AXIS_Z, Math.PI / 2);
    nearVec(applyMatrix3(rotation, AXIS_X), AXIS_Y);
  });

  it('multiplies column-major matrices', () => {
    const rotation = axisRotationMatrix3(AXIS_Z, Math.PI / 2);
    nearVec(applyMatrix3(multiplyMatrix3(rotation, identityMatrix3()), AXIS_X), AXIS_Y);
  });

  it('scales along orthonormal local axes', () => {
    const euler = { x: 0, y: 0, z: Math.PI / 4 };
    const axes = rotationAxes3(euler);
    const scaled = axisScaleMatrix3(axes, { x: 2, y: 1, z: 1 });
    nearVec(applyMatrix3(scaled, axes[0]), scale3(axes[0], 2));
    nearVec(applyMatrix3(scaled, axes[1]), axes[1]);
  });

  it('decomposes a rotation-scale matrix', () => {
    const euler = { x: 0.2, y: -0.4, z: 0.8 };
    const matrix = eulerScaleMatrix3(euler, { x: 2, y: 3, z: 4 });
    const { rotation, scale } = decomposeMatrix3(matrix);
    nearVec(scale, { x: 2, y: 3, z: 4 });
    nearVec(eulerFromMatrix3(rotation), euler);
  });

  it('intersects a ray with a plane', () => {
    nearVec(intersectRayPlane3(
      { x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: 0 }, AXIS_Z,
    )!, { x: 0, y: 0, z: 0 });
    expect(intersectRayPlane3(
      { x: 0, y: 0, z: 3 }, AXIS_X,
      { x: 0, y: 0, z: 0 }, AXIS_Z,
    )).toBeNull();
  });
});
