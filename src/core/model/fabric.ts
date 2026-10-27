import { genId } from './defaults';
import type { Fabric, Panel, Project } from './types';

/** Material record behind a panel; null when its reference dangles. */
export function fabricForPanel(project: Project, panelId: string): Fabric | null {
  const panel = project.pattern.panels[panelId];
  return panel ? project.fabrics[panel.fabricId] ?? null : null;
}

/** Panels wearing a material record. */
export function panelsUsingFabric(project: Project, fabricId: string): Panel[] {
  return Object.values(project.pattern.panels).filter(p => p.fabricId === fabricId);
}

/** Material records listed in the picker, in project insertion order. */
export function fabricList(project: Project): Fabric[] {
  return Object.values(project.fabrics);
}

/** Appends the lowest free counter so material names stay distinguishable. */
export function uniqueFabricName(project: Project, base: string): string {
  const taken = new Set(Object.values(project.fabrics).map(f => f.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** A detached copy of a material record: fresh id, unused name, same parameters. */
export function clonedFabric(project: Project, source: Fabric): Fabric {
  const copy = structuredClone(source);
  return { ...copy, id: genId('fabric'), name: uniqueFabricName(project, source.name) };
}

/**
 * Material slots for a panel sequence: one entry per distinct record plus the slot index
 * of every panel, so a render mesh can group its triangles by material.
 */
export interface FabricSlotPlan {
  /** Distinct materials in first-use order; null when a panel's record is missing. */
  fabrics: (Fabric | null)[];
  /** Slot index into `fabrics` for each panel id, in the same order. */
  slotForPanel: number[];
}

/** Distinct materials worn by the given panels, plus each panel's slot index. */
export function fabricSlotPlan(project: Project, panelIds: string[]): FabricSlotPlan {
  const fabrics: (Fabric | null)[] = [];
  const indexOf = new Map<string, number>();
  const slotForPanel: number[] = [];
  for (const panelId of panelIds) {
    const fabric = fabricForPanel(project, panelId);
    // Panels without a record share one fallback slot.
    const key = fabric ? fabric.id : 'missing';
    let slot = indexOf.get(key);
    if (slot === undefined) {
      slot = fabrics.length;
      fabrics.push(fabric);
      indexOf.set(key, slot);
    }
    slotForPanel.push(slot);
  }
  return { fabrics, slotForPanel };
}
