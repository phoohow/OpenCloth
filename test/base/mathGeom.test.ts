import { describe, expect, it } from 'vitest';
import {
  add2, add3t, angleBetween2, averagePoint2, clamp, clamp01, cross3t, degToRad, distance2,
  distance3t, dot3t, hypot3, lerp, length3t, midpoint2, nearlyEqual, nearlyEqual2, normalize2,
  normalize3t, normalizeQuaternion, quaternionFromUnitVectors, radToDeg, reflectAcrossLine2,
  rotate2, rotateAround2, rotateAxis3, rotateAxis3Tuple, rotateEuler3, rotateQuaternion3,
  scaleAround2, shortestAngleDelta, signedAngleBetween2, unit2, vec2, vec3, wrapAngle,
  wrapAngleSigned,
} from '@/base/math';
import {
  arcTForPoint, barycentricWeights3D, closestPointOnSegment3, closestPointOnTriangle3,
  computeBBox, computeVertexNormals, distance3At, distance3AtPoint, ensureCCW,
  intersectRayPlane3, intersectRayTriangle3, nearestOnPolyline, pointOnSegment2,
  pointRayDistance3, pointSegmentDistance, pointSegmentDistance3, polygonArea, polylineLength,
  polylineMidpoint, projectOnLine2, projectOnSegment2, readPoint3At, segmentCrossing2,
  segmentsIntersect2, segmentsStrictlyCross2, signedPolygonArea, triangleNormal3,
} from '@/base/geom';
import { hexToLinearRgb } from '@/base/color';
import { cmToM, cmToMm, mToCm, mmToCm } from '@/base/units';
import { formatPercent, roundTo } from '@/base/format';

describe('base/math', () => {
  it('clamps within finite and infinite bounds', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(12, -Infinity, Infinity)).toBe(12);
    expect(clamp(-7, 0, Infinity)).toBe(0);
  });

  it('interpolates and converts angles', () => {
    expect(lerp(2, 6, 0.25)).toBe(3);
    expect(degToRad(180)).toBeCloseTo(Math.PI);
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
    expect(hypot3(3, 4, 12)).toBe(13);
  });

  it('measures distance between particles in a flat xyz buffer', () => {
    const positions = new Float32Array([0, 0, 0, 3, 4, 12]);
    expect(distance3At(positions, 0, 1)).toBeCloseTo(13);
  });
});

describe('base/math angles and segments', () => {
  it('wraps angles and measures signed turns', () => {
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(Math.PI * 1.5);
    expect(wrapAngleSigned(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(shortestAngleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
    expect(signedAngleBetween2(vec2(1, 0), vec2(0, 1))).toBeCloseTo(Math.PI / 2);
    expect(angleBetween2(vec2(1, 0), vec2(0, -1))).toBeCloseTo(Math.PI / 2);
  });

  it('clamps and compares scalars and averages points', () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(nearlyEqual(1, 1 + 1e-7)).toBe(true);
    expect(averagePoint2([vec2(0, 0), vec2(2, 4)])).toEqual({ x: 1, y: 2 });
  });

  it('projects points onto lines and segments', () => {
    const a = vec2(0, 0), b = vec2(10, 0);
    expect(projectOnSegment2(vec2(4, 3), a, b).point).toEqual({ x: 4, y: 0 });
    expect(projectOnSegment2(vec2(14, 3), a, b).point).toEqual({ x: 10, y: 0 });
    expect(pointSegmentDistance(vec2(5, 3), a, b)).toBeCloseTo(3);
  });

  it('crosses and touches segments', () => {
    const at = segmentCrossing2(vec2(0, 0), vec2(4, 4), vec2(0, 4), vec2(4, 0));
    expect(at?.x).toBeCloseTo(2);
    expect(at?.y).toBeCloseTo(2);
    expect(segmentCrossing2(vec2(0, 0), vec2(4, 0), vec2(0, 1), vec2(4, 1))).toBeNull();
    expect(segmentsIntersect2(vec2(0, 0), vec2(4, 0), vec2(4, 0), vec2(4, 4))).toBe(true);
  });
});

describe('base/math vector helpers', () => {
  it('rotates, scales, reflects and averages 2D points', () => {
    const turned = rotate2(vec2(1, 0), Math.PI / 2);
    expect(turned.x).toBeCloseTo(0);
    expect(turned.y).toBeCloseTo(1);
    const around = rotateAround2(vec2(2, 1), vec2(1, 1), Math.PI / 2);
    expect(around.x).toBeCloseTo(1);
    expect(around.y).toBeCloseTo(2);
    const scaled = scaleAround2(vec2(3, 1), vec2(1, 1), 2);
    expect(scaled).toEqual({ x: 5, y: 1 });
    const reflected = reflectAcrossLine2(vec2(1, 2), vec2(0, 0), vec2(1, 0));
    expect(reflected).toEqual({ x: 1, y: -2 });
    expect(midpoint2(vec2(0, 0), vec2(4, 2))).toEqual({ x: 2, y: 1 });
    expect(nearlyEqual2(vec2(1, 1), vec2(1 + 1e-7, 1))).toBe(true);
    expect(unit2(vec2(0, 0))).toBeNull();
  });

  it('projects and tests segment membership', () => {
    const a = vec2(0, 0), b = vec2(4, 0);
    expect(projectOnLine2(vec2(2, 3), a, b)).toEqual({ point: { x: 2, y: 0 }, t: 0.5 });
    expect(pointOnSegment2(vec2(2, 0), a, b)).toBe(true);
    expect(pointOnSegment2(vec2(5, 0), a, b)).toBe(false);
    expect(segmentsStrictlyCross2(vec2(0, 0), vec2(4, 4), vec2(0, 4), vec2(4, 0))).toBe(true);
    expect(segmentsStrictlyCross2(vec2(0, 0), vec2(4, 0), vec2(4, 0), vec2(4, 4))).toBe(false);
  });

  it('provides tuple and flat-buffer 3D algebra', () => {
    expect(add3t([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(dot3t([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(length3t([3, 4, 0])).toBe(5);
    expect(distance3t([0, 0, 0], [1, 2, 2])).toBe(3);
    expect(cross3t([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    const unit = normalize3t([0, 3, 4]);
    expect(unit[0]).toBe(0);
    expect(unit[1]).toBeCloseTo(0.6);
    expect(unit[2]).toBeCloseTo(0.8);
    expect(normalize3t([0, 0, 0])).toEqual([0, 0, 0]);

    const positions = new Float32Array([0, 0, 0, 1, 2, 2]);
    expect(distance3AtPoint(positions, 1, vec3(0, 0, 0))).toBe(3);
    expect(readPoint3At(positions, 1)).toEqual({ x: 1, y: 2, z: 2 });
    const out = new Float64Array(3);
    closestPointOnSegment3(1, 1, 1, 0, 0, 0, 2, 0, 0, out);
    expect(Array.from(out)).toEqual([1, 0, 0]);
    expect(pointSegmentDistance3(1, 1, 1, 0, 0, 0, 2, 0, 0, out)).toBeCloseTo(Math.SQRT2);
  });

  it('normalizes quaternions and rotates about a tuple axis', () => {
    const q = normalizeQuaternion([0, 0, 0, 2]);
    expect(q).toEqual([0, 0, 0, 1]);
    const turned = rotateAxis3Tuple([1, 0, 0], [0, 0, 1], Math.PI / 2);
    expect(turned[0]).toBeCloseTo(0);
    expect(turned[1]).toBeCloseTo(1);
  });
});

describe('base/math rays and triangles', () => {
  it('intersects rays with planes and triangles', () => {
    expect(intersectRayPlane3(vec3(0, 0, 3), vec3(0, 0, -1), vec3(0, 0, 0), vec3(0, 0, 1)))
      .toEqual({ x: 0, y: 0, z: 0 });
    const hit = intersectRayTriangle3(
      vec3(0.25, 0.25, 1), vec3(0, 0, -1),
      vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0),
    );
    expect(hit?.distance).toBeCloseTo(1);
    expect(hit?.u).toBeCloseTo(0.25);
    expect(hit?.v).toBeCloseTo(0.25);
    expect(intersectRayTriangle3(
      vec3(2, 2, 1), vec3(0, 0, -1),
      vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0),
    )).toBeNull();
  });

  it('measures perpendicular distance to a ray', () => {
    expect(pointRayDistance3(vec3(1, 2, 0), vec3(0, 0, 0), vec3(1, 0, 0))).toBeCloseTo(2);
    expect(pointRayDistance3(vec3(-1, 2, 0), vec3(0, 0, 0), vec3(1, 0, 0))).toBe(Infinity);
  });

  it('computes triangle normals, weights and closest points', () => {
    const normal = triangleNormal3(vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0));
    expect(normal).toEqual({ x: 0, y: 0, z: 1 });
    const weights = barycentricWeights3D([0.25, 0.25, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(weights?.[0]).toBeCloseTo(0.5);
    const out = new Float64Array(3);
    closestPointOnTriangle3(0.25, 0.25, 2, 0, 0, 0, 1, 0, 0, 0, 1, 0, out);
    expect(Array.from(out)).toEqual([0.25, 0.25, 0]);
  });

  it('accumulates smooth mesh normals and falls back upward', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    expect(Array.from(computeVertexNormals(positions, indices))).toEqual([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
    const degenerate = computeVertexNormals(
      new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]), new Uint32Array([0, 1, 2]),
    );
    expect(Array.from(degenerate)).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  });
});

describe('base/math colours and rotations', () => {
  it('converts sRGB hex to linear rgb', () => {
    const white = hexToLinearRgb('#ffffff');
    expect(white[0]).toBeCloseTo(1);
    expect(white[1]).toBeCloseTo(1);
    expect(white[2]).toBeCloseTo(1);
    const black = hexToLinearRgb('#000000');
    expect(black).toEqual([0, 0, 0]);
  });

  it('rotates vectors with Euler angles, axes and quaternions', () => {
    const turned = rotateEuler3([1, 0, 0], [0, 0, Math.PI / 2]);
    expect(turned[0]).toBeCloseTo(0);
    expect(turned[1]).toBeCloseTo(1);
    const axisTurned = rotateAxis3(vec3(1, 0, 0), vec3(0, 0, 1), Math.PI / 2);
    expect(axisTurned.x).toBeCloseTo(0);
    expect(axisTurned.y).toBeCloseTo(1);
    const q = quaternionFromUnitVectors([0, 1, 0], [1, 0, 0]);
    const qTurned = rotateQuaternion3([0, 1, 0], q);
    expect(qTurned[0]).toBeCloseTo(1);
    expect(qTurned[1]).toBeCloseTo(0);
  });
});

describe('base/geom', () => {
  it('keeps signed and absolute polygon areas distinct', () => {
    const ccw = [vec2(0, 0), vec2(4, 0), vec2(0, 2)];
    expect(signedPolygonArea(ccw)).toBeGreaterThan(0);
    expect(signedPolygonArea([...ccw].reverse())).toBeLessThan(0);
    expect(polygonArea(ccw)).toBe(4);
    expect(polygonArea([...ccw].reverse())).toBe(4);
  });

  it('normalizes winding and computes bounds', () => {
    const cw = [vec2(0, 0), vec2(0, 2), vec2(4, 0)];
    expect(signedPolygonArea(ensureCCW(cw))).toBeGreaterThan(0);
    const box = computeBBox([vec2(-1, 5), vec2(3, 2)]);
    expect(box.min).toEqual({ x: -1, y: 2 });
    expect(box.max).toEqual({ x: 3, y: 5 });
    expect(computeBBox([]).min.x).toBe(Infinity);
  });

  it('provides vector primitives', () => {
    expect(add2(vec2(1, 2), vec2(3, 4))).toEqual({ x: 4, y: 6 });
    expect(distance2(vec2(0, 0), vec2(3, 4))).toBe(5);
    expect(normalize2(vec2(0, 0))).toEqual({ x: 0, y: 0 });
  });

  it('measures polylines and arc parameters', () => {
    const polyline = [vec2(0, 0), vec2(2, 0), vec2(2, 2)];
    expect(polylineLength(polyline)).toBe(4);
    expect(polylineMidpoint(polyline)).toEqual({ x: 2, y: 0 });
    expect(nearestOnPolyline(vec2(3, 1), polyline)).toEqual({ x: 2, y: 1 });
    const arc = { center: vec2(0, 0), radius: 1, startAngle: 0, endAngle: Math.PI / 2, ccw: true };
    expect(arcTForPoint(arc, vec2(Math.SQRT1_2, Math.SQRT1_2))).toBeCloseTo(0.5);
  });
});

describe('base/units and base/format', () => {
  it('converts between centimeters, meters and millimeters', () => {
    expect(cmToM(170)).toBe(1.7);
    expect(mToCm(1.7)).toBeCloseTo(170);
    expect(cmToMm(2.5)).toBe(25);
    expect(mmToCm(25)).toBe(2.5);
  });

  it('replaces the inline round-to-two-decimals expression', () => {
    expect(roundTo(1.23456)).toBe(1.23);
    expect(roundTo(-1.235)).toBe(-1.24);
    expect(roundTo(1.23456)).toBe(Math.round(1.23456 * 100) / 100);
    expect(roundTo(1.234, 1)).toBe(1.2);
  });

  it('formats ratios as percentages', () => {
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.125, 1)).toBe('12.5%');
  });
});
