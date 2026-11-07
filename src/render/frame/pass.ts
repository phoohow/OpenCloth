/** One pass of the frame, and the state the passes hand to each other. */

import type * as THREE from 'three/webgpu';
import type { ViewModeSpec } from '@/render/modes/spec';
import type { ViewMode } from '@/render/modes/viewMode';
import type { SceneMgr } from '@/render/scene/manager';
import type { SceneCamera } from '@/render/scene/camera';
import type { TraceDefer } from '@/render/trace/gate';
import type { FrameTargets } from '@/render/frame/targets';

/** Passes of a frame, in the order they run. */
export type PassId = 'scene' | 'trace' | 'denoise' | 'composite' | 'post' | 'overlay' | 'present';

/** What the trace pass leaves for the passes after it. Rewritten every frame, never accumulated. */
export interface TraceOutput {
  /** Whether traced samples were drawn this frame. */
  traced: boolean;
  /** Gate that kept the frame on the raster base, when it did. */
  defer: TraceDefer | null;
  /** Samples per pixel behind the traced image. */
  samples: number;
  /** How far the traced image has faded in over the raster base, 0 when it is absent. */
  weight: number;
  /** Traced radiance, or null when the pass did not run. */
  radiance: THREE.Texture | null;
  /** Whether the sample pass started over this frame; anything built on it must be dropped. */
  restarted: boolean;
  /** Whether the pass is still adding samples. */
  accumulating: boolean;
}

/** Everything a pass reads, plus the fields earlier passes fill for the later ones. */
export interface FrameContext {
  /** The three.js renderer the Renderer owns; passes issue their own draw commands on it. */
  readonly renderer: THREE.WebGPURenderer;
  /** The scene manager, not the three.js scene; that one is `sceneMgr.scene`. */
  readonly sceneMgr: SceneMgr;
  readonly camera: SceneCamera;
  readonly viewMode: ViewMode;
  readonly targets: FrameTargets;
  /** What the current view mode resolved to. */
  readonly spec: ViewModeSpec;
  /** Written by the trace pass, narrowed by denoising, consumed by the compositor. */
  readonly trace: TraceOutput;
  /**
   * Image the compositor produced this frame; the post chain reads it. Null before it runs. On a
   * frame that did not trace this is a copy of the raster image.
   */
  composite: THREE.Texture | null;
}

/**
 * A pass of the frame. Passes never call each other: the FrameMgr runs them in a fixed order, and
 * each one reads and writes only the context it is given.
 */
export interface FramePass {
  readonly id: PassId;
  /** Whether this pass takes part in the current frame. */
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
