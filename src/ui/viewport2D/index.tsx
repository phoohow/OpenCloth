import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Vec2 } from '@/model/types';
import { samplePanelOutline } from '@/pattern/panel';
import { pointAtT } from '@/pattern/geom';
import { is2DFocus, useProjectStore, useUIStore, noteDrawnFrame } from '@/store';
import {
  CompositeCommand, UpdatePrintCommand,
  MoveGeometryCommand, panelMoveCommand, panelMoveGeometry, pointMoveCommand, pointMoveGeometry,
} from '@/commands';
import { bodyLandmarks } from '@/avatar';
import {
  panelHeightOffsets, panelOffsetCm, pointHeightOffsets, toHeightPattern, toPatternPoints,
} from '@/ui/viewport2D/panelHeight';
import { CreatePanelFromPointsCommand } from '@/commands';
import { AddInternalLineCommand, OutlineHoleCommand, OutlineSplitCommand } from '@/commands';
import { idsOfKind, parseElementNodeId } from '@/model';
import { orderedSizes, sizeOutlines } from '@/pattern/grading';
import {
  nearestEdgeSegment, panelsOfPoint, pickElements, pickPointHandle, visiblePanelUnderPoint,
  type HoverTarget, type MarkHint, type PressRole,
} from '@/ui/viewport2D/hitTest';
import { snapToGrid, type ViewTransform } from '@/ui/viewport2D/viewMath';
import { collectSnapCandidates, findSnapAtPattern, type SnapCandidate } from '@/ui/viewport2D/snap';
import { drawScene, type PreviewDrag, type DisplayOptions } from '@/ui/viewport2D/render';
import { viewport2DCursor } from '@/ui/viewport2D/cursor';
import {
  cleanDraftLoop, printFrame, type DraftState, type SeamSide,
} from '@/ui/viewport2D/tools';
import { HIT_RADIUS_PX, statusHint, type Drag, type MoveTarget, type SeamStep } from '@/ui/viewport2D/viewportDraft';
import { useViewportPointer } from '@/ui/viewport2D/useViewportPointer';
import { MAX_PRINT_BYTES } from '@/model';
import { readImageAsPngDataUrl } from '@/io/serialization';
import { useCanvasView } from '@/ui/viewport2D/useCanvasView';
import { useNudgeSession } from '@/ui/viewport2D/useNudgeSession';
import { ViewportHint } from '@/ui/widgets/viewportHint';
import { reportActionError } from '@/ui/widgets/toast';

/** 2D drafting canvas: draws the pattern and turns pointer and keyboard input into pattern edits. */
export function Viewport2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);
  const [markHint, setMarkHint] = useState<MarkHint | null>(null);
  const [hoverRole, setHoverRole] = useState<PressRole>(null);
  /** Edge under the cursor while the seam tool is armed, shown as the side about to be picked. */
  const [seamHover, setSeamHover] = useState<{ edgeId: string; t0: number; t1: number } | null>(null);
  const [insertHint, setInsertHint] = useState<{ pos: Vec2; edgeId: string } | null>(null);
  const [preview, setPreview] = useState<PreviewDrag | null>(null);
  const [rectWorld, setRectWorld] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [draft, setDraft] = useState<DraftState>(null);
  const [snapHint, setSnapHint] = useState<SnapCandidate | null>(null);
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
  // Centimetres each panel is raised so its pattern y reads as height above the ground, and the
  // pattern itself shifted by them: the pane draws and picks on the height view, commands still edit
  // the model, which differs only by these offsets.
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

  /** Nested size-chart outlines drawn behind the active geometry when the layer is on. */
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

  /** Drops the snap marker; no state write when it is already clear. */
  const clearSnapHint = useCallback(() => {
    setSnapHint(hint => (hint ? null : hint));
  }, []);

  /**
   * Resolve a placed point and its snap marker: snap candidate, else grid, else the raw position
   * with Alt. `anchor` is the open stroke's last point, enabling tangency and offset snapping.
   */
  const resolvePlacedPoint = useCallback((world: Vec2, freehand: boolean, anchor?: Vec2): { pos: Vec2; snap: SnapCandidate | null } => {
    if (freehand) return { pos: world, snap: null };
    const snap = findSnapAtPattern(heights, world, snapCandidates, 8 / view.scale, anchor);
    const pos = snap ? snap.pos : snapToGrid(world);
    return { pos, snap: snap ?? { pos, kind: 'grid' } };
  }, [snapCandidates, view.scale, heights]);

  /** Resolve a placed point and show its snap marker. */
  const draftWorld = useCallback((world: Vec2, freehand: boolean, anchor?: Vec2): Vec2 => {
    const { pos, snap } = resolvePlacedPoint(world, freehand, anchor);
    setSnapHint(snap);
    return pos;
  }, [resolvePlacedPoint]);

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

    const shown = preview ? preview.pattern : pattern;
    const shownOffsets = preview ? (preview.offsets ?? panelHeightOffsets(shown, body)) : heightOffsets;
    drawScene(ctx, w, h, {
      pattern: preview ? toHeightPattern(shown, shownOffsets) : heights,
      meshPattern: shown,
      offsets: shownOffsets,
      view, simulation: project.scene.simulation,
      selection, hover: hoverTarget, markHint, preview: preview && { ...preview, pattern: toHeightPattern(shown, shownOffsets) }, rect: rectWorld,
      showSeams: activeTool === 'seam' || idsOfKind(selection, 'seam').length > 0,
      draft, snapHint, insertHint, seamHover, hoverDelete: activeTool === 'deletePoint', display: displayOptions as DisplayOptions,
      gradingOutlines,
      onPrintImageReady: () => useUIStore.getState().requestRepaint(),
    });
    noteDrawnFrame('2d', performance.now());
  }, [pattern, heights, heightOffsets, body, view, project.scene.simulation, selection, hoverTarget, markHint, preview, rectWorld, activeTool, draft, snapHint, insertHint, seamHover, displayOptions, gradingOutlines]);

  useEffect(() => { render(); }, [render, repaintToken]);

  // Tool switches clear any in-progress stroke and the hover affordance of the previous tool.
  useEffect(() => {
    setDraft(null); setSnapHint(null); setHoverRole(null); setHoverTarget(null);
    setMarkHint(null); setInsertHint(null); setSeamHover(null);
  }, [activeTool]);

  const { getCanvasSize, eventWorld, fitToPattern } =
    useCanvasView({ pattern: heights, view, setView, render, canvasRef, containerRef });
  const { commitNudge, spaceDown } = useNudgeSession(pattern, setPreview);

  // Hands the in-flight drag pattern to the 3D pane while a preview tier is on; the drag end,
  // a switch to 关闭 and an unmount all run the cleanup and drop it.
  useEffect(() => {
    useUIStore.getState().setEditPreviewPattern(preview && editPreview !== 'off' ? preview.pattern : null);
    return () => useUIStore.getState().setEditPreviewPattern(null);
  }, [preview, editPreview]);

  /** Closes a freehand stroke into a panel; `curve` keeps it a spline instead of straight edges. */
  const commitPen = useCallback((points: Vec2[], curve: boolean) => {
    setDraft(null);
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

  /** A polyline draft becomes an internal line, a split cut, or a hole loop on Enter. */
  const commitPolyline = useCallback((d: Extract<DraftState, { tool: 'polyline' }>) => {
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

  const pickEdge = useCallback(
    (world: Vec2) => nearestEdgeSegment(heights, Object.keys(heights.edges), world, HIT_RADIUS_PX / view.scale),
    [heights, view.scale],
  );

  /**
   * Edge the point tool would split under the cursor: the selected panels' outlines while panels
   * are selected, every edge otherwise.
   */
  const pickInsertEdge = useCallback((world: Vec2) => {
    const edgeIds = selectedPanelIds.flatMap(id => pattern.panels[id]?.outlineEdgeIds ?? []);
    const scope = edgeIds.length > 0 ? edgeIds : Object.keys(heights.edges);
    return nearestEdgeSegment(heights, scope, world, HIT_RADIUS_PX / view.scale);
  }, [selectedPanelIds, pattern, heights, view.scale]);

  /**
   * Which end of a picked seam side the cursor is on: true for the low-t end, false for the high-t
   * end, null when neither is within reach.
   */
  const seamEndAt = useCallback((side: SeamSide, world: Vec2, radius: number): boolean | null => {
    const low = pointAtT(heights, side.edgeId, side.t0);
    const high = pointAtT(heights, side.edgeId, side.t1);
    const toLow = low ? Math.hypot(low.x - world.x, low.y - world.y) : Infinity;
    const toHigh = high ? Math.hypot(high.x - world.x, high.y - world.y) : Infinity;
    if (Math.min(toLow, toHigh) > radius) return null;
    return toLow <= toHigh;
  }, [heights]);

  /** Insertion marker of the point tool; a target that did not move keeps the stored one. */
  const showInsertHint = useCallback((next: { pos: Vec2; edgeId: string } | null) => {
    setInsertHint(prev => {
      if (!prev || !next) return prev === next ? prev : next;
      const same = prev.edgeId === next.edgeId
        && Math.hypot(prev.pos.x - next.pos.x, prev.pos.y - next.pos.y) < 1e-9;
      return same ? prev : next;
    });
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

  /**
   * Vertex under a press, within radius. Vertices that coincide because panels are stacked resolve
   * to the one whose panel is already selected, so a press stays on the panel in hand.
   */
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

  /**
   * Commits a move. Panels take the vertical part as a body height through their drape and only the
   * horizontal part as a pattern translation; points translate as they are.
   */
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

  /** Drawn handle of a selected smooth point, for handle dragging. */
  const pickHandle = useCallback(
    (world: Vec2) => pickPointHandle(heights, idsOfKind(selection, 'point'), world, HIT_RADIUS_PX / view.scale),
    [heights, selection, view.scale],
  );

  /** Notch or annotation under the cursor, picked before edges and panels. */
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

  /** Corner handle of a selected print, used to scale it. */
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

  /** Swaps the artwork of the print that was double-clicked. */
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
      const imageUrl = await readImageAsPngDataUrl(file);
      useProjectStore.getState().executeCommand(new UpdatePrintCommand(printId, { imageUrl, imageName: file.name }));
    } catch (err) {
      reportActionError(err);
    }
  };

  const { handlePointerDown, handlePointerMove, handlePointerUp } = useViewportPointer({
    activeTool, pattern, heights, outlines, pointCandidates, selection, view, heightOffsets, pointOffsets,
    trimKind, dragRef, draftRef, setIsPanning, setView, setDraft, setPreview, setRectWorld, setHoverTarget,
    setHoverRole, setMarkHint, setInsertHint, setSeamHover, setSnapHint, eventWorld, getCanvasSize,
    commitNudge, spaceDown, draftWorld, resolvePlacedPoint, executeTranslation, clearSnapHint,
    pickPanel, pickEdge, pickInsertEdge, seamEndAt, showInsertHint, pickVertex, pickHandle, pickMark,
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

  // Stroke keyboard: Enter/Escape/Backspace drive the pen and polyline drafts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const ui = useUIStore.getState();
      if (!is2DFocus(ui.layout, ui.focus)) return;
      const d = draftRef.current;
      if (!d) return;
      if (e.key === 'Escape') { setDraft(null); return; }
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

  // R turns the selected prints by 15°, Shift+R turns them back.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
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
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        data-testid="viewport-2d"
        style={{ display: 'block', cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => { clearSnapHint(); setHoverTarget(null); setMarkHint(null); setHoverRole(null); showInsertHint(null); setSeamHover(null); }}
        onDoubleClick={handleDoubleClick}
        onContextMenu={e => e.preventDefault()}
      />
      <input ref={printInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPrintFile} />
      <ViewportHint>{hint}</ViewportHint>
    </div>
  );
}
