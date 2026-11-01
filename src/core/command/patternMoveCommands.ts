import type { Command, ProjectContext } from './command';
import type { Vec2 } from '../model/types';
import {
  panelMoveGeometry, pointMoveGeometry, restoreGeometry, translateGeometry,
  type MoveRecord,
} from './patternMoveGeometry';

/** Moves pattern points; attached bezier handles and internal-line vertices follow. */
export class MovePointsCommand implements Command {
  readonly label = '移动点';
  private records: MoveRecord[] = [];

  /** @param deltas pointId -> translation in cm */
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
