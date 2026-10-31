/** Seam join strength carried into the solver: tear length and tear detection. */

/**
 * Elongation beyond a pair's open distance at which a stitch gives way.
 * A stronger join stretches further before tearing.
 */
export function seamBreakStretch(strength: number): number {
  const s = Math.min(1, Math.max(0.01, strength));
  return 0.3 + s * 1.2;
}

/** One seam pair's tear threshold, as an absolute distance in meters. */
export interface TearPair {
  p0: number;
  p1: number;
  /** Distance beyond which the pair tears; non-positive values never tear. */
  tearLength: number;
}

/** Flat indices of seam pairs whose current separation exceeds their tear length. */
export function tornSeamPairs(
  positions: Float32Array,
  pairs: ReadonlyArray<TearPair>,
): Set<number> {
  const torn = new Set<number>();
  pairs.forEach((pair, index) => {
    if (!Number.isFinite(pair.tearLength) || pair.tearLength <= 0) return;
    const p0 = pair.p0;
    const p1 = pair.p1;
    if (p0 < 0 || p1 < 0 || p0 * 3 + 2 >= positions.length || p1 * 3 + 2 >= positions.length) return;
    const dx = positions[p0 * 3]! - positions[p1 * 3]!;
    const dy = positions[p0 * 3 + 1]! - positions[p1 * 3 + 1]!;
    const dz = positions[p0 * 3 + 2]! - positions[p1 * 3 + 2]!;
    const dist = Math.hypot(dx, dy, dz);
    if (Number.isFinite(dist) && dist > pair.tearLength) torn.add(index);
  });
  return torn;
}