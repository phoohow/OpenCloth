import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Pattern, Print, Vec2 } from '../../core/model/types';
import { sampleEdge, samplePanelOutline } from '../../pattern/panel/panelBuilder';
import { pointAtT } from '../../pattern/geom/edgeSample';
import { is2DFocus, isSplitLayout, useProjectStore, useUIStore, noteDrawnFrame, type ToolType, type ViewLayout } from '../../store/stores';
import {
  AddPointOnEdgeCommand, AddTopstitchCommand, AddTrimCommand, CompositeCommand,
  MovePanelsCommand, MovePointsCommand, UpdatePrintCommand, UpdateTrimCommand,
  panelMoveGeometry, pointMoveGeometry, previewMove, type MoveGeometry,
} from '../../core/command/patternCommands';
import {
  CreatePanelFromPointsCommand, CreateRectCommand, CreateCircleCommand, CreateEllipseCommand,
} from '../../core/command/patternCreateCommands';
import { AddInternalLineCommand, CreateDartCommand, OutlineHoleCommand, OutlineSplitCommand } from '../../core/command/patternStructureCommands';
import { CreateFreeSeamCommand } from '../../core/command/patternSeamCommands';
import { SetPointHandleCommand } from '../../core/command/patternEditCommands';
import { CreateAnnotationCommand, CreateMeasurementCommand, CreateNotchCommand, MoveNotchCommand } from '../../core/command/patternProductionCommands';
import { elementNodeId, idsOfKind, parseElementNodeId, type PatternElementKind } from '../elementSelection';
import { orderedSizes, sizeOutlines } from '../../pattern/grading/grading';
import {
  elementsInRect, nearestEdgeSegment, nearestPointWithinRadius, panelIdOfEdge, panelsOfPoint,
  pickElements, visiblePanelUnderPoint, type Rect,
} from './hitTest';
import { snapToGrid, type ViewTransform } from './viewMath';
import { collectSnapCandidates, constrainAngle, findSnapAtPattern, type SnapCandidate } from './snap';
import { drawScene, type PreviewDrag, type DisplayOptions } from './render';
import {
  DEFAULT_DART_INTAKE_CM, orderedDartLegs, printCenter, printFrame, shapeFrame,
  type DraftState, type PolylineMode,
} from './tools';
import { MAX_PRINT_BYTES } from '../../core/model/defaults';
import { readImageAsPngDataUrl } from '../../io/imageData';
import { useCanvasView } from './useCanvasView';
import { useNudgeSession } from './useNudgeSession';
import { ViewportHint } from '../widgets/viewportHint';
import { reportActionError } from '../widgets/toast';

/** What a pointer drag translates: whole panels rigidly, or a single vertex. */
type MoveTarget =
  | { kind: 'panels'; panelIds: string[] }
  | { kind: 'points'; pointIds: string[] };

type Drag =
  | { kind: 'pan'; startX: number; startY: number; ox: number; oy: number }
  | { kind: 'move'; target: MoveTarget; geom: MoveGeometry; anchor: Vec2; startWorld: Vec2; offset: Vec2 | null }
  | { kind: 'handle'; pointId: string; which: 'in' | 'out'; target: Vec2 }
  | { kind: 'shape'; shape: 'rect' | 'circle' | 'ellipse'; start: Vec2; current: Vec2 }
  | { kind: 'seamdrag'; edgeId: string; start: Vec2 }
  | { kind: 'notch'; notchId: string; edgeId: string; t: number }
  | { kind: 'printmove'; printId: string; startCenter: Vec2; startWorld: Vec2; center: Vec2 }
  | { kind: 'printresize'; printId: string; size: { widthCm: number; heightCm: number } }
  | { kind: 'trimmove'; trimId: string; startPos: Vec2; startWorld: Vec2; pos: Vec2 }
  | { kind: 'rect'; startWorld: Vec2 };

const HIT_RADIUS_PX = 8;
const SNAP_RADIUS_PX = 8;

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

/** Marks a plain click selects inside a panel body, after edges and before the panel fill. */
const MARK_KINDS: PatternElementKind[] = ['seam', 'dart', 'internal', 'measurement'];

/** Production objects that win over the panel outline; trims first because their symbols are small. */
const PRODUCTION_KINDS: PatternElementKind[] = ['trim', 'print', 'topstitch'];

/** Zoom readout with the gestures the current layout allows. */
const statusHint = (layout: ViewLayout, scale: number): string =>
  isSplitLayout(layout)
    ? `2D 制版 · 缩放 ${scale.toFixed(1)}x · 单击选片/拖点移动 · F适应 · 快捷键需点击聚焦本窗格`
    : `2D 制版 · 缩放 ${scale.toFixed(1)}x · 单击选片/Ctrl加选/空白拖框选 · 拖点或拖动版片（0.5cm吸附，Alt自由）· 右键输入长度角度或精确位移 · Delete删除/方向键微调 · 点工具单击边加点 · 滚轮定点缩放 · F或双击空白适应 · 中键或空格平移`;

/** 2D drafting canvas: draws the pattern and turns pointer and keyboard input into pattern edits. */
export function Viewport2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [hoverPointId, setHoverPointId] = useState<string | null>(null);
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
  const selectedPanelIds = useMemo(
    () => idsOfKind(selection, 'panel').filter(id => !!pattern.panels[id]),
    [selection, pattern],
  );

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

  const snapCandidates = useMemo(() => collectSnapCandidates(pattern), [pattern]);

  /** Nested size-chart outlines drawn behind the active geometry when the layer is on. */
  const gradingOutlines = useMemo(() => {
    if (!displayOptions.gradingOverlay) return [];
    return orderedSizes(project)
      .filter(size => size.id !== project.activeSizeId)
      .map(size => ({
        label: size.label,
        polygons: Object.keys(pattern.panels).flatMap(id => sizeOutlines(pattern, id, size.id, project.activeSizeId)),
      }));
  }, [displayOptions.gradingOverlay, project, pattern]);

  /** Resolve drafting input: snap candidate, else grid, else freehand with Alt. */
  const draftWorld = useCallback((world: Vec2, freehand: boolean): Vec2 => {
    if (freehand) { setSnapHint(null); return world; }
    const snap = findSnapAtPattern(pattern, world, snapCandidates, SNAP_RADIUS_PX / view.scale);
    setSnapHint(snap);
    return snap ? snap.pos : snapToGrid(world);
  }, [snapCandidates, view.scale, pattern]);

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
      showSeams: activeTool === 'seam' || idsOfKind(selection, 'seam').length > 0 || idsOfKind(selection, 'edge').length > 0,
      draft, snapHint, display: displayOptions as DisplayOptions, gradingOutlines,
      onPrintImageReady: () => useUIStore.getState().requestRepaint(),
    });
    noteDrawnFrame('2d', performance.now());
  }, [pattern, view, selection, hoverPointId, preview, rectWorld, activeTool, draft, snapHint, displayOptions, gradingOutlines]);

  useEffect(() => { render(); }, [render, repaintToken]);

  // Tool switches clear any in-progress stroke.
  useEffect(() => { setDraft(null); setSnapHint(null); }, [activeTool]);

  const { getCanvasSize, eventWorld, fitToPattern } =
    useCanvasView({ pattern, view, setView, render, canvasRef, containerRef });
  const { commitNudge, spaceDown } = useNudgeSession(pattern, setPreview);

  // Hands the in-flight drag pattern to the 3D pane while a preview tier is on; the drag end,
  // a switch to 关闭 and an unmount all run the cleanup and drop it.
  useEffect(() => {
    useUIStore.getState().setEditPreviewPattern(preview && editPreview !== 'off' ? preview.pattern : null);
    return () => useUIStore.getState().setEditPreviewPattern(null);
  }, [preview, editPreview]);

  const commitPen = useCallback((points: Vec2[]) => {
    setDraft(null);
    if (points.length < 3) return;
    try {
      useProjectStore.getState().executeCommand(new CreatePanelFromPointsCommand(points));
    } catch (err) {
      reportActionError(err);
    }
  }, []);

  /** A polyline draft becomes an internal line, a split cut, or a hole loop on Enter. */
  const commitPolyline = useCallback((d: Extract<DraftState, { tool: 'polyline' }>) => {
    const command = d.mode === 'line'
      ? new AddInternalLineCommand(d.panelId, d.points)
      : d.mode === 'split'
        ? new OutlineSplitCommand(d.panelId, d.points)
        : new OutlineHoleCommand(d.panelId, d.points);
    setDraft(null);
    try {
      useProjectStore.getState().executeCommand(command);
    } catch (err) {
      reportActionError(err);
    }
  }, []);

  const pickPanel = useCallback(
    (world: Vec2): string | null => visiblePanelUnderPoint(pattern, outlines, world, HIT_RADIUS_PX / view.scale),    [pattern, outlines, view.scale],
  );

  const pickEdge = useCallback(
    (world: Vec2) => nearestEdgeSegment(pattern, Object.keys(pattern.edges), world, HIT_RADIUS_PX / view.scale),
    [pattern, view.scale],
  );

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

  /** Nearest drawn handle of a selected smooth point, for handle dragging. */
  const pickHandle = useCallback((world: Vec2): { pointId: string; which: 'in' | 'out'; pos: Vec2 } | null => {
    const radius = HIT_RADIUS_PX / view.scale;
    for (const pointId of idsOfKind(selection, 'point')) {
      const point = pattern.points[pointId];
      if (!point) continue;
      for (const which of ['in', 'out'] as const) {
        const handle = which === 'in' ? point.handleIn : point.handleOut;
        if (handle && Math.hypot(handle.x - world.x, handle.y - world.y) <= radius) {
          return { pointId, which, pos: { x: handle.x, y: handle.y } };
        }
      }
    }
    return null;
  }, [pattern, selection, view.scale]);

  /** Notch or annotation under the cursor, picked before edges and panels. */
  const pickMark = useCallback((world: Vec2): { kind: 'notch' | 'annotation'; id: string } | null => {
    const radius = HIT_RADIUS_PX / view.scale;
    for (const notch of Object.values(pattern.notches ?? {})) {
      const p = pointAtT(pattern, notch.edgeId, notch.t);
      if (p && Math.hypot(p.x - world.x, p.y - world.y) <= radius) return { kind: 'notch', id: notch.id };
    }
    for (const note of Object.values(pattern.annotations ?? {})) {
      if (Math.hypot(note.pos.x - world.x, note.pos.y - world.y) <= radius) return { kind: 'annotation', id: note.id };
    }
    return null;
  }, [pattern, view.scale]);

  /** Corner handle of a selected print, used to scale it. */
  const pickPrintHandle = useCallback((world: Vec2): string | null => {
    const radius = HIT_RADIUS_PX / view.scale;
    for (const printId of idsOfKind(selection, 'print')) {
      const print = pattern.prints?.[printId];
      if (!print?.visible) continue;
      const frame = printFrame(pattern, print);
      if (frame?.some(corner => Math.hypot(corner.x - world.x, corner.y - world.y) <= radius)) return printId;
    }
    return null;
  }, [pattern, selection, view.scale]);

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
    const pointIds = idsOfKind(selection, 'point').filter(id => !!pattern.points[id]);
    if (panelIds.length === 0 && pointIds.length === 0) return;
    const raw = prompt('输入位移 dx,dy(cm)', '0, 0');
    if (!raw) return;
    const [dx, dy] = raw.split(/[,，\s]+/).map(Number);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (dx === 0 && dy === 0) return;
    commitNudge();
    try {
      if (panelIds.length > 0) {
        useProjectStore.getState().executeCommand(new MovePanelsCommand(panelIds, { x: dx, y: dy }));
      } else {
        useProjectStore.getState().executeCommand(new MovePointsCommand(new Map(pointIds.map(id => [id, { x: dx, y: dy }]))));
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
    const pos = draftWorld(world, e.altKey);

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
      try {
        useProjectStore.getState().executeCommand(new AddTrimCommand(panelId, trimKind, pos));
      } catch (err) {
        reportActionError(err);
      }
      return;
    }

    if (activeTool === 'line' || activeTool === 'curve') {
      setDraft(d => {
        const points = d && d.tool === 'pen' ? d.points : [];
        const last = points[points.length - 1];
        const placed = e.shiftKey && last ? constrainAngle(last, pos) : pos;
        return { tool: 'pen', points: [...points, placed], cursor: placed, smoothNext: activeTool === 'curve' && !!e.ctrlKey };
      });
      return;
    }

    if (activeTool === 'rect' || activeTool === 'circle' || activeTool === 'ellipse') {
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
        useProjectStore.getState().executeCommand(new CreateNotchCommand(hit.edgeId, arcFraction(pattern, hit.edgeId, hit.point)));
      } catch (err) {
        reportActionError(err);
      }
      return;
    }

    if (activeTool === 'annotation') {
      const panelId = pickPanel(world);
      if (!panelId) return;
      try {
        useProjectStore.getState().executeCommand(new CreateAnnotationCommand(panelId, DEFAULT_ANNOTATION_TEXT, pos));
      } catch (err) {
        reportActionError(err);
      }
      return;
    }

    if (activeTool === 'measure') {
      const pointId = nearestPointWithinRadius(pointCandidates, world, HIT_RADIUS_PX / view.scale);
      if (!pointId) return;
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
          new CreateDartCommand(prev.panelId, prev.leg1.edgeId, prev.leg1.t, prev.leg2.edgeId, prev.leg2.t, DEFAULT_DART_INTAKE_CM, pos),
        );
      } catch (err) {
        reportActionError(err);
      }
      setDraft(null);
      return;
    }

    if (activeTool === 'seam') {
      const hit = pickEdge(world);
      if (!hit) return;
      dragRef.current = { kind: 'seamdrag', edgeId: hit.edgeId, start: hit.point };
      setDraft(d => ({
        tool: 'seam',
        pickA: d && d.tool === 'seam' ? d.pickA : null,
        drag: { edgeId: hit.edgeId, start: hit.point, current: hit.point },
      }));
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (activeTool === 'point') {
      const edgeIds = selectedPanelIds.flatMap(id => pattern.panels[id]?.outlineEdgeIds ?? []);
      const scope = edgeIds.length > 0 ? edgeIds : Object.keys(pattern.edges);
      const hit = nearestEdgeSegment(pattern, scope, world, radius);
      if (hit) {
        try {
          useProjectStore.getState().executeCommand(new AddPointOnEdgeCommand(hit.edgeId, hit.point));
        } catch (err) {
          reportActionError(err);
        }
      }
      return;
    }

    if (activeTool !== 'select') return;

    const handle = pickHandle(world);
    if (handle) {
      dragRef.current = { kind: 'handle', pointId: handle.pointId, which: handle.which, target: handle.pos };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const pointId = nearestPointWithinRadius(pointCandidates, world, radius);
    if (pointId) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        useUIStore.getState().toggleSelection(elementNodeId('point', pointId));
        return;
      }
      const owners = panelsOfPoint(pattern, pointId).filter(id => pattern.panels[id]?.visible);
      const pointPos = pattern.points[pointId]!.pos;
      useUIStore.getState().select([elementNodeId('point', pointId)]);
      if (owners.some(id => selectedPanelIds.includes(id))) {
        startPointDrag([pointId], pointPos, world);
      } else if (selectedPanelIds.length > 0) {
        startPanelDrag(selectedPanelIds, pointPos, world);
      } else if (owners.length > 0) {
        startPanelDrag([owners[0]!], pointPos, world);
      }
      if (dragRef.current) e.currentTarget.setPointerCapture(e.pointerId);
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
    const productionRow = pickElements(pattern, world, radius, PRODUCTION_KINDS);
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
      } else {
        useUIStore.getState().select([row]);
      }
      return;
    }

    // Production marks sit inside the panel area, so they are picked before the panel fill.
    const markRow = pickElements(pattern, world, radius, MARK_KINDS);
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
      if (activeTool === 'select' || activeTool === 'point') {
        const id = nearestPointWithinRadius(pointCandidates, world, HIT_RADIUS_PX / view.scale);
        setHoverPointId(prev => (prev === id ? prev : id));
      }
      if (CURSOR_TOOLS.has(activeTool)) {
        const pos = draftWorld(world, e.altKey);
        setDraft(d => (d && 'cursor' in d ? ({ ...d, cursor: pos } as DraftState) : d));
      }
      return;
    }

    if (drag.kind === 'seamdrag') {
      const pos = draftWorld(world, e.altKey);
      dragRef.current = { ...drag, current: pos } as typeof drag;
      setDraft(d => (d && d.tool === 'seam' && d.drag
        ? { ...d, drag: { ...d.drag, current: nearestOnEdge(pattern, drag.edgeId, pos) } }
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
      dragRef.current = { ...drag, current };
      setDraft({ tool: 'shape', shape: drag.shape, start: drag.start, current });
      return;
    }

    if (drag.kind === 'handle') {
      const pos = draftWorld(world, e.altKey);
      dragRef.current = { ...drag, target: pos };
      setPreview({ pattern: withHandle(pattern, drag.pointId, drag.which, pos), ghost: null });
      return;
    }

    if (drag.kind === 'notch') {
      const hit = nearestEdgeSegment(pattern, [drag.edgeId], world, Infinity);
      if (!hit) return;
      drag.t = Math.min(1, Math.max(0, arcFraction(pattern, drag.edgeId, hit.point)));
      setPreview({ pattern: previewNotch(pattern, drag.notchId, drag.t), ghost: null });
      return;
    }

    if (drag.kind === 'printmove') {
      const center = {
        x: drag.startCenter.x + world.x - drag.startWorld.x,
        y: drag.startCenter.y + world.y - drag.startWorld.y,
      };
      drag.center = center;
      setPreview({ pattern: previewPrint(pattern, drag.printId, { center }), ghost: null });
      return;
    }

    if (drag.kind === 'printresize') {
      const print = pattern.prints?.[drag.printId];
      if (!print) return;
      const center = printCenter(pattern, print);
      if (!center) return;
      const rad = (print.angleDeg * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const dx = world.x - center.x, dy = world.y - center.y;
      // Invert the rotation so the drag reads as half-width and half-height in the rectangle frame.
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      const size = { widthCm: Math.max(0.1, Math.abs(localX) * 2), heightCm: Math.max(0.1, Math.abs(localY) * 2) };
      drag.size = size;
      setPreview({ pattern: previewPrint(pattern, drag.printId, size), ghost: null });
      return;
    }

    if (drag.kind === 'trimmove') {
      const pos = {
        x: drag.startPos.x + world.x - drag.startWorld.x,
        y: drag.startPos.y + world.y - drag.startWorld.y,
      };
      drag.pos = pos;
      setPreview({ pattern: previewTrim(pattern, drag.trimId, pos), ghost: null });
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
      useProjectStore.getState().executeCommand(new SetPointHandleCommand(drag.pointId, drag.which, drag.target));
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
      const ids = elementsInRect(pattern, rect, useUIStore.getState().marqueeKinds);
      useUIStore.getState().select(ids);
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  /** One seam drag picks an interval on one edge; the second interval closes the seam pair. */
  const commitSeamPick = (drag: Extract<Drag, { kind: 'seamdrag' }>) => {
    const current = (drag as { current?: Vec2 }).current ?? drag.start;
    const t0 = Math.min(arcFraction(pattern, drag.edgeId, drag.start), arcFraction(pattern, drag.edgeId, current));
    const t1 = Math.max(arcFraction(pattern, drag.edgeId, drag.start), arcFraction(pattern, drag.edgeId, current));
    const pick = { edgeId: drag.edgeId, t0, t1 };
    const d = draftRef.current;
    if (!d || d.tool !== 'seam') { setDraft(null); return; }
    if (!d.pickA) {
      setDraft({ tool: 'seam', pickA: pick, drag: null });
      return;
    }
    try {
      useProjectStore.getState().executeCommand(
        new CreateFreeSeamCommand(d.pickA.edgeId, d.pickA.t0, d.pickA.t1, pick.edgeId, pick.t0, pick.t1),
      );
    } catch (err) {
      reportActionError(err);
    }
    setDraft({ tool: 'seam', pickA: null, drag: null });
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (draft && draft.tool === 'pen') {
      commitPen(draft.points);
      return;
    }
    const world = eventWorld(e);
    if (!world) return;
    const row = pickElements(pattern, world, HIT_RADIUS_PX / view.scale, ['print']);
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
        if (d.tool === 'pen') commitPen(d.points);
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

  const dragging = dragRef.current?.kind === 'move' || dragRef.current?.kind === 'rect';
  const cursor = isPanning || (preview && dragRef.current?.kind === 'move')
    ? 'grabbing'
    : spaceDown
      ? 'grab'
      : hoverPointId
        ? 'grab'
        : activeTool === 'select' || activeTool === 'point' || activeTool === 'topstitch' || activeTool === 'trim'
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
        onContextMenu={e => e.preventDefault()}
      />
      <input ref={printInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPrintFile} />
      <ViewportHint>{statusHint(layout, view.scale)}</ViewportHint>
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

