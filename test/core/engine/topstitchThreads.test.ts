import { describe, expect, it } from 'vitest';
import type { Project } from '@/model/types';
import { createDefaultProject, createEmptyPattern, FABRIC_PHYSICS_PRESETS } from '@/model/defaults';
import type { ClothSimInput } from '@/sim/clothSimulator';
import { topstitchSegments } from '@/runtime/topstitchThreads';
import { addSquare } from '../../core/command/fixtures';

/** Four corner particles standing in for the square panel's simulation mesh. */
function panelInput(panelId: string, vertexOffset: number): ClothSimInput['panels'][number] {
  const positions = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
  return {
    panelId,
    vertexOffset,
    mesh: { positions, indices: new Uint32Array([0, 1, 2, 0, 2, 3]), vertexCount: 4, triangleCount: 2 },
    positions3D: new Float32Array(12),
    restPositions: positions,
    physics: FABRIC_PHYSICS_PRESETS.cotton,
  };
}

/** Project with one square and one topstitch two rows inward from its bottom edge. */
function stitchFixture(): { project: Project; panelId: string } {
  const pattern = createEmptyPattern();
  const panelId = addSquare(pattern, 'sq', 0, 0, 10);
  const edgeId = pattern.panels[panelId]!.outlineEdgeIds[0]!;
  pattern.topstitches['ts1'] = {
    id: 'ts1', panelId, edgeId, t0: 0, t1: 1, offsetMm: 3, spacingMm: 4, rows: 2,
    color: '#d9a441', stitchMm: 3, gapMm: 2, visible: true,
  };
  const project = createDefaultProject();
  project.pattern = pattern;
  return { project, panelId };
}

describe('topstitchSegments', () => {
  it('snaps each row onto the mesh vertices and emits offset indices', () => {
    const { project, panelId } = stitchFixture();
    const segments = topstitchSegments(project, [panelInput(panelId, 100)]);
    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      expect(segment.color).toBe('#d9a441');
      expect(segment.a).toBeGreaterThanOrEqual(100);
      expect(segment.b).toBeGreaterThanOrEqual(100);
      expect(segment.a).toBeLessThan(104);
      expect(segment.b).toBeLessThan(104);
    }
    expect(segments[0]).toMatchObject({ a: 100, b: 101 });
  });

  it('drops hidden stitches and hidden panels', () => {
    const { project, panelId } = stitchFixture();
    project.pattern.topstitches['ts1']!.visible = false;
    expect(topstitchSegments(project, [panelInput(panelId, 0)])).toEqual([]);

    project.pattern.topstitches['ts1']!.visible = true;
    project.pattern.panels[panelId]!.visible = false;
    expect(topstitchSegments(project, [panelInput(panelId, 0)])).toEqual([]);
  });

  it('emits nothing when the panel has fewer than two sampled points', () => {
    const { project, panelId } = stitchFixture();
    project.pattern.topstitches['ts1']!.t1 = 0;
    expect(topstitchSegments(project, [panelInput(panelId, 0)])).toEqual([]);
  });
});
