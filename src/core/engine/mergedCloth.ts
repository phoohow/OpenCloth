import type { Project, Seam } from '../model/types';
import type { PanelMesh } from '../../pattern/panel/panelBuilder';
import type { ClothSimInput } from '../../sim/clothSimulator';
import type { Constraint } from '../../sim/buffers/constraintBuilder';
import type { TriangleMesh } from '../../pattern/triangulate/triangulate';
import { fabricForPanel } from '../model/fabric';
import { collapseSeamPairs, type VertexRef } from '../../pattern/drape/sewnTargets';
import { FALLBACK_PHYSICS } from './clothConstants';
import { flatRestPositions, initialPositions3D, posedPositions3D, topBandParticles, type BodyLandmarkCache } from './initialPose';

/** One panel's seam pair, in merged particle indices; `open` is its gap in the initial layout. */
export interface SeamPair {
  p0: number;
  p1: number;
  open: number;
  /** Seam record the pair belongs to. */
  seamId: string;
}

/** Cloth built from every panel mesh: merged simulation input plus the index maps panels share. */
export class MergedCloth {
  /** Simulation input covering all panels. */
  input: ClothSimInput | null = null;
  /** Initial (unsewn) merged particle positions in meters, shared with the render mesh. */
  positions: Float32Array = new Float32Array(0);
  /** Wrapped positions with every seam pair collapsed onto one point; the dressing glide aims here. */
  dressPositions: Float32Array = new Float32Array(0);
  /** panelId → [startVertex, endVertex) in the merged particle array. */
  panelRanges: Map<string, [number, number]> = new Map();
  /** panelId → merged vertex indices of the panel's triangles. */
  panelTriangles: Map<string, number[]> = new Map();
  /** Owning panel of each merged triangle, indexed by triangle number. */
  trianglePanelIds: (string | null)[] = [];
  /** Seam pairs, in the same order as the simulation's seam constraints. */
  seamPairs: SeamPair[] = [];

  /** Merges the panel meshes into one simulation input and rebuilds every derived map. */
  build(project: Project, panelMeshes: Map<string, PanelMesh>, landmarks: BodyLandmarkCache): ClothSimInput | null {
    this.input = null;
    this.positions = new Float32Array(0);
    this.dressPositions = new Float32Array(0);
    this.panelRanges.clear();
    this.panelTriangles.clear();
    this.trianglePanelIds = [];
    this.seamPairs = [];

    let totalVertices = 0;
    let totalTriangles = 0;
    for (const mesh of panelMeshes.values()) {
      totalVertices += mesh.vertexCount;
      totalTriangles += mesh.triangleCount;
    }
    if (totalVertices === 0) return null;

    const wrapped = new Float32Array(totalVertices * 3);
    const initial = new Float32Array(totalVertices * 3);
    const indices = new Uint32Array(totalTriangles * 3);
    const uvs = new Float32Array(totalVertices * 2);
    const panels: ClothSimInput['panels'] = [];
    const pinnedIndices: number[] = [];
    const panelIds = Array.from(panelMeshes.keys());

    let vertexOffset = 0;
    let indexOffset = 0;
    for (const panelId of panelIds) {
      const mesh = panelMeshes.get(panelId)!;
      const panel = project.pattern.panels[panelId];
      const posed = posedPositions3D(mesh, panel, landmarks.resolve(project.avatar.params));
      const start = initialPositions3D(posed, panel);

      for (const local of topBandParticles(mesh, panel)) pinnedIndices.push(vertexOffset + local);

      for (let i = 0; i < mesh.vertexCount; i++) {
        const src = i * 3;
        const dst = (vertexOffset + i) * 3;
        wrapped[dst] = posed[src]; wrapped[dst + 1] = posed[src + 1]; wrapped[dst + 2] = posed[src + 2];
        initial[dst] = start[src]; initial[dst + 1] = start[src + 1]; initial[dst + 2] = start[src + 2];
        mergedUVsFrom(uvs, mesh, i, vertexOffset);
      }
      for (let i = 0; i < mesh.indices.length; i++) {
        indices[indexOffset + i] = mesh.indices[i] + vertexOffset;
      }

      const triangleMesh: TriangleMesh = {
        positions: mesh.positions2D,
        indices: mesh.indices,
        vertexCount: mesh.vertexCount,
        triangleCount: mesh.triangleCount,
      };
      this.panelTriangles.set(panelId, offsetTriangleList(mesh, vertexOffset));
      const firstTriangle = indexOffset / 3;
      for (let t = 0; t < mesh.triangleCount; t++) this.trianglePanelIds[firstTriangle + t] = panelId;

      panels.push({
        panelId,
        vertexOffset,
        mesh: triangleMesh,
        positions3D: start,
        restPositions: flatRestPositions(mesh),
        physics: fabricForPanel(project, panelId)?.physics ?? FALLBACK_PHYSICS,
      });
      this.panelRanges.set(panelId, [vertexOffset, vertexOffset + mesh.vertexCount]);

      vertexOffset += mesh.vertexCount;
      indexOffset += mesh.indices.length;
    }

    this.positions = initial;
    const seamConstraints = this.buildSeamConstraints(project, panelMeshes, panelIds);
    // Sewn pairs share one target point, so the dressing glide and the closed seams agree.
    this.dressPositions = sewnTargets(wrapped, this.seamPairs);

    return {
      positions: initial,
      indices,
      panels,
      seamConstraints,
      pinnedIndices,
      particleCount: totalVertices,
      triangleCount: totalTriangles,
    };
  }

  /** Panel owning a particle, or null when unmapped. */
  panelIdForParticle(particleIndex: number): string | null {
    for (const [panelId, range] of this.panelRanges) {
      if (particleIndex >= range[0] && particleIndex < range[1]) return panelId;
    }
    return null;
  }

  /** Merged vertex indices of the listed panels' triangles, concatenated in selection order. */
  overlayTriangles(panelIds: string[]): Uint32Array {
    let total = 0;
    for (const id of panelIds) total += this.panelTriangles.get(id)?.length ?? 0;
    const triangles = new Uint32Array(total);
    let cursor = 0;
    for (const id of panelIds) {
      const list = this.panelTriangles.get(id);
      if (!list) continue;
      triangles.set(list, cursor);
      cursor += list.length;
    }
    return triangles;
  }

  /** Seam constraints as particle pairs across panels, filling `seamPairs` as a side effect. */
  private buildSeamConstraints(
    project: Project,
    panelMeshes: Map<string, PanelMesh>,
    panelIds: string[],
  ): Constraint[] {
    const constraints: Constraint[] = [];
    this.seamPairs = [];
    const pattern = project.pattern;

    const edgeToPanel = new Map<string, { panelId: string; vertices: number[] }>();
    for (const panelId of panelIds) {
      const mesh = panelMeshes.get(panelId);
      if (!mesh) continue;
      for (const [edgeId, verts] of mesh.edgeVertexMap) {
        edgeToPanel.set(edgeId, { panelId, vertices: verts });
      }
    }

    const vertexOffsets = new Map<string, number>();
    let offset = 0;
    for (const panelId of panelIds) {
      vertexOffsets.set(panelId, offset);
      offset += panelMeshes.get(panelId)?.vertexCount ?? 0;
    }

    for (const seam of Object.values(pattern.seams) as Seam[]) {
      const a = edgeToPanel.get(seam.edgeAId);
      const b = edgeToPanel.get(seam.edgeBId);
      if (!a || !b) continue;

      const offA = vertexOffsets.get(a.panelId) ?? 0;
      const offB = vertexOffsets.get(b.panelId) ?? 0;
      const vertsA = a.vertices;
      const vertsB = seam.flipB ? [...b.vertices].reverse() : b.vertices;

      // Pair vertices by arc-length fraction along each edge.
      const n = Math.max(vertsA.length, vertsB.length);
      for (let i = 0; i < n; i++) {
        const ia = vertsA[Math.min(Math.floor(i * vertsA.length / n), vertsA.length - 1)];
        const ib = vertsB[Math.min(Math.floor(i * vertsB.length / n), vertsB.length - 1)];
        if (ia === undefined || ib === undefined) continue;
        const p0 = ia + offA, p1 = ib + offB;
        const gap = distance(this.positions, p0, p1);
        this.seamPairs.push({ p0, p1, open: gap, seamId: seam.id });
        constraints.push({
          p0,
          p1,
          // Rest length starts at the flat-layout gap so a closed seam carries no initial stress.
          restLength: gap,
          compliance: 1.0 / (Math.max(seam.strength, 0.01) * 3600),
        });
      }
    }
    return constraints;
  }
}

/** Distance between two merged particles. */
function distance(positions: Float32Array, a: number, b: number): number {
  return Math.hypot(
    positions[a * 3] - positions[b * 3],
    positions[a * 3 + 1] - positions[b * 3 + 1],
    positions[a * 3 + 2] - positions[b * 3 + 2],
  );
}

/** Copies one particle's pair of UV coordinates into the merged buffer. */
function mergedUVsFrom(uvs: Float32Array, mesh: PanelMesh, i: number, vertexOffset: number): void {
  uvs[(vertexOffset + i) * 2] = mesh.uvs[i * 2];
  uvs[(vertexOffset + i) * 2 + 1] = mesh.uvs[i * 2 + 1];
}

/** Merged vertex indices of every triangle in a panel mesh. */
function offsetTriangleList(mesh: PanelMesh, vertexOffset: number): number[] {
  const list: number[] = [];
  for (let t = 0; t < mesh.triangleCount; t++) {
    list.push(
      mesh.indices[t * 3] + vertexOffset,
      mesh.indices[t * 3 + 1] + vertexOffset,
      mesh.indices[t * 3 + 2] + vertexOffset,
    );
  }
  return list;
}

/** Collapses every seam pair of the wrapped pose onto one shared point, pass by pass. */
function sewnTargets(wrapped: Float32Array, seamPairs: SeamPair[]): Float32Array {
  const out = wrapped.slice();
  const ref = (index: number): VertexRef => ({ positions: out, index });
  collapseSeamPairs(seamPairs.map(p => [ref(p.p0), ref(p.p1)]));
  return out;
}
