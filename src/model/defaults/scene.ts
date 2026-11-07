import type {
  DenoiseModel, EdgeSemantic, GarmentLayer, LightConfig, LightType, MeshSampling, RayTracingConfig,
  SceneConfig, SceneLight, SeamType, TrimKind, Vec3, WireOptions,
} from '@/model/types';
import { vec3 } from '@/model/types';
import { genId } from '@/common/id';

/** Wire overlay the viewport starts with. */
export const DEFAULT_WIRE_OPTIONS: WireOptions = { color: 0x66ccff, depth: 'tested' };

/** Default simulation mesh edge length in cm; finer than the per-panel pattern value. */
export const DEFAULT_MESH_RESOLUTION_CM = 1.5;

/** Default interior mesh point distribution. */
export const DEFAULT_MESH_SAMPLING: MeshSampling = 'lattice';

/** Default cloth thickness in cm; the minimum clearance against body and floor. */
export const DEFAULT_CLOTH_THICKNESS_CM = 0.2;

/** Default extra separation per collision-layer step, in cm. */
export const DEFAULT_LAYER_SPACING_CM = 0.4;

/** Construction layers from the body outward. */
export const GARMENT_LAYERS: GarmentLayer[] = ['lining', 'padding', 'shell'];

/** Default collision clearance of each construction layer, in cm. */
export const DEFAULT_LAYER_THICKNESS_CM: Record<GarmentLayer, number> = {
  lining: 0.1, padding: 0.8, shell: 0.2,
};

/** Collision layer a construction layer starts from; lining sits innermost. */
export const GARMENT_LAYER_COLLISION: Record<GarmentLayer, number> = {
  lining: 0, padding: 1, shell: 2,
};

/** Display names of the light types, in the order the UI lists them. */
export const LIGHT_TYPE_LABELS: Record<LightType, string> = {
  directional: '方向光',
  point: '点光源',
  spot: '聚光灯',
  area: '面积光',
};

/** Every light type, in creation and select order. */
export const LIGHT_TYPES: LightType[] = ['directional', 'point', 'spot', 'area'];

/** Display names of the seam types, in select order. */
export const SEAM_TYPE_LABELS: Record<SeamType, string> = {
  normal: '普通缝合',
  gather: '缩缝',
  free: '开放边',
};

/** Every seam type, in select order. */
export const SEAM_TYPES: SeamType[] = ['normal', 'gather', 'free'];

/** Display names of the trim kinds, in select order. */
export const TRIM_KIND_LABELS: Record<TrimKind, string> = {
  button: '纽扣',
  eyelet: '气眼',
  rivet: '铆钉',
  snap: '按扣',
};

/** Every trim kind, in select order. */
export const TRIM_KINDS: TrimKind[] = ['button', 'eyelet', 'rivet', 'snap'];

/** Side of a newly placed print, in centimetres. */
export const DEFAULT_PRINT_SIDE_CM = 12;

/** Largest artwork file the print tools accept. */
export const MAX_PRINT_BYTES = 8 * 1024 * 1024;

/** Display names of the outline edge roles, shared by the outliner and the tech pack. */
export const EDGE_SEMANTIC_LABELS: Record<EdgeSemantic, string> = {
  hem: '脚口', neckline: '领口', armhole: '袖窿', sideSeam: '侧缝', shoulder: '肩线',
  sleeveCap: '袖山', waist: '腰节', dart: '省道', internal: '内部', free: '自由边',
};

/** Default placement for each light type. */
const LIGHT_PLACEMENT = {
  directional: { position: vec3(2, 4, 3), target: vec3(0, 0, 0) },
  point: { position: vec3(1.2, 1.8, 1.2), target: vec3(0, 1, 0) },
  spot: { position: vec3(0, 3, 1.5), target: vec3(0, 1, 0) },
  area: { position: vec3(1.5, 1.8, 1.5), target: vec3(0, 1, 0) },
};

/** Brightness a new light of this type starts at. */
const LIGHT_INTENSITY: Record<LightType, number> = {
  directional: 3,
  point: 60,
  spot: 80,
  area: 10,
};

/** A new light of the given type, placed to aim at the garment. */
export function createLight(type: LightType, index: number): SceneLight {
  return {
    id: genId('light'),
    name: `${LIGHT_TYPE_LABELS[type]} ${index}`,
    type,
    enabled: true,
    intensity: LIGHT_INTENSITY[type],
    color: '#ffffff',
    position: { ...LIGHT_PLACEMENT[type].position },
    target: { ...LIGHT_PLACEMENT[type].target },
    distance: 0,
    coneAngleDeg: 40,
    penumbra: 0.3,
    width: 1,
    height: 1,
  };
}

/** The project's two starting lights: a key and a fill directional. */
export function createDefaultLights(): SceneLight[] {
  const key = createLight('directional', 1);
  key.name = '主光';
  const fill = createLight('directional', 2);
  fill.name = '补光';
  fill.color = '#cfe0ff';
  fill.intensity = 1;
  fill.position = vec3(-2, 2, -1);
  return [key, fill];
}

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const clampVec3 = (value: Vec3 | undefined, fallback: Vec3): Vec3 => ({
  x: clampNumber(value?.x, fallback.x, -100, 100),
  y: clampNumber(value?.y, fallback.y, -100, 100),
  z: clampNumber(value?.z, fallback.z, -100, 100),
});

/** Sanitizes one persisted light, filling in anything the record lacks. */
function normalizeLight(raw: Partial<SceneLight>, index: number): SceneLight {
  const type = LIGHT_TYPES.includes(raw.type as LightType) ? raw.type as LightType : 'directional';
  const placement = LIGHT_PLACEMENT[type];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : genId('light'),
    name: typeof raw.name === 'string' && raw.name ? raw.name : `${LIGHT_TYPE_LABELS[type]} ${index + 1}`,
    type,
    enabled: raw.enabled !== false,
    intensity: clampNumber(raw.intensity, LIGHT_INTENSITY[type], 0, 500),
    color: typeof raw.color === 'string' ? raw.color : '#ffffff',
    position: clampVec3(raw.position, placement.position),
    target: clampVec3(raw.target, placement.target),
    distance: clampNumber(raw.distance, 0, 0, 100),
    coneAngleDeg: clampNumber(raw.coneAngleDeg, 40, 1, 178),
    penumbra: clampNumber(raw.penumbra, 0.3, 0, 1),
    width: clampNumber(raw.width, 1, 0.01, 50),
    height: clampNumber(raw.height, 1, 0.01, 50),
  };
}

/** Sanitized list of a project's lights; empty or absent falls back to the defaults. */
export function normalizeLights(lights: LightConfig | undefined): SceneLight[] {
  if (Array.isArray(lights?.lights)) return lights.lights.map(normalizeLight);
  return createDefaultLights();
}

/** Environment lighting in effect: zero while the environment light is off. */
export function iblStrength(lights: LightConfig): number {
  return lights.iblEnabled === false ? 0 : (lights.iblIntensity ?? 0);
}

/** Default quality settings for the WebGPU path tracer. */
export function createDefaultRayTracing(): RayTracingConfig {
  return {
    maxBounces: 8,
    // Path slots per accumulation frame, about one per pixel of a typical pane. Sampling only
    // runs while the view is still, so a full-size budget costs no interaction responsiveness.
    frameBudget: 500000,
    maxSamples: 256,
    renderScale: 1,
    denoise: true,
    denoiseModel: 'base',
    filterGlossyFactor: 1,
    clampDirect: 0,
    clampIndirect: 8,
  };
}

/** Sanitizes persisted or partial ray tracing settings. */
export function normalizeRayTracing(config: Partial<RayTracingConfig> | undefined): RayTracingConfig {
  const defaults = createDefaultRayTracing();
  const number = (value: unknown, fallback: number, min: number, max: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  const models: DenoiseModel[] = ['small', 'base'];
  return {
    maxBounces: Math.round(number(config?.maxBounces, defaults.maxBounces, 1, 16)),
    frameBudget: Math.round(number(config?.frameBudget, defaults.frameBudget, 50000, 1000000)),
    maxSamples: Math.round(number(config?.maxSamples, defaults.maxSamples, 8, 1024)),
    renderScale: number(config?.renderScale, defaults.renderScale, 0.5, 1),
    denoise: typeof config?.denoise === 'boolean' ? config.denoise : defaults.denoise,
    denoiseModel: models.includes(config?.denoiseModel as DenoiseModel)
      ? config!.denoiseModel as DenoiseModel
      : defaults.denoiseModel,
    filterGlossyFactor: number(config?.filterGlossyFactor, defaults.filterGlossyFactor, 0, 1),
    clampDirect: number(config?.clampDirect, defaults.clampDirect, 0, 10),
    clampIndirect: number(config?.clampIndirect, defaults.clampIndirect, 0, 20),
  };
}

/** Lighting, rendering and solver settings of a fresh project. */
export function createDefaultScene(): SceneConfig {
  return {
    lights: {
      lights: createDefaultLights(),
      iblEnabled: true,
      iblIntensity: 1.0,
    },
    render: {
      wireOptions: DEFAULT_WIRE_OPTIONS,
      toneMapping: 'aces',
      rayTracing: createDefaultRayTracing(),
    },
    simulation: {
      gravity: vec3(0, -9.8, 0),
      wind: { direction: vec3(1, 0, 0), speed: 0 },
      dt: 1 / 60,
      substeps: 4,
      constraintIterations: 5,
      meshResolutionCm: DEFAULT_MESH_RESOLUTION_CM,
      avatarCollision: true,
      clothThicknessCm: DEFAULT_CLOTH_THICKNESS_CM,
      selfCollision: true,
      layerSpacingCm: DEFAULT_LAYER_SPACING_CM,
    },
  };
}
