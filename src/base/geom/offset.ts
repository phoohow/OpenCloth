import type { Vec2 } from '@/base/math';

import { signedPolygonArea } from '@/base/geom/primitives';
import { segmentsStrictlyCross2 } from '@/base/geom/segment2';
import { add2, cross2, dot2, normalize2, perp2, scale2, sub2, unit2 } from '@/base/math';

const ROUND_STEP = Math.PI / 12;

export type CornerJoinStyle = 'miter' | 'round' | 'bevel';

const clampLength = (value: number, limit: number): number =>
  Math.abs(value) > limit ? Math.sign(value) * limit : value;

export function offsetPolygon(polygon: Vec2[], dist: number): Vec2[] {
  const n = polygon.length;
  if (n < 3) return polygon.map(p => ({ ...p }));
  const result: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];

    const n1 = normalize2(perp2(sub2(curr, prev)));
    const n2 = normalize2(perp2(sub2(next, curr)));

    let bisector = add2(n1, n2);
    const bisLen = Math.hypot(bisector.x, bisector.y);
    if (bisLen < 1e-9) {
      bisector = n1;
    } else {
      bisector = scale2(bisector, 1 / bisLen);
    }

    const cosHalf = dot2(bisector, n1);
    const miterLimit = 4.0;
    let miterLen = Math.abs(cosHalf) > 1e-6 ? dist / cosHalf : dist;
    const maxLen = Math.abs(dist) * miterLimit;
    if (Math.abs(miterLen) > maxLen) miterLen = Math.sign(miterLen) * maxLen;

    result.push(add2(curr, scale2(bisector, miterLen)));
  }

  return result;
}

export function offsetPolyline(points: Vec2[], dist: number): Vec2[] {
  const n = points.length;
  if (n < 2) return points.map(p => ({ ...p }));
  const normals = computePolylineNormals(points);
  return points.map((p, i) => add2(p, scale2(normals[i], dist)));
}

export function computePolylineNormals(points: Vec2[]): Vec2[] {
  const n = points.length;
  const normals: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      normals.push(normalize2(perp2(sub2(points[1], points[0]))));
    } else if (i === n - 1) {
      normals.push(normalize2(perp2(sub2(points[n - 1], points[n - 2]))));
    } else {
      const n1 = normalize2(perp2(sub2(points[i], points[i - 1])));
      const n2 = normalize2(perp2(sub2(points[i + 1], points[i])));
      let bis = add2(n1, n2);
      const l = Math.hypot(bis.x, bis.y);
      bis = l < 1e-9 ? n1 : scale2(bis, 1 / l);
      normals.push(bis);
    }
  }

  return normals;
}

export function hasSelfIntersection(polygon: Vec2[]): boolean {
  const n = polygon.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i], a2 = polygon[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = polygon[j], b2 = polygon[(j + 1) % n];
      if (segmentsStrictlyCross2(a1, a2, b1, b2)) return true;
    }
  }

  return false;
}

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
    const normal = normalize2(perp2(sub2(next, prev)));
    result.push(add2(polygon[i], scale2(normal, dist)));
  }

  return result;
}

function offsetLineJoin(p1: Vec2, dirIn: Vec2, p2: Vec2, dirOut: Vec2): Vec2 | null {
  const denom = cross2(dirIn, dirOut);
  if (Math.abs(denom) < 1e-9) return null;
  const t = cross2(sub2(p2, p1), dirOut) / denom;
  return add2(p1, scale2(dirIn, t));
}

function bisectJoin(curr: Vec2, n1: Vec2, n2: Vec2, dist: number): Vec2 {
  const bis = unit2(add2(n1, n2));
  if (!bis) return add2(curr, scale2(n1, dist));
  const cosHalf = dot2(bis, n1);
  const m = Math.abs(cosHalf) > 1e-6 ? clampLength(dist / cosHalf, Math.abs(dist) * 4) : dist;
  return add2(curr, scale2(bis, m));
}

export function offsetPolygonStyled(
  polygon: Vec2[],
  distance: number | number[],
  corner: CornerJoinStyle | CornerJoinStyle[] = 'miter',
): Vec2[] {
  const n = polygon.length;
  if (n < 3) return polygon.map(p => ({ ...p }));
  const flat = typeof distance === 'number' ? distance : (distance[0] ?? 0);
  const uniformMiter = typeof distance === 'number'
    && (typeof corner === 'string' ? corner : corner.every(c => c === 'miter')) === 'miter';
  if (uniformMiter) return offsetPolygon(polygon, flat);
  if (typeof distance === 'number' && distance === 0) return polygon.map(p => ({ ...p }));

  const flipped = signedPolygonArea(polygon) < 0;
  const src = (i: number): number => (flipped ? (n - 1 - i) % n : i);
  const ring = flipped ? [...polygon].reverse() : polygon;
  const sign = flipped ? -1 : 1;
  const dist = ring.map((_, i) => sign * (typeof distance === 'number' ? distance : distance[src(i)] ?? 0));
  const style = ring.map((_, i): CornerJoinStyle =>
    typeof corner === 'string' ? corner : corner[src(i)] ?? 'miter');

  const result: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const curr = ring[i];
    const next = ring[(i + 1) % n];
    const dirIn = normalize2(sub2(curr, prev));
    const dirOut = normalize2(sub2(next, curr));
    const n1 = normalize2(perp2(dirIn));
    const n2 = normalize2(perp2(dirOut));
    const turn = Math.atan2(cross2(dirIn, dirOut), dot2(dirIn, dirOut));

    const d1 = dist[i];
    const d2 = dist[(i + 1) % n];
    const p1 = add2(curr, scale2(n1, d1));
    const p2 = add2(curr, scale2(n2, d2));
    const same = Math.abs(d1 - d2) < 1e-9;
    const spike = Math.abs(d1) * 4;

    if (turn * d1 > 1e-12) {
      if (style[i] === 'miter') {
        const join = same
          ? bisectJoin(curr, n1, n2, d1)
          : offsetLineJoin(p1, dirIn, p2, dirOut);
        result.push(join && Math.hypot(join.x - curr.x, join.y - curr.y) <= spike ? join : p2);
        continue;
      }

      result.push(p1);
      if (style[i] === 'round') {
        const steps = Math.max(2, Math.ceil(Math.abs(turn) / ROUND_STEP));
        for (let k = 1; k < steps; k++) {
          const t = k / steps;
          const a = turn * t;
          const rot = { x: n1.x * Math.cos(a) - n1.y * Math.sin(a), y: n1.x * Math.sin(a) + n1.y * Math.cos(a) };
          result.push(add2(curr, scale2(rot, d1 + (d2 - d1) * t)));
        }
      }

      result.push(p2);
      continue;
    }

    if (same) {
      result.push(bisectJoin(curr, n1, n2, d1));
      continue;
    }

    const join = offsetLineJoin(p1, dirIn, p2, dirOut);
    result.push(join && Math.hypot(join.x - curr.x, join.y - curr.y) <= spike ? join : p2);
  }

  return flipped ? result.reverse() : result;
}

export function offsetOutlinePerEdge(
  samples: Vec2[],
  allowances: number[],
  edgeChordCounts?: number[],
): Vec2[] {
  const n = samples.length;
  if (n < 3) return samples.map(p => ({ ...p }));

  const normalAt = (idx: number): Vec2 => {
    const prev = samples[(idx - 1 + n) % n];
    const next = samples[(idx + 1) % n];
    return normalize2(perp2(sub2(next, prev)));
  };

  if (!edgeChordCounts || edgeChordCounts.length === 0) {
    if (allowances.length !== n && allowances.length !== 1) {
      throw new Error('offsetOutlinePerEdge: allowances must be per-vertex, uniform, or match edgeChordCounts');
    }

    const at = (i: number): number => (allowances.length === 1 ? allowances[0] : allowances[i]);
    return samples.map((p, i) => add2(p, scale2(normalAt(i), at(i))));
  }

  if (allowances.length !== edgeChordCounts.length) {
    throw new Error('offsetOutlinePerEdge: allowances must be per-vertex, uniform, or match edgeChordCounts');
  }

  const result: Vec2[] = [];
  let cursor = 0;
  const lastEdge = edgeChordCounts.length - 1;
  for (let e = 0; e <= lastEdge; e++) {
    const allowance = allowances[e];
    for (let k = 0; k <= edgeChordCounts[e]; k++) {
      if (e > 0 && k === 0) continue;
      if (e === lastEdge && k === edgeChordCounts[e]) continue;
      const idx = (cursor + k) % n;
      result.push(add2(samples[idx], scale2(normalAt(idx), allowance)));
    }

    cursor += edgeChordCounts[e];
  }

  return result;
}
