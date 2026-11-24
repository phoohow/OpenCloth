import type { AvatarCollider } from '@/avatar/collider';

import { evalBodyDistance } from '@/avatar/collider';

export const DEFAULT_FIT_THRESHOLDS: FitThresholds = { tightCm: 0.5, looseCm: 2.5 };

export interface FitThresholds {
  tightCm: number;
  looseCm: number;
}

export interface FitField {
  clearanceCm: Float32Array;
  thresholds: FitThresholds;
}

export interface FitStats {
  vertices: number;
  penetration: number;
  tight: number;
  ideal: number;
  loose: number;
  minCm: number;
  meanCm: number;
  maxCm: number;
}

export interface FitFieldOptions {
  thresholds?: FitThresholds;
  stride?: number;
}

export function computeFitField(
  positions: ArrayLike<number>,
  collider: AvatarCollider,
  options: FitFieldOptions = {},
): FitField {
  const count = Math.floor(positions.length / 3);
  const clearanceCm = new Float32Array(count);
  const stride = Math.max(1, Math.floor(options.stride ?? 1));
  for (let i = 0; i < count; i++) {
    if (i % stride !== 0) {
      clearanceCm[i] = NaN;
      continue;
    }

    const o = i * 3;
    clearanceCm[i] = evalBodyDistance(collider, positions[o]!, positions[o + 1]!, positions[o + 2]!) * 100;
  }

  return { clearanceCm, thresholds: options.thresholds ?? DEFAULT_FIT_THRESHOLDS };
}

export function fitStats(field: FitField): FitStats {
  let vertices = 0;
  let penetration = 0;
  let tight = 0;
  let ideal = 0;
  let loose = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;

  for (const value of field.clearanceCm) {
    if (!Number.isFinite(value)) continue;
    vertices++;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
    if (value < 0) penetration++;
    else if (value < field.thresholds.tightCm) tight++;
    else if (value > field.thresholds.looseCm) loose++;
    else ideal++;
  }

  return {
    vertices,
    penetration,
    tight,
    ideal,
    loose,
    minCm: vertices > 0 ? min : 0,
    meanCm: vertices > 0 ? sum / vertices : 0,
    maxCm: vertices > 0 ? max : 0,
  };
}
