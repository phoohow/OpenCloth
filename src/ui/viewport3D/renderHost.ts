import type { RayTracingCapability } from '@/render/common';
import type { Viewport } from '@/runtime';

import { createContext, useContext } from 'react';

export const RenderHostContext = createContext<RenderHostFactory | null>(null);

export interface RenderSession {
  readonly viewport: Viewport;
  dispose(): void;
}

export interface RenderHostCallbacks {
  onDeviceLost(reason: string): void;
  onDenoiseFailure(message: string): void;
  onTraceFailure(capability: RayTracingCapability): void;
}

export type RenderHostFactory = (
  canvas: HTMLCanvasElement,
  callbacks: RenderHostCallbacks,
) => Promise<RenderSession | null>;

export function useRenderHost(): RenderHostFactory {
  const factory = useContext(RenderHostContext);
  if (!factory) throw new Error('RenderHostContext missing');
  return factory;
}
