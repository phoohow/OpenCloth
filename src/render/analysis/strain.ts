/** Smallest rest edge length used as the strain denominator. */
const MIN_REST_LENGTH = 1e-6;

/** Edge vertex pairs of a triangle, as offsets into its index triple. */
const TRIANGLE_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 0],
];

/** Returns the length of one edge, or NaN when a coordinate is not finite. */
function edgeLength(positions: Float32Array, a: number, b: number): number {
  const a3 = a * 3;
  const b3 = b * 3;
  const dx = positions[b3] - positions[a3];
  const dy = positions[b3 + 1] - positions[a3 + 1];
  const dz = positions[b3 + 2] - positions[a3 + 2];
  return Math.hypot(dx, dy, dz);
}

/** Returns the signed relative length change of one edge, or null when it cannot be measured. */
function edgeStrain(rest: Float32Array, current: Float32Array, a: number, b: number): number | null {
  const restLength = edgeLength(rest, a, b);
  const currentLength = edgeLength(current, a, b);
  if (!Number.isFinite(restLength) || !Number.isFinite(currentLength)) return null;
  const value = (currentLength - restLength) / Math.max(restLength, MIN_REST_LENGTH);
  return Number.isFinite(value) ? value : null;
}

/**
 * Computes signed per-vertex strain from the length change of every mesh edge.
 * Returns an empty array when the positions hold fewer than one triangle.
 */
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

/** Aggregate strain numbers shown next to the heatmap. */
export interface StrainStats {
  min: number;
  max: number;
  meanAbs: number;
}

/** Summarizes finite strain values into their signed minimum, maximum and mean absolute value. */
export function strainStats(strain: Float32Array): StrainStats {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sumAbs = 0;
  let count = 0;
  for (let i = 0; i < strain.length; i++) {
    const value = strain[i];
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sumAbs += Math.abs(value);
    count += 1;
  }
  if (count === 0) return { min: 0, max: 0, meanAbs: 0 };
  return { min, max, meanAbs: sumAbs / count };
}

/**
 * Maps a signed strain onto a blue (compression), white (zero), red (stretch) ramp.
 * Values are clamped to the range; an empty range or non-finite input returns white.
 */
export function strainColor(value: number, min = -0.25, max = 0.25): [number, number, number] {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return [1, 1, 1];
  }
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  if (t < 0.5) {
    const k = t * 2;
    return [k, k, 1];
  }
  const k = (t - 0.5) * 2;
  return [1, 1 - k, 1 - k];
}
