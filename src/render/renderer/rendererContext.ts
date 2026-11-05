import type { CameraProjection, LightConfig, RayTracingConfig, RenderConfig, RenderMode } from '../../core/model/types';
import { rendererDevice as deviceOf, ViewportSurface } from './viewportSurface';
import { ViewCamera } from './viewCamera';
import { LightRig } from './lightRig';
import { RayTracePipeline, type RayTraceState } from './rayTracePipeline';

export { DEFAULT_ENV_URL, applySceneEnvironment, releaseSceneEnvironment } from './sceneEnvironment';
export { isOrthographic } from './viewCamera';
export type { ViewportCamera } from './viewCamera';
export { RayTracingUnsupportedError } from './rayTracePipeline';
export type { RayTraceState, RayTraceFailure, RayTracingCapability } from './rayTracePipeline';

/** Long-lived objects one viewport owns, grouped by lifecycle instead of one flat bag. */
export interface RendererContext {
  /** Drawing buffer, scene and canvas. */
  surface: ViewportSurface;
  /** Cameras, active projection and orbit gestures. */
  view: ViewCamera;
  /** Scene lights and tone mapping. */
  lights: LightRig;
  /** Path tracing lifecycle, capability probe and frame. */
  ray: RayTracePipeline;
}

/** Whether this browser exposes a usable WebGPU adapter. */
export async function detectWebGPU(): Promise<boolean> {
  if (!('gpu' in navigator)) return false;
  const adapter = await navigator.gpu.requestAdapter();
  return !!adapter;
}

/** Creates the four objects that make up one viewport. */
export async function createRendererContext(canvas: HTMLCanvasElement): Promise<RendererContext> {
  const surface = await ViewportSurface.create(canvas);
  const view = new ViewCamera(surface);
  const ray = new RayTracePipeline(surface, view);
  const lights = new LightRig(surface, () => ray.invalidate());
  return { surface, view, lights, ray };
}

/** The GPUDevice the renderer was initialized with; simulation resources share it. */
export function rendererDevice(ctx: RendererContext): GPUDevice {
  return deviceOf(ctx.surface);
}

/** Aspect of the viewport drawing surface, guarded against a hidden pane. */
export function viewportAspect(ctx: RendererContext): number {
  return ctx.surface.aspect();
}

/** Rebuilds the orthographic frustum from the stored view height and the given aspect. */
export function syncOrthoFrustum(ctx: RendererContext, aspect: number): void {
  ctx.view.syncFrustum(aspect);
}

/** Swaps the viewport between perspective and orthographic cameras. */
export function setCameraProjection(ctx: RendererContext, projection: CameraProjection): void {
  ctx.view.setProjection(projection);
}

/** Selects rasterized shading or lazily initialized WebGPU ray tracing. */
export function setRendererMode(ctx: RendererContext, mode: RenderMode): Promise<void> {
  return ctx.ray.setMode(mode);
}

/** Stores project settings and applies them to a ready ray tracer. */
export function setRayTracingConfig(ctx: RendererContext, config: RayTracingConfig): Promise<void> {
  return ctx.ray.setConfig(config);
}

/** Which ray tracing gate the viewport's next drawn frame is behind. */
export function rayTraceState(ctx: RendererContext): RayTraceState {
  return ctx.ray.state();
}

/** Draws the active rendering mode into the viewport canvas. */
export function renderScene(ctx: RendererContext): void {
  // While the view is in motion the path tracer defers and the raster frame is shown instead.
  if (ctx.ray.render()) return;
  ctx.surface.renderer.render(ctx.surface.scene, ctx.view.camera);
}

/** Rebuilds the scene's lights and tone mapping from the project's lighting and render settings. */
export function applyLightConfig(ctx: RendererContext, cfg: LightConfig, renderCfg: RenderConfig): void {
  ctx.lights.apply(cfg, renderCfg);
}

/** Matches the drawing buffer and both cameras to a new viewport size. */
export function resizeRenderer(ctx: RendererContext, width: number, height: number): void {
  // Hidden viewports report zero size; keep the last valid drawing buffer.
  if (width <= 0 || height <= 0) return;
  ctx.surface.resize(width, height);
  ctx.view.resize(width / height);
}

/** Frees both rendering paths, including a ray tracer still being loaded. */
export function disposeRendererContext(ctx: RendererContext): void {
  if (ctx.surface.disposed) return;
  ctx.ray.dispose();
  ctx.view.dispose();
  ctx.surface.dispose();
}
