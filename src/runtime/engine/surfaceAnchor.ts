import type { Vec2, Vec3, Vec3Tuple } from '@/base/math';
import type { PanelInput } from '@/sim/common';

import { cumulativePolylineLengths } from '@/base/geom';
import { unit3t } from '@/base/math';
import { meshSpacingCm } from '@/pattern/panel';

const WEIGHT_EPSILON = 1e-6;

const AREA_EPSILON = 1e-12;

export interface SurfaceAnchor {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly wa: number;
  readonly wb: number;
  readonly wc: number;
}

export interface SurfaceCursor {
  at(point: Vec2): SurfaceAnchor | null;
}

interface Located {
  readonly anchor: SurfaceAnchor;
  readonly triangle: number;
}

interface TriangleHit {
  readonly triangle: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly weights: readonly [number, number, number];
}

export function surfaceAnchor(panel: PanelInput, point: Vec2): SurfaceAnchor | null {
  return locate(panel, point, 0)?.anchor ?? null;
}

export function surfaceCursor(panel: PanelInput): SurfaceCursor {
  let hint = 0;
  return {
    at(point: Vec2): SurfaceAnchor | null {
      const found = locate(panel, point, hint);
      if (!found) return null;
      hint = found.triangle;
      return found.anchor;
    },
  };
}

function locate(panel: PanelInput, point: Vec2, hint: number): Located | null {
  if (panel.mesh.vertexCount === 0) return null;
  const hit = triangleAt(panel, point, hint);
  if (hit) {
    return {
      triangle: hit.triangle,
      anchor: {
        a: panel.vertexOffset + hit.a,
        b: panel.vertexOffset + hit.b,
        c: panel.vertexOffset + hit.c,
        wa: hit.weights[0],
        wb: hit.weights[1],
        wc: hit.weights[2],
      },
    };
  }

  const nearest = nearestVertex(panel, point);
  if (nearest < 0) return null;
  return { triangle: hint, anchor: { a: nearest, b: nearest, c: nearest, wa: 1, wb: 0, wc: 0 } };
}

function triangleAt(panel: PanelInput, point: Vec2, hint: number): TriangleHit | null {
  const { positions, indices, triangleCount, vertexCount } = panel.mesh;
  const start = triangleCount > 0 ? hint % triangleCount : 0;
  for (let step = 0; step < triangleCount; step++) {
    const triangle = (start + step) % triangleCount;
    const a = indices[triangle * 3];
    const b = indices[triangle * 3 + 1];
    const c = indices[triangle * 3 + 2];
    if (a === undefined || b === undefined || c === undefined) continue;
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;
    const weights = barycentric2D(
      positions[a * 2], positions[a * 2 + 1],
      positions[b * 2], positions[b * 2 + 1],
      positions[c * 2], positions[c * 2 + 1],
      point.x, point.y,
    );
    if (weights === null) continue;
    return { triangle, a, b, c, weights };
  }

  return null;
}

export function surfaceStep(panel: PanelInput, maxCm = 1): number {
  const spacing = meshSpacingCm(panel.mesh);
  return Math.min(maxCm, Math.max(0.25, spacing || maxCm));
}

export function resamplePath(points: readonly Vec2[], step: number): Vec2[] {
  if (points.length < 2 || !(step > 0)) return [...points];
  const arc = cumulativePolylineLengths(points);
  const total = arc[arc.length - 1] ?? 0;
  if (!(total > step)) return [...points];
  const out: Vec2[] = [points[0]];
  let index = 1;
  for (let distance = step; distance < total - 1e-6; distance += step) {
    while (index < arc.length - 1 && arc[index]! < distance) index++;
    const span = arc[index]! - arc[index - 1]! || 1;
    const k = (distance - arc[index - 1]!) / span;
    out.push({
      x: points[index - 1]!.x + (points[index]!.x - points[index - 1]!.x) * k,
      y: points[index - 1]!.y + (points[index]!.y - points[index - 1]!.y) * k,
    });
  }

  out.push(points[points.length - 1]!);
  return out;
}

export function anchorPosition(
  anchor: SurfaceAnchor, positions: Float32Array, out: Vec3,
): boolean {
  const a = anchor.a * 3;
  const b = anchor.b * 3;
  const c = anchor.c * 3;
  if (a + 2 >= positions.length || b + 2 >= positions.length || c + 2 >= positions.length) return false;
  out.x = positions[a] * anchor.wa + positions[b] * anchor.wb + positions[c] * anchor.wc;
  out.y = positions[a + 1] * anchor.wa + positions[b + 1] * anchor.wb + positions[c + 1] * anchor.wc;
  out.z = positions[a + 2] * anchor.wa + positions[b + 2] * anchor.wb + positions[c + 2] * anchor.wc;
  return true;
}

export function anchorNormal(anchor: SurfaceAnchor, normals?: Float32Array): Vec3Tuple {
  if (normals) {
    const a = anchor.a * 3;
    const b = anchor.b * 3;
    const c = anchor.c * 3;
    if (a + 2 < normals.length && b + 2 < normals.length && c + 2 < normals.length) {
      const unit = unit3t([
        normals[a] * anchor.wa + normals[b] * anchor.wb + normals[c] * anchor.wc,
        normals[a + 1] * anchor.wa + normals[b + 1] * anchor.wb + normals[c + 1] * anchor.wc,
        normals[a + 2] * anchor.wa + normals[b + 2] * anchor.wb + normals[c + 2] * anchor.wc,
      ], 1e-9);
      if (unit) return unit;
    }
  }

  return [0, 1, 0];
}

function nearestVertex(panel: PanelInput, point: Vec2): number {
  const { positions, vertexCount } = panel.mesh;
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const dx = positions[i * 2] - point.x;
    const dy = positions[i * 2 + 1] - point.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }

  return best < 0 ? -1 : panel.vertexOffset + best;
}

function barycentric2D(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number,
): [number, number, number] | null {
  const abx = bx - ax;
  const aby = by - ay;
  const acx = cx - ax;
  const acy = cy - ay;
  const denominator = abx * acy - aby * acx;
  if (Math.abs(denominator) < AREA_EPSILON) return null;
  const apx = px - ax;
  const apy = py - ay;
  const v = (apx * acy - apy * acx) / denominator;
  const w = (abx * apy - aby * apx) / denominator;
  const u = 1 - v - w;
  if (u < -WEIGHT_EPSILON || v < -WEIGHT_EPSILON || w < -WEIGHT_EPSILON) return null;
  return [u, v, w];
}
