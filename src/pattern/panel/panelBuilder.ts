import type { Pattern, Panel, SeamAllowanceCorner, Vec2 } from '../../core/model/types';
import { DEFAULT_MESH_RESOLUTION_CM } from '../../core/model/defaults';
import { hasSelfIntersection, offsetOutlinePerEdge, offsetPolygonStyled, safeOffsetPolygon } from '../geom/offset';
import { computeBBox, ensureCCW } from '../geom/vec2';
import { triangulatePolygon, refineMesh, extractBoundaryEdges, type TriangleMesh } from '../triangulate/triangulate';
import { sampleEdge } from '../geom/edgeSample';

export { sampleEdge, sampleEdgeInterval, pointAtT, edgeLength, edgeIntervalLength } from '../geom/edgeSample';

/** Triangulated pattern piece with both its 2D source coordinates and 3D build pose. */
export interface PanelMesh {
  panelId: string;
  /** 2D pattern vertices as flat [x, y, ...], source of UV generation */
  positions2D: Float32Array;
  /** Initial 3D positions as flat [x, y, z, ...], on the z = 0 plane */
  positions3D: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  vertexCount: number;
  triangleCount: number;
  /** Boundary edge vertex index pairs, used for seam constraint generation */
  boundaryEdges: Array<[number, number]>;
  /** Pattern edge ID to particle indices of its sampled vertices */
  edgeVertexMap: Map<string, number[]>;
}

/** Panel mesh viewed as a plain 2D triangle mesh, the form the constraint builders read. */
export function toTriangleMesh(mesh: PanelMesh): TriangleMesh {
  return {
    positions: mesh.positions2D,
    indices: mesh.indices,
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
  };
}

/** Samples the full closed outline of a panel, or one of its hole loops. */
export function sampleOutline(pattern: Pattern, edgeIds: string[]): Vec2[] {
  const outline: Vec2[] = [];
  for (const edgeId of edgeIds) {
    const pts = sampleEdge(pattern, edgeId);
    // Shared vertices repeat at each edge start.
    for (let i = 0; i < pts.length; i++) {
      if (i === 0 && outline.length > 0) {
        const last = outline[outline.length - 1];
        if (Math.hypot(last.x - pts[i].x, last.y - pts[i].y) < 1e-6) continue;
      }
      outline.push(pts[i]);
    }
  }
  // Drop the closing point that repeats the outline start.
  if (outline.length > 1) {
    const first = outline[0], last = outline[outline.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) outline.pop();
  }
  return outline;
}

/** Samples the full closed outline of a panel. */
export function samplePanelOutline(pattern: Pattern, panel: Panel): Vec2[] {
  return ensureCCW(sampleOutline(pattern, panel.outlineEdgeIds));
}

/** Normalizes 2D coordinates into the pattern bounding box to produce UVs. */
function generateUVs(positions2D: Float32Array, bbox: { min: Vec2; max: Vec2 }): Float32Array {
  const uvs = new Float32Array(positions2D.length);
  const w = bbox.max.x - bbox.min.x || 1;
  const h = bbox.max.y - bbox.min.y || 1;
  for (let i = 0; i < positions2D.length / 2; i++) {
    uvs[i * 2] = (positions2D[i * 2] - bbox.min.x) / w;
    uvs[i * 2 + 1] = (positions2D[i * 2 + 1] - bbox.min.y) / h;
  }
  return uvs;
}

/** Converts 2D centimeter coordinates to 3D meter coordinates on z = 0. */
function to3D(positions2D: Float32Array): Float32Array {
  const out = new Float32Array((positions2D.length / 2) * 3);
  for (let i = 0; i < positions2D.length / 2; i++) {
    out[i * 3] = positions2D[i * 2] * 0.01;
    out[i * 3 + 1] = positions2D[i * 2 + 1] * 0.01;
    out[i * 3 + 2] = 0;
  }
  return out;
}

/**
 * Builds a panel's simulation mesh: outline sampling, seam allowance, triangulation, refinement, UVs and seam mapping.
 * `resolutionCm` overrides the panel's own mesh resolution when given.
 */
export function buildPanelMesh(pattern: Pattern, panelId: string, resolutionCm?: number): PanelMesh | null {
  const panel = pattern.panels[panelId];
  if (!panel) return null;

  const outline = panelOutlineWithAllowance(pattern, panel);
  if (outline.length < 3) return null;

  const holes = (panel.holes ?? [])
    .map(loop => sampleOutline(pattern, loop))
    .filter(loop => loop.length >= 3);

  let mesh: TriangleMesh = triangulatePolygon(outline, holes);

  mesh = refineMesh(mesh, resolutionCm ?? panel.meshResolutionCm ?? DEFAULT_MESH_RESOLUTION_CM);

  const bbox = computeBBox(outline);
  const uvs = generateUVs(mesh.positions, bbox);

  const positions3D = to3D(mesh.positions);

  const boundaryEdges = extractBoundaryEdges(mesh);

  const edgeVertexMap = buildEdgeVertexMap(pattern, panel, mesh, boundaryEdges);

  return {
    panelId,
    positions2D: mesh.positions,
    positions3D,
    indices: mesh.indices,
    uvs,
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    boundaryEdges,
    edgeVertexMap,
  };
}

/**
 * Cutting outline of a panel: the sampled outline offset by the seam allowance of each edge,
 * joined at every corner by that corner's style (miter / round / bevel). With no per-edge
 * override this is the plain miter offset; an offset that self-intersects falls back to
 * shifting each sample along its own normal.
 */
export function panelOutlineWithAllowance(pattern: Pattern, panel: Panel): Vec2[] {
  const ccw = samplePanelOutline(pattern, panel);
  const n = ccw.length;
  if (n < 3) return ccw;
  const edges = panel.outlineEdgeIds.map(id => pattern.edges[id]);
  const perEdge = edges.map(edge => edge?.seamAllowanceCm ?? panel.seamAllowanceCm);
  const corners = edges.map(edge => edge?.cornerStyle ?? 'miter');
  const styled = corners.some(c => c !== 'miter');
  const varies = perEdge.some(a => a !== panel.seamAllowanceCm);
  if (!styled && !varies) {
    return panel.seamAllowanceCm > 0 ? safeOffsetPolygon(ccw, panel.seamAllowanceCm) : ccw;
  }

  const counts = panel.outlineEdgeIds.map(edgeId => Math.max(1, sampleEdge(pattern, edgeId).length - 1));
  if (counts.reduce((a, b) => a + b, 0) !== n) {
    return panel.seamAllowanceCm > 0 ? safeOffsetPolygon(ccw, panel.seamAllowanceCm) : ccw;
  }

  // Sample i belongs to the edge starting at it; a corner sample keeps the allowance and the
  // join style of the edge ending there, matching the stitched panel outline.
  const allowanceAt: number[] = new Array<number>(n).fill(0);
  const cornerAt: SeamAllowanceCorner[] = new Array<SeamAllowanceCorner>(n).fill('miter');
  let cursor = 0;
  edges.forEach((_, e) => {
    const last = (cursor + counts[e]) % n;
    for (let k = 1; k < counts[e]; k++) allowanceAt[(cursor + k) % n] = perEdge[e];
    allowanceAt[last] = perEdge[e];
    cornerAt[last] = corners[e];
    cursor = last;
  });

  const joined = offsetPolygonStyled(ccw, allowanceAt, cornerAt);
  if (hasSelfIntersection(joined)) {
    return offsetOutlinePerEdge(ccw, allowanceAt, counts);
  }
  return joined;
}

/**
 * Grain line segment of a panel: direction from `grainAngleDeg`, midpoint from `grainOffset`
 * relative to the outline bounding-box centre, total length from `grainLengthCm` or 60% of the
 * shorter outline side. Null when the panel has no grain angle.
 */
export function panelGrainLine(panel: Panel, outline: Vec2[]): Vec2[] | null {
  if (panel.grainAngleDeg === undefined || outline.length < 3) return null;
  const box = computeBBox(outline);
  const center = {
    x: (box.min.x + box.max.x) / 2 + (panel.grainOffset?.x ?? 0),
    y: (box.min.y + box.max.y) / 2 + (panel.grainOffset?.y ?? 0),
  };
  const length = panel.grainLengthCm ?? Math.min(box.max.x - box.min.x, box.max.y - box.min.y) * 0.6;
  const half = Math.max(0.1, length) / 2;
  const rad = (panel.grainAngleDeg * Math.PI) / 180;
  const dir = { x: Math.cos(rad), y: Math.sin(rad) };
  return [
    { x: center.x - dir.x * half, y: center.y - dir.y * half },
    { x: center.x + dir.x * half, y: center.y + dir.y * half },
  ];
}

/**
 * Maps pattern edge IDs to the mesh vertex indices sampled from each edge. Seam allowance
 * pushes the mesh boundary outward, so each sample snaps to its nearest boundary vertex.
 */
function buildEdgeVertexMap(
  pattern: Pattern,
  panel: Panel,
  mesh: TriangleMesh,
  boundaryEdges: Array<[number, number]>,
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  const candidates = new Set<number>();
  for (const [a, b] of boundaryEdges) {
    candidates.add(a);
    candidates.add(b);
  }
  const list = Array.from(candidates);
  const posArr = mesh.positions;

  const nearestVertex = (p: Vec2): number => {
    let best = list[0] ?? -1;
    let bestDist = Infinity;
    for (const i of list) {
      const d = Math.hypot(posArr[i * 2] - p.x, posArr[i * 2 + 1] - p.y);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  };

  for (const edgeId of [...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()]) {
    const pts = sampleEdge(pattern, edgeId);
    const indices: number[] = [];
    for (const p of pts) {
      const vi = nearestVertex(p);
      if (vi >= 0 && (indices.length === 0 || indices[indices.length - 1] !== vi)) {
        indices.push(vi);
      }
    }
    map.set(edgeId, indices);
  }
  return map;
}

/**
 * Mesh vertex indices nearest to a pattern edge's samples, ordered along the edge and without
 * consecutive repeats. `spacingCm` resamples the edge at that arc-length step, which the two
 * endpoints of a straight edge would not give on their own.
 */
export function edgeVertexRun(
  pattern: Pattern, edgeId: string, mesh: TriangleMesh, spacingCm?: number,
): number[] {
  const pts = sampleEdge(pattern, edgeId);
  return nearestVertexRun(mesh, spacingCm && spacingCm > 0 ? resample(pts, spacingCm) : pts);
}

/** Points along a polyline every `spacing` units, endpoints included. */
function resample(pts: Vec2[], spacing: number): Vec2[] {
  if (pts.length < 2) return pts;
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = acc[acc.length - 1];
  if (!(total > 0)) return pts;

  const out: Vec2[] = [pts[0]];
  for (let d = spacing; d < total - 1e-9; d += spacing) {
    let i = 1;
    while (i < acc.length && acc[i] < d) i++;
    const span = acc[i] - acc[i - 1] || 1;
    const k = (d - acc[i - 1]) / span;
    out.push({
      x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k,
      y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k,
    });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Typical triangle edge length of a panel mesh, in centimetres. */
export function meshSpacingCm(mesh: TriangleMesh): number {
  const lengths: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < mesh.triangleCount; t++) {
    const tri = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!, b = tri[(e + 1) % 3]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lengths.push(Math.hypot(
        mesh.positions[a * 2]! - mesh.positions[b * 2]!,
        mesh.positions[a * 2 + 1]! - mesh.positions[b * 2 + 1]!,
      ));
    }
  }
  if (lengths.length === 0) return 0;
  lengths.sort((a, b) => a - b);
  return lengths[Math.floor(lengths.length / 2)]!;
}

/** Mesh vertices nearest to the given points, ordered along them and without consecutive repeats. */
function nearestVertexRun(mesh: TriangleMesh, pts: Vec2[]): number[] {
  const run: number[] = [];
  for (const p of pts) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const d = Math.hypot(mesh.positions[i * 2]! - p.x, mesh.positions[i * 2 + 1]! - p.y);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best >= 0 && run[run.length - 1] !== best) run.push(best);
  }
  return run;
}

/**
 * Fold polylines of a panel: its internal lines marked `fold`, in pattern centimetre coordinates.
 */
export function panelFoldLines(pattern: Pattern, panelId: string): Vec2[][] {
  const panel = pattern.panels[panelId];
  if (!panel) return [];
  return panel.internalLineIds
    .map(lineId => pattern.internalLines[lineId])
    .filter(line => line?.kind === 'fold' && (line?.points.length ?? 0) >= 2)
    .map(line => line.points);
}

/**
 * Local mesh vertex index pairs [a, b, ...] of the triangle edges the panel's fold lines cross.
 * Each pair becomes a stiff crease constraint, so the cloth folds along the line instead of
 * bending gradually across the panel.
 */
export function panelCreaseEdges(pattern: Pattern, panelId: string, mesh: TriangleMesh): number[] {
  const folds = panelFoldLines(pattern, panelId);
  if (folds.length === 0) return [];

  const crossed = new Set<string>();
  const edges = meshEdges(mesh);
  for (const polyline of folds) {
    for (let s = 0; s + 1 < polyline.length; s++) {
      const p1 = polyline[s]!, p2 = polyline[s + 1]!;
      const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
      for (const [key, [a, b]] of edges) {
        if (crossed.has(key)) continue;
        const pa = vertexPos(mesh, a), pb = vertexPos(mesh, b);
        if (!boxesOverlap(minX, maxX, minY, maxY, pa, pb)) continue;
        if (segmentsCross(p1, p2, pa, pb)) crossed.add(key);
      }
    }
  }

  const pairs: number[] = [];
  for (const key of crossed) {
    const edge = edges.get(key);
    if (!edge) continue;
    pairs.push(edge[0], edge[1]);
  }
  return pairs;
}

/** Every unique mesh edge, keyed by its sorted vertex pair. */
function meshEdges(mesh: TriangleMesh): Map<string, [number, number]> {
  const edges = new Map<string, [number, number]>();
  for (let t = 0; t < mesh.triangleCount; t++) {
    const tri = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!, b = tri[(e + 1) % 3]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!edges.has(key)) edges.set(key, [a, b]);
    }
  }
  return edges;
}

/** 2D position of a mesh vertex, in pattern centimetres. */
function vertexPos(mesh: TriangleMesh, index: number): Vec2 {
  return { x: mesh.positions[index * 2] ?? 0, y: mesh.positions[index * 2 + 1] ?? 0 };
}

/** Cheap bounding-box rejection between a segment and an edge. */
function boxesOverlap(minX: number, maxX: number, minY: number, maxY: number, a: Vec2, b: Vec2): boolean {
  return Math.max(minX, Math.min(a.x, b.x)) - Math.min(maxX, Math.max(a.x, b.x)) <= 1e-9
    && Math.max(minY, Math.min(a.y, b.y)) - Math.min(maxY, Math.max(a.y, b.y)) <= 1e-9;
}

const CONTACT_EPS = 1e-6;

/** Signed turn from `o` to `a` then `b`. */
function turn(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** True when `p` sits on the closed segment `ab`. */
function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  if (Math.abs(turn(a, b, p)) > CONTACT_EPS) return false;
  return p.x >= Math.min(a.x, b.x) - CONTACT_EPS && p.x <= Math.max(a.x, b.x) + CONTACT_EPS
    && p.y >= Math.min(a.y, b.y) - CONTACT_EPS && p.y <= Math.max(a.y, b.y) + CONTACT_EPS;
}

/** True when the two segments cross or touch; contact counts, so a fold through a vertex creases both edges. */
function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const d1 = turn(p1, p2, q1), d2 = turn(p1, p2, q2);
  const d3 = turn(q1, q2, p1), d4 = turn(q1, q2, p2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return onSegment(p1, p2, q1) || onSegment(p1, p2, q2) || onSegment(q1, q2, p1) || onSegment(q1, q2, p2);
}
