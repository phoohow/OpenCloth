import { describe, expect, it } from 'vitest';
import {
  buildMeshCollider, closestPointOnTriangle, nearestMeshPoint, reindexMeshCollider, sampleMeshCollider,
} from '../../src/avatar/collider/meshCollider';

/** Axis-aligned cube of edge `size` centred on the origin, wound outward. */
function cubeTriangles(size: number): Float32Array {
  const h = size / 2;
  const corners = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ];
  const faces = [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3],
  ];
  const out: number[] = [];
  for (const [a, b, c, d] of faces) {
    for (const v of [a, b, c, a, c, d]) out.push(...corners[v]);
  }
  return new Float32Array(out);
}

describe('reindexMeshCollider', () => {
  /** Copies triangles with every vertex shifted along x. */
  function shiftX(vertices: Float32Array, dx: number): Float32Array {
    const out = vertices.slice();
    for (let i = 0; i < out.length; i += 3) out[i] += dx;
    return out;
  }

  it('re-buckets moved triangles into the same grid', () => {
    const collider = buildMeshCollider(cubeTriangles(0.2), undefined, 0.5)!;
    const spec = { origin: collider.origin, cell: collider.cell, dims: collider.dims };
    const moved = shiftX(collider.vertices, 0.5);
    const movedCollider = reindexMeshCollider(moved, spec)!;
    expect(movedCollider.triangleCount).toBe(collider.triangleCount);
    expect(movedCollider.cellStart.length).toBe(collider.cellStart.length);

    const hit = nearestMeshPoint(movedCollider, 0.6, 0.11, 0);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(0.01, 3);
    expect(hit!.side).toBe(1);
  });

  it('returns null when the grid would be empty', () => {
    const spec = { origin: [0, 0, 0] as [number, number, number], cell: 0.05, dims: [0, 0, 0] as [number, number, number] };
    expect(reindexMeshCollider(cubeTriangles(0.2), spec)).toBeNull();
  });
});

describe('buildMeshCollider', () => {
  const collider = buildMeshCollider(cubeTriangles(0.2));

  it('indexes every triangle once per overlapping cell', () => {
    expect(collider).not.toBeNull();
    expect(collider!.triangleCount).toBe(12);
    expect(collider!.cellStart.length).toBe(collider!.dims[0] * collider!.dims[1] * collider!.dims[2] + 1);
    expect(collider!.cellTriangles.length).toBeGreaterThan(0);
  });

  it('returns null for a degenerate input', () => {
    expect(buildMeshCollider(new Float32Array(0))).toBeNull();
  });

  it('keeps the cell edge inside its bounds', () => {
    expect(collider!.cell).toBeGreaterThanOrEqual(0.015);
    expect(collider!.cell).toBeLessThanOrEqual(0.05);
  });
});

describe('nearestMeshPoint', () => {
  const collider = buildMeshCollider(cubeTriangles(0.2))!;

  it('finds the closest surface point outside the body', () => {
    const hit = nearestMeshPoint(collider, 0.15, 0, 0);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(0.05, 4);
    expect(hit!.side).toBe(1);
  });

  it('reports the inner side for a point inside the body, once the search is widened', () => {
    // The centre sits two cells away from every face, beyond the default single ring.
    expect(nearestMeshPoint(collider, 0, 0, 0)).toBeNull();
    const hit = nearestMeshPoint(collider, 0, 0, 0, 2);
    expect(hit!.distance).toBeCloseTo(0.1, 4);
    expect(hit!.side).toBe(-1);
  });

  it('misses when no triangle is within the searched cells', () => {
    expect(nearestMeshPoint(collider, 2, 2, 2)).toBeNull();
  });
});

describe('closestPointOnTriangle', () => {
  // Right triangle in the xy plane; the collide shader mirrors this routine vertex for vertex.
  const a = [0, 0, 0] as const;
  const b = [1, 0, 0] as const;
  const c = [0, 1, 0] as const;
  const out = new Float64Array(3);
  const closest = (x: number, y: number, z: number) => {
    closestPointOnTriangle(x, y, z, ...a, ...b, ...c, out);
    return [out[0], out[1], out[2]].map(v => Number(v.toFixed(6)));
  };

  it('projects a point above the face onto it', () => {
    expect(closest(0.25, 0.25, 2)).toEqual([0.25, 0.25, 0]);
  });

  it('clamps to a vertex outside the corner', () => {
    expect(closest(-1, -1, 0)).toEqual([0, 0, 0]);
  });

  it('clamps to an edge outside the triangle', () => {
    expect(closest(0.5, -1, 0)).toEqual([0.5, 0, 0]);
  });
});

describe('sampleMeshCollider', () => {
  const collider = buildMeshCollider(cubeTriangles(0.2))!;

  it('is negative inside and positive outside', () => {
    expect(sampleMeshCollider(collider, 0, 0, 0)).toBeCloseTo(-0.1, 4);
    expect(sampleMeshCollider(collider, 0.15, 0, 0)).toBeCloseTo(0.05, 4);
  });

  it('clamps points out of search range to the far clearance', () => {
    expect(sampleMeshCollider(collider, 2, 2, 2)).toBeCloseTo(0.25, 6);
  });
});
