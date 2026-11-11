import type { FabricAsset, TrimAsset } from '@/model';
import { fabricFromAsset } from '@/model';
import type { Vec2 } from '@/model/types';
import { AddFabricCommand, AddFabricRecordCommand, AddTrimCommand } from '@/commands';
import { computeBBox } from '@/base/geom';
import { samplePanelOutline } from '@/pattern/panel';
import { useProjectStore, useUIStore } from '@/store';

/** Centre of one panel's cut outline, in pattern coordinates. */
export function panelCentre(panelId: string): Vec2 {
  const pattern = useProjectStore.getState().project.pattern;
  const panel = pattern.panels[panelId];
  if (!panel) return { x: 0, y: 0 };
  const box = computeBBox(samplePanelOutline(pattern, panel));
  return { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
}

/** Applies a material asset to the given panels, cloning it into a new project record. */
export function applyFabricToPanels(panelIds: readonly string[], asset: FabricAsset): void {
  if (panelIds.length === 0) return;
  const state = useProjectStore.getState();
  if (asset.source === 'preset' && asset.presetKey) {
    state.executeCommand(new AddFabricCommand([...panelIds], state.project, asset.presetKey));
  } else {
    state.executeCommand(new AddFabricRecordCommand([...panelIds], fabricFromAsset(state.project, asset)));
  }
  const panel = state.project.pattern.panels[panelIds[0]!];
  const target = panelIds.length === 1 ? `「${panel?.name ?? '版片'}」` : `${panelIds.length} 张版片`;
  useUIStore.getState().showToast(`已为${target}应用「${asset.name}」`);
}

/** Places a trim asset at one pattern point of a panel. */
export function placeTrimOnPanel(panelId: string, pos: Vec2, asset: TrimAsset): void {
  useProjectStore.getState().executeCommand(new AddTrimCommand(panelId, asset.kind, pos, {
    name: asset.name,
    sizeMm: asset.sizeMm,
    color: asset.color,
    qty: asset.qty,
    ...(asset.unitPrice !== undefined ? { unitPrice: asset.unitPrice } : {}),
  }));
  useUIStore.getState().showToast(`已放置「${asset.name}」`);
}
