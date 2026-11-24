import type { Commands } from '@/render/backend/commands';
import type { SceneStore } from '@/render/backend/scene/sceneStore';
import type { TargetHandle, TextureHandle } from '@/render/backend/types';
import type {
  CameraState, FrameSize, TraceDefer, TraceReadiness, VersionStamp,
} from '@/render/common';
import type { RenderView } from '@/render/renderer/view/types';
import type { WorldView } from '@/render/world';

export type { FrameSize, FrameStats, TraceStats, TraceSettings } from '@/render/common';

export type PassSlot =
  | 'raster' | 'trace' | 'denoise' | 'composite' | 'post'
  | 'heatmap' | 'wire' | 'overlay' | 'present';

export type ResourceId = 'color' | 'composite' | 'radiance' | 'surface';

export interface TraceOutput {
  traced: boolean;
  defer: TraceDefer | null;
  samples: number;
  weight: number;
  radiance: TextureHandle | null;
  restarted: boolean;
  accumulating: boolean;
  denoiseCount: number;
}

export interface FrameResources {
  readonly color: TargetHandle;
  readonly composite: TargetHandle;
  readonly radiance: TargetHandle;
  texture(target: TargetHandle): TextureHandle;
  ensure(size: FrameSize): void;
}

export interface FrameOverlays {
  readonly postTone: boolean;
  readonly gizmo: boolean;
  readonly wire: boolean;
}

export interface FrameConditions {
  readonly view: RenderView;
  readonly traceState: TraceReadiness;
  readonly defer: TraceDefer | null;
  readonly overlays: FrameOverlays;
}

export interface PassContext extends FrameConditions {
  readonly world: WorldView;
  readonly versions: Readonly<VersionStamp>;
  readonly resources: FrameResources;
  readonly commands: Commands;
  readonly scene: SceneStore;
  readonly trace: TraceOutput;
}

export interface RenderPass {
  readonly id: string;
  readonly slot: PassSlot;
  readonly reads: readonly ResourceId[];
  readonly writes: readonly ResourceId[];
  enabled(frame: FrameConditions): boolean;
  execute(ctx: PassContext): void;
  resize?(size: FrameSize): void;
  dispose?(): void;
}

export interface GraphStep<Slot extends string> {
  readonly id: string;
  readonly slot: Slot;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  dispose?(): void;
}

export type PreviewSlot = 'scene' | 'tone';

export interface PreviewResources {
  readonly color: TargetHandle;
  readonly display: TargetHandle;
  texture(target: TargetHandle): TextureHandle;
}

export interface PreviewFrame {
  readonly commands: Commands;
  readonly scene: SceneStore;
  readonly resources: PreviewResources;
  readonly camera: CameraState;
}

export interface PreviewPass extends GraphStep<PreviewSlot> {
  execute(frame: PreviewFrame): void;
}

export function idleTrace(): TraceOutput {
  return {
    traced: false, defer: null, samples: 0, weight: 0,
    radiance: null, restarted: false, accumulating: false, denoiseCount: 0,
  };
}

export function resetTrace(output: TraceOutput): void {
  output.traced = false;
  output.defer = null;
  output.samples = 0;
  output.weight = 0;
  output.radiance = null;
  output.restarted = false;
  output.accumulating = false;
  output.denoiseCount = 0;
}
