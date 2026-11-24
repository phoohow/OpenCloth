import type { Fabric, FabricAppearance, FabricPhysics, FabricPresetKey } from '@/model/types';

import { genId } from '@/base/id';
import { DEFAULT_KNIT_SPEC } from '@/model/knit';
import { vec2 } from '@/model/types';

export const DEFAULT_CREASE_STIFFNESS = 0.9;

export const DEFAULT_CONTACT_FRICTION = 0.5;

export const DEFAULT_STRETCH_LIMIT = 0.08;

export const DEFAULT_COMPRESSION_LIMIT = 0.1;

export const FABRIC_PHYSICS_PRESETS: Record<FabricPresetKey, FabricPhysics> = {
  cotton: {
    stretchStiffness: 0.9, shearStiffness: 0.8, massPerArea: 180,
    damping: 0.02, contactFriction: 0.25, stretchLimit: 0.08, compressionLimit: 0.1,
  },
  silk: {
    stretchStiffness: 0.95, shearStiffness: 0.85, massPerArea: 80,
    damping: 0.015, contactFriction: 0.15, stretchLimit: 0.12, compressionLimit: 0.08,
  },
  denim: {
    stretchStiffness: 0.8, shearStiffness: 0.7, massPerArea: 400,
    damping: 0.03, contactFriction: 0.45, stretchLimit: 0.06, compressionLimit: 0.06,
  },
  knit: {
    stretchStiffness: 0.5, shearStiffness: 0.4, massPerArea: 250,
    damping: 0.02, contactFriction: 0.35, stretchLimit: 0.25, compressionLimit: 0.2,
  },
};

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

export const FABRIC_PRESET_LABELS: Record<FabricPresetKey, string> = {
  cotton: '纯棉',
  silk: '丝绸',
  denim: '牛仔',
  knit: '针织',
};

export const FABRIC_PRESET_KEYS = Object.keys(FABRIC_PRESET_LABELS) as FabricPresetKey[];

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function createFabric(preset: FabricPresetKey = 'cotton', name?: string): Fabric {
  const fabric: Fabric = {
    id: genId('fabric'),
    name: name ?? FABRIC_PRESET_LABELS[preset],
    presetKey: preset,
    appearance: structuredClone(FABRIC_APPEARANCE_PRESETS[preset]),
    physics: structuredClone(FABRIC_PHYSICS_PRESETS[preset]),
  };
  if (preset === 'knit') fabric.knit = structuredClone(DEFAULT_KNIT_SPEC);
  return fabric;
}

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
