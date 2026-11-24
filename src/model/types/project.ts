import type { Avatar } from '@/model/types/avatar';
import type { Fabric } from '@/model/types/fabric';
import type { GarmentLayer, Pattern } from '@/model/types/pattern';
import type { SceneConfig } from '@/model/types/scene';
import type { PomPoint, SizeDef } from '@/model/types/size';

export interface ProjectMeta {
  name: string;
  createdAt: string;
  modifiedAt: string;
}

export interface Project {
  meta: ProjectMeta;
  pattern: Pattern;
  fabrics: Record<string, Fabric>;
  avatar: Avatar;
  scene: SceneConfig;
  sizes?: SizeDef[];
  activeSizeId?: string;
  poms?: PomPoint[];
  layerThicknessCm?: Partial<Record<GarmentLayer, number>>;
}
