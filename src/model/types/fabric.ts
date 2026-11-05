/**
 * Materials: how a fabric looks, how it behaves under the solver, and the knit
 * structure a knitted fabric carries.
 */

import type { Vec2 } from '@/model/types/geometry';

// ============ Fabric ============

/** Built-in fabric presets a new material starts from. */
export type FabricPresetKey = 'cotton' | 'silk' | 'denim' | 'knit';

/** Image slot of a fabric's material maps. */
export type FabricMapSlot = 'albedo' | 'normal' | 'roughness' | 'metallic';

/** Image references of the material maps; null clears a slot. */
export interface FabricMaps {
  albedo?: string | null;
  normal?: string | null;
  roughness?: string | null;
  metallic?: string | null;
  /** File names shown beside the slots; a slot without one has no display name. */
  fileNames?: Partial<Record<FabricMapSlot, string>>;
}

/** How a fabric looks in the viewport and in exports. */
export interface FabricAppearance {
  baseColor: string;
  metallic: number;
  roughness: number;
  normalScale: number;
  sheenColor: string;
  sheenIntensity: number;
  /** Light passing through the fabric, 0..1. */
  transmission: number;
  /** Thickness used by transmission, in millimetres. */
  thickness: number;
  /** Clear coat layer strength, 0..1. */
  clearcoat: number;
  /** Clear coat roughness, 0..1. */
  clearcoatRoughness: number;
  /** Stretched-highlight strength for satin and brushed surfaces, 0..1. */
  anisotropy: number;
  /** Thin-film iridescence strength, 0..1. */
  iridescence: number;
  /** Sheen highlight spread, 0..1. */
  sheenRoughness: number;
  maps: FabricMaps;
  uvTiling: Vec2;
  uvOffset: Vec2;
}

/** How a fabric behaves under the solver. */
export interface FabricPhysics {
  stretchStiffness: number;
  bendingStiffness: number;
  shearStiffness: number;
  massPerArea: number;
  damping: number;
  /**
   * Bending stiffness of the creases a panel's fold lines produce, 0..1; absent uses
   * `DEFAULT_CREASE_STIFFNESS`. Never softer than the fabric's own bending stiffness.
   */
  creaseStiffness?: number;
  /** Tangential pull toward the previous position while touching the body or floor, 0..1. */
  contactFriction?: number;
  /** Relative elongation the fabric tolerates, 0..1; absent uses the cotton preset. */
  stretchLimit?: number;
  /** Relative compression the fabric tolerates, 0..1; absent uses the cotton preset. */
  compressionLimit?: number;
}

/** Flat-knit structure of a knitted fabric. */
export type KnitStitch = 'jersey' | 'rib2' | 'cable';

/** Knitting density and stitch structure stored on a material. */
export interface KnitSpec {
  stitch: KnitStitch;
  /** Needles per 10 cm across the fabric. */
  needleGauge: number;
  /** Courses per 10 cm along the fabric. */
  rowGauge: number;
}

/** One material record worn by panels. */
export interface Fabric {
  id: string;
  name: string;
  presetKey?: FabricPresetKey;
  appearance: FabricAppearance;
  physics: FabricPhysics;
  /** Present for knitted fabrics; absent means the material carries no knit structure. */
  knit?: KnitSpec;
}
