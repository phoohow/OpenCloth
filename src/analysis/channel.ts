import type { ClothSimInput } from '@/sim';
import type { AvatarCollider } from '@/avatar/collider';
import type { FitField, FitStats } from '@/analysis/fit';
import type { StrainBounds, StrainStats } from '@/analysis/strain';
import type { PressureStats } from '@/analysis/pressure';

/**
 * One heatmap channel. The three channels share one overlay and one vertex-colour attribute, so
 * exactly one is on at a time; each reads a field off the live cloth, writes it into the overlay
 * and reports a summary.
 */
export type AnalysisKind = 'fit' | 'strain' | 'pressure';

/** What every channel reads from the engine; nothing here mutates state. */
export interface AnalysisSource {
  /** Positions of the last frame that passed the finite check. */
  lastGoodPositions(): Float32Array;
  /** Initial merged positions, the fallback before the first step. */
  initialPositions(): Float32Array;
  /** Flat-pattern rest lengths of every merged particle, the strain denominator. */
  restPositions(): Float32Array;
  /** Merged layout: triangles, panels and their per-piece limits. Null when no cloth is built. */
  clothInput(): ClothSimInput | null;
  /** Body collider currently in the scene. */
  collider(): AvatarCollider | null;
  /** Contact indentation read back with the last step; null before the first step. */
  contact(): Float32Array | null;
}

/** Parameters the panel reads one channel with. */
export interface AnalysisParams {
  fit: { tightCm: number; looseCm: number };
  strain: { min: number; max: number; byFabric: boolean };
  pressure: { maxKpa: number };
}

/** Summary one channel reports back to the panels. */
export interface AnalysisStats {
  fit: FitStats;
  strain: StrainStats;
  pressure: PressureStats;
}

/** Vertex colours the channels write into the 3D viewport overlay. */
export interface AnalysisOverlay {
  update(field: FitField): void;
  updateStrain(strain: Float32Array, min: number, max: number): void;
  updateStrainBounds(strain: Float32Array, bounds: StrainBounds): void;
  updatePressure(pressureKpa: Float32Array, maxKpa: number): void;
}

/** A channel's pass: field in, colours into the overlay, summary out; null when inputs are missing. */
export interface AnalysisChannel<K extends AnalysisKind = AnalysisKind> {
  readonly kind: K;
  pass(source: AnalysisSource, overlay: AnalysisOverlay, params: AnalysisParams[K]): AnalysisStats[K] | null;
}

/** Live positions when they still match `fallback`, otherwise the fallback layout. */
export function liveOr(fallback: Float32Array, live: Float32Array): Float32Array {
  return live.length === fallback.length && fallback.length > 0 ? live : fallback;
}
