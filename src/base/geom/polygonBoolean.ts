import type { Vec2 } from '@/base/math';

import { ensureCCW, signedPolygonArea } from '@/base/geom/primitives';
import polygonClipping from 'polygon-clipping';

const { difference, intersection, union } = polygonClipping;

export type RingedPolygon = Vec2[][];

export type BooleanOperand = Vec2[] | RingedPolygon;

export type PolygonList = Vec2[][][];

const isRinged = (p: BooleanOperand): p is RingedPolygon => Array.isArray(p[0]);

const ringArea = (ring: Vec2[]): number => signedPolygonArea(ring);

export function asRings(p: BooleanOperand): RingedPolygon {
  return isRinged(p) ? p : [p];
}

export function toGeoJsonRings(p: BooleanOperand): [number, number][][] {
  return asRings(p)
    .filter(ring => ring.length >= 3)
    .map(ring => [...ring.map(({ x, y }) => [x, y] as [number, number]), [ring[0].x, ring[0].y]]);
}

export function fromGeoJsonRings(rings: [number, number][][]): RingedPolygon {
  return rings.map(ring => {
    const first = ring[0], last = ring[ring.length - 1];
    const body = ring.length >= 2 && first[0] === last[0] && first[1] === last[1]
      ? ring.slice(0, -1)
      : ring;
    return body.map(([x, y]) => ({ x, y }));
  });
}

function orient(rings: RingedPolygon): RingedPolygon {
  if (rings.length === 0) return rings;
  const [outer, ...holes] = rings;
  return [
    ensureCCW(outer),
    ...holes.map(h => (ringArea(h) > 0 ? [...h].reverse() : h)),
  ];
}

function prepared(p: BooleanOperand): [number, number][][] | null {
  const geom = toGeoJsonRings(p);
  return geom.length === 0 ? null : geom;
}

function toPolygons(multi: readonly [number, number][][][]): PolygonList {
  return multi.map(rings => orient(fromGeoJsonRings(rings)));
}

export function unionPolygons(polygons: BooleanOperand[]): PolygonList {
  const geoms = polygons.map(prepared).filter((g): g is [number, number][][] => g !== null);
  if (geoms.length === 0) return [];
  return toPolygons(union(geoms[0]!, ...geoms.slice(1)));
}

export function intersectPolygons(a: BooleanOperand, b: BooleanOperand): PolygonList {
  const ga = prepared(a), gb = prepared(b);
  if (!ga || !gb) return [];
  return toPolygons(intersection(ga, gb));
}

export function differencePolygons(subject: BooleanOperand, clip: BooleanOperand): PolygonList {
  const gs = prepared(subject);
  if (!gs) return [];
  const gc = prepared(clip);
  if (!gc) return [orient(asRings(subject).filter(r => r.length >= 3))];
  return toPolygons(difference(gs, gc));
}
