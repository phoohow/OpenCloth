/** Seam between the entry's render assembly and the React pane that owns the canvas. */

import { createContext, useContext } from 'react';
import type { RayTracingCapability } from '@/render/common';
import type { Viewport } from '@/runtime';

/** An assembled render stack and its single teardown, in dispose order. */
export interface RenderSession {
  readonly viewport: Viewport;
  dispose(): void;
}

/** Device and tracer callbacks the pane surfaces to the user. */
export interface RenderHostCallbacks {
  onDeviceLost(reason: string): void;
  onDenoiseFailure(message: string): void;
  onTraceFailure(capability: RayTracingCapability): void;
}

/** Builds the render stack over a canvas; null when WebGPU is unavailable. */
export type RenderHostFactory = (
  canvas: HTMLCanvasElement,
  callbacks: RenderHostCallbacks,
) => Promise<RenderSession | null>;

/** Factory the entry provides; the pane reads it through `useRenderHost`. */
export const RenderHostContext = createContext<RenderHostFactory | null>(null);

/** The assembly factory the application entry provides. */
export function useRenderHost(): RenderHostFactory {
  const factory = useContext(RenderHostContext);
  if (!factory) throw new Error('RenderHostContext missing');
  return factory;
}