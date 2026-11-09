/** Resolves world materials into the variants one view needs, without mutating the world. */

import type {
  DisplayOverride, MaterialData, ResolvedMaterial, ViewSettings,
} from '@/render/common';
import { CHANNEL_RASTER, CHANNEL_TRACE } from '@/render/common';
import type { DrawStage, MaterialVariant, RenderView } from '@/render/renderer/view/types';
import { techniqueOf, traces } from '@/render/renderer/view/types';
import type { RenderEntity, WorldView } from '@/render/world';

/** Base, trace and wire variants of one entity. */
export interface ResolvedMaterials {
  readonly base: readonly MaterialVariant[];
  readonly trace: readonly MaterialVariant[];
  readonly wire: MaterialVariant | null;
  readonly stage: DrawStage;
  readonly wireStage: DrawStage;
}

/** Whether the entity is a pattern surface that diagnostics and wire recolor. */
function isSubjectSurface(entity: RenderEntity): boolean {
  return entity.tags.has('subjectSurface');
}

/** Variants of one entity under the current view settings. */
export function resolveMaterials(
  entity: RenderEntity, world: WorldView, view: RenderView,
): ResolvedMaterials {
  const subject = isSubjectSurface(entity);
  const raster = (entity.channels & CHANNEL_RASTER) !== 0;
  const traceable = (entity.channels & CHANNEL_TRACE) !== 0;
  const wireMode = view.settings.wire;
  const wire = raster && subject && wireMode !== 'off'
    ? wireVariant(view.settings, wireMode === 'only')
    : null;
  // A traced image replaces the raster one, so a wire mesh left in the scene stage would be
  // overdrawn. It goes past the tone curve instead, over the composed frame.
  const wireStage: DrawStage = wire && traces(view) ? 'postTone' : stageOf(entity);
  if (raster && subject && wireMode === 'only') {
    return {
      base: [],
      trace: traceable ? traceVariants(entity, world) : [],
      wire,
      stage: stageOf(entity),
      wireStage,
    };
  }

  const override = matchingOverride(entity, view);
  const base: MaterialVariant[] = [];
  const trace = traceable ? traceVariants(entity, world) : [];
  for (const ref of raster ? entity.materials : []) {
    const material = ref.kind === 'material' ? world.material(ref.id) : null;
    if (!material) {
      base.push({ technique: 'asset', data: { kind: 'surface' }, source: ref });
      continue;
    }
    if (subject && view.settings.fill !== 'physical') {
      base.push({
        technique: 'diagnostic',
        data: material,
        source: ref,
        revision: material.revision,
        diagnostic: view.settings.fill,
      });
      continue;
    }
    base.push({ technique: techniqueOf(material.kind), data: material, source: ref, revision: material.revision });
  }

  if (override && raster) {
    const data = { ...(base[0]?.data ?? { kind: 'surface' as const }), ...override.params };
    // Merged data is keyed by content, not by the base material's revision.
    const replaced: ResolvedMaterial = {
      technique: override.technique,
      data,
      source: base[0]?.source ?? { kind: 'material', id: -1 },
    };
    if (override.mode === 'replace') base.splice(0, base.length, replaced);
    else base.push(replaced);
  }
  return {
    base,
    trace,
    wire,
    stage: override?.stage ?? stageOf(entity),
    wireStage,
  };
}

/** Surface variants the path tracer sees; display overrides never reach them. */
function traceVariants(entity: RenderEntity, world: WorldView): readonly MaterialVariant[] {
  const out: MaterialVariant[] = [];
  for (const ref of entity.materials) {
    if (ref.kind !== 'material') continue;
    const material = world.material(ref.id);
    if (!material || material.kind !== 'surface') continue;
    out.push({ technique: 'surface', data: material, source: ref, revision: material.revision });
  }
  return out;
}

/** First override whose tags and channel match the entity. */
function matchingOverride(entity: RenderEntity, view: RenderView): DisplayOverride | null {
  return view.overrides.find(override =>
    override.tags.every(tag => entity.tags.has(tag))
    && (override.channels & entity.channels) !== 0,
  ) ?? null;
}

/** Stage the layer policy gives the entity. */
function stageOf(entity: RenderEntity): DrawStage {
  if (entity.layer === 'overlay') return 'postTone';
  if (entity.layer === 'gizmo') return 'gizmo';
  return 'scene';
}

/** Wire material variant; `only` draws it without a filled surface. */
function wireVariant(settings: ViewSettings, only: boolean): MaterialVariant {
  const data: MaterialData = {
    kind: 'wire',
    name: only ? 'wire-only' : 'wire-over',
    color: settings.wireOptions.color,
    depth: settings.wireOptions.depth,
    side: 'double',
    blending: 'alpha',
    opacity: 0.9,
    wireframe: true,
    polygonOffset: { factor: -2, units: -2 },
  };
  return { technique: 'wire', data, source: { kind: 'material', id: -1 } };
}
