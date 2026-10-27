import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Vec2 } from '../../core/model/types';
import { samplePanelOutline } from '../../pattern/panel/panelBuilder';
import { isSplitLayout, useProjectStore, useUIStore, noteDrawnFrame, type ViewLayout } from '../../store/stores';
import {
  AddPointOnEdgeCommand, MovePanelsCommand, MovePointsCommand,
  panelMoveGeometry, pointMoveGeometry, previewMove, type MoveGeometry,
} from '../../core/command/patternCommands';
import {
  nearestEdgeSegment, nearestPointWithinRadius, panelOutlineInRect, panelsOfPoint,
  visiblePanelUnderPoint, type Rect,
} from './hitTest';
import { snapToGrid, type ViewTransform } from './viewMath';
import { drawScene, type PreviewDrag } from './render';
import { useCanvasView } from './useCanvasView';
import { useNudgeSession } from './useNudgeSession';
import { ViewportHint } from '../widgets/viewportHint';

/** What a pointer drag translates: whole panels rigidly, or a single vertex. */
type MoveTarget =
  | { kind: 'panels'; panelIds: string[] }
  | { kind: 'points'; pointIds: string[] };

type Drag =
  | { kind: 'pan'; startX: number; startY: number; ox: number; oy: number }
  | { kind: 'move'; target: MoveTarget; geom: MoveGeometry; anchor: Vec2; startWorld: Vec2; offset: Vec2 | null }
  | { kind: 'rect'; startWorld: Vec2 };

const HIT_RADIUS_PX = 8;

/** Zoom readout with the gestures the current layout allows. */
const statusHint = (layout: ViewLayout, scale: number): string =>
  isSplitLayout(layout)
    ? `2D 制版 · 缩放 ${scale.toFixed(1)}x · 单击选片/拖点移动 · F适应 · 快捷键需点击聚焦本窗格`
    : `2D 制版 · 缩放 ${scale.toFixed(1)}x · 单击选片/Ctrl加选/空白拖框选 · 拖点或拖动版型片（0.5cm吸附，Alt自由）· Delete删除/方向键微调 · 点工具单击边加点 · 滚轮定点缩放 · F或双击空白适应 · 中键或空格平移`;

/** 2D drafting canvas: draws the pattern and turns pointer and keyboard input into panel edits. */
export function Viewport2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [hoverPointId, setHoverPointId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewDrag | null>(null);
  const [rectWorld, setRectWorld] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [view, setView] = useState<ViewTransform>({ offsetX: 0, offsetY: 0, scale: 4 });

  const project = useProjectStore(s => s.project);
  const selection = useUIStore(s => s.selection);
  const activeTool = useUIStore(s => s.activeTool);
  const layout = useUIStore(s => s.layout);

  const pattern = project.pattern;
  const selectedPanelIds = useMemo(
    () => selection.filter(id => !!pattern.panels[id]),
    [selection, pattern],
  );

  // Sampled outlines for polygon hit tests and view fitting.
  const outlines = useMemo(() => {
    const map = new Map<string, Vec2[]>();
    for (const panel of Object.values(pattern.panels)) {
      map.set(panel.id, samplePanelOutline(pattern, panel));
    }
    return map;
  }, [pattern]);

  const pointCandidates = useMemo(
    () => Object.values(pattern.points).map(p => ({ id: p.id, pos: p.pos })),
    [pattern],
  );

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth, h = container.clientHeight;
    // Skip drawing a hidden pane.
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    drawScene(ctx, w, h, {
      pattern, view, selection, hoverPointId, preview, rect: rectWorld,
      showSeams: activeTool === 'seam' || selection.some(id => !!pattern.edges[id]),
    });
    noteDrawnFrame('2d', performance.now());
  }, [pattern, view, selection, hoverPointId, preview, rectWorld, activeTool]);

  useEffect(() => { render(); }, [render]);

  const { getCanvasSize, eventWorld, fitToPattern } =
    useCanvasView({ pattern, view, setView, render, canvasRef, containerRef });
  const { commitNudge, spaceDown } = useNudgeSession(pattern, setPreview);

  /** Panel under a world point, via outline polygon or a nearby edge. */
  const pickPanel = useCallback(
    (world: Vec2): string | null => visiblePanelUnderPoint(pattern, outlines, world, HIT_RADIUS_PX / view.scale),
    [pattern, outlines, view.scale],
  );

  const startPanelDrag = (panelIds: string[], anchor: Vec2, world: Vec2) => {
    const geom = panelMoveGeometry(pattern, panelIds);
    if (geom.pointIds.length === 0) return;
    dragRef.current = { kind: 'move', target: { kind: 'panels', panelIds }, geom, anchor, startWorld: world, offset: null };
  };

  const startPointDrag = (pointIds: string[], anchor: Vec2, world: Vec2) => {
    const geom = pointMoveGeometry(pattern, pointIds);
    if (geom.pointIds.length === 0) return;
    dragRef.current = { kind: 'move', target: { kind: 'points', pointIds }, geom, anchor, startWorld: world, offset: null };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const world = eventWorld(e);
    if (!world) return;
    commitNudge();
    if (dragRef.current) return;

    const panMode = e.button === 1 || spaceDown || activeTool === 'pan';
    if (panMode) {
      dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, ox: view.offsetX, oy: view.offsetY };
      setIsPanning(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    const radius = HIT_RADIUS_PX / view.scale;

    if (activeTool === 'point') {
      const edgeIds = selectedPanelIds.flatMap(id => pattern.panels[id]?.outlineEdgeIds ?? []);
      const hit = nearestEdgeSegment(pattern, edgeIds, world, radius);
      if (hit) {
        try {
          useProjectStore.getState().executeCommand(new AddPointOnEdgeCommand(hit.edgeId, hit.point));
        } catch (err) {
          console.warn(err);
        }
      }
      return;
    }

    if (activeTool !== 'select') return;

    const pointId = nearestPointWithinRadius(pointCandidates, world, radius);
    if (pointId) {
      const owners = panelsOfPoint(pattern, pointId).filter(id => pattern.panels[id]?.visible);
      const pointPos = pattern.points[pointId].pos;
      if (owners.some(id => selectedPanelIds.includes(id))) {
        startPointDrag([pointId], pointPos, world);
      } else if (selectedPanelIds.length > 0) {
        startPanelDrag(selectedPanelIds, pointPos, world);
      } else if (owners.length > 0) {
        useUIStore.getState().select([owners[0]]);
        startPanelDrag([owners[0]], pointPos, world);
      }
      if (dragRef.current) e.currentTarget.setPointerCapture(e.pointerId);
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
      startPanelDrag(nextIds, world, world);
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
      if (activeTool === 'select' || activeTool === 'point') {
        const id = nearestPointWithinRadius(pointCandidates, world, HIT_RADIUS_PX / view.scale);
        setHoverPointId(prev => (prev === id ? prev : id));
      }
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
      setPreview({ pattern: previewMove(pattern, drag.geom, offset), ghost });
      return;
    }

    setRectWorld({ a: drag.startWorld, b: world });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsPanning(false);
    if (!drag) return;

    if (drag.kind === 'move') {
      const delta = drag.offset;
      if (delta && (delta.x !== 0 || delta.y !== 0)) {
        commitNudge();
        useProjectStore.getState().executeCommand(
          drag.target.kind === 'panels'
            ? new MovePanelsCommand(drag.target.panelIds, delta)
            : new MovePointsCommand(new Map(drag.target.pointIds.map(id => [id, delta]))),
        );
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
      const ids = Object.keys(pattern.panels).filter(id => panelOutlineInRect(pattern, id, rect));
      useUIStore.getState().select(ids);
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const world = eventWorld(e);
    if (!world) return;
    if (!pickPanel(world)) fitToPattern();
  };

  const dragging = dragRef.current?.kind === 'move' || dragRef.current?.kind === 'rect';
  const cursor = isPanning || (preview && dragRef.current?.kind === 'move')
    ? 'grabbing'
    : spaceDown || activeTool === 'pan'
      ? 'grab'
      : hoverPointId
        ? 'grab'
        : activeTool === 'select' || activeTool === 'point'
          ? 'crosshair'
          : dragging ? 'crosshair' : 'default';

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      />
      <ViewportHint>{statusHint(layout, view.scale)}</ViewportHint>
    </div>
  );
}
