import earcut from 'earcut';
import type { Vec2 } from '../../core/model/types';
import { distance } from '../geom/vec2';

/** Triangles over a flat [x, y, ...] polygon-space vertex buffer. */
export interface TriangleMesh {
  /** Vertices as a flat array [x0, y0, x1, y1, ...] */
  positions: Float32Array;
  /** Triangle vertex indices */
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

/** Triangulates a closed polygon with optional holes via ear clipping. */
export function triangulatePolygon(outline: Vec2[], holes: Vec2[][] = []): TriangleMesh {
  const flat: number[] = [];
  const holeIndices: number[] = [];

  for (const p of outline) flat.push(p.x, p.y);
  for (const hole of holes) {
    holeIndices.push(flat.length / 2);
    for (const p of hole) flat.push(p.x, p.y);
  }

  const indices = earcut(flat, holeIndices.length ? holeIndices : undefined, 2);
  const positions = new Float32Array(flat);

  return {
    positions,
    indices: new Uint32Array(indices),
    vertexCount: flat.length / 2,
    triangleCount: indices.length / 3,
  };
}

/**
 * Conforming isotropic refinement: every edge longer than `targetEdgeLength * 1.5`
 * is split at its midpoint, and both triangles sharing an edge use the same midpoint
 * vertex, so the mesh stays crack-free under 3D deformation.
 */
export function refineMesh(
  mesh: TriangleMesh,
  targetEdgeLength: number,
  maxIterations = 8,
): TriangleMesh {
  const positions = Array.from(mesh.positions);
  let indices = Array.from(mesh.indices);
  const splitThreshold = targetEdgeLength * 1.5;

  // One cache for all passes: a split edge keeps the same midpoint vertex forever.
  const midpointCache = new Map<string, number>();

  const getPos = (idx: number): Vec2 => ({ x: positions[idx * 2], y: positions[idx * 2 + 1] });

  const getMidpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const pa = getPos(a), pb = getPos(b);
    positions.push((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
    const mid = positions.length / 2 - 1;
    midpointCache.set(key, mid);
    return mid;
  };

  for (let iter = 0; iter < maxIterations; iter++) {
    let refined = false;
    const newIndices: number[] = [];

    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      const pa = getPos(a), pb = getPos(b), pc = getPos(c);
      const splitAB = distance(pa, pb) > splitThreshold;
      const splitBC = distance(pb, pc) > splitThreshold;
      const splitCA = distance(pc, pa) > splitThreshold;

      if (!splitAB && !splitBC && !splitCA) {
        newIndices.push(a, b, c);
        continue;
      }
      refined = true;

      const mAB = splitAB ? getMidpoint(a, b) : -1;
      const mBC = splitBC ? getMidpoint(b, c) : -1;
      const mCA = splitCA ? getMidpoint(c, a) : -1;
      const count = (splitAB ? 1 : 0) + (splitBC ? 1 : 0) + (splitCA ? 1 : 0);

      if (count === 1) {
        // One split edge: bisect into two triangles.
        if (splitAB) newIndices.push(a, mAB, c, mAB, b, c);
        else if (splitBC) newIndices.push(b, mBC, a, mBC, c, a);
        else newIndices.push(c, mCA, b, mCA, a, b);
      } else if (count === 2) {
        // Two split edges: corner triangle at the shared vertex plus two others.
        if (splitAB && splitBC) {
          newIndices.push(a, mAB, c, mAB, b, mBC, mAB, mBC, c);
        } else if (splitBC && splitCA) {
          newIndices.push(b, mBC, a, mBC, c, mCA, mBC, mCA, a);
        } else {
          newIndices.push(c, mCA, b, mCA, a, mAB, mCA, mAB, b);
        }
      } else {
        // All three split: red refinement into four congruent triangles.
        newIndices.push(a, mAB, mCA, mAB, b, mBC, mCA, mBC, c, mAB, mBC, mCA);
      }
    }

    indices = newIndices;
    if (!refined) break;
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 2,
    triangleCount: indices.length / 3,
  };
}

/** Extracts edges that belong to only one triangle. */
export function extractBoundaryEdges(mesh: TriangleMesh): Array<[number, number]> {
  const edgeCount = new Map<string, number>();
  const edges: Array<[number, number]> = [];

  for (let t = 0; t < mesh.indices.length; t += 3) {
    const tri = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }

  for (const [key, count] of edgeCount) {
    if (count === 1) {
      const [a, b] = key.split('_').map(Number);
      edges.push([a, b]);
    }
  }
  return edges;
}

/** Pairs of triangles that share an edge. */
export function buildAdjacency(mesh: TriangleMesh): Array<[number, number]> {
  const edgeToTri = new Map<string, number>();
  const pairs: Array<[number, number]> = [];

  for (let t = 0; t < mesh.triangleCount; t++) {
    const tri = [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]];
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const existing = edgeToTri.get(key);
      if (existing !== undefined) {
        pairs.push([existing, t]);
      } else {
        edgeToTri.set(key, t);
      }
    }
  }
  return pairs;
}
