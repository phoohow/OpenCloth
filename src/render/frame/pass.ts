/** One stage of the frame, and the state the stages hand to each other. */

import type * as THREE from 'three/webgpu';
import type { RenderModeSpec } from '@/render/modes/spec';
import type { ModeRegistry } from '@/render/modes/registry';
import type { SceneMgr } from '@/render/scene/manager';
import type { SceneCamera } from '@/render/scene/camera';
import type { ViewportDevice } from '@/render/device/viewport';
import type { TraceDefer } from '@/render/trace/gate';
import type { FrameSize, FrameTargets } from '@/render/frame/targets';

/** Stages of a frame, in the order they run. */
export type PassId = 'scene' | 'trace' | 'denoise' | 'composite' | 'post' | 'overlay' | 'present';

/** What the trace stage leaves for the stages after it. Rewritten every frame, never accumulated. */
export interface TraceOutput {
  /** Whether traced samples were drawn this frame. */
  traced: boolean;
  /** Gate that kept the frame on the raster base, when it did. */
  defer: TraceDefer | null;
  /** Samples per pixel behind the traced image. */
  samples: number;
  /** How far the traced image has faded in over the raster base, 0 when it is absent. */
  weight: number;
  /** Traced radiance, or null when the stage did not run. */
  radiance: THREE.Texture | null;
  /** Whether the sample pass started over this frame; anything built on it must be dropped. */
  restarted: boolean;
  /** Whether the pass is still adding samples. */
  accumulating: boolean;
}

/** Everything a stage reads, plus the fields earlier stages fill for the later ones. */
export interface FrameContext {
  readonly device: ViewportDevice;
  /** The scene manager, not the three.js scene; that one is `sceneMgr.scene`. */
  readonly sceneMgr: SceneMgr;
  readonly camera: SceneCamera;
  readonly modes: ModeRegistry;
  readonly targets: FrameTargets;
  readonly size: FrameSize;
  /** What the current mode resolved to. */
  readonly spec: RenderModeSpec;
  /** Written by the trace stage, narrowed by denoising, consumed by the compositor. */
  readonly trace: TraceOutput;
  /**
   * Image the compositor resolved this frame; the post chain reads it. Null before it runs. On a
   * frame that did not trace this is a copy of the raster image.
   */
  resolved: THREE.Texture | null;
}

/**
 * A stage of the frame. Stages never call each other: the FrameMgr runs them in a fixed order, and
 * each one reads and writes only the context it is given.
 */
export interface FramePass {
  readonly id: PassId;
  /** Whether this stage takes part in the current frame. */
  enabled(ctx: FrameContext): boolean;
  run(ctx: FrameContext): void;
  dispose?(): void;
}

/** Trace output of a frame that did not trace. */
export function idleTrace(): TraceOutput {
  return {
    traced: false, defer: null, samples: 0, weight: 0, radiance: null, restarted: false,
    accumulating: false,
  };
}

/** Puts the trace output back to idle before a stage may fill it. */
export function resetTrace(output: TraceOutput): void {
  output.traced = false;
  output.defer = null;
  output.samples = 0;
  output.weight = 0;
  output.radiance = null;
  output.restarted = false;
  output.accumulating = false;
}
