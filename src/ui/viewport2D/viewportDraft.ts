import type { MoveGeometry } from '@/commands';
import type { Pattern, Print, Vec2 } from '@/model/types';

import { distance2 } from '@/base/math';
import { edgeTForPoint } from '@/pattern/geom';
import { sampleEdge } from '@/pattern/panel';
import { isSplitLayout, type ToolType, type ViewLayout } from '@/store';

export const HIT_RADIUS_PX = 8;

export const MIDPOINT_SNAP_PX = 12;

export const AXIS_SNAP_PX = 8;

export const SEAM_DRAG_MIN_T = 0.02;

export const CURSOR_TOOLS = new Set<ToolType>(['line', 'curve', 'internalLine', 'split', 'hole', 'dart', 'measure']);

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

export type SeamStep = 'pick' | 'start' | 'second' | 'startB';

export const statusHint = (layout: ViewLayout, scale: number, tool: ToolType, seamStep: SeamStep): string => {
  if (tool === 'seam') {
    switch (seamStep) {
      case 'start': return '2D 制版 · 缝合 · 点 A 边端点定方向';
      case 'second': return '2D 制版 · 缝合 · 点第二边与端点 · Esc 取消';
      case 'startB': return '2D 制版 · 缝合 · 点 B 边端点完成 · Esc 取消';
      default: return '2D 制版 · 缝合 · 单击轮廓边 · 拖动取一段 · Esc 取消';
    }
  }

  if (tool === 'point') {
    return '2D 制版 · 增加顶点 · 单击轮廓边 · 移到中点自动吸附';
  }

  if (tool === 'line' || tool === 'curve') {
    return '2D 制版 · 单击落点 · 靠近水平/垂直自动对齐 · Shift 45° · Enter 闭合';
  }

  return isSplitLayout(layout)
    ? `2D 制版 · 缩放 ${scale.toFixed(1)}x · 单击选片 · 拖点移动 · F 适应`
    : `2D 制版 · 缩放 ${scale.toFixed(1)}x · 单击选片 · Ctrl 加选 · 拖框选（0.5cm 吸附）· 滚轮缩放 · 空格平移`;
};

export function previewNotch(pattern: Pattern, notchId: string, t: number): Pattern {
  const notch = pattern.notches?.[notchId];
  if (!notch) return pattern;
  return { ...pattern, notches: { ...pattern.notches, [notchId]: { ...notch, t } } };
}

export function previewPrint(pattern: Pattern, printId: string, patch: Partial<Print>): Pattern {
  const print = pattern.prints?.[printId];
  if (!print) return pattern;
  return { ...pattern, prints: { ...pattern.prints, [printId]: { ...print, ...patch } } };
}

export function previewTrim(pattern: Pattern, trimId: string, pos: Vec2): Pattern {
  const trim = pattern.trims?.[trimId];
  if (!trim) return pattern;
  return { ...pattern, trims: { ...pattern.trims, [trimId]: { ...trim, pos } } };
}

export function panelOwner(pattern: Pattern, edgeId: string): string | null {
  for (const panel of Object.values(pattern.panels)) {
    if (panel.outlineEdgeIds.includes(edgeId)) return panel.id;
  }

  return null;
}

export function nearestOnEdge(pattern: Pattern, edgeId: string, p: Vec2): Vec2 {
  let best = p;
  let bestD = Infinity;
  for (const q of sampleEdge(pattern, edgeId)) {
    const d = distance2(q, p);
    if (d < bestD) { bestD = d; best = q; }
  }

  return best;
}

export function arcFraction(pattern: Pattern, edgeId: string, p: Vec2): number {
  return edgeTForPoint(pattern, edgeId, p);
}

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
