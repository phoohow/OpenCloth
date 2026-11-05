/**
 * The 2D pattern: points, edges, panels, darts, construction lines and the production
 * markings placed on them. Everything here lives in pattern-plane centimetres.
 */

import type { ArcGeom, BezierHandle, ObjectTransform, Vec2, Vec3 } from '@/model/types/geometry';

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

/** How a point joins its two edges. */
export type PointKind = 'corner' | 'smooth';

/** How an edge runs between its two points. */
export type EdgeType = 'line' | 'bezier' | 'arc';

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
 * Drape: how a flat panel wraps the body in the pre-simulation placement. A panel
 * without one stays flat at its pattern coordinates.
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
}

/** Construction layer a panel belongs to, from the body outward. */
export type GarmentLayer = 'lining' | 'padding' | 'shell';

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
  /** Construction layer of the piece; absent means no per-piece layer override. */
  layer?: GarmentLayer;
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
