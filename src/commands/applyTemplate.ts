import type { Command, Fabric, Pattern, ProjectContext } from '@/model/types';
import type { GarmentTemplate } from '@/pattern';

import { bodyLandmarks } from '@/avatar';
import { appendPattern, layoutByHeight } from '@/garment';
import { createFabric } from '@/model';

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

function templateFabric(ctx: ProjectContext): Fabric {
  const existing = Object.values(ctx.project.fabrics)[0];
  if (existing) return existing;
  const fabric = createFabric('cotton');
  ctx.project.fabrics[fabric.id] = fabric;
  return fabric;
}

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
    layoutByHeight(pattern, bodyLandmarks(ctx.project.avatar.params));
    pattern.templateKey = this.template.key;
    ctx.project.pattern = pattern;
  }

  undo(ctx: ProjectContext): void {
    if (this.saved) restore(ctx, this.saved);
  }
}

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
    layoutByHeight(pattern, body);
    const incoming = this.template.generate(fabric.id);
    layoutByHeight(incoming, body);
    appendPattern(pattern, incoming);
    pattern.templateKey = this.template.key;
    ctx.project.pattern = pattern;
  }

  undo(ctx: ProjectContext): void {
    if (this.saved) restore(ctx, this.saved);
  }
}

export class ArrangePanelsCommand implements Command {
  readonly label = '自动排位';
  private saved: Snapshot | null = null;

  constructor(private readonly gapCm = 6) {}

  execute(ctx: ProjectContext): void {
    this.saved = take(ctx);
    const pattern = detachedPattern(ctx.project.pattern);
    layoutByHeight(pattern, bodyLandmarks(ctx.project.avatar.params), this.gapCm);
    ctx.project.pattern = pattern;
  }

  undo(ctx: ProjectContext): void {
    if (this.saved) restore(ctx, this.saved);
  }
}
