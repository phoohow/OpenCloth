// Prints a CPU self-collision throughput baseline without running the GPU solver.
// Run with: node scripts/self-collision-baseline.mjs
import { SelfCollisionSolver } from '../src/sim/selfCollision.ts';

/** Random but deterministic particle cloud inside a garment-scale cuboid. */
function makeParticles(count) {
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

const COUNTS = [2_000, 5_000, 10_000];
for (const count of COUNTS) {
  const { positions, invMasses, layers } = makeParticles(count);
  const solver = new SelfCollisionSolver(count);
  const start = performance.now();
  const result = solver.resolve(positions, invMasses, layers, {
    thickness: 0.002,
    layerSpacing: 0.004,
    iterations: 2,
  });
  const ms = performance.now() - start;
  const pairsPerMs = result.pairs / Math.max(ms, 0.001);
  console.log(
    `particles=${count} pairs=${result.pairs} truncated=${result.truncated} ` +
    `ms=${ms.toFixed(2)} pairsPerMs=${pairsPerMs.toFixed(1)}`,
  );
}