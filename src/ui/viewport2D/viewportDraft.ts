import type { Pattern, Print, Vec2 } from '@/model/types';
import { sampleEdge } from '@/pattern/panel';
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
      case 'start': return '2D 制版 · 缝合 · 单击 A 边的端点，确定缝纫方向（从该端缝向另一端）';
      case 'second': return '2D 制版 · 缝合 · 单击第二条边（B），再点它的端点确定方向 · Esc 取消';
      case 'startB': return '2D 制版 · 缝合 · 单击 B 边的端点，随即完成缝合 · Esc 取消';
      default: return '2D 制版 · 缝合 · 单击轮廓边取整条边，按住拖动可只取一段 · 点空白或 Esc 取消';
    }
  }
  return isSplitLayout(layout)
    ? `2D 制版 · 缩放 ${scale.toFixed(1)}x · 单击选片/拖点移动 · F适应 · 快捷键需点击聚焦本窗格`
    : `2D 制版 · 缩放 ${scale.toFixed(1)}x · 单击选片/Ctrl加选/空白拖框选 · 拖点、拖边或拖动版片（0.5cm吸附，Alt自由）· 右键输入长度角度或精确位移 · Delete删除/方向键微调 · 点工具：增加顶点单击轮廓边，删除顶点单击顶点（相邻点相连）· 滚轮定点缩放 · F或双击空白适应 · 中键或空格平移`;
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
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

/** Arc-length fraction of the nearest sample on an edge. */
export function arcFraction(pattern: Pattern, edgeId: string, p: Vec2): number {
  const pts = sampleEdge(pattern, edgeId);
  if (pts.length < 2) return 0;
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = acc[acc.length - 1] || 1;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - p.x, pts[i].y - p.y);
    if (d < bestD) { bestD = d; bestT = acc[i]! / total; }
  }
  return bestT;
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
