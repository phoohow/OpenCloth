import type { AvatarCollider } from '../../avatar/collider/avatarCollider';
import { evalBodyDistance } from '../../avatar/collider/bodyDistance';

/** Clearance bands used to colour and summarise a fit check, in centimetres. */
export interface FitThresholds {
  /** Below this gap the cloth is pressing into the body. */
  tightCm: number;
  /** Above this gap the cloth hangs away from the body. */
  looseCm: number;
}

/** Default bands: 0.5 cm reads as tight, 2.5 cm as loose. */
export const DEFAULT_FIT_THRESHOLDS: FitThresholds = { tightCm: 0.5, looseCm: 2.5 };

/** Per-vertex signed distance from the cloth to the body surface, in centimetres. */
export interface FitField {
  /** Negative inside the body, positive outside. */
  clearanceCm: Float32Array;
  thresholds: FitThresholds;
}

/** Aggregate fit numbers shown next to the heatmap. */
export interface FitStats {
  vertices: number;
  /** Vertices whose clearance is below zero. */
  penetration: number;
  tight: number;
  ideal: number;
  loose: number;
  minCm: number;
  meanCm: number;
  maxCm: number;
}

/** Restricts a fit pass to a subset of vertices, such as every second sample. */
export interface FitFieldOptions {
  thresholds?: FitThresholds;
  /** Evaluates every `stride`-th vertex; non-positive values fall back to 1. */
  stride?: number;
}

/**
 * Measures signed clearance from `positions` (flat xyz in metres) to the body capsules.
 * Results are centimetres, matching the property panel; vertices skipped by `stride` carry `NaN`.
 */
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

/** Summarises a fit field; non-finite samples are ignored. */
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

/** Colour ramp for a clearance value: red inside, orange contact, green ideal, blue loose. */
export function fitColor(
  value: number,
  thresholds: FitThresholds = DEFAULT_FIT_THRESHOLDS,
): [number, number, number] {
  if (!Number.isFinite(value)) return [0.5, 0.5, 0.5];
  if (value < 0) return [0.85, 0.1, 0.1];
  if (value < thresholds.tightCm) {
    const t = value / Math.max(thresholds.tightCm, 1e-6);
    return [0.95, 0.35 + 0.4 * t, 0.08];
  }
  if (value <= thresholds.looseCm) {
    const t = (value - thresholds.tightCm) / Math.max(thresholds.looseCm - thresholds.tightCm, 1e-6);
    return [0.2 + 0.1 * (1 - t), 0.75 - 0.1 * t, 0.25 + 0.1 * t];
  }
  const t = Math.min(1, (value - thresholds.looseCm) / Math.max(thresholds.looseCm, 1e-6));
  return [0.2, 0.45 - 0.25 * t, 0.9];
}
