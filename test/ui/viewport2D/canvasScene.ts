import { vec2, type Pattern, type Vec2 } from '../../../src/core/model/types';
import { createEmptyPattern } from '../../../src/core/model/defaults';
import { drawScene, type DisplayOptions, type SceneState } from '../../../src/ui/viewport2D/render';
import { toScreen, type ViewTransform } from '../../../src/ui/viewport2D/viewMath';

/** Canvas pixel mapping shared by the expected and recorded geometry. */
export const WIDTH = 400;
export const HEIGHT = 300;
export const VIEW: ViewTransform = { offsetX: 0, offsetY: 0, scale: 10 };

export const DISPLAY: DisplayOptions = {
  internal: true, darts: false, seamAllowance: false, notches: false, grain: false,
  annotations: false, measurements: false, gradingOverlay: false, seamJoin: false,
  prints: false, topstitches: false, trims: false, wireframe: false,
};

/** One stroke as it left the mock context. */
export interface Stroke {
  style: string;
  width: number;
  dash: number[];
  points: Vec2[];
}

/** One fill as it left the mock context, with the last arc center when there was one. */
export interface Fill {
  style: string;
  at: Vec2 | null;
}

/** A frame's recorded strokes and fills. */
export interface Frame {
  strokes: Stroke[];
  fills: Fill[];
}

/** Captures stroke and fill calls without a browser canvas. */
function recordingContext(): { ctx: CanvasRenderingContext2D; strokes: Stroke[]; fills: Fill[] } {
  const state: Record<string, unknown> = {
    strokeStyle: '#000', fillStyle: '#000', lineWidth: 1, font: '', textAlign: '',
    textBaseline: '', globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  const stack: Array<{ styles: Record<string, unknown>; dash: number[] }> = [];
  let dash: number[] = [];
  let path: Vec2[] = [];
  let arcAt: Vec2 | null = null;
  const strokes: Stroke[] = [];
  const fills: Fill[] = [];

  const methods: Record<string, unknown> = {
    save: () => stack.push({ styles: { ...state }, dash: [...dash] }),
    restore: () => {
      const saved = stack.pop();
      if (!saved) return;
      Object.assign(state, saved.styles);
      dash = saved.dash;
    },
    beginPath: () => { path = []; },
    moveTo: (x: number, y: number) => { path.push({ x, y }); },
    lineTo: (x: number, y: number) => { path.push({ x, y }); },
    closePath: () => {},
    arc: (x: number, y: number) => { arcAt = { x, y }; path.push({ x, y }); },
    fill: () => fills.push({ style: String(state.fillStyle), at: arcAt }),
    stroke: () => strokes.push({
      style: String(state.strokeStyle), width: Number(state.lineWidth),
      dash: [...dash], points: [...path],
    }),
    setLineDash: (next: number[]) => { dash = [...next]; },
    measureText: () => ({ width: 0 }),
  };

  const ctx = new Proxy(state, {
    get: (target, key: string) => key in methods ? methods[key] : key in target ? target[key] : () => undefined,
    set: (target, key: string, value) => { target[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, strokes, fills };
}

/** Square panel with two internal lines, one fold and one split. */
export function patternWithLines(): Pattern {
  const pattern = createEmptyPattern();
  const corners = [vec2(0, 0), vec2(20, 0), vec2(20, 20), vec2(0, 20)];
  const edgeIds = corners.map((corner, i) => {
    const pointId = `p${i}`;
    const edgeId = `e${i}`;
    pattern.points[pointId] = { id: pointId, pos: corner };
    pattern.edges[edgeId] = {
      id: edgeId, type: 'line', startPointId: pointId, endPointId: `p${(i + 1) % corners.length}`,
    };
    return edgeId;
  });
  pattern.panels.panel = {
    id: 'panel', name: 'panel', outlineEdgeIds: edgeIds, dartIds: [], internalLineIds: ['fold', 'split'],
    seamAllowanceCm: 0, fabricId: 'f', meshResolutionCm: 3, visible: true, locked: false,
  };
  pattern.internalLines.fold = {
    id: 'fold', kind: 'fold', points: [vec2(2, 2), vec2(10, 10), vec2(18, 2)],
  };
  pattern.internalLines.split = {
    id: 'split', kind: 'split', points: [vec2(4, 15), vec2(16, 15)],
  };
  return pattern;
}

/** Draws one frame with the given scene overrides and returns its recorded calls. */
export function drawFrame(overrides: Partial<SceneState> = {}): Frame {
  const { ctx, strokes, fills } = recordingContext();
  const scene: SceneState = {
    pattern: patternWithLines(), view: VIEW, simulation: {}, selection: [],
    hover: null, preview: null, rect: null, showSeams: false, display: DISPLAY,
    ...overrides,
  };
  drawScene(ctx, WIDTH, HEIGHT, scene);
  return { strokes, fills };
}

export const screenPoints = (points: Vec2[]): Vec2[] => points.map(p => toScreen(p, VIEW, WIDTH, HEIGHT));

/** Whether two polylines hold the same points in the same order. */
export const samePath = (a: Vec2[], b: Vec2[]): boolean =>
  a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i]!.x) < 1e-6 && Math.abs(p.y - b[i]!.y) < 1e-6);
