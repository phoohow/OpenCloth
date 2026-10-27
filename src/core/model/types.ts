/** Core data model types shared by the pattern editor, simulation, and serialization. */

// ============ Geometry primitives ============

/** Point in pattern-plane coordinates, in centimeters. */
export interface Vec2 { x: number; y: number; }
/** Point in world coordinates, in meters. */
export interface Vec3 { x: number; y: number; z: number; }

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });
export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// ============ Pattern ============

/** Named point of a panel outline or a construction guide. */
export interface PatternPoint {
  id: string;
  pos: Vec2;
  /** Helper point used to build geometry; not part of a cut outline. */
  construction?: boolean;
}

/** How an edge runs between its two points. */
export type EdgeType = 'line' | 'bezier';

/** Role an edge plays on the finished garment. */
export type EdgeSemantic =
  | 'hem' | 'neckline' | 'armhole' | 'sideSeam'
  | 'shoulder' | 'sleeveCap' | 'waist' | 'dart' | 'internal' | 'free';

/** One edge of the pattern, shared by the outlines and seams that reference it. */
export interface PatternEdge {
  id: string;
  type: EdgeType;
  startPointId: string;
  endPointId: string;
  /** Bezier handles in absolute pattern coordinates; present when type is 'bezier'. */
  bezier?: { c0: Vec2; c1: Vec2 };
  semantic?: EdgeSemantic;
}

/** Wedge of fabric removed between two edges meeting at a tip. */
export interface Dart {
  id: string;
  tipId: string;
  edge1Id: string;
  edge2Id: string;
  /** Fabric width the dart takes out, in centimeters. */
  intakeCm: number;
}

/** Line drawn inside a panel outline rather than on its edge. */
export interface InternalLine {
  id: string;
  points: Vec2[];
  kind: 'fold' | 'decor' | 'split';
}

/** Where an object sits in the 3D scene: meters, radians (XYZ order) and per-axis scale. */
export interface ObjectTransform {
  position: Vec3;
  rotationEuler: Vec3;
  scale: Vec3;
}

/** Pose of a panel built from its pattern coordinates; scale stays implicit. */
export interface PanelPlacement {
  position: Vec3;
  rotationEuler: Vec3;
}

/** Vertical body reference point used to hang a panel. */
export type BodyLandmark =
  | 'neckTop' | 'shoulderTop' | 'shoulder' | 'bust' | 'waist'
  | 'hip' | 'crotch' | 'knee' | 'ankle';

/**
 * How a flat panel wraps the body in the pre-simulation placement. Absent on panels
 * drawn by hand, which fall back to name-based inference.
 */
export interface PanelDrape {
  /** Body part the panel wraps. */
  region: 'torso' | 'arm' | 'leg' | 'neck';
  /** Landmark level of the panel's top edge; the region's default landmark when absent. */
  anchor?: BodyLandmark;
  /** Moves the anchor up or down by this many centimeters. */
  anchorOffsetCm?: number;
  /** Wrap start angle in degrees: torso angles count from the body front center, limb angles from the body side. */
  startDeg?: number;
  /** Angular span in degrees; negative runs the wrap the other way around. Defaults to 180 for a torso half, 360 for a limb. */
  sweepDeg?: number;
  /** Which side of the body a limb wraps; the body centerline for a neck. */
  side?: 'left' | 'right';
  /** Adds this many centimeters to the wrap radius. */
  easeCm?: number;
  /**
   * Wraps each height row across the whole span using that row's own width and radius, so
   * tapered panels meet at their side seams instead of leaving angular gaps.
   */
  rowWrap?: boolean;
  /**
   * Keeps the wrap ring as wide as the widest body cross-section above each height, so a loose
   * garment hangs straight instead of shrink-wrapping the waist and hip.
   */
  plumb?: boolean;
  /** Bastes the top edge band while draping; sleeves hang from their cap seams instead. Defaults to true. */
  pinTop?: boolean;
}

/** One cut piece of the garment. */
export interface Panel {
  id: string;
  name: string;
  outlineEdgeIds: string[];
  dartIds: string[];
  internalLineIds: string[];
  /** Seam allowance added around the outline, in centimeters. */
  seamAllowanceCm: number;
  fabricId: string;
  /** Cloth edge length this panel is meshed at, in centimeters. */
  meshResolutionCm: number;
  placement?: PanelPlacement;
  /** Offsets the panel's built pose around its own centre; absent leaves it as built. */
  transform?: ObjectTransform;
  drape?: PanelDrape;
  visible: boolean;
  locked: boolean;
}

// ============ Seams ============

/** How the two edges of a seam are joined. */
export type SeamType = 'normal' | 'gather' | 'free';

/** Pair of pattern edges stitched together. */
export interface Seam {
  id: string;
  type: SeamType;
  edgeAId: string;
  edgeBId: string;
  /** Reverses edge B's vertex order before the two edges are paired. */
  flipB: boolean;
  /** Stiffness of the join. */
  strength: number;
  /** Stitch thread color drawn in the viewport. */
  threadColor: string;
  stitchVisible: boolean;
}

// ============ Pattern aggregate ============

/** Every pattern object, keyed by id. */
export interface Pattern {
  points: Record<string, PatternPoint>;
  edges: Record<string, PatternEdge>;
  darts: Record<string, Dart>;
  internalLines: Record<string, InternalLine>;
  panels: Record<string, Panel>;
  seams: Record<string, Seam>;
}

// ============ Fabric ============

/** Built-in fabric presets a new material starts from. */
export type FabricPresetKey = 'cotton' | 'silk' | 'denim' | 'knit';

/** Image references of the material maps; null clears a slot. */
export interface FabricMaps {
  albedo?: string | null;
  normal?: string | null;
  roughness?: string | null;
  metallic?: string | null;
}

/** How a fabric looks in the viewport and in exports. */
export interface FabricAppearance {
  baseColor: string;
  metallic: number;
  roughness: number;
  normalScale: number;
  sheenColor: string;
  sheenIntensity: number;
  maps: FabricMaps;
  uvTiling: Vec2;
  uvOffset: Vec2;
}

/** How a fabric behaves under the solver. */
export interface FabricPhysics {
  stretchStiffness: number;
  bendingStiffness: number;
  shearStiffness: number;
  massPerArea: number;
  damping: number;
}

/** One material record worn by panels. */
export interface Fabric {
  id: string;
  name: string;
  presetKey?: FabricPresetKey;
  appearance: FabricAppearance;
  physics: FabricPhysics;
}

// ============ Avatar ============

/** Body mesh from the procedural capsules or from a model file. */
export type AvatarSource = 'procedural' | 'glb';
/** How the avatar shows behind the garment. */
export type AvatarDisplay = 'visible' | 'hidden' | 'translucent';

/** Body measurements in centimeters. */
export interface AvatarParams {
  heightCm: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  /** Outward arm rake from vertical, in radians; default 0.12. */
  poseArmAngleRad?: number;
}

/** The body the garment dresses. */
export interface Avatar {
  id: string;
  source: AvatarSource;
  params: AvatarParams;
  /** Bundled model key or url of the avatar mesh. */
  glbUrl?: string;
  /** Blob key of an imported avatar model in the local object store. */
  glbObjectKey?: string;
  /** Target height in meters for an imported model; defaults to params.heightCm. */
  heightCm?: number;
  /** Display name of an imported glb model. */
  modelName?: string;
  /** Scene placement; absent means the identity transform. */
  transform?: ObjectTransform;
  display: AvatarDisplay;
}

// ============ Scene ============

/** Light kinds the viewport can render. */
export type LightType = 'directional' | 'point' | 'spot' | 'area';

/** One punctual light in the scene. */
export interface SceneLight {
  id: string;
  name: string;
  type: LightType;
  /** Off when false; the light stays in the project and in the outliner. */
  enabled: boolean;
  /** Brightness: lux-like for directional lights, candela-like for point and spot lights. */
  intensity: number;
  color: string;
  /** World position in meters; a directional light only uses its direction from the target. */
  position: Vec3;
  /** Point the light aims at; unused by point lights. */
  target: Vec3;
  /** Range in meters, 0 for unlimited. Point, spot and area lights. */
  distance: number;
  /** Full cone angle of a spot light, in degrees. */
  coneAngleDeg: number;
  /** Softness of a spot cone's edge, 0 is a hard edge. */
  penumbra: number;
  /** Emitter width and height in meters, for area lights. */
  width: number;
  height: number;
}

/** Lighting saved before the punctual-light list existed. */
export interface LegacyLightConfig {
  keyLight?: { direction: Vec3; intensity: number; color: string; castShadow?: boolean };
  fillLight?: { direction: Vec3; intensity: number; color: string };
  lights?: SceneLight[];
  iblUrl?: string;
  iblObjectKey?: string;
  iblName?: string;
  iblEnabled?: boolean;
  iblIntensity?: number;
}

/** Scene lighting from the project's lights plus an environment image. */
export interface LightConfig {
  /** Punctual lights, in outliner order. */
  lights: SceneLight[];
  /** Url of an equirectangular environment image; absent selects the bundled default. */
  iblUrl?: string;
  /** Object-store key of an imported environment image. */
  iblObjectKey?: string;
  /** File name of the imported environment image. */
  iblName?: string;
  /** Off when false; the environment image stays selected for lighting and backdrop. */
  iblEnabled: boolean;
  /** Multiplier for the environment image's lighting contribution. */
  iblIntensity: number;
}

/** Viewport shading and rendering modes. */
export type RenderMode = 'shaded' | 'raytraced' | 'wireframe' | 'shadedWireframe' | 'uvCheck' | 'normalVis';
/** Tone-mapping operators offered by the renderer. */
export type ToneMappingMode = 'none' | 'aces' | 'reinhard' | 'linear';

/** Denoiser model selected for a finished path-traced frame. */
export type DenoiseModel = 'small' | 'base';

/** Projection the 3D viewport renders through. */
export type CameraProjection = 'perspective' | 'orthographic';

/** Tuning for the WebGPU path tracer and its progressive samples. */
export interface RayTracingConfig {
  maxBounces: number;
  /** Path slots dispatched in each accumulation frame. */
  frameBudget: number;
  /** Samples each pixel reaches before rendering and denoising stop. */
  maxSamples: number;
  /** Full-resolution render size as a fraction of the canvas. */
  renderScale: number;
  denoise: boolean;
  denoiseModel: DenoiseModel;
  /** Blur applied to glossy reflections to suppress fireflies. */
  filterGlossyFactor: number;
  /** Direct-light contribution clamp; 0 disables clamping. */
  clampDirect: number;
  /** Indirect-light contribution clamp; 0 disables clamping. */
  clampIndirect: number;
}

/** Viewport rendering settings. */
export interface RenderConfig {
  mode: RenderMode;
  toneMapping: ToneMappingMode;
  rayTracing?: RayTracingConfig;
}

/** Constant wind pushing the cloth. */
export interface WindConfig {
  direction: Vec3;
  speed: number;
}

/** Solver settings. */
export interface SimulationConfig {
  gravity: Vec3;
  wind: WindConfig;
  /** Fixed timestep in seconds. */
  dt: number;
  substeps: number;
  constraintIterations: number;
  avatarCollision: boolean;
  /** Target simulation mesh edge length in cm; smaller means finer cloth. */
  meshResolutionCm?: number;
}

/** Persisted descriptor of an imported reference object. */
export interface ReferenceObjectRef {
  id: string;
  name: string;
  /** Blob key in the local object store; absent when the file is no longer available. */
  objectKey?: string;
  visible: boolean;
  opacity: number;
  /** Scene placement; absent means the identity transform. */
  transform?: ObjectTransform;
}

/** Everything around the garment: lighting, rendering, solving and reference objects. */
export interface SceneConfig {
  lights: LightConfig;
  render: RenderConfig;
  simulation: SimulationConfig;
  referenceObjects?: ReferenceObjectRef[];
}

// ============ Project root ============

/** File header of a saved project. */
export interface ProjectMeta {
  name: string;
  createdAt: string;
  modifiedAt: string;
  appVersion: string;
  /** Serialization format this file was written with. */
  dataVersion: number;
}

/** Root of the persisted document. */
export interface Project {
  meta: ProjectMeta;
  pattern: Pattern;
  fabrics: Record<string, Fabric>;
  avatar: Avatar;
  scene: SceneConfig;
}
