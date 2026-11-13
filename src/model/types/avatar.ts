/**
 * The body the garment dresses: measurements, build and surface appearance.
 */

import type { ObjectTransform } from '@/model/types/geometry';

/** How the body is produced: the built-in parametric mannequin, or an imported model file. */
export type AvatarSource = 'makehuman' | 'glb';

/** How the avatar shows behind the garment. */
export type AvatarDisplay = 'visible' | 'hidden' | 'translucent';

/**
 * Build and measurements the MakeHuman body is made from.
 *
 * The measurements are the numbers the size chart and the points of measure read, so the body
 * always matches the garment it is dressed in. They feed MakeHuman's own measurement modifiers:
 * the bust, waist and hip girths are solved on the mesh by cutting cross-sections, exactly the
 * quantities `measure-bust`, `measure-waist` and `measure-hips` stand for.
 *
 * The build fields are MakeHuman's macrodetails sliders, which decide the base figure the
 * measurements are solved on. Only the four the body build reads are kept: gender, age, muscle
 * and weight.
 */
export interface AvatarParams {
  heightCm: number;
  /** Bust girth, at the fullest part of the chest. MakeHuman `measure-bust`. */
  chestCm: number;
  /** Natural waist girth, at the narrowest section above the hip. MakeHuman `measure-waist`. */
  waistCm: number;
  /** Hip girth, at the widest point of the seat. MakeHuman `measure-hips`. */
  hipCm: number;
  /** Build from 0 (female) to 1 (male); absent means female. MakeHuman `macrodetails/Gender`. */
  gender?: number;
  /** Age in years, 1 to 90. MakeHuman `macrodetails/Age`. */
  ageYears?: number;
  /** Muscle tone from 0 (slight) to 1 (athletic), 0.5 average. MakeHuman `MacroMuscle`. */
  muscle?: number;
  /** Body weight from 0 (slight) to 1 (heavy), 0.5 average. MakeHuman `MacroWeight`. */
  weight?: number;
  /** Arm pose the body is built in: the rest A-pose, or arms out horizontally. */
  pose?: AvatarPose;
}

/** Arm pose of the body, which decides where the sleeves are wrapped. */
export type AvatarPose = 'a' | 't';

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
  /** Display name of the body in the outliner; absent means the source's own label. */
  name?: string;
  source: AvatarSource;
  params: AvatarParams;
  /** Blob key of an imported avatar model in the local object store. */
  glbObjectKey?: string;
  /** Embedded data URL of an imported model, carried by projects that travel between machines. */
  glbUrl?: string;
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
