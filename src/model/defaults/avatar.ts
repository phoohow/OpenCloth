import type { Avatar, AvatarParams, SkinAppearance } from '@/model/types';
import { genId } from '@/base/id';

/** Body mesh shipped in assets/models and served from the site root. */
export interface BundledAvatar {
  url: string;
  label: string;
  /** Measurements matching the mesh, applied when the model is selected. */
  params: AvatarParams;
}

/** Measurements of an adult woman of 175 cm: bust 88, waist 70, hip 98. */
const FEMALE_PARAMS: AvatarParams = { heightCm: 175, chestCm: 88, waistCm: 70, hipCm: 98, poseArmAngleRad: 0.12 };
/** Measurements of an adult man of 170 cm: chest 94, waist 80, hip 96. */
const MALE_PARAMS: AvatarParams = { heightCm: 170, chestCm: 94, waistCm: 80, hipCm: 96, poseArmAngleRad: 0.12 };

/** Bundled body meshes, first entry is the default. */
export const BUNDLED_AVATARS: BundledAvatar[] = [
  { url: '/models/human-body-f.glb', label: '女性模特', params: FEMALE_PARAMS },
  { url: '/models/human-body-pro.glb', label: '专业模特', params: MALE_PARAMS },
  { url: '/models/human-body.glb', label: '标准模特', params: MALE_PARAMS },
];

/** Bundled body mesh used by a fresh project. */
const DEFAULT_AVATAR = BUNDLED_AVATARS[0];
/** Url of that default mesh. */
export const BUNDLED_AVATAR_URL = DEFAULT_AVATAR.url;

/** Skin appearance of a body without its own record: warm light tan, matte, faint highlight. */
export const DEFAULT_SKIN_APPEARANCE: SkinAppearance = {
  color: '#d6a97e', roughness: 0.55, clearcoat: 0.08,
};

/** Avatar dressed in the default bundled mesh and its measurements. */
export function createDefaultAvatar(): Avatar {
  return {
    id: genId('avatar'),
    source: 'glb',
    params: { ...DEFAULT_AVATAR.params },
    glbUrl: BUNDLED_AVATAR_URL,
    appearance: { ...DEFAULT_SKIN_APPEARANCE },
    display: 'visible',
  };
}
