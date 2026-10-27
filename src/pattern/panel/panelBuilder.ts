import type { Pattern, Panel, Vec2 } from '../../core/model/types';
import { adaptiveSampleBezier, type CubicBezier2 } from '../geom/bezier';
import { safeOffsetPolygon } from '../geom/offset';
import { computeBBox, ensureCCW } from '../geom/vec2';
import { triangulatePolygon, refineMesh, extractBoundaryEdges, type TriangleMesh } from '../triangulate/triangulate';

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

/** Samples one pattern edge as polyline points. */
export function sampleEdge(pattern: Pattern, edgeId: string, reverse = false): Vec2[] {
  const edge = pattern.edges[edgeId];
  if (!edge) return [];
  const p0 = pattern.points[edge.startPointId]?.pos;
  const p1 = pattern.points[edge.endPointId]?.pos;
  if (!p0 || !p1) return [];

  let pts: Vec2[];
  if (edge.type === 'bezier' && edge.bezier) {
    const bez: CubicBezier2 = { p0, c0: edge.bezier.c0, c1: edge.bezier.c1, p1 };
    pts = adaptiveSampleBezier(bez, 0.2);
  } else {
    pts = [p0, p1];
  }
  return reverse ? [...pts].reverse() : pts;
}

/** Samples the full closed outline of a panel. */
export function samplePanelOutline(pattern: Pattern, panel: Panel): Vec2[] {
  const outline: Vec2[] = [];
  for (const edgeId of panel.outlineEdgeIds) {
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
  return ensureCCW(outline);
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

  let outline = samplePanelOutline(pattern, panel);
  if (outline.length < 3) return null;

  if (panel.seamAllowanceCm > 0) {
    outline = safeOffsetPolygon(outline, panel.seamAllowanceCm);
  }

  let mesh: TriangleMesh = triangulatePolygon(outline);

  mesh = refineMesh(mesh, resolutionCm ?? panel.meshResolutionCm);

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

  for (const edgeId of panel.outlineEdgeIds) {
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
