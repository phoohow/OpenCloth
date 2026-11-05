import type { Vec2 } from '@/common/geom/primitives';
import { ensureCCW, signedPolygonArea } from '@/common/geom/primitives';
import polygonClipping from 'polygon-clipping';

// The library's ESM build exposes one default object; named imports break the production bundle.
const { difference, intersection, union } = polygonClipping;

/** A polygon as an ordered list of rings: ring 0 is the exterior, later rings are holes. */
export type RingedPolygon = Vec2[][];

/** Operand accepted by the boolean helpers: a bare outer ring or rings with holes. */
export type BooleanOperand = Vec2[] | RingedPolygon;

/**
 * Boolean results: a list of polygons, each as rings with the exterior ring first,
 * counter-clockwise; hole rings are clockwise.
 */
export type PolygonList = Vec2[][][];

const isRinged = (p: BooleanOperand): p is RingedPolygon => Array.isArray(p[0]);

/** Splits an operand into its ring list. */
export function asRings(p: BooleanOperand): RingedPolygon {
  return isRinged(p) ? p : [p];
}

/** Converts a polygon operand to a GeoJSON polygon: closed rings of [x, y] pairs. */
export function toGeoJsonRings(p: BooleanOperand): [number, number][][] {
  return asRings(p)
    .filter(ring => ring.length >= 3)
    .map(ring => [...ring.map(({ x, y }) => [x, y] as [number, number]), [ring[0].x, ring[0].y]]);
}

/** Converts GeoJSON rings to Vec2 rings, dropping each ring's repeated closing point. */
export function fromGeoJsonRings(rings: [number, number][][]): RingedPolygon {
  return rings.map(ring => {
    const first = ring[0], last = ring[ring.length - 1];
    const body = ring.length >= 2 && first[0] === last[0] && first[1] === last[1]
      ? ring.slice(0, -1)
      : ring;
    return body.map(([x, y]) => ({ x, y }));
  });
}

const ringArea = (ring: Vec2[]): number => signedPolygonArea(ring);

/** Normalizes one result polygon: counter-clockwise exterior, clockwise holes. */
function orient(rings: RingedPolygon): RingedPolygon {
  if (rings.length === 0) return rings;
  const [outer, ...holes] = rings;
  return [
    ensureCCW(outer),
    ...holes.map(h => (ringArea(h) > 0 ? [...h].reverse() : h)),
  ];
}

/** GeoJSON polygon for the clipper, or null when the operand holds no usable ring. */
function prepared(p: BooleanOperand): [number, number][][] | null {
  const geom = toGeoJsonRings(p);
  return geom.length === 0 ? null : geom;
}

function toPolygons(multi: readonly [number, number][][][]): PolygonList {
  return multi.map(rings => orient(fromGeoJsonRings(rings)));
}

/** Unions every operand into one set of polygons; empty input returns []. */
export function unionPolygons(polygons: BooleanOperand[]): PolygonList {
  const geoms = polygons.map(prepared).filter((g): g is [number, number][][] => g !== null);
  if (geoms.length === 0) return [];
  return toPolygons(union(geoms[0]!, ...geoms.slice(1)));
}

/** Intersects two polygons; an empty operand yields []. */
export function intersectPolygons(a: BooleanOperand, b: BooleanOperand): PolygonList {
  const ga = prepared(a), gb = prepared(b);
  if (!ga || !gb) return [];
  return toPolygons(intersection(ga, gb));
}

/** Subtracts `clip` from `subject`; the subject is oriented and returned when `clip` is empty. */
export function differencePolygons(subject: BooleanOperand, clip: BooleanOperand): PolygonList {
  const gs = prepared(subject);
  if (!gs) return [];
  const gc = prepared(clip);
  if (!gc) return [orient(asRings(subject).filter(r => r.length >= 3))];
  return toPolygons(difference(gs, gc));
}

/** Drops vertices closer than 1e-12 to their predecessor, including the closing duplicate. */
function dedupeConsecutive(polygon: Vec2[]): Vec2[] {
  const near = (a: Vec2, b: Vec2): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 1e-12;
  const out: Vec2[] = [];
  for (const p of polygon) {
    if (out.length > 0 && near(out[out.length - 1], p)) continue;
    out.push({ ...p });
  }
  if (out.length > 1 && near(out[0], out[out.length - 1])) out.pop();
  return out;
}

/**
 * Splits a self-intersecting polygon into simple polygons by unioning it with itself;
 * already-simple input comes back as a single oriented polygon.
 */
export function selfIntersectFix(polygon: Vec2[]): PolygonList {
  const pts = dedupeConsecutive(polygon);
  try {
    return unionPolygons([pts]);
  } catch {
    return pts.length >= 3 ? [[pts]] : [];
  }
}
