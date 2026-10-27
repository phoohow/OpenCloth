import type { Command, ProjectContext } from './command';
import type { Fabric, FabricPresetKey, Panel, Project } from '../model/types';
import { createFabric, FABRIC_PRESET_LABELS } from '../model/defaults';
import { clonedFabric, fabricForPanel, uniqueFabricName } from '../model/fabric';

/** Panel records captured before an edit, used to restore them on undo. */
type PanelSnapshot = Panel[];

/** Replaces one panel record without touching the pattern reference, so the cloth keeps its state. */
function writePanel(ctx: ProjectContext, panel: Panel): void {
  ctx.project.pattern.panels[panel.id] = panel;
}

/** Copies of the listed panels as they are right now. */
function capture(ctx: ProjectContext, panelIds: string[]): PanelSnapshot {
  return panelIds.map(id => ctx.project.pattern.panels[id]).filter(Boolean);
}

/** Points the listed panels at the given material. */
function wear(ctx: ProjectContext, panelIds: string[], fabricId: string): void {
  for (const id of panelIds) {
    const panel = ctx.project.pattern.panels[id];
    if (panel) writePanel(ctx, { ...panel, fabricId });
  }
}

/** Points the listed panels at another material record. */
export class AssignFabricCommand implements Command {
  readonly label = '指定材质';
  private previous: PanelSnapshot = [];

  constructor(
    private readonly panelIds: string[],
    private readonly fabricId: string,
  ) { }

  execute(ctx: ProjectContext): void {
    this.previous = capture(ctx, this.panelIds);
    wear(ctx, this.panelIds, this.fabricId);
  }

  undo(ctx: ProjectContext): void {
    for (const panel of this.previous) writePanel(ctx, panel);
  }
}

/** Creates a material from a preset and wears it on the listed panels. */
export class AddFabricCommand implements Command {
  readonly label: string;
  /** Material created from the preset at construction time. */
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

/** Gives the listed panels their own copy of the material they share. */
export class DetachFabricCommand implements Command {
  readonly label: string;
  /** Copy of the source panel's material; null when that panel has none. */
  readonly fabric: Fabric | null;
  private previous: PanelSnapshot = [];

  constructor(
    private readonly panelIds: string[],
    project: Project,
    sourcePanelId: string,
  ) {
    const source = fabricForPanel(project, sourcePanelId);
    this.fabric = source ? clonedFabric(project, source) : null;
    this.label = this.fabric ? `拆分为独立材质（${this.fabric.name}）` : '拆分为独立材质';
  }

  execute(ctx: ProjectContext): void {
    if (!this.fabric) return;
    this.previous = capture(ctx, this.panelIds);
    ctx.project.fabrics = { ...ctx.project.fabrics, [this.fabric.id]: this.fabric };
    wear(ctx, this.panelIds, this.fabric.id);
  }

  undo(ctx: ProjectContext): void {
    if (!this.fabric) return;
    const rest = { ...ctx.project.fabrics };
    delete rest[this.fabric.id];
    ctx.project.fabrics = rest;
    for (const panel of this.previous) writePanel(ctx, panel);
  }
}
