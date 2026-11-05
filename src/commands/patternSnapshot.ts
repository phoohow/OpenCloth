import type { Command, ProjectContext } from '@/commands/command';
import type { Pattern } from '@/model/types';
import { validatePattern } from '@/model';
import { autoSyncMirrors } from '@/commands/patternSymmetry';

/** Deep copy of the pattern collections, taken before a structural edit for exact rollback. */
export class PatternSnapshot {
  private before: Pattern | null;
  constructor(pattern: Pattern) {
    this.before = structuredClone(pattern);
  }
  /** Pattern captured before the edit; null after `clear()`. */
  captured(): Pattern | null {
    return this.before;
  }
  /** Replaces the live pattern's collections with the captured copy. */
  restore(pattern: Pattern): void {
    if (this.before) Object.assign(pattern, structuredClone(this.before));
  }
  /** Drops the captured copy; a cleared snapshot restores nothing. */
  clear(): void {
    this.before = null;
  }
}

/** Throws a Chinese error naming the first topology violation. */
export function assertValidPattern(pattern: Pattern): void {
  const issue = validatePattern(pattern)[0];
  if (issue) throw new Error(issue.message);
}

/**
 * Pattern edit that captures a full snapshot before mutating, so undo restores the
 * pattern exactly and a failed execute rolls the whole pattern back atomically.
 */
export abstract class SnapshotCommand implements Command {
  abstract readonly label: string;
  /** True when the command rebuilds its symmetry links itself. */
  readonly skipMirrorSync: boolean = false;
  private snapshot: PatternSnapshot | null = null;
  /** Mutates the pattern in place; throw to abort the edit and roll it back. */
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
