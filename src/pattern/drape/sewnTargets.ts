/** A particle's slot inside a flat xyz position buffer. */
export interface VertexRef {
  positions: Float32Array;
  index: number;
}

/** Two particles joined by a seam. */
export type SeamPairRef = [VertexRef, VertexRef];

/**
 * Moves both vertices of every seam pair to their midpoint, repeating until chains of shared
 * vertices settle on one compromise point. Used to build a dressing pose that the sewn seams
 * can actually hold.
 */
export function collapseSeamPairs(pairs: readonly SeamPairRef[], passes = 8): void {
  for (let pass = 0; pass < passes; pass++) {
    for (const [a, b] of pairs) {
      for (let k = 0; k < 3; k++) {
        const ia = a.index * 3 + k;
        const ib = b.index * 3 + k;
        const mid = (a.positions[ia] + b.positions[ib]) * 0.5;
        a.positions[ia] = mid;
        b.positions[ib] = mid;
      }
    }
  }
}
