import type { Vec3 } from '../../../core/model/types';
import type { PropTab } from '../../../store/stores';
import { supportsMaterial, supportsPhysics, type SceneNodeKind } from '../../sceneTree';
import { PROP_TAB_OPTIONS } from '../../optionTables';

/** Avatar kinds the model select lists when the project has no bundled url. */
export const PROCEDURAL_MODEL = 'procedural';
/** Model select value for a user-imported body mesh. */
export const CUSTOM_MODEL = 'custom';

export const toDeg = (r: number): number => r * 180 / Math.PI;
export const toRad = (d: number): number => d * Math.PI / 180;
export const degVec = (v: Vec3): Vec3 => ({ x: toDeg(v.x), y: toDeg(v.y), z: toDeg(v.z) });
export const radVec = (v: Vec3): Vec3 => ({ x: toRad(v.x), y: toRad(v.y), z: toRad(v.z) });

/** Tabs that apply to an outliner row kind, in rail order. Identity and data share the "对象" tab. */
export function tabsForKind(kind: SceneNodeKind | null): PropTab[] {
  const isObject = kind !== null && kind !== 'scene' && kind !== 'collection';
  const allowed: Record<PropTab, boolean> = {
    object: isObject,
    material: kind !== null && supportsMaterial(kind),
    physics: kind !== null && supportsPhysics(kind),
    scene: true,
    render: true,
  };
  return PROP_TAB_OPTIONS.filter(t => allowed[t.key]).map(t => t.key);
}
