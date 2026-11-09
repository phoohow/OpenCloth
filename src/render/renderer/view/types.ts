/** What one frame sees: the view description and the draw items built from it. */

import type {
  Bounds, CameraState, ChannelMask, DisplayOverride, MaterialKind,
  DrawBucket, DrawStage, EntityId, LayerId, MaterialRef, MaterialTechnique, MeshRef,
  ResolvedMaterial, Transform, ViewSettings,
} from '@/render/common';

export type {
  CameraHost, CameraPose, CameraProjection, CameraState, DisplayOverride, DrawBucket, DrawStage,
  FillMode, MaterialTechnique, RenderMode, ResolvedMaterial, ToneMappingMode, TraceSettings,
  ViewSettings, WireMode, WireOptions,
} from '@/render/common';

/** One frame: camera, viewport, settings, channels and display overrides. */
export interface RenderView {
  readonly camera: CameraState;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly layers: readonly LayerId[];
  readonly channels: ChannelMask;
  readonly settings: ViewSettings;
  readonly overrides: readonly DisplayOverride[];
  readonly frame: number;
}

/** Resolved material of the raster or trace root. */
export type MaterialVariant = ResolvedMaterial;

/** One entity ready to draw. */
export interface DrawItem {
  readonly entity: EntityId;
  readonly mesh: MeshRef;
  readonly materials: readonly ResolvedMaterial[];
  /** Surface variants the path tracer uses; empty for non-traceable entities. */
  readonly traceMaterials: readonly ResolvedMaterial[];
  /** Wire variant drawn over or instead of the base materials. */
  readonly wire: ResolvedMaterial | null;
  readonly transform: Transform;
  readonly bounds: Bounds;
  readonly stage: DrawStage;
  readonly bucket: DrawBucket;
  readonly materialSource: MaterialRef | null;
}

/** Every entity one frame draws, before the backend turns it into scene objects. */
export interface DrawList {
  readonly items: readonly DrawItem[];
}

/** Default view settings of a fresh viewport. */
export function defaultViewSettings(): ViewSettings {
  return {
    fill: 'physical',
    wire: 'off',
    mode: 'raster',
    wireOptions: { color: 0x66ccff, depth: 'tested' },
    toneMapping: 'aces',
    exposure: 1,
    trace: {
      maxBounces: 8,
      frameBudget: 500000,
      maxSamples: 256,
      renderScale: 1,
      denoise: true,
      denoiseModel: 'base',
      filterGlossyFactor: 1,
      clampDirect: 0,
      clampIndirect: 8,
    },
  };
}

/** Technique a base material kind resolves to. */
export function techniqueOf(kind: MaterialKind): MaterialTechnique {
  switch (kind) {
    case 'surface': return 'surface';
    case 'unlit': return 'unlit';
    case 'line': return 'line';
    case 'heatmap': return 'heatmap';
    case 'wire': return 'wire';
    case 'diagnostic': return 'diagnostic';
  }
}

