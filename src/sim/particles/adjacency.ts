import type { Constraint } from '@/sim/common';

export interface NormalAdjacency {
  groupStart: Uint32Array;
  groupTriangles: Uint32Array;
  groupOfParticle: Uint32Array;
  groupCount: number;
}

export function buildAdjacency(
  indices: Uint32Array,
  particleCount: number,
  weldPairs: readonly Constraint[],
): NormalAdjacency {
  const parent = new Uint32Array(particleCount);
  for (let i = 0; i < particleCount; i++) parent[i] = i;

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    let walk = index;
    while (parent[walk] !== root) {
      const next = parent[walk]!;
      parent[walk] = root;
      walk = next;
    }

    return root;
  };

  for (const pair of weldPairs) {
    if (pair.p0 < 0 || pair.p1 < 0 || pair.p0 >= particleCount || pair.p1 >= particleCount) continue;
    const a = find(pair.p0);
    const b = find(pair.p1);
    if (a !== b) parent[b] = a;
  }

  const groupOfParticle = new Uint32Array(particleCount);
  const groupOfRoot = new Map<number, number>();
  let groupCount = 0;
  for (let i = 0; i < particleCount; i++) {
    const root = find(i);
    let group = groupOfRoot.get(root);
    if (group === undefined) {
      group = groupCount++;
      groupOfRoot.set(root, group);
    }

    groupOfParticle[i] = group;
  }

  const triangleCount = Math.floor(indices.length / 3);
  const counts = new Uint32Array(groupCount);
  const triangleGroups = (t: number): [number, number, number] => [
    groupOfParticle[indices[t * 3]]!,
    groupOfParticle[indices[t * 3 + 1]]!,
    groupOfParticle[indices[t * 3 + 2]]!,
  ];
  for (let t = 0; t < triangleCount; t++) {
    const [g0, g1, g2] = triangleGroups(t);
    counts[g0]!++;
    if (g1 !== g0) counts[g1]!++;
    if (g2 !== g0 && g2 !== g1) counts[g2]!++;
  }

  const groupStart = new Uint32Array(groupCount + 1);
  for (let g = 0; g < groupCount; g++) groupStart[g + 1] = groupStart[g]! + counts[g]!;
  const groupTriangles = new Uint32Array(groupStart[groupCount]!);
  const cursor = groupStart.slice(0, groupCount);
  for (let t = 0; t < triangleCount; t++) {
    const [g0, g1, g2] = triangleGroups(t);
    groupTriangles[cursor[g0]!++] = t;
    if (g1 !== g0) groupTriangles[cursor[g1]!++] = t;
    if (g2 !== g0 && g2 !== g1) groupTriangles[cursor[g2]!++] = t;
  }

  return { groupStart, groupTriangles, groupOfParticle, groupCount };
}
