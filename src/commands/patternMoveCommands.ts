import type { Command, ProjectContext } from '@/commands/command';
import { CompositeCommand } from '@/commands/compositeCommand';
import type { Pattern, Vec2 } from '@/model/types';
import {
  panelMoveGeometry, pointMoveGeometry, restoreGeometry, translateGeometry,
  type MoveGeometry, type MoveRecord,
} from '@/commands/patternMoveGeometry';

/** Moves pattern points; attached bezier handles and internal-line vertices follow. */
export class MovePointsCommand implements Command {
  readonly label = '移动点';
  private records: MoveRecord[] = [];

  /**
   * @param deltas pointId -> translation in cm; a draped panel keeps its height placement
   */
  constructor(private deltas: Map<string, Vec2>) { }

  execute(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    this.records = [];
    for (const [pointId, delta] of this.deltas) {
      this.records.push(...translateGeometry(pattern, pointMoveGeometry(pattern, [pointId]), delta));
    }
  }

  undo(ctx: ProjectContext): void {
    restoreGeometry(ctx.project.pattern, this.records);
  }
}

/** Translates whole panels as rigid bodies: outline, curves, darts and internal lines. */
export class MovePanelsCommand implements Command {
  readonly label = '移动版片';
  private records: MoveRecord[] = [];

  /**
   * @param panelIds panels to move
   * @param delta translation in cm
   */
  constructor(private panelIds: readonly string[], private delta: Vec2) { }

  execute(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    this.records = translateGeometry(pattern, panelMoveGeometry(pattern, this.panelIds), this.delta);
  }

  undo(ctx: ProjectContext): void {
    restoreGeometry(ctx.project.pattern, this.records);
  }
}

/** Options of a prepared-geometry translation. */
export interface MoveGeometryOptions {
  /** Undo label of the command. */
  label?: string;
  /** Keeps a draped panel's height placement instead of re-hanging it off the moved geometry. */
  keepDrapeHeight?: boolean;
}

/** Translates geometry prepared by `pointMoveGeometry` or `edgePointIds`, as one undo step. */
export class MoveGeometryCommand implements Command {
  readonly label: string;
  private readonly keepDrapeHeight: boolean | undefined;
  private records: MoveRecord[] = [];

  constructor(
    private readonly geom: MoveGeometry, private readonly delta: Vec2, options: MoveGeometryOptions = {},
  ) {
    this.label = options.label ?? '移动点';
    this.keepDrapeHeight = options.keepDrapeHeight;
  }

  execute(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    this.records = translateGeometry(pattern, this.geom, this.delta, { keepDrapeHeight: this.keepDrapeHeight });
  }

  undo(ctx: ProjectContext): void {
    restoreGeometry(ctx.project.pattern, this.records);
  }
}

/** Raises or lowers draped panels on the body by shifting their drape anchor, in centimeters. */
export class MovePanelsHeightCommand implements Command {
  readonly label = '移动版片高度';
  private previous: Array<{ panelId: string; offsetCm: number }> = [];

  constructor(private panelIds: readonly string[], private deltaCm: number) { }

  execute(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    this.previous = [];
    for (const panelId of this.panelIds) {
      const drape = pattern.panels[panelId]?.drape;
      if (!drape) continue;
      const before = drape.anchorOffsetCm ?? 0;
      this.previous.push({ panelId, offsetCm: before });
      drape.anchorOffsetCm = before + this.deltaCm;
    }
  }

  undo(ctx: ProjectContext): void {
    for (const record of this.previous) {
      const drape = ctx.project.pattern.panels[record.panelId]?.drape;
      if (drape) drape.anchorOffsetCm = record.offsetCm;
    }
  }
}

/**
 * Splits panels by where their height comes from: a draped panel hangs off its drape anchor,
 * everything else sits at its pattern y.
 */
function splitByDrapeHeight(
  pattern: Pattern, panelIds: readonly string[],
): { draped: string[]; flat: string[] } {
  const draped: string[] = [];
  const flat: string[] = [];
  for (const panelId of panelIds) {
    if (!pattern.panels[panelId]) continue;
    (pattern.panels[panelId]!.drape ? draped : flat).push(panelId);
  }
  return { draped, flat };
}

/**
 * Commands that move panels: the horizontal part translates the pattern, the vertical part is a
 * body height, so a draped panel rides its drape anchor instead of sliding its pattern y.
 */
export function movePanelsCommands(pattern: Pattern, panelIds: readonly string[], delta: Vec2): Command[] {
  const { draped, flat } = splitByDrapeHeight(pattern, panelIds);
  const commands: Command[] = [];
  if (flat.length > 0) commands.push(new MovePanelsCommand(flat, delta));
  if (draped.length > 0) {
    if (delta.x !== 0) commands.push(new MovePanelsCommand(draped, { x: delta.x, y: 0 }));
    if (delta.y !== 0) commands.push(new MovePanelsHeightCommand(draped, delta.y));
  }
  return commands;
}

/** Single command that moves panels, or null when nothing would change; the UI's commit path. */
export function panelMoveCommand(pattern: Pattern, panelIds: readonly string[], delta: Vec2): Command | null {
  const commands = movePanelsCommands(pattern, panelIds, delta);
  if (commands.length === 0) return null;
  return commands.length === 1 ? commands[0]! : new CompositeCommand('移动版片', commands);
}

/**
 * Single command that moves points or edge endpoints prepared from the selection, or null when
 * none of them exists any more; the UI's commit path for vertex and edge drags.
 */
export function pointMoveCommand(pattern: Pattern, pointIds: readonly string[], delta: Vec2): Command | null {
  const geom = pointMoveGeometry(pattern, pointIds);
  return geom.pointIds.length === 0 ? null : new MoveGeometryCommand(geom, delta);
}
