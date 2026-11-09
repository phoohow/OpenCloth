/** Point in pattern-plane coordinates, in centimeters. */
export interface Vec2 { x: number; y: number; }

/** Point in world coordinates, in meters. */
export interface Vec3 { x: number; y: number; z: number; }

/** Circular arc between two endpoints, with angles in radians. */
export interface ArcGeom {
  center: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
  ccw: boolean;
}

/** Creates a 2D point. */
export const vec2 = (x: number, y: number): Vec2 => ({ x, y });

/** Creates a 3D point. */
export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));
export const normalize = (a: Vec2): Vec2 => {
  const l = length(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Perpendicular vector rotated 90 degrees clockwise: (x, y) -> (y, -x). */
export const perp = (v: Vec2): Vec2 => ({ x: v.y, y: -v.x });

/** Signed polygon area; positive for counter-clockwise winding. */
export function signedPolygonArea(poly: Vec2[]): number {
  let area = 0;
  for (let i = 0, n = poly.length; i < n; i++) area += cross(poly[i], poly[(i + 1) % n]);
  return area * 0.5;
}

/** Absolute polygon area, independent of winding. */
export function polygonArea(poly: Vec2[]): number {
  return Math.abs(signedPolygonArea(poly));
}

/** Reverses the polygon when needed so winding is counter-clockwise. */
export function ensureCCW(poly: Vec2[]): Vec2[] {
  return signedPolygonArea(poly) < 0 ? [...poly].reverse() : poly;
}

/** Axis-aligned bounds of a point list; infinite min/max when the list is empty. */
export function computeBBox(points: Vec2[]): { min: Vec2; max: Vec2 } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: vec2(minX, minY), max: vec2(maxX, maxY) };
}
