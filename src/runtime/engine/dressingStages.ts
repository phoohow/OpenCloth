import type { SimulationConfig } from '@/model/types';

export const SEW_FRAMES = 20;

export const DRESS_FRAMES = 20;

export const RELAX_FRAMES = 20;

export const DRESS_GLIDE = 0.16;

export const SEW_ITERATIONS = 8;

export const GLIDE_ITERATIONS = 6;

export const SETTLE_ITERATIONS = 15;

export function stageConfig(simulation: SimulationConfig, iterations: number): SimulationConfig {
  return {
    ...simulation,
    gravity: { x: 0, y: 0, z: 0 },
    contactFrictionScale: 0,
    dt: 1 / 60,
    constraintIterations: iterations,
    avatarCollision: true,
  };
}

export function glideTowards(current: Float32Array, target: Float32Array): Float32Array {
  const next = new Float32Array(current.length);
  for (let v = 0; v < current.length; v++) {
    next[v] = current[v] + (target[v] - current[v]) * DRESS_GLIDE;
  }

  return next;
}
