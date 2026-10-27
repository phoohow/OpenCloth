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
  /** Watcher that keeps the drawing buffer in sync with the viewport's layout size. */
  resizeObserver?: ResizeObserver;
  disposed: boolean;
}

/** The GPUDevice the renderer was initialized with; simulation resources share it. */
export function rendererDevice(ctx: RendererContext): GPUDevice {
  const device = (ctx.renderer.backend as unknown as { device?: GPUDevice }).device;
  if (!device) throw new Error('WebGPU renderer device unavailable before init');
  return device;
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
  controls.target.set(0, 0.9, 0);
  controls.update();

  const ctx: RendererContext = {
    renderer, scene, camera, perspectiveCamera: camera, orthographicCamera,
    projection: 'perspective', orthoViewHeight: 1, controls, canvas,
    renderMode: 'shaded', rayConfig: createDefaultRayTracing(),
    rayTracer: null, rayTracerLoading: null, disposed: false,
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
  if (!ctx.rayTracerLoading) {
    ctx.rayTracerLoading = import('./rayTracingRenderer')
      .then(async ({ RayTracingRenderer }) => {
        if (ctx.disposed) return null;
        const tracer = new RayTracingRenderer(ctx.renderer, ctx.rayConfig);
        await tracer.setConfig(ctx.rayConfig);
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
