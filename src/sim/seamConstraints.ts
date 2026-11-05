import { packConstraints } from '@/sim/buffers/constraintBuilder';
import type { ConstraintGroup, ConstraintGroupKind } from '@/sim/simTypes';

/** One seam batch that needs its packed constraints uploaded. */
export interface SeamBatchWrite {
  buffer: GPUBuffer;
  data: ArrayBuffer;
}

/** Flat index each seam batch starts at, so torn and progress paths index the same constraint. */
export function seamBatchOffsets(groups: Map<ConstraintGroupKind, ConstraintGroup>): number[] {
  const seam = groups.get('seam');
  if (!seam) return [];
  const offsets: number[] = [];
  let acc = 0;
  for (const batch of seam.batched.batches) {
    offsets.push(acc);
    acc += batch.length;
  }
  return offsets;
}

/** Neutralizes seam constraints stretched past their strength-derived tear length. */
export function tearStretchedSeams(
  groups: Map<ConstraintGroupKind, ConstraintGroup>,
  readPositions: Float32Array,
  particleCount: number,
  tornSeams: Set<number>,
  enabled: boolean,
): SeamBatchWrite[] {
  if (!enabled) return [];
  const seam = groups.get('seam');
  if (!seam || !(readPositions.length >= particleCount * 3)) return [];
  const offsets = seamBatchOffsets(groups);
  const dirty = new Set<number>();
  seam.batched.batches.forEach((batch, b) => {
    batch.forEach((constraint, i) => {
      const flat = (offsets[b] ?? 0) + i;
      if (tornSeams.has(flat)) return;
      const tearLength = constraint.tearLength;
      if (tearLength === undefined || !Number.isFinite(tearLength) || tearLength <= 0) return;
      const p0 = constraint.p0;
      const p1 = constraint.p1;
      if (p0 < 0 || p1 < 0 || p0 >= particleCount || p1 >= particleCount) return;
      const dx = readPositions[p0 * 3]! - readPositions[p1 * 3]!;
      const dy = readPositions[p0 * 3 + 1]! - readPositions[p1 * 3 + 1]!;
      const dz = readPositions[p0 * 3 + 2]! - readPositions[p1 * 3 + 2]!;
      const dist = Math.hypot(dx, dy, dz);
      if (!Number.isFinite(dist)) return;
      if (dist > tearLength) {
        tornSeams.add(flat);
        constraint.restLength = dist; // a torn stitch keeps neither pulling nor pushing
        dirty.add(b);
      }
    });
  });
  return [...dirty].map(b => ({ buffer: seam.batched.buffers[b]!, data: packConstraints(seam.batched.batches[b]!).data }));
}

/** Seam rest lengths that close every stitch by the same fraction, skipping torn constraints. */
export function seamProgressWrites(
  groups: Map<ConstraintGroupKind, ConstraintGroup>,
  openLengths: number[][],
  tornSeams: Set<number>,
  progress: number,
): SeamBatchWrite[] {
  const seam = groups.get('seam');
  if (!seam || seam.batched.buffers.length === 0) return [];
  const p = Math.min(1, Math.max(0, progress));
  const offsets = seamBatchOffsets(groups);
  const writes: SeamBatchWrite[] = [];
  for (let b = 0; b < seam.batched.batches.length; b++) {
    const batch = seam.batched.batches[b]!;
    const open = openLengths[b] ?? [];
    for (let i = 0; i < batch.length; i++) {
      if (tornSeams.has((offsets[b] ?? 0) + i)) continue; // torn stitches stay open
      batch[i]!.restLength = (open[i] ?? batch[i]!.restLength) * (1 - p);
    }
    writes.push({ buffer: seam.batched.buffers[b]!, data: packConstraints(batch).data });
  }
  return writes;
}
