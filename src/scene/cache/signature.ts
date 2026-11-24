import type { Pattern } from '@/model/types';
import type { PanelMeshSettings } from '@/scene/common/settings';

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
    panel.outlineEdgeIds, panel.holes ?? [],
    panel.placement ?? null, panel.drape ?? null, panel.transform ?? null, edges, points,
    settings.meshResolutionCm ?? null, settings.meshSampling ?? null,
  ]);
}
