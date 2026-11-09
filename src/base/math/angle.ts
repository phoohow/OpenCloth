/** Angle conversion, wrapping and direction comparisons. */

import { cross2, dot2, type Vec2 } from '@/base/math/vec2';

/** One full turn in radians. */
export const TAU = Math.PI * 2;

export const degToRad = (deg: number): number => deg * Math.PI / 180;
export const radToDeg = (rad: number): number => rad * 180 / Math.PI;

/** Wraps an angle into [0, 2π). */
export function wrapAngle(angle: number): number {
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/** Wraps an angle into (-π, π]. */
export function wrapAngleSigned(angle: number): number {
  const wrapped = wrapAngle(angle);
  return wrapped > Math.PI ? wrapped - TAU : wrapped;
}

/** Shortest signed turn from `from` to `to`, in (-π, π]. */
export function shortestAngleDelta(from: number, to: number): number {
  return wrapAngleSigned(to - from);
}

/** Signed angle turning `a` onto `b`, in (-π, π]; zero when either vector is zero. */
export function signedAngleBetween2(a: Vec2, b: Vec2): number {
  return Math.atan2(cross2(a, b), dot2(a, b));
}

/** Unsigned angle between two directions, in [0, π]. */
export function angleBetween2(a: Vec2, b: Vec2): number {
  return Math.atan2(Math.abs(cross2(a, b)), dot2(a, b));
}
