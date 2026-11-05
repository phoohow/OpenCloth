import { describe, expect, it } from 'vitest';
import { SelfCollisionSolver } from '@/sim/selfCollision';

/** Random but deterministic particle cloud inside a garment-scale cuboid. */
function particles(count: number): { positions: Float32Array; invMasses: Float32Array; layers: Uint8Array } {
  const positions = new Float32Array(count * 3);
  const invMasses = new Float32Array(count).fill(1);
  const layers = new Uint8Array(count);
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < count; i++) {
    positions[i * 3] = random() * 0.3;
    positions[i * 3 + 1] = random() * 0.5;
    positions[i * 3 + 2] = random() * 0.15;
    layers[i] = i % 3;
  }
  return { positions, invMasses, layers };
}

describe('self collision performance gate', () => {
  it('resolves 10k particles inside a generous budget', () => {
    const count = 10_000;
    const { positions, invMasses, layers } = particles(count);
    const solver = new SelfCollisionSolver(count);
    const start = performance.now();
    const result = solver.resolve(positions, invMasses, layers, {
      thickness: 0.002,
      layerSpacing: 0.004,
    });
    const ms = performance.now() - start;
    expect(result.pairs).toBeGreaterThan(0);
    // Catches an accidental all-pairs blowup; the pass normally runs in tens of milliseconds.
    expect(ms).toBeLessThan(5000);
  });
});