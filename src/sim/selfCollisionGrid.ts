/** Bookkeeping the GPU self-collision pass needs before it can hash particles into cells. */

/** Smallest hash cell edge, in meters; thinner cloth still resolves at one centimeter. */
export const SELF_COLLISION_MIN_CELL = 0.01;

/** Candidate particles one hash slot holds; a denser slot keeps the first ones and drops the rest. */
export const SELF_COLLISION_SLOT_CAPACITY = 24;

/** Hash slot count and mask for a particle count, rounded up to a power of two. */
export function selfCollisionSlots(particleCount: number): { slots: number; mask: number } {
  let slots = 1024;
  while (slots < particleCount * 2) slots <<= 1;
  return { slots, mask: slots - 1 };
}

/**
 * One row of partner offsets per particle, followed by the partner indices those rows point at,
 * so the shader finds every stitched partner of a particle in one place. Both directions are
 * stored, because either particle of a seam has to recognise the other.
 */
export function buildStitchTable(
  pairs: readonly { p0: number; p1: number }[],
  particleCount: number,
): Uint32Array<ArrayBuffer> {
  const rowCount = particleCount + 1;
  const degrees = new Uint32Array(rowCount);
  const usable = pairs.filter(({ p0, p1 }) => (
    p0 !== p1 && p0 >= 0 && p1 >= 0 && p0 < particleCount && p1 < particleCount
  ));
  for (const { p0, p1 } of usable) {
    degrees[p0 + 1]! += 1;
    degrees[p1 + 1]! += 1;
  }
  const table = new Uint32Array(rowCount + usable.length * 2);
  for (let i = 0; i < particleCount; i++) table[i + 1] = table[i]! + degrees[i + 1]!;
  // Partner indices start past the row block, so one buffer holds the rows and what they point at.
  for (let i = 0; i <= particleCount; i++) table[i]! += rowCount;

  const fill = table.slice(0, particleCount);
  for (const { p0, p1 } of usable) {
    table[fill[p0]!++] = p1;
    table[fill[p1]!++] = p0;
  }
  return table;
}
