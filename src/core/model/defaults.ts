import type {
  Project, Pattern, Fabric, Avatar, AvatarParams, SceneConfig, ObjectTransform,
  FabricPresetKey, FabricPhysics, FabricAppearance, RayTracingConfig, DenoiseModel,
  LightType, SceneLight, LightConfig, Vec3, SeamType, EdgeSemantic, TrimKind,
} from './types';
import { vec2, vec3 } from './types';

let idCounter = 0;
/** Unique record id: prefix, counter and timestamp. */
export function genId(prefix = 'id'): string {
  return `${prefix}_${(++idCounter).toString(36)}_${Date.now().toString(36)}`;
}

/** Placement at the world origin, full size. */
export const IDENTITY_TRANSFORM: ObjectTransform = {
  position: vec3(0, 0, 0),
  rotationEuler: vec3(0, 0, 0),
  scale: vec3(1, 1, 1),
};

/** Detached copy of a transform, for undo snapshots and new objects. */
export function cloneTransform(t: ObjectTransform = IDENTITY_TRANSFORM): ObjectTransform {
  return {
    position: { ...t.position },
    rotationEuler: { ...t.rotationEuler },
    scale: { ...t.scale },
  };
}

// ============ Fabric presets ============

/** Solver parameters per fabric preset, in grams per square metre for the preset's weight. */
export const FABRIC_PHYSICS_PRESETS: Record<FabricPresetKey, FabricPhysics> = {
  cotton: { stretchStiffness: 0.9, bendingStiffness: 0.4, shearStiffness: 0.8, massPerArea: 180, damping: 0.02 },
  silk: { stretchStiffness: 0.95, bendingStiffness: 0.15, shearStiffness: 0.85, massPerArea: 80, damping: 0.015 },
  denim: { stretchStiffness: 0.8, bendingStiffness: 0.75, shearStiffness: 0.7, massPerArea: 400, damping: 0.03 },
  knit: { stretchStiffness: 0.5, bendingStiffness: 0.25, shearStiffness: 0.4, massPerArea: 250, damping: 0.02 },
};

/** Surface shading per fabric preset. */
export const FABRIC_APPEARANCE_PRESETS: Record<FabricPresetKey, FabricAppearance> = {
  cotton: {
    baseColor: '#e8e4d8', metallic: 0, roughness: 0.85, normalScale: 0.5,
    sheenColor: '#fff8ee', sheenIntensity: 0.15, sheenRoughness: 0.6,
    transmission: 0, thickness: 0.4, clearcoat: 0, clearcoatRoughness: 0.5,
    anisotropy: 0, iridescence: 0,
    maps: {}, uvTiling: vec2(1, 1), uvOffset: vec2(0, 0),
  },
  silk: {
    baseColor: '#d4a574', metallic: 0, roughness: 0.35, normalScale: 0.3,
    sheenColor: '#ffe8cc', sheenIntensity: 0.6, sheenRoughness: 0.25,
    transmission: 0.06, thickness: 0.15, clearcoat: 0.15, clearcoatRoughness: 0.3,
    anisotropy: 0.35, iridescence: 0,
    maps: {}, uvTiling: vec2(1, 1), uvOffset: vec2(0, 0),
  },
  denim: {
    baseColor: '#3a5a8c', metallic: 0, roughness: 0.9, normalScale: 0.8,
    sheenColor: '#6a8cbc', sheenIntensity: 0.1, sheenRoughness: 0.8,
    transmission: 0, thickness: 1, clearcoat: 0, clearcoatRoughness: 0.5,
    anisotropy: 0, iridescence: 0,
    maps: {}, uvTiling: vec2(1, 1), uvOffset: vec2(0, 0),
  },
  knit: {
    baseColor: '#b85450', metallic: 0, roughness: 0.95, normalScale: 1.0,
    sheenColor: '#d88884', sheenIntensity: 0.25, sheenRoughness: 0.9,
    transmission: 0, thickness: 0.6, clearcoat: 0, clearcoatRoughness: 0.5,
    anisotropy: 0, iridescence: 0,
    maps: {}, uvTiling: vec2(1, 1), uvOffset: vec2(0, 0),
  },
};

/** Display names of the fabric presets, in the order the UI lists them. */
export const FABRIC_PRESET_LABELS: Record<FabricPresetKey, string> = {
  cotton: '棉',
  silk: '丝绸',
  denim: '牛仔',
  knit: '针织',
};

/** Presets offered when a new material is created. */
export const FABRIC_PRESET_KEYS = Object.keys(FABRIC_PRESET_LABELS) as FabricPresetKey[];

/** A new material record seeded from a preset. */
export function createFabric(preset: FabricPresetKey = 'cotton', name?: string): Fabric {
  return {
    id: genId('fabric'),
    name: name ?? FABRIC_PRESET_LABELS[preset],
    presetKey: preset,
    appearance: structuredClone(FABRIC_APPEARANCE_PRESETS[preset]),
    physics: structuredClone(FABRIC_PHYSICS_PRESETS[preset]),
  };
}

// ============ Empty pattern ============

/** Pattern with no points, edges, panels or seams yet. */
export function createEmptyPattern(): Pattern {
  return {
    points: {},
    edges: {},
    darts: {},
    internalLines: {},
    panels: {},
    seams: {},
    notches: {},
    annotations: {},
    measurements: {},
    prints: {},
    topstitches: {},
    trims: {},
  };
}

// ============ Default avatar ============

/** Body mesh shipped in assets/models and served from the site root. */
export interface BundledAvatar {
  url: string;
  label: string;
  /** Measurements matching the mesh, applied when the model is selected. */
  params: AvatarParams;
}

const MALE_PARAMS: AvatarParams = { heightCm: 170, chestCm: 92, waistCm: 74, hipCm: 96, poseArmAngleRad: 0.12 };
const FEMALE_PARAMS: AvatarParams = { heightCm: 175, chestCm: 92, waistCm: 70, hipCm: 110, poseArmAngleRad: 0.12 };

/** Bundled body meshes, first entry is the default. */
export const BUNDLED_AVATARS: BundledAvatar[] = [
  { url: '/models/human-body-f.glb', label: '女性模特', params: FEMALE_PARAMS },
  { url: '/models/human-body-pro.glb', label: '专业模特', params: MALE_PARAMS },
  { url: '/models/human-body.glb', label: '标准模特', params: MALE_PARAMS },
];

/** Bundled body mesh used by a fresh project. */
const DEFAULT_AVATAR = BUNDLED_AVATARS[0];
/** Url of that default mesh. */
export const BUNDLED_AVATAR_URL = DEFAULT_AVATAR.url;

/** Avatar dressed in the default bundled mesh and its measurements. */
export function createDefaultAvatar(): Avatar {
  return {
    id: genId('avatar'),
    source: 'glb',
    params: { ...DEFAULT_AVATAR.params },
    glbUrl: BUNDLED_AVATAR_URL,
    display: 'visible',
  };
}

// ============ Default scene ============

/** Default simulation mesh edge length in cm; finer than the per-panel pattern value. */
export const DEFAULT_MESH_RESOLUTION_CM = 1.5;

/** Default cloth thickness in cm; the minimum clearance against body and floor. */
export const DEFAULT_CLOTH_THICKNESS_CM = 0.2;

/** Default extra separation per collision-layer step, in cm. */
export const DEFAULT_LAYER_SPACING_CM = 0.4;

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
      mode: 'shaded',
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

// ============ Default project ============

/** Fresh project: empty pattern, one cotton material, default avatar and scene. */
export function createDefaultProject(name = '未命名工程'): Project {
  const fabric = createFabric('cotton');
  return {
    meta: {
      name,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    pattern: createEmptyPattern(),
    fabrics: { [fabric.id]: fabric },
    avatar: createDefaultAvatar(),
    scene: createDefaultScene(),
  };
}
