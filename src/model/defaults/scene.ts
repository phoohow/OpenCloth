import type {
  CameraAnimationConfig, CameraAnimationKind, DenoiseModel, EdgeSemantic, EnvironmentSource, FloorConfig,
  GarmentLayer, LightConfig, LightType, MeshSampling, RayTracingConfig, SceneConfig, SceneLight, SeamType,
  TrimKind, Vec3, WireOptions,
} from '@/model/types';

import { cloneTransform } from './transform';
import { genId } from '@/base/id';
import { vec3 } from '@/model/types';

export const DEFAULT_WIRE_OPTIONS: WireOptions = { color: 0x66ccff, depth: 'tested' };

export const DEFAULT_MESH_RESOLUTION_CM = 1;

export const MESH_RESOLUTION_MIN_CM = 0.2;

export const MESH_RESOLUTION_MAX_CM = 5;

export const DEFAULT_MESH_SAMPLING: MeshSampling = 'lattice';

export const DEFAULT_CLOTH_THICKNESS_CM = 0.2;

export const DEFAULT_LAYER_SPACING_CM = 0.4;

export const GARMENT_LAYERS: GarmentLayer[] = ['lining', 'padding', 'shell'];

export const DEFAULT_LAYER_THICKNESS_CM: Record<GarmentLayer, number> = {
  lining: 0.1, padding: 0.8, shell: 0.2,
};

export const GARMENT_LAYER_COLLISION: Record<GarmentLayer, number> = {
  lining: 0, padding: 1, shell: 2,
};

export const LIGHT_TYPE_LABELS: Record<LightType, string> = {
  directional: '方向光',
  point: '点光源',
  spot: '聚光灯',
  area: '面积光',
};

export const LIGHT_TYPES: LightType[] = ['directional', 'point', 'spot', 'area'];

export const SEAM_TYPE_LABELS: Record<SeamType, string> = {
  normal: '普通',
  gather: '缩缝',
  free: '开放',
};

export const SEAM_TYPES: SeamType[] = ['normal', 'gather', 'free'];

export const TRIM_KIND_LABELS: Record<TrimKind, string> = {
  button: '纽扣',
  eyelet: '气眼',
  rivet: '铆钉',
  snap: '按扣',
};

export const TRIM_KINDS: TrimKind[] = ['button', 'eyelet', 'rivet', 'snap'];

export const MAX_PRINT_BYTES = 8 * 1024 * 1024;

export const EDGE_SEMANTIC_LABELS: Record<EdgeSemantic, string> = {
  hem: '脚口', neckline: '领口', armhole: '袖窿', sideSeam: '侧缝', shoulder: '肩线',
  sleeveCap: '袖山', waist: '腰节', dart: '省道', internal: '内部', free: '自由边',
};

const LIGHT_PLACEMENT = {
  directional: { position: vec3(2, 4, 3), target: vec3(0, 0, 0) },
  point: { position: vec3(1.2, 1.8, 1.2), target: vec3(0, 1, 0) },
  spot: { position: vec3(0, 3, 1.5), target: vec3(0, 1, 0) },
  area: { position: vec3(1.5, 1.8, 1.5), target: vec3(0, 1, 0) },
};

export const LIGHT_INTENSITY: Record<LightType, number> = {
  directional: 3,
  point: 60,
  spot: 80,
  area: 10,
};

export const DEFAULT_FLOOR_SIZE = 20;

export const DEFAULT_FLOOR_GRID_SPACING = 1;

export const FLOOR_SIZE_MIN = 0.5;

export const FLOOR_SIZE_MAX = 200;

export const FLOOR_GRID_SPACING_MIN = 0.05;

export const FLOOR_GRID_SPACING_MAX = 10;

export const DEFAULT_CAMERA_ANIMATION: CameraAnimationConfig = {
  kind: 'orbit',
  enabled: false,
  periodSec: 12,
  amplitude: 60,
};

export const CAMERA_ANIMATION_KINDS: CameraAnimationKind[] = ['orbit', 'dolly', 'pan', 'crane'];

export const CAMERA_ANIMATION_LABELS: Record<CameraAnimationKind, string> = {
  orbit: '环绕旋转',
  dolly: '推拉',
  pan: '左右平移',
  crane: '上下升降',
};

export const MAX_CAMERA_ANIMATION_PERIOD_SEC = 60;

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const clampVec3 = (value: Vec3 | undefined, fallback: Vec3): Vec3 => ({
  x: clampNumber(value?.x, fallback.x, -100, 100),
  y: clampNumber(value?.y, fallback.y, -100, 100),
  z: clampNumber(value?.z, fallback.z, -100, 100),
});

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

export function normalizeLights(lights: LightConfig | undefined): SceneLight[] {
  if (Array.isArray(lights?.lights)) return lights.lights.map(normalizeLight);
  return createDefaultLights();
}

export function iblStrength(lights: LightConfig): number {
  return lights.iblEnabled === false ? 0 : (lights.iblIntensity ?? 0);
}

export function hasOwnEnvironment(lights: LightConfig): boolean {
  return !!(lights.iblObjectKey ?? lights.iblUrl);
}

export function environmentSource(lights: LightConfig): EnvironmentSource {
  if (lights.iblSource === 'builtin') return 'builtin';
  return hasOwnEnvironment(lights) ? 'custom' : 'builtin';
}

export function floorVisible(scene: SceneConfig): boolean {
  return scene.floorVisible !== false;
}

export function createDefaultFloor(): FloorConfig {
  return {
    width: DEFAULT_FLOOR_SIZE,
    depth: DEFAULT_FLOOR_SIZE,
    gridSpacing: DEFAULT_FLOOR_GRID_SPACING,
    gridVisible: true,
    transform: cloneTransform(),
  };
}

export function normalizeFloor(raw: Partial<FloorConfig> | undefined): FloorConfig {
  const defaults = createDefaultFloor();
  return {
    width: clampNumber(raw?.width, defaults.width, FLOOR_SIZE_MIN, FLOOR_SIZE_MAX),
    depth: clampNumber(raw?.depth, defaults.depth, FLOOR_SIZE_MIN, FLOOR_SIZE_MAX),
    gridSpacing: clampNumber(
      raw?.gridSpacing, defaults.gridSpacing, FLOOR_GRID_SPACING_MIN, FLOOR_GRID_SPACING_MAX,
    ),
    gridVisible: typeof raw?.gridVisible === 'boolean' ? raw.gridVisible : defaults.gridVisible,
    transform: raw?.transform ? cloneTransform(raw.transform) : defaults.transform,
  };
}

export function createDefaultRayTracing(): RayTracingConfig {
  return {
    maxBounces: 8,
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

export function normalizeCameraAnimation(
  config: Partial<CameraAnimationConfig> | undefined,
): CameraAnimationConfig {
  const kind = config?.kind;
  const period = config?.periodSec;
  const amplitude = config?.amplitude;
  return {
    kind: kind && CAMERA_ANIMATION_KINDS.includes(kind) ? kind : DEFAULT_CAMERA_ANIMATION.kind,
    enabled: typeof config?.enabled === 'boolean' ? config.enabled : DEFAULT_CAMERA_ANIMATION.enabled,
    periodSec: typeof period === 'number' && Number.isFinite(period)
      ? Math.min(MAX_CAMERA_ANIMATION_PERIOD_SEC, Math.max(1, period))
      : DEFAULT_CAMERA_ANIMATION.periodSec,
    amplitude: typeof amplitude === 'number' && Number.isFinite(amplitude)
      ? Math.max(0, amplitude)
      : DEFAULT_CAMERA_ANIMATION.amplitude,
  };
}

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
    floorVisible: true,
    floor: createDefaultFloor(),
    simulation: {
      gravity: vec3(0, -9.8, 0),
      wind: { direction: vec3(1, 0, 0), speed: 0 },
      dt: 1 / 60,
      substeps: 4,
      constraintIterations: 5,
      meshResolutionCm: DEFAULT_MESH_RESOLUTION_CM,
      avatarCollision: true,
      floorCollision: true,
      clothThicknessCm: DEFAULT_CLOTH_THICKNESS_CM,
      selfCollision: true,
      layerSpacingCm: DEFAULT_LAYER_SPACING_CM,
    },
  };
}
