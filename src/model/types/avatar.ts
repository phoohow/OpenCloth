import type { ObjectTransform } from '@/model/types/geometry';

export type AvatarSource = 'makehuman' | 'glb';

export type AvatarDisplay = 'visible' | 'hidden' | 'translucent';

export interface AvatarParams {
  heightCm: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  gender?: number;
  ageYears?: number;
  muscle?: number;
  weight?: number;
  pose?: AvatarPose;
}

export type AvatarPose = 'a' | 't';

export interface SkinAppearance {
  color: string;
  roughness: number;
  clearcoat: number;
}

export interface Avatar {
  id: string;
  name?: string;
  source: AvatarSource;
  params: AvatarParams;
  glbObjectKey?: string;
  glbUrl?: string;
  modelName?: string;
  transform?: ObjectTransform;
  appearance?: SkinAppearance;
  softBody?: boolean;
  display: AvatarDisplay;
}
