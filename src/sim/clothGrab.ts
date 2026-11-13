/** Pointer grab state: per-particle weights and the force a pointer commands. */

/** Pull stiffness: newtons the grab commands per metre of pointer travel. */
const GRAB_STIFFNESS_N_PER_M = 3.4;
/** Upper bound on the pull, in newtons, so a target beyond the reach stays bounded. */
const MAX_GRAB_FORCE_N = 4;

/** Copies grab weights with pinned particles zeroed; a pin cannot move, so it carries no force. */
export function usableGrabWeights(weights: Float32Array, pinned: Iterable<number>): Float32Array {
  const out = weights.slice();
  for (const index of pinned) {
    if (index >= 0 && index < out.length) out[index] = 0;
  }
  return out;
}

/**
 * Per-particle pull weights plus the total force they share. Pointer travel from the grab anchor
 * becomes a force, which INTEGRATE turns into `force * weight / mass` accelerations, so the pull
 * travels through the constraint network and the reported number is the force actually applied.
 */
export class ClothGrab {
  private weights: Float32Array<ArrayBuffer> = new Float32Array(0);
  private weightSum = 0;
  private anchor: [number, number, number] | null = null;
  private target: [number, number, number] | null = null;

  /** Sizes the weight array to the particle count; clears the pull when the count changes. */
  setParticleCount(count: number): Float32Array<ArrayBuffer> {
    if (this.weights.length !== count) {
      this.weights = new Float32Array(count);
      this.clear();
    }
    return this.weights;
  }

  /** Weight array the GPU buffer mirrors. */
  get weightData(): Float32Array<ArrayBuffer> {
    return this.weights;
  }

  /** Copies `weights` and freezes `target` as the anchor; false when they cover no weight. */
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

  /** Moves the point the grabbed fabric is pulled toward. Ignored when nothing is grabbed. */
  move(target: readonly [number, number, number]): void {
    if (!this.target) return;
    this.target = [target[0], target[1], target[2]];
  }

  /** Releases the grab; the particles keep the velocity the pull gave them. */
  clear(): void {
    this.anchor = null;
    this.target = null;
    this.weightSum = 0;
  }

  /** Pull force in newtons the grab applies to the patch; null while the cloth is not grabbed. */
  forceN(): number | null {
    const pull = this.pull();
    return pull ? this.forceOf(pull.length) : null;
  }

  /**
   * Force shared out for INTEGRATE: xyz is newtons per unit grab weight and w = 1 while dragging.
   * INTEGRATE multiplies it by `weight * inverse mass`, so the patch receives `forceN()` in total.
   */
  forceUniform(): [number, number, number, number] | null {
    const pull = this.pull();
    if (!pull || pull.length < 1e-9) return null;
    const scale = this.forceOf(pull.length) / (pull.length * this.weightSum);
    return [pull.x * scale, pull.y * scale, pull.z * scale, 1];
  }

  /** Anchor-to-target vector of the live pull, or null while the cloth is not grabbed. */
  private pull(): { x: number; y: number; z: number; length: number } | null {
    const anchor = this.anchor;
    const target = this.target;
    if (!anchor || !target || !(this.weightSum > 0)) return null;
    const x = target[0] - anchor[0];
    const y = target[1] - anchor[1];
    const z = target[2] - anchor[2];
    return { x, y, z, length: Math.hypot(x, y, z) };
  }

  /** Force the pointer travel commands, in newtons. */
  private forceOf(travel: number): number {
    return Math.min(GRAB_STIFFNESS_N_PER_M * travel, MAX_GRAB_FORCE_N);
  }
}
