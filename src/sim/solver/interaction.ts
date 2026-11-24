import type { Constraint } from '@/sim/common';

import { packPinParams, type ComputeCommands, type LayoutBuffers, type Programs } from '@/sim/device';
import { pairSeparation } from '@/sim/particles';

const GRAB_STIFFNESS_N_PER_M = 3.4;

const MAX_GRAB_FORCE_N = 4;

export function usableGrabWeights(weights: Float32Array, pinned: Iterable<number>): Float32Array {
  const out = weights.slice();
  for (const index of pinned) {
    if (index >= 0 && index < out.length) out[index] = 0;
  }

  return out;
}

function seamBatchOffsets(batches: readonly Constraint[][]): number[] {
  const offsets: number[] = [];
  let total = 0;
  for (const batch of batches) {
    offsets.push(total);
    total += batch.length;
  }

  return offsets;
}

export class ClothGrab {
  private weights: Float32Array<ArrayBuffer> = new Float32Array(0);
  private weightSum = 0;
  private anchor: [number, number, number] | null = null;
  private target: [number, number, number] | null = null;

  setParticleCount(count: number): Float32Array<ArrayBuffer> {
    if (this.weights.length !== count) {
      this.weights = new Float32Array(count);
      this.clear();
    }

    return this.weights;
  }

  get weightData(): Float32Array<ArrayBuffer> {
    return this.weights;
  }

  set(weights: Float32Array, target: readonly [number, number, number]): boolean {
    if (weights.length !== this.weights.length) {
      this.clear();
      return false;
    }

    this.weights.set(weights);
    this.weightSum = 0;
    for (let i = 0; i < weights.length; i++) this.weightSum += weights[i]!;
    if (!(this.weightSum > 0)) {
      this.clear();
      return false;
    }

    this.anchor = [target[0], target[1], target[2]];
    this.target = [target[0], target[1], target[2]];
    return true;
  }

  move(target: readonly [number, number, number]): void {
    if (!this.target) return;
    this.target = [target[0], target[1], target[2]];
  }

  clear(): void {
    this.anchor = null;
    this.target = null;
    this.weightSum = 0;
  }

  forceN(): number | null {
    const pull = this.pull();
    return pull ? this.forceOf(pull.length) : null;
  }

  forceUniform(): [number, number, number, number] | null {
    const pull = this.pull();
    if (!pull || pull.length < 1e-9) return null;
    const scale = this.forceOf(pull.length) / (pull.length * this.weightSum);
    return [pull.x * scale, pull.y * scale, pull.z * scale, 1];
  }

  private pull(): { x: number; y: number; z: number; length: number } | null {
    const anchor = this.anchor;
    const target = this.target;
    if (!anchor || !target || !(this.weightSum > 0)) return null;
    const x = target[0] - anchor[0];
    const y = target[1] - anchor[1];
    const z = target[2] - anchor[2];
    return { x, y, z, length: Math.hypot(x, y, z) };
  }

  private forceOf(travel: number): number {
    return Math.min(GRAB_STIFFNESS_N_PER_M * travel, MAX_GRAB_FORCE_N);
  }
}

export class Interaction {
  readonly grab = new ClothGrab();
  private readonly pinned = new Set<number>();
  private readonly torn = new Set<number>();
  private progress = 0;
  private openLengths: number[][] = [];

  constructor(
    private readonly commands: ComputeCommands,
    private readonly resources: LayoutBuffers,
  ) {}

  configure(pinnedIndices: readonly number[], particleCount: number): Float32Array<ArrayBuffer> {
    this.pinned.clear();
    for (const index of pinnedIndices) this.pinned.add(index);
    this.torn.clear();
    this.progress = 0;
    return this.grab.setParticleCount(particleCount);
  }

  get pinnedIndices(): readonly number[] {
    return Array.from(this.pinned);
  }

  isPinned(index: number): boolean {
    return this.pinned.has(index);
  }

  clearTears(): void {
    this.torn.clear();
  }

  resetSeams(): void {
    this.torn.clear();
    this.progress = 0;
    this.applySeamProgress();
  }

  liveSeams(): Constraint[] {
    const seam = this.resources.groups.get('seam');
    if (!seam) return [];
    const offsets = seamBatchOffsets(seam.batched.batches);
    const live: Constraint[] = [];
    seam.batched.batches.forEach((batch, b) => {
      batch.forEach((constraint, i) => {
        if (!this.torn.has((offsets[b] ?? 0) + i)) live.push(constraint);
      });
    });
    return live;
  }

  captureSeamOpenLengths(): void {
    const seam = this.resources.groups.get('seam');
    this.openLengths = (seam?.batched.batches ?? []).map(batch => batch.map(c => c.restLength));
    if (this.progress > 0) this.applySeamProgress();
  }

  setSeamProgress(progress: number): void {
    this.progress = Math.min(1, Math.max(0, progress));
    this.applySeamProgress();
  }

  get seamProgress(): number {
    return this.progress;
  }

  async setPins(
    indices: readonly number[], pinned: boolean, baseInvMass: Float32Array, programs: Programs,
  ): Promise<boolean> {
    if (indices.length === 0) return true;
    if (indices.length > this.resources.particleCount) return false;
    if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= this.resources.particleCount)) return false;

    const invMasses = new Float32Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i]!;
      invMasses[i] = pinned ? 0 : baseInvMass[index]!;
      if (pinned) this.pinned.add(index);
      else this.pinned.delete(index);
    }

    if (pinned) for (const index of indices) this.grab.weightData[index] = 0;

    this.commands.begin();
    this.commands.write(this.resources.pinIndices, Uint32Array.from(indices));
    this.commands.write(this.resources.pinInvMass, invMasses);
    this.commands.write(this.resources.pinParams, packPinParams(indices.length, this.resources.particleCount));
    this.commands.dispatch(programs.setPin, this.resources.setPinBG, Math.ceil(indices.length / 256));
    this.commands.submit();
    await this.commands.submitted();
    return true;
  }

  writeGrabWeights(): void {
    this.commands.write(this.resources.grabWeights, this.grab.weightData);
  }

  setGrab(weights: Float32Array, target: readonly [number, number, number]): boolean {
    if (!this.grab.set(usableGrabWeights(weights, this.pinned), target)) return false;
    this.writeGrabWeights();
    return true;
  }

  resolveTears(readPositions: Float32Array, particleCount: number, enabled: boolean): boolean {
    if (!enabled || readPositions.length < particleCount * 3) return false;
    const seam = this.resources.groups.get('seam');
    if (!seam) return false;
    const offsets = seamBatchOffsets(seam.batched.batches);
    const dirty = new Set<number>();
    seam.batched.batches.forEach((batch, b) => {
      batch.forEach((constraint, i) => {
        const flat = (offsets[b] ?? 0) + i;
        if (this.torn.has(flat)) return;
        const tearLength = constraint.tearLength;
        if (tearLength === undefined || !Number.isFinite(tearLength) || tearLength <= 0) return;
        const distance = pairSeparation(constraint, readPositions, particleCount);
        if (distance === null || distance <= tearLength) return;
        this.torn.add(flat);
        constraint.restLength = distance;
        dirty.add(b);
      });
    });
    for (const batch of dirty) this.resources.uploadBatch('seam', batch);
    return dirty.size > 0;
  }

  private applySeamProgress(): void {
    const seam = this.resources.groups.get('seam');
    if (!seam) return;
    const offsets = seamBatchOffsets(seam.batched.batches);
    for (let b = 0; b < seam.batched.batches.length; b++) {
      const batch = seam.batched.batches[b]!;
      const open = this.openLengths[b] ?? [];
      for (let i = 0; i < batch.length; i++) {
        if (this.torn.has((offsets[b] ?? 0) + i)) continue;
        const constraint = batch[i]!;
        constraint.restLength = (open[i] ?? constraint.restLength) * (1 - this.progress);
      }

      this.resources.uploadBatch('seam', b);
    }
  }
}
