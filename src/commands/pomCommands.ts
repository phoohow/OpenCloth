import { genId } from '@/common/id';
import type { Command, ProjectContext } from '@/commands/command';
import type { Pattern, PomPoint, PomRefs, PomKind } from '@/model/types';

import { validateGrading, type GradingIssue } from '@/commands/gradingCommands';
import {
  buildPomTable, computePomGradingDeltas, pomBase, uniquePomName,
  type PomGrading,
} from '@/pattern/pom';
import type { PomCsvUpdate } from '@/pattern/pom';

/** Fields a new POM starts from. */
export interface NewPomPoint {
  name: string;
  part: string;
  kind: PomKind;
  refs: PomRefs;
  stepCm?: number;
  formula?: string;
}

/** Snapshot of the POM list, taken before an edit for exact rollback. */
function capturePoms(ctx: ProjectContext): PomPoint[] {
  return structuredClone(ctx.project.poms ?? []);
}

/** Adds one point of measure with an empty value table. */
export class AddPomPointCommand implements Command {
  readonly label = '添加测量点';
  readonly skipMirrorSync = true;
  private before: PomPoint[] = [];
  constructor(private readonly input: NewPomPoint) { }

  execute(ctx: ProjectContext): void {
    this.before = capturePoms(ctx);
    const poms = ctx.project.poms ?? [];
    const pom: PomPoint = {
      id: genId('pom'),
      name: uniquePomName(poms, this.input.name),
      part: this.input.part,
      kind: this.input.kind,
      refs: { ...this.input.refs },
      values: {},
      ...(typeof this.input.stepCm === 'number' ? { stepCm: this.input.stepCm } : {}),
      ...(this.input.formula ? { formula: this.input.formula } : {}),
    };
    ctx.project.poms = [...poms, pom];
  }

  undo(ctx: ProjectContext): void {
    ctx.project.poms = structuredClone(this.before);
  }
}

/** Replaces selected fields of one POM, keeping its id and value table. */
export class UpdatePomPointCommand implements Command {
  readonly label = '修改测量点';
  readonly skipMirrorSync = true;
  private before: PomPoint[] = [];
  constructor(private readonly id: string, private readonly patch: Partial<Omit<PomPoint, 'id'>>) { }

  execute(ctx: ProjectContext): void {
    this.before = capturePoms(ctx);
    const poms = ctx.project.poms ?? [];
    const index = poms.findIndex(pom => pom.id === this.id);
    if (index < 0) throw new Error('测量点不存在');
    const next = { ...poms[index]! };
    if (this.patch.name !== undefined) next.name = uniquePomName(
      poms.filter(pom => pom.id !== this.id), this.patch.name,
    );
    if (this.patch.part !== undefined) next.part = this.patch.part;
    if (this.patch.refs !== undefined) next.refs = { ...this.patch.refs };
    if (this.patch.values !== undefined) next.values = { ...this.patch.values };
    if (this.patch.stepCm !== undefined) next.stepCm = this.patch.stepCm;
    if (this.patch.formula !== undefined) next.formula = this.patch.formula || undefined;
    ctx.project.poms = poms.map((pom, i) => (i === index ? next : pom));
  }

  undo(ctx: ProjectContext): void {
    ctx.project.poms = structuredClone(this.before);
  }
}

/** Removes one POM; the pattern grading already written to the sizes stays as it is. */
export class DeletePomPointCommand implements Command {
  readonly label = '删除测量点';
  readonly skipMirrorSync = true;
  private before: PomPoint[] = [];
  constructor(private readonly id: string) { }

  execute(ctx: ProjectContext): void {
    this.before = capturePoms(ctx);
    ctx.project.poms = (ctx.project.poms ?? []).filter(pom => pom.id !== this.id);
  }

  undo(ctx: ProjectContext): void {
    ctx.project.poms = structuredClone(this.before);
  }
}

/** Writes imported per-size values onto the matching POM records. */
export class ImportPomValuesCommand implements Command {
  readonly label = '导入 POM 尺码表';
  readonly skipMirrorSync = true;
  private before: PomPoint[] = [];
  constructor(private readonly updates: readonly PomCsvUpdate[]) { }

  execute(ctx: ProjectContext): void {
    this.before = capturePoms(ctx);
    if (this.updates.length === 0) return;
    ctx.project.poms = (ctx.project.poms ?? []).map(pom => {
      const next = { ...pom, values: { ...pom.values } };
      for (const update of this.updates) {
        if (update.pomId === pom.id) next.values[update.sizeId] = update.value;
      }
      return next;
    });
  }

  undo(ctx: ProjectContext): void {
    ctx.project.poms = structuredClone(this.before);
  }
}

/**
 * Generates every chart size's point grading from the POM table. Each POM moves its two
 * endpoints by half its size difference, so a longer POM lengthens and a shorter one shortens.
 * Problems found by the cross-size check are exposed in `issues`; a self-intersection aborts.
 */
export class GeneratePomGradingCommand implements Command {
  readonly label = '按 POM 生成放码';
  /** Cross-size checks that did not abort the command. */
  issues: GradingIssue[] = [];
  private beforePattern: Pattern | null = null;

  execute(ctx: ProjectContext): void {
    const project = ctx.project;
    const poms = project.poms ?? [];
    if (poms.length === 0) throw new Error('先添加至少一个测量点');
    const table = buildPomTable(project, poms);
    if (table.issues.length > 0) throw new Error(table.issues[0]);
    if (!table.baseSizeId || table.sizes.length < 2) {
      throw new Error('先在尺码表建立基码与至少两个尺码');
    }

    this.beforePattern = structuredClone(project.pattern);
    const basePattern = pomBase(project).pattern;
    const grading = computePomGradingDeltas(table, basePattern);
    this.writeGrading(project.pattern, grading);

    const validation = structuredClone(basePattern);
    this.writeGrading(validation, grading);
    this.issues = validateGrading(validation, table.sizes);
    const selfIntersection = this.issues.find(issue => issue.message.includes('自相交'));
    if (selfIntersection) {
      Object.assign(project.pattern, structuredClone(this.beforePattern));
      throw new Error(`自动放码产生自交轮廓：${selfIntersection.message}`);
    }
  }

  undo(ctx: ProjectContext): void {
    if (!this.beforePattern) return;
    Object.assign(ctx.project.pattern, structuredClone(this.beforePattern));
    this.beforePattern = null;
  }

  /** Replaces the live grading map and writes the generated entries. */
  private writeGrading(pattern: Pattern, grading: PomGrading): void {
    for (const point of Object.values(pattern.points)) delete point.grading;
    for (const [sizeId, deltas] of grading) {
      for (const [pointId, delta] of deltas) {
        const point = pattern.points[pointId];
        if (!point) continue;
        point.grading ??= {};
        point.grading[sizeId] = { ...delta };
      }
    }
  }
}
