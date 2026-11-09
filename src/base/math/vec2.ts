/** 2D vector algebra over pattern-plane coordinates, in centimeters. */

import { EPS } from '@/base/math/scalar';

/** Point in pattern-plane coordinates, in centimeters. */
export interface Vec2 { x: number; y: number; }

/** Creates a 2D point. */
export const vec2 = (x: number, y: number): Vec2 => ({ x, y });

/** Sum of two vectors. */
export const add2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

/** Difference of two vectors. */
export const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/** Vector multiplied by a scalar. */
export const scale2 = (v: Vec2, s: number): Vec2 => ({ x: v.x * s, y: v.y * s });

/** Dot product. */
export const dot2 = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

/** Cross product magnitude, the z component of the right-handed 3D cross product. */
export const cross2 = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

/** Euclidean length. */
export const length2 = (v: Vec2): number => Math.hypot(v.x, v.y);

/** Distance between two points. */
export const distance2 = (a: Vec2, b: Vec2): number => length2(sub2(a, b));

/** Zero vector. */
export const ZERO2: Vec2 = { x: 0, y: 0 };

/** Unit vector; inputs shorter than 1e-9 give the zero vector. */
export function normalize2(v: Vec2): Vec2 {
  return unit2(v) ?? ZERO2;
}

/** Unit vector, or null when the input is shorter than `tolerance`. */
export function unit2(v: Vec2, tolerance = 1e-9): Vec2 | null {
  const size = length2(v);
  return size > tolerance ? scale2(v, 1 / size) : null;
}

/** Component-wise interpolation between two vectors. */
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Perpendicular vector rotated 90 degrees clockwise: (x, y) -> (y, -x). */
export const perp2 = (v: Vec2): Vec2 => ({ x: v.y, y: -v.x });

/** Midpoint of two points. */
export const midpoint2 = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Arithmetic mean of a point list; the origin when the list is empty. */
export function averagePoint2(points: readonly Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

/** Whether two points are within `tolerance` of each other. */
export const nearlyEqual2 = (a: Vec2, b: Vec2, tolerance = EPS): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;

/** Rotates a vector by `angle` radians. */
export function rotate2(v: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/** Rotates a point about `center` by `angle` radians. */
export function rotateAround2(p: Vec2, center: Vec2, angle: number): Vec2 {
  const dx = p.x - center.x, dy = p.y - center.y;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** Scales a point about `center` by `factor`. */
export function scaleAround2(p: Vec2, center: Vec2, factor: number): Vec2 {
  return { x: center.x + (p.x - center.x) * factor, y: center.y + (p.y - center.y) * factor };
}

/** Reflects a point across the line through `origin` along `direction`; zero direction reflects through the origin. */
export function reflectAcrossLine2(p: Vec2, origin: Vec2, direction: Vec2): Vec2 {
  const unit = normalize2(direction);
  const along = dot2(sub2(p, origin), unit);
  const foot = add2(origin, scale2(unit, along));
  return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
}
