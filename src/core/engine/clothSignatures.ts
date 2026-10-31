import type { Avatar, Project, RenderMode } from '../model/types';
import { fabricForPanel } from '../model/fabric';
import { FALLBACK_PHYSICS } from './clothConstants';

/**
 * Everything the visible body, its collision capsules and the drape wrap read: measurements,
 * pose and source. Display, name and scene transform only affect drawing.
 */
export function avatarBodySignature(avatar: Avatar): string {
  return JSON.stringify({ ...avatar, name: undefined, display: undefined, transform: undefined });
}

/** Cloth geometry group, keyed by the index range it draws. */
export interface ClothGroupRange {
  start: number;
  count: number;
  slot: number;
  panelId: string;
}

/** Panel visibility of every cloth group, as one comparable string. */
export function visibilitySignature(groups: ClothGroupRange[], project: Project): string {
  return groups
    .map(g => `${g.start}:${project.pattern.panels[g.panelId]?.visible === false ? 0 : 1}`)
    .join(',');
}

/** Material record and render mode of every panel, as one comparable string. */
export function appearanceSignature(panelIds: string[], project: Project, mode: RenderMode): string {
  if (panelIds.length === 0) return '';
  const perPanel = panelIds.map(id => {
    const fabric = fabricForPanel(project, id);
    return fabric ? JSON.stringify(fabric.appearance) : '-';
  });
  return `${mode}|${perPanel.join(',')}`;
}

/** Material physics of every panel, as one comparable string. */
export function physicsSignature(panelIds: string[], project: Project): string {
  if (panelIds.length === 0) return '';
  return panelIds
    .map(id => JSON.stringify(fabricForPanel(project, id)?.physics ?? FALLBACK_PHYSICS))
    .join(',');
}

/**
 * Everything the solver's closing and crease constraint sets are built from: seam pairings, the
 * darts whose legs are being closed and the panel fold lines. Draw-only fields such as thread color
 * stay out, so they do not recompute constraints.
 */
export function constraintSignature(project: Project): string {
  const pattern = project.pattern;
  const seams = Object.values(pattern.seams).map(seam => JSON.stringify(
    [seam.id, seam.type, seam.a, seam.b, seam.flip, seam.gatherRatio ?? null, seam.strength],
  ));
  const darts = Object.values(pattern.darts).map(dart => JSON.stringify(
    [dart.id, dart.tipId, dart.edge1Id, dart.edge2Id, dart.closing === true],
  ));
  const panels = Object.values(pattern.panels).map(panel => JSON.stringify([
    panel.id,
    panel.dartIds,
    panel.internalLineIds.map(lineId => {
      const line = pattern.internalLines[lineId];
      return line ? [lineId, line.kind, line.points] : [lineId];
    }),
  ]));
  return JSON.stringify([seams, darts, panels]);
}

/**
 * Everything one panel's mesh build reads: outline and hole geometry, per-edge and panel
 * seam allowance, mesh density and the points the panel owns. The solver-side collision layer
 * rides along, so a layer edit re-merges the input the running solver reads it from.
 */
export function panelGeometrySignature(project: Project, panelId: string): string {
  const panel = project.pattern.panels[panelId];
  if (!panel) return '';
  const pattern = project.pattern;
  const ids = [
    ...panel.outlineEdgeIds,
    ...(panel.holes ?? []).flat(),
    ...panel.dartIds.flatMap(dartId => {
      const dart = pattern.darts[dartId];
      return dart ? [dart.tipId, dart.edge1Id, dart.edge2Id] : [];
    }),
  ];
  const edges = ids.flatMap(id => {
    const edge = pattern.edges[id];
    if (!edge) return [id];
    return [JSON.stringify(edge), edge.startPointId, edge.endPointId];
  });
  const points = [...new Set(ids.flatMap(id => {
    const edge = pattern.edges[id];
    return edge ? [edge.startPointId, edge.endPointId] : [];
  }))].map(pointId => JSON.stringify(pattern.points[pointId] ?? pointId));
  return JSON.stringify([
    panel.outlineEdgeIds, panel.holes ?? [], panel.seamAllowanceCm, panel.meshResolutionCm,
    panel.visible, panel.locked, panel.collisionLayer ?? 0, edges, points,
    project.scene.simulation.meshResolutionCm ?? null,
  ]);
}

/** panelId → geometry signature across the whole pattern. */
export function geometrySignatures(project: Project): Map<string, string> {
  const map = new Map<string, string>();
  for (const panelId of Object.keys(project.pattern.panels)) {
    map.set(panelId, panelGeometrySignature(project, panelId));
  }
  return map;
}

/** Identity of the merged particle/triangle/seam layout a live solver was built for. */
export function clothLayoutFingerprint(input: {
  particleCount: number;
  triangleCount: number;
  panels: Array<{ panelId: string; vertexOffset: number; mesh: { vertexCount: number } }>;
  seamConstraints?: unknown[];
}, seamPairCount = 0): string {
  return [
    input.particleCount, input.triangleCount, seamPairCount,
    input.panels.map(p => `${p.panelId}@${p.vertexOffset}x${p.mesh.vertexCount}`).join(','),
  ].join('|');
}
