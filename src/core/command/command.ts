import type { Project } from '../model/types';

/** Draft project a command mutates; the store commits the result as immutable project data. */
export interface ProjectContext {
  project: Project;
}

/** Edit that can be rolled back and re-applied. */
export interface Command {
  /** Chinese label shown in the undo/redo menus. */
  readonly label: string;
  /** Applies the edit to the draft project. */
  execute(ctx: ProjectContext): void;
  /** Restores the state captured by execute. */
  undo(ctx: ProjectContext): void;
}

/** Undo and redo stacks for executed commands; the undo stack keeps the latest 100. */
export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private limit = 100;

  execute(cmd: Command, ctx: ProjectContext): void {
    cmd.execute(ctx);
    this.undoStack.push(cmd);
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
