import type {
  Bounds, CameraState, ChannelMask, DisplayOverride, EntityTag, MaterialKind,
  DrawBucket, DrawStage, EntityId, LayerId, MaterialTechnique, MeshRef,
  ResolvedMaterial, Transform, ViewSettings,
} from '@/render/common';

export type {
  CameraHost, CameraPose, CameraProjection, CameraState, DisplayOverride, DrawBucket, DrawStage,
  SurfaceMode, MaterialTechnique, RenderMode, ResolvedMaterial, ToneMappingMode, TraceSettings,
  ViewSettings, WireMode, WireOptions,
} from '@/render/common';

export interface RenderView {
  readonly camera: CameraState;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly layers: readonly LayerId[];
  readonly channels: ChannelMask;
  readonly settings: ViewSettings;
  readonly overrides: readonly DisplayOverride[];
  readonly hideTags?: readonly EntityTag[];
  readonly frame: number;
}

export type MaterialVariant = ResolvedMaterial;

export interface DrawItem {
  readonly entity: EntityId;
  readonly mesh: MeshRef;
  readonly materials: readonly ResolvedMaterial[];
  readonly traceMaterials: readonly ResolvedMaterial[];
  readonly wire: ResolvedMaterial | null;
  readonly transform: Transform;
  readonly bounds: Bounds;
  readonly stage: DrawStage;
  readonly bucket: DrawBucket;
}

export interface DrawList {
  readonly items: readonly DrawItem[];
}

export function traces(view: RenderView): boolean {
  return view.settings.mode === 'pathtrace' && view.settings.wire !== 'only'
    && !view.hideTags?.length;
}

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
