import type { Command, ProjectContext } from '../../core/command/command';
import type { Fabric, Pattern } from '../../core/model/types';
import { createFabric } from '../../core/model/defaults';
import { appendPattern } from './patternLayout';
import { type GarmentTemplate } from './garmentTemplate';

/** Pattern and fabric bookkeeping a template command restores on undo. */
interface Snapshot {
  pattern: Pattern;
  fabrics: Record<string, Fabric>;
}

function take(ctx: ProjectContext): Snapshot {
  return { pattern: ctx.project.pattern, fabrics: ctx.project.fabrics };
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

/** Copies every entity collection so appended panels never touch the pattern being replaced. */
function detachedPattern(pattern: Pattern): Pattern {
  return {
    ...pattern,
    points: { ...pattern.points },
    edges: { ...pattern.edges },
    darts: { ...pattern.darts },
    internalLines: { ...pattern.internalLines },
    panels: { ...pattern.panels },
    seams: { ...pattern.seams },
  };
}

/** Replaces the pattern with a template's output. */
export class ApplyTemplateCommand implements Command {
  readonly label: string;
  private saved: Snapshot | null = null;

  constructor(private readonly template: GarmentTemplate, private readonly params: Record<string, number>) {
    this.label = `应用${template.name}模板`;
  }

  execute(ctx: ProjectContext): void {
    this.saved = take(ctx);
    const fabric = templateFabric(ctx);
    ctx.project.pattern = this.template.generate(this.params, fabric.id);
  }

  undo(ctx: ProjectContext): void {
    if (this.saved) restore(ctx, this.saved);
  }
}

/** Adds a template's panels beside the existing ones, keeping the current pattern. */
export class AppendTemplateCommand implements Command {
  readonly label: string;
  private saved: Snapshot | null = null;

  constructor(private readonly template: GarmentTemplate, private readonly params: Record<string, number>) {
    this.label = `追加${template.name}模板`;
  }

  execute(ctx: ProjectContext): void {
    this.saved = take(ctx);
    const fabric = templateFabric(ctx);
    const pattern = detachedPattern(ctx.project.pattern);
    appendPattern(pattern, this.template.generate(this.params, fabric.id));
    ctx.project.pattern = pattern;
  }

  undo(ctx: ProjectContext): void {
    if (this.saved) restore(ctx, this.saved);
  }
}
