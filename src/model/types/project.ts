/**
 * The persisted document root and its header.
 */

import type { GarmentLayer, Pattern } from '@/model/types/pattern';
import type { Fabric } from '@/model/types/fabric';
import type { Avatar } from '@/model/types/avatar';
import type { SceneConfig } from '@/model/types/scene';
import type { PomPoint, SizeDef } from '@/model/types/size';


/** File header of a saved project. */
export interface ProjectMeta {
  name: string;
  createdAt: string;
  modifiedAt: string;
}

/** Root of the persisted document. */
export interface Project {
  meta: ProjectMeta;
  pattern: Pattern;
  fabrics: Record<string, Fabric>;
  avatar: Avatar;
  scene: SceneConfig;
  /** Size chart; absent means a single unsized pattern. */
  sizes?: SizeDef[];
  /** Size the pattern geometry is currently resolved to. */
  activeSizeId?: string;
  /** Points of measure and their size table; absent means none are defined. */
  poms?: PomPoint[];
  /** Collision clearance of each construction layer in centimetres; absent uses the built-in defaults. */
  layerThicknessCm?: Partial<Record<GarmentLayer, number>>;
}
