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
  /** Custom display name overriding the generic row label. */
  name?: string;
  pos: Vec2;
  /** Helper point used to build geometry; not part of a cut outline. */
  construction?: boolean;
  /** Curve join style; 'corner' breaks tangency between its edges. */
  kind?: PointKind;
  /** Control point of the curve reaching this point, in absolute coordinates. */
  handleIn?: BezierHandle;
  /** Control point of the curve leaving this point, in absolute coordinates. */
  handleOut?: BezierHandle;
  /** Per-size grading offsets in cm from the base geometry, keyed by size id. */
  grading?: Record<string, Vec2>;
}

/** Point where a curve leaves or reaches a pattern point, in absolute pattern coordinates. */
export interface BezierHandle {
  x: number;
  y: number;
  /** False when the opposite handle stays independent while dragging. */
  mirrored?: boolean;
}

/** How a point joins its two edges. */
export type PointKind = 'corner' | 'smooth';

/** How an edge runs between its two points. */
export type EdgeType = 'line' | 'bezier' | 'arc';

/** Circular arc between the edge endpoints, sampled at the bezier tolerance. */
export interface ArcGeom {
  center: Vec2;
  radius: number;
  /** Start and end angle in radians, measured at the center. */
  startAngle: number;
  endAngle: number;
  /** True sweeps counter-clockwise from start to end. */
  ccw: boolean;
}

/** Role an edge plays on the finished garment. */
export type EdgeSemantic =
  | 'hem' | 'neckline' | 'armhole' | 'sideSeam'
  | 'shoulder' | 'sleeveCap' | 'waist' | 'dart' | 'internal' | 'free';

/** How two edges meet at a shared vertex of the offset seam allowance. */
export type SeamAllowanceCorner = 'miter' | 'round' | 'bevel';

/** One edge of the pattern, shared by the outlines and seams that reference it. */
export interface PatternEdge {
  id: string;
  /** Custom display name overriding the semantic or type label. */
  name?: string;
  type: EdgeType;
  startPointId: string;
  endPointId: string;
  /** Present when type is 'arc'. */
  arc?: ArcGeom;
  semantic?: EdgeSemantic;
  /** Seam allowance overriding the panel default, in cm. */
  seamAllowanceCm?: number;
  /** Join shape at this edge's end when the allowance is offset. */
  cornerStyle?: SeamAllowanceCorner;
}

/** Wedge of fabric removed between two edges meeting at a tip. */
export interface Dart {
  id: string;
  /** Custom display name overriding the generic row label. */
  name?: string;
  tipId: string;
  edge1Id: string;
  edge2Id: string;
  /** Fabric width the dart takes out, in centimeters. */
  intakeCm: number;
  /**
   * True while the solver stitches the two legs together (收省). The flag lives on the record, so
   * it survives grading and size changes; the leg constraints are rebuilt from the pattern each time
   * the constraint signature changes.
   */
  closing?: boolean;
}

/** Line drawn inside a panel outline rather than on its edge. */
export interface InternalLine {
  id: string;
  /** Custom display name overriding the generic row label. */
  name?: string;
  points: Vec2[];
  /** `fold` stiffens the mesh edges it crosses into a crease, `split` cuts the panel, `decor` only draws. */
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
  /** Closed loops cut out of the panel; each lists edge ids in winding order. */
  holes?: string[][];
  /** Seam allowance added around the outline, in centimeters. */
  seamAllowanceCm: number;
  fabricId: string;
  /** Cloth edge length this panel is meshed at, in centimeters. */
  meshResolutionCm: number;
  placement?: PanelPlacement;
  /** Offsets the panel's built pose around its own centre; absent leaves it as built. */
  transform?: ObjectTransform;
  drape?: PanelDrape;
  /** Grain line direction in degrees, counter-clockwise from pattern X+. */
  grainAngleDeg?: number;
  /** Grain line midpoint as an offset from the outline bounding-box centre, in cm. */
  grainOffset?: Vec2;
  /** Grain line total length in cm; absent uses 60% of the shorter outline side. */
  grainLengthCm?: number;
  /** Symmetry link: edits to `linkedPanelId` mirror across `axisEdgeId` onto this panel. */
  symmetry?: { axisEdgeId: string; linkedPanelId: string };
  /** Panels that move and edit together. */
  groupId?: string;
  /** Cloth collision layer, 0 is the innermost; outer layers stay this many steps further apart. */
  collisionLayer?: number;
  visible: boolean;
  locked: boolean;
}

// ============ Production markings ============

/** V-notch or drill mark placed along an edge. */
export interface Notch {
  id: string;
  /** Custom display name overriding the generic row label. */
  name?: string;
  edgeId: string;
  /** Arc-length fraction along the edge where the notch sits. */
  t: number;
  /** Notch width in millimetres. */
  widthMm?: number;
  style?: 'v' | 't' | 'drill';
}

/** Text note placed on a panel or beside an edge. */
export interface Annotation {
  id: string;
  /** Custom row name; the note text remains the canvas content. */
  name?: string;
  panelId: string;
  text: string;
  pos: Vec2;
  angleDeg?: number;
  /** Font height in millimetres. */
  sizeMm?: number;
}

/** Reference objects a measurement runs between; length is derived, never stored. */
export interface MeasurementRefs {
  pointAId?: string;
  pointBId?: string;
  edgeId?: string;
}

/** A dimension line shown in the editor and exports. */
export interface Measurement {
  id: string;
  /** Custom display name overriding the generic row label. */
  name?: string;
  panelId: string;
  kind: 'distance' | 'edgeLength' | 'angle';
  refs: MeasurementRefs;
}

/** Image artwork placed on a panel and composited into its 3D base colour. */
export interface Print {
  id: string;
  /** Custom display name overriding the generic row label. */
  name?: string;
  panelId: string;
  /** Data URL of the artwork, stored inside the project file. */
  imageUrl: string;
  /** File name shown in the outliner and the bill of materials. */
  imageName?: string;
  /** Rectangle centre relative to the panel outline bounding-box centre, in cm. */
  center: Vec2;
  widthCm: number;
  heightCm: number;
  /** Rotation about the centre, counter-clockwise, in degrees. */
  angleDeg: number;
  /** Blend strength over the fabric colour, 0..1. */
  opacity: number;
  /** Tile counts across width and height; 1 does not tile. */
  repeat: Vec2;
  visible: boolean;
}

/** Decorative stitch line offset inward from a panel edge. */
export interface Topstitch {
  id: string;
  /** Custom display name overriding the generic row label. */
  name?: string;
  panelId: string;
  edgeId: string;
  /** Interval bounds as arc-length fractions along the edge. */
  t0: number;
  t1: number;
  /** Distance from the edge line toward the panel inside, in millimetres. */
  offsetMm: number;
  /** Distance between rows, in millimetres. */
  spacingMm: number;
  /** Number of parallel rows, 1..5. */
  rows: number;
  color: string;
  /** Stitch length and gap of the drawn dash pattern, in millimetres. */
  stitchMm: number;
  gapMm: number;
  visible: boolean;
}

/** Sewing trim kinds recorded on a panel. */
export type TrimKind = 'button' | 'eyelet' | 'rivet' | 'snap';

/** One trim mark with its production count. */
export interface Trim {
  id: string;
  /** Custom display name overriding the generic row label. */
  name?: string;
  panelId: string;
  kind: TrimKind;
  /** Centre in absolute pattern coordinates, in cm. */
  pos: Vec2;
  /** Diameter in millimetres. */
  sizeMm: number;
  color: string;
  /** Pieces this mark stands for; the bill of materials multiplies by it. */
  qty: number;
  /** Unit price, used by the bill of materials when present. */
  unitPrice?: number;
  visible: boolean;
}

// ============ Seams ============

/** How the two edges of a seam are joined. */
export type SeamType = 'normal' | 'gather' | 'free';

/** One side of a seam: an interval of a single edge, with an optional matching point. */
export interface SeamEnd {
  edgeId: string;
  /** Interval bounds as arc-length fractions along the edge. */
  t0: number;
  t1: number;
  /** Anchor (对位点) position inside the interval; anchors pair with anchors. */
  anchorT?: number;
}

/** Pair of pattern edge intervals stitched together. */
export interface Seam {
  id: string;
  /** Custom display name overriding the joined panel names. */
  name?: string;
  type: SeamType;
  a: SeamEnd;
  b: SeamEnd;
  /** Reverses edge B's vertex order before the two sides are paired. */
  flip: boolean;
  /** Shortened-to-length ratio for gather seams; absent means 1. */
  gatherRatio?: number;
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
  notches: Record<string, Notch>;
  annotations: Record<string, Annotation>;
  measurements: Record<string, Measurement>;
  prints: Record<string, Print>;
  topstitches: Record<string, Topstitch>;
  trims: Record<string, Trim>;
}

// ============ Fabric ============

/** Built-in fabric presets a new material starts from. */
export type FabricPresetKey = 'cotton' | 'silk' | 'denim' | 'knit';

/** Image slot of a fabric's material maps. */
export type FabricMapSlot = 'albedo' | 'normal' | 'roughness' | 'metallic';

/** Image references of the material maps; null clears a slot. */
export interface FabricMaps {
  albedo?: string | null;
  normal?: string | null;
  roughness?: string | null;
  metallic?: string | null;
  /** File names shown beside the slots; a slot without one has no display name. */
  fileNames?: Partial<Record<FabricMapSlot, string>>;
}

/** How a fabric looks in the viewport and in exports. */
export interface FabricAppearance {
  baseColor: string;
  metallic: number;
  roughness: number;
  normalScale: number;
  sheenColor: string;
  sheenIntensity: number;
  /** Light passing through the fabric, 0..1. */
  transmission: number;
  /** Thickness used by transmission, in millimetres. */
  thickness: number;
  /** Clear coat layer strength, 0..1. */
  clearcoat: number;
  /** Clear coat roughness, 0..1. */
  clearcoatRoughness: number;
  /** Stretched-highlight strength for satin and brushed surfaces, 0..1. */
  anisotropy: number;
  /** Thin-film iridescence strength, 0..1. */
  iridescence: number;
  /** Sheen highlight spread, 0..1. */
  sheenRoughness: number;
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
  /**
   * Bending stiffness of the creases a panel's fold lines produce, 0..1; absent uses
   * `DEFAULT_CREASE_STIFFNESS`. Never softer than the fabric's own bending stiffness.
   */
  creaseStiffness?: number;
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
  /** Outward leg splay from vertical, in radians; default 0. */
  poseLegSpreadRad?: number;
  /** Lateral torso lean from vertical, in radians; default 0. */
  poseTorsoLeanRad?: number;
}

/** The body the garment dresses. */
export interface Avatar {
  id: string;
  /** Display name of the body in the outliner; absent means the model name. */
  name?: string;
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

/** Scene lighting from the project's lights plus an environment image. */
export interface LightConfig {
  /** Punctual lights, in outliner order. */
  lights: SceneLight[];
  /** Outliner display name of the environment light; the image name stays in `iblName`. */
  iblLabel?: string;
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

/** 3D fidelity the cloth follows an in-flight 2D edit with. */
export type EditPreviewTier = 'off' | 'low' | 'full';

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
  /** Cloth thickness in cm; the minimum clearance against the body and the floor. */
  clothThicknessCm?: number;
  /** CPU self-collision pass after each readback; absent or false skips it entirely. */
  selfCollision?: boolean;
  /** Extra separation per collision-layer step, in cm. */
  layerSpacingCm?: number;
  /** Seam constraints tear once stretched past their strength-derived limit; absent or false never tears. */
  seamTearing?: boolean;
}

/** Persisted descriptor of an imported reference object. */
export interface ReferenceObjectRef {
  id: string;
  name: string;
  /** Blob key in the local object store; absent when the file is no longer available. */
  objectKey?: string;
  /** Embedded model data URL written on save; takes precedence over `objectKey`. */
  objectUrl?: string;
  visible: boolean;
  opacity: number;
  /** Scene placement; absent means the identity transform. */
  transform?: ObjectTransform;
}

/** Saved viewport camera placement: orbit target, eye position and lens framing. */
export interface CameraConfig {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view in degrees; meaningful while the projection is perspective. */
  fovDeg: number;
  projection: CameraProjection;
  /** World height the orthographic frustum spans in meters; meaningful while orthographic. */
  viewHeightMeters: number;
}

/** Everything around the garment: lighting, rendering, solving and reference objects. */
export interface SceneConfig {
  lights: LightConfig;
  render: RenderConfig;
  simulation: SimulationConfig;
  referenceObjects?: ReferenceObjectRef[];
  /** Saved camera placement, restored when the project opens. */
  camera?: CameraConfig;
  /** Outliner display name of the viewport camera. */
  cameraName?: string;
}

// ============ Sizes ============

/** One entry of the project size chart. */
export interface SizeDef {
  id: string;
  /** Display label, e.g. M. */
  label: string;
  /** Ordered index; grading steps follow this order. */
  seq: number;
  /** True on the size whose geometry the pattern stores directly. */
  isBase?: boolean;
}

// ============ Project root ============

/** File header of a saved project. */
export interface ProjectMeta {
  name: string;
  createdAt: string;
  modifiedAt: string;
}

/** Root of the persisted document. */
export interface Project {
  meta: ProjectMeta;
  pattern: Pattern;
  fabrics: Record<string, Fabric>;
  avatar: Avatar;
  scene: SceneConfig;
  /** Size chart; absent means a single unsized pattern. */
  sizes?: SizeDef[];
  /** Size the pattern geometry is currently resolved to. */
  activeSizeId?: string;
}
