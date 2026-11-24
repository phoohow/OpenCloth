import type { CornerJoinStyle } from '@/base/geom';
import type { ArcGeom, BezierHandle, ObjectTransform, Vec2, Vec3 } from '@/model/types/geometry';

export interface PatternPoint {
  id: string;
  name?: string;
  pos: Vec2;
  construction?: boolean;
  kind?: PointKind;
  handleIn?: BezierHandle;
  handleOut?: BezierHandle;
  grading?: Record<string, Vec2>;
}

export type PointKind = 'corner' | 'smooth';

export type EdgeType = 'line' | 'bezier' | 'arc';

export type EdgeSemantic =
  | 'hem' | 'neckline' | 'armhole' | 'sideSeam'
  | 'shoulder' | 'sleeveCap' | 'waist' | 'dart' | 'internal' | 'free';

export type SeamAllowanceCorner = CornerJoinStyle;

export interface PatternEdge {
  id: string;
  name?: string;
  type: EdgeType;
  startPointId: string;
  endPointId: string;
  arc?: ArcGeom;
  semantic?: EdgeSemantic;
  seamAllowanceCm?: number;
  cornerStyle?: SeamAllowanceCorner;
}

export interface Dart {
  id: string;
  name?: string;
  tipId: string;
  edge1Id: string;
  edge2Id: string;
  intakeCm: number;
  closing?: boolean;
}

export interface InternalLine {
  id: string;
  name?: string;
  points: Vec2[];
  kind: 'fold' | 'decor' | 'split';
}

export interface PanelPlacement {
  position: Vec3;
  rotationEuler: Vec3;
}

export type BodyLandmark =
  | 'neckTop' | 'shoulderTop' | 'shoulderCap' | 'shoulder' | 'bust' | 'waist'
  | 'hip' | 'crotch' | 'knee' | 'ankle';

export type WrapZone = 'front' | 'back' | 'left' | 'right' | 'full';

export interface PanelDrape {
  region: 'torso' | 'arm' | 'leg' | 'neck' | 'head';
  zone?: WrapZone;
  flip?: boolean;
  anchor?: BodyLandmark;
  anchorOffsetCm?: number;
  side?: 'left' | 'right';
  easeCm?: number;
}

export type GarmentLayer = 'lining' | 'padding' | 'shell';

export interface Panel {
  id: string;
  name: string;
  outlineEdgeIds: string[];
  dartIds: string[];
  internalLineIds: string[];
  holes?: string[][];
  seamAllowanceCm: number;
  fabricId: string;
  placement?: PanelPlacement;
  transform?: ObjectTransform;
  drape?: PanelDrape;
  sheetLiftCm?: number;
  grainAngleDeg?: number;
  grainOffset?: Vec2;
  grainLengthCm?: number;
  symmetry?: { axisEdgeId: string; linkedPanelId: string };
  groupId?: string;
  layer?: GarmentLayer;
  collisionLayer?: number;
  visible: boolean;
  locked: boolean;
}

export interface Notch {
  id: string;
  name?: string;
  edgeId: string;
  t: number;
  widthMm?: number;
  style?: 'v' | 't' | 'drill';
}

export interface Annotation {
  id: string;
  name?: string;
  panelId: string;
  text: string;
  pos: Vec2;
  angleDeg?: number;
  sizeMm?: number;
}

export interface MeasurementRefs {
  pointAId?: string;
  pointBId?: string;
  edgeId?: string;
}

export interface Measurement {
  id: string;
  name?: string;
  panelId: string;
  kind: 'distance' | 'edgeLength' | 'angle';
  refs: MeasurementRefs;
}

export interface Print {
  id: string;
  name?: string;
  panelId: string;
  imageUrl: string;
  imageName?: string;
  imageSize?: Vec2;
  sourceSize?: Vec2;
  center: Vec2;
  widthCm: number;
  heightCm: number;
  lockAspect?: boolean;
  angleDeg: number;
  opacity: number;
  repeat: Vec2;
  visible: boolean;
}

export interface Topstitch {
  id: string;
  name?: string;
  panelId: string;
  edgeId: string;
  t0: number;
  t1: number;
  offsetMm: number;
  spacingMm: number;
  rows: number;
  color: string;
  stitchMm: number;
  gapMm: number;
  visible: boolean;
}

export type TrimKind = 'button' | 'eyelet' | 'rivet' | 'snap';

export interface Trim {
  id: string;
  name?: string;
  panelId: string;
  kind: TrimKind;
  pos: Vec2;
  sizeMm: number;
  color: string;
  qty: number;
  unitPrice?: number;
  visible: boolean;
}

export type SeamType = 'normal' | 'gather' | 'free';

export interface SeamEnd {
  edgeId: string;
  t0: number;
  t1: number;
  anchorT?: number;
}

export interface Seam {
  id: string;
  name?: string;
  type: SeamType;
  a: SeamEnd;
  b: SeamEnd;
  flip: boolean;
  gatherRatio?: number;
  strength: number;
  threadColor: string;
  stitchVisible: boolean;
}

export interface Pattern {
  templateKey?: string;
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
