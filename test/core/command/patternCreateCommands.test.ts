import { describe, expect, it } from 'vitest';
import { vec2 } from '../../../src/core/model/types';
import { createDefaultProject } from '../../../src/core/model/defaults';
import { samplePanelOutline } from '../../../src/pattern/panel/panelBuilder';
import { CreatePanelFromPointsCommand } from '../../../src/core/command/patternCreateCommands';

/** Four corners of a 10 × 10 square, clockwise from the lower-left. */
const square = [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)];

/** Panel added last to the pattern. */
function lastPanel(project: ReturnType<typeof createDefaultProject>) {
  const panels = Object.values(project.pattern.panels);
  return panels[panels.length - 1]!;
}

describe('CreatePanelFromPointsCommand', () => {
  it('closes the stroke into a panel of straight edges by default', () => {
    const project = createDefaultProject();
    const before = Object.keys(project.pattern.panels).length;

    new CreatePanelFromPointsCommand(square).execute({ project });

    expect(Object.keys(project.pattern.panels)).toHaveLength(before + 1);
    const panel = lastPanel(project);
    expect(panel.outlineEdgeIds).toHaveLength(4);
    expect(panel.outlineEdgeIds.every(id => project.pattern.edges[id]!.type === 'line')).toBe(true);
    // Straight edges sample down to the four corners.
    expect(samplePanelOutline(project.pattern, panel)).toHaveLength(4);
  });

  it('bends the outline into a spline through the points when smooth is set', () => {
    const project = createDefaultProject();

    new CreatePanelFromPointsCommand(square, { smooth: true }).execute({ project });

    const panel = lastPanel(project);
    expect(panel.outlineEdgeIds.every(id => project.pattern.edges[id]!.type === 'bezier')).toBe(true);
    for (const edgeId of panel.outlineEdgeIds) {
      const edge = project.pattern.edges[edgeId]!;
      expect(project.pattern.points[edge.startPointId]!.handleOut).toBeTruthy();
      expect(project.pattern.points[edge.endPointId]!.handleIn).toBeTruthy();
    }
    // The spline bows outside the square, so the sampled outline leaves the polygon corners.
    const samples = samplePanelOutline(project.pattern, panel);
    expect(samples.length).toBeGreaterThan(4);
    expect(samples.some(p => p.x < -0.5 || p.y < -0.5 || p.x > 10.5 || p.y > 10.5)).toBe(true);
  });

  it('still refuses a stroke with fewer than three points', () => {
    const project = createDefaultProject();
    expect(() => new CreatePanelFromPointsCommand([vec2(0, 0), vec2(10, 0)]).execute({ project }))
      .toThrow('轮廓至少需要 3 个点');
  });
});
