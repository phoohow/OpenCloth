/** Named slots inside the scene layers; every drawn object belongs to exactly one. */

import type { LayerId } from '@/render/scene/layers';

/** Stable slot names, grouped by the layer they live in. */
export type SlotName =
  | 'floor' | 'floorGrid'
  | 'avatar' | 'cloth' | 'references'
  | 'edges' | 'seams' | 'topstitch' | 'trims' | 'selection'
  | 'pins' | 'dragMarker' | 'sketch' | 'measure';

/** Layer each slot belongs to. */
export const SLOT_LAYER: Record<SlotName, LayerId> = {
  floor: 'underlay',
  floorGrid: 'underlay',
  avatar: 'subject',
  cloth: 'subject',
  references: 'subject',
  edges: 'overlay',
  seams: 'overlay',
  topstitch: 'overlay',
  trims: 'overlay',
  selection: 'overlay',
  pins: 'gizmo',
  dragMarker: 'gizmo',
  sketch: 'gizmo',
  measure: 'gizmo',
};
