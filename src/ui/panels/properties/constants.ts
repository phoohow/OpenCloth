import type { Vec3 } from '@/model/types';
import { degToRad, radToDeg } from '@/base/math';
import type { PropTab } from '@/store';
import { supportsMaterial, supportsSimulator, supportsTransform, type SceneNodeKind } from '@/ui/sceneTree';
import { PROP_TAB_OPTIONS } from '@/ui/optionTables';

/** Model select value for a user-imported body mesh. */
export const CUSTOM_MODEL = 'custom';

export const degVec = (v: Vec3): Vec3 => ({ x: radToDeg(v.x), y: radToDeg(v.y), z: radToDeg(v.z) });
export const radVec = (v: Vec3): Vec3 => ({ x: degToRad(v.x), y: degToRad(v.y), z: degToRad(v.z) });

/** Tabs that apply to an outliner row kind, in rail order. Identity and data share the "对象" tab. */
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
