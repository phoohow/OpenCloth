import type { Project } from '@/model/types';

import { createDefaultAvatar } from '@/model/defaults/avatar';
import { createFabric } from '@/model/defaults/fabric';
import { createEmptyPattern } from '@/model/defaults/pattern';
import { DEFAULT_LAYER_THICKNESS_CM, createDefaultScene } from '@/model/defaults/scene';

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

export function createBlankProject(): Project {
  const project = createDefaultProject();
  project.avatar = { ...project.avatar, display: 'hidden' };
  return project;
}
