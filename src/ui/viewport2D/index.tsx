import type { Print, Vec2 } from '@/model/types';

import { bodyLandmarks, makehumanBody } from '@/avatar';
import {
  CompositeCommand, UpdatePrintCommand, MoveGeometryCommand, panelMoveCommand, panelMoveGeometry,
  pointMoveCommand, pointMoveGeometry, CreatePanelFromPointsCommand, AddInternalLineCommand,
  OutlineHoleCommand, OutlineSplitCommand,
} from '@/commands';
import { readPrintImage } from '@/io/serialization';
import {
  idsOfKind, parseElementNodeId, MAX_PRINT_BYTES, PRINT_IMAGE_MAX_EDGE, printAspectLocked,
  printImageFields, printSizeWithAspect,
} from '@/model';
import { createEmptyPattern } from '@/model/defaults';
import { pointAtT } from '@/pattern/geom';
import { orderedSizes, sizeOutlines } from '@/pattern/grading';
import { samplePanelOutline } from '@/pattern/panel';
import {
  panelHeightOffsets, panelOffsetCm, pointHeightOffsets, toHeightPattern, toPatternPoint,
  toPatternPoints,
} from '@/scene';
import { is2DFocus, useProjectStore, useUIStore, noteDrawnFrame } from '@/store';
import { applyFabricDrag, placeTrimOnPanel } from '@/ui/assets/applyAsset';
import { isAssetDrag, currentAssetDrag, endAssetDrag, readAssetDrag } from '@/ui/assets/assetDrag';
import { keyboardBlocked } from '@/ui/keyboardGuard';
import { registerViewport2DCapture, type Capture2DOptions } from '@/ui/screenshot';
import { viewport2DCursor } from '@/ui/viewport2D/cursor';
import { bodyGuideGeometry, type BodyGuideGeometry } from '@/ui/viewport2D/drawBodyGuide';
import {
  nearestEdgeSegment, panelsOfPoint, pickElements, pickPointHandle, visiblePanelUnderPoint,
  type HoverTarget, type MarkHint, type PressRole,
} from '@/ui/viewport2D/hitTest';
import { drawScene, type PreviewDrag, type DisplayOptions, type SceneState } from '@/ui/viewport2D/render';
import {
  collectSnapCandidates, constrainAxis, findSnapAtPattern, insertTargetOnEdge, type AxisLock,
  type InsertTarget, type SnapCandidate,
} from '@/ui/viewport2D/snap';
import {
  cleanDraftLoop, printFrame, type DraftState, type SeamSide,
} from '@/ui/viewport2D/tools';
import { useCanvasView } from '@/ui/viewport2D/useCanvasView';
import { useNudgeSession } from '@/ui/viewport2D/useNudgeSession';
import { useViewportPointer } from '@/ui/viewport2D/useViewportPointer';
import { snapToGrid, type ViewTransform } from '@/ui/viewport2D/viewMath';
import {
  AXIS_SNAP_PX, HIT_RADIUS_PX, MIDPOINT_SNAP_PX, statusHint, type Drag, type MoveTarget,
  type SeamStep,
} from '@/ui/viewport2D/viewportDraft';
import { reportActionError } from '@/ui/widgets/toast';
import { ViewportHint } from '@/ui/widgets/viewportHint';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';

export function Viewport2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);
  const [markHint, setMarkHint] = useState<MarkHint | null>(null);
  const [dropHint, setDropHint] = useState<{ pos: Vec2; radiusCm: number } | null>(null);
  const [hoverRole, setHoverRole] = useState<PressRole>(null);
  const [seamHover, setSeamHover] = useState<{ edgeId: string; t0: number; t1: number } | null>(null);
  const [insertHint, setInsertHint] = useState<InsertTarget | null>(null);
  const [preview, setPreview] = useState<PreviewDrag | null>(null);
  const [rectWorld, setRectWorld] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [draft, setDraft] = useState<DraftState>(null);
  const [snapHint, setSnapHint] = useState<SnapCandidate | null>(null);
  const [axisHint, setAxisHint] = useState<AxisLock | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const draftRef = useRef<DraftState>(null);
  draftRef.current = draft;
  const printInputRef = useRef<HTMLInputElement>(null);
  const pendingPrintRef = useRef<string | null>(null);
  const [view, setView] = useState<ViewTransform>({ offsetX: 0, offsetY: 0, scale: 4 });

  const project = useProjectStore(s => s.project);
  const selection = useUIStore(s => s.selection);
  const activeTool = useUIStore(s => s.activeTool);
  const layout = useUIStore(s => s.layout);
  const displayOptions = useUIStore(s => s.displayOptions);
  const editPreview = useUIStore(s => s.editPreview);
  const repaintToken = useUIStore(s => s.repaintToken);
  const trimKind = useUIStore(s => s.trimKind);

  const pattern = project.pattern;
  const body = useMemo(() => bodyLandmarks(project.avatar.params), [project.avatar.params]);
  const bodyMesh = useMemo(() => {
    const built = makehumanBody(project.avatar.params);
    return { positions: built.positions, indices: built.bodyIndices };
  }, [project.avatar.params]);
  const bodyGuide = useMemo<BodyGuideGeometry | undefined>(
    () => displayOptions.bodyGuide
      ? bodyGuideGeometry({ body, mesh: bodyMesh })
      : undefined,
    [displayOptions.bodyGuide, body, bodyMesh],
  );
  const fitBounds = useMemo(() => bodyGuide?.outlines.flat() ?? [], [bodyGuide]);
  const heightOffsets = useMemo(() => panelHeightOffsets(pattern, body), [pattern, body]);
  const pointOffsets = useMemo(() => pointHeightOffsets(pattern, heightOffsets), [pattern, heightOffsets]);
  const heights = useMemo(() => toHeightPattern(pattern, heightOffsets), [pattern, heightOffsets]);

  const selectedPanelIds = useMemo(
    () => idsOfKind(selection, 'panel').filter(id => !!pattern.panels[id]),
    [selection, pattern],
  );

  const outlines = useMemo(() => {
    const map = new Map<string, Vec2[]>();
    for (const panel of Object.values(heights.panels)) {
      map.set(panel.id, samplePanelOutline(heights, panel));
    }

    return map;
  }, [heights]);

  const pointCandidates = useMemo(
    () => Object.values(heights.points).map(p => ({ id: p.id, pos: p.pos })),
    [heights],
  );

  const snapCandidates = useMemo(() => collectSnapCandidates(heights), [heights]);

  const gradingOutlines = useMemo(() => {
    if (!displayOptions.gradingOverlay) return [];
    return orderedSizes(project)
      .filter(size => size.id !== project.activeSizeId)
      .map(size => {
        const dyOf = (id: string): number => heightOffsets.get(id) ?? 0;
        return {
          label: size.label,
          polygons: Object.keys(pattern.panels).flatMap(id =>
            sizeOutlines(pattern, id, size.id, project.activeSizeId)
              .map(poly => poly.map(p => ({ x: p.x, y: p.y + dyOf(id) })))),
        };
      });
  }, [displayOptions.gradingOverlay, project, pattern, heightOffsets]);

  const clearSnapHint = useCallback(() => {
    setSnapHint(hint => (hint ? null : hint));
  }, []);

  const clearAxisHint = useCallback(() => {
    setAxisHint(hint => (hint ? null : hint));
  }, []);

  const resolvePlacedPoint = useCallback((
    world: Vec2, freehand: boolean, anchor?: Vec2,
  ): { pos: Vec2; snap: SnapCandidate | null; axis: AxisLock | null } => {
    if (freehand) return { pos: world, snap: null, axis: null };
    const snap = findSnapAtPattern(heights, world, snapCandidates, 8 / view.scale, anchor);
    const base = snap ? snap.pos : snapToGrid(world);
    const axis = anchor && !snap ? constrainAxis(anchor, base, AXIS_SNAP_PX / view.scale) : null;
    if (axis) return { pos: axis.to, snap: null, axis };
    return { pos: base, snap: snap ?? { pos: base, kind: 'grid' }, axis: null };
  }, [snapCandidates, view.scale, heights]);

  const draftWorld = useCallback((world: Vec2, freehand: boolean, anchor?: Vec2): Vec2 => {
    const { pos, snap, axis } = resolvePlacedPoint(world, freehand, anchor);
    setSnapHint(snap);
    setAxisHint(axis);
    return pos;
  }, [resolvePlacedPoint]);

  const sceneState = useCallback((): SceneState => {
    const shown = preview ? preview.pattern : pattern;
    const shownOffsets = preview ? (preview.offsets ?? panelHeightOffsets(shown, body)) : heightOffsets;
    return {
      pattern: preview ? toHeightPattern(shown, shownOffsets) : heights,
      meshPattern: shown,
      offsets: shownOffsets,
      view, simulation: project.scene.simulation,
      selection, hover: hoverTarget, markHint, dropHint, preview: preview && { ...preview, pattern: toHeightPattern(shown, shownOffsets) }, rect: rectWorld,
      showSeams: activeTool === 'seam' || idsOfKind(selection, 'seam').length > 0,
      draft, snapHint, axisHint, insertHint, seamHover, hoverDelete: activeTool === 'deletePoint', display: displayOptions as DisplayOptions,
      gradingOutlines,
      bodyGuide,
      onPrintImageReady: () => useUIStore.getState().requestRepaint(),
    };
  }, [pattern, heights, heightOffsets, body, bodyGuide, view, project.scene.simulation, selection, hoverTarget, markHint, dropHint, preview, rectWorld, activeTool, draft, snapHint, axisHint, insertHint, seamHover, displayOptions, gradingOutlines]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth, h = container.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    drawScene(ctx, w, h, sceneState());
    noteDrawnFrame('2d', performance.now());
  }, [sceneState]);

  const captureRef = useRef<(options: Capture2DOptions) => HTMLCanvasElement | null>(() => null);
  captureRef.current = ({ panels, display }) => {
    const container = containerRef.current;
    if (!container) return null;
    const w = container.clientWidth, h = container.clientHeight;
    if (w === 0 || h === 0) return null;
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const scene = sceneState();
    const still: SceneState = {
      ...scene,
      display,
      bodyGuide: display.bodyGuide ? bodyGuide ?? bodyGuideGeometry({ body, mesh: bodyMesh }) : undefined,
    };
    if (panels) {
      drawScene(ctx, w, h, still);
      return canvas;
    }

    const blank = createEmptyPattern();
    drawScene(ctx, w, h, {
      ...still,
      pattern: blank,
      meshPattern: blank,
      offsets: new Map(),
      showSeams: false,
      gradingOutlines: [],
    });
    return canvas;
  };

  useEffect(() => registerViewport2DCapture(options => captureRef.current(options)), []);
  useEffect(() => { render(); }, [render, repaintToken]);

  useEffect(() => {
    setDraft(null); setSnapHint(null); setAxisHint(null); setHoverRole(null); setHoverTarget(null);
    setMarkHint(null); setInsertHint(null); setSeamHover(null);
  }, [activeTool]);

  const { getCanvasSize, eventWorld, fitToPattern } =
    useCanvasView({ pattern: heights, fitBounds, view, setView, render, canvasRef, containerRef });
  const { commitNudge, spaceDown } = useNudgeSession(pattern, setPreview);

  useEffect(() => {
    useUIStore.getState().setEditPreviewPattern(preview && editPreview !== 'off' ? preview.pattern : null);
    return () => useUIStore.getState().setEditPreviewPattern(null);
  }, [preview, editPreview]);

  const commitPen = useCallback((points: Vec2[], curve: boolean) => {
    setDraft(null);
    setAxisHint(null);
    const loop = cleanDraftLoop(points);
    if (loop.length < 3) {
      useUIStore.getState().showToast('围成版片至少需要 3 个不同的点');
      return;
    }

    try {
      useProjectStore.getState().executeCommand(new CreatePanelFromPointsCommand(loop, { smooth: curve }));
    } catch (err) {
      reportActionError(err, '闭合版片失败');
    }
  }, []);

  const commitPolyline = useCallback((d: Extract<DraftState, { tool: 'polyline' }>) => {
    setAxisHint(null);
    const points = toPatternPoints(d.points, panelOffsetCm(heightOffsets, d.panelId));
    const least = d.mode === 'hole' ? 3 : 2;
    if (points.length < least) {
      setDraft(null);
      useUIStore.getState().showToast(d.mode === 'split'
        ? '分割线至少需要 2 个点，且两端要落在轮廓边上'
        : d.mode === 'hole' ? '内孔至少需要 3 个点' : '内部线至少需要 2 个点');
      return;
    }

    const command = d.mode === 'line'
      ? new AddInternalLineCommand(d.panelId, points)
      : d.mode === 'split'
        ? new OutlineSplitCommand(d.panelId, points)
        : new OutlineHoleCommand(d.panelId, points);
    setDraft(null);
    try {
      useProjectStore.getState().executeCommand(command);
    } catch (err) {
      reportActionError(err);
    }
  }, [heightOffsets]);

  const pickPanel = useCallback(
    (world: Vec2): string | null => visiblePanelUnderPoint(heights, outlines, world, HIT_RADIUS_PX / view.scale),
    [heights, outlines, view.scale],
  );

  const handleAssetDragOver = (e: React.DragEvent) => {
    const payload = isAssetDrag(e) ? currentAssetDrag() : null;
    if (!payload) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const world = eventWorld(e);
    const panelId = world ? pickPanel(world) : null;
    setHoverTarget(panelId ? { kind: 'panel', id: panelId } : null);
    setDropHint(world && panelId && payload.kind === 'trim'
      ? { pos: world, radiusCm: payload.asset.sizeMm / 20 }
      : null);
  };

  const handleAssetDragLeave = (e: React.DragEvent) => {
    if (!isAssetDrag(e)) return;
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setHoverTarget(null);
    setDropHint(null);
  };

  const handleAssetDrop = (e: React.DragEvent) => {
    const payload = readAssetDrag(e);
    if (!payload) return;
    e.preventDefault();
    endAssetDrag();
    setHoverTarget(null);
    setDropHint(null);
    const world = eventWorld(e);
    const panelId = world ? pickPanel(world) : null;
    if (!world || !panelId) {
      useUIStore.getState().showToast('拖到版片上才能应用');
      return;
    }

    if (payload.kind === 'trim') {
      placeTrimOnPanel(panelId, toPatternPoint(world, panelOffsetCm(heightOffsets, panelId)), payload.asset);
      return;
    }

    applyFabricDrag([panelId], payload);
  };

  const pickEdge = useCallback(
    (world: Vec2) => nearestEdgeSegment(heights, Object.keys(heights.edges), world, HIT_RADIUS_PX / view.scale),
    [heights, view.scale],
  );

  const pickInsertTarget = useCallback((world: Vec2): InsertTarget | null => {
    const edgeIds = selectedPanelIds.flatMap(id => pattern.panels[id]?.outlineEdgeIds ?? []);
    const scope = edgeIds.length > 0 ? edgeIds : Object.keys(heights.edges);
    const hit = nearestEdgeSegment(heights, scope, world, HIT_RADIUS_PX / view.scale);
    return hit ? insertTargetOnEdge(heights, hit, world, MIDPOINT_SNAP_PX / view.scale) : null;
  }, [selectedPanelIds, pattern, heights, view.scale]);

  const seamEndAt = useCallback((side: SeamSide, world: Vec2, radius: number): boolean | null => {
    const low = pointAtT(heights, side.edgeId, side.t0);
    const high = pointAtT(heights, side.edgeId, side.t1);
    const toLow = low ? Math.hypot(low.x - world.x, low.y - world.y) : Infinity;
    const toHigh = high ? Math.hypot(high.x - world.x, high.y - world.y) : Infinity;
    if (Math.min(toLow, toHigh) > radius) return null;
    return toLow <= toHigh;
  }, [heights]);

  const showInsertHint = useCallback((next: InsertTarget | null) => {
    setInsertHint(prev => (sameInsertTarget(prev, next) ? prev : next));
  }, []);

  const startPanelDrag = (panelIds: string[], anchor: Vec2, world: Vec2) => {
    const movable = panelIds.filter(id => !pattern.panels[id]?.locked);
    if (movable.length === 0) return;
    const geom = panelMoveGeometry(pattern, movable);
    if (geom.pointIds.length === 0) return;
    dragRef.current = { kind: 'move', target: { kind: 'panels', panelIds: movable }, geom, anchor, startWorld: world, offset: null };
  };

  const startPointDrag = (pointIds: string[], anchor: Vec2, world: Vec2) => {
    const movable = pointIds.filter(id => panelsOfPoint(pattern, id).every(pid => !pattern.panels[pid]?.locked));
    if (movable.length === 0) return;
    const geom = pointMoveGeometry(pattern, movable);
    if (geom.pointIds.length === 0) return;
    dragRef.current = { kind: 'move', target: { kind: 'points', pointIds: movable }, geom, anchor, startWorld: world, offset: null };
  };

  const pickVertex = (target: Vec2, radius: number): string | null => {
    let bestId: string | null = null;
    let bestScore = radius;
    for (const candidate of pointCandidates) {
      const distance = Math.hypot(candidate.pos.x - target.x, candidate.pos.y - target.y);
      if (distance > radius) continue;
      const preferred = panelsOfPoint(pattern, candidate.id).some(id => selectedPanelIds.includes(id));
      const score = preferred ? distance - 1e-6 : distance;
      if (score <= bestScore) {
        bestScore = score;
        bestId = candidate.id;
      }
    }

    return bestId;
  };

  const executeTranslation = useCallback((target: MoveTarget, delta: Vec2) => {
    try {
      const command = target.kind === 'internalVertex'
        ? new MoveGeometryCommand({
          pointIds: [],
          lineVertices: target.indices.map(index => ({ lineId: target.lineId, index })),
        }, delta, { label: '移动内部线顶点' })
        : target.kind === 'points'
          ? pointMoveCommand(pattern, target.pointIds, delta)
          : panelMoveCommand(pattern, target.panelIds, delta);
      if (command) useProjectStore.getState().executeCommand(command);
    } catch (err) {
      reportActionError(err);
    }
  }, [pattern]);

  const pickHandle = useCallback(
    (world: Vec2) => pickPointHandle(heights, idsOfKind(selection, 'point'), world, HIT_RADIUS_PX / view.scale),
    [heights, selection, view.scale],
  );

  const pickMark = useCallback((world: Vec2): { kind: 'notch' | 'annotation'; id: string } | null => {
    const radius = HIT_RADIUS_PX / view.scale;
    for (const notch of Object.values(heights.notches ?? {})) {
      const p = pointAtT(heights, notch.edgeId, notch.t);
      if (p && Math.hypot(p.x - world.x, p.y - world.y) <= radius) return { kind: 'notch', id: notch.id };
    }

    for (const note of Object.values(heights.annotations ?? {})) {
      if (Math.hypot(note.pos.x - world.x, note.pos.y - world.y) <= radius) return { kind: 'annotation', id: note.id };
    }

    return null;
  }, [heights, view.scale]);

  const pickPrintHandle = useCallback((world: Vec2): string | null => {
    const radius = HIT_RADIUS_PX / view.scale;
    for (const printId of idsOfKind(selection, 'print')) {
      const print = heights.prints?.[printId];
      if (!print?.visible) continue;
      const frame = printFrame(heights, print);
      if (frame?.some(corner => Math.hypot(corner.x - world.x, corner.y - world.y) <= radius)) return printId;
    }

    return null;
  }, [heights, selection, view.scale]);

  const onPrintFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const printId = pendingPrintRef.current;
    pendingPrintRef.current = null;
    if (!file || !printId) return;
    if (file.size > MAX_PRINT_BYTES) {
      useUIStore.getState().showToast('图片超过 8 MB，请压缩后再插入');
      return;
    }

    try {
      const artwork = await readPrintImage(file, PRINT_IMAGE_MAX_EDGE);
      const print = project.pattern.prints?.[printId];
      const patch: Partial<Omit<Print, 'id' | 'panelId'>> = {
        imageUrl: artwork.url,
        imageName: file.name,
        ...printImageFields(artwork.pixelSize, artwork.sourceSize),
      };
      if (print && printAspectLocked(print)) {
        Object.assign(patch, printSizeWithAspect(artwork.sourceSize.x / Math.max(1, artwork.sourceSize.y), print));
      }

      useProjectStore.getState().executeCommand(new UpdatePrintCommand(printId, patch));
    } catch (err) {
      reportActionError(err);
    }
  };

  const { handlePointerDown, handlePointerMove, handlePointerUp } = useViewportPointer({
    activeTool, pattern, heights, outlines, pointCandidates, selection, view, heightOffsets, pointOffsets,
    trimKind, dragRef, draftRef, setIsPanning, setView, setDraft, setPreview, setRectWorld, setHoverTarget,
    setHoverRole, setMarkHint, setInsertHint, setSeamHover, setSnapHint, eventWorld, getCanvasSize,
    commitNudge, spaceDown, draftWorld, resolvePlacedPoint, executeTranslation, clearSnapHint, clearAxisHint,
    pickPanel, pickEdge, pickInsertTarget, seamEndAt, showInsertHint, pickVertex, pickHandle, pickMark,
    pickPrintHandle, startPanelDrag, startPointDrag, fitToPattern,
  });

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (draft && draft.tool === 'pen') {
      commitPen(draft.points, draft.curve);
      return;
    }

    const world = eventWorld(e);
    if (!world) return;
    const row = pickElements(heights, world, HIT_RADIUS_PX / view.scale, ['print']);
    const element = row ? parseElementNodeId(row) : null;
    const print = element?.kind === 'print' ? pattern.prints?.[element.id] : null;
    if (print) {
      pendingPrintRef.current = print.id;
      printInputRef.current?.click();
      return;
    }

    if (!pickPanel(world)) fitToPattern();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || keyboardBlocked()) return;
      const ui = useUIStore.getState();
      if (!is2DFocus(ui.layout, ui.focus)) return;
      const d = draftRef.current;
      if (!d) return;
      if (e.key === 'Escape') { setDraft(null); setAxisHint(null); return; }
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (d.tool === 'pen' || d.tool === 'polyline') {
          setDraft(d.points.length <= 1 ? null : { ...d, points: d.points.slice(0, -1) } as DraftState);
        }

        return;
      }

      if (e.key === 'Enter') {
        if (d.tool === 'pen') commitPen(d.points, d.curve);
        if (d.tool === 'polyline') commitPolyline(d);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commitPen, commitPolyline]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || keyboardBlocked()) return;
      const ui = useUIStore.getState();
      if (!is2DFocus(ui.layout, ui.focus)) return;
      if (e.key !== 'r' && e.key !== 'R') return;
      const prints = useProjectStore.getState().project.pattern.prints ?? {};
      const commands = idsOfKind(ui.selection, 'print').flatMap(id => {
        const print = prints[id];
        if (!print) return [];
        const angle = (((print.angleDeg + (e.shiftKey ? -15 : 15)) % 360) + 360) % 360;
        return [new UpdatePrintCommand(id, { angleDeg: angle })];
      });
      if (commands.length === 0) return;
      e.preventDefault();
      try {
        useProjectStore.getState().executeCommand(
          commands.length === 1 ? commands[0]! : new CompositeCommand('旋转印花', commands),
        );
      } catch (err) {
        reportActionError(err);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const cursor = viewport2DCursor({
    tool: activeTool,
    panning: isPanning,
    spaceDown,
    hover: hoverRole,
    dragging: preview !== null,
  });
  const seamStep: SeamStep = (() => {
    if (draft?.tool !== 'seam') return 'pick';
    const sides = draft.sides;
    const last = sides[sides.length - 1];
    if (!last) return 'pick';
    if (last.startLow === undefined) return sides.length === 1 ? 'start' : 'startB';
    return 'second';
  })();
  const hint = statusHint(layout, view.scale, activeTool, seamStep);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
      onDragOver={handleAssetDragOver}
      onDragLeave={handleAssetDragLeave}
      onDrop={handleAssetDrop}
    >
      <canvas
        ref={canvasRef}
        data-testid="viewport-2d"
        style={{ display: 'block', cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => { clearSnapHint(); clearAxisHint(); setHoverTarget(null); setMarkHint(null); setHoverRole(null); showInsertHint(null); setSeamHover(null); }}
        onDoubleClick={handleDoubleClick}
        onContextMenu={e => e.preventDefault()}
      />
      <input ref={printInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPrintFile} />
      <ViewportHint>{hint}</ViewportHint>
    </div>
  );
}

function sameInsertTarget(a: InsertTarget | null, b: InsertTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.edgeId !== b.edgeId || a.snapped !== b.snapped) return false;
  if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) > 1e-9) return false;
  if (!a.mid || !b.mid) return !a.mid && !b.mid;
  return Math.hypot(a.mid.x - b.mid.x, a.mid.y - b.mid.y) <= 1e-9;
}
