import type { Vec3 } from '@/model/types';
import type { PropTab } from '@/store';

import { degToRad, radToDeg } from '@/base/math';
import { PROP_TAB_OPTIONS } from '@/ui/optionTables';
import { supportsMaterial, supportsSimulator, supportsTransform, type SceneNodeKind } from '@/ui/sceneTree';

export const CUSTOM_MODEL = 'custom';

export const degVec = (v: Vec3): Vec3 => ({ x: radToDeg(v.x), y: radToDeg(v.y), z: radToDeg(v.z) });

export const radVec = (v: Vec3): Vec3 => ({ x: degToRad(v.x), y: degToRad(v.y), z: degToRad(v.z) });

export const transparencyOf = (opacity: number): number => Math.round((1 - opacity) * 100) / 100;

export const opacityOf = (transparency: number): number => Math.round((1 - transparency) * 100) / 100;

export function tabsForKind(kind: SceneNodeKind | null): PropTab[] {
  const isObject = kind !== null && kind !== 'scene' && kind !== 'collection';
  const allowed: Record<PropTab, boolean> = {
    object: isObject,
    material: kind !== null && supportsMaterial(kind),
    simulator: kind !== null && supportsSimulator(kind),
    pattern: true,
    transform: kind !== null && supportsTransform(kind),
    render: true,
    project: true,
  };
  return PROP_TAB_OPTIONS.filter(t => allowed[t.key]).map(t => t.key);
}
