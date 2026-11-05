import type { ObjectTransform } from '@/model/types';
import { vec3 } from '@/model/types';

/** Placement at the world origin, full size. */
export const IDENTITY_TRANSFORM: ObjectTransform = {
  position: vec3(0, 0, 0),
  rotationEuler: vec3(0, 0, 0),
  scale: vec3(1, 1, 1),
};

/** Detached copy of a transform, for undo snapshots and new objects. */
export function cloneTransform(t: ObjectTransform = IDENTITY_TRANSFORM): ObjectTransform {
  return {
    position: { ...t.position },
    rotationEuler: { ...t.rotationEuler },
    scale: { ...t.scale },
  };
}
