import { describe, expect, it } from 'vitest';
import type { ObjectTransform } from '@/model/types';
import { axisRotationMatrix3, axisScaleMatrix3, rotationAxes3 } from '@/base/math';
import {
  composeTransforms, identityDelta, isIdentityDelta, transformPositions,
} from '@/runtime/gizmoMath';

const IDENTITY: ObjectTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotationEuler: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

function near(actual: number, expected: number, epsilon = 1e-6): void {
  expect(Math.abs(actual - expected)).toBeLessThan(epsilon);
}

function nearVec(actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }): void {
  near(actual.x, expected.x);
  near(actual.y, expected.y);
  near(actual.z, expected.z);
}

describe('gizmoMath', () => {
  it('composes a world rotation into Euler angles and keeps the scale', () => {
    const base: ObjectTransform = {
      position: { x: 0.2, y: 0, z: -0.1 },
      rotationEuler: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 3, z: 4 },
    };
    const delta = {
      linear: axisRotationMatrix3({ x: 0, y: 0, z: 1 }, Math.PI / 2),
      translation: { x: 0.5, y: 0, z: 0 },
    };
    const [next] = composeTransforms([base], delta);
    nearVec(next!.rotationEuler, { x: 0, y: 0, z: Math.PI / 2 });
    nearVec(next!.scale, base.scale);
    nearVec(next!.position, { x: 0.7, y: 0, z: -0.1 });
  });

  it('scales one local axis without changing the rotation', () => {
    const euler = { x: 0, y: 0, z: Math.PI / 4 };
    const base: ObjectTransform = {
      position: { x: 0, y: 0, z: 0 }, rotationEuler: euler, scale: { x: 2, y: 3, z: 4 },
    };
    const linear = axisScaleMatrix3(rotationAxes3(euler), { x: 2, y: 1, z: 1 });
    const [next] = composeTransforms([base], { linear, translation: { x: 0, y: 0, z: 0 } });
    nearVec(next!.scale, { x: 4, y: 3, z: 4 });
    nearVec(next!.rotationEuler, euler);
  });

  it('treats an identity delta as a no-op', () => {
    expect(isIdentityDelta(identityDelta())).toBe(true);
    const [next] = composeTransforms([IDENTITY], identityDelta());
    nearVec(next!.rotationEuler, { x: 0, y: 0, z: 0 });
    nearVec(next!.scale, { x: 1, y: 1, z: 1 });
  });

  it('transforms a panel slice about its own centre', () => {
    const positions = new Float32Array([1, 0, 0, 3, 0, 0, 10, 0, 0]);
    const axes = rotationAxes3({ x: 0, y: 0, z: 0 });
    const delta = {
      linear: axisScaleMatrix3(axes, { x: 2, y: 1, z: 1 }),
      translation: { x: 0.5, y: 0, z: 0 },
    };
    const out = transformPositions(positions, [{ start: 0, end: 2 }], [{ x: 2, y: 0, z: 0 }], delta);
    expect([...out]).toEqual([0.5, 0, 0, 4.5, 0, 0, 10, 0, 0]);
    expect([...positions]).toEqual([1, 0, 0, 3, 0, 0, 10, 0, 0]);
  });
});
