import type { Project } from '@/model/types/project';

export interface ProjectContext {
  project: Project;
}

export interface Command {
  readonly label: string;
  readonly skipMirrorSync?: boolean;
  execute(ctx: ProjectContext): void;
  undo(ctx: ProjectContext): void;
}
