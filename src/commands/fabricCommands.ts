import type { Command, ProjectContext } from '@/commands/command';
import type { Fabric, FabricPresetKey, Panel, Project } from '@/model/types';

import { createFabric, FABRIC_PRESET_LABELS } from '@/model';
import { uniqueFabricName } from '@/model';

type PanelSnapshot = Panel[];

function writePanel(ctx: ProjectContext, panel: Panel): void {
  ctx.project.pattern.panels[panel.id] = panel;
}

function capture(ctx: ProjectContext, panelIds: string[]): PanelSnapshot {
  return panelIds.map(id => ctx.project.pattern.panels[id]).filter(Boolean);
}

function wear(ctx: ProjectContext, panelIds: string[], fabricId: string): void {
  for (const id of panelIds) {
    const panel = ctx.project.pattern.panels[id];
    if (panel) writePanel(ctx, { ...panel, fabricId });
  }
}

export class AssignFabricCommand implements Command {
  readonly label = '指定材质';
  private previous: PanelSnapshot = [];

  constructor(
    private readonly panelIds: string[],
    private readonly fabricId: string,
  ) {}

  execute(ctx: ProjectContext): void {
    this.previous = capture(ctx, this.panelIds);
    wear(ctx, this.panelIds, this.fabricId);
  }

  undo(ctx: ProjectContext): void {
    for (const panel of this.previous) writePanel(ctx, panel);
  }
}

export class AddFabricCommand implements Command {
  readonly label: string;
  readonly fabric: Fabric;
  private previous: PanelSnapshot = [];

  constructor(
    private readonly panelIds: string[],
    project: Project,
    preset: FabricPresetKey,
  ) {
    this.fabric = createFabric(preset, uniqueFabricName(project, FABRIC_PRESET_LABELS[preset]));
    this.label = `新增材质（${this.fabric.name}）`;
  }

  execute(ctx: ProjectContext): void {
    this.previous = capture(ctx, this.panelIds);
    ctx.project.fabrics = { ...ctx.project.fabrics, [this.fabric.id]: this.fabric };
    wear(ctx, this.panelIds, this.fabric.id);
  }

  undo(ctx: ProjectContext): void {
    const rest = { ...ctx.project.fabrics };
    delete rest[this.fabric.id];
    ctx.project.fabrics = rest;
    for (const panel of this.previous) writePanel(ctx, panel);
  }
}

export class AddFabricRecordCommand implements Command {
  readonly label: string;
  private previous: PanelSnapshot = [];

  constructor(private readonly panelIds: string[], private readonly fabric: Fabric) {
    this.label = `新增素材材质（${fabric.name}）`;
  }

  execute(ctx: ProjectContext): void {
    this.previous = capture(ctx, this.panelIds);
    ctx.project.fabrics = { ...ctx.project.fabrics, [this.fabric.id]: structuredClone(this.fabric) };
    wear(ctx, this.panelIds, this.fabric.id);
  }

  undo(ctx: ProjectContext): void {
    const rest = { ...ctx.project.fabrics };
    delete rest[this.fabric.id];
    ctx.project.fabrics = rest;
    for (const panel of this.previous) writePanel(ctx, panel);
  }
}

export class RemoveFabricCommand implements Command {
  readonly label: string;
  private previous: PanelSnapshot = [];

  constructor(private readonly fabric: Fabric) {
    this.label = `删除材质（${fabric.name}）`;
  }

  execute(ctx: ProjectContext): void {
    const target = ctx.project.fabrics[this.fabric.id];
    if (!target) return;
    this.previous = Object.values(ctx.project.pattern.panels).filter(panel => panel.fabricId === target.id);
    const rest = { ...ctx.project.fabrics };
    delete rest[target.id];
    ctx.project.fabrics = rest;
    for (const panel of this.previous) writePanel(ctx, { ...panel, fabricId: '' });
  }

  undo(ctx: ProjectContext): void {
    ctx.project.fabrics = { ...ctx.project.fabrics, [this.fabric.id]: this.fabric };
    for (const panel of this.previous) writePanel(ctx, panel);
  }
}
