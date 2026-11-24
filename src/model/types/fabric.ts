import type { Vec2 } from '@/model/types/geometry';

export type FabricPresetKey = 'cotton' | 'silk' | 'denim' | 'knit';

export type FabricMapSlot = 'albedo' | 'normal' | 'roughness' | 'metallic';

export interface FabricMaps {
  albedo?: string | null;
  normal?: string | null;
  roughness?: string | null;
  metallic?: string | null;
  fileNames?: Partial<Record<FabricMapSlot, string>>;
}

export interface FabricAppearance {
  baseColor: string;
  metallic: number;
  roughness: number;
  normalScale: number;
  sheenColor: string;
  sheenIntensity: number;
  transmission: number;
  thickness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  anisotropy: number;
  iridescence: number;
  sheenRoughness: number;
  maps: FabricMaps;
  uvTiling: Vec2;
  uvOffset: Vec2;
}

export interface FabricPhysics {
  stretchStiffness: number;
  shearStiffness: number;
  massPerArea: number;
  damping: number;
  creaseStiffness?: number;
  contactFriction?: number;
  stretchLimit?: number;
  compressionLimit?: number;
}

export type KnitStitch = 'jersey' | 'rib2' | 'cable';

export interface KnitSpec {
  stitch: KnitStitch;
  needleGauge: number;
  rowGauge: number;
}

export interface Fabric {
  id: string;
  name: string;
  presetKey?: FabricPresetKey;
  assetId?: string;
  appearance: FabricAppearance;
  physics: FabricPhysics;
  knit?: KnitSpec;
}
