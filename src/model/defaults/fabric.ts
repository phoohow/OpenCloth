import type { Fabric, FabricAppearance, FabricPhysics, FabricPresetKey } from '@/model/types';
import { vec2 } from '@/model/types';
import { genId } from '@/common/id';

/** Contact friction used when a fabric record does not set one. */
export const DEFAULT_CONTACT_FRICTION = 0.5;
/** Relative elongation used when a fabric record does not set one. */
export const DEFAULT_STRETCH_LIMIT = 0.08;
/** Relative compression used when a fabric record does not set one. */
export const DEFAULT_COMPRESSION_LIMIT = 0.1;

/** Solver parameters per fabric preset, in grams per square metre for the preset's weight. */
export const FABRIC_PHYSICS_PRESETS: Record<FabricPresetKey, FabricPhysics> = {
  cotton: {
    stretchStiffness: 0.9, bendingStiffness: 0.4, shearStiffness: 0.8, massPerArea: 180,
    damping: 0.02, contactFriction: 0.55, stretchLimit: 0.08, compressionLimit: 0.1,
  },
  silk: {
    stretchStiffness: 0.95, bendingStiffness: 0.15, shearStiffness: 0.85, massPerArea: 80,
    damping: 0.015, contactFriction: 0.35, stretchLimit: 0.12, compressionLimit: 0.08,
  },
  denim: {
    stretchStiffness: 0.8, bendingStiffness: 0.75, shearStiffness: 0.7, massPerArea: 400,
    damping: 0.03, contactFriction: 0.7, stretchLimit: 0.06, compressionLimit: 0.06,
  },
  knit: {
    stretchStiffness: 0.5, bendingStiffness: 0.25, shearStiffness: 0.4, massPerArea: 250,
    damping: 0.02, contactFriction: 0.5, stretchLimit: 0.25, compressionLimit: 0.2,
  },
};

/** Surface shading per fabric preset. */
export const FABRIC_APPEARANCE_PRESETS: Record<FabricPresetKey, FabricAppearance> = {
  cotton: {
    baseColor: '#e8e4d8', metallic: 0, roughness: 0.85, normalScale: 0.5,
    sheenColor: '#fff8ee', sheenIntensity: 0.15, sheenRoughness: 0.6,
    transmission: 0, thickness: 0.4, clearcoat: 0, clearcoatRoughness: 0.5,
    anisotropy: 0, iridescence: 0,
    maps: {}, uvTiling: vec2(1, 1), uvOffset: vec2(0, 0),
  },
  silk: {
    baseColor: '#d4a574', metallic: 0, roughness: 0.35, normalScale: 0.3,
    sheenColor: '#ffe8cc', sheenIntensity: 0.6, sheenRoughness: 0.25,
    transmission: 0.06, thickness: 0.15, clearcoat: 0.15, clearcoatRoughness: 0.3,
    anisotropy: 0.35, iridescence: 0,
    maps: {}, uvTiling: vec2(1, 1), uvOffset: vec2(0, 0),
  },
  denim: {
    baseColor: '#3a5a8c', metallic: 0, roughness: 0.9, normalScale: 0.8,
    sheenColor: '#6a8cbc', sheenIntensity: 0.1, sheenRoughness: 0.8,
    transmission: 0, thickness: 1, clearcoat: 0, clearcoatRoughness: 0.5,
    anisotropy: 0, iridescence: 0,
    maps: {}, uvTiling: vec2(1, 1), uvOffset: vec2(0, 0),
  },
  knit: {
    baseColor: '#b85450', metallic: 0, roughness: 0.95, normalScale: 1.0,
    sheenColor: '#d88884', sheenIntensity: 0.25, sheenRoughness: 0.9,
    transmission: 0, thickness: 0.6, clearcoat: 0, clearcoatRoughness: 0.5,
    anisotropy: 0, iridescence: 0,
    maps: {}, uvTiling: vec2(1, 1), uvOffset: vec2(0, 0),
  },
};

/** Display names of the fabric presets, in the order the UI lists them. */
export const FABRIC_PRESET_LABELS: Record<FabricPresetKey, string> = {
  cotton: '棉',
  silk: '丝绸',
  denim: '牛仔',
  knit: '针织',
};

/** Presets offered when a new material is created. */
export const FABRIC_PRESET_KEYS = Object.keys(FABRIC_PRESET_LABELS) as FabricPresetKey[];

/** A new material record seeded from a preset. */
export function createFabric(preset: FabricPresetKey = 'cotton', name?: string): Fabric {
  return {
    id: genId('fabric'),
    name: name ?? FABRIC_PRESET_LABELS[preset],
    presetKey: preset,
    appearance: structuredClone(FABRIC_APPEARANCE_PRESETS[preset]),
    physics: structuredClone(FABRIC_PHYSICS_PRESETS[preset]),
  };
}

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/**
 * Fills and clamps the optional fabric physics fields a parsed project may omit.
 * Missing values fall back to the fabric's own preset, cotton when the preset is unknown.
 */
export function normalizeFabricPhysics(
  physics: Partial<FabricPhysics> | undefined,
  presetKey: FabricPresetKey = 'cotton',
): FabricPhysics {
  const preset = FABRIC_PHYSICS_PRESETS[presetKey] ?? FABRIC_PHYSICS_PRESETS.cotton;
  const base = physics ?? {};
  return {
    ...preset,
    ...base,
    contactFriction: clampNumber(
      base.contactFriction, preset.contactFriction ?? DEFAULT_CONTACT_FRICTION, 0, 1,
    ),
    stretchLimit: clampNumber(base.stretchLimit, preset.stretchLimit ?? DEFAULT_STRETCH_LIMIT, 0.001, 1),
    compressionLimit: clampNumber(
      base.compressionLimit, preset.compressionLimit ?? DEFAULT_COMPRESSION_LIMIT, 0.001, 1,
    ),
  };
}
