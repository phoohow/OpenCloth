import { distance3At as distance } from '@/base/geom';
import type { Dart, Pattern, Project, Seam } from '@/model/types';
import type { PanelMesh } from '@/pattern/panel';
import { edgeVertexRun, meshSpacingCm, panelCreaseEdges, toTriangleMesh } from '@/pattern/panel';
import type { TriangleMesh } from '@/pattern/triangulate';
import type { ClothSimInput, Constraint } from '@/sim';
import type { SeamPair } from '@/runtime/seamPair';
import { ParticleLayout, type PanelSlice } from '@/runtime/particleLayout';
import { fabricForPanel } from '@/model';
import { panelCollisionLayer, panelThicknessCm } from '@/model';
import { collapseSeamPairs, drapeReversesWinding, planWraps, type VertexRef } from '@/pattern/drape';
import { complianceMassScale, seamBreakStretch } from '@/sim';
import { FALLBACK_PHYSICS } from '@/runtime/clothConstants';
import { flatRestPositions, posedPositions3D, type BodyLandmarkCache } from '@/runtime/initialPose';

/** Compliance of a stitched dart leg pair, as strong as a fully tight seam. */
const DART_STITCH_STRENGTH = 1;

/**
 * Every panel merged into one cloth: the particle space, the triangle ownership and the
 * constraints that stitch pieces together. This is the only object that knows a panel occupies
 * a contiguous slice of the merged arrays.
 */
export class ClothAssembly {
  /** Simulation input covering all panels. */
  input: ClothSimInput | null = null;
  /** Panels and their slices, in merge order. */
  layout: ParticleLayout = ParticleLayout.of([], 0);
  /** Unsewn merged particle positions in meters: the wrapped pose on the body proxy. */
  positions: Float32Array = new Float32Array(0);
  /** Wrapped positions with every seam pair collapsed onto one point; the dressing glide aims here. */
  dressPositions: Float32Array = new Float32Array(0);
  /** panelId → merged vertex indices of the panel's triangles. */
  panelTriangles: Map<string, number[]> = new Map();
  /** Owning panel of each merged triangle, indexed by triangle number. */
  trianglePanelIds: (string | null)[] = [];
  /** Seam pairs, in the same order as the simulation's seam constraints. */
  seamPairs: SeamPair[] = [];

  /** Merges the panel meshes into one simulation input and rebuilds every derived map. */
  build(project: Project, panelMeshes: Map<string, PanelMesh>, landmarks: BodyLandmarkCache): ClothSimInput | null {
    this.reset();

    let totalVertices = 0;
    let totalTriangles = 0;
    for (const mesh of panelMeshes.values()) {
      totalVertices += mesh.vertexCount;
      totalTriangles += mesh.triangleCount;
    }
    if (totalVertices === 0) return null;

    const wrapped = new Float32Array(totalVertices * 3);
    const indices = new Uint32Array(totalTriangles * 3);
    const uvs = new Float32Array(totalVertices * 2);
    const panels: ClothSimInput['panels'] = [];
    const slices: PanelSlice[] = [];
    const panelIds = Array.from(panelMeshes.keys());
    // One plan per build: pieces sharing a wrap mode split their sector by pattern order.
    const wrapSlots = planWraps(project.pattern);

    let vertexOffset = 0;
    let indexOffset = 0;
    for (const panelId of panelIds) {
      const mesh = panelMeshes.get(panelId)!;
      const panel = project.pattern.panels[panelId];
      const posed = posedPositions3D(
        mesh, panel, landmarks.resolve(project.avatar.params), wrapSlots.get(panelId),
      );

      for (let i = 0; i < mesh.vertexCount; i++) {
        const src = i * 3;
        const dst = (vertexOffset + i) * 3;
        wrapped[dst] = posed[src]; wrapped[dst + 1] = posed[src + 1]; wrapped[dst + 2] = posed[src + 2];
        mergedUVsFrom(uvs, mesh, i, vertexOffset);
      }
      // Panels whose pose turns the sheet over keep the same vertices but swap two indices, so every
      // triangle winds outward and the normals pass can average the two sides of a seam.
      const reverse = drapeReversesWinding(panel);
      for (let i = 0; i < mesh.indices.length; i += 3) {
        indices[indexOffset + i] = mesh.indices[i]! + vertexOffset;
        indices[indexOffset + i + 1] = mesh.indices[reverse ? i + 2 : i + 1]! + vertexOffset;
        indices[indexOffset + i + 2] = mesh.indices[reverse ? i + 1 : i + 2]! + vertexOffset;
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
        positions3D: posed,
        restPositions: flatRestPositions(mesh),
        physics: fabricForPanel(project, panelId)?.physics ?? FALLBACK_PHYSICS,
        collisionLayer: panelCollisionLayer(panel),
        thicknessMeters: panelThicknessCm(project, panel) / 100,
        ...(creaseEdges.length > 0 ? { creaseEdges } : {}),
      });
      slices.push({ panelId, start: vertexOffset, end: vertexOffset + mesh.vertexCount });

      vertexOffset += mesh.vertexCount;
      indexOffset += mesh.indices.length;
    }

    this.layout = ParticleLayout.of(slices, totalVertices);
    this.positions = wrapped;
    const seamConstraints = this.buildClosingConstraints(project, panelMeshes, panelIds);
    // Sewn pairs share one target point, so the dressing glide and the closed seams agree.
    this.dressPositions = sewnTargets(wrapped, this.seamPairs);

    this.input = {
      // Separate array so the solver's live readback never overwrites the initial layout.
      positions: wrapped.slice(),
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
      const range = this.layout.rangeOf(panelId);
      if (!mesh || !range || range.end - range.start !== mesh.vertexCount) return false;
    }

    for (const panel of input.panels) {
      const edges = panelCreaseEdges(project.pattern, panel.panelId, panel.mesh);
      if (edges.length > 0) panel.creaseEdges = edges;
      else delete panel.creaseEdges;
    }
    input.seamConstraints = this.buildClosingConstraints(project, panelMeshes, panelIds);
    this.dressPositions = sewnTargets(this.positions, this.seamPairs);
    return true;
  }

  /** Panel owning a particle, resolved in constant time. */
  panelIdForParticle(particleIndex: number): string | null {
    return this.layout.panelAt(particleIndex);
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

  private reset(): void {
    this.input = null;
    this.layout = ParticleLayout.of([], 0);
    this.positions = new Float32Array(0);
    this.dressPositions = new Float32Array(0);
    this.panelTriangles.clear();
    this.trianglePanelIds = [];
    this.seamPairs = [];
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

    for (const seam of Object.values(pattern.seams) as Seam[]) {
      // An open edge marks intent only; its sides stay unstitched.
      if (seam.type === 'free') continue;
      const a = edgeToPanel.get(seam.a.edgeId);
      const b = edgeToPanel.get(seam.b.edgeId);
      if (!a || !b) continue;

      const offA = this.layout.rangeOf(a.panelId)?.start ?? 0;
      const offB = this.layout.rangeOf(b.panelId)?.start ?? 0;
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
      // Compliance is tuned against the presets' mass unit; both sides carry it to physical masses.
      const meshA = panelMeshes.get(a.panelId);
      const meshB = panelMeshes.get(b.panelId);
      const massScale = ((meshA ? complianceMassScale(toTriangleMesh(meshA)) : 1)
        + (meshB ? complianceMassScale(toTriangleMesh(meshB)) : 1)) / 2;
      const compliance = massScale / (Math.max(seam.strength, 0.01) * 3600);
      const tearFactor = seamBreakStretch(seam.strength);
      for (const [secA, secB] of sections) {
        this.stitchRun(secA, secB, offA, offB, restOf, compliance, seam.id, undefined, tearFactor, constraints);
      }
    }

    for (const panelId of panelIds) {
      const panel = pattern.panels[panelId];
      const panelMesh = panelMeshes.get(panelId);
      if (!panel || !panelMesh) continue;
      const off = this.layout.rangeOf(panelId)?.start ?? 0;
      for (const dartId of panel.dartIds) {
        const dart = pattern.darts[dartId];
        if (!dart?.closing) continue;
        const [legA, legB] = dartLegRuns(pattern, dart, toTriangleMesh(panelMesh));
        if (legA.length === 0 || legB.length === 0) continue;
        // The legs meet at the tip, so reversing one run pairs base to base and tip to tip.
        const massScale = complianceMassScale(toTriangleMesh(panelMesh));
        this.stitchRun(legA, [...legB].reverse(), off, off, () => 0,
          massScale / (DART_STITCH_STRENGTH * 3600), dartId, dartId, undefined, constraints);
      }
    }
    return constraints;
  }

  /**
   * Pairs two vertex runs at equal arc-length fractions and records one closing constraint per pair. Pairing
   * by distance along the seam instead of by index keeps a shorter edge from bunching its vertices against
   * the long edge's corners.
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
    const pairedA = new Set<number>();
    const pairedB = new Set<number>();
    const addPair = (ia: number, ib: number): void => {
      const key = `${ia}_${ib}`;
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push([ia, ib]);
      pairedA.add(ia);
      pairedB.add(ib);
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
    // Fill the vertices the fraction walk stepped over: a partner stitched elsewhere would pull
    // such a vertex to two points at once and leave the pieces apart.
    for (let i = 0; i < fractionsA.length; i++) {
      if (pairedA.has(i)) continue;
      addPair(i, nearestFreeFraction(fractionsB, fractionsA[i]!, pairedB));
    }
    for (let j = 0; j < fractionsB.length; j++) {
      if (pairedB.has(j)) continue;
      addPair(nearestFreeFraction(fractionsA, fractionsB[j]!, pairedA), j);
    }

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
 * Index of the fraction closest to `target` that no stitch uses yet, so the pairing stays one
 * partner per vertex. Falls back to the closest index of all when the run is fully taken.
 */
function nearestFreeFraction(fractions: number[], target: number, taken: Set<number>): number {
  let best = -1;
  let bestError = Infinity;
  for (let i = 0; i < fractions.length; i++) {
    const error = Math.abs(fractions[i]! - target);
    if (error < bestError && !taken.has(i)) { best = i; bestError = error; }
  }
  if (best >= 0) return best;
  let fallback = 0;
  let fallbackError = Infinity;
  for (let i = 0; i < fractions.length; i++) {
    const error = Math.abs(fractions[i]! - target);
    if (error < fallbackError) { fallback = i; fallbackError = error; }
  }
  return fallback;
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

/**
 * Vertex indices of the boundary run between `t0` and `t1`. Both ends snap to the nearest vertex, so
 * two seams splitting one edge at the same fraction stitch their junction to one vertex instead of
 * leaving one vertex of that edge free on either side of the cut.
 */
function intervalVertices(
  vertices: number[], t0: number, t1: number, positions: Float32Array, offset: number,
): number[] {
  if ((t0 === 0 && t1 === 1) || vertices.length < 2) return vertices;
  const fractions = arcFractions(positions, vertices, offset);
  const lo = nearestFraction(fractions, Math.min(t0, t1), 0);
  let hi = nearestFraction(fractions, Math.max(t0, t1), 0);
  if (hi <= lo) hi = Math.min(vertices.length - 1, lo + 1);
  if (hi - lo < 1) return vertices;
  return vertices.slice(lo, hi + 1);
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
