import { describe, expect, it } from 'vitest';
import {
  buildMeshCollider, closestPointOnTriangle, nearestMeshPoint, nearestMeshPointWithin,
  pushOutOfBody, reindexMeshCollider, sampleMeshCollider,
} from '@/avatar/collider/meshCollider';
import { liftBuriedPositions } from '@/sim/solver/lift';

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
    expect(nearestMeshPoint(collider, 0, 0, 0)).toBeNull();
    const hit = nearestMeshPoint(collider, 0, 0, 0, 2);
    expect(hit!.distance).toBeCloseTo(0.1, 4);
    expect(hit!.side).toBe(-1);
  });

  it('misses when no triangle is within the searched cells', () => {
    expect(nearestMeshPoint(collider, 2, 2, 2)).toBeNull();
  });
});

describe('nearestMeshPointWithin', () => {
  const collider = buildMeshCollider(cubeTriangles(0.2))!;

  it('finds a face buried deeper than one cell', () => {
    expect(nearestMeshPoint(collider, 0, 0, 0, 1)).toBeNull();
    const hit = nearestMeshPointWithin(collider, 0, 0, 0);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(0.1, 4);
    expect(hit!.side).toBe(-1);
  });

  it('keeps the plain hit for a point outside', () => {
    const hit = nearestMeshPointWithin(collider, 0.15, 0, 0);
    expect(hit!.distance).toBeCloseTo(0.05, 4);
    expect(hit!.side).toBe(1);
  });
});

describe('pushOutOfBody', () => {
  const collider = buildMeshCollider(cubeTriangles(0.2))!;

  it('lifts a buried point onto the surface plus the clearance', () => {
    const pushed = pushOutOfBody(collider, 0, 0, 0, 0.006)!;
    expect(pushed).not.toBeNull();
    const distance = Math.hypot(pushed[0], pushed[1], pushed[2]);
    expect(distance).toBeCloseTo(0.106, 3);
  });

  it('leaves a point that already clears the surface alone', () => {
    expect(pushOutOfBody(collider, 0.15, 0, 0, 0.006)).toBeNull();
  });

  it('lifts every buried position of a grid in one pass', () => {
    const positions = new Float32Array(27 * 3);
    let slot = 0;
    for (const y of [-0.04, 0, 0.04]) {
      for (const x of [-0.04, 0, 0.04]) {
        for (const z of [-0.04, 0, 0.04]) {
          positions[slot * 3] = x;
          positions[slot * 3 + 1] = y;
          positions[slot * 3 + 2] = z;
          slot++;
        }
      }
    }

    const moved = liftBuriedPositions(collider, positions, () => 0.006);
    expect(moved).toBe(27);
    for (let i = 0; i < 27; i++) {
      expect(sampleMeshCollider(collider, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]))
        .toBeGreaterThan(0);
    }
  });
});

describe('closestPointOnTriangle', () => {
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
