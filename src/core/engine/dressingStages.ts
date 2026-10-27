import type { SimulationConfig } from '../model/types';

/** Frames the seams spend closing from the flat layout to the sewn garment. */
export const SEW_FRAMES = 26;

/** Frames the sewn piece spends gliding toward its pose wrapped around the body. */
export const DRESS_FRAMES = 34;

/** Frames of free relaxation after the piece is on the body. */
export const RELAX_FRAMES = 12;

/** Fraction of the remaining distance covered per dress frame. */
export const DRESS_GLIDE = 0.16;

/** Constraint iterations the seam-closing stage solves with. */
export const SEW_ITERATIONS = 8;

/** Constraint iterations the guided glide solves with. */
export const GLIDE_ITERATIONS = 6;

/** Constraint iterations the post-dressing relaxation solves with. */
export const SETTLE_ITERATIONS = 15;

/** Simulation config for one dressing stage: gravity-free so the seams and the guided glide drive the motion. */
export function stageConfig(simulation: SimulationConfig, iterations: number): SimulationConfig {
  return {
    ...simulation,
    gravity: { x: 0, y: 0, z: 0 },
    dt: 1 / 60,
    constraintIterations: iterations,
    avatarCollision: true,
  };
}

/** One glide step toward the wrapped pose. */
export function glideTowards(current: Float32Array, target: Float32Array): Float32Array {
  const next = new Float32Array(current.length);
  for (let v = 0; v < current.length; v++) {
    next[v] = current[v] + (target[v] - current[v]) * DRESS_GLIDE;
  }
  return next;
}
