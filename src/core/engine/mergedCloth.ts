import type { Dart, Pattern, Project, Seam } from '../model/types';
import type { PanelMesh } from '../../pattern/panel/panelBuilder';
import { edgeVertexRun, meshSpacingCm, panelCreaseEdges, toTriangleMesh } from '../../pattern/panel/panelBuilder';
import type { ClothSimInput } from '../../sim/clothSimulator';
import type { Constraint } from '../../sim/buffers/constraintBuilder';
import type { TriangleMesh } from '../../pattern/triangulate/triangulate';
import { fabricForPanel } from '../model/fabric';
import { panelCollisionLayer, panelThicknessCm } from '../model/layers';
import { collapseSeamPairs, type VertexRef } from '../../pattern/drape/sewnTargets';
import { seamBreakStretch } from '../../sim/seamStrength';
import { FALLBACK_PHYSICS } from './clothConstants';
import { flatRestPositions, initialPositions3D, posedPositions3D, type BodyLandmarkCache } from './initialPose';

/** Compliance of a stitched dart leg pair, as strong as a fully tight seam. */
const DART_STITCH_STRENGTH = 1;

/** One merged particle pair stitched together, by a seam or by a closing dart. */
export interface SeamPair {
  p0: number;
  p1: number;
  /** Gap between the pair in the initial layout, in meters. */
  open: number;
  /** Seam record the pair belongs to, or the dart record when it stitches dart legs. */
  seamId: string;
  /** Dart whose two legs the pair stitches; set instead of a seam pairing. */
  dartId?: string;
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
  /** Wrapped (unsewn but posed) merged positions, kept so closing changes can rebuild the dress targets. */
  private wrappedPositions: Float32Array = new Float32Array(0);

  /** Merges the panel meshes into one simulation input and rebuilds every derived map. */
  build(project: Project, panelMeshes: Map<string, PanelMesh>, landmarks: BodyLandmarkCache): ClothSimInput | null {
    this.input = null;
    this.positions = new Float32Array(0);
    this.dressPositions = new Float32Array(0);
    this.wrappedPositions = new Float32Array(0);
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
    const panelIds = Array.from(panelMeshes.keys());

    let vertexOffset = 0;
    let indexOffset = 0;
    for (const panelId of panelIds) {
      const mesh = panelMeshes.get(panelId)!;
      const panel = project.pattern.panels[panelId];
      const posed = posedPositions3D(mesh, panel, landmarks.resolve(project.avatar.params));
      const start = initialPositions3D(posed, panel);

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

      const triangleMesh = toTriangleMesh(mesh);
      const creaseEdges = panelCreaseEdges(project.pattern, panelId, triangleMesh);
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
        collisionLayer: panelCollisionLayer(panel),
        thicknessMeters: panelThicknessCm(project, panel) / 100,
        ...(creaseEdges.length > 0 ? { creaseEdges } : {}),
      });
      this.panelRanges.set(panelId, [vertexOffset, vertexOffset + mesh.vertexCount]);

      vertexOffset += mesh.vertexCount;
      indexOffset += mesh.indices.length;
    }

    this.positions = initial;
    this.wrappedPositions = wrapped;
    const seamConstraints = this.buildClosingConstraints(project, panelMeshes, panelIds);
    // Sewn pairs share one target point, so the dressing glide and the closed seams agree.
    this.dressPositions = sewnTargets(wrapped, this.seamPairs);

    this.input = {
      positions: initial,
      indices,
      panels,
      seamConstraints,
      particleCount: totalVertices,
      triangleCount: totalTriangles,
    };
    return this.input;
  }

  /**
   * Re-reads the seam pairings, the closing dart legs and the fold crease lines onto the merged
   * layout without touching particles, triangles or rest positions. False when the panel meshes no
   * longer match the merged ranges, which needs a full `build`.
   */
  refreshConstraintSets(project: Project, panelMeshes: Map<string, PanelMesh>): boolean {
    const input = this.input;
    if (!input) return false;
    const panelIds = input.panels.map(panel => panel.panelId);
    for (const panelId of panelIds) {
      const mesh = panelMeshes.get(panelId);
      const range = this.panelRanges.get(panelId);
      if (!mesh || !range || range[1] - range[0] !== mesh.vertexCount) return false;
    }

    for (const panel of input.panels) {
      const edges = panelCreaseEdges(project.pattern, panel.panelId, panel.mesh);
      if (edges.length > 0) panel.creaseEdges = edges;
      else delete panel.creaseEdges;
    }
    input.seamConstraints = this.buildClosingConstraints(project, panelMeshes, panelIds);
    this.dressPositions = sewnTargets(this.wrappedPositions, this.seamPairs);
    return true;
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

  /**
   * Constraints that pull edge runs together: seam pairings and the legs of darts marked closing.
   * Fills `seamPairs` in the same order as the returned constraints.
   */
  private buildClosingConstraints(
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
      // An open edge marks intent only; its sides stay unstitched.
      if (seam.type === 'free') continue;
      const a = edgeToPanel.get(seam.a.edgeId);
      const b = edgeToPanel.get(seam.b.edgeId);
      if (!a || !b) continue;

      const offA = vertexOffsets.get(a.panelId) ?? 0;
      const offB = vertexOffsets.get(b.panelId) ?? 0;
      const vertsA = intervalVertices(a.vertices, seam.a.t0, seam.a.t1, this.positions, offA);
      const vertsBRaw = intervalVertices(b.vertices, seam.b.t0, seam.b.t1, this.positions, offB);
      const vertsB = seam.flip ? [...vertsBRaw].reverse() : vertsBRaw;
      if (vertsA.length === 0 || vertsB.length === 0) continue;

      // Anchor pairs split the run into two independently mapped sections.
      let sections: Array<[number[], number[]]>;
      if (seam.a.anchorT !== undefined && seam.b.anchorT !== undefined) {
        const sa = splitAtAnchor(vertsA, seam.a.anchorT, seam.a.t0, seam.a.t1);
        const sb = splitAtAnchor(vertsB, seam.b.anchorT, seam.b.t0, seam.b.t1);
        sections = sa.length === 2 && sb.length === 2
          ? [[sa[0], sb[0]], [sa[1], sb[1]]]
          : [[vertsA, vertsB]];
      } else {
        sections = [[vertsA, vertsB]];
      }

      // Rest length starts at the flat-layout gap so a closed seam carries no initial stress.
      // Gather seams pull B toward A by their ratio, giving the eased fullness.
      const restOf = seam.type === 'gather' && seam.gatherRatio
        ? (gap: number): number => gap * seam.gatherRatio!
        : (gap: number): number => gap;
      const compliance = 1.0 / (Math.max(seam.strength, 0.01) * 3600);
      const tearFactor = seamBreakStretch(seam.strength);
      for (const [secA, secB] of sections) {
        this.stitchRun(secA, secB, offA, offB, restOf, compliance, seam.id, undefined, tearFactor, constraints);
      }
    }

    for (const panelId of panelIds) {
      const panel = pattern.panels[panelId];
      const panelMesh = panelMeshes.get(panelId);
      if (!panel || !panelMesh) continue;
      const off = vertexOffsets.get(panelId) ?? 0;
      for (const dartId of panel.dartIds) {
        const dart = pattern.darts[dartId];
        if (!dart?.closing) continue;
        const [legA, legB] = dartLegRuns(pattern, dart, toTriangleMesh(panelMesh));
        if (legA.length === 0 || legB.length === 0) continue;
        // The legs meet at the tip, so reversing one run pairs base to base and tip to tip.
        this.stitchRun(legA, [...legB].reverse(), off, off, () => 0,
          1.0 / (DART_STITCH_STRENGTH * 3600), dartId, dartId, undefined, constraints);
      }
    }
    return constraints;
  }

  /**
   * Pairs two vertex runs at equal arc-length fractions and records one closing constraint per
   * pair. Pairing by distance along the seam instead of by index keeps a shorter edge from
   * bunching its vertices against the long edge's corners. Every vertex of both runs ends up
   * paired, so a closed seam has no unstitched stretch left to open into a gap.
   */
  private stitchRun(
    vertsA: number[],
    vertsB: number[],
    offA: number,
    offB: number,
    restOf: (gap: number) => number,
    compliance: number,
    seamId: string,
    dartId: string | undefined,
    tearFactor: number | undefined,
    constraints: Constraint[],
  ): void {
    const fractionsA = arcFractions(this.positions, vertsA, offA);
    const fractionsB = arcFractions(this.positions, vertsB, offB);
    const pairs: Array<[number, number]> = [];
    const seen = new Set<string>();
    const addPair = (ia: number, ib: number): void => {
      const key = `${ia}_${ib}`;
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push([ia, ib]);
    };

    // Shared fractions first, so both runs advance together along the seam.
    const steps = Math.max(fractionsA.length, fractionsB.length);
    let ia = 0;
    let ib = 0;
    for (let i = 0; i < steps; i++) {
      const f = steps === 1 ? 0 : i / (steps - 1);
      ia = nearestFraction(fractionsA, f, ia);
      ib = nearestFraction(fractionsB, f, ib);
      addPair(ia, ib);
    }
    // The uneven run has leftover vertices; each of them still needs a stitch.
    for (let i = 0; i < fractionsA.length; i++) addPair(i, nearestFraction(fractionsB, fractionsA[i]!, 0));
    for (let j = 0; j < fractionsB.length; j++) addPair(nearestFraction(fractionsA, fractionsB[j]!, 0), j);

    for (const [pairA, pairB] of pairs) {
      const p0 = vertsA[pairA]! + offA, p1 = vertsB[pairB]! + offB;
      const gap = distance(this.positions, p0, p1);
      this.seamPairs.push({ p0, p1, open: gap, seamId, ...(dartId ? { dartId } : {}) });
      constraints.push({
        p0, p1, restLength: restOf(gap), compliance,
        ...(tearFactor !== undefined ? { tearLength: gap * tearFactor } : {}),
      });
    }
  }
}

/** Arc-length fraction of every vertex along a run, from 0 at its first vertex to 1 at its last. */
function arcFractions(positions: Float32Array, vertices: number[], offset: number): number[] {
  if (vertices.length === 0) return [];
  if (vertices.length === 1) return [0];
  const acc = [0];
  for (let i = 1; i < vertices.length; i++) {
    acc.push(acc[i - 1]! + distance(positions, offset + vertices[i - 1]!, offset + vertices[i]!));
  }
  const total = acc[acc.length - 1]! || 1;
  return acc.map(value => value / total);
}

/** Index of the fraction closest to `target`, searching forward from `from` to stay monotone. */
function nearestFraction(fractions: number[], target: number, from: number): number {
  let best = Math.min(Math.max(from, 0), fractions.length - 1);
  for (let i = best + 1; i < fractions.length; i++) {
    if (Math.abs(fractions[i]! - target) <= Math.abs(fractions[best]! - target)) best = i;
    else break;
  }
  return best;
}

/**
 * Vertex runs of a dart's two legs on its panel mesh, sampled at the mesh's own spacing so the
 * fabric eases toward the tip instead of stitching only the two leg endpoints.
 */
function dartLegRuns(pattern: Pattern, dart: Dart, mesh: TriangleMesh): [number[], number[]] {
  const spacing = meshSpacingCm(mesh);
  return [
    edgeVertexRun(pattern, dart.edge1Id, mesh, spacing),
    edgeVertexRun(pattern, dart.edge2Id, mesh, spacing),
  ];
}

/** Vertex indices of the boundary run whose arc-length fraction lies inside [t0, t1]. */
function intervalVertices(
  vertices: number[], t0: number, t1: number, positions: Float32Array, offset: number,
): number[] {
  if ((t0 === 0 && t1 === 1) || vertices.length < 2) return vertices;
  const acc = [0];
  for (let i = 1; i < vertices.length; i++) {
    acc.push(acc[i - 1] + distance(positions, offset + vertices[i - 1], offset + vertices[i]));
  }
  const total = acc[acc.length - 1] || 1;
  const out: number[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const f = acc[i] / total;
    if (f >= Math.min(t0, t1) - 1e-9 && f <= Math.max(t0, t1) + 1e-9) out.push(vertices[i]);
  }
  return out.length >= 2 ? out : vertices;
}

/** Splits a vertex run into the parts before and after an anchor fraction. */
function splitAtAnchor(vertices: number[], anchorT: number, t0: number, t1: number): number[][] {
  const span = Math.abs(t1 - t0) || 1;
  const local = (anchorT - Math.min(t0, t1)) / span;
  const cut = Math.max(1, Math.min(vertices.length - 1, Math.round(local * vertices.length)));
  const first = vertices.slice(0, cut + 1);
  const second = vertices.slice(cut);
  return first.length >= 2 && second.length >= 2 ? [first, second] : [vertices];
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
