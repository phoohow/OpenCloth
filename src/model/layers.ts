import type { GarmentLayer, Panel, Project } from '@/model/types';

import { cmToM } from '@/base/units';
import {
  DEFAULT_CLOTH_THICKNESS_CM, DEFAULT_LAYER_THICKNESS_CM, GARMENT_LAYER_COLLISION, GARMENT_LAYERS,
} from '@/model/defaults';

const MAX_LAYER_THICKNESS_CM = 2;

export function layerThicknessCm(project: Project): Record<GarmentLayer, number> {
  const raw = project.layerThicknessCm;
  const out: Record<GarmentLayer, number> = { ...DEFAULT_LAYER_THICKNESS_CM };
  for (const layer of GARMENT_LAYERS) {
    const value = raw?.[layer];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[layer] = Math.min(MAX_LAYER_THICKNESS_CM, Math.max(0, value));
    }
  }

  return out;
}

export function panelThicknessCm(project: Project, panel: Panel | undefined): number {
  if (panel?.layer) return layerThicknessCm(project)[panel.layer];
  const global = project.scene.simulation.clothThicknessCm;
  return typeof global === 'number' && Number.isFinite(global)
    ? Math.min(1, Math.max(0, global))
    : DEFAULT_CLOTH_THICKNESS_CM;
}

export function panelCollisionLayer(panel: Panel): number {
  if (typeof panel.collisionLayer === 'number' && Number.isFinite(panel.collisionLayer)) {
    return Math.min(9, Math.max(0, Math.round(panel.collisionLayer)));
  }

  return panel.layer ? GARMENT_LAYER_COLLISION[panel.layer] : 0;
}

export function particleThicknessMeters(
  project: Project,
  panels: readonly { panelId: string; vertexOffset: number; vertexCount: number }[],
  particleCount: number,
): Float32Array<ArrayBuffer> {
  const fallback = cmToM(panelThicknessCm(project, undefined));
  const out = new Float32Array(particleCount).fill(fallback);
  for (const panel of panels) {
    const thickness = cmToM(panelThicknessCm(project, project.pattern.panels[panel.panelId]));
    const end = Math.min(panel.vertexOffset + panel.vertexCount, particleCount);
    for (let i = panel.vertexOffset; i < end; i++) out[i] = thickness;
  }

  return out;
}

export function particleCollisionLayers(
  project: Project,
  panels: readonly { panelId: string; vertexOffset: number; vertexCount: number }[],
  particleCount: number,
): Uint8Array {
  const out = new Uint8Array(particleCount);
  for (const panel of panels) {
    const record = project.pattern.panels[panel.panelId];
    const layer = record ? panelCollisionLayer(record) : 0;
    const end = Math.min(panel.vertexOffset + panel.vertexCount, particleCount);
    for (let i = panel.vertexOffset; i < end; i++) out[i] = layer;
  }

  return out;
}
