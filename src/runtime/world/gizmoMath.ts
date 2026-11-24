import type { ObjectTransform, Vec3 } from '@/model/types';

import {
  add3, applyMatrix3, decomposeMatrix3, eulerFromMatrix3, eulerScaleMatrix3, identityMatrix3,
  multiplyMatrix3, type Matrix3,
} from '@/base/math';

export interface GizmoDelta {
  linear: Matrix3;
  translation: Vec3;
}

export interface GizmoFrame {
  center: Vec3;
  radius: number;
  centers: Record<string, Vec3>;
}

export function identityDelta(): GizmoDelta {
  return { linear: identityMatrix3(), translation: { x: 0, y: 0, z: 0 } };
}

export function isIdentityDelta(delta: GizmoDelta): boolean {
  const identity = identityMatrix3();
  return delta.linear.every((value, i) => Math.abs(value - identity[i]!) < 1e-6)
    && Math.abs(delta.translation.x) < 1e-6
    && Math.abs(delta.translation.y) < 1e-6
    && Math.abs(delta.translation.z) < 1e-6;
}

export function composeTransforms(bases: readonly ObjectTransform[], delta: GizmoDelta): ObjectTransform[] {
  return bases.map(base => {
    const next = multiplyMatrix3(delta.linear, eulerScaleMatrix3(base.rotationEuler, base.scale));
    const { rotation, scale } = decomposeMatrix3(next);
    return {
      position: add3(base.position, delta.translation),
      rotationEuler: eulerFromMatrix3(rotation),
      scale,
    };
  });
}

export function transformPositions(
  positions: Float32Array,
  ranges: readonly { start: number; end: number }[],
  centers: readonly Vec3[],
  delta: GizmoDelta,
): Float32Array {
  const out = positions.slice();
  ranges.forEach((range, index) => {
    const center = centers[index];
    if (!center) return;
    for (let i = range.start; i < range.end && (i + 1) * 3 <= out.length; i++) {
      const offset = i * 3;
      const rel = {
        x: out[offset]! - center.x,
        y: out[offset + 1]! - center.y,
        z: out[offset + 2]! - center.z,
      };
      const moved = applyMatrix3(delta.linear, rel);
      out[offset] = moved.x + center.x + delta.translation.x;
      out[offset + 1] = moved.y + center.y + delta.translation.y;
      out[offset + 2] = moved.z + center.z + delta.translation.z;
    }
  });
  return out;
}
