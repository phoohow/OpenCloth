import type { MeshSampling } from '@/model/types';

import { DEFAULT_MESH_RESOLUTION_CM } from '@/model';

export interface MeshResolutionSettings {
  meshResolutionCm?: number;
}

export interface PanelMeshSettings extends MeshResolutionSettings {
  meshSampling?: MeshSampling;
}

export function meshResolutionOf(settings: MeshResolutionSettings): number {
  return settings.meshResolutionCm ?? DEFAULT_MESH_RESOLUTION_CM;
}
