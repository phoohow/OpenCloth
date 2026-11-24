import { distance3At } from '@/base/geom';
import { DEFAULT_COMPRESSION_LIMIT, DEFAULT_STRETCH_LIMIT } from '@/model';

const MIN_REST_LENGTH = 1e-6;

const TRIANGLE_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 0],
];

export interface StrainBounds {
  stretch: Float32Array;
  compression: Float32Array;
}

export interface StrainBoundPanel {
  vertexOffset: number;
  vertexCount: number;
  stretchLimit?: number;
  compressionLimit?: number;
}

export interface StrainStats {
  min: number;
  max: number;
  meanAbs: number;
  vertices: number;
  overStretch: number;
  overCompression: number;
}

function edgeStrain(rest: Float32Array, current: Float32Array, a: number, b: number): number | null {
  const restLength = distance3At(rest, a, b);
  const currentLength = distance3At(current, a, b);
  if (!Number.isFinite(restLength) || !Number.isFinite(currentLength)) return null;
  const value = (currentLength - restLength) / Math.max(restLength, MIN_REST_LENGTH);
  return Number.isFinite(value) ? value : null;
}

export function computeVertexStrain(
  rest: Float32Array,
  current: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const vertexCount = Math.min(Math.floor(rest.length / 3), Math.floor(current.length / 3));
  if (vertexCount < 3) return new Float32Array(0);

  const sums = new Float64Array(vertexCount);
  const incidentEdges = new Uint32Array(vertexCount);

  for (let i = 0; i + 2 < indices.length; i += 3) {
    const triangle = [indices[i], indices[i + 1], indices[i + 2]];
    if (triangle.some((vertex) => vertex >= vertexCount)) continue;
    for (const [a, b] of TRIANGLE_EDGES) {
      const strain = edgeStrain(rest, current, triangle[a], triangle[b]);
      if (strain === null) continue;
      sums[triangle[a]] += strain;
      sums[triangle[b]] += strain;
      incidentEdges[triangle[a]] += 1;
      incidentEdges[triangle[b]] += 1;
    }
  }

  const result = new Float32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    result[vertex] = incidentEdges[vertex] > 0 ? sums[vertex] / incidentEdges[vertex] : 0;
  }

  return result;
}

function limitOf(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(1, value);
}

export function strainBounds(
  vertexCount: number,
  panels: ReadonlyArray<StrainBoundPanel>,
): StrainBounds {
  const stretch = new Float32Array(vertexCount).fill(DEFAULT_STRETCH_LIMIT);
  const compression = new Float32Array(vertexCount).fill(DEFAULT_COMPRESSION_LIMIT);
  for (const panel of panels) {
    const stretchLimit = limitOf(panel.stretchLimit, DEFAULT_STRETCH_LIMIT);
    const compressionLimit = limitOf(panel.compressionLimit, DEFAULT_COMPRESSION_LIMIT);
    const end = Math.min(vertexCount, panel.vertexOffset + panel.vertexCount);
    for (let i = Math.max(0, panel.vertexOffset); i < end; i++) {
      stretch[i] = stretchLimit;
      compression[i] = compressionLimit;
    }
  }

  return { stretch, compression };
}

export function strainStats(strain: Float32Array, bounds?: StrainBounds): StrainStats {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sumAbs = 0;
  let vertices = 0;
  let overStretch = 0;
  let overCompression = 0;
  const boundCount = bounds ? Math.min(bounds.stretch.length, bounds.compression.length) : 0;
  for (let i = 0; i < strain.length; i++) {
    const value = strain[i];
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sumAbs += Math.abs(value);
    vertices += 1;
    if (i >= boundCount) continue;
    if (value > bounds!.stretch[i]!) overStretch += 1;
    else if (value < -bounds!.compression[i]!) overCompression += 1;
  }

  if (vertices === 0) {
    return { min: 0, max: 0, meanAbs: 0, vertices: 0, overStretch: 0, overCompression: 0 };
  }

  return { min, max, meanAbs: sumAbs / vertices, vertices, overStretch, overCompression };
}
