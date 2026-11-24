import type { FabricPhysics } from '@/model/types';
import type { PanelMesh } from '@/sim/common';
import type { ClothSimInput, Constraint } from '@/sim/common';

import { distance3At } from '@/base/geom';
import { DEFAULT_CREASE_STIFFNESS } from '@/model';
import { COMPLIANCE_REFERENCE_AREA_M2, complianceMassScale, meanParticleAreaM2 } from '@/sim/common';

export type { Constraint } from '@/sim/common';

const MIN_CREASE_MESH_SCALE = 0.25;

const MAX_CREASE_MESH_SCALE = 4;

export interface ConstraintSet {
  structural: Constraint[];
  shear: Constraint[];
  crease: Constraint[];
  seam: Constraint[];
}

export interface TearPair {
  p0: number;
  p1: number;
  tearLength: number;
}

export function creaseStiffnessOf(fabric: FabricPhysics): number {
  const wanted = fabric.creaseStiffness ?? DEFAULT_CREASE_STIFFNESS;
  return Math.min(1, Math.max(0, wanted));
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function creaseConstraintsForEdges(
  positions: Float32Array,
  mesh: PanelMesh,
  creaseEdges: readonly number[],
  fabric: FabricPhysics,
  dt: number,
  massScale: number,
): Constraint[] {
  const wanted = new Set<string>();
  for (let i = 0; i + 1 < creaseEdges.length; i += 2) {
    const a = creaseEdges[i]!, b = creaseEdges[i + 1]!;
    if (a !== b) wanted.add(pairKey(a, b));
  }

  if (wanted.size === 0) return [];

  const apexes = new Map<string, number[]>();
  for (let t = 0; t < mesh.triangleCount; t++) {
    const tri = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
    for (let e = 0; e < 3; e++) {
      const key = pairKey(tri[e]!, tri[(e + 1) % 3]!);
      if (!wanted.has(key)) continue;
      const list = apexes.get(key);
      if (list) list.push(tri[(e + 2) % 3]!);
      else apexes.set(key, [tri[(e + 2) % 3]!]);
    }
  }

  const compliance = creaseCompliance(
    creaseStiffnessOf(fabric), dt, massScale, meanParticleAreaM2(mesh),
  );
  const getPos = (i: number): [number, number, number] =>
    [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
  const creased = new Set<string>();
  const constraints: Constraint[] = [];
  for (const list of apexes.values()) {
    if (list.length < 2) continue;
    const a = list[0]!, b = list[1]!;
    if (a === b) continue;
    const pair = pairKey(a, b);
    if (creased.has(pair)) continue;
    creased.add(pair);
    const pa = getPos(a), pb = getPos(b);
    constraints.push({
      p0: a,
      p1: b,
      restLength: Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]),
      compliance,
    });
  }

  return constraints;
}

function stiffnessToCompliance(stiffness: number, frameDt: number, massScale: number): number {
  const s = Math.min(1, Math.max(0, stiffness));
  const softness = 1e-3 + (1 - s) * (1 - s) * 2;
  return softness / (frameDt * frameDt * 60 * 60) * massScale;
}

function creaseCompliance(stiffness: number, frameDt: number, massScale: number, particleArea: number): number {
  const meshScale = Math.min(
    MAX_CREASE_MESH_SCALE,
    Math.max(MIN_CREASE_MESH_SCALE, particleArea / COMPLIANCE_REFERENCE_AREA_M2),
  );
  return stiffnessToCompliance(stiffness, frameDt, massScale) * meshScale;
}

export function buildMeshConstraints(
  positions: Float32Array,
  mesh: PanelMesh,
  fabric: FabricPhysics,
  dt: number,
  massScale: number,
): Pick<ConstraintSet, 'structural' | 'shear'> {
  const structural: Constraint[] = [];
  const shear: Constraint[] = [];

  const structuralCompliance = stiffnessToCompliance(fabric.stretchStiffness, dt, massScale);
  const shearCompliance = stiffnessToCompliance(fabric.shearStiffness, dt, massScale);

  const getPos = (i: number): [number, number, number] =>
    [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const dist3 = (a: number, b: number): number => {
    const pa = getPos(a), pb = getPos(b);
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
  };

  const edgeSet = new Set<string>();

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

  return { structural, shear };
}

function creaseEdgesAt(
  input: ClothSimInput,
  creases: readonly (readonly number[])[] | undefined,
  slot: number,
): readonly number[] {
  return creases?.[slot] ?? input.panels[slot]!.creaseEdges ?? [];
}

export function buildPanelConstraints(
  input: ClothSimInput,
  physics: FabricPhysics[],
  dt: number,
  creases?: readonly (readonly number[])[],
): { structural: Constraint[]; shear: Constraint[]; crease: Constraint[] } {
  const structural: Constraint[] = [];
  const shear: Constraint[] = [];
  const crease: Constraint[] = [];

  input.panels.forEach((panel, slot) => {
    const massScale = complianceMassScale(panel.mesh);
    const meshConstraints = buildMeshConstraints(panel.positions3D, panel.mesh, physics[slot]!, dt, massScale);
    const offset = (arr: Constraint[]) => arr.map(c => ({
      ...c, p0: c.p0 + panel.vertexOffset, p1: c.p1 + panel.vertexOffset,
    }));
    structural.push(...offset(meshConstraints.structural));
    shear.push(...offset(meshConstraints.shear));
    crease.push(...offset(creaseConstraintsForEdges(
      panel.positions3D, panel.mesh, creaseEdgesAt(input, creases, slot), physics[slot]!, dt, massScale,
    )));
  });
  return { structural, shear, crease };
}

export function buildCreaseConstraints(
  input: ClothSimInput,
  physics: FabricPhysics[],
  dt: number,
  creases?: readonly (readonly number[])[],
): Constraint[] {
  const crease: Constraint[] = [];
  input.panels.forEach((panel, slot) => {
    const massScale = complianceMassScale(panel.mesh);
    const local = creaseConstraintsForEdges(
      panel.positions3D, panel.mesh, creaseEdgesAt(input, creases, slot), physics[slot]!, dt, massScale,
    );
    for (const c of local) crease.push({ ...c, p0: c.p0 + panel.vertexOffset, p1: c.p1 + panel.vertexOffset });
  });
  return crease;
}

export function pairSeparation(
  pair: { readonly p0: number; readonly p1: number },
  positions: Float32Array,
  particleCount: number,
): number | null {
  const { p0, p1 } = pair;
  if (p0 < 0 || p1 < 0 || p0 >= particleCount || p1 >= particleCount) return null;
  const distance = distance3At(positions, p0, p1);
  return Number.isFinite(distance) ? distance : null;
}

export function tornSeamPairs(
  positions: Float32Array,
  pairs: ReadonlyArray<TearPair>,
): Set<number> {
  const particleCount = Math.floor(positions.length / 3);
  const torn = new Set<number>();
  pairs.forEach((pair, index) => {
    if (!Number.isFinite(pair.tearLength) || pair.tearLength <= 0) return;
    const distance = pairSeparation(pair, positions, particleCount);
    if (distance !== null && distance > pair.tearLength) torn.add(index);
  });
  return torn;
}
