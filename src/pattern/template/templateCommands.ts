import type { Command, Fabric, Pattern, ProjectContext } from '@/model/types';
import { createFabric } from '@/model';
import { appendPattern, layoutByHeight } from '@/pattern/template/sheetLayout';
import { type GarmentTemplate } from '@/pattern/template/garmentTemplate';
import { bodyLandmarks } from '@/avatar';

/** Pattern and fabric bookkeeping a template command restores on undo. */
interface Snapshot {
  pattern: Pattern;
  fabrics: Record<string, Fabric>;
}

function take(ctx: ProjectContext): Snapshot {
  return { pattern: ctx.project.pattern, fabrics: { ...ctx.project.fabrics } };
}

function restore(ctx: ProjectContext, saved: Snapshot): void {
  ctx.project.pattern = saved.pattern;
  ctx.project.fabrics = saved.fabrics;
}

/** Reuses the project's first fabric, adding a cotton one when there is none. */
function templateFabric(ctx: ProjectContext): Fabric {
  const existing = Object.values(ctx.project.fabrics)[0];
  if (existing) return existing;
  const fabric = createFabric('cotton');
  ctx.project.fabrics[fabric.id] = fabric;
  return fabric;
}

/**
 * Copies every entity collection, and every entity in it, so neither appended panels nor a fresh
 * layout ever reach back into the pattern the undo snapshot keeps.
 */
function detachedPattern(pattern: Pattern): Pattern {
  const copy = <T,>(items: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(items).map(([id, item]) => [id, { ...item }]));
  return {
    ...pattern,
    points: copy(pattern.points),
    edges: copy(pattern.edges),
    darts: copy(pattern.darts),
    internalLines: Object.fromEntries(
      Object.entries(pattern.internalLines).map(([id, line]) => [id, { ...line, points: [...line.points] }]),
    ),
    panels: copy(pattern.panels),
    seams: copy(pattern.seams),
    notches: copy(pattern.notches),
    annotations: copy(pattern.annotations),
    measurements: copy(pattern.measurements),
    prints: copy(pattern.prints),
    topstitches: copy(pattern.topstitches),
    trims: copy(pattern.trims),
  };
}

/** Replaces the pattern with a template's output. */
export class ApplyTemplateCommand implements Command {
  readonly label: string;
  private saved: Snapshot | null = null;

  constructor(private readonly template: GarmentTemplate) {
    this.label = `替换版型（${template.name}）`;
  }

  execute(ctx: ProjectContext): void {
    this.saved = take(ctx);
    const fabric = templateFabric(ctx);
    const pattern = this.template.generate(fabric.id);
    // The 2D pane draws each piece at its body height, so the sheet is laid out in that view.
    layoutByHeight(pattern, bodyLandmarks(ctx.project.avatar.params));
    ctx.project.pattern = pattern;
  }

  undo(ctx: ProjectContext): void {
    if (this.saved) restore(ctx, this.saved);
  }
}

/** Adds a template's panels beside the existing ones, keeping the current pattern. */
export class AppendTemplateCommand implements Command {
  readonly label: string;
  private saved: Snapshot | null = null;

  constructor(private readonly template: GarmentTemplate) {
    this.label = `追加版型（${template.name}）`;
  }

  execute(ctx: ProjectContext): void {
    this.saved = take(ctx);
    const fabric = templateFabric(ctx);
    const body = bodyLandmarks(ctx.project.avatar.params);
    const pattern = detachedPattern(ctx.project.pattern);
    // Both sheets are laid out in the height view on their own, then the new garment is carried to
    // the right of the old one: two garments never share a column, so neither lands on the other.
    layoutByHeight(pattern, body);
    const incoming = this.template.generate(fabric.id);
    layoutByHeight(incoming, body);
    appendPattern(pattern, incoming);
    ctx.project.pattern = pattern;
  }

  undo(ctx: ProjectContext): void {
    if (this.saved) restore(ctx, this.saved);
  }
}

/** Re-flows the whole sheet in the body-height view, keeping every piece where it belongs. */
export class ArrangePanelsCommand implements Command {
  readonly label = '自动排位';
  private saved: Snapshot | null = null;

  constructor(private readonly gapCm = 6) {}

  execute(ctx: ProjectContext): void {
    this.saved = take(ctx);
    // Laid out on a copy: the snapshot has to keep the sheet as it was before the move.
    const pattern = detachedPattern(ctx.project.pattern);
    layoutByHeight(pattern, bodyLandmarks(ctx.project.avatar.params), this.gapCm);
    ctx.project.pattern = pattern;
  }

  undo(ctx: ProjectContext): void {
    if (this.saved) restore(ctx, this.saved);
  }
}
