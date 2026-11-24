import { cross3t, dot3t, normalize3t, scale3t, sub3t, type Vec3Tuple } from '@/base/math';

export interface TubeFrame {
  u: Vec3Tuple;
  v: Vec3Tuple;
}

export function frameRef(axis: Vec3Tuple): Vec3Tuple {
  return Math.abs(axis[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
}

export function tubeFrame(axis: Vec3Tuple, ref: Vec3Tuple = frameRef(axis)): TubeFrame {
  const u = normalize3t(sub3t(ref, scale3t(axis, dot3t(axis, ref))));
  return { u, v: normalize3t(cross3t(axis, u)) };
}

export function advanceFrame(frame: TubeFrame, tangent: Vec3Tuple): TubeFrame {
  const along = dot3t(tangent, frame.u);
  const u = normalize3t(sub3t(frame.u, scale3t(tangent, along)));
  return { u, v: normalize3t(cross3t(tangent, u)) };
}
