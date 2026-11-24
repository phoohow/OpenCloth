import type { Pattern, Vec2 } from '@/model/types';
import type { PanelMeshSettings } from '@/scene';
import type { BodyGuideGeometry } from '@/ui/viewport2D/drawBodyGuide';
import type { HoverTarget, MarkHint } from '@/ui/viewport2D/hitTest';
import type { Pen } from '@/ui/viewport2D/pen';
import type { AxisLock, InsertTarget, SnapCandidate } from '@/ui/viewport2D/snap';
import type { DraftState } from '@/ui/viewport2D/tools';
import type { ViewTransform } from '@/ui/viewport2D/viewMath';

export const NEAR = 1e-6;

export interface PreviewDrag {
  pattern: Pattern;
  offsets?: ReadonlyMap<string, number>;
  ghost: Vec2 | null;
}

export interface DisplayOptions {
  bodyGuide: boolean;
  internal: boolean;
  darts: boolean;
  seamAllowance: boolean;
  notches: boolean;
  grain: boolean;
  annotations: boolean;
  measurements: boolean;
  gradingOverlay: boolean;
  seamJoin: boolean;
  prints: boolean;
  topstitches: boolean;
  trims: boolean;
  wireframe: boolean;
}

export interface InteractionState {
  hover?: HoverTarget | null;
  markHint?: MarkHint | null;
  dropHint?: { pos: Vec2; radiusCm: number } | null;
  hoverDelete?: boolean;
  preview: PreviewDrag | null;
  rect: { a: Vec2; b: Vec2 } | null;
  draft?: DraftState;
  snapHint?: SnapCandidate | null;
  insertHint?: InsertTarget | null;
  axisHint?: AxisLock | null;
  seamHover?: { edgeId: string; t0: number; t1: number } | null;
}

export interface SceneState extends InteractionState {
  pattern: Pattern;
  meshPattern?: Pattern;
  offsets?: ReadonlyMap<string, number>;
  view: ViewTransform;
  simulation: PanelMeshSettings;
  selection: string[];
  showSeams: boolean;
  display?: DisplayOptions;
  gradingOutlines?: Array<{ label: string; polygons: Vec2[][] }>;
  bodyGuide?: BodyGuideGeometry;
  onPrintImageReady?: () => void;
}

export interface DrawLayer {
  readonly id: string;
  when?: (state: SceneState, display: DisplayOptions) => boolean;
  draw(pen: Pen, state: SceneState, display: DisplayOptions): void;
}
