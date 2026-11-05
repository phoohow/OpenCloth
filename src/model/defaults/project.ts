import type { Project } from '@/model/types';
import { PROJECT_FORMAT_VERSION } from '@/model/format';
import { createFabric } from '@/model/defaults/fabric';
import { createEmptyPattern } from '@/model/defaults/pattern';
import { createDefaultAvatar } from '@/model/defaults/avatar';
import { DEFAULT_LAYER_THICKNESS_CM, createDefaultScene } from '@/model/defaults/scene';

/** Fresh project: empty pattern, one cotton material, default avatar and scene. */
export function createDefaultProject(name = '未命名工程'): Project {
  const fabric = createFabric('cotton');
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
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
