import type { Command, ProjectContext } from './command';
import { PatternSnapshot } from './patternSnapshot';

/** Runs sub-commands as one undo unit; a failing execute rolls the whole pattern back. */
export class CompositeCommand implements Command {
  readonly label: string;
  constructor(label: string, private cmds: Command[]) {
    this.label = label;
  }

  execute(ctx: ProjectContext): void {
    const snapshot = new PatternSnapshot(ctx.project.pattern);
    try {
      for (const cmd of this.cmds) cmd.execute(ctx);
    } catch (err) {
      snapshot.restore(ctx.project.pattern);
      throw err;
    }
  }

  undo(ctx: ProjectContext): void {
    for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i].undo(ctx);
  }
}
