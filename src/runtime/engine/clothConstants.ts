import type { EditPreviewTier, FabricAppearance, FabricPhysics } from '@/model/types';

import { FABRIC_PHYSICS_PRESETS } from '@/model';

export const FALLBACK_APPEARANCE: FabricAppearance = {
  baseColor: '#cccccc', metallic: 0, roughness: 0.8, normalScale: 0.5,
  sheenColor: '#ffffff', sheenIntensity: 0.2, sheenRoughness: 0.4,
  transmission: 0, thickness: 0.4, clearcoat: 0, clearcoatRoughness: 0.5,
  anisotropy: 0, iridescence: 0, maps: {},
  uvTiling: { x: 1, y: 1 }, uvOffset: { x: 0, y: 0 },
};

export const FALLBACK_PHYSICS: FabricPhysics = structuredClone(FABRIC_PHYSICS_PRESETS.cotton);

export const PREVIEW_COARSE_RESOLUTION_CM = 6;

export const DRAG_GRAB_RADIUS_M = 0.03;

export const DRAG_MAX_REACH_M = 1;

export const PIN_HOVER_RADIUS_PX = 14;

export function editPreviewResolutionCm(tier: EditPreviewTier, projectResolutionCm: number): number {
  return tier === 'low' ? PREVIEW_COARSE_RESOLUTION_CM : projectResolutionCm;
}
