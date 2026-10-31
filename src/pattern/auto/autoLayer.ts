import type { Pattern } from '../../core/model/types';
import { resolveDrape } from '../drape/drapePlacement';

/** Highest collision layer the auto-assignment recognises. */
const MAX_LAYER = 9;

/**
 * Assigns collision layers from seam connectivity: panels joined by a seam form one garment,
 * each separate garment gets its own layer ordered by mean drape ease, innermost first.
 */
export function inferCollisionLayers(pattern: Pattern): Map<string, number> {
  const panelIds = Object.keys(pattern.panels);
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();
  const edgePanel = new Map<string, string>();

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(id) !== root) {
      const next = parent.get(id)!;
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if ((rank.get(ra) ?? 0) < (rank.get(rb) ?? 0)) parent.set(ra, rb);
    else if ((rank.get(ra) ?? 0) > (rank.get(rb) ?? 0)) parent.set(rb, ra);
    else { parent.set(rb, ra); rank.set(ra, (rank.get(ra) ?? 0) + 1); }
  };

  for (const panel of Object.values(pattern.panels)) {
    parent.set(panel.id, panel.id);
    rank.set(panel.id, 0);
    for (const edgeId of [...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()]) {
      edgePanel.set(edgeId, panel.id);
    }
  }

  for (const seam of Object.values(pattern.seams)) {
    const a = edgePanel.get(seam.a.edgeId);
    const b = edgePanel.get(seam.b.edgeId);
    if (a && b) union(a, b);
  }

  const components = new Map<string, string[]>();
  for (const panelId of panelIds) {
    const root = find(panelId);
    const list = components.get(root);
    if (list) list.push(panelId);
    else components.set(root, [panelId]);
  }

  const easeOf = (panelId: string): number => resolveDrape(pattern.panels[panelId]).easeCm;
  const ordered = [...components.values()].sort((a, b) => {
    const easeA = a.reduce((sum, id) => sum + easeOf(id), 0) / a.length;
    const easeB = b.reduce((sum, id) => sum + easeOf(id), 0) / b.length;
    if (easeA !== easeB) return easeA - easeB;
    return a[0].localeCompare(b[0]);
  });

  const layers = new Map<string, number>();
  ordered.forEach((component, index) => {
    const layer = Math.min(MAX_LAYER, index);
    for (const panelId of component) layers.set(panelId, layer);
  });
  return layers;
}