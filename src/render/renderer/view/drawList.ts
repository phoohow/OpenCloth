/** Builds the ordered draw list of one view from the world, without touching it. */

import type { DrawBucket, DrawStage } from '@/render/common';
import type { WorldView } from '@/render/world';
import { resolveMaterials } from '@/render/renderer/view/materialResolver';
import type { DrawItem, DrawList, RenderView } from '@/render/renderer/view/types';

const STAGE_ORDER: Record<DrawStage, number> = { scene: 0, postTone: 1, gizmo: 2 };
const BUCKET_ORDER: Record<DrawBucket, number> = {
  opaque: 0, transparent: 1, overlay: 0, gizmo: 0,
};

/** Culls, resolves and sorts every entity the view can see. */
export function buildDrawList(world: WorldView, view: RenderView): DrawList {
  const items: DrawItem[] = [];
  for (const entity of world.entities({ layers: view.layers, channels: view.channels })) {
    const resolved = resolveMaterials(entity, world, view);
    const drawable = resolved.base.length > 0 || resolved.wire !== null
      || resolved.trace.length > 0 || entity.mesh.kind === 'asset';
    if (!drawable) continue;
    const bucket: DrawBucket = resolved.stage === 'scene'
      ? sceneBucket(resolved.base)
      : resolved.stage === 'postTone' ? 'overlay' : 'gizmo';
    items.push({
      entity: entity.id,
      mesh: entity.mesh,
      materials: resolved.base,
      traceMaterials: resolved.trace,
      wire: resolved.wire,
      transform: entity.transform,
      bounds: entity.bounds,
      stage: resolved.stage,
      wireStage: resolved.wireStage,
      bucket,
      materialSource: entity.materials[0] ?? null,
    });
  }
  items.sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]
    || BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]
    || a.entity - b.entity);
  return { items };
}

/** Draw items of one stage, in list order. */
export function itemsForStage(list: DrawList, stage: DrawStage): readonly DrawItem[] {
  return list.items.filter(item => item.stage === stage);
}

/** Opaque unless any base variant blends. */
function sceneBucket(materials: readonly { data: import('@/render/common').MaterialData }[]): DrawBucket {
  for (const material of materials) {
    if (material.data.blending === 'alpha' || material.data.blending === 'additive') {
      return 'transparent';
    }
  }
  return 'opaque';
}
