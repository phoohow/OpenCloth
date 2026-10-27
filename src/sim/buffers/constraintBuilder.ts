import type { FabricPhysics } from '../../core/model/types';
import type { TriangleMesh } from '../../pattern/triangulate/triangulate';
import { buildAdjacency } from '../../pattern/triangulate/triangulate';

/** GPU constraint: p0, p1, restLength, compliance (16-byte aligned). */
export interface Constraint {
  p0: number;
  p1: number;
  restLength: number;
  compliance: number;
}

/** Constraint groups of a mesh, split by how the solver applies them. */
export interface ConstraintSet {
  structural: Constraint[];
  shear: Constraint[];
  bending: Constraint[];
  seam: Constraint[];
}

/**
 * Maps stiffness to the XPBD compliance the SOLVE shader uses as alpha, normalised to a fixed
 * 60 Hz frame step so substepping cannot change it; `s = 1` is rigid, `s = 0` is free.
 */
function stiffnessToCompliance(stiffness: number, frameDt: number): number {
  const s = Math.min(1, Math.max(0, stiffness));
  const softness = 1e-3 + (1 - s) * (1 - s) * 2;
  return softness / (frameDt * frameDt * 60 * 60);
}

/**
 * Generates structural, shear and bending constraints of a triangle mesh, with rest lengths
 * measured from `positions`, the flat 3D positions [x,y,z,...].
 */
export function buildMeshConstraints(
  positions: Float32Array,
  mesh: TriangleMesh,
  fabric: FabricPhysics,
  dt: number,
): Pick<ConstraintSet, 'structural' | 'shear' | 'bending'> {
  const structural: Constraint[] = [];
  const shear: Constraint[] = [];
  const bending: Constraint[] = [];

  const structuralCompliance = stiffnessToCompliance(fabric.stretchStiffness, dt);
  const shearCompliance = stiffnessToCompliance(fabric.shearStiffness, dt);
  const bendingCompliance = stiffnessToCompliance(fabric.bendingStiffness, dt);

  const getPos = (i: number): [number, number, number] =>
    [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const dist3 = (a: number, b: number): number => {
    const pa = getPos(a), pb = getPos(b);
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
  };

  const edgeSet = new Set<string>();

  // Structural constraints: triangle edges
  const edgeTriangles = new Map<string, number[]>();
  for (let t = 0; t < mesh.triangleCount; t++) {
    const tri = [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const sKey = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!edgeSet.has(sKey)) {
        edgeSet.add(sKey);
        structural.push({ p0: a, p1: b, restLength: dist3(a, b), compliance: structuralCompliance });
      }
      if (!edgeTriangles.has(sKey)) edgeTriangles.set(sKey, []);
      edgeTriangles.get(sKey)!.push(t);
    }
  }

  // Shear constraints: opposite vertices of the two triangles sharing an edge
  const shearSet = new Set<string>();
  for (const [, tris] of edgeTriangles) {
    if (tris.length === 2) {
      const t0 = tris[0], t1 = tris[1];
      const tri0 = [mesh.indices[t0 * 3], mesh.indices[t0 * 3 + 1], mesh.indices[t0 * 3 + 2]];
      const tri1 = [mesh.indices[t1 * 3], mesh.indices[t1 * 3 + 1], mesh.indices[t1 * 3 + 2]];
      const shared = tri0.filter(v => tri1.includes(v));
      const opp0 = tri0.find(v => !shared.includes(v));
      const opp1 = tri1.find(v => !shared.includes(v));
      if (opp0 !== undefined && opp1 !== undefined && opp0 !== opp1) {
        const key = opp0 < opp1 ? `${opp0}_${opp1}` : `${opp1}_${opp0}`;
        if (!shearSet.has(key)) {
          shearSet.add(key);
          shear.push({ p0: opp0, p1: opp1, restLength: dist3(opp0, opp1), compliance: shearCompliance });
        }
      }
    }
  }

  // Bending constraints: opposite vertices across adjacent triangles (two hops)
  const adjacency = buildAdjacency(mesh);
  const bendSet = new Set<string>();
  for (const [t0, t1] of adjacency) {
    const tri0 = [mesh.indices[t0 * 3], mesh.indices[t0 * 3 + 1], mesh.indices[t0 * 3 + 2]];
    const tri1 = [mesh.indices[t1 * 3], mesh.indices[t1 * 3 + 1], mesh.indices[t1 * 3 + 2]];
    const shared = tri0.filter(v => tri1.includes(v));
    if (shared.length === 2) {
      const opp0 = tri0.find(v => !shared.includes(v));
      const opp1 = tri1.find(v => !shared.includes(v));
      if (opp0 !== undefined && opp1 !== undefined && opp0 !== opp1) {
        const key = opp0 < opp1 ? `${opp0}_${opp1}` : `${opp1}_${opp0}`;
        if (!bendSet.has(key)) {
          bendSet.add(key);
          bending.push({ p0: opp0, p1: opp1, restLength: dist3(opp0, opp1), compliance: bendingCompliance });
        }
      }
    }
  }

  return { structural, shear, bending };
}

/**
 * Groups constraints by greedy graph coloring so no two in a batch share a particle,
 * letting the GPU solve each batch in parallel without write conflicts.
 */
export function colorConstraints(constraints: Constraint[], particleCount: number): Constraint[][] {
  if (constraints.length === 0) return [];
  const particleBatches: Set<number>[] = Array.from({ length: particleCount }, () => new Set<number>());
  const batches: Constraint[][] = [];

  for (const c of constraints) {
    let batch = 0;
    while (particleBatches[c.p0].has(batch) || particleBatches[c.p1].has(batch)) batch++;
    if (!batches[batch]) batches[batch] = [];
    batches[batch].push(c);
    particleBatches[c.p0].add(batch);
    particleBatches[c.p1].add(batch);
  }
  return batches;
}

/** Packs constraints into a buffer (4 values each; p0/p1 as u32), written via a Uint32Array view. */
export function packConstraints(constraints: Constraint[]): { data: ArrayBuffer; count: number } {
  const buffer = new ArrayBuffer(constraints.length * 16);
  const u32 = new Uint32Array(buffer);
  const f32 = new Float32Array(buffer);
  constraints.forEach((c, i) => {
    u32[i * 4] = c.p0;
    u32[i * 4 + 1] = c.p1;
    f32[i * 4 + 2] = c.restLength;
    f32[i * 4 + 3] = c.compliance;
  });
  return { data: buffer, count: constraints.length };
}
