import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraProjection, LightConfig, RayTracingConfig, RenderConfig, RenderMode, SceneLight } from '../../core/model/types';
import { createDefaultRayTracing, iblStrength, normalizeLights } from '../../core/model/defaults';
import { addStageFloor } from './stageFloor';
import { FALLBACK_BACKGROUND } from './sceneEnvironment';
import type { RayTracingRenderer } from './rayTracingRenderer';

export { DEFAULT_ENV_URL, applySceneEnvironment, releaseSceneEnvironment } from './sceneEnvironment';

/** Either camera the viewport can render with. */
export type ViewportCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/** Whether the viewport is currently looking through the orthographic camera. */
export function isOrthographic(camera: ViewportCamera): camera is THREE.OrthographicCamera {
  return (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
}

/** Half-depth of the orthographic clip range in meters; linear depth keeps this generous. */
const ORTHO_CLIP_RANGE = 100;

/** Distance multiplier of one zoom step; the same curve OrbitControls uses for its own zoom. */
const ZOOM_FACTOR = 0.95;

/**
 * Dollies the camera on the wheel and on a middle-button drag: scrolling or dragging down moves
 * closer, up pulls away. OrbitControls maps both gestures the other way and exposes no switch,
 * so its wheel zoom is replaced by a capture-phase listener and its middle-button dolly by a
 * drag handler of our own.
 * Returns the detach function.
 */
function attachZoomGestures(controls: OrbitControls, canvas: HTMLCanvasElement): () => void {
  const dolly = (pixels: number) => {
    if (pixels === 0) return;
    const factor = Math.pow(ZOOM_FACTOR, Math.abs(pixels) * 0.01 * controls.zoomSpeed);
    if (pixels > 0) controls.dollyIn(factor);
    else controls.dollyOut(factor);
  };

  const onWheel = (event: WheelEvent) => {
    if (event.target !== canvas || !controls.enabled || !controls.enableZoom) return;
    event.preventDefault();
    event.stopPropagation();
    // Normalise line and page deltas to pixels before deriving the step.
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
    dolly(delta);
  };

  controls.mouseButtons.MIDDLE = null;
  let dragPointer: number | null = null;
  let dragY = 0;
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 1 || !controls.enabled || !controls.enableZoom) return;
    event.preventDefault();
    dragPointer = event.pointerId;
    dragY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== dragPointer) return;
    dolly(event.clientY - dragY);
    dragY = event.clientY;
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId === dragPointer) dragPointer = null;
  };

  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerEnd);

  return () => {
    window.removeEventListener('wheel', onWheel, { capture: true });
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerEnd);
    canvas.removeEventListener('pointercancel', onPointerEnd);
  };
}

/** Long-lived three.js objects one viewport owns. */
export interface RendererContext {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  /** Camera the viewport renders, picks and frames with right now. */
  camera: ViewportCamera;
  perspectiveCamera: THREE.PerspectiveCamera;
  orthographicCamera: THREE.OrthographicCamera;
  projection: CameraProjection;
  /** World height the orthographic frustum spans while `orthographicCamera.zoom` is 1. */
  orthoViewHeight: number;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  renderMode: RenderMode;
  rayConfig: RayTracingConfig;
  /** Settings the scene lights were last built from, kept for the deferred area-light support. */
  lightConfig?: LightConfig;
  /** Settings the tone mapping was last built from. */
  renderConfig?: RenderConfig;
  rayTracer: RayTracingRenderer | null;
  rayTracerLoading: Promise<RayTracingRenderer | null> | null;
  /** Result of the path tracing probe; null until the first ray-traced switch runs it. */
  rayCapability: RayTracingCapability | null;
  /** Watcher that keeps the drawing buffer in sync with the viewport's layout size. */
  resizeObserver?: ResizeObserver;
  /** Removes the listeners that drive the camera dolly. */
  detachZoomGestures?: () => void;
  disposed: boolean;
}

/** The GPUDevice the renderer was initialized with; simulation resources share it. */
export function rendererDevice(ctx: RendererContext): GPUDevice {
  const device = (ctx.renderer.backend as unknown as { device?: GPUDevice }).device;
  if (!device) throw new Error('WebGPU renderer device unavailable before init');
  return device;
}

/** Stage of the ray tracing pipeline the 3D view is in. */
export type RayTraceState =
  | 'inactive'
  | 'building'
  | 'deforming'
  | 'moving'
  | 'blending'
  | 'traced'
  | 'unsupported';

/** Why the first ray-traced frames showed this device cannot path trace. */
export type RayTraceFailure = 'gpu-error' | 'setup-failed';

/** Outcome of the one-time path tracing probe. */
export interface RayTracingCapability {
  ok: boolean;
  failure: RayTraceFailure | null;
  /** Raw technical text shown beside the label. */
  detail: string;
}

/** Thrown instead of building a tracer on a device the probe rejected. */
export class RayTracingUnsupportedError extends Error {
  readonly failure: RayTraceFailure;
  readonly detail: string;

  constructor(capability: RayTracingCapability) {
    super(`WebGPU path tracing unsupported: ${capability.failure}`);
    this.failure = capability.failure ?? 'setup-failed';
    this.detail = capability.detail;
  }
}

/** Frames the first ray-traced switch draws to prove the kernels answer. */
const VERIFY_FRAMES = 2;

/** Below this CSS size the view is a hidden or one-pixel pane; its buffers are too small to judge. */
const VERIFY_MIN_SIZE = 16;

/**
 * Milliseconds the GPU queue may take to drain. Sized for a slow mobile GPU finishing the first
 * full-pane sample rounds: exceeding it means the switch gives up, so it must not be a normal wait.
 */
const VERIFY_TIMEOUT_MS = 30000;

/** Characters of technical detail kept for the readout. */
const PROBE_DETAIL_LIMIT = 180;

/** Clips diagnostic text to the width the viewport toast can show. */
function probeDetail(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > PROBE_DETAIL_LIMIT ? `${single.slice(0, PROBE_DETAIL_LIMIT)}…` : single;
}

/** Resolves as `'timeout'` after `ms`; bounds the GPU queue drain. */
function verifyTimeout(ms: number): Promise<'timeout'> {
  return new Promise(resolve => setTimeout(() => resolve('timeout'), ms));
}

/**
 * Runs the freshly built tracer over the live scene and reports whether the GPU answered.
 * Kernel and bind-group failures surface asynchronously, so drawing the first frames is the only
 * honest capability test — and they are the frames the view draws anyway, so nothing is compiled twice.
 * Returns null when the view is too small to judge: a hidden pane is clamped to 1×1 CSS pixel and
 * one-pixel ray buffers make three emit struct bindings that are not arrays, which every wavefront
 * kernel then fails to parse — a healthy GPU must not be condemned for that.
 */
async function verifyRayTracing(ctx: RendererContext, tracer: RayTracingRenderer): Promise<RayTracingCapability | null> {
  const viewSize = new THREE.Vector2();
  ctx.renderer.getSize(viewSize);
  if (viewSize.x < VERIFY_MIN_SIZE || viewSize.y < VERIFY_MIN_SIZE) return null;

  let device: GPUDevice;
  try {
    device = rendererDevice(ctx);
  } catch (error) {
    return { ok: false, failure: 'setup-failed', detail: probeDetail(error instanceof Error ? error.message : String(error)) };
  }

  const errors: string[] = [];
  let lost = '';
  const onError = (event: Event) => {
    errors.push((event as { error?: { message?: string } }).error?.message ?? 'uncaptured GPU error');
  };
  device.addEventListener('uncapturederror', onError);
  void device.lost.then(info => { lost = String(info.reason); });
  try {
    // The first call only records the scene change; the kernels go out on the ones after it.
    for (let frame = 0; frame < VERIFY_FRAMES; frame++) tracer.render(ctx.scene, ctx.camera);

    // Browsers without the drain call skip that check rather than failing the device.
    const queue = device.queue as { onSubmittedWorkDone?: () => Promise<undefined> };
    if (queue.onSubmittedWorkDone) {
      const settled = await Promise.race([
        queue.onSubmittedWorkDone().then(() => 'done' as const),
        verifyTimeout(VERIFY_TIMEOUT_MS),
      ]);
      if (settled === 'timeout') {
        return { ok: false, failure: 'gpu-error', detail: probeDetail(`${VERIFY_TIMEOUT_MS}ms 内 GPU 队列没有排空`) };
      }
    }

    if (errors.length > 0) return { ok: false, failure: 'gpu-error', detail: probeDetail(errors[0]) };
    if (lost) return { ok: false, failure: 'gpu-error', detail: probeDetail(`GPU 上下文丢失：${lost}`) };

    // The wavefront backend advances one bounce per frame, so a couple of frames legitimately
    // report no finished sample yet. The count is shown, never judged.
    let average = Number.NaN;
    try {
      average = await tracer.measureSampleAverage();
    } catch {
      average = Number.NaN;
    }
    const counted = Number.isNaN(average) ? '样本计数不可读' : `平均 ${average.toFixed(1)} 样本`;
    return { ok: true, failure: null, detail: probeDetail(`试跑 ${VERIFY_FRAMES} 帧 · ${counted}`) };
  } catch (error) {
    return { ok: false, failure: 'setup-failed', detail: probeDetail(error instanceof Error ? `${error.name}: ${error.message}` : String(error)) };
  } finally {
    device.removeEventListener('uncapturederror', onError);
  }
}

/** Which ray tracing gate the viewport's next drawn frame is behind. */
export function rayTraceState(ctx: RendererContext): RayTraceState {
  if (ctx.renderMode !== 'raytraced') return 'inactive';
  if (ctx.rayCapability && !ctx.rayCapability.ok) return 'unsupported';
  const tracer = ctx.rayTracer;
  if (!tracer) return 'building';
  if (tracer.deferReason) return tracer.deferReason;
  return tracer.isBlending ? 'blending' : 'traced';
}

/** Whether this browser exposes a usable WebGPU adapter. */
export async function detectWebGPU(): Promise<boolean> {
  if (!('gpu' in navigator)) return false;
  const adapter = await navigator.gpu.requestAdapter();
  return !!adapter;
}

/** Creates the renderer, scene, camera and orbit controls of one viewport. */
export async function createRendererContext(canvas: HTMLCanvasElement): Promise<RendererContext> {
  // Keep a nonzero drawing buffer while the viewport is hidden by the layout.
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = FALLBACK_BACKGROUND;
  addStageFloor(scene);

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 1.4, 3.2);

  const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -ORTHO_CLIP_RANGE, ORTHO_CLIP_RANGE);
  orthographicCamera.position.copy(camera.position);
  orthographicCamera.up.copy(camera.up);
  orthographicCamera.lookAt(0, 0.9, 0);

  const controls = new OrbitControls<THREE.Camera>(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // One finger turns, two fingers dolly and truck; stated so a phone keeps those gestures
  // even if a later three release changes the library defaults.
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.target.set(0, 0.9, 0);
  controls.update();
  const detachZoomGestures = attachZoomGestures(controls, canvas);

  const ctx: RendererContext = {
    renderer, scene, camera, perspectiveCamera: camera, orthographicCamera,
    projection: 'perspective', orthoViewHeight: 1, controls, canvas,
    renderMode: 'shaded', rayConfig: createDefaultRayTracing(),
    rayTracer: null, rayTracerLoading: null, rayCapability: null,
    detachZoomGestures,
    disposed: false,
  };
  syncOrthoFrustum(ctx, width / height);
  return ctx;
}

/** Aspect of the viewport drawing surface, guarded against a hidden pane. */
export function viewportAspect(ctx: RendererContext): number {
  const width = Math.max(1, ctx.canvas.clientWidth);
  const height = Math.max(1, ctx.canvas.clientHeight);
  return width / height;
}

/** Rebuilds the orthographic frustum from the stored view height and the current aspect. */
export function syncOrthoFrustum(ctx: RendererContext, aspect: number): void {
  const camera = ctx.orthographicCamera;
  const height = Math.max(0.001, ctx.orthoViewHeight);
  const width = height * aspect;
  camera.left = -width / 2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();
}

/**
 * Swaps the viewport between perspective and orthographic cameras.
 * Both share position, orientation and orbit target; framing stays where it was.
 */
export function setCameraProjection(ctx: RendererContext, projection: CameraProjection): void {
  if (ctx.projection === projection) return;
  const from = ctx.camera;
  const to = projection === 'perspective' ? ctx.perspectiveCamera : ctx.orthographicCamera;
  to.position.copy(from.position);
  to.up.copy(from.up);
  to.quaternion.copy(from.quaternion);
  ctx.camera = to;
  ctx.projection = projection;
  ctx.controls.object = to;
  const canvas = ctx.canvas;
  syncOrthoFrustum(ctx, Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight));
  ctx.controls.update();
}

/** Selects rasterized shading or lazily initialized WebGPU ray tracing. */
export async function setRendererMode(ctx: RendererContext, mode: RenderMode): Promise<void> {
  ctx.renderMode = mode;
  if (mode !== 'raytraced' || ctx.rayTracer || ctx.disposed) return;
  if (ctx.rayCapability && !ctx.rayCapability.ok) throw new RayTracingUnsupportedError(ctx.rayCapability);
  if (!ctx.rayTracerLoading) {
    ctx.rayTracerLoading = import('./rayTracingRenderer')
      .then(async ({ RayTracingRenderer }) => {
        if (ctx.disposed) return null;
        const tracer = new RayTracingRenderer(ctx.renderer, ctx.rayConfig);
        await tracer.setConfig(ctx.rayConfig);
        // The switch is only proven once the kernels have drawn; see verifyRayTracing.
        const capability = ctx.rayCapability ?? await verifyRayTracing(ctx, tracer);
        if (capability) {
          ctx.rayCapability = capability;
          if (!capability.ok) {
            tracer.dispose();
            throw new RayTracingUnsupportedError(capability);
          }
        }
        if (ctx.disposed) {
          tracer.dispose();
          return null;
        }
        return tracer;
      })
      .catch(error => {
        ctx.rayTracerLoading = null;
        throw error;
      });
  }
  const loading = ctx.rayTracerLoading;
  const rayTracer = await loading;
  // Recovery or a retry can drop this creation attempt; its tracer is then ours to free.
  if (ctx.rayTracerLoading !== loading) {
    if (rayTracer && rayTracer !== ctx.rayTracer) rayTracer.dispose();
    return;
  }
  ctx.rayTracerLoading = null;
  if (ctx.disposed) {
    rayTracer?.dispose();
    return;
  }
  if (rayTracer && !ctx.rayTracer) ctx.rayTracer = rayTracer;
}

/** Stores project settings and applies them to a ready ray tracer. */
export function setRayTracingConfig(ctx: RendererContext, config: RayTracingConfig): Promise<void> {
  ctx.rayConfig = config;
  if (ctx.renderMode !== 'raytraced' || !ctx.rayTracer) return Promise.resolve();
  return ctx.rayTracer.setConfig(config);
}

/** Draws the active rendering mode into the viewport canvas. */
export function renderScene(ctx: RendererContext): void {
  // While the view is in motion the path tracer defers and the raster frame is shown instead.
  if (ctx.renderMode === 'raytraced' && ctx.rayTracer?.render(ctx.scene, ctx.camera)) return;
  ctx.renderer.render(ctx.scene, ctx.camera);
}

/** Rebuilds the scene's lights and tone mapping from the project's lighting and render settings. */
export function applyLightConfig(ctx: RendererContext, cfg: LightConfig, renderCfg: RenderConfig): void {
  const { scene, renderer } = ctx;
  ctx.lightConfig = cfg;
  ctx.renderConfig = renderCfg;
  const group = ensureLightGroup(scene);
  clearGroup(group);

  // Lifts the areas the environment image cannot reach.
  const ambient = new THREE.AmbientLight(0xffffff, iblStrength(cfg) * 0.15);
  ambient.name = '环境补光';
  group.add(ambient);

  scene.environmentIntensity = iblStrength(cfg);

  const lights = normalizeLights(cfg);
  for (const light of lights) {
    const object = lightToObject(light);
    if (!object) continue;
    object.name = light.name;
    object.visible = light.enabled;
    group.add(object);
    const target = (object as THREE.SpotLight).target;
    if (target) group.add(target);
  }
  if (lights.some(light => light.type === 'area') && !areaLightSupported && !areaLightLoading) {
    areaLightLoading = installAreaLightSupport(ctx).finally(() => { areaLightLoading = null; });
  }

  switch (renderCfg.toneMapping) {
    case 'aces': renderer.toneMapping = THREE.ACESFilmicToneMapping; break;
    case 'reinhard': renderer.toneMapping = THREE.ReinhardToneMapping; break;
    case 'linear': renderer.toneMapping = THREE.LinearToneMapping; break;
    default: renderer.toneMapping = THREE.NoToneMapping;
  }
  ctx.rayTracer?.invalidateLights();
  ctx.rayTracer?.invalidateEnvironment();
}

let areaLightSupported = false;
let areaLightLoading: Promise<void> | null = null;

/** Loads the LTC textures a rect area light needs, then rebuilds the scene lights with them. */
async function installAreaLightSupport(ctx: RendererContext): Promise<void> {
  try {
    const { RectAreaLightTexturesLib } = await import('three/examples/jsm/lights/RectAreaLightTexturesLib.js');
    (THREE as unknown as { RectAreaLightNode: { setLTC(lib: unknown): void } })
      .RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
    areaLightSupported = true;
    const cfg = ctx.lightConfig;
    const renderCfg = ctx.renderConfig;
    if (!ctx.disposed && cfg && renderCfg) applyLightConfig(ctx, cfg, renderCfg);
  } catch (error) {
    console.warn('Rect area light support unavailable:', error);
  }
}

/** The three.js light matching one project light; null while area lights are unsupported. */
function lightToObject(light: SceneLight): THREE.Light | null {
  const color = new THREE.Color(light.color);
  const position = new THREE.Vector3(light.position.x, light.position.y, light.position.z);
  const target = new THREE.Vector3(light.target.x, light.target.y, light.target.z);

  switch (light.type) {
    case 'directional': {
      const object = new THREE.DirectionalLight(color, light.intensity);
      object.position.copy(position);
      object.target.position.copy(target);
      return object;
    }
    case 'point': {
      const object = new THREE.PointLight(color, light.intensity, light.distance, PUNCTUAL_DECAY);
      object.position.copy(position);
      return object;
    }
    case 'spot': {
      const object = new THREE.SpotLight(
        color, light.intensity, light.distance, light.coneAngleDeg * Math.PI / 180, light.penumbra, PUNCTUAL_DECAY,
      );
      object.position.copy(position);
      object.target.position.copy(target);
      return object;
    }
    case 'area': {
      if (!areaLightSupported) return null;
      const object = new THREE.RectAreaLight(color, light.intensity, light.width, light.height);
      object.position.copy(position);
      object.lookAt(target);
      return object;
    }
    default:
      return null;
  }
}

/** Inverse-square falloff for the punctual lights that have one. */
const PUNCTUAL_DECAY = 2;

/** Name of the scene container holding every project light. */
const LIGHT_GROUP_NAME = 'sceneLights';

/** The scene's light container, created on first use. */
function ensureLightGroup(scene: THREE.Scene): THREE.Group {
  const existing = scene.getObjectByName(LIGHT_GROUP_NAME);
  if (existing instanceof THREE.Group) return existing;
  const group = new THREE.Group();
  group.name = LIGHT_GROUP_NAME;
  scene.add(group);
  return group;
}

/** Removes every child of the light container and frees its resources. */
function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    (child as THREE.Light).dispose?.();
  }
}

/** Frees both rendering paths, including a ray tracer still being loaded. */
export function disposeRendererContext(ctx: RendererContext): void {
  if (ctx.disposed) return;
  ctx.disposed = true;
  ctx.resizeObserver?.disconnect();
  ctx.rayTracer?.dispose();
  ctx.rayTracer = null;
  void ctx.rayTracerLoading?.then(rayTracer => rayTracer?.dispose()).catch(() => { });
  ctx.detachZoomGestures?.();
  ctx.controls.dispose();
  ctx.renderer.dispose();
}

/** Matches the drawing buffer and both cameras to a new viewport size. */
export function resizeRenderer(ctx: RendererContext, width: number, height: number): void {
  // Hidden viewports report zero size; keep the last valid drawing buffer.
  if (width <= 0 || height <= 0) return;
  const aspect = width / height;
  ctx.perspectiveCamera.aspect = aspect;
  ctx.perspectiveCamera.updateProjectionMatrix();
  syncOrthoFrustum(ctx, aspect);
  ctx.renderer.setSize(width, height, false);
}
