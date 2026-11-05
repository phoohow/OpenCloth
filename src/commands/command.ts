import type { Command, ProjectContext, Pattern } from '@/model/types';
import { autoSyncMirrors } from '@/commands/patternSymmetry';

export type { Command, ProjectContext } from '@/model/types';

/** Deep copy taken only when a symmetry pair could need syncing after the command. */
function snapshotWithSymmetry(pattern: Pattern): Pattern | null {
  return Object.values(pattern.panels).some(panel => !!panel.symmetry) ? structuredClone(pattern) : null;
}

/** Wraps a command whose edit moved one side of a symmetry pair, restoring both on undo. */
class MirrorSyncedCommand implements Command {
  readonly label: string;
  constructor(private readonly inner: Command, private readonly before: Pattern) {
    this.label = inner.label;
  }
  execute(ctx: ProjectContext): void {
    this.inner.execute(ctx);
    autoSyncMirrors(ctx.project.pattern, this.before);
  }
  undo(ctx: ProjectContext): void {
    this.inner.undo(ctx);
    Object.assign(ctx.project.pattern, structuredClone(this.before));
  }
}

/** Undo and redo stacks for executed commands; the undo stack keeps the latest 100. */
export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private limit = 100;

  execute(cmd: Command, ctx: ProjectContext): void {
    const before = cmd.skipMirrorSync ? null : snapshotWithSymmetry(ctx.project.pattern);
    cmd.execute(ctx);
    const synced = before ? autoSyncMirrors(ctx.project.pattern, before) : false;
    this.undoStack.push(synced && before ? new MirrorSyncedCommand(cmd, before) : cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(ctx: ProjectContext): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo(ctx);
    this.redoStack.push(cmd);
    return true;
  }

  redo(ctx: ProjectContext): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute(ctx);
    this.undoStack.push(cmd);
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  /** Label of the command undo() would roll back. */
  get lastLabel(): string | null { return this.undoStack.at(-1)?.label ?? null; }
  /** Label of the command redo() would re-apply. */
  get nextLabel(): string | null { return this.redoStack.at(-1)?.label ?? null; }
}
