import type { Fabric, Project, TrimKind } from '@/model/types';

import {
  createFabric, FABRIC_PRESET_KEYS, FABRIC_PRESET_LABELS, TRIM_KIND_LABELS, TRIM_KINDS,
} from '@/model/defaults';
import { clonedFabric, uniqueFabricName } from '@/model/fabric';

export const TRIM_ASSET_DEFAULTS: Record<TrimKind, { sizeMm: number; color: string }> = {
  button: { sizeMm: 12, color: '#b08d57' },
  eyelet: { sizeMm: 8, color: '#c9c9c9' },
  rivet: { sizeMm: 8, color: '#b08d57' },
  snap: { sizeMm: 12, color: '#b08d57' },
};

export interface FabricAsset {
  id: string;
  name: string;
  source: 'preset' | 'user';
  presetKey?: Fabric['presetKey'];
  fabric: Fabric;
  createdAt?: string;
}

export interface TrimAsset {
  id: string;
  name: string;
  source: 'preset' | 'user';
  kind: TrimKind;
  sizeMm: number;
  color: string;
  qty: number;
  unitPrice?: number;
  createdAt?: string;
}

export function builtInFabricAssets(): FabricAsset[] {
  return FABRIC_PRESET_KEYS.map(key => {
    const fabric = createFabric(key);
    return {
      id: `preset:fabric:${key}`,
      name: FABRIC_PRESET_LABELS[key],
      source: 'preset' as const,
      presetKey: key,
      fabric,
    };
  });
}

export function builtInTrimAssets(): TrimAsset[] {
  return TRIM_KINDS.map(kind => ({
    id: `preset:trim:${kind}`,
    name: TRIM_KIND_LABELS[kind],
    source: 'preset' as const,
    kind,
    ...TRIM_ASSET_DEFAULTS[kind],
    qty: 1,
  }));
}

export function fabricFromAsset(project: Project, asset: FabricAsset): Fabric {
  const copy = clonedFabric(project, asset.fabric);
  return { ...copy, name: uniqueFabricName(project, asset.name), assetId: asset.id };
}

export function fabricAssetSummary(asset: FabricAsset): string {
  const physics = asset.fabric.physics;
  return `${physics.massPerArea} g/m² · 拉伸 ${physics.stretchStiffness.toFixed(2)} · 剪切 ${physics.shearStiffness.toFixed(2)}`;
}
