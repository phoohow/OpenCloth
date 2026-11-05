import type { Command, ProjectContext } from '@/commands/command';
import type { Pattern, SizeDef, Vec2 } from '@/model/types';
import { edgeLength } from '@/pattern/geom';
import { samplePanelOutline } from '@/pattern/panel';
import { hasSelfIntersection } from '@/common/geom/offset';
import { SnapshotCommand } from '@/commands/patternSnapshot';
import { resolveSize } from '@/pattern/grading';

export { resolveSize } from '@/pattern/grading';

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
