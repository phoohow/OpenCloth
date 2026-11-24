import type { Vec2 } from '@/model/types';
import type { HoverTarget, PressRole, Rect } from '@/ui/viewport2D/hitTest';
import type { PreviewDrag } from '@/ui/viewport2D/renderTypes';
import type * as React from 'react';

import {
  AddPointOnEdgeCommand, AddTopstitchCommand, AddTrimCommand, DeleteElementsCommand,
  UpdatePrintCommand, UpdateTrimCommand, edgePointIds, previewMove, previewPanelMove,
  type MoveGeometry, CreateRectCommand, CreateCircleCommand, CreateEllipseCommand,
  CreateDartCommand, CreateFreeSeamCommand, SetPointHandleCommand, CreateAnnotationCommand,
  CreateMeasurementCommand, CreateNotchCommand, MoveNotchCommand,
} from '@/commands';
import {
  elementNodeId, idsOfKind, parseElementNodeId, printAspectLocked, TRIM_ASSET_DEFAULTS,
} from '@/model';
import { panelOffsetCm, panelMoveOffsets, toPatternPoint } from '@/scene';
import { useProjectStore, useUIStore, type ToolType } from '@/store';
import {
  elementsInRect, isPlacementTool, markHintKey, hoverTargetKey, nearestEdgeSegment,
  nearestPointWithinRadius, panelIdOfEdge, pickElements, pickHoverTarget, pickInternalLineVertex,
  pickPlacementFeedback, pickPointHandle, pickPressRole, MARK_KINDS, PRODUCTION_KINDS,
} from '@/ui/viewport2D/hitTest';
import { constrainAngle, type InsertTarget, type SnapCandidate } from '@/ui/viewport2D/snap';
import {
  DEFAULT_DART_INTAKE_CM, NOTCH_MID_T, orderedDartLegs, printCenter, shapeFrame, type DraftState,
  type PolylineMode, type SeamSide,
} from '@/ui/viewport2D/tools';
import { snapToGrid, type ViewTransform } from '@/ui/viewport2D/viewMath';
import {
  arcFraction, CURSOR_TOOLS, nearestOnEdge, panelOwner, previewNotch, previewPrint, previewTrim,
  SEAM_DRAG_MIN_T, withHandle, type Drag, type MoveTarget,
} from '@/ui/viewport2D/viewportDraft';
import { askText } from '@/ui/widgets/askDialog';
import { reportActionError } from '@/ui/widgets/toast';

export interface ViewportPointerOptions {
  activeTool: ToolType;
  pattern: ReturnType<typeof useProjectStore.getState>['project']['pattern'];
  heights: ReturnType<typeof useProjectStore.getState>['project']['pattern'];
  outlines: Map<string, Vec2[]>;
  pointCandidates: Array<{ id: string; pos: Vec2 }>;
  selection: string[];
  view: ViewTransform;
  heightOffsets: ReadonlyMap<string, number>;
  pointOffsets: ReadonlyMap<string, number>;
  trimKind: ReturnType<typeof useUIStore.getState>['trimKind'];
  dragRef: React.MutableRefObject<Drag | null>;
  draftRef: React.MutableRefObject<DraftState>;
  setIsPanning: (value: boolean) => void;
  setView: React.Dispatch<React.SetStateAction<ViewTransform>>;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  setPreview: React.Dispatch<React.SetStateAction<PreviewDrag | null>>;
  setRectWorld: React.Dispatch<React.SetStateAction<{ a: Vec2; b: Vec2 } | null>>;
  setHoverTarget: React.Dispatch<React.SetStateAction<HoverTarget | null>>;
  setHoverRole: React.Dispatch<React.SetStateAction<PressRole>>;
  setMarkHint: React.Dispatch<React.SetStateAction<import('@/ui/viewport2D/hitTest').MarkHint | null>>;
  setInsertHint: React.Dispatch<React.SetStateAction<InsertTarget | null>>;
  setSeamHover: React.Dispatch<React.SetStateAction<{ edgeId: string; t0: number; t1: number } | null>>;
  setSnapHint: React.Dispatch<React.SetStateAction<SnapCandidate | null>>;
  eventWorld: (e: React.PointerEvent | React.MouseEvent) => Vec2 | null;
  getCanvasSize: () => { w: number; h: number } | null;
  commitNudge: () => void;
  spaceDown: boolean;
  draftWorld: (world: Vec2, freehand: boolean, anchor?: Vec2) => Vec2;
  resolvePlacedPoint: (world: Vec2, freehand: boolean, anchor?: Vec2) => { pos: Vec2; snap: SnapCandidate | null };
  executeTranslation: (target: MoveTarget, delta: Vec2) => void;
  clearSnapHint: () => void;
  clearAxisHint: () => void;
  pickPanel: (world: Vec2) => string | null;
  pickEdge: (world: Vec2) => ReturnType<typeof nearestEdgeSegment>;
  pickInsertTarget: (world: Vec2) => InsertTarget | null;
  seamEndAt: (side: SeamSide, world: Vec2, radius: number) => boolean | null;
  showInsertHint: (next: InsertTarget | null) => void;
  pickVertex: (target: Vec2, radius: number) => string | null;
  pickHandle: (world: Vec2) => ReturnType<typeof pickPointHandle>;
  pickMark: (world: Vec2) => { kind: 'notch' | 'annotation'; id: string } | null;
  pickPrintHandle: (world: Vec2) => string | null;
  startPanelDrag: (panelIds: string[], anchor: Vec2, world: Vec2) => void;
  startPointDrag: (pointIds: string[], anchor: Vec2, world: Vec2) => void;
  fitToPattern: () => void;
}

export function useViewportPointer(options: ViewportPointerOptions) {
  const {
    activeTool, pattern, heights, outlines, pointCandidates, selection, view, heightOffsets, pointOffsets,
    trimKind, dragRef, draftRef, setIsPanning, setView, setDraft, setPreview, setRectWorld, setHoverTarget,
    setHoverRole, setMarkHint, setSeamHover, setSnapHint, eventWorld, getCanvasSize,
    commitNudge, spaceDown, draftWorld, resolvePlacedPoint, executeTranslation, clearSnapHint, clearAxisHint,
    pickPanel, pickEdge, pickInsertTarget, seamEndAt, showInsertHint, pickVertex, pickHandle, pickMark,
    pickPrintHandle, startPanelDrag, startPointDrag,
  } = options;

  const preciseInput = async () => {
    const d = draftRef.current;
    if (d && d.tool === 'pen' && d.points.length > 0) {
      const raw = await askText({ title: '输入长度与角度(cm, °)', initial: '10, 0', hint: '例如 10, 45' });
      if (!raw) return;
      const [len, angleDeg] = raw.split(/[,，\s]+/).map(Number);
      if (!Number.isFinite(len) || !Number.isFinite(angleDeg) || len <= 0) return;
      const last = d.points[d.points.length - 1]!;
      const rad = (angleDeg * Math.PI) / 180;
      setDraft({ ...d, points: [...d.points, { x: last.x + len * Math.cos(rad), y: last.y + len * Math.sin(rad) }] });
      return;
    }

    const panelIds = idsOfKind(selection, 'panel').filter(id => !!pattern.panels[id] && !pattern.panels[id]?.locked);
    const pointIds = [...idsOfKind(selection, 'point'), ...edgePointIds(pattern, idsOfKind(selection, 'edge'))]
      .filter(id => !!pattern.points[id]);
    if (panelIds.length === 0 && pointIds.length === 0) return;
    const raw = await askText({ title: '输入位移 dx,dy(cm)', initial: '0, 0', hint: '例如 2, -3' });
    if (!raw) return;
    const [dx, dy] = raw.split(/[,，\s]+/).map(Number);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (dx === 0 && dy === 0) return;
    commitNudge();
    try {
      if (panelIds.length > 0) {
        executeTranslation({ kind: 'panels', panelIds }, { x: dx, y: dy });
      } else {
        executeTranslation({ kind: 'points', pointIds }, { x: dx, y: dy });
      }
    } catch (err) {
      reportActionError(err);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const world = eventWorld(e);
    if (!world) return;
    commitNudge();
    if (dragRef.current) return;

    const panMode = e.button === 1 || spaceDown;
    if (panMode) {
      dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, ox: view.offsetX, oy: view.offsetY };
      setIsPanning(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (e.button === 2) {
      void preciseInput();
      return;
    }

    if (e.button !== 0) return;

    const radius = 8 / view.scale;

    if (activeTool === 'topstitch') {
      const hit = pickEdge(world);
      if (!hit) return;
      const panelId = panelIdOfEdge(pattern, hit.edgeId);
      if (!panelId) return;
      const execute = useProjectStore.getState().executeCommand;
      try {
        execute(new AddTopstitchCommand(panelId, hit.edgeId));
      } catch (err) {
        reportActionError(err);
      }

      return;
    }

    if (activeTool === 'trim') {
      const panelId = pickPanel(world);
      if (!panelId) return;
      const pos = draftWorld(world, e.altKey);
      try {
        useProjectStore.getState().executeCommand(
          new AddTrimCommand(panelId, trimKind, toPatternPoint(pos, panelOffsetCm(heightOffsets, panelId))),
        );
      } catch (err) {
        reportActionError(err);
      }

      return;
    }

    if (activeTool === 'line' || activeTool === 'curve') {
      const prev = draftRef.current;
      const last = prev && prev.tool === 'pen' ? prev.points[prev.points.length - 1] : undefined;
      const pos = draftWorld(world, e.altKey, last);
      const placed = e.shiftKey && last ? constrainAngle(last, pos) : pos;
      if (Math.hypot(placed.x - pos.x, placed.y - pos.y) > 1e-6) { setSnapHint(null); clearAxisHint(); }
      setDraft({
        tool: 'pen',
        points: [...(prev && prev.tool === 'pen' ? prev.points : []), placed],
        cursor: placed,
        curve: activeTool === 'curve',
      });
      return;
    }

    if (activeTool === 'rect' || activeTool === 'circle' || activeTool === 'ellipse') {
      const pos = draftWorld(world, e.altKey);
      dragRef.current = { kind: 'shape', shape: activeTool, start: pos, current: pos };
      setDraft({ tool: 'shape', shape: activeTool, start: pos, current: pos });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (activeTool === 'internalLine' || activeTool === 'split' || activeTool === 'hole') {
      const mode: PolylineMode = activeTool === 'split' ? 'split' : activeTool === 'hole' ? 'hole' : 'line';
      const prev = draftRef.current;
      const panelId = pickPanel(world) ?? (prev && prev.tool === 'polyline' ? prev.panelId : null);
      if (!panelId) return;
      const pos = draftWorld(world, e.altKey);
      setDraft(d => {
        const points = d && d.tool === 'polyline' && d.panelId === panelId && d.mode === mode ? d.points : [];
        return { tool: 'polyline', mode, panelId, points: [...points, pos], cursor: pos };
      });
      return;
    }

    if (activeTool === 'notch') {
      const hit = pickEdge(world);
      if (!hit) return;
      try {
        useProjectStore.getState().executeCommand(new CreateNotchCommand(hit.edgeId, NOTCH_MID_T));
      } catch (err) {
        reportActionError(err);
      }

      return;
    }

    if (activeTool === 'annotation') {
      const panelId = pickPanel(world);
      if (!panelId) return;
      const pos = draftWorld(world, e.altKey);
      try {
        useProjectStore.getState().executeCommand(
          new CreateAnnotationCommand(panelId, '标注', toPatternPoint(pos, panelOffsetCm(heightOffsets, panelId))),
        );
      } catch (err) {
        reportActionError(err);
      }

      return;
    }

    if (activeTool === 'measure') {
      const pointId = nearestPointWithinRadius(pointCandidates, world, radius);
      if (!pointId) return;
      const pos = draftWorld(world, e.altKey);
      const prev = draftRef.current;
      if (!prev || prev.tool !== 'measure' || !prev.pointAId) {
        setDraft({ tool: 'measure', pointAId: pointId, cursor: pos });
        return;
      }

      try {
        useProjectStore.getState().executeCommand(new CreateMeasurementCommand('distance', { pointAId: prev.pointAId, pointBId: pointId }));
      } catch (err) {
        reportActionError(err);
      }

      setDraft({ tool: 'measure', pointAId: null, cursor: pos });
      return;
    }

    if (activeTool === 'dart') {
      const prev = draftRef.current;
      const hit = pickEdge(world);
      if (!hit) return;
      const pos = draftWorld(world, e.altKey);

      if (!prev || prev.tool !== 'dart' || !prev.leg1) {
        const panelId = panelOwner(pattern, hit.edgeId);
        if (!panelId) return;
        setDraft({ tool: 'dart', panelId, leg1: { edgeId: hit.edgeId, t: hit.t }, leg2: null, cursor: pos });
        return;
      }

      if (!prev.leg2) {
        const ordered = orderedDartLegs(pattern, prev.leg1, { edgeId: hit.edgeId, t: hit.t });
        if (!ordered) {
          reportActionError(new Error('省道需在轮廓上相邻的两条边之间创建'));
          setDraft(null);
          return;
        }

        setDraft({ ...prev, leg1: ordered.leg1, leg2: ordered.leg2 });
        return;
      }

      try {
        useProjectStore.getState().executeCommand(
          new CreateDartCommand(
            prev.panelId, prev.leg1.edgeId, prev.leg1.t, prev.leg2.edgeId, prev.leg2.t,
            DEFAULT_DART_INTAKE_CM, toPatternPoint(pos, panelOffsetCm(heightOffsets, prev.panelId)),
          ),
        );
      } catch (err) {
        reportActionError(err);
      }

      setDraft(null);
      return;
    }

    if (activeTool === 'seam') {
      const prev = draftRef.current?.tool === 'seam' ? draftRef.current : null;
      const sides = prev?.sides ?? [];
      const pending = sides[sides.length - 1];
      if (pending && pending.startLow === undefined) {
        const start = seamEndAt(pending, world, radius);
        if (start !== null) {
          const next = [...sides.slice(0, -1), { ...pending, startLow: start }];
          if (next.length === 2) createSeam(next[0]!, next[1]!);
          else setDraft({ tool: 'seam', sides: next, drag: null });
          return;
        }
      }

      const hit = pickEdge(world);
      if (!hit) {
        if (sides.length > 0) setDraft(null);
        return;
      }

      dragRef.current = { kind: 'seamdrag', edgeId: hit.edgeId, start: hit.point, current: hit.point };
      setSeamHover(null);
      setDraft({ tool: 'seam', sides, drag: { edgeId: hit.edgeId, start: hit.point, current: hit.point } });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (activeTool === 'deletePoint') {
      const pointId = pickVertex(world, radius);
      if (!pointId) return;
      const row = elementNodeId('point', pointId);
      try {
        useProjectStore.getState().executeCommand(new DeleteElementsCommand([row]));
        const rest = useUIStore.getState().selection.filter(selected => selected !== row);
        if (rest.length !== useUIStore.getState().selection.length) useUIStore.getState().select(rest);
        setHoverTarget(null);
      } catch (err) {
        reportActionError(err, '删除顶点失败');
      }

      return;
    }

    if (activeTool === 'point') {
      const pointId = pickVertex(world, radius);
      if (pointId) {
        const row = elementNodeId('point', pointId);
        if (e.ctrlKey || e.metaKey || e.shiftKey) useUIStore.getState().toggleSelection(row);
        else useUIStore.getState().select([row]);
        showInsertHint(null);
        return;
      }

      const target = pickInsertTarget(world);
      if (target) {
        try {
          const at = toPatternPoint(target.pos, panelOffsetCm(heightOffsets, panelIdOfEdge(pattern, target.edgeId)));
          useProjectStore.getState().executeCommand(new AddPointOnEdgeCommand(target.edgeId, at));
        } catch (err) {
          reportActionError(err);
        }
      }

      showInsertHint(null);
      return;
    }

    if (activeTool !== 'select') return;

    const handle = pickHandle(world);
    if (handle) {
      dragRef.current = { kind: 'handle', pointId: handle.pointId, which: handle.which, target: handle.pos };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const pointId = pickVertex(world, radius);
    if (pointId) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        useUIStore.getState().toggleSelection(elementNodeId('point', pointId));
        return;
      }

      const picked = idsOfKind(selection, 'point');
      const group = picked.includes(pointId) ? picked : [pointId];
      useUIStore.getState().select(group.map(id => elementNodeId('point', id)));
      const anchor = heights.points[pointId]!.pos;
      startPointDrag(group, anchor, world);
      if (dragRef.current) e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const internalVertex = pickInternalLineVertex(heights, selection, world, radius);
    if (internalVertex) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        useUIStore.getState().toggleSelection(elementNodeId('internal', internalVertex.lineId));
        return;
      }

      const anchor = heights.internalLines[internalVertex.lineId]!.points[internalVertex.indices[0]!]!;
      const geom: MoveGeometry = {
        pointIds: [],
        lineVertices: internalVertex.indices.map(index => ({ lineId: internalVertex.lineId, index })),
      };
      dragRef.current = {
        kind: 'move', target: { kind: 'internalVertex', ...internalVertex },
        geom, anchor, startWorld: world, offset: null,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const mark = pickMark(world);
    if (mark) {
      const row = elementNodeId(mark.kind, mark.id);
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (additive) useUIStore.getState().toggleSelection(row);
      else useUIStore.getState().select([row]);
      if (mark.kind === 'notch' && !additive) {
        const notch = pattern.notches?.[mark.id];
        const ownerId = notch ? panelIdOfEdge(pattern, notch.edgeId) : null;
        if (notch && ownerId && !pattern.panels[ownerId]?.locked) {
          dragRef.current = { kind: 'notch', notchId: mark.id, edgeId: notch.edgeId, t: notch.t };
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }

      return;
    }

    const printId = pickPrintHandle(world);
    if (printId) {
      const print = pattern.prints?.[printId];
      if (print) {
        dragRef.current = { kind: 'printresize', printId, size: { widthCm: print.widthCm, heightCm: print.heightCm } };
        e.currentTarget.setPointerCapture(e.pointerId);
      }

      return;
    }

    const productionRow = pickElements(heights, world, radius, PRODUCTION_KINDS);
    if (productionRow) {
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (additive) {
        useUIStore.getState().toggleSelection(productionRow);
        return;
      }

      useUIStore.getState().select([productionRow]);
      const element = parseElementNodeId(productionRow);
      if (element?.kind === 'trim') {
        const trim = pattern.trims?.[element.id];
        if (trim && !pattern.panels[trim.panelId]?.locked) {
          dragRef.current = { kind: 'trimmove', trimId: element.id, startPos: trim.pos, startWorld: world, pos: trim.pos };
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      } else if (element?.kind === 'print') {
        const print = pattern.prints?.[element.id];
        if (print && !pattern.panels[print.panelId]?.locked) {
          dragRef.current = {
            kind: 'printmove', printId: element.id, startCenter: print.center, startWorld: world, center: print.center,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }

      return;
    }

    const edgeHit = pickEdge(world);
    if (edgeHit && pattern.edges[edgeHit.edgeId]) {
      const row = elementNodeId('edge', edgeHit.edgeId);
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        useUIStore.getState().toggleSelection(row);
        return;
      }

      const picked = idsOfKind(selection, 'edge');
      const group = picked.includes(edgeHit.edgeId) ? picked : [edgeHit.edgeId];
      useUIStore.getState().select(group.map(id => elementNodeId('edge', id)));
      const edge = pattern.edges[edgeHit.edgeId]!;
      const anchor = heights.points[edge.startPointId]?.pos ?? edgeHit.point;
      startPointDrag(edgePointIds(pattern, group), anchor, world);
      if (dragRef.current) e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const markRow = pickElements(heights, world, radius, MARK_KINDS);
    if (markRow) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) useUIStore.getState().toggleSelection(markRow);
      else useUIStore.getState().select([markRow]);
      return;
    }

    const panelId = pickPanel(world);
    if (panelId) {
      const ui = useUIStore.getState();
      let nextIds: string[];
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        ui.toggleSelection(panelId);
        nextIds = useUIStore.getState().selection;
      } else {
        ui.select([panelId]);
        nextIds = [panelId];
      }

      startPanelDrag(idsOfKind(nextIds, 'panel'), world, world);
      if (dragRef.current) e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    dragRef.current = { kind: 'rect', startWorld: world };
    setRectWorld({ a: world, b: world });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const world = eventWorld(e);
    if (!world) return;
    const drag = dragRef.current;

    if (!drag) {
      const radius = 8 / view.scale;
      if (activeTool === 'select') {
        const next = pickHoverTarget(heights, outlines, selection, world, radius);
        setHoverTarget(prev => (hoverTargetKey(prev) === hoverTargetKey(next) ? prev : next));
        const role = pickPressRole(heights, outlines, selection, world, radius);
        setHoverRole(prev => (prev === role ? prev : role));
      } else if (activeTool === 'point' || activeTool === 'deletePoint') {
        const id = pickVertex(world, radius);
        const next: HoverTarget | null = id ? { kind: 'point', id } : null;
        setHoverTarget(prev => (hoverTargetKey(prev) === hoverTargetKey(next) ? prev : next));
        if (activeTool === 'point') {
          showInsertHint(id ? null : pickInsertTarget(world));
        }
      } else if (isPlacementTool(activeTool)) {
        const placed = activeTool === 'annotation' ? resolvePlacedPoint(world, e.altKey).pos : null;
        const feedback = pickPlacementFeedback(
          activeTool, heights, outlines, pointCandidates, world, radius, placed,
          TRIM_ASSET_DEFAULTS[trimKind].sizeMm / 20,
        );
        setHoverTarget(prev => (hoverTargetKey(prev) === hoverTargetKey(feedback.hover) ? prev : feedback.hover));
        setMarkHint(prev => (markHintKey(prev) === markHintKey(feedback.hint) ? prev : feedback.hint));
      } else {
        setHoverTarget(prev => (prev === null ? prev : null));
        setMarkHint(prev => (prev === null ? prev : null));
      }

      if (activeTool === 'seam') {
        const d = draftRef.current?.tool === 'seam' ? draftRef.current : null;
        const awaiting = d ? d.sides.length > 0 && d.sides[d.sides.length - 1]!.startLow === undefined : false;
        const hit = awaiting ? null : pickEdge(world);
        setSeamHover(prev => {
          if (!hit) return prev === null ? prev : null;
          return prev?.edgeId === hit.edgeId ? prev : { edgeId: hit.edgeId, t0: 0, t1: 1 };
        });
      }

      if (CURSOR_TOOLS.has(activeTool)) {
        const d = draftRef.current;
        const anchor = d && d.tool === 'pen' ? d.points[d.points.length - 1] : undefined;
        const pos = draftWorld(world, e.altKey, anchor);
        setDraft(draft => (draft && 'cursor' in draft ? ({ ...draft, cursor: pos } as DraftState) : draft));
      } else {
        clearSnapHint();
      }

      return;
    }

    setHoverTarget(prev => (prev === null ? prev : null));
    setMarkHint(prev => (prev === null ? prev : null));

    if (drag.kind !== 'shape' && drag.kind !== 'handle') clearSnapHint();

    if (drag.kind === 'seamdrag') {
      dragRef.current = { ...drag, current: world };
      setDraft(d => (d && d.tool === 'seam' && d.drag
        ? { ...d, drag: { ...d.drag, current: nearestOnEdge(heights, drag.edgeId, world) } }
        : d));
      return;
    }

    if (drag.kind === 'pan') {
      setView(v => ({
        ...v,
        offsetX: drag.ox + (e.clientX - drag.startX),
        offsetY: drag.oy - (e.clientY - drag.startY),
      }));
      return;
    }

    if (drag.kind === 'shape') {
      const raw = draftWorld(world, e.altKey);
      const current = e.shiftKey && drag.shape !== 'ellipse'
        ? constrainAngle(drag.start, raw)
        : raw;
      if (Math.hypot(current.x - raw.x, current.y - raw.y) > 1e-6) setSnapHint(null);
      dragRef.current = { ...drag, current };
      setDraft({ tool: 'shape', shape: drag.shape, start: drag.start, current });
      return;
    }

    if (drag.kind === 'handle') {
      const pos = draftWorld(world, e.altKey);
      dragRef.current = { ...drag, target: pos };
      const target = toPatternPoint(pos, pointOffsets.get(drag.pointId) ?? 0);
      setPreview({ pattern: withHandle(pattern, drag.pointId, drag.which, target), ghost: null });
      return;
    }

    if (drag.kind === 'notch') {
      const hit = nearestEdgeSegment(heights, [drag.edgeId], world, Infinity);
      if (!hit) return;
      drag.t = Math.min(1, Math.max(0, arcFraction(heights, drag.edgeId, hit.point)));
      setPreview({ pattern: previewNotch(pattern, drag.notchId, drag.t), offsets: heightOffsets, ghost: null });
      return;
    }

    if (drag.kind === 'printmove') {
      const center = {
        x: drag.startCenter.x + world.x - drag.startWorld.x,
        y: drag.startCenter.y + world.y - drag.startWorld.y,
      };
      drag.center = center;
      setPreview({ pattern: previewPrint(pattern, drag.printId, { center }), offsets: heightOffsets, ghost: null });
      return;
    }

    if (drag.kind === 'printresize') {
      const print = pattern.prints?.[drag.printId];
      if (!print) return;
      const center = printCenter(heights, print);
      if (!center) return;
      const rad = (print.angleDeg * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const dx = world.x - center.x, dy = world.y - center.y;
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      const free = { widthCm: Math.max(0.1, Math.abs(localX) * 2), heightCm: Math.max(0.1, Math.abs(localY) * 2) };
      const size = printAspectLocked(print) !== e.shiftKey ? keepAspect(drag.size, free) : free;
      drag.size = size;
      setPreview({ pattern: previewPrint(pattern, drag.printId, size), offsets: heightOffsets, ghost: null });
      return;
    }

    if (drag.kind === 'trimmove') {
      const pos = {
        x: drag.startPos.x + world.x - drag.startWorld.x,
        y: drag.startPos.y + world.y - drag.startWorld.y,
      };
      drag.pos = pos;
      setPreview({ pattern: previewTrim(pattern, drag.trimId, pos), offsets: heightOffsets, ghost: null });
      return;
    }

    if (drag.kind === 'move') {
      const raw: Vec2 = { x: world.x - drag.startWorld.x, y: world.y - drag.startWorld.y };
      let offset = raw;
      let ghost: Vec2 | null = null;
      if (!e.altKey) {
        const snapped = snapToGrid({ x: drag.anchor.x + raw.x, y: drag.anchor.y + raw.y });
        offset = { x: snapped.x - drag.anchor.x, y: snapped.y - drag.anchor.y };
        ghost = snapped;
      }

      drag.offset = offset;
      setPreview({
        pattern: drag.target.kind === 'panels'
          ? previewPanelMove(pattern, drag.target.panelIds, offset)
          : previewMove(pattern, drag.geom, offset),
        offsets: drag.target.kind === 'panels'
          ? panelMoveOffsets(pattern, heightOffsets, drag.target.panelIds, offset.y)
          : undefined,
        ghost,
      });
      return;
    }

    setRectWorld({ a: drag.startWorld, b: world });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsPanning(false);
    if (!drag) return;

    if (drag.kind === 'seamdrag') {
      commitSeamPick(drag);
      return;
    }

    if (drag.kind === 'shape') {
      setDraft(null);
      const frame = shapeFrame(drag.start, drag.current, drag.shape, false);
      const center = { x: (frame.min.x + frame.max.x) / 2, y: (frame.min.y + frame.max.y) / 2 };
      const w = frame.max.x - frame.min.x;
      const h = frame.max.y - frame.min.y;
      try {
        if (drag.shape === 'rect' && w > 0.5 && h > 0.5) useProjectStore.getState().executeCommand(new CreateRectCommand(w, h, center));
        else if (drag.shape === 'circle' && w > 0.5) useProjectStore.getState().executeCommand(new CreateCircleCommand(w / 2, center));
        else if (drag.shape === 'ellipse' && w > 0.5 && h > 0.5) useProjectStore.getState().executeCommand(new CreateEllipseCommand(w / 2, h / 2, center));
      } catch (err) {
        reportActionError(err);
      }

      return;
    }

    if (drag.kind === 'handle') {
      setPreview(null);
      const target = toPatternPoint(drag.target, pointOffsets.get(drag.pointId) ?? 0);
      useProjectStore.getState().executeCommand(new SetPointHandleCommand(drag.pointId, drag.which, target));
      return;
    }

    if (drag.kind === 'notch') {
      setPreview(null);
      const before = pattern.notches?.[drag.notchId]?.t;
      if (before !== undefined && Math.abs(before - drag.t) > 1e-6) {
        commitNudge();
        useProjectStore.getState().executeCommand(new MoveNotchCommand(drag.notchId, drag.t));
      }

      return;
    }

    if (drag.kind === 'printmove') {
      setPreview(null);
      const print = pattern.prints?.[drag.printId];
      if (print && (drag.center.x !== drag.startCenter.x || drag.center.y !== drag.startCenter.y)) {
        commitNudge();
        useProjectStore.getState().executeCommand(new UpdatePrintCommand(drag.printId, { center: drag.center }));
      }

      return;
    }

    if (drag.kind === 'printresize') {
      setPreview(null);
      const print = pattern.prints?.[drag.printId];
      if (print && (Math.abs(drag.size.widthCm - print.widthCm) > 1e-6 || Math.abs(drag.size.heightCm - print.heightCm) > 1e-6)) {
        commitNudge();
        useProjectStore.getState().executeCommand(new UpdatePrintCommand(drag.printId, drag.size));
      }

      return;
    }

    if (drag.kind === 'trimmove') {
      setPreview(null);
      const trim = pattern.trims?.[drag.trimId];
      if (trim && (drag.pos.x !== drag.startPos.x || drag.pos.y !== drag.startPos.y)) {
        commitNudge();
        useProjectStore.getState().executeCommand(new UpdateTrimCommand(drag.trimId, { pos: drag.pos }));
      }

      return;
    }

    if (drag.kind === 'move') {
      const delta = drag.offset;
      if (delta && (delta.x !== 0 || delta.y !== 0)) {
        commitNudge();
        executeTranslation(drag.target, delta);
      }

      setPreview(null);
    } else if (drag.kind === 'rect') {
      const world = eventWorld(e);
      setRectWorld(null);
      if (!world) return;
      const size = getCanvasSize();
      const movedPx = size
        ? Math.hypot((world.x - drag.startWorld.x) * view.scale, (world.y - drag.startWorld.y) * view.scale)
        : 0;
      if (movedPx < 4) {
        useUIStore.getState().clearSelection();
        return;
      }

      const rect: Rect = {
        min: { x: Math.min(drag.startWorld.x, world.x), y: Math.min(drag.startWorld.y, world.y) },
        max: { x: Math.max(drag.startWorld.x, world.x), y: Math.max(drag.startWorld.y, world.y) },
      };
      const ids = elementsInRect(heights, rect, useUIStore.getState().marqueeKinds);
      useUIStore.getState().select(ids);
    }

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const commitSeamPick = (drag: Extract<Drag, { kind: 'seamdrag' }>) => {
    const current = drag.current;
    let t0 = Math.min(arcFraction(heights, drag.edgeId, drag.start), arcFraction(heights, drag.edgeId, current));
    let t1 = Math.max(arcFraction(heights, drag.edgeId, drag.start), arcFraction(heights, drag.edgeId, current));
    if (t1 - t0 < SEAM_DRAG_MIN_T) { t0 = 0; t1 = 1; }
    const pick: SeamSide = { edgeId: drag.edgeId, t0, t1 };
    const d = draftRef.current;
    if (!d || d.tool !== 'seam') { setDraft(null); return; }
    const sides = d.sides;
    const last = sides[sides.length - 1];
    if (sides.some((s, i) => i !== sides.length - 1 && s.startLow !== undefined && s.edgeId === pick.edgeId)) {
      setDraft({ tool: 'seam', sides, drag: null });
      return;
    }

    if (last && last.startLow === undefined) {
      setDraft(last.edgeId === pick.edgeId
        ? (sides.length === 1 ? null : { tool: 'seam', sides: sides.slice(0, -1), drag: null })
        : { tool: 'seam', sides: [...sides.slice(0, -1), pick], drag: null });
      return;
    }

    if (last?.edgeId === pick.edgeId) {
      setDraft({ tool: 'seam', sides: [...sides.slice(0, -1), pick], drag: null });
      return;
    }

    setDraft({ tool: 'seam', sides: [...sides, pick], drag: null });
  };

  const createSeam = (first: SeamSide, second: SeamSide) => {
    const [a, b] = first.startLow === false && second.startLow === true ? [second, first] : [first, second];
    const flip = a.startLow !== b.startLow;
    try {
      useProjectStore.getState().executeCommand(new CreateFreeSeamCommand(
        a.edgeId, a.t0, a.t1, b.edgeId, b.t0, b.t1,
        flip ? { flip: true } : {},
      ));
    } catch (err) {
      reportActionError(err);
    }

    setDraft(null);
  };

  return { handlePointerDown, handlePointerMove, handlePointerUp };
}

function keepAspect(
  start: { widthCm: number; heightCm: number },
  free: { widthCm: number; heightCm: number },
): { widthCm: number; heightCm: number } {
  const aspect = start.widthCm / Math.max(1e-6, start.heightCm);
  const widthCm = Math.max(free.widthCm, free.heightCm * aspect);
  return { widthCm, heightCm: widthCm / aspect };
}
