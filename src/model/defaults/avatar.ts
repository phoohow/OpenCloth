import type { Avatar, AvatarParams, SkinAppearance } from '@/model/types';

import { genId } from '@/base/id';

const DEFAULT_PARAMS: AvatarParams = {
  heightCm: 175, chestCm: 88, waistCm: 70, hipCm: 98, gender: 0, ageYears: 25,
};

export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  { id: 'woman', label: '女性', params: { ...DEFAULT_PARAMS } },
  { id: 'man', label: '男性', params: { heightCm: 182, chestCm: 102, waistCm: 84, hipCm: 102, gender: 1, ageYears: 30 } },
  { id: 'girl', label: '女孩', params: { heightCm: 130, chestCm: 64, waistCm: 58, hipCm: 70, gender: 0, ageYears: 8 } },
  { id: 'boy', label: '男孩', params: { heightCm: 128, chestCm: 64, waistCm: 58, hipCm: 68, gender: 1, ageYears: 8 } },
];

export const DEFAULT_SKIN_APPEARANCE: SkinAppearance = {
  color: '#d6a97e', roughness: 0.55, clearcoat: 0.08,
};

export interface AvatarPreset {
  id: string;
  label: string;
  params: AvatarParams;
}

export function matchAvatarPreset(params: AvatarParams): AvatarPreset | undefined {
  return AVATAR_PRESETS.find(item =>
    item.params.heightCm === params.heightCm
    && item.params.chestCm === params.chestCm
    && item.params.waistCm === params.waistCm
    && item.params.hipCm === params.hipCm
    && item.params.gender === params.gender
    && item.params.ageYears === params.ageYears);
}

export function createDefaultAvatar(): Avatar {
  return {
    id: genId('avatar'),
    source: 'makehuman',
    params: { ...DEFAULT_PARAMS },
    appearance: { ...DEFAULT_SKIN_APPEARANCE },
    display: 'visible',
  };
}
