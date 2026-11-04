import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Pattern, Print, Vec2 } from '../../core/model/types';
import { sampleEdge, samplePanelOutline } from '../../pattern/panel/panelBuilder';
import { pointAtT } from '../../pattern/geom/edgeSample';
import { is2DFocus, isSplitLayout, useProjectStore, useUIStore, noteDrawnFrame, type ToolType, type ViewLayout } from '../../store/stores';
import {
  AddPointOnEdgeCommand, AddTopstitchCommand, AddTrimCommand, CompositeCommand, DeleteElementsCommand,
  UpdatePrintCommand, UpdateTrimCommand,
  edgePointIds, MoveGeometryCommand, panelMoveCommand, panelMoveGeometry, pointMoveCommand,
  pointMoveGeometry, previewMove, previewPanelMove, type MoveGeometry,
} from '../../core/command/patternCommands';
import { bodyLandmarks } from '../../avatar/landmarks';
import {
  panelHeightOffsets, panelMoveOffsets, panelOffsetCm, pointHeightOffsets, toHeightPattern, toPatternPoint, toPatternPoints,
} from './panelHeight';
import {
  CreatePanelFromPointsCommand, CreateRectCommand, CreateCircleCommand, CreateEllipseCommand,
} from '../../core/command/patternCreateCommands';
import { AddInternalLineCommand, CreateDartCommand, OutlineHoleCommand, OutlineSplitCommand } from '../../core/command/patternStructureCommands';
import { CreateFreeSeamCommand } from '../../core/command/patternSeamCommands';
import { SetPointHandleCommand } from '../../core/command/patternEditCommands';
import { CreateAnnotationCommand, CreateMeasurementCommand, CreateNotchCommand, MoveNotchCommand } from '../../core/command/patternProductionCommands';
import { elementNodeId, idsOfKind, parseElementNodeId } from '../elementSelection';
import { orderedSizes, sizeOutlines } from '../../pattern/grading/grading';
import {
  elementsInRect, hoverTargetKey, isPlacementTool, markHintKey, nearestEdgeSegment, nearestPointWithinRadius, panelIdOfEdge,
  panelsOfPoint, pickElements, pickHoverTarget, pickInternalLineVertex, pickPlacementFeedback, pickPointHandle,
  pickPressRole, visiblePanelUnderPoint, MARK_KINDS, PRODUCTION_KINDS,
  type HoverTarget, type MarkHint, type PressRole, type Rect,
} from './hitTest';
import { snapToGrid, type ViewTransform } from './viewMath';
import { collectSnapCandidates, constrainAngle, findSnapAtPattern, type SnapCandidate } from './snap';
import { drawScene, type PreviewDrag, type DisplayOptions } from './render';
import { viewport2DCursor } from './cursor';
import {
  cleanDraftLoop, DEFAULT_DART_INTAKE_CM, NOTCH_MID_T, orderedDartLegs, printCenter, printFrame, shapeFrame,
  type DraftState, type PolylineMode, type SeamSide,
} from './tools';
import { MAX_PRINT_BYTES } from '../../core/model/defaults';
import { readImageAsPngDataUrl } from '../../io/imageData';
import { useCanvasView } from './useCanvasView';
import { useNudgeSession } from './useNudgeSession';
import { ViewportHint } from '../widgets/viewportHint';
import { reportActionError } from '../widgets/toast';

/** What a pointer drag translates: whole panels, outline points, or internal-line vertices. */
type MoveTarget =
  | { kind: 'panels'; panelIds: string[] }
  | { kind: 'points'; pointIds: string[] }
  | { kind: 'internalVertex'; lineId: string; indices: number[] };

type Drag =
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

const HIT_RADIUS_PX = 8;
const SNAP_RADIUS_PX = 8;

/** Sweep below this fraction of an edge counts as a click, so the whole edge is taken. */
const SEAM_DRAG_MIN_T = 0.02;

/** Pattern copy with one notch slid along its edge, for the drag preview. */
function previewNotch(pattern: Pattern, notchId: string, t: number): Pattern {
  const notch = pattern.notches?.[notchId];
  if (!notch) return pattern;
  return { ...pattern, notches: { ...pattern.notches, [notchId]: { ...notch, t } } };
}

/** Pattern copy with one print's placement replaced, for the drag preview. */
function previewPrint(pattern: Pattern, printId: string, patch: Partial<Print>): Pattern {
  const print = pattern.prints?.[printId];
  if (!print) return pattern;
  return { ...pattern, prints: { ...pattern.prints, [printId]: { ...print, ...patch } } };
}

/** Pattern copy with one trim moved, for the drag preview. */
function previewTrim(pattern: Pattern, trimId: string, pos: Vec2): Pattern {
  const trim = pattern.trims?.[trimId];
  if (!trim) return pattern;
  return { ...pattern, trims: { ...pattern.trims, [trimId]: { ...trim, pos } } };
}

/** Text a newly placed annotation carries before the user edits it. */
const DEFAULT_ANNOTATION_TEXT = '标注';

/** Drafting tools whose rubber-band preview follows the cursor. */
const CURSOR_TOOLS = new Set<ToolType>(['line', 'curve', 'internalLine', 'split', 'hole', 'dart', 'measure']);

/** Step the seam tool is on, so the hint can name the next click. */
type SeamStep = 'pick' | 'start' | 'second' | 'startB';

/** Zoom readout with the gestures the current layout allows. */
const statusHint = (layout: ViewLayout, scale: number, tool: ToolType, seamStep: SeamStep): string => {
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
    const snap = findSnapAtPattern(heights, world, snapCandidates, SNAP_RADIUS_PX / view.scale, anchor);
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

  /**
   * Right-click numeric input: a length and angle while a pen stroke is open, otherwise an
   * exact dx/dy displacement of the selection.
   */
  const preciseInput = () => {
    const d = draftRef.current;
    if (d && d.tool === 'pen' && d.points.length > 0) {
      const raw = prompt('输入长度与角度(cm, °)', '10, 0');
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
    const raw = prompt('输入位移 dx,dy(cm)', '0, 0');
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
      preciseInput();
      return;
    }
    if (e.button !== 0) return;

    const radius = HIT_RADIUS_PX / view.scale;

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
      // A constrained step leaves the snapped position, so drop its marker.
      if (Math.hypot(placed.x - pos.x, placed.y - pos.y) > 1e-6) setSnapHint(null);
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
          new CreateAnnotationCommand(panelId, DEFAULT_ANNOTATION_TEXT, toPatternPoint(pos, panelOffsetCm(heightOffsets, panelId))),
        );
      } catch (err) {
        reportActionError(err);
      }
      return;
    }

    if (activeTool === 'measure') {
      const pointId = nearestPointWithinRadius(pointCandidates, world, HIT_RADIUS_PX / view.scale);
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

      // First click arms the dart on the edge under the cursor.
      if (!prev || prev.tool !== 'dart' || !prev.leg1) {
        const panelId = panelOwner(pattern, hit.edgeId);
        if (!panelId) return;
        setDraft({ tool: 'dart', panelId, leg1: { edgeId: hit.edgeId, t: hit.t }, leg2: null, cursor: pos });
        return;
      }

      // Second click picks the neighbouring leg; the dart tip follows the third click.
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
      // While a side waits for its start vertex, a click on either end answers it.
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
      // A click on empty canvas drops the picks made so far.
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
      // Clicking a vertex deletes it; the two points either side end up joined by one edge.
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
      // A press on an existing vertex selects it instead of splitting the edge beneath it, so
      // Delete removes that vertex and joins the two points either side.
      const pointId = pickVertex(world, radius);
      if (pointId) {
        const row = elementNodeId('point', pointId);
        if (e.ctrlKey || e.metaKey || e.shiftKey) useUIStore.getState().toggleSelection(row);
        else useUIStore.getState().select([row]);
        showInsertHint(null);
        return;
      }
      const hit = pickInsertEdge(world);
      if (hit) {
        try {
          const at = toPatternPoint(hit.point, panelOffsetCm(heightOffsets, panelIdOfEdge(pattern, hit.edgeId)));
          useProjectStore.getState().executeCommand(new AddPointOnEdgeCommand(hit.edgeId, at));
        } catch (err) {
          reportActionError(err);
        }
      }
      showInsertHint(null);
      return;
    }

    if (activeTool !== 'select') return;

    // Pick order here is mirrored by `pickPressRole()` for the cursor hint; keep the two in step.
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
      // A vertex press always drags vertices; the panel is moved by its body or outline instead.
      const picked = idsOfKind(selection, 'point');
      const group = picked.includes(pointId) ? picked : [pointId];
      useUIStore.getState().select(group.map(id => elementNodeId('point', id)));
      const anchor = heights.points[pointId]!.pos;
      startPointDrag(group, anchor, world);
      if (dragRef.current) e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Vertices of a selected internal line are drag handles; a closed ring moves both ends.
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

    // Trims, prints and topstitches sit inside the panel, so they are picked before the outline.
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
      // An edge drags the vertices it hangs on; an already selected edge drags the selected set.
      const picked = idsOfKind(selection, 'edge');
      const group = picked.includes(edgeHit.edgeId) ? picked : [edgeHit.edgeId];
      useUIStore.getState().select(group.map(id => elementNodeId('edge', id)));
      const edge = pattern.edges[edgeHit.edgeId]!;
      const anchor = heights.points[edge.startPointId]?.pos ?? edgeHit.point;
      startPointDrag(edgePointIds(pattern, group), anchor, world);
      if (dragRef.current) e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Production marks sit inside the panel area, so they are picked before the panel fill.
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
      const radius = HIT_RADIUS_PX / view.scale;
      if (activeTool === 'select') {
        const next = pickHoverTarget(heights, outlines, selection, world, radius);
        setHoverTarget(prev => (hoverTargetKey(prev) === hoverTargetKey(next) ? prev : next));
        const role = pickPressRole(heights, outlines, selection, world, radius);
        setHoverRole(prev => (prev === role ? prev : role));
      } else if (activeTool === 'point' || activeTool === 'deletePoint') {
        const id = pickVertex(world, radius);
        const next: HoverTarget | null = id ? { kind: 'point', id } : null;
        setHoverTarget(prev => (hoverTargetKey(prev) === hoverTargetKey(next) ? prev : next));
        // The point tool marks the insertion position; a vertex under the cursor wins the press.
        if (activeTool === 'point') {
          const hit = id ? null : pickInsertEdge(world);
          showInsertHint(hit ? { pos: hit.point, edgeId: hit.edgeId } : null);
        }
      } else if (isPlacementTool(activeTool)) {
        // Pre-highlight the placement tool's target and ghost its landing point.
        const placed = activeTool === 'annotation' ? resolvePlacedPoint(world, e.altKey).pos : null;
        const feedback = pickPlacementFeedback(activeTool, heights, outlines, pointCandidates, world, radius, placed);
        setHoverTarget(prev => (hoverTargetKey(prev) === hoverTargetKey(feedback.hover) ? prev : feedback.hover));
        setMarkHint(prev => (markHintKey(prev) === markHintKey(feedback.hint) ? prev : feedback.hint));
      } else {
        setHoverTarget(prev => (prev === null ? prev : null));
        setMarkHint(prev => (prev === null ? prev : null));
      }
      if (activeTool === 'seam') {
        // While a start vertex is awaited the cursor should read as "pick an end", not an edge.
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

    // A drag moves the geometry under the old hover, so drop its preview until the next move.
    setHoverTarget(prev => (prev === null ? prev : null));
    setMarkHint(prev => (prev === null ? prev : null));

    // Only the shape and handle drags place a point; every other drag leaves no marker behind.
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
      // A constrained corner leaves the snapped position, so drop its marker.
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
      // Invert the rotation so the drag reads as half-width and half-height in the rectangle frame.
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      const size = { widthCm: Math.max(0.1, Math.abs(localX) * 2), heightCm: Math.max(0.1, Math.abs(localY) * 2) };
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
        // A panel move rides the drape anchors, so the offsets follow the shift exactly; a point
        // move deforms outlines, so those frames resample the bounds.
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

  /**
   * A press takes one seam side: a click takes the whole edge, a drag narrows it to the swept
   * interval. Each side then waits for its start vertex before the next side can be picked.
   */
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
    // The other side cannot be picked again: a seam never joins an edge to itself.
    if (sides.some((s, i) => i !== sides.length - 1 && s.startLow !== undefined && s.edgeId === pick.edgeId)) {
      setDraft({ tool: 'seam', sides, drag: null });
      return;
    }
    if (last && last.startLow === undefined) {
      // Re-pressing the pending side drops it; pressing another edge replaces it.
      setDraft(last.edgeId === pick.edgeId
        ? (sides.length === 1 ? null : { tool: 'seam', sides: sides.slice(0, -1), drag: null })
        : { tool: 'seam', sides: [...sides.slice(0, -1), pick], drag: null });
      return;
    }
    if (last?.edgeId === pick.edgeId) {
      // Re-pressing a finished side replaces its interval and clears its start.
      setDraft({ tool: 'seam', sides: [...sides.slice(0, -1), pick], drag: null });
      return;
    }
    setDraft({ tool: 'seam', sides: [...sides, pick], drag: null });
  };

  /** Writes the seam; the side that starts from its low end becomes A so the arrow can follow it. */
  const createSeam = (first: SeamSide, second: SeamSide) => {
    const [a, b] = first.startLow === false && second.startLow === true ? [second, first] : [first, second];
    // Opposite start ends sew in reverse; both from the high ends share the same orientation.
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

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => { clearSnapHint(); setHoverTarget(null); setMarkHint(null); setHoverRole(null); showInsertHint(null); setSeamHover(null); }}
        onDoubleClick={handleDoubleClick}
        onContextMenu={e => e.preventDefault()}
      />
      <input ref={printInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPrintFile} />
      <ViewportHint>{statusHint(layout, view.scale, activeTool, seamStep)}</ViewportHint>
    </div>
  );
}

/** Panel owning an outline edge. */
function panelOwner(pattern: Pattern, edgeId: string): string | null {
  for (const panel of Object.values(pattern.panels)) {
    if (panel.outlineEdgeIds.includes(edgeId)) return panel.id;
  }
  return null;
}

/** Nearest point on an edge's sampled polyline. */
function nearestOnEdge(pattern: Pattern, edgeId: string, p: Vec2): Vec2 {
  let best = p;
  let bestD = Infinity;
  for (const q of sampleEdge(pattern, edgeId)) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

/** Arc-length fraction of the nearest sample on an edge. */
function arcFraction(pattern: Pattern, edgeId: string, p: Vec2): number {
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
function withHandle(pattern: Pattern, pointId: string, which: 'in' | 'out', handle: Vec2): Pattern {
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

