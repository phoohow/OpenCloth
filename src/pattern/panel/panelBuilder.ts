import type { MeshSampling, Pattern, Panel, SeamAllowanceCorner, Vec2 } from '@/model/types';

import {
  hasSelfIntersection, offsetOutlinePerEdge, offsetPolygonStyled, safeOffsetPolygon, computeBBox,
  cumulativePolylineLengths, ensureCCW, projectOnSegment2, segmentsIntersect2,
} from '@/base/geom';
import { add2, distance2, nearlyEqual2, scale2 } from '@/base/math';
import { DEFAULT_MESH_RESOLUTION_CM } from '@/model';
import { sampleEdge } from '@/pattern/geom';
import { remeshPolygon } from '@/pattern/triangulate/remesh';
import { extractBoundaryEdges, resampleClosedOutline, type TriangleMesh } from '@/pattern/triangulate/triangulate';

export {
  sampleEdge, sampleEdgeInterval, pointAtT, edgeLength, edgeIntervalLength,
} from '@/pattern/geom';

export const UV_TILE_CM = 50;

const TRACK_MARGIN_CM = 6;

const CORNER_EPS_CM = 0.02;

const CONTACT_EPS = 1e-6;

export interface PanelMesh {
  panelId: string;
  positions2D: Float32Array;
  positions3D: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  vertexCount: number;
  triangleCount: number;
  boundaryEdges: Array<[number, number]>;
  edgeVertexMap: Map<string, number[]>;
}

export function toTriangleMesh(mesh: PanelMesh): TriangleMesh {
  return {
    positions: mesh.positions2D,
    indices: mesh.indices,
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
  };
}

export function sampleOutline(pattern: Pattern, edgeIds: string[]): Vec2[] {
  const outline: Vec2[] = [];
  for (const edgeId of edgeIds) {
    const pts = sampleEdge(pattern, edgeId);
    for (let i = 0; i < pts.length; i++) {
      if (i === 0 && outline.length > 0) {
        const last = outline[outline.length - 1];
        if (nearlyEqual2(last, pts[i])) continue;
      }

      outline.push(pts[i]);
    }
  }

  if (outline.length > 1) {
    const first = outline[0], last = outline[outline.length - 1];
    if (nearlyEqual2(first, last)) outline.pop();
  }

  return outline;
}

export function samplePanelOutline(pattern: Pattern, panel: Panel): Vec2[] {
  return ensureCCW(sampleOutline(pattern, panel.outlineEdgeIds));
}

function generateUVs(positions2D: Float32Array): Float32Array {
  const uvs = new Float32Array(positions2D.length);
  for (let i = 0; i < positions2D.length / 2; i++) {
    uvs[i * 2] = positions2D[i * 2]! / UV_TILE_CM;
    uvs[i * 2 + 1] = positions2D[i * 2 + 1]! / UV_TILE_CM;
  }

  return uvs;
}

function to3D(positions2D: Float32Array): Float32Array {
  const out = new Float32Array((positions2D.length / 2) * 3);
  for (let i = 0; i < positions2D.length / 2; i++) {
    out[i * 3] = positions2D[i * 2] * 0.01;
    out[i * 3 + 1] = positions2D[i * 2 + 1] * 0.01;
    out[i * 3 + 2] = 0;
  }

  return out;
}

function resampledPanelOutline(pattern: Pattern, panel: Panel, resolution: number): Vec2[] {
  const outline = samplePanelOutline(pattern, panel);
  return resampleClosedOutline(outline, resolution, patternPointIndices(pattern, panel, outline));
}

function patternPointIndices(pattern: Pattern, panel: Panel, outline: Vec2[]): number[] {
  const indices: number[] = [];
  for (const edgeId of panel.outlineEdgeIds) {
    const edge = pattern.edges[edgeId];
    const point = edge ? pattern.points[edge.startPointId] : undefined;
    if (!point) continue;
    let best = -1;
    let bestDistance = 1e-3;
    for (let i = 0; i < outline.length; i++) {
      const d = distance2(outline[i]!, point.pos);
      if (d < bestDistance) { bestDistance = d; best = i; }
    }

    if (best >= 0) indices.push(best);
  }

  return indices;
}

export function panelMeshBounds(pattern: Pattern, panel: Panel): { min: Vec2; max: Vec2 } {
  const outline = resampledPanelOutline(pattern, panel, DEFAULT_MESH_RESOLUTION_CM);
  return computeBBox(outline.length >= 3 ? outline : samplePanelOutline(pattern, panel));
}

export function buildPanelMesh(
  pattern: Pattern,
  panelId: string,
  resolutionCm: number,
  sampling?: MeshSampling,
): PanelMesh | null {
  const panel = pattern.panels[panelId];
  if (!panel) return null;

  const outline = resampledPanelOutline(pattern, panel, resolutionCm);
  if (outline.length < 3) return null;

  const holes = (panel.holes ?? [])
    .map(loop => resampleClosedOutline(sampleOutline(pattern, loop), resolutionCm))
    .filter(loop => loop.length >= 3);

  const mesh = remeshPolygon(outline, holes, resolutionCm, sampling);
  if (mesh.triangleCount === 0) return null;

  const uvs = generateUVs(mesh.positions);

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

export function panelOutlineWithAllowance(pattern: Pattern, panel: Panel): Vec2[] {
  const raw = sampleOutline(pattern, panel.outlineEdgeIds);
  const ccw = ensureCCW(raw);
  const reversed = ccw !== raw;
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

  const allowanceAt: number[] = new Array<number>(n).fill(0);
  const cornerAt: SeamAllowanceCorner[] = new Array<SeamAllowanceCorner>(n).fill('miter');
  let cursor = 0;
  edges.forEach((_, e) => {
    const last = (cursor + counts[e]) % n;
    const terminal = reversed ? cursor : last;
    for (let k = 1; k < counts[e]; k++) allowanceAt[(cursor + k) % n] = perEdge[e];
    allowanceAt[terminal] = perEdge[e];
    cornerAt[last] = corners[e];
    cursor = last;
  });

  if (reversed) {
    allowanceAt.reverse();
    cornerAt.reverse();
    counts.reverse();
  }

  const joined = offsetPolygonStyled(ccw, allowanceAt, cornerAt);
  if (hasSelfIntersection(joined)) {
    return offsetOutlinePerEdge(ccw, allowanceAt, counts);
  }

  return joined;
}

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
    add2(center, scale2(dir, -half)),
    add2(center, scale2(dir, half)),
  ];
}

function buildEdgeVertexMap(
  pattern: Pattern,
  panel: Panel,
  mesh: TriangleMesh,
  boundaryEdges: Array<[number, number]>,
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  const boundary = new Set<number>();
  for (const [a, b] of boundaryEdges) {
    boundary.add(a);
    boundary.add(b);
  }

  const tracks = [...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()].map(
    edgeId => new EdgeTrack(edgeId, sampleEdge(pattern, edgeId)),
  );
  for (const track of tracks) map.set(track.edgeId, []);
  if (tracks.length === 0) return map;

  const assignments = tracks.map(() => [] as Array<{ vertex: number; t: number }>);
  for (const vertex of boundary) {
    const p: Vec2 = { x: mesh.positions[vertex * 2]!, y: mesh.positions[vertex * 2 + 1]! };
    let bestTrack = -1;
    let best = { d: Infinity, t: 0 };
    for (let k = 0; k < tracks.length; k++) {
      const track = tracks[k]!;
      if (!track.near(p)) continue;
      const hit = track.project(p);
      if (hit.d < best.d) { best = hit; bestTrack = k; }
    }

    if (bestTrack >= 0) assignments[bestTrack]!.push({ vertex, t: best.t });
    else {
      let fallback = 0;
      let near = { d: Infinity, t: 0 };
      for (let k = 0; k < tracks.length; k++) {
        const hit = tracks[k]!.project(p);
        if (hit.d < near.d) { near = hit; fallback = k; }
      }

      assignments[fallback]!.push({ vertex, t: near.t });
    }

    for (let k = 0; k < tracks.length; k++) {
      if (k === bestTrack) continue;
      const track = tracks[k]!;
      if (track.startsAt(p)) assignments[k]!.push({ vertex, t: 0 });
      else if (track.endsAt(p)) assignments[k]!.push({ vertex, t: track.length });
    }
  }

  for (let k = 0; k < tracks.length; k++) {
    const ordered = assignments[k]!.sort((a, b) => a.t - b.t).map(a => a.vertex);
    map.set(tracks[k]!.edgeId, ordered);
  }

  return map;
}

class EdgeTrack {
  readonly edgeId: string;
  private readonly points: Vec2[];
  private readonly arc: number[];
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minY: number;
  private readonly maxY: number;

  constructor(edgeId: string, points: Vec2[]) {
    this.edgeId = edgeId;
    this.points = points;
    this.arc = cumulativePolylineLengths(points);
    const bounds = computeBBox(points);
    this.minX = bounds.min.x - TRACK_MARGIN_CM;
    this.maxX = bounds.max.x + TRACK_MARGIN_CM;
    this.minY = bounds.min.y - TRACK_MARGIN_CM;
    this.maxY = bounds.max.y + TRACK_MARGIN_CM;
  }

  near(p: Vec2): boolean {
    return p.x >= this.minX && p.x <= this.maxX && p.y >= this.minY && p.y <= this.maxY;
  }

  startsAt(p: Vec2): boolean {
    const first = this.points[0];
    return first !== undefined && distance2(first, p) <= CORNER_EPS_CM;
  }

  endsAt(p: Vec2): boolean {
    const last = this.points[this.points.length - 1];
    return last !== undefined && distance2(last, p) <= CORNER_EPS_CM;
  }

  get length(): number {
    return this.arc[this.arc.length - 1] ?? 0;
  }

  project(p: Vec2): { d: number; t: number } {
    const pts = this.points;
    if (pts.length === 0) return { d: Infinity, t: 0 };
    if (pts.length === 1) return { d: distance2(pts[0]!, p), t: 0 };
    let best = { d: Infinity, t: 0 };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const projection = projectOnSegment2(p, a, b);
      const d = distance2(p, projection.point);
      if (d < best.d) best = { d, t: this.arc[i - 1]! + distance2(a, projection.point) };
    }

    return best;
  }
}

export function edgeVertexRun(
  pattern: Pattern, edgeId: string, mesh: TriangleMesh, spacingCm?: number,
): number[] {
  const pts = sampleEdge(pattern, edgeId);
  return nearestVertexRun(mesh, spacingCm && spacingCm > 0 ? resample(pts, spacingCm) : pts);
}

function resample(pts: Vec2[], spacing: number): Vec2[] {
  if (pts.length < 2) return pts;
  const acc = cumulativePolylineLengths(pts);
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

function panelFoldLines(pattern: Pattern, panelId: string): Vec2[][] {
  const panel = pattern.panels[panelId];
  if (!panel) return [];
  return panel.internalLineIds
    .map(lineId => pattern.internalLines[lineId])
    .filter(line => line?.kind === 'fold' && (line?.points.length ?? 0) >= 2)
    .map(line => line.points);
}

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
        if (segmentsIntersect2(p1, p2, pa, pb, CONTACT_EPS)) crossed.add(key);
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

function vertexPos(mesh: TriangleMesh, index: number): Vec2 {
  return { x: mesh.positions[index * 2] ?? 0, y: mesh.positions[index * 2 + 1] ?? 0 };
}

function boxesOverlap(minX: number, maxX: number, minY: number, maxY: number, a: Vec2, b: Vec2): boolean {
  return Math.max(minX, Math.min(a.x, b.x)) - Math.min(maxX, Math.max(a.x, b.x)) <= 1e-9
    && Math.max(minY, Math.min(a.y, b.y)) - Math.min(maxY, Math.max(a.y, b.y)) <= 1e-9;
}
