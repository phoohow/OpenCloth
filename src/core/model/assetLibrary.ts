import type { Fabric, Project, TrimKind } from './types';
import {
  createFabric, FABRIC_PRESET_KEYS, FABRIC_PRESET_LABELS, TRIM_KIND_LABELS, TRIM_KINDS, genId,
} from './defaults';
import { clonedFabric, uniqueFabricName } from './fabric';

/** One material card in the asset library; presets and saved copies share the shape. */
export interface FabricAsset {
  id: string;
  name: string;
  /** Preset cards come from `FABRIC_PRESET_KEYS`, saved cards from the user library. */
  source: 'preset' | 'user';
  presetKey?: Fabric['presetKey'];
  /** Template record; applying clones it with a fresh id and a unique name. */
  fabric: Fabric;
  createdAt?: string;
}

/** One trim spec in the asset library. */
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

/** Default size and colour of each trim kind. */
export const TRIM_ASSET_DEFAULTS: Record<TrimKind, { sizeMm: number; color: string }> = {
  button: { sizeMm: 12, color: '#b08d57' },
  eyelet: { sizeMm: 8, color: '#c9c9c9' },
  rivet: { sizeMm: 8, color: '#b08d57' },
  snap: { sizeMm: 12, color: '#b08d57' },
};

/** Built-in material cards, one per preset. */
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

/** Built-in trim cards, one per kind with the default size and colour. */
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

/** Saves a copy of a material as a user asset; the template keeps its physics and appearance. */
export function fabricAssetFrom(fabric: Fabric, name?: string): FabricAsset {
  const template = structuredClone(fabric);
  return {
    id: genId('asset'),
    name: name?.trim() || fabric.name,
    source: 'user',
    presetKey: fabric.presetKey,
    fabric: { ...template, name: name?.trim() || fabric.name },
    createdAt: new Date().toISOString(),
  };
}

/** Saves one trim spec as a user asset. */
export function trimAssetFrom(asset: Omit<TrimAsset, 'id' | 'source' | 'createdAt'>): TrimAsset {
  return {
    ...asset,
    id: genId('asset'),
    source: 'user',
    createdAt: new Date().toISOString(),
  };
}

/** Clone of an asset material with a fresh id and a name unique in the project. */
export function fabricFromAsset(project: Project, asset: FabricAsset): Fabric {
  const copy = clonedFabric(project, asset.fabric);
  return { ...copy, name: uniqueFabricName(project, asset.name) };
}

/** Short summary shown on a material card. */
export function fabricAssetSummary(asset: FabricAsset): string {
  const physics = asset.fabric.physics;
  return `${physics.massPerArea} g/m² · 拉伸 ${physics.stretchStiffness.toFixed(2)} · 弯曲 ${physics.bendingStiffness.toFixed(2)}`;
}
