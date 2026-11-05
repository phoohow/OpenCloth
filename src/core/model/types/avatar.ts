/**
 * The body the garment dresses: source, measurements, pose and surface appearance.
 */

import type { ObjectTransform } from './geometry';

// ============ Avatar ============

/** Body mesh from the procedural capsules or from a model file. */
export type AvatarSource = 'procedural' | 'glb';

/** How the avatar shows behind the garment. */
export type AvatarDisplay = 'visible' | 'hidden' | 'translucent';

/** Rotations at the joints of one limb chain, in radians. */
export interface LimbPose {
  /** Forward swing of the arm about the shoulder. */
  shoulderFlexRad?: number;
  /** Forward bend of the forearm about the elbow. */
  elbowBendRad?: number;
  /** Forward swing of the thigh about the hip. */
  hipFlexRad?: number;
  /** Backward bend of the calf about the knee. */
  kneeBendRad?: number;
}

/** Joint rotations of the left and right limbs. */
export interface JointPose {
  left?: LimbPose;
  right?: LimbPose;
}

/** Body measurements in centimeters. */
export interface AvatarParams {
  heightCm: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  /** Outward arm rake from vertical, in radians; default 0.12. */
  poseArmAngleRad?: number;
  /** Outward leg splay from vertical, in radians; default 0. */
  poseLegSpreadRad?: number;
  /** Lateral torso lean from vertical, in radians; default 0. */
  poseTorsoLeanRad?: number;
  /** Per-side shoulder, elbow, hip and knee rotations; absent means a straight relaxed pose. */
  joints?: JointPose;
}

/** Surface appearance of the avatar body. */
export interface SkinAppearance {
  /** Base skin colour, sRGB hex. */
  color: string;
  /** Diffuse roughness, 0..1; higher is more matte. */
  roughness: number;
  /** Strength of the oily highlight layer, 0..1. */
  clearcoat: number;
}

/** The body the garment dresses. */
export interface Avatar {
  id: string;
  /** Display name of the body in the outliner; absent means the model name. */
  name?: string;
  source: AvatarSource;
  params: AvatarParams;
  /** Bundled model key or url of the avatar mesh. */
  glbUrl?: string;
  /** Blob key of an imported avatar model in the local object store. */
  glbObjectKey?: string;
  /** Target height in meters for an imported model; defaults to params.heightCm. */
  heightCm?: number;
  /** Display name of an imported glb model. */
  modelName?: string;
  /** Scene placement; absent means the identity transform. */
  transform?: ObjectTransform;
  /** Skin appearance of the body; absent means `DEFAULT_SKIN_APPEARANCE`. */
  appearance?: SkinAppearance;
  /** Compresses the chest and abdomen where the cloth presses; absent means off. */
  softBody?: boolean;
  display: AvatarDisplay;
}
