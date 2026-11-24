import type { Fabric, Panel, Print, Project } from '@/model/types';

import { genId } from '@/base/id';

export interface ClothMaterialSlot {
  fabric: Fabric | null;
  panelId: string | null;
}

export function fabricForPanel(project: Project, panelId: string): Fabric | null {
  const panel = project.pattern.panels[panelId];
  return panel ? project.fabrics[panel.fabricId] ?? null : null;
}

export function panelsUsingFabric(project: Project, fabricId: string): Panel[] {
  return Object.values(project.pattern.panels).filter(p => p.fabricId === fabricId);
}

export function fabricList(project: Project): Fabric[] {
  return Object.values(project.fabrics);
}

export function uniqueFabricName(project: Project, base: string): string {
  const taken = new Set(Object.values(project.fabrics).map(f => f.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function clonedFabric(project: Project, source: Fabric): Fabric {
  const copy = structuredClone(source);
  return { ...copy, id: genId('fabric'), name: uniqueFabricName(project, source.name) };
}

export function panelPrints(project: Project, panelId: string): Print[] {
  return Object.values(project.pattern.prints ?? {}).filter(
    print => print.panelId === panelId && print.visible !== false,
  );
}

export function clothMaterialSlotKey(slot: ClothMaterialSlot): string {
  return `${slot.fabric?.id ?? 'missing'}${slot.panelId ? `@${slot.panelId}` : ''}`;
}

export function clothMaterialSlotPlan(
  project: Project, panelIds: string[],
): { slots: ClothMaterialSlot[]; slotForPanel: number[] } {
  const slots: ClothMaterialSlot[] = [];
  const indexOf = new Map<string, number>();
  const slotForPanel: number[] = [];
  for (const panelId of panelIds) {
    const fabric = fabricForPanel(project, panelId);
    const printed = panelPrints(project, panelId).length > 0;
    const slot: ClothMaterialSlot = { fabric, panelId: printed ? panelId : null };
    const key = clothMaterialSlotKey(slot);
    let index = indexOf.get(key);
    if (index === undefined) {
      index = slots.length;
      slots.push(slot);
      indexOf.set(key, index);
    }

    slotForPanel.push(index);
  }

  return { slots, slotForPanel };
}
