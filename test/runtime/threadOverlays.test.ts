import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/base/math';
import { createDefaultProject } from '@/model';
import { internalLineSegments } from '@/runtime/world/internalLineThreads';
import { anchorNormal, anchorPosition, surfaceAnchor, surfaceCursor } from '@/runtime/engine/surfaceAnchor';
import type { PanelInput } from '@/sim/common';

function squarePanel(): PanelInput {
  return {
    panelId: 'p1',
    vertexOffset: 0,
    mesh: {
      positions: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      vertexCount: 4,
      triangleCount: 2,
    },
    positions3D: new Float32Array(12),
    restPositions: new Float32Array(12),
    physics: { stretchStiffness: 1, shearStiffness: 1, massPerArea: 1, damping: 1 },
  };
}

const POSITIONS = new Float32Array([0, 0, 0, 1, 0, 1, 1, 0, 2, 0, 0, 3]);

function positionOf(anchor: Parameters<typeof anchorPosition>[0]): Vec3 {
  const out: Vec3 = { x: 0, y: 0, z: 0 };
  expect(anchorPosition(anchor, POSITIONS, out)).toBe(true);
  return out;
}

describe('surface anchors', () => {
  it('places an interior point with barycentric weights that sum to one', () => {
    const anchor = surfaceAnchor(squarePanel(), { x: 2.5, y: 5 });
    expect(anchor).not.toBeNull();
    expect(anchor!.wa + anchor!.wb + anchor!.wc).toBeCloseTo(1, 9);

    const point = positionOf(anchor!);
    expect(point.x).toBeCloseTo(0.25, 6);
    expect(point.y).toBeCloseTo(0, 6);
    expect(point.z).toBeCloseTo(1.25, 6);
  });

  it('falls back to the nearest vertex for a point outside the mesh', () => {
    const anchor = surfaceAnchor(squarePanel(), { x: 20, y: -5 });
    expect(anchor).toMatchObject({ a: 1, b: 1, c: 1, wa: 1, wb: 0, wc: 0 });
  });

  it('reads the interpolated surface normal and falls back to up without one', () => {
    const anchor = surfaceAnchor(squarePanel(), { x: 5, y: 5 })!;
    expect(anchorNormal(anchor, new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])))
      .toEqual([0, 0, 1]);
    expect(anchorNormal(anchor)).toEqual([0, 1, 0]);
  });

  it('gives a cursor the anchors the one-off lookup gives', () => {
    const panel = squarePanel();
    const cursor = surfaceCursor(panel);
    for (const point of [{ x: 2.5, y: 5 }, { x: 7, y: 3 }, { x: 9.5, y: 9.5 }, { x: 20, y: -5 }]) {
      expect(cursor.at(point)).toEqual(surfaceAnchor(panel, point));
    }
  });
});

describe('internal line segments', () => {
  it('draws the polyline as a chain from its first point to its last in the fold colour', () => {
    const project = createDefaultProject();
    project.pattern.internalLines.l1 = {
      id: 'l1', kind: 'fold', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 5 }],
    };
    project.pattern.panels.p1 = {
      id: 'p1',
      name: '前片',
      outlineEdgeIds: [],
      dartIds: [],
      internalLineIds: ['l1'],
      seamAllowanceCm: 0,
      fabricId: '',
      visible: true,
      locked: false,
    };

    const segments = internalLineSegments(project, [squarePanel()]);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments.every(segment => segment.color === '#8ec7ff')).toBe(true);
    expect(positionOf(segments[0].a)).toEqual({ x: 0, y: 0, z: 0 });
    expect(positionOf(segments[segments.length - 1].b)).toEqual({ x: 1, y: 0, z: 1.5 });
  });

  it('skips the internal lines of a hidden panel', () => {
    const project = createDefaultProject();
    project.pattern.internalLines.l1 = {
      id: 'l1', kind: 'decor', points: [{ x: 1, y: 1 }, { x: 5, y: 5 }],
    };
    project.pattern.panels.p1 = {
      id: 'p1',
      name: '前片',
      outlineEdgeIds: [],
      dartIds: [],
      internalLineIds: ['l1'],
      seamAllowanceCm: 0,
      fabricId: '',
      visible: false,
      locked: false,
    };

    expect(internalLineSegments(project, [squarePanel()])).toHaveLength(0);
  });
});
