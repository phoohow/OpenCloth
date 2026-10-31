import type { Command, ProjectContext } from './command';
import type { Pattern, SizeDef, Vec2 } from '../model/types';
import { edgeLength } from '../../pattern/geom/edgeSample';
import { samplePanelOutline } from '../../pattern/panel/panelBuilder';
import { hasSelfIntersection } from '../../pattern/geom/offset';
import { arcFromThreePoints, evalArc } from '../../pattern/geom/arc';
import { SnapshotCommand } from './patternSnapshot';

const ZERO: Vec2 = { x: 0, y: 0 };
const addV = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const subV = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const midV = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const deltaOf = (grading: Record<string, Vec2> | undefined, sizeId: string): Vec2 => grading?.[sizeId] ?? ZERO;

/**
 * Copy of the pattern with every point resolved to `toSizeId`, converted from `fromSizeId`.
 * Curve handles shift by the average of their two anchor points' deltas, and arc edges refit
 * through their shifted midpoint so both stay attached to the graded endpoints; ids stay stable.
 */
export function resolveSize(pattern: Pattern, fromSizeId: string | undefined, toSizeId: string): Pattern {
  const out = structuredClone(pattern);
  const pointDelta = (p: Pattern['points'][string]): Vec2 => subV(deltaOf(p.grading, toSizeId), p.grading?.[fromSizeId ?? ''] ?? ZERO);
  const outEdgeByStart = new Map<string, Pattern['edges'][string]>();
  const inEdgeByEnd = new Map<string, Pattern['edges'][string]>();
  for (const edge of Object.values(out.edges)) {
    if (!outEdgeByStart.has(edge.startPointId)) outEdgeByStart.set(edge.startPointId, edge);
    if (!inEdgeByEnd.has(edge.endPointId)) inEdgeByEnd.set(edge.endPointId, edge);
  }
  for (const id of Object.keys(out.points)) {
    const point = out.points[id];
    const d = pointDelta(point);
    const neighbour = (edgeId: string): Vec2 => pointDelta(out.points[edgeId] ?? { id: edgeId, pos: ZERO });
    point.pos = addV(point.pos, d);
    if (point.handleOut) {
      const edge = outEdgeByStart.get(id);
      point.handleOut = addV(point.handleOut, edge ? midV(d, neighbour(edge.endPointId)) : d);
    }
    if (point.handleIn) {
      const edge = inEdgeByEnd.get(id);
      point.handleIn = addV(point.handleIn, edge ? midV(d, neighbour(edge.startPointId)) : d);
    }
  }
  for (const edge of Object.values(out.edges)) {
    if (edge.type !== 'arc' || !edge.arc) continue;
    const start = out.points[edge.startPointId];
    const end = out.points[edge.endPointId];
    if (!start || !end) continue;
    const shift = midV(pointDelta(start), pointDelta(end));
    edge.arc = arcFromThreePoints(start.pos, addV(evalArc(edge.arc, 0.5), shift), end.pos)
      ?? { ...edge.arc, center: addV(edge.arc.center, shift) };
  }
  return out;
}

/** A grading problem found across the size range. */
export interface GradingIssue {
  targetId: string;
  message: string;
}

/**
 * Checks the size chart's grading: edge lengths must grow with size and outlines must stay
 * simple under every size. Returns all issues; an empty array means grading is consistent.
 */
export function validateGrading(pattern: Pattern, sizes: SizeDef[]): GradingIssue[] {
  const issues: GradingIssue[] = [];
  const ordered = [...sizes].sort((a, b) => a.seq - b.seq);
  if (ordered.length < 2) return issues;

  const resolved = ordered.map(size => ({ size, pattern: resolveSize(pattern, undefined, size.id) }));

  for (const edgeId of Object.keys(pattern.edges)) {
    let prevLen = -Infinity;
    let prevLabel = '';
    for (const entry of resolved) {
      const len = edgeLength(entry.pattern, edgeId);
      if (len < prevLen - 1e-3) {
        issues.push({
          targetId: edgeId,
          message: `边 ${edgeId} 的长度在尺码「${prevLabel}」到「${entry.size.label}」之间不递增`,
        });
        break;
      }
      prevLen = len;
      prevLabel = entry.size.label;
    }
  }

  for (const entry of resolved) {
    for (const panel of Object.values(entry.pattern.panels)) {
      if (hasSelfIntersection(samplePanelOutline(entry.pattern, panel))) {
        issues.push({ targetId: panel.id, message: `版片「${panel.name}」在尺码「${entry.size.label}」下轮廓自相交` });
      }
    }
  }
  return issues;
}

/** Records one point's grading offset for a size. */
export class SetPointGradingCommand extends SnapshotCommand {
  readonly label = '设置放码点';
  constructor(private pointId: string, private sizeId: string, private delta: Vec2) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const point = pattern.points[this.pointId];
    if (!point) throw new Error('点不存在');
    (point.grading ??= {})[this.sizeId] = { x: this.delta.x, y: this.delta.y };
  }
}

/** Records many points' grading offsets as a single undo step. */
export class SetPointsGradingCommand extends SnapshotCommand {
  readonly label = '批量设置放码';
  /** @param map pointId -> sizeId -> delta in cm */
  constructor(private map: Record<string, Record<string, Vec2>>) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    for (const [pointId, bySize] of Object.entries(this.map)) {
      const point = pattern.points[pointId];
      if (!point) throw new Error(`点 ${pointId} 不存在`);
      point.grading ??= {};
      for (const [sizeId, delta] of Object.entries(bySize)) {
        point.grading[sizeId] = { x: delta.x, y: delta.y };
      }
    }
  }
}

/** Resolves the pattern's geometry to a size and marks it active; undo restores the prior state. */
export class ApplySizeCommand implements Command {
  readonly label = '应用到尺码';
  private prevPattern: Pattern | null = null;
  private prevActive: string | undefined;
  constructor(private sizeId: string) { }

  execute(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    this.prevPattern = structuredClone(pattern);
    this.prevActive = ctx.project.activeSizeId;
    Object.assign(pattern, resolveSize(pattern, this.prevActive, this.sizeId));
    ctx.project.activeSizeId = this.sizeId;
  }

  undo(ctx: ProjectContext): void {
    if (!this.prevPattern) return;
    Object.assign(ctx.project.pattern, structuredClone(this.prevPattern));
    ctx.project.activeSizeId = this.prevActive;
    this.prevPattern = null;
  }
}
