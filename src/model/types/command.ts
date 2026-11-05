import type { Project } from '@/model/types/project';

/** Draft project a command mutates; the store commits the result as immutable project data. */
export interface ProjectContext {
  project: Project;
}

/** Edit that can be rolled back and re-applied. */
export interface Command {
  /** Chinese label shown in the undo/redo menus. */
  readonly label: string;
  /** True when the command rebuilds its symmetry links itself. */
  readonly skipMirrorSync?: boolean;
  /** Applies the edit to the draft project. */
  execute(ctx: ProjectContext): void;
  /** Restores the state captured by execute. */
  undo(ctx: ProjectContext): void;
}
