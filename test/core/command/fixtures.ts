import type { Pattern, Project, Vec2 } from '@/model/types';
import { createDefaultProject } from '@/model/defaults';
import type { ProjectContext } from '@/commands/command';

/** Draft context over a caller-supplied pattern. */
export function ctxOf(pattern: Pattern): ProjectContext {
  const project: Project = createDefaultProject();
  project.pattern = pattern;
  return { project };
}

/** Counter-clockwise square panel at (x, y) with side `s`, using prefixed ids; returns the panel id. */
export function addSquare(pattern: Pattern, prefix: string, x: number, y: number, s: number): string {
  const corners: Vec2[] = [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];
  const pointIds = corners.map((pos, i) => {
    const id = `${prefix}_p${i}`;
    pattern.points[id] = { id, pos };
    return id;
  });
  const edgeIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = `${prefix}_e${i}`;
    pattern.edges[id] = { id, type: 'line', startPointId: pointIds[i], endPointId: pointIds[(i + 1) % 4] };
    edgeIds.push(id);
  }
  const panelId = `${prefix}_panel`;
  pattern.panels[panelId] = {
    id: panelId, name: prefix, outlineEdgeIds: edgeIds, dartIds: [], internalLineIds: [],
    seamAllowanceCm: 1, fabricId: 'f', meshResolutionCm: 3, visible: true, locked: false,
  };
  return panelId;
}
