import type { MeshSampling, Pattern } from '../../core/model/types';

/** Scene settings a panel mesh build reads beside the pattern geometry. */
export interface PanelMeshSettings {
  /** Global default edge length recorded by the last batch edit. */
  meshResolutionCm?: number;
  /** Interior point distribution the build seeds with. */
  meshSampling?: MeshSampling;
}

/**
 * Everything one panel's mesh build reads: outline and hole geometry, per-edge and panel
 * seam allowance, mesh density and the points the panel owns. The solver-side collision layer
 * rides along, so a layer edit re-merges the input the running solver reads it from.
 */
export function panelGeometrySignature(
  pattern: Pattern, settings: PanelMeshSettings, panelId: string,
): string {
  const panel = pattern.panels[panelId];
  if (!panel) return '';
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
    panel.visible, panel.layer ?? null, panel.collisionLayer ?? null, panel.placement ?? null,
    panel.drape ?? null, panel.transform ?? null, edges, points,
    settings.meshResolutionCm ?? null, settings.meshSampling ?? null,
  ]);
}
