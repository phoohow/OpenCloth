import type { Project } from '@/model/types';
import { createFabric } from '@/model/defaults/fabric';
import { createEmptyPattern } from '@/model/defaults/pattern';
import { createDefaultAvatar } from '@/model/defaults/avatar';
import { DEFAULT_LAYER_THICKNESS_CM, createDefaultScene } from '@/model/defaults/scene';

/** Fresh project: empty pattern, one cotton material, default avatar and scene. */
export function createDefaultProject(name = '未命名工程'): Project {
  const fabric = createFabric('cotton');
  return {
    meta: {
      name,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    pattern: createEmptyPattern(),
    fabrics: { [fabric.id]: fabric },
    avatar: createDefaultAvatar(),
    scene: createDefaultScene(),
    poms: [],
    layerThicknessCm: { ...DEFAULT_LAYER_THICKNESS_CM },
  };
}
