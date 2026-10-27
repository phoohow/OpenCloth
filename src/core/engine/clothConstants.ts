import type { FabricAppearance, FabricPhysics } from '../model/types';
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
