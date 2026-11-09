/** Contract between the renderer's passes and its frame graph. */

import type {
  FrameSize, FrameStats, TraceDefer, TraceReadiness, TraceSettings, TraceStats, VersionStamp,
} from '@/render/common';
import type { Commands } from '@/render/backend/commands';
import type { SceneStore } from '@/render/backend/scene/sceneStore';
import type { TargetHandle, TextureHandle } from '@/render/backend/types';
import type { RenderView } from '@/render/renderer/view/types';
import type { WorldView } from '@/render/world';

/** Slot a pass occupies in the fixed pass order. */
export type PassSlot = 'raster' | 'trace' | 'denoise' | 'composite' | 'post' | 'overlay' | 'present';

/** Frame resource a pass declares as read or written. */
export type ResourceId = 'color' | 'composite' | 'radiance' | 'surface';

/** Pixel sizes one frame needs; defined by Contract. */
export type { FrameSize } from '@/render/common';

/** What the trace pass leaves for the denoiser and the compositor. */
export interface TraceOutput {
  traced: boolean;
  defer: TraceDefer | null;
  samples: number;
  weight: number;
  radiance: TextureHandle | null;
  restarted: boolean;
  accumulating: boolean;
}

/** Frame-owned resources the passes read and write. */
export interface FrameResources {
  readonly color: TargetHandle;
  readonly composite: TargetHandle;
  readonly radiance: TargetHandle;
  texture(target: TargetHandle): TextureHandle;
  ensure(size: FrameSize): void;
  scratch(index: number): TargetHandle;
}

/** Conditions a pass may read before it runs. */
export interface FrameConditions {
  readonly view: RenderView;
  readonly traceState: TraceReadiness;
  readonly defer: TraceDefer | null;
}

/** Everything one pass reads. */
export interface PassContext extends FrameConditions {
  readonly world: WorldView;
  readonly versions: Readonly<VersionStamp>;
  readonly resources: FrameResources;
  readonly commands: Commands;
  readonly scene: SceneStore;
  readonly trace: TraceOutput;
}

/** One step of the frame graph: what it reads, writes and runs. */
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

/** Trace output of a frame that did not trace. */
export function idleTrace(): TraceOutput {
  return {
    traced: false, defer: null, samples: 0, weight: 0,
    radiance: null, restarted: false, accumulating: false,
  };
}

/** Puts the trace output back to idle before a pass may fill it. */
export function resetTrace(output: TraceOutput): void {
  output.traced = false;
  output.defer = null;
  output.samples = 0;
  output.weight = 0;
  output.radiance = null;
  output.restarted = false;
  output.accumulating = false;
}

export type { FrameStats, TraceStats, TraceSettings };
