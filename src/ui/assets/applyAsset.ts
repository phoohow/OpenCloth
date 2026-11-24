import type { FabricAsset } from '@/model';
import type { TrimKind, Vec2 } from '@/model/types';
import type { FabricDragPayload } from '@/ui/assets/assetDrag';

import { computeBBox } from '@/base/geom';
import { AddFabricCommand, AddFabricRecordCommand, AddTrimCommand, AssignFabricCommand } from '@/commands';
import { fabricFromAsset, idsOfKind } from '@/model';
import { samplePanelOutline } from '@/pattern/panel';
import { useProjectStore, useUIStore } from '@/store';

export interface TrimPlacementSpec {
  name?: string;
  kind: TrimKind;
  sizeMm: number;
  color: string;
  qty: number;
  unitPrice?: number;
}

export function selectedPanelIds(): string[] {
  const panels = useProjectStore.getState().project.pattern.panels;
  const selection = useUIStore.getState().selection;
  return idsOfKind(selection, 'panel').filter(id => !!panels[id]);
}

export function panelCentre(panelId: string): Vec2 {
  const pattern = useProjectStore.getState().project.pattern;
  const panel = pattern.panels[panelId];
  if (!panel) return { x: 0, y: 0 };
  const box = computeBBox(samplePanelOutline(pattern, panel));
  return { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
}

export function applyFabricToPanels(panelIds: readonly string[], asset: FabricAsset): void {
  if (panelIds.length === 0) return;
  const state = useProjectStore.getState();
  if (asset.source === 'preset' && asset.presetKey) {
    state.executeCommand(new AddFabricCommand([...panelIds], state.project, asset.presetKey));
  } else {
    state.executeCommand(new AddFabricRecordCommand([...panelIds], fabricFromAsset(state.project, asset)));
  }

  announceFabric(panelIds, asset.name);
}

export function assignFabricToPanels(panelIds: readonly string[], fabricId: string, name: string): void {
  if (panelIds.length === 0) return;
  const state = useProjectStore.getState();
  if (!state.project.fabrics[fabricId]) return;
  state.executeCommand(new AssignFabricCommand([...panelIds], fabricId));
  announceFabric(panelIds, name);
}

export function applyFabricDrag(panelIds: readonly string[], payload: FabricDragPayload): void {
  if (payload.kind === 'fabric') applyFabricToPanels(panelIds, payload.asset);
  else assignFabricToPanels(panelIds, payload.fabricId, payload.name);
}

export function placeTrimOnPanel(panelId: string, pos: Vec2, spec: TrimPlacementSpec): void {
  useProjectStore.getState().executeCommand(new AddTrimCommand(panelId, spec.kind, pos, {
    ...(spec.name ? { name: spec.name } : {}),
    sizeMm: spec.sizeMm,
    color: spec.color,
    qty: spec.qty,
    ...(spec.unitPrice !== undefined ? { unitPrice: spec.unitPrice } : {}),
  }));
  useUIStore.getState().showToast(`已放置「${spec.name ?? '辅料'}」`);
}

function announceFabric(panelIds: readonly string[], name: string): void {
  const panel = useProjectStore.getState().project.pattern.panels[panelIds[0]!];
  const target = panelIds.length === 1 ? `「${panel?.name ?? '版片'}」` : `${panelIds.length} 张版片`;
  useUIStore.getState().showToast(`已为${target}应用「${name}」`);
}
