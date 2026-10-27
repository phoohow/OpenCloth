import type { Vec2 } from '../../core/model/types';
import { add, sub, scale, normalize, dot, perp } from './vec2';

/**
 * Offsets a closed polygon along vertex angle bisectors (miter method); first and last
 * vertices join automatically. Positive distance expands a counter-clockwise polygon
 * outward, negative shrinks it.
 */
export function offsetPolygon(polygon: Vec2[], dist: number): Vec2[] {
  const n = polygon.length;
  if (n < 3) return polygon.map(p => ({ ...p }));
  const result: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];

    const n1 = normalize(perp(sub(curr, prev)));
    const n2 = normalize(perp(sub(next, curr)));

    let bisector = add(n1, n2);
    const bisLen = Math.hypot(bisector.x, bisector.y);
    if (bisLen < 1e-9) {
      // 180 degree reversal: use the single edge normal.
      bisector = n1;
    } else {
      bisector = scale(bisector, 1 / bisLen);
    }

    const cosHalf = dot(bisector, n1);
    // Miter clamp keeping sharp corners from producing long spikes.
    const miterLimit = 4.0;
    let miterLen = Math.abs(cosHalf) > 1e-6 ? dist / cosHalf : dist;
    const maxLen = Math.abs(dist) * miterLimit;
    if (Math.abs(miterLen) > maxLen) miterLen = Math.sign(miterLen) * maxLen;

    result.push(add(curr, scale(bisector, miterLen)));
  }
  return result;
}

/** Offsets an open curve along the normal of each point. */
export function offsetPolyline(points: Vec2[], dist: number): Vec2[] {
  const n = points.length;
  if (n < 2) return points.map(p => ({ ...p }));
  const normals = computePolylineNormals(points);
  return points.map((p, i) => add(p, scale(normals[i], dist)));
}

/** Unit bisector normal at each polyline point. */
export function computePolylineNormals(points: Vec2[]): Vec2[] {
  const n = points.length;
  const normals: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      normals.push(normalize(perp(sub(points[1], points[0]))));
    } else if (i === n - 1) {
      normals.push(normalize(perp(sub(points[n - 1], points[n - 2]))));
    } else {
      const n1 = normalize(perp(sub(points[i], points[i - 1])));
      const n2 = normalize(perp(sub(points[i + 1], points[i])));
      let bis = add(n1, n2);
      const l = Math.hypot(bis.x, bis.y);
      bis = l < 1e-9 ? n1 : scale(bis, 1 / l);
      normals.push(bis);
    }
  }
  return normals;
}

/** Proper intersection test between two segments. */
function segmentsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const d1 = cross2(sub(a2, a1), sub(b1, a1));
  const d2 = cross2(sub(a2, a1), sub(b2, a1));
  const d3 = cross2(sub(b2, b1), sub(a1, b1));
  const d4 = cross2(sub(b2, b1), sub(a2, b1));
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

function cross2(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/** Self-intersection test for a closed polygon, O(n²). */
export function hasSelfIntersection(polygon: Vec2[]): boolean {
  const n = polygon.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i], a2 = polygon[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      // The last edge is adjacent to the first one.
      if (i === 0 && j === n - 1) continue;
      const b1 = polygon[j], b2 = polygon[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** Miter offset that falls back to per-point normal offsets when the result self-intersects. */
export function safeOffsetPolygon(polygon: Vec2[], dist: number): Vec2[] {
  const result = offsetPolygon(polygon, dist);
  if (hasSelfIntersection(result)) {
    return offsetPolylineClosed(polygon, dist);
  }
  return result;
}

function offsetPolylineClosed(polygon: Vec2[], dist: number): Vec2[] {
  const n = polygon.length;
  const result: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const next = polygon[(i + 1) % n];
    const normal = normalize(perp(sub(next, prev)));
    result.push(add(polygon[i], scale(normal, dist)));
  }
  return result;
}
