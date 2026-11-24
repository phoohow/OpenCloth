import { cross2, dot2, type Vec2 } from '@/base/math/vec2';

export const TAU = Math.PI * 2;

export const degToRad = (deg: number): number => deg * Math.PI / 180;

export const radToDeg = (rad: number): number => rad * 180 / Math.PI;

export function wrapAngle(angle: number): number {
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

export function wrapAngleSigned(angle: number): number {
  const wrapped = wrapAngle(angle);
  return wrapped > Math.PI ? wrapped - TAU : wrapped;
}

export function shortestAngleDelta(from: number, to: number): number {
  return wrapAngleSigned(to - from);
}

export function signedAngleBetween2(a: Vec2, b: Vec2): number {
  return Math.atan2(cross2(a, b), dot2(a, b));
}

export function angleBetween2(a: Vec2, b: Vec2): number {
  return Math.atan2(Math.abs(cross2(a, b)), dot2(a, b));
}
