import type { Project, RenderMode } from '../model/types';
import { fabricForPanel } from '../model/fabric';
import { FALLBACK_PHYSICS } from './clothConstants';

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
