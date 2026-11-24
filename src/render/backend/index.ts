import type { BackendOptions } from '@/render/backend/types';

import { Backend } from '@/render/backend/backend';

export type { Backend } from '@/render/backend/backend';
export type { Commands } from '@/render/backend/commands';
export type { DenoiseEngine } from '@/render/backend/denoise/denoiseEngine';
export type { ProgramLibrary } from '@/render/backend/programs';
export type { SceneStore } from '@/render/backend/scene/sceneStore';
export type { Surface } from '@/render/backend/surface';
export type { TargetPool } from '@/render/backend/targets';
export type { TraceEngine } from '@/render/backend/trace/traceEngine';
export type {
  BackendOptions, FrameSize, ProgramHandle, SceneHandle, TargetHandle, TextureHandle,
} from '@/render/backend/types';

export function createBackend(
  canvas: HTMLCanvasElement,
  options: BackendOptions = {},
): Promise<Backend> {
  return Backend.create(canvas, options);
}
