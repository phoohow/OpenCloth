import { describe, expect, it } from 'vitest';
import { buildNormalAdjacency } from '@/sim/buffers/normalAdjacency';
import type { Constraint } from '@/sim/buffers/constraintBuilder';

/** One stitch pair between particle 3 of the first panel and particle 4 of the second. */
const WELD: Constraint = { p0: 3, p1: 4, restLength: 0, compliance: 1 };

/** Two quads of two triangles each; the second quad starts at particle 4. */
const INDICES = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);

/** Triangle indices of one group, in the order the builder stored them. */
function groupTriangles(adjacency: ReturnType<typeof buildNormalAdjacency>, group: number): number[] {
  const start = adjacency.groupStart[group]!;
  const end = adjacency.groupStart[group + 1]!;
  return Array.from(adjacency.groupTriangles.subarray(start, end)).sort((a, b) => a - b);
}

describe('buildNormalAdjacency', () => {
  it('gives every particle its own group without weld pairs', () => {
    const adjacency = buildNormalAdjacency(INDICES, 8, []);
    expect(Array.from(adjacency.groupOfParticle)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(adjacency.groupCount).toBe(8);
    // Every triangle reaches each of its three vertices exactly once.
    expect(adjacency.groupTriangles.length).toBe(12);
    expect(groupTriangles(adjacency, 0)).toEqual([0, 1]);
    expect(groupTriangles(adjacency, 1)).toEqual([0]);
  });

  it('welds the stitched pair into one group spanning both panels', () => {
    const adjacency = buildNormalAdjacency(INDICES, 8, [WELD]);
    expect(adjacency.groupCount).toBe(7);
    expect(adjacency.groupOfParticle[3]).toBe(adjacency.groupOfParticle[4]);
    // The welded group sees the last triangle of the first panel and both of the second.
    expect(groupTriangles(adjacency, adjacency.groupOfParticle[3]!)).toEqual([1, 2, 3]);
    // Unwelded neighbours keep their own triangles only.
    expect(groupTriangles(adjacency, adjacency.groupOfParticle[2]!)).toEqual([0, 1]);
  });

  it('joins the vertices of a longer stitch chain transitively', () => {
    const adjacency = buildNormalAdjacency(INDICES, 8, [
      WELD, { p0: 4, p1: 5, restLength: 0, compliance: 1 }, { p0: 5, p1: 6, restLength: 0, compliance: 1 },
    ]);
    expect(adjacency.groupCount).toBe(5);
    expect(adjacency.groupOfParticle[3]).toBe(adjacency.groupOfParticle[6]);
    expect(adjacency.groupOfParticle[4]).toBe(adjacency.groupOfParticle[6]);
    // The four stitched vertices now share the triangles of both panel edges.
    expect(groupTriangles(adjacency, adjacency.groupOfParticle[3]!)).toEqual([1, 2, 3]);
  });

  it('ignores weld pairs outside the particle range', () => {
    const adjacency = buildNormalAdjacency(INDICES, 8, [
      { p0: 3, p1: 99, restLength: 0, compliance: 1 },
    ]);
    expect(adjacency.groupCount).toBe(8);
  });

  it('is deterministic', () => {
    const first = buildNormalAdjacency(INDICES, 8, [WELD]);
    const second = buildNormalAdjacency(INDICES, 8, [WELD]);
    expect(Array.from(first.groupStart)).toEqual(Array.from(second.groupStart));
    expect(Array.from(first.groupTriangles)).toEqual(Array.from(second.groupTriangles));
  });
});
