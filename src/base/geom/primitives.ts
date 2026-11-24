import { cross2, vec2, type Vec2 } from '@/base/math';

export function signedPolygonArea(poly: Vec2[]): number {
  let area = 0;
  for (let i = 0, n = poly.length; i < n; i++) area += cross2(poly[i], poly[(i + 1) % n]);
  return area * 0.5;
}

export function polygonArea(poly: Vec2[]): number {
  return Math.abs(signedPolygonArea(poly));
}

export function ensureCCW(poly: Vec2[]): Vec2[] {
  return signedPolygonArea(poly) < 0 ? [...poly].reverse() : poly;
}

export function pointInPolygon(poly: Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }

  return inside;
}

export function computeBBox(points: readonly Vec2[]): { min: Vec2; max: Vec2 } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { min: vec2(minX, minY), max: vec2(maxX, maxY) };
}
