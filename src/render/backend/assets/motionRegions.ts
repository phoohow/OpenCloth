import type { ProceduralMotion } from '@/render/common';

export function checkMotion(motion: ProceduralMotion, vertexCount: number): void {
  const regions = motion.pivots.length;
  if (regions === 0) throw new Error('Procedural motion carries no regions');
  if (motion.parents.length !== regions) {
    throw new Error(`Procedural motion carries ${motion.parents.length} parents for ${regions} regions`);
  }

  if (motion.weights.length !== vertexCount * regions) {
    throw new Error(`Procedural motion carries ${motion.weights.length} weights for ${vertexCount} vertices`);
  }

  for (const clip of motion.clips) {
    for (const track of clip.tracks) {
      if (track.region < 0 || track.region >= regions) {
        throw new Error(`Clip "${clip.name}" drives region ${track.region}, which does not exist`);
      }

      if (track.times.length !== track.values.length) {
        throw new Error(`Clip "${clip.name}" has ${track.times.length} keys for ${track.values.length} values`);
      }
    }
  }
}

export function parentFirst(parents: readonly number[]): number[] {
  const order: number[] = [];
  const state = new Uint8Array(parents.length);
  const visit = (region: number): void => {
    if (state[region] === 2) return;
    if (state[region] === 1) throw new Error(`Procedural motion regions form a cycle through ${region}`);
    const parent = parents[region] ?? -1;
    if (parent >= parents.length) throw new Error(`Procedural motion region ${region} points past the list`);
    state[region] = 1;
    if (parent >= 0) visit(parent);
    state[region] = 2;
    order.push(region);
  };
  for (let region = 0; region < parents.length; region++) visit(region);
  return order;
}
