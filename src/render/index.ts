export {
  Renderer, type FrameStats, type RayTraceState, type RendererOptions, type TraceDefer,
} from '@/render/renderer';
export { detectWebGPU } from '@/render/device/detect';
export {
  DEFAULT_ENV_URL, FALLBACK_BACKGROUND, applySceneEnvironment, releaseSceneEnvironment,
} from '@/render/scene/environment';
export { isOrthographic, type ViewportCamera } from '@/render/scene/camera';
export { RayTracingUnsupportedError } from '@/render/trace/capability';
export type { RayTraceFailure, RayTracingCapability } from '@/render/trace/capability';
export { TRACE_VISIBLE } from '@/render/scene/manager';
export type { StageSlot, StageChange } from '@/render/scene/manager';
export type { SlotName } from '@/render/scene/slots';
export { ClothSurface, type SurfaceGroup } from '@/render/scene/objects/clothSurface';
export { FitOverlay } from '@/render/scene/objects/fitOverlay';
export * from '@/render/scene/materials';
export * from '@/render/analysis/fitChannel';
export * from '@/render/analysis/pressureChannel';
export * from '@/render/analysis/strainChannel';
export * from '@/render/imageStore';
export { resolveSpec, backendAvailable } from '@/render/modes/spec';
export type { RenderModeSpec, PostEffectId } from '@/render/modes/spec';
export type { LayerId } from '@/render/scene/layers';
