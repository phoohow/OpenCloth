/** Backend facade and the types the renderer takes from it. */

import { Backend } from '@/render/backend/backend';
import type { BackendOptions } from '@/render/backend/types';

export type { Backend } from '@/render/backend/backend';
export type {
  BackendOptions, FrameSize, ProgramHandle, SceneHandle, TargetHandle, TextureHandle,
} from '@/render/backend/types';
export type { Commands } from '@/render/backend/commands';
export type { Surface } from '@/render/backend/surface';
export type { TargetPool } from '@/render/backend/targets';
export type { ProgramLibrary } from '@/render/backend/programs';
export type { SceneStore } from '@/render/backend/scene/sceneStore';
export type { TraceEngine } from '@/render/backend/trace/traceEngine';
export type { DenoiseEngine } from '@/render/backend/denoise/denoiseEngine';

/** Creates the backend behind the neutral facade. */
export function createBackend(
  canvas: HTMLCanvasElement,
  options: BackendOptions = {},
): Promise<Backend> {
  return Backend.create(canvas, options);
}
