import type { EditPreviewTier, FabricAppearance, FabricPhysics } from '../model/types';
import { FABRIC_PHYSICS_PRESETS } from '../model/defaults';

/** Scene object name marking a cloth selection overlay. */
export const CLOTH_OVERLAY_NAME = 'clothSelectionOverlay';

/** Scene object name marking an avatar selection overlay. */
export const AVATAR_OVERLAY_NAME = 'avatarSelectionOverlay';

/** Appearance used when a panel's material record is missing. */
export const FALLBACK_APPEARANCE: FabricAppearance = {
  baseColor: '#cccccc', metallic: 0, roughness: 0.8, normalScale: 0.5,
  sheenColor: '#ffffff', sheenIntensity: 0.2, maps: {},
  uvTiling: { x: 1, y: 1 }, uvOffset: { x: 0, y: 0 },
};

/** Physics used when a panel's material record is missing. */
export const FALLBACK_PHYSICS: FabricPhysics = structuredClone(FABRIC_PHYSICS_PRESETS.cotton);

/** Mesh density the coarse edit preview rebuilds at, in centimeters per edge. */
export const PREVIEW_COARSE_RESOLUTION_CM = 6;

/** Mesh density an edit preview builds at; the full tier keeps the project's own density. */
export function editPreviewResolutionCm(tier: EditPreviewTier, projectResolutionCm: number): number {
  return tier === 'low' ? PREVIEW_COARSE_RESOLUTION_CM : projectResolutionCm;
}
