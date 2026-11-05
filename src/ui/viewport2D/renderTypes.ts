import type { Pattern, Vec2 } from '@/model/types';
import type { ViewTransform } from '@/ui/viewport2D/viewMath';
import type { PanelMeshSettings } from '@/pattern/panel';
import type { DraftState } from '@/ui/viewport2D/tools';
import type { SnapCandidate } from '@/ui/viewport2D/snap';
import type { HoverTarget, MarkHint } from '@/ui/viewport2D/hitTest';
import type { Pen } from '@/ui/viewport2D/pen';

/** Tolerance for treating two pattern points as the same position. */
export const NEAR = 1e-6;

/** In-flight drag shown without committing to the model. */
export interface PreviewDrag {
  /** Dry-run copy of the pattern with the drag translation already applied. */
  pattern: Pattern;
  /**
   * Height offsets of `pattern` when the drag already knows them, so a frame does not resample
   * every draped panel's outline to derive them again. Absent for drags that deform geometry.
   */
  offsets?: ReadonlyMap<string, number>;
  /** Snapped target marker, null when snapping is off. */
  ghost: Vec2 | null;
}

/** Layer switches for drafting-only visuals; toggles never rebuild geometry. */
export interface DisplayOptions {
  internal: boolean;
  darts: boolean;
  seamAllowance: boolean;
  notches: boolean;
  grain: boolean;
  annotations: boolean;
  measurements: boolean;
  gradingOverlay: boolean;
  /** Sewn-flat preview of the selected seams' end joints. */
  seamJoin: boolean;
  /** Print artwork rectangles. */
  prints: boolean;
  /** Topstitch rows. */
  topstitches: boolean;
  /** Trim symbols. */
  trims: boolean;
  /** Triangulated simulation mesh drawn over the cut pieces. */
  wireframe: boolean;
}

/** Pointer-driven visuals layered over the document. */
export interface InteractionState {
  /** Element a press would pick, drawn as a pre-highlight before the press. */
  hover?: HoverTarget | null;
  /** Landing point of the mark about to be placed, drawn as a ghost. */
  markHint?: MarkHint | null;
  /** The hovered vertex is about to be deleted, so its ring turns red. */
  hoverDelete?: boolean;
  preview: PreviewDrag | null;
  /** Rubber-band box in world coordinates. */
  rect: { a: Vec2; b: Vec2 } | null;
  /** In-progress tool stroke drawn as a preview layer. */
  draft?: DraftState;
  /** Active snap marker highlighted under the cursor. */
  snapHint?: SnapCandidate | null;
  /** Where the point tool would insert a vertex, drawn as a marker on the edge. */
  insertHint?: { pos: Vec2; edgeId: string } | null;
  /** Edge under the cursor while the seam tool is armed, drawn as the side about to be picked. */
  seamHover?: { edgeId: string; t0: number; t1: number } | null;
}

/** Document, view and display inputs of one 2D frame, plus its interaction layer. */
export interface SceneState extends InteractionState {
  pattern: Pattern;
  /**
   * Pattern the shared mesh cache keys on, in its own coordinates; the wireframe layer shifts what
   * it returns by the panel's height offset. Defaults to `pattern`.
   */
  meshPattern?: Pattern;
  /** Centimeters each panel is raised from its pattern y to its world height. */
  offsets?: ReadonlyMap<string, number>;
  view: ViewTransform;
  /** Scene settings the shared panel mesh cache keys on; identical to what the 3D engine reads. */
  simulation: PanelMeshSettings;
  selection: string[];
  /** Seam marks only appear while the seam tool is active or a seam is selected. */
  showSeams: boolean;
  display?: DisplayOptions;
  /** Extra size-chart patterns drawn faintly behind the active one. */
  gradingOutlines?: Array<{ label: string; polygons: Vec2[][] }>;
  /** Called once a print image finishes decoding; the pane repaints to drop the placeholder. */
  onPrintImageReady?: () => void;
}

/** One named pass of a 2D frame, ordered by its position in DRAW_LAYERS. */
export interface DrawLayer {
  readonly id: string;
  /** Absent means the layer draws on every frame. */
  when?: (state: SceneState, display: DisplayOptions) => boolean;
  draw(pen: Pen, state: SceneState, display: DisplayOptions): void;
}
