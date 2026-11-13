/** Pointer grab state: per-particle weights, patch mass and the pull a pointer commands. */

/**
 * Solver step the reported pull is quoted at, in seconds: the default 60 Hz frame split into four
 * substeps. Fixed so the reading describes the drag rather than the project's timestep.
 */
const GRAB_REFERENCE_STEP_S = 1 / 240;

/**
 * Substep count the pull is calibrated at: the default project's simulation setting. The command
 * is split over the live count, so a solver refinement does not change how strongly the drag pulls.
 */
const GRAB_REFERENCE_SUBSTEPS = 4;

/**
 * Longest distance a fully weighted grabbed particle travels in one substep, in meters. The force
 * reading uses the same cap, so the number and the command saturate together.
 */
const MAX_GRAB_STEP_M = 0.4;

/** Copies grab weights with pinned particles zeroed; a pin cannot move, so it carries no pull. */
export function usableGrabWeights(weights: Float32Array, pinned: Iterable<number>): Float32Array {
  const out = weights.slice();
  for (const index of pinned) {
    if (index >= 0 && index < out.length) out[index] = 0;
  }
  return out;
}

/**
 * Per-particle pull weights plus the patch mass they cover. Pointer travel from the grab anchor
 * becomes a per-substep displacement, which INTEGRATE shares out by weight so the pull travels
 * through the constraint network; the patch mass turns the same command into a force reading.
 */
export class ClothGrab {
  private masses: Float32Array<ArrayBuffer> = new Float32Array(0);
  private weights: Float32Array<ArrayBuffer> = new Float32Array(0);
  private anchor: [number, number, number] | null = null;
  private target: [number, number, number] | null = null;
  private inverseMass = 0;
  private maxWeight = 0;
  private substeps = GRAB_REFERENCE_SUBSTEPS;

  /** Sets the substep count the frame command is split over. */
  setSubsteps(substeps: number): void {
    this.substeps = Math.max(1, Math.round(substeps));
  }

  /** Adopts new particle masses; keeps the live pull while the particle count stays the same. */
  setMasses(masses: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
    const sameCount = this.weights.length === masses.length;
    this.masses = masses;
    if (!sameCount) {
      this.weights = new Float32Array(masses.length);
      this.clear();
    } else {
      this.refresh();
    }
    return this.weights;
  }

  /** Weight array the GPU buffer mirrors. */
  get weightData(): Float32Array<ArrayBuffer> {
    return this.weights;
  }

  /** Copies `weights` and freezes `target` as the anchor; false when they cover no mass. */
  set(weights: Float32Array, target: readonly [number, number, number]): boolean {
    if (weights.length !== this.masses.length) {
      this.clear();
      return false;
    }
    this.weights.set(weights);
    this.refresh();
    if (this.inverseMass === 0) {
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
    this.inverseMass = 0;
    this.maxWeight = 0;
  }

  /**
   * Pull force in newtons the grabbed patch commands, quoted at the reference solver step; null
   * while the cloth is not grabbed. Travel beyond the per-substep limit stops adding force, so the
   * reading and the step INTEGRATE applies saturate together.
   */
  forceN(): number | null {
    const pull = this.pull();
    if (!pull) return null;
    const travel = this.travel(pull.length);
    return travel / (this.inverseMass * GRAB_REFERENCE_STEP_S * GRAB_REFERENCE_STEP_S);
  }

  /**
   * Displacement per substep for a fully weighted particle, packed for INTEGRATE, or null while
   * the pull is zero. INTEGRATE scales it by each particle's grab weight.
   */
  stepUniform(): [number, number, number, number] | null {
    const pull = this.pull();
    if (!pull || pull.length < 1e-9) return null;
    const step = this.travel(pull.length) * (GRAB_REFERENCE_SUBSTEPS / this.substeps) / pull.length;
    return [pull.x * step, pull.y * step, pull.z * step, 1];
  }

  /** Anchor-to-target vector of the live pull, or null while the cloth is not grabbed. */
  private pull(): { x: number; y: number; z: number; length: number } | null {
    const anchor = this.anchor;
    const target = this.target;
    if (!anchor || !target || this.inverseMass === 0 || !(this.maxWeight > 0)) return null;
    const x = target[0] - anchor[0];
    const y = target[1] - anchor[1];
    const z = target[2] - anchor[2];
    return { x, y, z, length: Math.hypot(x, y, z) };
  }

  /** Pointer travel the pull uses, capped so the heaviest weight moves within MAX_GRAB_STEP_M. */
  private travel(length: number): number {
    const limit = MAX_GRAB_STEP_M * this.substeps / (GRAB_REFERENCE_SUBSTEPS * this.maxWeight);
    return Math.min(length, limit);
  }

  /** Recomputes the grabbed patch mass and its heaviest weight from the live weights and masses. */
  private refresh(): void {
    let weightedMass = 0;
    let maxWeight = 0;
    for (let i = 0; i < this.weights.length; i++) {
      const weight = this.weights[i]!;
      if (weight <= 0) continue;
      weightedMass += weight * this.masses[i]!;
      if (weight > maxWeight) maxWeight = weight;
    }
    this.inverseMass = weightedMass > 0 ? 1 / weightedMass : 0;
    this.maxWeight = maxWeight;
  }
}
