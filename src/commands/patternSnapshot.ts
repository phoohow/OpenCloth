import type { Command, ProjectContext } from '@/commands/command';
import type { Pattern } from '@/model/types';

import { autoSyncMirrors } from '@/commands/patternSymmetry';
import { validatePattern } from '@/model';

export class PatternSnapshot {
  private before: Pattern | null;
  constructor(pattern: Pattern) {
    this.before = structuredClone(pattern);
  }

  captured(): Pattern | null {
    return this.before;
  }

  restore(pattern: Pattern): void {
    if (this.before) Object.assign(pattern, structuredClone(this.before));
  }

  clear(): void {
    this.before = null;
  }
}

export function assertValidPattern(pattern: Pattern): void {
  const issue = validatePattern(pattern)[0];
  if (issue) throw new Error(issue.message);
}

export abstract class SnapshotCommand implements Command {
  abstract readonly label: string;
  readonly skipMirrorSync: boolean = false;
  private snapshot: PatternSnapshot | null = null;
  protected abstract apply(pattern: Pattern, ctx: ProjectContext): void;
  execute(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    this.snapshot = new PatternSnapshot(pattern);
    try {
      this.apply(pattern, ctx);
      if (!this.skipMirrorSync) autoSyncMirrors(pattern, this.snapshot.captured() ?? pattern);
      assertValidPattern(pattern);
    } catch (err) {
      this.snapshot.restore(pattern);
      this.snapshot = null;
      throw err;
    }
  }

  undo(ctx: ProjectContext): void {
    this.snapshot?.restore(ctx.project.pattern);
    this.snapshot = null;
  }
}
