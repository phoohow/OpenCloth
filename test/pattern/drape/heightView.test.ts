import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/pattern/template/starterProject';
import { buildPanelMesh } from '@/pattern/panel/panelBuilder';
import { drapePositions } from '@/pattern/drape/drapePlacement';
import { bodyLandmarks } from '@/avatar/landmarks';
import { panelHeightOffsets, panelMoveOffsets, toHeightPattern } from '@/ui/viewport2D/panelHeight';
import { previewPanelMove } from '@/commands/patternCommands';

/** Tolerance in cm: mesh vertices are stored as float32, the offsets are computed in float64. */
const EPS_CM = 1e-3;

describe('2D height view', () => {
  const project = createStarterProject();
  const body = bodyLandmarks(project.avatar.params);
  const offsets = panelHeightOffsets(project.pattern, body);
  const heights = toHeightPattern(project.pattern, offsets);

  it('raises every draped panel to the height the 3D wrap puts it at', () => {
    for (const panel of Object.values(project.pattern.panels)) {
      const mesh = buildPanelMesh(project.pattern, panel.id);
      if (!mesh || !panel.drape) continue;
      const wrapped = drapePositions(mesh, panel, body);
      const offset = offsets.get(panel.id) ?? 0;
      for (let i = 0; i < mesh.vertexCount; i += 7) {
        const patternY = mesh.positions2D[i * 2 + 1]!;
        expect(Math.abs(patternY + offset - wrapped[i * 3 + 1]! * 100)).toBeLessThan(EPS_CM);
      }
    }
  });

  it('leaves a panel without a drape at its pattern y', () => {
    const flat = Object.values(project.pattern.panels).find(panel => !panel.drape);
    if (!flat) return;
    expect(offsets.get(flat.id)).toBe(0);
    const id = project.pattern.edges[flat.outlineEdgeIds[0]!]!.startPointId;
    expect(heights.points[id]!.pos).toEqual(project.pattern.points[id]!.pos);
  });

  it('keeps every id and point count, so picking and commands still resolve', () => {
    expect(Object.keys(heights.points)).toEqual(Object.keys(project.pattern.points));
    expect(Object.keys(heights.panels)).toEqual(Object.keys(project.pattern.panels));
    for (const [id, point] of Object.entries(project.pattern.points)) {
      expect(heights.points[id]!.pos.x).toBe(point.pos.x);
    }
  });

  it('shifts a point by exactly its panel offset', () => {
    for (const panel of Object.values(project.pattern.panels)) {
      const offset = offsets.get(panel.id) ?? 0;
      for (const edgeId of panel.outlineEdgeIds) {
        const pointId = project.pattern.edges[edgeId]!.startPointId;
        const before = project.pattern.points[pointId]!.pos.y;
        expect(heights.points[pointId]!.pos.y - before).toBeCloseTo(offset, 6);
      }
    }
  });

  it('derives a panel-move preview offset from the base one without resampling', () => {
    const draped = Object.values(project.pattern.panels).filter(panel => panel.drape).map(p => p.id);
    const dy = 7.5;
    const moved = previewPanelMove(project.pattern, draped, { x: 3, y: dy });
    const exact = panelHeightOffsets(moved, body);
    const derived = panelMoveOffsets(project.pattern, offsets, draped, dy);
    for (const panel of Object.values(project.pattern.panels)) {
      expect(derived.get(panel.id)).toBeCloseTo(exact.get(panel.id) ?? 0, 9);
    }
  });
});
