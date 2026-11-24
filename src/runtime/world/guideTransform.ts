import type { ObjectTransform } from '@/model/types';

export function guideTransform(transform?: ObjectTransform) {
  return {
    position: transform?.position ?? { x: 0, y: 0, z: 0 },
    rotationEuler: transform?.rotationEuler ?? { x: 0, y: 0, z: 0 },
    scale: transform?.scale ?? { x: 1, y: 1, z: 1 },
  };
}
