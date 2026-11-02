/** How far a wrapped panel sits off the body before its seams are closed, in meters. */
export const EXPLODE_OFFSET_M = 0.02;

/**
 * Slides a wrapped panel straight out along the direction from the body axis through its centre.
 * The shift is rigid, so the panel keeps its stress-free wrapped shape while the seams open up.
 * An optional per-vertex weight scales the shift, which keeps a pinned band on its wrapped pose.
 */
export function explodeOffBody(
  wrapped: Float32Array, weights?: Float32Array, offsetM = EXPLODE_OFFSET_M,
): Float32Array {
  const count = Math.floor(wrapped.length / 3);
  if (count === 0) return wrapped.slice();

  let cx = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    cx += wrapped[i * 3];
    cz += wrapped[i * 3 + 2];
  }
  cx /= count;
  cz /= count;

  const len = Math.hypot(cx, cz);
  // Panels centred on the body axis have no radial direction of their own; push them to the front.
  const dx = len < 1e-4 ? 0 : (cx / len) * offsetM;
  const dz = len < 1e-4 ? offsetM : (cz / len) * offsetM;

  const out = new Float32Array(wrapped.length);
  for (let i = 0; i < count; i++) {
    const w = weights?.[i] ?? 1;
    out[i * 3] = wrapped[i * 3] + dx * w;
    out[i * 3 + 1] = wrapped[i * 3 + 1];
    out[i * 3 + 2] = wrapped[i * 3 + 2] + dz * w;
  }
  return out;
}
