import type { Command, ProjectContext } from './command';
import type { ArcGeom, Panel, Pattern, PatternEdge, PointKind, Vec2 } from '../model/types';
import { genId, DEFAULT_MESH_RESOLUTION_CM } from '../model/defaults';
import { setEdgeCurve } from '../../pattern/geom/bezier';
import { arcFromThreePoints } from '../../pattern/geom/arc';
import { samplePanelOutline } from '../../pattern/panel/panelBuilder';
import { SnapshotCommand } from './patternSnapshot';

/** Placement options shared by the create commands. */
export interface CreatePanelOptions {
  name?: string;
  seamAllowanceCm?: number;
}

/** Gap kept between a freshly placed panel and the existing pattern, in cm. */
const PLACE_GAP_CM = 4;

/** Adds a point at `pos` and returns its id. */
export function newPoint(pattern: Pattern, pos: Vec2, kind?: PointKind): string {
  const id = genId('pt');
  pattern.points[id] = { id, pos: { x: pos.x, y: pos.y }, ...(kind ? { kind } : {}) };
  return id;
}

/** Adds an edge between two point ids and returns its id. */
export function newEdge(
  pattern: Pattern, type: PatternEdge['type'], startPointId: string, endPointId: string, arc?: ArcGeom,
): string {
  const id = genId('edge');
  const edge: PatternEdge = { id, type, startPointId, endPointId };
  if (arc) edge.arc = arc;
  pattern.edges[id] = edge;
  return id;
}

/** Builds a closed chain of line edges over fresh points; returns the edge ids in order. */
export function addClosedLineOutline(pattern: Pattern, pts: Vec2[]): string[] {
  const pointIds = pts.map(p => newPoint(pattern, p));
  const edgeIds: string[] = [];
  for (let i = 0; i < pointIds.length; i++) {
    edgeIds.push(newEdge(pattern, 'line', pointIds[i], pointIds[(i + 1) % pointIds.length]));
  }
  return edgeIds;
}

/** Name that does not clash with a panel already in the pattern. */
export function nextPanelName(pattern: Pattern, base = '版片'): string {
  const taken = new Set(Object.values(pattern.panels).map(p => p.name));
  let index = Object.keys(pattern.panels).length + 1;
  while (taken.has(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}

/** First fabric id in the project, or a stable default when the project has none. */
export function fabricIdFor(ctx: ProjectContext): string {
  return Object.keys(ctx.project.fabrics)[0] ?? 'fabric_default';
}

/** Adds a panel over the given outline edges and returns it. */
export function makePanel(
  pattern: Pattern, ctx: ProjectContext, opts: CreatePanelOptions, outlineEdgeIds: string[],
): Panel {
  const panel: Panel = {
    id: genId('panel'),
    name: opts.name ?? nextPanelName(pattern),
    outlineEdgeIds,
    dartIds: [],
    internalLineIds: [],
    seamAllowanceCm: opts.seamAllowanceCm ?? 1,
    fabricId: fabricIdFor(ctx),
    meshResolutionCm: DEFAULT_MESH_RESOLUTION_CM,
    visible: true,
    locked: false,
  };
  pattern.panels[panel.id] = panel;
  return panel;
}

/** Translation that moves a shape's bbox to the right of the existing panels, non-overlapping. */
export function placeRight(pattern: Pattern, min: Vec2, _max: Vec2): Vec2 {
  const panels = Object.values(pattern.panels);
  if (panels.length === 0) return { x: 0, y: 0 };
  let maxX = -Infinity;
  for (const panel of panels) {
    for (const p of samplePanelOutline(pattern, panel)) maxX = Math.max(maxX, p.x);
  }
  if (!Number.isFinite(maxX)) return { x: 0, y: 0 };
  return { x: maxX + PLACE_GAP_CM - min.x, y: 0 };
}

/** Creates a panel from a closed outline of at least three authored points. */
export class CreatePanelFromPointsCommand extends SnapshotCommand {
  readonly label = '创建多边形版片';
  constructor(private points: Vec2[], private opts: CreatePanelOptions = {}) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    if (this.points.length < 3) throw new Error('轮廓至少需要 3 个点');
    const edgeIds = addClosedLineOutline(pattern, this.points);
    makePanel(pattern, ctx, this.opts, edgeIds);
  }
}

/** Creates a rectangular panel from a width, height and center. */
export class CreateRectCommand extends SnapshotCommand {
  readonly label = '创建矩形版片';
  constructor(private w: number, private h: number, private center: Vec2, private opts: CreatePanelOptions = {}) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    if (this.w <= 0 || this.h <= 0) throw new Error('矩形宽高需为正数');
    const c = this.center;
    const corners = [
      { x: c.x - this.w / 2, y: c.y - this.h / 2 },
      { x: c.x + this.w / 2, y: c.y - this.h / 2 },
      { x: c.x + this.w / 2, y: c.y + this.h / 2 },
      { x: c.x - this.w / 2, y: c.y + this.h / 2 },
    ];
    const edgeIds = addClosedLineOutline(pattern, corners);
    makePanel(pattern, ctx, this.opts, edgeIds);
  }
}

/** Creates a circular panel from four arc edges. */
export class CreateCircleCommand extends SnapshotCommand {
  readonly label = '创建圆形版片';
  constructor(private r: number, private center: Vec2, private opts: CreatePanelOptions = {}) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    if (this.r <= 0) throw new Error('圆半径需为正数');
    const c = this.center;
    const at = (deg: number): Vec2 => {
      const a = (deg * Math.PI) / 180;
      return { x: c.x + this.r * Math.cos(a), y: c.y + this.r * Math.sin(a) };
    };
    const anchors = [at(0), at(90), at(180), at(270)];
    const pointIds = anchors.map(p => newPoint(pattern, p));
    const edgeIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const a = anchors[i], b = anchors[(i + 1) % 4];
      const arc = arcFromThreePoints(a, at(i * 90 + 45), b);
      if (!arc) throw new Error('圆弧无法生成');
      edgeIds.push(newEdge(pattern, 'arc', pointIds[i], pointIds[(i + 1) % 4], arc));
    }
    makePanel(pattern, ctx, this.opts, edgeIds);
  }
}

/** Creates an elliptical panel from four bezier edges. */
export class CreateEllipseCommand extends SnapshotCommand {
  readonly label = '创建椭圆版片';
  constructor(private rx: number, private ry: number, private center: Vec2, private opts: CreatePanelOptions = {}) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    if (this.rx <= 0 || this.ry <= 0) throw new Error('椭圆半轴需为正数');
    const c = this.center;
    const k = 0.5522847498;
    const vertices = [
      { x: c.x + this.rx, y: c.y },
      { x: c.x, y: c.y + this.ry },
      { x: c.x - this.rx, y: c.y },
      { x: c.x, y: c.y - this.ry },
    ];
    // Cubic control points of each CCW quadrant, from vertex i to i+1.
    const handles = [
      [{ x: c.x + this.rx, y: c.y + this.ry * k }, { x: c.x + this.rx * k, y: c.y + this.ry }],
      [{ x: c.x - this.rx * k, y: c.y + this.ry }, { x: c.x - this.rx, y: c.y + this.ry * k }],
      [{ x: c.x - this.rx, y: c.y - this.ry * k }, { x: c.x - this.rx * k, y: c.y - this.ry }],
      [{ x: c.x + this.rx * k, y: c.y - this.ry }, { x: c.x + this.rx, y: c.y - this.ry * k }],
    ];
    const pointIds = vertices.map(v => newPoint(pattern, v));
    const edgeIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = newEdge(pattern, 'bezier', pointIds[i], pointIds[(i + 1) % 4]);
      setEdgeCurve(pattern, pattern.edges[id], handles[i][0], handles[i][1]);
      edgeIds.push(id);
    }
    makePanel(pattern, ctx, this.opts, edgeIds);
  }
}

/** Wraps an existing connected edge chain into a new panel that shares those edges. */
export class CreatePanelFromEdgesCommand extends SnapshotCommand {
  readonly label = '由边创建版片';
  constructor(private edgeIds: string[], private opts: CreatePanelOptions = {}) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    if (this.edgeIds.length < 3) throw new Error('轮廓至少需要 3 条边');
    for (const id of this.edgeIds) {
      if (!pattern.edges[id]) throw new Error(`边 ${id} 不存在`);
    }
    makePanel(pattern, ctx, this.opts, [...this.edgeIds]);
  }
}

/** Command interface re-export so barrel consumers can type against it. */
export type { Command };
