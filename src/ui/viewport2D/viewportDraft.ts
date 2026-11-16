import type { Pattern, Print, Vec2 } from '@/model/types';
import { sampleEdge } from '@/pattern/panel';
import { edgeTForPoint } from '@/pattern/geom';
import { distance2 } from '@/base/math';
import { isSplitLayout, type ToolType, type ViewLayout } from '@/store';
import type { MoveGeometry } from '@/commands';

/** What a pointer drag translates: whole panels, outline points, or internal-line vertices. */
export type MoveTarget =
  | { kind: 'panels'; panelIds: string[] }
  | { kind: 'points'; pointIds: string[] }
  | { kind: 'internalVertex'; lineId: string; indices: number[] };

export type Drag =
  | { kind: 'pan'; startX: number; startY: number; ox: number; oy: number }
  | { kind: 'move'; target: MoveTarget; geom: MoveGeometry; anchor: Vec2; startWorld: Vec2; offset: Vec2 | null }
  | { kind: 'handle'; pointId: string; which: 'in' | 'out'; target: Vec2 }
  | { kind: 'shape'; shape: 'rect' | 'circle' | 'ellipse'; start: Vec2; current: Vec2 }
  | { kind: 'seamdrag'; edgeId: string; start: Vec2; current: Vec2 }
  | { kind: 'notch'; notchId: string; edgeId: string; t: number }
  | { kind: 'printmove'; printId: string; startCenter: Vec2; startWorld: Vec2; center: Vec2 }
  | { kind: 'printresize'; printId: string; size: { widthCm: number; heightCm: number } }
  | { kind: 'trimmove'; trimId: string; startPos: Vec2; startWorld: Vec2; pos: Vec2 }
  | { kind: 'rect'; startWorld: Vec2 };

export const HIT_RADIUS_PX = 8;
export const SNAP_RADIUS_PX = 8;

/** Sweep below this fraction of an edge counts as a click, so the whole edge is taken. */
export const SEAM_DRAG_MIN_T = 0.02;

/** Text a newly placed annotation carries before the user edits it. */
export const DEFAULT_ANNOTATION_TEXT = '标注';

/** Drafting tools whose rubber-band preview follows the cursor. */
export const CURSOR_TOOLS = new Set<ToolType>(['line', 'curve', 'internalLine', 'split', 'hole', 'dart', 'measure']);

/** Step the seam tool is on, so the hint can name the next click. */
export type SeamStep = 'pick' | 'start' | 'second' | 'startB';

/** Zoom readout with the gestures the current layout allows. */
export const statusHint = (layout: ViewLayout, scale: number, tool: ToolType, seamStep: SeamStep): string => {
  if (tool === 'seam') {
    switch (seamStep) {
      case 'start': return '2D 制版 · 缝合 · 点 A 边端点定方向';
      case 'second': return '2D 制版 · 缝合 · 点第二边与端点 · Esc 取消';
      case 'startB': return '2D 制版 · 缝合 · 点 B 边端点完成 · Esc 取消';
      default: return '2D 制版 · 缝合 · 单击轮廓边 · 拖动取一段 · Esc 取消';
    }
  }
  return isSplitLayout(layout)
    ? `2D 制版 · 缩放 ${scale.toFixed(1)}x · 单击选片 · 拖点移动 · F 适应`
    : `2D 制版 · 缩放 ${scale.toFixed(1)}x · 单击选片 · Ctrl 加选 · 拖框选（0.5cm 吸附）· 滚轮缩放 · 空格平移`;
};

/** Pattern copy with one notch slid along its edge, for the drag preview. */
export function previewNotch(pattern: Pattern, notchId: string, t: number): Pattern {
  const notch = pattern.notches?.[notchId];
  if (!notch) return pattern;
  return { ...pattern, notches: { ...pattern.notches, [notchId]: { ...notch, t } } };
}

/** Pattern copy with one print's placement replaced, for the drag preview. */
export function previewPrint(pattern: Pattern, printId: string, patch: Partial<Print>): Pattern {
  const print = pattern.prints?.[printId];
  if (!print) return pattern;
  return { ...pattern, prints: { ...pattern.prints, [printId]: { ...print, ...patch } } };
}

/** Pattern copy with one trim moved, for the drag preview. */
export function previewTrim(pattern: Pattern, trimId: string, pos: Vec2): Pattern {
  const trim = pattern.trims?.[trimId];
  if (!trim) return pattern;
  return { ...pattern, trims: { ...pattern.trims, [trimId]: { ...trim, pos } } };
}

/** Panel owning an outline edge. */
export function panelOwner(pattern: Pattern, edgeId: string): string | null {
  for (const panel of Object.values(pattern.panels)) {
    if (panel.outlineEdgeIds.includes(edgeId)) return panel.id;
  }
  return null;
}

/** Nearest point on an edge's sampled polyline. */
export function nearestOnEdge(pattern: Pattern, edgeId: string, p: Vec2): Vec2 {
  let best = p;
  let bestD = Infinity;
  for (const q of sampleEdge(pattern, edgeId)) {
    const d = distance2(q, p);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

/** Arc-length fraction of the nearest sample on an edge. */
export function arcFraction(pattern: Pattern, edgeId: string, p: Vec2): number {
  return edgeTForPoint(pattern, edgeId, p);
}

/** Dry-run pattern copy with one handle replaced; smooth points mirror their pair. */
export function withHandle(pattern: Pattern, pointId: string, which: 'in' | 'out', handle: Vec2): Pattern {
  const copy = structuredClone(pattern);
  const point = copy.points[pointId];
  if (!point) return copy;
  point.kind = point.kind ?? 'smooth';
  if (which === 'in') point.handleIn = { ...handle };
  else point.handleOut = { ...handle };
  if (point.kind === 'smooth') {
    const mirrored = { x: 2 * point.pos.x - handle.x, y: 2 * point.pos.y - handle.y };
    if (which === 'in') point.handleOut = { ...mirrored };
    else point.handleIn = { ...mirrored };
  }
  return copy;
}
